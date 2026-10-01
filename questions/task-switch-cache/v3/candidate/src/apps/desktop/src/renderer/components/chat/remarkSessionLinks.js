import { visit as visit } from "../../../../../../../runtime/unist-util-visit.js";
import { textContainsDeepLink as textContainsDeepLink } from "../../../shared/deepLinkSchemes.js";
import { SESSION_DEEP_LINK_RE_SOURCE as SESSION_DEEP_LINK_RE_SOURCE } from "../../lib/deepLink.js";
import { PROJECT_DEEP_LINK_RE_SOURCE as PROJECT_DEEP_LINK_RE_SOURCE } from "../../lib/deepLink.js";
import { parseSessionDeepLinkHref as parseSessionDeepLinkHref } from "../../lib/deepLink.js";
import { parseProjectDeepLinkHref as parseProjectDeepLinkHref } from "../../lib/deepLink.js";
import { SKIP as SKIP } from "../../../../../../../runtime/unist-util-visit.js";
export function findSessionLinkMatches(text) {
    const matches = [];
    const combined = new RegExp(`(${SESSION_DEEP_LINK_RE_SOURCE})|(${PROJECT_DEEP_LINK_RE_SOURCE})`, 'g');
    let m;
    while ((m = combined.exec(text)) !== null) {
        const value = m[0].replace(/[.,;:!?]+$/, '');
        const valid = m[1] !== undefined
            ? parseSessionDeepLinkHref(value)
            : parseProjectDeepLinkHref(value);
        if (!valid)
            continue;
        matches.push({ start: m.index, end: m.index + value.length, value });
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
        };
        out.push(link);
        cursor = match.end;
    }
    if (cursor < value.length) {
        out.push({ type: 'text', value: value.slice(cursor) });
    }
    return out;
}
export const remarkSessionLinks = () => {
    return (tree) => {
        visit(tree, 'text', (node, index, parent) => {
            if (!parent || index == null)
                return;
            if (parent.type === 'link')
                return;
            if (!node.value || !textContainsDeepLink(node.value))
                return;
            const matches = findSessionLinkMatches(node.value);
            if (matches.length === 0)
                return;
            const replacement = splitTextNode(node, matches);
            parent.children.splice(index, 1, ...replacement);
            return [SKIP, index + replacement.length];
        });
    };
};
export default remarkSessionLinks;
