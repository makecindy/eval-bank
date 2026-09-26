import { visit as visit } from "../../../../../../../runtime/unist-util-visit.js";
import { clipBareHttpAutolink as clipBareHttpAutolink } from "../../../../../../packages/maker-shared/src/urlTextBoundary.js";
import { markdownWrapMarkerFromPrefix as markdownWrapMarkerFromPrefix } from "../../../../../../packages/maker-shared/src/urlTextBoundary.js";
import { findLinkifyMatches as findLinkifyMatches } from "./userMessageLinkify.js";
import { SKIP as SKIP } from "../../../../../../../runtime/unist-util-visit.js";
export function hasSamePosition(a, b) {
    return (a.position?.start.offset != null &&
        a.position?.end.offset != null &&
        b.position?.start.offset === a.position.start.offset &&
        b.position?.end.offset === a.position.end.offset);
}
export function textFromPhrasingContent(node) {
    if (node.type === 'text' || node.type === 'inlineCode')
        return node.value;
    if ('children' in node) {
        return node.children.map((child) => textFromPhrasingContent(child)).join('');
    }
    if (node.type === 'image' || node.type === 'imageReference')
        return node.alt ?? '';
    return '';
}
export function textBeforeAutolink(siblings, index) {
    return siblings.slice(0, index).map((node) => textFromPhrasingContent(node)).join('');
}
export const remarkTruncateCjkUrls = () => {
    return (tree) => {
        visit(tree, 'link', (node, index, parent) => {
            if (!parent || index == null)
                return;
            const onlyChild = node.children.length === 1 ? node.children[0] : null;
            if (!onlyChild || onlyChild.type !== 'text' || onlyChild.value !== node.url) {
                return;
            }
            const isAutolinkLiteral = hasSamePosition(node, onlyChild);
            if (!isAutolinkLiteral) {
                return;
            }
            mergeBalancedQueryBracketTail(node, onlyChild, parent.children, index);
            const prev = parent.children[index - 1];
            const prevText = prev?.type === 'text' ? prev.value : null;
            const prefixText = textBeforeAutolink(parent.children, index);
            const cut = clipBareHttpAutolink(node.url, {
                prefix: prefixText,
                markdownWrapMarker: markdownWrapMarkerFromPrefix(prevText),
                stripMarkdownFormattingPunct: 'auto',
            });
            if (cut === node.url.length)
                return;
            if (cut === 0)
                return;
            const head = node.url.slice(0, cut);
            const tail = node.url.slice(cut);
            node.url = head;
            onlyChild.value = head;
            const tailNodes = linkifyTailUrls(tail);
            parent.children.splice(index + 1, 0, ...tailNodes);
            return [SKIP, index + 1 + tailNodes.length];
        });
    };
};
export function linkifyTailUrls(tail) {
    const matches = findLinkifyMatches(tail).filter((match) => match.kind === 'url');
    if (matches.length === 0) {
        return [{ type: 'text', value: tail }];
    }
    const nodes = [];
    let cursor = 0;
    for (const match of matches) {
        if (match.index > cursor) {
            nodes.push({ type: 'text', value: tail.slice(cursor, match.index) });
        }
        const text = { type: 'text', value: match.text };
        nodes.push({ type: 'link', url: match.text, children: [text] });
        cursor = match.index + match.length;
    }
    if (cursor < tail.length) {
        nodes.push({ type: 'text', value: tail.slice(cursor) });
    }
    return nodes;
}
export function mergeBalancedQueryBracketTail(node, onlyChild, siblings, index) {
    const next = siblings[index + 1];
    if (!next || next.type !== 'text')
        return;
    const queryOrHashIndex = node.url.search(/[?#]/);
    if (queryOrHashIndex < 0)
        return;
    let expectedCloser = expectedQueryBracketCloser(node.url.slice(queryOrHashIndex));
    if (!expectedCloser)
        return;
    let consumed = '';
    while (expectedCloser && next.value.startsWith(expectedCloser)) {
        consumed += expectedCloser;
        next.value = next.value.slice(expectedCloser.length);
        expectedCloser = expectedQueryBracketCloser(`${node.url.slice(queryOrHashIndex)}${consumed}`);
    }
    if (!consumed)
        return;
    node.url += consumed;
    onlyChild.value += consumed;
    if (next.value.length === 0) {
        siblings.splice(index + 1, 1);
    }
}
export function expectedQueryBracketCloser(queryText) {
    const stack = [];
    for (const ch of queryText) {
        if (ch === '[') {
            stack.push(']');
            continue;
        }
        if (ch === '{') {
            stack.push('}');
            continue;
        }
        if (ch !== ']' && ch !== '}')
            continue;
        if (stack[stack.length - 1] === ch) {
            stack.pop();
        }
    }
    return stack.at(-1) ?? null;
}
export default remarkTruncateCjkUrls;
