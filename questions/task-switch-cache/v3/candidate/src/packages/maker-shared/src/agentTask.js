export function isSubagentSpawnToolName(toolName) {
    return toolName === 'Agent'
        || toolName === 'Task'
        || toolName === PI_SUBAGENT_TOOL_NAME
        || toolName === 'collab:spawn'
        || toolName === 'collab:spawnAgent';
}
export function isAgentTaskToolName(toolName) {
    return isSubagentSpawnToolName(toolName) || toolName.startsWith('collab:');
}
export const PI_SUBAGENT_TOOL_NAME = 'subagent';
