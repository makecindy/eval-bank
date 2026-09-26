export function isCompletedAssistantMessage(message) {
    return (message.turnCompleted === true ||
        (message.turnMoney?.amount ?? 0) > 0 ||
        (typeof message.turnCostUsd === 'number' && message.turnCostUsd > 0) ||
        message.turnUsageDetails !== undefined);
}
export function renderItemStartMs(item) {
    if (item.type === 'message') {
        const ms = Date.parse(item.message.createdAt ?? '');
        return Number.isFinite(ms) ? ms : null;
    }
    if (item.type === 'tool_segment') {
        const ms = Date.parse(item.toolCalls[0]?.createdAt ?? '');
        return Number.isFinite(ms) ? ms : null;
    }
    if (item.type === 'agent_task') {
        const ms = Date.parse(item.toolCall?.createdAt ?? item.update?.createdAt ?? '');
        return Number.isFinite(ms) ? ms : null;
    }
    if (item.type === 'agent_plan') {
        const ms = Date.parse(item.createdAt ?? '');
        return Number.isFinite(ms) ? ms : null;
    }
    if (item.type === 'ghost_card') {
        const ms = Date.parse(item.toolCall.createdAt ?? '');
        return Number.isFinite(ms) ? ms : null;
    }
    if (item.type === 'work_group') {
        for (const child of item.children) {
            const childMs = renderItemStartMs(child);
            if (childMs !== null)
                return childMs;
        }
    }
    return null;
}
export function messageTs(msg) {
    if (!msg.createdAt)
        return null;
    const t = new Date(msg.createdAt).getTime();
    return Number.isFinite(t) ? t : null;
}
