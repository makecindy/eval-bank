import { visit as visit } from "../../../../../../../runtime/unist-util-visit.js";
export const remarkStrictInlineMath = () => {
    return (tree, file) => {
        const source = String(file);
        visit(tree, 'inlineMath', (node, index, parent) => {
            if (!parent || index == null)
                return;
            const start = node.position?.start.offset;
            const end = node.position?.end.offset;
            if (start == null || end == null)
                return;
            const raw = source.slice(start, end);
            const inner = raw.replace(/^\$+/, '').replace(/\$+$/, '');
            const nextChar = source[end] ?? '';
            const loose = /^\s|\s$/.test(inner) || inner.includes('\n') || inner.includes('`') || /^\d/.test(nextChar);
            if (!loose)
                return;
            const text = { type: 'text', value: raw };
            parent.children[index] = text;
        });
    };
};
export default remarkStrictInlineMath;
