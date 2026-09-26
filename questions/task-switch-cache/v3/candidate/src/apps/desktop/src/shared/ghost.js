export const GHOST_CALL_TOOL_NAMES = [
    'mcp__cindy__ghost_call',
    'mcp__cindy_ghosts__ghost_call',
    'mcp:cindy:ghost_call',
    'mcp:cindy_ghosts:ghost_call',
];
export function isGhostCallToolName(name) {
    return typeof name === 'string' && GHOST_CALL_TOOL_NAMES.includes(name);
}
