export function stripTrailingPathSeparators(value) {
    let end = value.length;
    while (end > 0) {
        const code = value.charCodeAt(end - 1);
        if (code !== 47 && code !== 92)
            break;
        end -= 1;
    }
    return end === value.length ? value : value.slice(0, end);
}
