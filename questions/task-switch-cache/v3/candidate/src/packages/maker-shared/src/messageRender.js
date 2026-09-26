export const TASK_PLAN_TOOL_NAMES = new Set(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet']);
export function isSyntheticUserRow(message) {
    if (isHookUserRow(message))
        return false;
    const meta = message.agentMeta;
    return (message.isSyntheticTrigger === true ||
        (message.automationOrigin !== undefined && message.automationOrigin !== null) ||
        meta?.autoResume === true ||
        (meta?.origin !== undefined && meta?.origin !== null) ||
        isSteerUserRow(message) ||
        hasSubagentParent(message));
}
export function isPlanUserBoundary(message) {
    return message.role === 'user' && !isSyntheticUserRow(message);
}
export function isHookUserRow(message) {
    const hookSource = message.hookSource ??
        message.agentMeta?.hookSource;
    return hookSource !== undefined && hookSource !== null;
}
export function hasSubagentParent(message) {
    const explicit = message.parentToolUseId ??
        message.agentMeta?.parentToolUseId ??
        message.agentMeta?.parent_tool_use_id;
    if (typeof explicit === 'string' && explicit.trim().length > 0) {
        return isSubagentParentId(explicit) || !looksLikeLegacyTranscriptUuid(explicit);
    }
    const nested = message.source;
    for (const candidate of [message.agentMeta?.parentUuid, nested?.agentMeta?.parentUuid]) {
        if (typeof candidate === 'string' && isSubagentParentId(candidate))
            return true;
    }
    return false;
}
export const SUBAGENT_PARENT_ID_RE = /^(?:toolu|call)[_-]/iu;
export const COMPAT_TOOL_USE_ID_RE = /^[A-Za-z][A-Za-z0-9_-]*_x*\d+(?:_dup\d+)?$/u;
export function isSubagentParentToolUseId(value) {
    return isSubagentParentId(value);
}
export function isSubagentParentId(value) {
    const trimmed = value.trim();
    return SUBAGENT_PARENT_ID_RE.test(trimmed) || COMPAT_TOOL_USE_ID_RE.test(trimmed);
}
export function looksLikeLegacyTranscriptUuid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu.test(value.trim());
}
export function findMessageTodoInsertions(messages, options = {}) {
    const keyPrefix = options.keyPrefix ?? 'todo';
    const resultByToolUseId = buildToolResultLookup(messages);
    const sessions = [];
    const lastSessionBySource = new Map();
    const taskState = new Map();
    let lastUserIndex = -1;
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (message.role === 'user') {
            if (isPlanUserBoundary(message))
                lastUserIndex = index;
            continue;
        }
        const source = agentPlanSource(toolNameOf(message));
        if (!source)
            continue;
        if (hasSubagentParent(message))
            continue;
        const resultText = resultByToolUseId.get(toolUseIdOf(message) ?? '');
        const previous = lastSessionBySource.get(source);
        const previousAllDone = previous?.todos.every((todo) => todo.status === 'completed');
        const continuesCompletedTaskSession = source === 'task'
            && Boolean(previousAllDone)
            && taskToolTargetsExistingTask(message, resultText, taskState);
        const previousSealed = Boolean(previous) && planRowSealOf(messages[previous.lastIndex]).sealed;
        const crossesUserBoundary = Boolean(previous)
            && lastUserIndex > (previous?.userBoundaryIndex ?? -1)
            && !(source === 'task' && taskToolTargetsExistingTask(message, resultText, taskState));
        const startsNewSession = !previous
            || previousSealed
            || crossesUserBoundary
            || (Boolean(previousAllDone) && !continuesCompletedTaskSession);
        if (source === 'task' && startsNewSession) {
            taskState.clear();
        }
        const parsed = extractPlanTodos(toolNameOf(message), toolInputOf(message))
            ?? applyTaskPlanTool(taskState, message, resultText);
        if (!parsed)
            continue;
        if (!startsNewSession && previous) {
            previous.todos = parsed;
            previous.sourceClientIds.push(sourceClientId(message));
            previous.lastIndex = index;
        }
        else {
            const session = {
                todos: parsed,
                sourceClientIds: [sourceClientId(message)],
                firstIndex: index,
                lastIndex: index,
                source,
                userBoundaryIndex: lastUserIndex,
            };
            sessions.push(session);
            lastSessionBySource.set(source, session);
        }
    }
    const out = new Map();
    for (const session of sessions) {
        const first = messages[session.firstIndex];
        const lastRow = messages[session.lastIndex];
        const seal = planRowSealOf(lastRow);
        out.set(session.lastIndex, {
            key: `${keyPrefix}-${sourceClientId(first)}`,
            todos: session.todos,
            sourceClientIds: session.sourceClientIds,
            createdAt: lastRow?.createdAt,
            updatedAtMs: lastRow?.planUpdatedAtMs,
            source: session.source,
            ...(seal.sealed
                ? {
                    sealed: true,
                    ...(typeof seal.sealedAtMs === 'number' ? { sealedAtMs: seal.sealedAtMs } : {}),
                }
                : {}),
            ...(planRowTurnFailed(lastRow) ? { turnFailed: true } : {}),
        });
    }
    return out;
}
export function getLatestMessageTodoState(messages, options = {}) {
    let latestPlanIndex = -1;
    let latestPlanMessage = null;
    for (let index = 0; index < messages.length; index++) {
        const message = messages[index];
        if (!isAgentPlanToolName(toolNameOf(message)))
            continue;
        if (hasSubagentParent(message))
            continue;
        latestPlanIndex = index;
        latestPlanMessage = message;
    }
    let latest = null;
    let latestIndex = -1;
    for (const [index, insertion] of findMessageTodoInsertions(messages, options)) {
        if (index > latestIndex) {
            latestIndex = index;
            latest = insertion;
        }
    }
    const hasPlanEvent = latestPlanIndex >= 0;
    const latestTaskWindowResolved = latestPlanMessage === null ||
        agentPlanSource(toolNameOf(latestPlanMessage)) !== 'task' ||
        isTaskPlanWindowResolved(messages, latestPlanIndex, options.taskHistoryMayBeIncomplete === true);
    const insertionBelongsToLatestEvent = latestIndex === latestPlanIndex && latestTaskWindowResolved;
    const latestEventClearsPlan = latestPlanMessage !== null &&
        (isExplicitPlanClearEvent(latestPlanMessage) ||
            latestTaskEventClearsPlan(messages, latestPlanIndex));
    return {
        insertion: insertionBelongsToLatestEvent ? latest : null,
        hasPlanEvent,
        isResolved: !hasPlanEvent ||
            insertionBelongsToLatestEvent ||
            (latestTaskWindowResolved && latestEventClearsPlan),
        latestPlanIndex,
        latestInsertionIndex: latestIndex,
    };
}
export function isSteerUserRow(message) {
    return message.delivery === 'steer' || message.agentMeta?.delivery === 'steer';
}
export function isAgentPlanToolName(toolName) {
    return toolName === 'TodoWrite' || toolName === 'update_plan' || Boolean(toolName && TASK_PLAN_TOOL_NAMES.has(toolName));
}
export function extractPlanTodos(toolName, toolInput) {
    if (toolName === 'TodoWrite')
        return extractTodos(toolInput);
    if (toolName !== 'update_plan')
        return null;
    const input = readRecord(toolInput);
    const structured = extractStructuredPlanItems(input?.items) ?? extractStructuredPlanItems(input?.plan);
    if (structured)
        return structured;
    const text = typeof input?.text === 'string' ? input.text : '';
    if (!text.trim())
        return null;
    const items = text
        .split(/\r?\n/)
        .map(normalizePlanLine)
        .filter(Boolean);
    if (items.length === 0)
        return null;
    return items.map((content, index) => ({
        content,
        status: index === 0 ? 'in_progress' : 'pending',
    }));
}
export function extractTodos(toolInput) {
    const input = readRecord(toolInput);
    const todos = input?.todos;
    if (!Array.isArray(todos) || todos.length === 0)
        return null;
    const out = todos
        .map((item) => {
        const record = readRecord(item);
        if (!record)
            return null;
        return {
            content: typeof record.content === 'string' ? record.content : String(record.content ?? ''),
            status: normalizeTodoStatus(record.status) ?? 'pending',
            activeForm: typeof record.activeForm === 'string' ? record.activeForm : undefined,
        };
    })
        .filter((item) => item !== null);
    return out.length > 0 ? out : null;
}
export function isExplicitPlanClearEvent(message) {
    const toolName = toolNameOf(message);
    const input = readRecord(toolInputOf(message));
    if (toolName === 'TodoWrite')
        return Array.isArray(input?.todos) && input.todos.length === 0;
    if (toolName === 'update_plan') {
        return ((Array.isArray(input?.items) && input.items.length === 0) ||
            (Array.isArray(input?.plan) && input.plan.length === 0) ||
            (typeof input?.text === 'string' && input.text.trim().length === 0) ||
            (input !== null && Object.keys(input).length === 0));
    }
    return false;
}
export function latestTaskEventClearsPlan(messages, latestPlanIndex) {
    const latest = messages[latestPlanIndex];
    const latestToolName = toolNameOf(latest);
    const resultByToolUseId = buildToolResultLookup(messages);
    const latestResultText = resultByToolUseId.get(toolUseIdOf(latest) ?? '');
    if (latestToolName === 'TaskList')
        return taskListResultClearsPlan(latestResultText);
    if (latestToolName !== 'TaskUpdate' && latestToolName !== 'TaskGet')
        return false;
    if (taskToolStatus(latest, latestResultText) !== 'deleted')
        return false;
    const taskState = new Map();
    let previousTaskTodos = null;
    let resolvedTaskContext = false;
    for (let index = 0; index <= latestPlanIndex; index += 1) {
        const message = messages[index];
        if (agentPlanSource(toolNameOf(message)) !== 'task')
            continue;
        const resultText = resultByToolUseId.get(toolUseIdOf(message) ?? '');
        const startsNewSession = previousTaskTodos === null ||
            (previousTaskTodos.every((todo) => todo.status === 'completed') &&
                !taskToolTargetsExistingTask(message, resultText, taskState));
        if (startsNewSession)
            taskState.clear();
        const hadTaskContext = taskState.size > 0;
        const parsed = applyTaskPlanTool(taskState, message, resultText);
        if (parsed) {
            resolvedTaskContext = true;
            previousTaskTodos = parsed;
            continue;
        }
        if (index === latestPlanIndex) {
            return resolvedTaskContext && hadTaskContext && taskState.size === 0;
        }
    }
    return false;
}
export function isTaskPlanWindowResolved(messages, latestPlanIndex, hasEarlierMessages) {
    const resultByToolUseId = buildToolResultLookup(messages);
    const taskState = new Map();
    const unresolvedTaskStatuses = new Map();
    let previousTaskTodos = null;
    let sawTaskEvent = false;
    let currentSessionBoundaryKnown = !hasEarlierMessages;
    let lastUserBoundaryIndex = -1;
    let currentSessionUserBoundaryIndex = -1;
    for (let index = 0; index <= latestPlanIndex; index += 1) {
        const message = messages[index];
        if (isPlanUserBoundary(message)) {
            lastUserBoundaryIndex = index;
            continue;
        }
        if (agentPlanSource(toolNameOf(message)) !== 'task')
            continue;
        const toolName = toolNameOf(message);
        const resultText = resultByToolUseId.get(toolUseIdOf(message) ?? '');
        const resultTasks = taskRecordsFromResult(resultText);
        const input = readRecord(toolInputOf(message)) ?? {};
        const targetTaskId = taskId(input) ?? taskId(resultTasks[0]);
        const hasPreviousTaskContext = previousTaskTodos !== null || unresolvedTaskStatuses.size > 0;
        const previousAllDone = hasPreviousTaskContext &&
            (previousTaskTodos?.every((todo) => todo.status === 'completed') ?? true) &&
            [...unresolvedTaskStatuses.values()].every((status) => status === 'completed' || status === 'deleted');
        const targetsExistingTask = taskToolTargetsExistingTask(message, resultText, taskState);
        const continuesCompletedTaskSession = previousAllDone &&
            (targetsExistingTask ||
                Boolean(targetTaskId && unresolvedTaskStatuses.has(targetTaskId)));
        const crossesUserBoundary = sawTaskEvent &&
            lastUserBoundaryIndex > currentSessionUserBoundaryIndex &&
            !targetsExistingTask;
        const startsNewSession = !sawTaskEvent ||
            crossesUserBoundary ||
            (previousAllDone && !continuesCompletedTaskSession);
        if (startsNewSession) {
            const startsAfterCompletedSession = sawTaskEvent && previousAllDone && !continuesCompletedTaskSession;
            const startsWithTaskCreateAfterVisibleUser = toolName === 'TaskCreate' &&
                lastUserBoundaryIndex >= 0 &&
                (!sawTaskEvent || crossesUserBoundary);
            taskState.clear();
            unresolvedTaskStatuses.clear();
            previousTaskTodos = null;
            currentSessionBoundaryKnown =
                !hasEarlierMessages ||
                    startsAfterCompletedSession ||
                    startsWithTaskCreateAfterVisibleUser;
            currentSessionUserBoundaryIndex = lastUserBoundaryIndex;
        }
        sawTaskEvent = true;
        if (toolName === 'TaskList') {
            if (taskListResultIsAuthoritative(resultText)) {
                currentSessionBoundaryKnown = true;
            }
            if (resultTasks.length > 0) {
                const previousTaskState = new Map(taskState);
                unresolvedTaskStatuses.clear();
                for (const task of resultTasks) {
                    const id = taskId(task);
                    const status = normalizeTaskStatus(task.status) ?? 'pending';
                    if (!id || status === 'deleted')
                        continue;
                    if (!taskContent(task) && !previousTaskState.has(id)) {
                        unresolvedTaskStatuses.set(id, status);
                    }
                }
            }
            else if (taskListResultClearsPlan(resultText)) {
                unresolvedTaskStatuses.clear();
            }
        }
        else if (toolName !== 'TaskCreate') {
            const resultTask = resultTasks[0];
            const id = taskId(input) ?? taskId(resultTask);
            if (id && !taskState.has(id)) {
                unresolvedTaskStatuses.set(id, taskToolStatus(message, resultText) ?? 'pending');
            }
        }
        const parsed = applyTaskPlanTool(taskState, message, resultText);
        for (const id of taskState.keys())
            unresolvedTaskStatuses.delete(id);
        previousTaskTodos = parsed ?? currentTaskTodos(taskState);
        if (previousTaskTodos === null &&
            unresolvedTaskStatuses.size === 0 &&
            taskState.size === 0) {
            previousTaskTodos = [];
        }
    }
    return currentSessionBoundaryKnown && unresolvedTaskStatuses.size === 0;
}
export function buildToolResultLookup(messages) {
    const out = new Map();
    for (const message of messages) {
        const toolUseId = toolUseIdOf(message);
        if (!toolUseId || !isToolResultSource(message))
            continue;
        const result = toolResultTextOf(message);
        if (result !== undefined)
            out.set(toolUseId, result);
    }
    return out;
}
export function agentPlanSource(toolName) {
    if (toolName === 'TodoWrite')
        return 'todo';
    if (toolName === 'update_plan')
        return 'codex';
    if (toolName && TASK_PLAN_TOOL_NAMES.has(toolName))
        return 'task';
    return null;
}
export function normalizeTodoStatus(value) {
    if (value === 'pending' || value === 'completed')
        return value;
    if (value === 'in_progress' || value === 'inProgress' || value === 'running')
        return 'in_progress';
    return null;
}
export function normalizeTaskStatus(status) {
    if (status === 'pending' || status === 'in_progress' || status === 'completed')
        return status;
    if (status === 'running' || status === 'inProgress')
        return 'in_progress';
    if (status === 'deleted')
        return 'deleted';
    return null;
}
export function taskToolStatus(message, resultText) {
    const toolName = toolNameOf(message);
    const input = readRecord(toolInputOf(message));
    const resultTask = taskRecordsFromResult(resultText)[0];
    if (toolName === 'TaskGet' && resultTask)
        return normalizeTaskStatus(resultTask.status);
    return normalizeTaskStatus(input?.status ?? resultTask?.status);
}
export function taskToolTargetsExistingTask(message, resultText, taskState) {
    const toolName = toolNameOf(message);
    if (toolName === 'TaskList') {
        return taskRecordsFromResult(resultText).some((task) => {
            const id = taskId(task);
            return Boolean(id && taskState.has(id));
        });
    }
    if (toolName !== 'TaskUpdate' && toolName !== 'TaskGet')
        return false;
    const input = readRecord(toolInputOf(message));
    const resultTask = taskRecordsFromResult(resultText)[0];
    const id = taskId(input ?? undefined) ?? taskId(resultTask);
    return Boolean(id && taskState.has(id));
}
export function extractStructuredPlanItems(items) {
    if (!Array.isArray(items) || items.length === 0)
        return null;
    const todos = items
        .map((item) => {
        const record = readRecord(item);
        if (!record)
            return null;
        const rawContent = record.content ?? record.text ?? record.step ?? record.title;
        const content = typeof rawContent === 'string' ? rawContent.trim() : String(rawContent ?? '').trim();
        if (!content)
            return null;
        return {
            content,
            status: normalizeTodoStatus(record.status) ?? 'pending',
        };
    })
        .filter((item) => item !== null);
    return todos.length > 0 ? todos : null;
}
export function normalizePlanLine(line) {
    return line
        .replace(/^\s*(?:[-*+]|\d+[.)])\s+/, '')
        .replace(/^\s*\[[ xX-]\]\s+/, '')
        .trim();
}
export function applyTaskPlanTool(taskState, message, resultText) {
    const toolName = toolNameOf(message);
    if (!TASK_PLAN_TOOL_NAMES.has(toolName))
        return null;
    const input = readRecord(toolInputOf(message)) ?? {};
    const resultTasks = taskRecordsFromResult(resultText);
    if (toolName === 'TaskList') {
        if (resultTasks.length === 0) {
            if (taskListResultClearsPlan(resultText)) {
                taskState.clear();
                return null;
            }
            return currentTaskTodos(taskState);
        }
        const previousTaskState = new Map(taskState);
        taskState.clear();
        for (const task of resultTasks) {
            const id = taskId(task);
            if (!id)
                continue;
            const status = normalizeTaskStatus(task.status) ?? 'pending';
            if (status === 'deleted')
                continue;
            const content = taskContent(task) ?? previousTaskState.get(id)?.content;
            if (!content)
                continue;
            taskState.set(id, {
                content,
                status,
            });
        }
        return currentTaskTodos(taskState);
    }
    const resultTask = resultTasks[0];
    if (toolName === 'TaskCreate') {
        const id = taskId(resultTask) ?? taskId(input) ?? `task-create:${toolUseIdOf(message) ?? sourceClientId(message)}`;
        const status = normalizeTaskStatus(resultTask?.status);
        const content = taskContent(input) ?? taskContent(resultTask);
        if (!content)
            return currentTaskTodos(taskState);
        taskState.set(id, {
            content,
            status: status && status !== 'deleted' ? status : 'pending',
        });
        return currentTaskTodos(taskState);
    }
    const id = taskId(input) ?? taskId(resultTask);
    if (!id)
        return currentTaskTodos(taskState);
    const existing = taskState.get(id);
    const suppliedContent = taskContent(input) ?? taskContent(resultTask);
    if (!existing && !suppliedContent)
        return null;
    if (toolName === 'TaskGet' && resultTask) {
        const status = normalizeTaskStatus(resultTask.status) ?? taskState.get(id)?.status ?? 'pending';
        if (status === 'deleted') {
            taskState.delete(id);
        }
        else {
            const content = taskContent(resultTask) ?? existing?.content;
            if (!content)
                return currentTaskTodos(taskState);
            taskState.set(id, {
                content,
                status,
            });
        }
        return currentTaskTodos(taskState);
    }
    const status = normalizeTaskStatus(input.status ?? resultTask?.status) ?? existing?.status ?? 'pending';
    if (status === 'deleted') {
        taskState.delete(id);
        return currentTaskTodos(taskState);
    }
    const content = suppliedContent ?? existing?.content;
    if (!content)
        return currentTaskTodos(taskState);
    taskState.set(id, {
        content,
        status,
    });
    return currentTaskTodos(taskState);
}
export function taskListResultClearsPlan(resultText) {
    const parsed = tryParseJsonRecord(resultText);
    if (!parsed || !Array.isArray(parsed.tasks))
        return false;
    return parsed.tasks.every((task) => {
        const record = readRecord(task);
        return Boolean(record && normalizeTaskStatus(record.status) === 'deleted');
    });
}
export function taskListResultIsAuthoritative(resultText) {
    const parsed = tryParseJsonRecord(resultText);
    return Boolean(parsed && Array.isArray(parsed.tasks));
}
export function currentTaskTodos(taskState) {
    const todos = [...taskState.values()].filter((todo) => todo.content.trim().length > 0);
    return todos.length > 0 ? todos : null;
}
export function taskRecordsFromResult(resultText) {
    const parsed = tryParseJsonRecord(resultText);
    if (!parsed)
        return taskRecordsFromPlainResult(resultText);
    const rawTasks = parsed.tasks;
    if (Array.isArray(rawTasks)) {
        return rawTasks.filter((task) => Boolean(task && typeof task === 'object' && !Array.isArray(task)));
    }
    const rawTask = parsed.task;
    if (rawTask && typeof rawTask === 'object' && !Array.isArray(rawTask)) {
        return [rawTask];
    }
    if (taskId(parsed) || taskContent(parsed))
        return [parsed];
    return taskRecordsFromPlainResult(resultText);
}
export function taskRecordsFromPlainResult(resultText) {
    if (!resultText?.trim())
        return [];
    const tasks = [];
    for (const rawLine of resultText.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line)
            continue;
        const created = parsePlainTaskCreatedLine(line);
        if (created) {
            tasks.push(created);
            continue;
        }
        const snapshot = parsePlainTaskSnapshotLine(line);
        if (snapshot) {
            tasks.push(snapshot);
        }
    }
    return tasks;
}
export function parsePlainTaskCreatedLine(line) {
    if (!line.toLowerCase().startsWith('task'))
        return null;
    if (!isWhitespaceCode(line.charCodeAt('task'.length)))
        return null;
    const afterTask = line.slice('task'.length).trimStart();
    if (!afterTask.startsWith('#'))
        return null;
    const afterHash = afterTask.slice(1);
    const idEnd = firstWhitespaceIndex(afterHash);
    if (idEnd <= 0)
        return null;
    const id = afterHash.slice(0, idEnd);
    const rest = afterHash.slice(idEnd).trimStart();
    const marker = 'created successfully:';
    if (!rest.toLowerCase().startsWith(marker))
        return null;
    const subject = rest.slice(marker.length).trim();
    return subject ? { id, status: 'pending', subject } : null;
}
export function parsePlainTaskSnapshotLine(line) {
    if (!line.startsWith('#'))
        return null;
    const afterHash = line.slice(1);
    const idEnd = firstWhitespaceIndex(afterHash);
    if (idEnd <= 0)
        return null;
    const id = afterHash.slice(0, idEnd);
    const rest = afterHash.slice(idEnd).trimStart();
    if (!rest.startsWith('['))
        return null;
    const statusEnd = rest.indexOf(']');
    if (statusEnd <= 1)
        return null;
    const status = rest.slice(1, statusEnd).trim();
    let subject = rest.slice(statusEnd + 1).trim();
    const trailingMetaStart = subject.lastIndexOf(' [');
    if (trailingMetaStart > 0 && subject.endsWith(']')) {
        subject = subject.slice(0, trailingMetaStart).trim();
    }
    return subject ? { id, status, subject } : null;
}
export function firstWhitespaceIndex(value) {
    for (let index = 0; index < value.length; index++) {
        if (isWhitespaceCode(value.charCodeAt(index))) {
            return index;
        }
    }
    return -1;
}
export function isWhitespaceCode(code) {
    return code === 9 || code === 10 || code === 11 || code === 12 || code === 13 || code === 32;
}
export function firstString(record, keys) {
    if (!record)
        return undefined;
    for (const key of keys) {
        const value = record[key];
        if (typeof value === 'string' && value.trim())
            return value.trim();
    }
    return undefined;
}
export function taskContent(record) {
    return firstString(record, ['subject', 'content', 'description', 'activeForm', 'active_form', 'title', 'text']);
}
export function taskId(record) {
    return firstString(record, ['taskId', 'task_id', 'id']);
}
export function tryParseJsonRecord(text) {
    if (!text)
        return null;
    try {
        const parsed = JSON.parse(text);
        return readRecord(parsed);
    }
    catch {
        return null;
    }
}
export function sourceClientId(message) {
    if (!message)
        return 'unknown';
    return message.clientId || message.id || 'unknown';
}
export function toolNameOf(message) {
    if (typeof message.toolName === 'string')
        return message.toolName;
    const content = readRecord(message.content);
    if (typeof content?.toolName === 'string')
        return content.toolName;
    if (typeof content?.name === 'string')
        return content.name;
    return '';
}
export function toolInputOf(message) {
    if (message.toolInput !== undefined)
        return message.toolInput;
    const content = readRecord(message.content);
    return content?.input;
}
export function planRowSealOf(message) {
    if (!message)
        return { sealed: false };
    const content = readRecord(message.content);
    const sealed = message.terminalPlanSnapshot === true ||
        (message.terminalPlanSnapshot === undefined && content?.terminalPlanSnapshot === true);
    if (!sealed)
        return { sealed: false };
    const sealedAtMs = typeof message.terminalPlanAtMs === 'number'
        ? message.terminalPlanAtMs
        : typeof content?.terminalPlanAtMs === 'number'
            ? content.terminalPlanAtMs
            : undefined;
    return { sealed: true, ...(sealedAtMs !== undefined ? { sealedAtMs } : {}) };
}
export function planRowTurnFailed(message) {
    if (!message)
        return false;
    if (message.turnCompleted === false)
        return true;
    const content = readRecord(message.content);
    return message.turnCompleted === undefined && content?.turnCompleted === false;
}
export function toolUseIdOf(message) {
    if (typeof message.toolUseId === 'string' && message.toolUseId.length > 0)
        return message.toolUseId;
    const content = readRecord(message.content);
    if (typeof content?.toolUseId === 'string' && content.toolUseId.length > 0)
        return content.toolUseId;
    if (typeof content?.id === 'string' && content.id.length > 0)
        return content.id;
    return undefined;
}
export function isToolResultSource(message) {
    if (message.role === 'tool_result')
        return true;
    const content = readRecord(message.content);
    return content?.role === 'tool_result' || content?.type === 'tool_result' || content?.kind === 'tool_result';
}
export function toolResultTextOf(message) {
    if (typeof message.content === 'string')
        return message.content;
    const content = readRecord(message.content);
    if (typeof content?.content === 'string')
        return content.content;
    if (typeof content?.result === 'string')
        return content.result;
    if (typeof content?.text === 'string')
        return content.text;
    return undefined;
}
export function readRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
