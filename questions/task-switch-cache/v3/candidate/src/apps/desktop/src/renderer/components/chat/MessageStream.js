import { placeBotTaskCardsAfterIntroduction as placeBotTaskCardsAfterIntroduction } from "../../../../../../packages/maker-shared/src/botCollaboration.js";
import { isSubagentParentToolUseId as isSubagentParentToolUseId } from "../../../../../../packages/maker-shared/src/messageRender.js";
import { extractCachedRenderedMarkdownImageTargets as extractCachedRenderedMarkdownImageTargets } from "./markdownImageTargets.js";
import { extractRenderedMarkdownImageTargets as extractRenderedMarkdownImageTargets } from "./markdownImageTargets.js";
import { extractGhostCardId as extractGhostCardId } from "./AgentActionRow.js";
import { findMessageTodoInsertions as findMessageTodoInsertions } from "../../../../../../packages/maker-shared/src/messageRender.js";
import { isAgentPlanToolName as isAgentPlanToolName } from "../../../../../../packages/maker-shared/src/messageRender.js";
import { getLatestMessageTodoState as getLatestMessageTodoState } from "../../../../../../packages/maker-shared/src/messageRender.js";
import { resolveToolFilePath as resolveToolFilePath } from "../../lib/localPathResolver.js";
import { hasReviewableTurnChanges as hasReviewableTurnChanges } from "../../../shared/turnChangeSet.js";
import { extractToolResultMedia as extractToolResultMedia } from "./AgentActionRow.js";
import { basename as basename } from "../../lib/utils.js";
import { collectCachedGeneratedFiles as collectCachedGeneratedFiles } from "./generatedFilesProjection.js";
import { isCompletedAssistantMessage as isCompletedAssistantMessage } from "./messageWorkGroups.js";
import { isAgentTaskToolName as isAgentTaskToolName } from "../../../../../../packages/maker-shared/src/agentTask.js";
import { isGhostCallToolName as isGhostCallToolName } from "../../../shared/ghost.js";
import { extractAnchorCardId as extractAnchorCardId } from "./AgentActionRow.js";
import { messageTs as messageTs } from "./messageWorkGroups.js";
import { HISTORY_GAP_SPLIT_MS as HISTORY_GAP_SPLIT_MS } from "../../lib/historyGap.js";
import { renderItemStartMs as renderItemStartMs } from "./messageWorkGroups.js";
import { getDataOwnerGeneration as getDataOwnerGeneration } from "../../contexts/dataOwnerGeneration.js";
export function isGeneratedFilesSubTurnTerminal(message) {
    return message.turnCompleted === false || isCompletedAssistantMessage(message);
}
export function isGeneratedFilesTurnSealed(slice, hasFollowingUser) {
    if (hasFollowingUser)
        return true;
    let lastTerminalIdx = -1;
    for (let i = 0; i < slice.length; i++) {
        if (isGeneratedFilesSubTurnTerminal(slice[i]))
            lastTerminalIdx = i;
    }
    if (lastTerminalIdx < 0)
        return false;
    for (let i = lastTerminalIdx + 1; i < slice.length; i++) {
        const message = slice[i];
        if (message.role === 'tool_use')
            return false;
        if (message.role === 'user' && message.isSyntheticTrigger === true)
            return false;
        if (message.role === 'assistant' && !message.systemCardType)
            return false;
    }
    return true;
}
export function isWorkflowToolName(toolName) {
    return toolName === 'Workflow';
}
export function findTaskUpdate(taskUpdates, toolCall) {
    if (!taskUpdates)
        return undefined;
    if (toolCall.toolUseId) {
        const byToolUseId = taskUpdates.get(toolCall.toolUseId);
        if (byToolUseId)
            return byToolUseId;
    }
    return taskUpdates.get(toolCall.clientId);
}
export function isSubagentInternalMessage(message) {
    const parent = message.parentToolUseId;
    return typeof parent === 'string' && parent.length > 0 && isSubagentParentToolUseId(parent);
}
export function isRenderTurnBoundary(message) {
    if (message.role === 'user') {
        return message.delivery !== 'steer' && !message.isSyntheticTrigger;
    }
    return (message.role === 'assistant' &&
        (message.systemCardType === 'cindy-make' || message.systemCardType === 'cindy-make-doctor'));
}
export function buildRenderItems(allMessages, taskUpdates, ghostCards, opts) {
    allMessages = allMessages.filter((message) => message.systemCardData?.modalOnly !== true);
    if (opts?.botSessionId) {
        allMessages = placeBotTaskCardsAfterIntroduction(allMessages, (message) => {
            if (message.role === 'user') {
                return message.delivery !== 'steer' || message.isSyntheticTrigger ? 'boundary' : 'other';
            }
            if (isSubagentInternalMessage(message))
                return 'other';
            if (message.systemCardType === 'bot-session-task')
                return 'task';
            return message.role === 'assistant' && !message.systemCardType && message.content.trim()
                ? 'prose'
                : 'other';
        });
    }
    const hasSubagentInternalMessages = allMessages.some(isSubagentInternalMessage);
    const originalIndexByVisible = [];
    const messages = hasSubagentInternalMessages
        ? allMessages.filter((m, idx) => {
            if (isSubagentInternalMessage(m))
                return false;
            originalIndexByVisible.push(idx);
            return true;
        })
        : allMessages;
    const originalTurnSlice = (lo, hi) => {
        if (!hasSubagentInternalMessages)
            return messages.slice(lo, hi);
        const start = originalIndexByVisible[lo];
        if (start === undefined)
            return messages.slice(lo, hi);
        const end = hi < originalIndexByVisible.length ? originalIndexByVisible[hi] : allMessages.length;
        return allMessages.slice(start, end);
    };
    const inlineImageUrlsByTurnStart = new Map();
    const recordTurnInlineImages = (lo, hi) => {
        if (hi <= lo)
            return;
        const urls = new Set();
        for (const message of messages.slice(lo, hi)) {
            if (message.role !== 'assistant' || message.systemCardType)
                continue;
            const imageTargets = opts?.markdownImageTargetCache
                ? extractCachedRenderedMarkdownImageTargets(message.content, opts.markdownImageTargetCache, message.clientId)
                : extractRenderedMarkdownImageTargets(message.content);
            for (const url of imageTargets)
                urls.add(url);
        }
        inlineImageUrlsByTurnStart.set(lo, urls);
    };
    let inlineTurnStart = 0;
    for (let index = 0; index <= messages.length; index += 1) {
        const message = messages[index];
        const isBoundary = message ? isRenderTurnBoundary(message) : false;
        if (isBoundary && index > inlineTurnStart) {
            recordTurnInlineImages(inlineTurnStart, index);
            inlineTurnStart = index;
        }
        if (index === messages.length)
            recordTurnInlineImages(inlineTurnStart, index);
    }
    const resultByToolUseId = new Map();
    const resultTsByToolUseId = new Map();
    const settledCardIds = new Set();
    for (const m of messages) {
        if (m.role === 'tool_result' && typeof m.toolUseId === 'string' && m.toolUseId.length > 0) {
            resultByToolUseId.set(m.toolUseId, m.content);
            const resultMs = Date.parse(m.createdAt ?? '');
            if (Number.isFinite(resultMs))
                resultTsByToolUseId.set(m.toolUseId, resultMs);
            const cardId = extractGhostCardId(m.content);
            if (cardId)
                settledCardIds.add(cardId);
        }
    }
    const planInsertAt = findMessageTodoInsertions(messages, {
        taskHistoryMayBeIncomplete: opts?.historyWindowIncomplete === true,
    });
    if (opts?.historyWindowIncomplete === true) {
        for (const [index, insertion] of planInsertAt) {
            if (insertion.source !== 'task')
                continue;
            const prefix = messages.slice(0, index + 1);
            const prefixPlanToolUseIds = new Set(prefix
                .filter((message) => isAgentPlanToolName(message.toolName))
                .map((message) => message.toolUseId)
                .filter((toolUseId) => Boolean(toolUseId)));
            const validationMessages = [
                ...prefix,
                ...messages
                    .slice(index + 1)
                    .filter((message) => message.role === 'tool_result' &&
                    typeof message.toolUseId === 'string' &&
                    prefixPlanToolUseIds.has(message.toolUseId)),
            ];
            const stateAtInsertion = getLatestMessageTodoState(validationMessages, {
                taskHistoryMayBeIncomplete: true,
            });
            if (!stateAtInsertion.isResolved || stateAtInsertion.latestInsertionIndex !== index) {
                planInsertAt.delete(index);
            }
        }
    }
    const isOrcaCommunicationTool = (toolName) => {
        const normalized = toolName.replace(/^mcp__/, 'mcp:').replace(/__/g, ':');
        return (normalized === 'mcp:orca_worker_bridge:send_to_lead' ||
            normalized === 'mcp:orca_worker_bridge:read_lead' ||
            normalized === 'mcp:orca_worker_bridge:lead_status' ||
            toolName === 'send_to_lead' ||
            toolName === 'read_lead' ||
            toolName === 'lead_status');
    };
    const isEmptyOrcaCommunicationResult = (content) => {
        const trimmed = content.trim();
        if (!trimmed)
            return true;
        try {
            const parsed = JSON.parse(trimmed);
            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
                return false;
            const record = parsed;
            const hasUserFacingContent = ['message', 'result', 'text', 'content', 'error', 'detail'].some((key) => typeof record[key] === 'string' && record[key].trim().length > 0);
            if (hasUserFacingContent)
                return false;
            return record.ok === true;
        }
        catch {
            return false;
        }
    };
    const shouldHideToolResult = (toolName, content) => isOrcaCommunicationTool(toolName) && isEmptyOrcaCommunicationResult(content);
    const items = [];
    const renderedTaskKeys = new Set();
    const singleResultMap = new Map();
    let pendingToolCalls = [];
    let pendingResultMap = new Map();
    let pendingResultTsMap = new Map();
    let pendingSegmentEndMs = null;
    const notePendingSegmentEnd = (ms) => {
        if (ms === null || ms === undefined || !Number.isFinite(ms))
            return;
        pendingSegmentEndMs = pendingSegmentEndMs === null ? ms : Math.max(pendingSegmentEndMs, ms);
    };
    let pendingSettledIds = new Set();
    let pendingSegmentMedia = [];
    let pendingSegmentGhostCards = [];
    const claimedLiveCallIds = new Set();
    const ghostCardItemByCallId = new Map();
    const flushSegment = () => {
        if (pendingToolCalls.length === 0) {
            for (const gc of pendingSegmentGhostCards)
                items.push(gc);
            pendingSegmentGhostCards = [];
            return;
        }
        const segmentKey = `seg-${pendingToolCalls[0].clientId}`;
        items.push({
            type: 'tool_segment',
            key: segmentKey,
            toolCalls: pendingToolCalls,
            resultMap: pendingResultMap,
            resultTsMap: pendingResultTsMap,
            settledIds: pendingSettledIds,
        });
        if (pendingSegmentMedia.length > 0) {
            const seen = new Set();
            const dedup = pendingSegmentMedia.filter((m) => {
                if (seen.has(m.url))
                    return false;
                seen.add(m.url);
                return true;
            });
            items.push({
                type: 'tool_media',
                key: `media-${pendingToolCalls[0].clientId}`,
                items: dedup,
            });
        }
        for (const gc of pendingSegmentGhostCards)
            items.push(gc);
        pendingToolCalls = [];
        pendingResultMap = new Map();
        pendingResultTsMap = new Map();
        pendingSegmentEndMs = null;
        pendingSettledIds = new Set();
        pendingSegmentMedia = [];
        pendingSegmentGhostCards = [];
    };
    let turnStartIdx = 0;
    const flushTurnChanges = (lo, hi) => {
        if (hi <= lo)
            return;
        const anchorClientId = messages[lo]?.clientId;
        if (!anchorClientId)
            return;
        const changeSets = (opts?.turnChangeSets ?? []).filter((changeSet) => changeSet.anchorClientId === anchorClientId);
        const exactPaths = new Set();
        const pathKey = (value) => {
            const normalized = value.replace(/\\/g, '/');
            const windowsShape = /^[a-zA-Z]:[\\/]/.test(value) || value.includes('\\');
            return windowsShape ? normalized.toLowerCase() : normalized;
        };
        for (const changeSet of changeSets) {
            for (const file of changeSet.files) {
                const resolved = resolveToolFilePath(file.path, changeSet.cwd);
                exactPaths.add(pathKey(resolved));
                if (file.oldPath)
                    exactPaths.add(pathKey(resolveToolFilePath(file.oldPath, changeSet.cwd)));
            }
        }
        if (!opts?.botSessionId) {
            for (const changeSet of changeSets) {
                if (!hasReviewableTurnChanges(changeSet))
                    continue;
                items.push({
                    type: 'turn_changes',
                    key: `turnchanges-${changeSet.id}`,
                    changeSet,
                });
            }
        }
        if (hasSubagentInternalMessages) {
            const hiddenMedia = [];
            const seenMediaUrls = new Set();
            for (const message of originalTurnSlice(lo, hi)) {
                if (message.role !== 'tool_result' || !isSubagentInternalMessage(message))
                    continue;
                for (const item of extractToolResultMedia(message.content)) {
                    if (item.kind === 'image' && inlineImageUrlsByTurnStart.get(lo)?.has(item.url)) {
                        continue;
                    }
                    if (seenMediaUrls.has(item.url))
                        continue;
                    seenMediaUrls.add(item.url);
                    hiddenMedia.push(item);
                }
            }
            if (hiddenMedia.length > 0) {
                items.push({
                    type: 'tool_media',
                    key: `subagent-media-${anchorClientId}`,
                    items: hiddenMedia,
                });
            }
        }
        const slice = originalTurnSlice(lo, hi);
        const generatedByPath = new Map();
        if (opts?.botSessionId) {
            for (const changeSet of changeSets) {
                for (const file of changeSet.files) {
                    if (file.status !== 'added')
                        continue;
                    const resolved = resolveToolFilePath(file.path, changeSet.cwd);
                    generatedByPath.set(pathKey(resolved), {
                        path: resolved,
                        name: basename(file.path),
                        source: 'tool',
                        ready: true,
                    });
                }
            }
        }
        const workingDir = opts?.workingDir ?? '';
        if (workingDir) {
            for (const file of collectCachedGeneratedFiles(slice, workingDir)) {
                const normalized = pathKey(file.path);
                if (exactPaths.has(normalized) && changeSets.length > 0)
                    continue;
                generatedByPath.set(normalized, file);
            }
        }
        const generatedFiles = [...generatedByPath.values()];
        if (generatedFiles.length === 0)
            return;
        let turnStartMs = null;
        for (const message of slice) {
            const timestamp = Date.parse(message.createdAt ?? '');
            if (Number.isFinite(timestamp) && (turnStartMs === null || timestamp < turnStartMs)) {
                turnStartMs = timestamp;
            }
        }
        const boundaryTimestamp = Date.parse(messages[hi]?.createdAt ?? '');
        const hasFollowingUser = hi < messages.length;
        const turnSealed = isGeneratedFilesTurnSealed(slice, hasFollowingUser);
        items.push({
            type: 'generated_files',
            key: `genfiles-${messages[lo].clientId}`,
            files: generatedFiles,
            turnStartMs,
            turnEndMs: Number.isFinite(boundaryTimestamp) ? boundaryTimestamp : null,
            turnSealed,
        });
    };
    let i = 0;
    while (i < messages.length) {
        const msg = messages[i];
        if (isRenderTurnBoundary(msg)) {
            flushSegment();
            flushTurnChanges(turnStartIdx, i);
            turnStartIdx = i;
        }
        if (msg.role === 'ask_user' && msg.askUserStatus !== 'answered') {
            i++;
            continue;
        }
        if (msg.role === 'tool_use') {
            const toolName = msg.toolName ?? '';
            if (toolName === 'AskUserQuestion' || toolName === 'ExitPlanMode') {
                let j = i + 1;
                while (j < messages.length && messages[j].role === 'tool_result')
                    j++;
                i = j;
                continue;
            }
            if (isAgentPlanToolName(toolName)) {
                const insertion = planInsertAt.get(i);
                if (insertion && insertion.todos.length >= 2) {
                    flushSegment();
                    items.push({
                        type: 'agent_plan',
                        key: insertion.key,
                        todos: insertion.todos,
                        sourceClientIds: insertion.sourceClientIds,
                        createdAt: msg.createdAt,
                    });
                }
                let j = i + 1;
                while (j < messages.length && messages[j].role === 'tool_result')
                    j++;
                i = j;
                continue;
            }
            if (isAgentTaskToolName(toolName) || isWorkflowToolName(toolName)) {
                flushSegment();
                let result = typeof msg.toolUseId === 'string' && msg.toolUseId.length > 0
                    ? resultByToolUseId.get(msg.toolUseId)
                    : undefined;
                let resultTsMs = typeof msg.toolUseId === 'string' && msg.toolUseId.length > 0
                    ? resultTsByToolUseId.get(msg.toolUseId)
                    : undefined;
                let j = i + 1;
                while (j < messages.length && messages[j].role === 'tool_result') {
                    if (result === undefined && !shouldHideToolResult(toolName, messages[j].content)) {
                        result = messages[j].content;
                    }
                    const adjacentTs = Date.parse(messages[j].createdAt ?? '');
                    if (Number.isFinite(adjacentTs) &&
                        (resultTsMs === undefined || adjacentTs > resultTsMs)) {
                        resultTsMs = adjacentTs;
                    }
                    j++;
                }
                const update = findTaskUpdate(taskUpdates, msg);
                if (msg.toolUseId)
                    renderedTaskKeys.add(msg.toolUseId);
                if (update?.taskId)
                    renderedTaskKeys.add(update.taskId);
                if (update?.parentToolUseId)
                    renderedTaskKeys.add(update.parentToolUseId);
                items.push({
                    type: 'agent_task',
                    key: `task-${msg.clientId}`,
                    toolCall: msg,
                    update,
                    ...(msg.agentTaskStatus ? { persistedStatus: msg.agentTaskStatus } : {}),
                    ...(result !== undefined && !shouldHideToolResult(toolName, result) ? { result } : {}),
                    ...(resultTsMs !== undefined ? { resultTsMs } : {}),
                });
                i = j;
                continue;
            }
            let suppressMediaForCard = false;
            let hideRowForCard = false;
            const maybeQueueGhostCard = (result) => {
                if (!ghostCards || !isGhostCallToolName(toolName))
                    return;
                const inp = (msg.toolInput ?? null);
                const ghostIdFromInput = typeof inp?.ghost_id === 'string' ? inp.ghost_id : '';
                const toolFromInput = typeof inp?.tool === 'string' ? inp.tool : '';
                if (result !== undefined) {
                    const cardId = extractGhostCardId(result);
                    if (!cardId)
                        return;
                    const entry = ghostCards.byCallId.get(cardId);
                    if (entry?.status === 'missing')
                        return;
                    suppressMediaForCard = true;
                    hideRowForCard = true;
                    if (entry?.status === 'ready') {
                        const cardItem = {
                            type: 'ghost_card',
                            key: `ghostcard-${msg.clientId}`,
                            callId: cardId,
                            ghostId: ghostIdFromInput || entry.ghostId,
                            tool: toolFromInput,
                            toolCall: msg,
                            settled: true,
                            resultTsMs: typeof msg.toolUseId === 'string'
                                ? resultTsByToolUseId.get(msg.toolUseId)
                                : undefined,
                        };
                        pendingSegmentGhostCards.push(cardItem);
                        ghostCardItemByCallId.set(cardId, cardItem);
                    }
                    return;
                }
                const live = ghostCards.liveCards.find((lc) => !claimedLiveCallIds.has(lc.callId) &&
                    !settledCardIds.has(lc.callId) &&
                    lc.toolUseId !== null &&
                    typeof msg.toolUseId === 'string' &&
                    lc.toolUseId === msg.toolUseId) ??
                    (ghostIdFromInput
                        ? ghostCards.liveCards.find((lc) => !claimedLiveCallIds.has(lc.callId) &&
                            !settledCardIds.has(lc.callId) &&
                            lc.ghostId.length > 0 &&
                            lc.ghostId === ghostIdFromInput)
                        : undefined);
                if (!live)
                    return;
                if (ghostCards.byCallId.get(live.callId)?.status !== 'ready')
                    return;
                claimedLiveCallIds.add(live.callId);
                hideRowForCard = true;
                const liveCardItem = {
                    type: 'ghost_card',
                    key: `ghostcard-${msg.clientId}`,
                    callId: live.callId,
                    ghostId: ghostIdFromInput || live.ghostId,
                    tool: toolFromInput,
                    toolCall: msg,
                    settled: false,
                };
                pendingSegmentGhostCards.push(liveCardItem);
                ghostCardItemByCallId.set(live.callId, liveCardItem);
            };
            const collectResultMedia = (result) => {
                let media = extractToolResultMedia(result);
                const inlineImageUrls = inlineImageUrlsByTurnStart.get(turnStartIdx);
                if (inlineImageUrls?.size) {
                    media = media.filter((item) => item.kind !== 'image' || !inlineImageUrls.has(item.url));
                }
                if (media.length === 0)
                    return;
                if (isGhostCallToolName(toolName)) {
                    const anchor = extractAnchorCardId(result);
                    const inp = (msg.toolInput ?? null);
                    const ghostIdFromInput = typeof inp?.ghost_id === 'string' ? inp.ghost_id : '';
                    const target = anchor ? ghostCardItemByCallId.get(anchor) : undefined;
                    const sameGhostTarget = target && ghostIdFromInput && target.ghostId === ghostIdFromInput ? target : undefined;
                    if (media.some((m) => m.audioInCard || m.imageInCard)) {
                        const anchorEntry = anchor ? ghostCards?.byCallId.get(anchor) : undefined;
                        const cardHtml = sameGhostTarget && anchorEntry?.status === 'ready' ? anchorEntry.html : '';
                        media = media.filter((m) => !(m.kind === 'audio' &&
                            m.audioInCard &&
                            cardHtml.includes(`data-ghost-audio="${m.url}"`)) &&
                            !(m.kind === 'image' && m.imageInCard && cardHtml.includes(m.url)));
                        if (media.length === 0)
                            return;
                    }
                    if (sameGhostTarget) {
                        const seen = new Set((sameGhostTarget.media ?? []).map((x) => x.url));
                        const fresh = media.filter((x) => !seen.has(x.url));
                        if (fresh.length > 0)
                            sameGhostTarget.media = [...(sameGhostTarget.media ?? []), ...fresh];
                        return;
                    }
                }
                pendingSegmentMedia.push(...media);
            };
            const mainResult = typeof msg.toolUseId === 'string' && msg.toolUseId.length > 0
                ? resultByToolUseId.get(msg.toolUseId)
                : undefined;
            maybeQueueGhostCard(mainResult);
            if (!hideRowForCard) {
                if (pendingToolCalls.length > 0) {
                    const currentCallMs = messageTs(msg);
                    if (pendingSegmentEndMs !== null &&
                        currentCallMs !== null &&
                        currentCallMs - pendingSegmentEndMs > HISTORY_GAP_SPLIT_MS) {
                        flushSegment();
                    }
                }
                pendingToolCalls.push(msg);
                notePendingSegmentEnd(messageTs(msg));
                if (mainResult !== undefined) {
                    pendingSettledIds.add(msg.clientId);
                    const resultTs = typeof msg.toolUseId === 'string' ? resultTsByToolUseId.get(msg.toolUseId) : undefined;
                    if (resultTs !== undefined) {
                        pendingResultTsMap.set(msg.clientId, resultTs);
                        notePendingSegmentEnd(resultTs);
                    }
                }
                if (mainResult !== undefined && !shouldHideToolResult(toolName, mainResult)) {
                    pendingResultMap.set(msg.clientId, mainResult);
                    if (!suppressMediaForCard) {
                        collectResultMedia(mainResult);
                    }
                }
            }
            let j = i + 1;
            while (j < messages.length && messages[j].role === 'tool_result') {
                if (!hideRowForCard) {
                    pendingSettledIds.add(msg.clientId);
                    const adjacencyTs = Date.parse(messages[j].createdAt ?? '');
                    if (Number.isFinite(adjacencyTs)) {
                        notePendingSegmentEnd(adjacencyTs);
                        const known = pendingResultTsMap.get(msg.clientId);
                        if (known === undefined || adjacencyTs > known) {
                            pendingResultTsMap.set(msg.clientId, adjacencyTs);
                        }
                    }
                    const result = messages[j].content;
                    if (!pendingResultMap.has(msg.clientId) && !shouldHideToolResult(toolName, result)) {
                        pendingResultMap.set(msg.clientId, result);
                        if (!suppressMediaForCard) {
                            collectResultMedia(result);
                        }
                    }
                }
                j++;
            }
            i = j;
        }
        else if (msg.role === 'tool_result') {
            i++;
        }
        else if (msg.role === 'assistant' && !msg.systemCardType && msg.content.trim().length === 0) {
            i++;
        }
        else {
            flushSegment();
            items.push({ type: 'message', key: `msg-${msg.clientId}`, message: msg });
            i++;
        }
    }
    flushSegment();
    flushTurnChanges(turnStartIdx, messages.length);
    if (taskUpdates) {
        const historyWindowIncomplete = opts?.historyWindowIncomplete === true;
        const parentBashToolUseIds = new Set();
        for (const m of messages) {
            if (m.role === 'tool_use' &&
                m.toolName === 'Bash' &&
                typeof m.toolUseId === 'string' &&
                m.toolUseId.length > 0) {
                parentBashToolUseIds.add(m.toolUseId);
            }
        }
        const seenTaskIds = new Set();
        for (const update of taskUpdates.values()) {
            if (update.taskType === 'local_bash' &&
                !historyWindowIncomplete &&
                !(update.parentToolUseId && parentBashToolUseIds.has(update.parentToolUseId))) {
                continue;
            }
            const primaryKey = update.parentToolUseId ?? update.taskId;
            if (seenTaskIds.has(update.taskId) ||
                renderedTaskKeys.has(primaryKey) ||
                renderedTaskKeys.has(update.taskId)) {
                continue;
            }
            seenTaskIds.add(update.taskId);
            const item = {
                type: 'agent_task',
                key: `task-update-${primaryKey}`,
                update,
            };
            const itemMs = renderItemStartMs(item);
            if (itemMs === null) {
                items.push(item);
                continue;
            }
            const insertAt = items.findIndex((candidate) => {
                const candidateMs = renderItemStartMs(candidate);
                return candidateMs !== null && candidateMs > itemMs;
            });
            if (insertAt < 0)
                items.push(item);
            else
                items.splice(insertAt, 0, item);
        }
    }
    return { items, singleResultMap };
}
export const recentRenderProjections = [];
export let renderProjectionOwner = getDataOwnerGeneration();
export function buildCachedRenderItems(...args) {
    const [messages, taskUpdates, ghostCards, opts] = args;
    const owner = getDataOwnerGeneration();
    if (owner !== renderProjectionOwner) {
        recentRenderProjections.length = 0;
        renderProjectionOwner = owner;
    }
    const dependencies = [
        messages,
        taskUpdates,
        ghostCards?.byCallId,
        opts?.historyWindowIncomplete,
        opts?.turnChangeSets,
    ];
    const index = recentRenderProjections.findIndex((entry) => entry.dependencies.every((value, i) => Object.is(value, dependencies[i])));
    if (index >= 0) {
        const entry = recentRenderProjections[index];
        return entry.projection;
    }
    const projection = buildRenderItems(...args);
    const characters = messages.reduce((sum, message) => sum + message.content.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, "x").length, 0);
    const maxCharacters = 32 * 1024 * 1024;
    if (characters <= maxCharacters) {
        const old = recentRenderProjections.findIndex((entry) => entry.dependencies[0] === messages);
        if (old >= 0)
            recentRenderProjections.splice(old, 1);
        recentRenderProjections.push({ dependencies, projection, characters });
        while (recentRenderProjections.length > 3 ||
            recentRenderProjections.reduce((sum, entry) => sum + entry.characters, 0) > maxCharacters) {
            recentRenderProjections.shift();
        }
    }
    return projection;
}
