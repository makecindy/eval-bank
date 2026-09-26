export const URL_WITH_DOUBLE_SLASH_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
export const POSITIVE_LINE_NUMBER_RE = /^[1-9]\d{0,6}$/;
export const LINE_RANGE_SUFFIX_RE = /^([1-9]\d{0,6})-([1-9]\d{0,6})$/;
export function splitLocalLineSuffix(raw) {
    const href = raw.trim();
    if (!href)
        return { href };
    if (URL_WITH_DOUBLE_SLASH_RE.test(href) && !href.toLowerCase().startsWith('file://')) {
        return { href };
    }
    const lastColon = href.lastIndexOf(':');
    if (lastColon <= 0)
        return { href };
    const lastPart = href.slice(lastColon + 1);
    const beforeLastPart = href.slice(0, lastColon);
    const rangeMatch = lastPart.match(LINE_RANGE_SUFFIX_RE);
    if (rangeMatch) {
        const line = Number(rangeMatch[1]);
        const endLine = Number(rangeMatch[2]);
        if (!Number.isSafeInteger(line) || !Number.isSafeInteger(endLine) || endLine < line) {
            return { href };
        }
        return { href: beforeLastPart, line };
    }
    if (!POSITIVE_LINE_NUMBER_RE.test(lastPart))
        return { href };
    const previousColon = beforeLastPart.lastIndexOf(':');
    const previousPart = previousColon >= 0 ? beforeLastPart.slice(previousColon + 1) : '';
    const hasColumn = POSITIVE_LINE_NUMBER_RE.test(previousPart);
    const base = hasColumn ? beforeLastPart.slice(0, previousColon) : beforeLastPart;
    if (!base)
        return { href };
    const line = Number(hasColumn ? previousPart : lastPart);
    const column = hasColumn ? Number(lastPart) : undefined;
    if (!Number.isSafeInteger(line) || line <= 0)
        return { href };
    if (column !== undefined && (!Number.isSafeInteger(column) || column <= 0))
        return { href };
    return {
        href: base,
        line,
        ...(column !== undefined ? { column } : {}),
    };
}
