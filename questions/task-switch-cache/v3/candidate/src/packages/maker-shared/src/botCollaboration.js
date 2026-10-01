export function placeBotTaskCardsAfterIntroduction(messages, classify) {
    const output = [];
    let turn = [];
    const flush = () => {
        let nextProse = -1;
        const movable = new Set();
        for (let index = turn.length - 1; index >= 0; index -= 1) {
            const kind = classify(turn[index]);
            if (kind === 'prose')
                nextProse = index;
            else if (kind === 'task' && nextProse >= 0)
                movable.add(index);
        }
        const pending = [];
        for (let index = 0; index < turn.length; index += 1) {
            if (movable.has(index))
                pending.push(turn[index]);
            else {
                output.push(turn[index]);
                if (classify(turn[index]) === 'prose')
                    output.push(...pending.splice(0));
            }
        }
        turn = [];
    };
    for (const message of messages) {
        if (classify(message) === 'boundary')
            flush();
        turn.push(message);
    }
    flush();
    return output;
}
