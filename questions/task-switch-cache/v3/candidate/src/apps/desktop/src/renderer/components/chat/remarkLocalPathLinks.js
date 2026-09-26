import { visit as visit } from "../../../../../../../runtime/unist-util-visit.js";
import { splitLocalLineSuffix as splitLocalLineSuffix } from "../../lib/markdownTarget.js";
import { looksLikeFilePath as looksLikeFilePath } from "../../lib/localPathResolver.js";
import { SKIP as SKIP } from "../../../../../../../runtime/unist-util-visit.js";
export const CJK = '\\u4e00-\\u9fff\\u3400-\\u4dbf\\u3040-\\u30ff\\uac00-\\ud7af';
export const SEG = `[A-Za-z0-9._~@+\\-${CJK}]+`;
export const SEP = '\\\\/';
export const ANCHOR = `(?:[A-Za-z]:[${SEP}]|\\.{1,2}[${SEP}]|[${SEP}])`;
export const NO_HOME = '(?!~[\\\\/])';
export const RIGHT_BOUNDARY = `(?![A-Za-z0-9_~@+\\-${CJK}${SEP}])`;
export const BODY = `(?:${ANCHOR}(?:${SEG}[${SEP}])*|(?:${SEG}[${SEP}])+)${SEG}\\.[A-Za-z0-9]{1,10}${RIGHT_BOUNDARY}`;
export const LINE_SUFFIX = '(?::[1-9]\\d{0,6}(?::[1-9]\\d{0,6})?)?';
export const LEFT_BOUNDARY = `(?<![A-Za-z0-9._~@+${CJK}${SEP}])`;
export const PATH_RE = new RegExp(`${LEFT_BOUNDARY}${NO_HOME}(${BODY}${LINE_SUFFIX})`, 'g');
export const BARE_PATH_ATTR = 'data-bare-path';
export const TOKEN_CHAR_RE = new RegExp(`[A-Za-z0-9_~@+\\-${CJK}\\\\/]`);
export const ALLOWED_BEFORE_RE = /[([{（【「『"'`:：,;，；、>]/;
export const SEP_IN_RUN_RE = /[\\/]/;
export const TRAILING_EXT_RE = /\.[A-Za-z0-9]{1,10}$/;
export function startsMidPathToken(text, start) {
    if (start === 0)
        return false;
    let runStart = start - 1;
    while (runStart >= 0 && !/\s/.test(text[runStart]))
        runStart -= 1;
    const runPrefix = text.slice(runStart + 1, start);
    if (runPrefix.length > 0) {
        return !ALLOWED_BEFORE_RE.test(text[start - 1]);
    }
    let i = start - 1;
    while (i >= 0 && (text[i] === ' ' || text[i] === '\t'))
        i -= 1;
    if (i < 0 || i === start - 1)
        return false;
    let j = i;
    while (j >= 0 && !/\s/.test(text[j]))
        j -= 1;
    const prevRun = text.slice(j + 1, i + 1);
    if (!SEP_IN_RUN_RE.test(prevRun))
        return false;
    return !TRAILING_EXT_RE.test(prevRun);
}
export function endsMidPathToken(text, end) {
    const next = text[end];
    if (next === undefined)
        return false;
    if (TOKEN_CHAR_RE.test(next))
        return true;
    if (next === '.' || next === ':') {
        let i = end;
        while (text[i] === '.' || text[i] === ':')
            i += 1;
        const after = text[i];
        return after !== undefined && TOKEN_CHAR_RE.test(after);
    }
    return false;
}
export function findPathMatches(text) {
    const matches = [];
    let m;
    PATH_RE.lastIndex = 0;
    while ((m = PATH_RE.exec(text)) !== null) {
        const value = m[1];
        const pathPart = splitLocalLineSuffix(value).href;
        if (!looksLikeFilePath(pathPart))
            continue;
        const start = m.index + (m[0].length - value.length);
        if (startsMidPathToken(text, start))
            continue;
        if (endsMidPathToken(text, start + value.length))
            continue;
        matches.push({ start, end: start + value.length, value });
    }
    return matches;
}
export function splitTextNode(node, matches) {
    const out = [];
    const value = node.value;
    let cursor = 0;
    for (const match of matches) {
        if (match.start > cursor) {
            out.push({ type: 'text', value: value.slice(cursor, match.start) });
        }
        const link = {
            type: 'link',
            url: match.value,
            children: [{ type: 'text', value: match.value }],
            data: { hProperties: { [BARE_PATH_ATTR]: '' } },
        };
        out.push(link);
        cursor = match.end;
    }
    if (cursor < value.length) {
        out.push({ type: 'text', value: value.slice(cursor) });
    }
    return out;
}
export const remarkLocalPathLinks = () => {
    return (tree) => {
        visit(tree, 'text', (node, index, parent) => {
            if (!parent || index == null)
                return;
            if (parent.type === 'link')
                return;
            if (!node.value || (!node.value.includes('/') && !node.value.includes('\\')))
                return;
            const matches = findPathMatches(node.value);
            if (matches.length === 0)
                return;
            const replacement = splitTextNode(node, matches);
            parent.children.splice(index, 1, ...replacement);
            return [SKIP, index + replacement.length];
        });
    };
};
export default remarkLocalPathLinks;
