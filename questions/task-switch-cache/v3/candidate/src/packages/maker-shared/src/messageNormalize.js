export function parseMessageToolUse(message) {
    const content = readRecord(message.content);
    const toolUseId = readNonEmptyString(message.toolUseId) ?? readNonEmptyString(content?.toolUseId);
    let toolName = readNonEmptyString(content?.toolName) ?? '';
    let input = content?.input ?? null;
    if (toolName === 'cindy_mcp_call_tool') {
        const gateway = readRecord(input);
        const server = readNonEmptyString(gateway?.server);
        const tool = readNonEmptyString(gateway?.tool);
        const args = gateway?.args;
        if (server && tool && (args === undefined || readRecord(args))) {
            toolName = `mcp:${server}:${tool}`;
            input = args ?? {};
        }
    }
    return {
        toolUseId: toolUseId ?? undefined,
        toolName,
        input,
    };
}
export function readRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
export function readNonEmptyString(value) {
    return typeof value === 'string' && value.length > 0 ? value : null;
}
