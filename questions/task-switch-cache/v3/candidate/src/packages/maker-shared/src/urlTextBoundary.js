export const PROSE_TRAILING_PUNCT = new Set(['?', '!', '.', ',', ':', ';']);
export const MARKDOWN_FORMATTING_TRAILING_PUNCT = new Set(['*', '_', '~']);
export const MARKDOWN_WRAP_MARKERS = ['**', '__', '~~', '*', '_', '~'];
export function cutBeforeUnbalancedParenProse(raw, cut = raw.length, options = {}) {
    const scanCut = Math.min(Math.max(cut, 0), raw.length);
    const effectiveEnd = trimProseTrailingPunct(raw, scanCut);
    const queryOrHashIndex = raw.search(/[?#]/);
    const wrappingParenCount = options.wrappingParenCount ?? 0;
    const noteEnd = trimUnmatchedTrailingClosers(raw, trimMarkdownFormattingTrailingPunct(raw, effectiveEnd));
    const openParenIndexes = [];
    const parenPairs = [];
    for (let i = 0; i < effectiveEnd; i++) {
        const ch = raw[i];
        if (ch === '(') {
            openParenIndexes.push(i);
            continue;
        }
        if (ch !== ')')
            continue;
        const openIndex = openParenIndexes.pop();
        if (openIndex != null) {
            parenPairs.push({ open: openIndex, close: i });
            continue;
        }
        if (i >= noteEnd) {
            continue;
        }
        if (queryOrHashIndex >= 0 && i >= queryOrHashIndex) {
            if (wrappingParenCount > 0 &&
                countUnmatchedClosingParens(raw.slice(i + 1, effectiveEnd)) < wrappingParenCount) {
                return i;
            }
            continue;
        }
        if (raw[i + 1] != null && !/\s/.test(raw[i + 1])) {
            return i;
        }
    }
    return (openParenIndexes.find((openIndex) => queryOrHashIndex < 0 || openIndex < queryOrHashIndex) ??
        openParenIndexes.find((openIndex) => isCodeHostTruncatedStatusNote(raw, openIndex, noteEnd, queryOrHashIndex)) ??
        parenPairs.find(({ open, close }) => isCodeHostParentheticalNote(raw, open, close, queryOrHashIndex) &&
            close === noteEnd - 1)?.open ??
        raw.length);
}
export function isCodeHostTruncatedStatusNote(raw, open, noteEnd, queryOrHashIndex) {
    if (queryOrHashIndex < 0 || open < queryOrHashIndex)
        return false;
    if (!canTreatQueryOrHashParenAsStatusNote(raw, open, queryOrHashIndex))
        return false;
    const notePrefix = raw.slice(open + 1, noteEnd);
    return (/^base(?: [A-Za-z0-9._/-]*)?$/i.test(notePrefix) &&
        isCodeHostNumericResourcePath(raw.slice(0, queryOrHashIndex)));
}
export function isCodeHostParentheticalNote(raw, open, close, queryOrHashIndex) {
    if (queryOrHashIndex < 0 || open < queryOrHashIndex) {
        return isCodeHostNumericResourcePath(raw.slice(0, open));
    }
    if (!canTreatQueryOrHashParenAsStatusNote(raw, open, queryOrHashIndex))
        return false;
    const note = raw.slice(open + 1, close);
    return (isLikelyCodeHostStatusNote(note) &&
        isCodeHostNumericResourcePath(raw.slice(0, queryOrHashIndex)));
}
export function canTreatQueryOrHashParenAsStatusNote(raw, open, queryOrHashIndex) {
    const lastAmpersand = raw.lastIndexOf('&', open - 1);
    const segmentStart = Math.max(queryOrHashIndex + 1, lastAmpersand + 1);
    const currentSegment = raw.slice(segmentStart, open);
    if (!currentSegment.includes('='))
        return true;
    return /^diff=split$/i.test(currentSegment);
}
export function isLikelyCodeHostStatusNote(note) {
    return /^base(?: [A-Za-z0-9._/-]+)*,[A-Z][A-Z0-9_-]*$/i.test(note);
}
export function isCodeHostNumericResourcePath(prefix) {
    let parsed;
    try {
        parsed = new URL(prefix);
    }
    catch {
        return false;
    }
    const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
    const pathname = parsed.pathname;
    if (host === 'github.com') {
        return /^\/[^/]+\/[^/]+\/(?:pulls?|issues?)\/\d+\/?$/i.test(pathname);
    }
    if (host === 'gitlab.com') {
        return /^\/.+\/(?:-\/)?(?:issues?|merge_requests?)\/\d+\/?$/i.test(pathname);
    }
    return false;
}
export function trimProseTrailingPunct(raw, cut) {
    let end = cut;
    while (end > 0 && PROSE_TRAILING_PUNCT.has(raw[end - 1])) {
        end--;
    }
    return end;
}
export function trimMarkdownFormattingTrailingPunct(raw, cut) {
    let end = cut;
    while (end > 0 && MARKDOWN_FORMATTING_TRAILING_PUNCT.has(raw[end - 1])) {
        end--;
    }
    return end;
}
export function trimUnmatchedTrailingClosers(raw, cut) {
    let end = cut;
    while (end > 0 && raw[end - 1] === ')') {
        const seg = raw.slice(0, end);
        const opens = (seg.match(/\(/g) ?? []).length;
        const closes = (seg.match(/\)/g) ?? []).length;
        if (closes <= opens)
            break;
        end--;
    }
    return end;
}
export function cutBeforePathBracketProse(raw) {
    const schemeIndex = raw.indexOf('://');
    const authorityStart = schemeIndex >= 0 ? schemeIndex + 3 : 0;
    const pathStart = raw.indexOf('/', authorityStart);
    const queryOrHashIndex = raw.search(/[?#]/);
    const pathScanEnd = queryOrHashIndex < 0 ? raw.length : queryOrHashIndex;
    for (let i = authorityStart; i < pathScanEnd; i++) {
        if (!'[]{}'.includes(raw[i]))
            continue;
        if (pathStart >= 0 && i >= pathStart)
            return i;
        if (canParseUrlPrefix(raw.slice(0, i)))
            return i;
    }
    const queryBracketCut = cutBeforeUnmatchedQueryBracket(raw, queryOrHashIndex, raw.length);
    if (queryBracketCut < raw.length)
        return queryBracketCut;
    return raw.length;
}
export function canParseUrlPrefix(prefix) {
    try {
        const parsed = new URL(prefix);
        return (parsed.protocol === 'http:' || parsed.protocol === 'https:') && parsed.hostname !== '';
    }
    catch {
        return false;
    }
}
export function cutBeforeUnmatchedQueryBracket(raw, queryOrHashIndex, scanEnd) {
    if (queryOrHashIndex < 0)
        return raw.length;
    const counts = { ']': 0, '}': 0 };
    const matchingClose = { '[': ']', '{': '}' };
    for (let i = queryOrHashIndex; i < scanEnd; i++) {
        const ch = raw[i];
        if (ch === '[' || ch === '{') {
            counts[matchingClose[ch]]++;
            continue;
        }
        if (ch !== ']' && ch !== '}')
            continue;
        if (counts[ch] <= 0)
            return i;
        counts[ch]--;
    }
    return raw.length;
}
export function cutBeforeClosingMarkdownWrap(raw, marker) {
    if (!marker)
        return raw.length;
    let markerIndex = raw.indexOf(marker);
    while (markerIndex >= 0) {
        if (isMarkdownWrapCloseCandidate(raw, marker, markerIndex)) {
            return markerIndex;
        }
        markerIndex = raw.indexOf(marker, markerIndex + marker.length);
    }
    return raw.length;
}
export function isMarkdownWrapOpenBoundary(ch) {
    return ch == null || !isAsciiAlnum(ch);
}
export function isMarkdownWrapCloseCandidate(raw, marker, markerIndex) {
    if (marker !== '_' && marker !== '__')
        return true;
    const before = raw[markerIndex - 1];
    const after = raw[markerIndex + marker.length];
    return !(isAsciiAlnum(before) && isAsciiAlnum(after));
}
export function isAsciiAlnum(ch) {
    return ch != null && /[A-Za-z0-9]/.test(ch);
}
export function countUnmatchedOpeningParens(text) {
    if (!text)
        return 0;
    let count = 0;
    for (const ch of text) {
        if (ch === '(') {
            count++;
            continue;
        }
        if (ch === ')' && count > 0) {
            count--;
        }
    }
    return count;
}
export function countUnmatchedClosingParens(text) {
    let openCount = 0;
    let closeCount = 0;
    for (const ch of text) {
        if (ch === '(') {
            openCount++;
            continue;
        }
        if (ch === ')') {
            if (openCount > 0) {
                openCount--;
            }
            else {
                closeCount++;
            }
        }
    }
    return closeCount;
}
export function shrinkAutolinkTrailingJunk(url, cut = url.length, options = {}) {
    let end = Math.min(Math.max(cut, 0), url.length);
    const queryOrHashIndex = url.search(/[?#]/);
    let stripWrappingParenCount = Math.max(0, (options.stripWrappingParenCount ?? 0) - countUnmatchedClosingParens(url.slice(end)));
    while (end > 0) {
        const ch = url[end - 1];
        const isInQueryOrFragment = queryOrHashIndex >= 0 && end - 1 >= queryOrHashIndex;
        if (PROSE_TRAILING_PUNCT.has(ch) ||
            (options.stripMarkdownFormattingPunct &&
                MARKDOWN_FORMATTING_TRAILING_PUNCT.has(ch)) ||
            (ch === '(' && !isInQueryOrFragment) ||
            (ch === "'" && options.stripWrappingApostrophe)) {
            end--;
            continue;
        }
        if (ch === ')') {
            const seg = url.slice(0, end);
            const opens = (seg.match(/\(/g) ?? []).length;
            const closes = (seg.match(/\)/g) ?? []).length;
            if (closes > opens) {
                if (isInQueryOrFragment) {
                    if (stripWrappingParenCount <= 0)
                        break;
                    stripWrappingParenCount--;
                }
                end--;
                continue;
            }
        }
        break;
    }
    return end;
}
export const BARE_HTTP_URL_RE_SOURCE = String.raw `https?://[^\s<>"\u2013-\u2015\u2018-\u201F\u2022\u2026\u3000-\u3001\u3003\u3008-\u3011\u3014-\u301F\u3030\u303D\u30FB\uFE10-\uFE19\uFF01-\uFF0D\uFF0F\uFF1A-\uFF20\uFF3B-\uFF40\uFF5B-\uFF60\uFF62-\uFF65]+`;
export const MARKDOWN_FORMATTING_STRIP_BOUNDARY = /[\u3000-\u303F\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uFF00-\uFFEF]/;
export function isAutolinkPunctuationBoundary(ch) {
    const code = ch.codePointAt(0);
    if (code == null)
        return false;
    if (ch === '"' || ch === '`')
        return true;
    if (code < 0x80)
        return false;
    return /^\p{P}$/u.test(ch) || /^\p{Z}$/u.test(ch);
}
export function isIdnDomainDot(ch) {
    const code = ch?.codePointAt(0);
    return code === 0x3002 || code === 0xff0e || code === 0xff61;
}
export function firstAuthDelimiterIndex(text, from = 0) {
    for (let index = from; index < text.length; index += 1) {
        const ch = text[index];
        if (ch === '/' || ch === '?' || ch === '#')
            return index;
    }
    return text.length;
}
export function hostnameRange(raw) {
    const scheme = raw.match(/^https?:\/\//i);
    let start = scheme ? scheme[0].length : 0;
    const authEnd = firstAuthDelimiterIndex(raw, start);
    const at = raw.lastIndexOf('@', authEnd - 1);
    if (at >= start)
        start = at + 1;
    if (raw[start] === '[') {
        const close = raw.indexOf(']', start + 1);
        return { start, end: close >= 0 && close < authEnd ? close + 1 : authEnd };
    }
    for (let index = start; index < authEnd; index += 1) {
        if (raw[index] === ':')
            return { start, end: index };
    }
    return { start, end: authEnd };
}
export function isHostLabelChar(ch) {
    if (ch == null || isIdnDomainDot(ch))
        return false;
    if (ch === '/' || ch === '?' || ch === '#' || ch === ':' || ch === '@')
        return false;
    return !isAutolinkPunctuationBoundary(ch);
}
export function isCjkLetter(ch) {
    return /[\u3040-\u30FF\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF\uF900-\uFAFF]/u.test(ch);
}
export function nextHostLabelEnd(raw, from, hostEnd) {
    let index = from;
    while (index < hostEnd) {
        const code = raw.codePointAt(index);
        if (code == null)
            break;
        const char = String.fromCodePoint(code);
        if (isIdnDomainDot(char) || char === '.')
            break;
        if (!isHostLabelChar(char))
            break;
        index += char.length;
    }
    return index;
}
export function isIdnDotInHostname(raw, index, hostStart, hostEnd) {
    if (index < hostStart || index >= hostEnd)
        return false;
    if (!isIdnDomainDot(raw[index] ?? '') || !isHostLabelChar(raw[index + 1]))
        return false;
    const labelEnd = nextHostLabelEnd(raw, index + 1, hostEnd);
    const chars = [...raw.slice(index + 1, labelEnd)];
    if (chars.length === 0)
        return false;
    if (chars.some((ch) => /^\p{L}$/u.test(ch) && !isCjkLetter(ch)))
        return true;
    if (chars.some((ch) => /[A-Za-z0-9]/.test(ch)))
        return true;
    const after = raw[labelEnd];
    if (after === '.' || isIdnDomainDot(after) || hostEnd < raw.length)
        return true;
    return chars.length <= 3;
}
export function findAutolinkProseBoundary(raw) {
    const { start: hostStart, end: hostEnd } = hostnameRange(raw);
    for (let index = 0; index < raw.length;) {
        const code = raw.codePointAt(index);
        if (code == null)
            break;
        const char = String.fromCodePoint(code);
        if (isAutolinkPunctuationBoundary(char) &&
            !isIdnDotInHostname(raw, index, hostStart, hostEnd)) {
            return index;
        }
        index += char.length;
    }
    return raw.length;
}
export function markdownWrapMarkerFromPrefix(prefix) {
    if (!prefix)
        return null;
    for (const marker of MARKDOWN_WRAP_MARKERS) {
        if (!prefix.endsWith(marker))
            continue;
        return isMarkdownWrapOpenBoundary(prefix[prefix.length - marker.length - 1])
            ? marker
            : null;
    }
    return null;
}
export function clipBareHttpAutolink(raw, options = {}) {
    const prefix = options.prefix ?? '';
    const wrappingParenCount = countUnmatchedOpeningParens(prefix);
    const marker = options.markdownWrapMarker === undefined
        ? markdownWrapMarkerFromPrefix(prefix)
        : options.markdownWrapMarker;
    const boundaryIndex = findAutolinkProseBoundary(raw);
    const boundaryCut = boundaryIndex;
    const markdownCut = cutBeforeClosingMarkdownWrap(raw, marker);
    const limited = Math.min(boundaryCut, markdownCut);
    const proseCut = Math.min(limited, cutBeforeUnbalancedParenProse(raw, limited, { wrappingParenCount }), options.cutPathBrackets === false ? raw.length : cutBeforePathBracketProse(raw));
    const stripMarkdown = options.stripMarkdownFormattingPunct === true ||
        (options.stripMarkdownFormattingPunct === 'auto' &&
            (markdownCut < raw.length ||
                hasTrailingMultiCharMarkdownMarkerAfterCodeHostResource(raw, proseCut) ||
                (boundaryIndex < raw.length &&
                    proseCut === boundaryCut &&
                    MARKDOWN_FORMATTING_STRIP_BOUNDARY.test(raw[boundaryIndex]))));
    return shrinkAutolinkTrailingJunk(raw, proseCut, {
        stripMarkdownFormattingPunct: stripMarkdown,
        stripWrappingApostrophe: prefix.endsWith("'"),
        stripWrappingParenCount: wrappingParenCount,
    });
}
export function hasTrailingMultiCharMarkdownMarkerAfterCodeHostResource(raw, cut) {
    if (cut < 2)
        return false;
    return ['**', '__', '~~'].some((marker) => raw.slice(cut - marker.length, cut) === marker &&
        isCodeHostNumericResourcePath(raw.slice(0, cut - marker.length)));
}
