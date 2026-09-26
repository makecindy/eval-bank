import { allDeepLinkSchemes as allDeepLinkSchemes } from "../../../../packages/maker-shared/src/brandIdentity.js";
export const DEEP_LINK_SCHEMES = allDeepLinkSchemes();
export const DEEP_LINK_URL_PREFIXES = DEEP_LINK_SCHEMES.map((scheme) => `${scheme}://`);
export const DEEP_LINK_SCHEME_RE_GROUP = `(?:${DEEP_LINK_SCHEMES.map((scheme) => scheme.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})`;
export function matchDeepLinkPrefix(url) {
    if (typeof url !== 'string')
        return null;
    for (const prefix of DEEP_LINK_URL_PREFIXES) {
        if (url.startsWith(prefix))
            return prefix;
    }
    return null;
}
export function textContainsDeepLink(text) {
    return DEEP_LINK_URL_PREFIXES.some((prefix) => text.includes(prefix));
}
export function stripDeepLinkPathPrefix(url, pathPrefix) {
    const schemePrefix = matchDeepLinkPrefix(url);
    if (schemePrefix === null)
        return null;
    const rest = url.slice(schemePrefix.length);
    return rest.startsWith(pathPrefix) ? rest.slice(pathPrefix.length) : null;
}
