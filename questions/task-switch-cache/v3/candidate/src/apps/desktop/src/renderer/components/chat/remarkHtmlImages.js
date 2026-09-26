import { visit as visit } from "../../../../../../../runtime/unist-util-visit.js";
import { htmlImgToImageNode as htmlImgToImageNode } from "../../../shared/htmlImage.js";
import { SKIP as SKIP } from "../../../../../../../runtime/unist-util-visit.js";
export const remarkHtmlImages = () => {
    return (tree) => {
        visit(tree, 'html', (node, index, parent) => {
            if (!parent || index == null)
                return;
            const image = htmlImgToImageNode(node);
            if (!image)
                return;
            parent.children.splice(index, 1, image);
            return [SKIP, index + 1];
        });
    };
};
export default remarkHtmlImages;
