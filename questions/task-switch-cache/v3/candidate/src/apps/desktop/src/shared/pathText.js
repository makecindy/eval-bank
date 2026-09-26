export function stripTrailingPathSeparators(value) {
    let end = value.length;
    while (end > 0 && (value[end - 1] === '/' || value[end - 1] === '\\')) {
        end -= 1;
    }
    return end === value.length ? value : value.slice(0, end);
}
