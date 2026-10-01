export const FENCE_OPEN_RE = /^ {0,3}(`{3,}|~{3,})/;
export const LINK_REFERENCE_DEFINITION_RE = /^ {0,3}\[[^\]\n]*\]:/gm;
export function findLinkDestinationRanges(text) {
    const ranges = [];
    let i = 0;
    while (i < text.length) {
        const open = text.indexOf('](', i);
        if (open === -1)
            break;
        let j = open + 2;
        let depth = 1;
        while (j < text.length && depth > 0) {
            const ch = text[j];
            if (ch === '\\') {
                j += 2;
                continue;
            }
            if (ch === '\n')
                break;
            if (ch === '(')
                depth += 1;
            else if (ch === ')')
                depth -= 1;
            j += 1;
        }
        if (depth === 0)
            ranges.push([open, j]);
        i = Math.max(open + 2, j);
    }
    for (const match of text.matchAll(LINK_REFERENCE_DEFINITION_RE)) {
        const lineEnd = text.indexOf('\n', match.index);
        ranges.push([match.index, lineEnd === -1 ? text.length : lineEnd]);
    }
    return ranges.sort((a, b) => a[0] - b[0]);
}
export function transformMathInText(text, preserveLineCount) {
    if (!text.includes('\\(') && !text.includes('\\['))
        return text;
    const protectedRanges = text.includes('](') || text.includes(']:') ? findLinkDestinationRanges(text) : [];
    let rangeIndex = 0;
    const inProtectedRange = (pos) => {
        while (rangeIndex < protectedRanges.length && protectedRanges[rangeIndex][1] <= pos)
            rangeIndex += 1;
        const range = protectedRanges[rangeIndex];
        return range && pos >= range[0] && pos < range[1] ? range[1] : -1;
    };
    let out = '';
    let consumed = 0;
    let scan = 0;
    let noParenCloser = false;
    let noBracketCloser = false;
    while (scan < text.length) {
        const open = text.indexOf('\\', scan);
        if (open === -1 || open + 1 >= text.length)
            break;
        const kind = text[open + 1];
        if (kind !== '(' && kind !== '[') {
            scan = open + 1;
            continue;
        }
        const protectedEnd = inProtectedRange(open);
        if (protectedEnd !== -1) {
            scan = protectedEnd;
            continue;
        }
        const isDisplay = kind === '[';
        if (isDisplay ? noBracketCloser : noParenCloser) {
            scan = open + 2;
            continue;
        }
        const closer = isDisplay ? '\\]' : '\\)';
        const close = text.indexOf(closer, open + 2);
        if (close === -1) {
            if (isDisplay)
                noBracketCloser = true;
            else
                noParenCloser = true;
            scan = open + 2;
            continue;
        }
        if (close === open + 2) {
            scan = open + 2;
            continue;
        }
        const inner = text.slice(open + 2, close);
        if (preserveLineCount && (isDisplay || inner.includes('\n'))) {
            scan = close + 2;
            continue;
        }
        out += text.slice(consumed, open);
        out += isDisplay ? `\n\n$$\n${inner.trim()}\n$$\n\n` : `$${inner.trim()}$`;
        consumed = close + 2;
        scan = consumed;
    }
    return out + text.slice(consumed);
}
export function transformOutsideInlineCode(segment, preserveLineCount) {
    if (!segment.includes('`'))
        return transformMathInText(segment, preserveLineCount);
    let out = '';
    let cursor = 0;
    const noCloserForLength = new Set();
    while (cursor < segment.length) {
        const tick = segment.indexOf('`', cursor);
        if (tick === -1)
            break;
        let openEnd = tick;
        while (openEnd < segment.length && segment[openEnd] === '`')
            openEnd += 1;
        const runLength = openEnd - tick;
        let closeStart = -1;
        let closeEnd = openEnd;
        if (!noCloserForLength.has(runLength)) {
            let probe = openEnd;
            while (probe < segment.length) {
                const t = segment.indexOf('`', probe);
                if (t === -1)
                    break;
                let e = t;
                while (e < segment.length && segment[e] === '`')
                    e += 1;
                if (e - t === runLength) {
                    closeStart = t;
                    closeEnd = e;
                    break;
                }
                probe = e;
            }
            if (closeStart === -1)
                noCloserForLength.add(runLength);
        }
        out += transformMathInText(segment.slice(cursor, tick), preserveLineCount);
        if (closeStart === -1) {
            out += segment.slice(tick, openEnd);
            cursor = openEnd;
            continue;
        }
        out += segment.slice(tick, closeEnd);
        cursor = closeEnd;
    }
    return out + (cursor < segment.length ? transformMathInText(segment.slice(cursor), preserveLineCount) : '');
}
export function normalizeMathDelimiters(markdown, options = {}) {
    const preserveLineCount = options.preserveLineCount === true;
    if (!markdown.includes('\\(') && !markdown.includes('\\['))
        return markdown;
    const lines = markdown.split('\n');
    const out = [];
    let textBuf = [];
    let fenceMarker = null;
    const flushText = () => {
        if (textBuf.length === 0)
            return;
        out.push(transformOutsideInlineCode(textBuf.join('\n'), preserveLineCount));
        textBuf = [];
    };
    for (const line of lines) {
        if (fenceMarker == null) {
            const open = line.match(FENCE_OPEN_RE);
            if (open) {
                flushText();
                fenceMarker = open[1];
                out.push(line);
                continue;
            }
            textBuf.push(line);
        }
        else {
            out.push(line);
            const close = line.match(FENCE_OPEN_RE);
            if (close &&
                close[1][0] === fenceMarker[0] &&
                close[1].length >= fenceMarker.length &&
                line.trim() === close[1]) {
                fenceMarker = null;
            }
        }
    }
    flushText();
    return out.join('\n');
}
