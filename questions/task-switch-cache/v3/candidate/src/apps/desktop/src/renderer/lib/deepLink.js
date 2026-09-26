import { DEEP_LINK_SCHEME_RE_GROUP as DEEP_LINK_SCHEME_RE_GROUP } from "../../shared/deepLinkSchemes.js";
import { stripDeepLinkPathPrefix as stripDeepLinkPathPrefix } from "../../shared/deepLinkSchemes.js";
export const SESSION_DEEP_LINK_RE_SOURCE = `${DEEP_LINK_SCHEME_RE_GROUP}:\\/\\/session\\/[A-Za-z0-9%~_-]+(?:\\?[A-Za-z0-9%&=~._-]*)?`;
export const PROJECT_DEEP_LINK_RE_SOURCE = `${DEEP_LINK_SCHEME_RE_GROUP}:\\/\\/project\\/[A-Za-z0-9%~._!*-]+(?![A-Za-z0-9%~._!*('-])`;
export function isMarkdownEscaped(text, idx) {
    let backslashes = 0;
    for (let i = idx - 1; i >= 0 && text.charCodeAt(i) === 92; i--)
        backslashes++;
    return backslashes % 2 === 1;
}
export function findMarkdownLabelStart(text, closeBracketIdx) {
    if (isMarkdownEscaped(text, closeBracketIdx))
        return -1;
    let depth = 1;
    for (let i = closeBracketIdx - 1; i >= 0; i--) {
        const ch = text.charCodeAt(i);
        if (ch === 10)
            return -1;
        if (ch !== 93 && ch !== 91)
            continue;
        if (isMarkdownEscaped(text, i))
            continue;
        if (ch === 93)
            depth++;
        else {
            depth--;
            if (depth === 0)
                return i;
        }
    }
    return -1;
}
export function unescapeMarkdownLabelBrackets(label) {
    return label.replace(/\\([[\]])/g, '$1');
}
export function parseSessionDeepLinkHref(href) {
    const rest = stripDeepLinkPathPrefix(href, 'session/');
    if (rest === null)
        return null;
    const hashIdx = rest.indexOf('#');
    const noHash = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest;
    const queryIdx = noHash.indexOf('?');
    const rawId = (queryIdx >= 0 ? noHash.slice(0, queryIdx) : noHash).replace(/\/+$/, '');
    if (!rawId)
        return null;
    let sessionId;
    try {
        sessionId = decodeURIComponent(rawId);
    }
    catch {
        return null;
    }
    if (!sessionId)
        return null;
    let messageClientId = null;
    let deviceId = null;
    if (queryIdx >= 0) {
        const query = noHash.slice(queryIdx + 1);
        for (const pair of query.split('&')) {
            const eqIdx = pair.indexOf('=');
            if (eqIdx <= 0)
                continue;
            const key = pair.slice(0, eqIdx);
            if (key !== 'message' && key !== 'device')
                continue;
            if (key === 'message' ? messageClientId !== null : deviceId !== null)
                continue;
            const rawValue = pair.slice(eqIdx + 1);
            if (!rawValue)
                continue;
            try {
                const decoded = decodeURIComponent(rawValue);
                if (!decoded)
                    continue;
                if (key === 'message')
                    messageClientId = decoded;
                else
                    deviceId = decoded;
            }
            catch {
            }
        }
    }
    return { sessionId, messageClientId, deviceId };
}
export function parseProjectDeepLinkHref(href) {
    const rest = stripDeepLinkPathPrefix(href, 'project/');
    if (rest === null)
        return null;
    const hashIdx = rest.indexOf('#');
    const noHash = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest;
    const queryIdx = noHash.indexOf('?');
    const raw = (queryIdx >= 0 ? noHash.slice(0, queryIdx) : noHash).replace(/\/+$/, '');
    if (!raw)
        return null;
    let workingDir;
    try {
        workingDir = decodeURIComponent(raw);
    }
    catch {
        return null;
    }
    return workingDir ? { workingDir } : null;
}
