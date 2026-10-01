import { parseMessageToolUse as parseMessageToolUse } from "./messageNormalize.js";
import { commandIntentFromCommand as commandIntentFromCommand } from "./commandIntent.js";
import { normalizeDisplayCommand as normalizeDisplayCommand } from "./commandDisplay.js";
import { commandIntentFromActions as commandIntentFromActions } from "./commandIntent.js";
import { basenameRemotePath as basenameRemotePath } from "./filePreview.js";
export function parseToolName(toolName) {
    if (toolName.startsWith('mcp__')) {
        const segments = toolName.slice('mcp__'.length).split('__');
        if (segments.length >= 2 && segments[0]) {
            const tool = segments.slice(1).join('__');
            if (tool)
                return { kind: 'mcp', server: segments[0], tool };
        }
        return { kind: 'plain', name: toolName };
    }
    if (toolName.startsWith('mcp:')) {
        const segments = toolName.split(':');
        if (segments.length >= 3 && segments[1]) {
            const tool = segments.slice(2).join(':');
            if (tool)
                return { kind: 'mcp', server: segments[1], tool };
        }
        return { kind: 'plain', name: toolName };
    }
    if (toolName.startsWith('dynamic:')) {
        const segments = toolName.split(':');
        if (segments.length >= 3 && segments[1] && segments.slice(2).join(':')) {
            return { kind: 'dynamic', namespace: segments[1], tool: segments.slice(2).join(':') };
        }
        if (segments.length === 2 && segments[1]) {
            return { kind: 'dynamic', tool: segments[1] };
        }
        return { kind: 'plain', name: toolName };
    }
    if (toolName.startsWith('collab:')) {
        const tool = toolName.slice('collab:'.length);
        if (tool)
            return { kind: 'collab', tool };
        return { kind: 'plain', name: toolName };
    }
    return { kind: 'plain', name: toolName };
}
export function humanizeToolToken(token) {
    return token.replace(/_+/g, ' ').replace(/\s+/g, ' ').trim();
}
export function truncateToolText(text, max) {
    const normalized = text.trim();
    if (normalized.length <= max)
        return normalized;
    return `${normalized.slice(0, Math.max(0, max - 3)).trimEnd()}...`;
}
export const DETAIL_KEYS = ['description', 'url', 'query', 'path', 'file_path', 'title', 'name', 'prompt'];
export const DETAIL_MAX_CHARS = 80;
export function describeToolUse(toolName, input) {
    ({ toolName, input } = parseMessageToolUse({ role: 'tool_use', content: { toolName, input } }));
    const inp = readRecord(input);
    const parsed = parseToolName(toolName);
    if (parsed.kind === 'mcp') {
        const createdPath = mcpOutputPath(inp);
        const sourceCandidates = createdPath ? mcpSourceCandidates(inp, createdPath) : [];
        return {
            kind: 'mcp',
            toolName,
            server: parsed.server,
            tool: parsed.tool,
            serverLabel: parsed.server,
            toolLabel: humanizeToolToken(parsed.tool),
            ...withDetail(inp),
            ...(createdPath ? { createdPath } : {}),
            ...(sourceCandidates.length > 0 ? { sourceCandidates } : {}),
        };
    }
    if (parsed.kind === 'dynamic') {
        return {
            kind: 'dynamic',
            toolName,
            ...(parsed.namespace ? { namespace: parsed.namespace } : {}),
            tool: parsed.tool,
            toolLabel: humanizeToolToken(parsed.tool),
            ...withDetail(inp),
        };
    }
    if (parsed.kind === 'collab') {
        return {
            kind: 'collab',
            toolName,
            tool: parsed.tool,
            toolLabel: humanizeToolToken(parsed.tool),
            ...withDetail(inp),
        };
    }
    switch (toolName) {
        case 'Bash':
        case 'bash': {
            const description = readNonEmptyString(inp?.description);
            const command = readNonEmptyString(inp?.command) ?? '';
            const intent = description ? undefined : commandIntentFromCommand(command);
            return {
                kind: 'command',
                toolName,
                ...(description ? { description } : {}),
                command,
                ...withCwd(inp),
                ...(intent ? { intent } : {}),
            };
        }
        case 'exec': {
            const rawCommand = readNonEmptyString(inp?.command) ?? '';
            const command = readNonEmptyString(inp?.displayCommand)
                ?? normalizeDisplayCommand(rawCommand)
                ?? rawCommand;
            const intent = commandIntentFromActions(inp?.commandActions, command) ?? commandIntentFromCommand(command);
            return { kind: 'command', toolName, command, ...withCwd(inp), ...(intent ? { intent } : {}) };
        }
        case 'file_change':
            return fileChangeDescriptor(toolName, inp);
        case 'Read':
        case 'read':
        case 'ls':
            return fileDescriptor(toolName, 'read', inp);
        case 'Edit':
        case 'MultiEdit':
        case 'edit':
            return fileDescriptor(toolName, 'edit', inp);
        case 'Write':
        case 'write':
            return fileDescriptor(toolName, 'create', inp);
        case 'Grep':
        case 'Glob':
        case 'grep':
        case 'find': {
            const pattern = readNonEmptyString(inp?.pattern);
            if (!pattern)
                return genericDescriptor(toolName, inp);
            const path = readNonEmptyString(inp?.path);
            const glob = readNonEmptyString(inp?.glob);
            return {
                kind: 'search',
                toolName,
                mode: toolName === 'Grep' || toolName === 'grep' ? 'grep' : 'glob',
                pattern,
                ...(path ? { path } : {}),
                ...(glob ? { glob } : {}),
            };
        }
        case 'WebFetch': {
            const url = readNonEmptyString(inp?.url);
            if (!url)
                return genericDescriptor(toolName, inp);
            return { kind: 'web', toolName, mode: 'fetch', target: url };
        }
        case 'WebSearch':
        case 'web_search': {
            const query = readNonEmptyString(inp?.query);
            if (!query)
                return genericDescriptor(toolName, inp);
            return { kind: 'web', toolName, mode: 'search', target: query };
        }
        case 'TodoWrite':
        case 'update_plan':
            return { kind: 'todo', toolName };
        case 'Task':
        case 'Agent': {
            const description = readNonEmptyString(inp?.description);
            const subagentType = readNonEmptyString(inp?.subagent_type);
            return {
                kind: 'task',
                toolName,
                ...(description ? { description } : {}),
                ...(subagentType ? { subagentType } : {}),
            };
        }
        default:
            return genericDescriptor(toolName, inp);
    }
}
export function fileDescriptor(toolName, action, inp) {
    const filePath = readNonEmptyString(inp?.file_path) ?? readNonEmptyString(inp?.path);
    if (!filePath)
        return genericDescriptor(toolName, inp);
    return {
        kind: 'file',
        toolName,
        action,
        filePath,
        fileName: basenameRemotePath(filePath) || filePath,
    };
}
export function fileChangeDescriptor(toolName, inp) {
    if (!Array.isArray(inp?.changes) || inp.changes.length === 0) {
        return genericDescriptor(toolName, inp);
    }
    const changes = [];
    for (const rawChange of inp.changes) {
        const change = readRecord(rawChange);
        const kind = readRecord(change?.kind);
        const path = readNonEmptyString(change?.path);
        const kindType = readNonEmptyString(kind?.type);
        if (!change || !kind || !path || !kindType || typeof change.diff !== 'string') {
            return genericDescriptor(toolName, inp);
        }
        const movePath = readNonEmptyString(kind.move_path)
            ?? readNonEmptyString(kind.movePath)
            ?? readNonEmptyString(change.move_path)
            ?? readNonEmptyString(change.movePath);
        const action = movePath
            ? 'move'
            : kindType === 'add' || kindType === 'delete' || kindType === 'update'
                ? kindType
                : 'unknown';
        changes.push({
            action,
            path,
            fileName: basenameRemotePath(path) || path,
            ...(movePath
                ? {
                    movePath,
                    moveFileName: basenameRemotePath(movePath) || movePath,
                }
                : {}),
            diff: change.diff,
        });
    }
    return { kind: 'fileChange', toolName, changes };
}
export function genericDescriptor(toolName, inp) {
    return { kind: 'generic', toolName, ...withDetail(inp) };
}
export function withDetail(inp) {
    const detail = extractDetail(inp);
    return detail ? { detail } : {};
}
export function withCwd(inp) {
    const cwd = readNonEmptyString(inp?.cwd);
    return cwd ? { cwd } : {};
}
export const MCP_OUTPUT_PATH_KEYS = ['outPath', 'out_path', 'outputPath', 'output_path'];
export function mcpOutputPath(inp) {
    if (!inp)
        return undefined;
    for (const key of MCP_OUTPUT_PATH_KEYS) {
        const value = readNonEmptyString(inp[key]);
        if (value)
            return value;
    }
    return undefined;
}
export const MCP_SOURCE_CANDIDATE_MAX_CHARS = 512;
export function mcpSourceCandidates(inp, createdPath) {
    if (!inp)
        return [];
    const out = [];
    for (const value of Object.values(inp)) {
        const text = readNonEmptyString(value);
        if (!text || text === createdPath)
            continue;
        if (text.length > MCP_SOURCE_CANDIDATE_MAX_CHARS)
            continue;
        out.push(text);
    }
    return out;
}
export function extractDetail(inp) {
    if (!inp)
        return undefined;
    for (const key of DETAIL_KEYS) {
        const value = readNonEmptyString(inp[key]);
        if (value)
            return truncateToolText(value, DETAIL_MAX_CHARS);
    }
    return undefined;
}
export function sourcePathCandidatesFromDescriptor(descriptor) {
    return descriptor.kind === 'mcp' ? (descriptor.sourceCandidates ?? []) : [];
}
export function createdPathsFromDescriptor(descriptor) {
    if (descriptor.kind === 'file') {
        return descriptor.action === 'create' && descriptor.filePath ? [descriptor.filePath] : [];
    }
    if (descriptor.kind === 'fileChange') {
        return descriptor.changes
            .filter((change) => change.action === 'add' && change.path)
            .map((change) => change.path);
    }
    if (descriptor.kind === 'mcp') {
        return descriptor.createdPath ? [descriptor.createdPath] : [];
    }
    return [];
}
export function readRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
export function readNonEmptyString(value) {
    if (typeof value !== 'string')
        return undefined;
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
}
