import { BARE_HTTP_URL_RE_SOURCE as BARE_HTTP_URL_RE_SOURCE } from "../../../../../../packages/maker-shared/src/urlTextBoundary.js";
import { clipBareHttpAutolink as clipBareHttpAutolink } from "../../../../../../packages/maker-shared/src/urlTextBoundary.js";
import { SESSION_DEEP_LINK_RE_SOURCE as SESSION_DEEP_LINK_RE_SOURCE } from "../../lib/deepLink.js";
import { parseSessionDeepLinkHref as parseSessionDeepLinkHref } from "../../lib/deepLink.js";
import { findMarkdownLabelStart as findMarkdownLabelStart } from "../../lib/deepLink.js";
import { unescapeMarkdownLabelBrackets as unescapeMarkdownLabelBrackets } from "../../lib/deepLink.js";
import { stripDeepLinkPathPrefix as stripDeepLinkPathPrefix } from "../../../shared/deepLinkSchemes.js";
import { PROJECT_DEEP_LINK_RE_SOURCE as PROJECT_DEEP_LINK_RE_SOURCE } from "../../lib/deepLink.js";
import { parseProjectDeepLinkHref as parseProjectDeepLinkHref } from "../../lib/deepLink.js";
export const URL_RE = new RegExp(`(${BARE_HTTP_URL_RE_SOURCE})`, 'g');
export const IMG_PATH_RE = /([A-Za-z]:[\\/][^\s<>"']*?\.(?:png|jpe?g|gif|webp|svg|bmp|ico)|\/[^\s<>"']*?\.(?:png|jpe?g|gif|webp|svg|bmp|ico))/gi;
export const SESSION_URL_RE = new RegExp(SESSION_DEEP_LINK_RE_SOURCE, 'g');
export const SESSION_MD_CLOSE_RE = new RegExp(`\\]\\((${SESSION_DEEP_LINK_RE_SOURCE})\\)`, 'g');
export const PROJECT_URL_RE = new RegExp(PROJECT_DEEP_LINK_RE_SOURCE, 'g');
export const PROJECT_MD_CLOSE_RE = new RegExp(`\\]\\((${PROJECT_DEEP_LINK_RE_SOURCE})\\)`, 'g');
export function pushUrlMatch(matches, source, index, raw) {
    const end = clipBareHttpAutolink(raw, { prefix: source.slice(0, index) });
    if (end <= 0)
        return null;
    const text = raw.slice(0, end);
    matches.push({
        kind: 'url',
        index,
        length: text.length,
        text,
    });
    return text.length;
}
export function findLinkifyMatches(text) {
    const matches = [];
    URL_RE.lastIndex = 0;
    let m;
    while ((m = URL_RE.exec(text)) !== null) {
        const length = pushUrlMatch(matches, text, m.index, m[0]);
        if (length != null && length < m[0].length) {
            URL_RE.lastIndex = m.index + length;
        }
    }
    IMG_PATH_RE.lastIndex = 0;
    while ((m = IMG_PATH_RE.exec(text)) !== null) {
        matches.push({
            kind: 'img',
            index: m.index,
            length: m[0].length,
            text: m[0],
        });
    }
    SESSION_MD_CLOSE_RE.lastIndex = 0;
    while ((m = SESSION_MD_CLOSE_RE.exec(text)) !== null) {
        const href = m[1];
        if (!parseSessionDeepLinkHref(href))
            continue;
        const open = findMarkdownLabelStart(text, m.index);
        if (open < 0)
            continue;
        const label = unescapeMarkdownLabelBrackets(text.slice(open + 1, m.index)).trim();
        const end = m.index + m[0].length;
        matches.push({
            kind: 'session',
            index: open,
            length: end - open,
            text: text.slice(open, end),
            href,
            ...(label && label !== href ? { label } : {}),
        });
    }
    SESSION_URL_RE.lastIndex = 0;
    while ((m = SESSION_URL_RE.exec(text)) !== null) {
        const trimmed = m[0].replace(/[.,;:!?]+$/, '');
        if (!stripDeepLinkPathPrefix(trimmed, 'session/'))
            continue;
        matches.push({
            kind: 'session',
            index: m.index,
            length: trimmed.length,
            text: trimmed,
            href: trimmed,
        });
    }
    PROJECT_MD_CLOSE_RE.lastIndex = 0;
    while ((m = PROJECT_MD_CLOSE_RE.exec(text)) !== null) {
        const href = m[1];
        if (!parseProjectDeepLinkHref(href))
            continue;
        const open = findMarkdownLabelStart(text, m.index);
        if (open < 0)
            continue;
        const label = unescapeMarkdownLabelBrackets(text.slice(open + 1, m.index)).trim();
        const end = m.index + m[0].length;
        matches.push({
            kind: 'project',
            index: open,
            length: end - open,
            text: text.slice(open, end),
            href,
            ...(label && label !== href ? { label } : {}),
        });
    }
    PROJECT_URL_RE.lastIndex = 0;
    while ((m = PROJECT_URL_RE.exec(text)) !== null) {
        const trimmed = m[0].replace(/[.,;:!?]+$/, '');
        if (!parseProjectDeepLinkHref(trimmed))
            continue;
        matches.push({
            kind: 'project',
            index: m.index,
            length: trimmed.length,
            text: trimmed,
            href: trimmed,
        });
    }
    matches.sort((a, b) => a.index - b.index || (a.kind === 'url' ? -1 : 1));
    const accepted = [];
    let cursor = 0;
    for (const candidate of matches) {
        if (candidate.index < cursor)
            continue;
        accepted.push(candidate);
        cursor = candidate.index + candidate.length;
    }
    return accepted;
}
