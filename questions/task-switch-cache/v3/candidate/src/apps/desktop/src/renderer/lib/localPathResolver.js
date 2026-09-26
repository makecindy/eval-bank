import { stripTrailingPathSeparators as stripTrailingPathSeparators } from "../../shared/pathText.js";
export const WIN_ABS_RE = /^[A-Za-z]:[\\/]/;
export const POSIX_ABS_PATH_RE = /^\/[^/\s][^\s]*\.[a-z0-9]{1,10}(\?[^\s]*)?$/i;
export const REL_PATH_WITH_SEP_AND_EXT_RE = /^[^\s:]*[\\/][^\s:]+\.[a-z0-9]{1,10}(\?[^\s]*)?$/i;
export const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:\/\//i;
export const TRAILING_SEP_RE = /[\\/]$/;
export function looksLikeDirectoryPath(text) {
    if (!text)
        return false;
    return TRAILING_SEP_RE.test(text);
}
export function looksLikeFilePath(text) {
    if (!text)
        return false;
    if (text.includes('\n'))
        return false;
    if (URL_SCHEME_RE.test(text))
        return false;
    if (looksLikeDirectoryPath(text))
        return false;
    if (WIN_ABS_RE.test(text))
        return true;
    if (POSIX_ABS_PATH_RE.test(text))
        return true;
    if (REL_PATH_WITH_SEP_AND_EXT_RE.test(text))
        return true;
    return false;
}
export function safeDecodeURIComponent(value) {
    try {
        return decodeURIComponent(value);
    }
    catch {
        return value;
    }
}
export function resolveLocalPath(href, cwd) {
    if (href.startsWith('file://')) {
        let p = safeDecodeURIComponent(href.slice(7));
        if (/^\/[A-Za-z]:[\\/]/.test(p))
            p = p.slice(1);
        return p;
    }
    if (href.startsWith('/'))
        return href;
    if (WIN_ABS_RE.test(href))
        return href;
    if (href.startsWith('\\\\'))
        return href;
    const isWin = cwd.includes('\\');
    const sep = isWin ? '\\' : '/';
    const trimmedCwd = stripTrailingPathSeparators(cwd);
    const normalizedHref = isWin ? href.replace(/\//g, '\\') : href;
    return `${trimmedCwd}${sep}${normalizedHref}`;
}
export function resolveToolFilePath(rawPath, workingDir) {
    if (!rawPath || !workingDir)
        return rawPath;
    return resolveLocalPath(rawPath, workingDir);
}
