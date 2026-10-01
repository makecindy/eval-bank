import { normalizeMathDelimiters as normalizeMathDelimiters } from "../../../../../../packages/maker-shared/src/mathMarkdown.js";
import remarkGfm from "../../../../../../../runtime/remark-gfm.js";
import remarkCjkFriendly from "../../../../../../../runtime/remark-cjk-friendly.js";
import remarkMath from "../../../../../../../runtime/remark-math.js";
import remarkStrictInlineMath from "./remarkStrictInlineMath.js";
import remarkTruncateCjkUrls from "./remarkTruncateCjkUrls.js";
import remarkHtmlImages from "./remarkHtmlImages.js";
import remarkSessionLinks from "./remarkSessionLinks.js";
import remarkLocalPathLinks from "./remarkLocalPathLinks.js";
import remarkPreserveRawLocalDestinations from "./remarkPreserveRawLocalDestinations.js";
export const REMARK_PLUGINS_PRIVILEGED = [
    [remarkGfm, { singleTilde: false }],
    remarkCjkFriendly,
    remarkMath,
    remarkStrictInlineMath,
    remarkTruncateCjkUrls,
    remarkHtmlImages,
    remarkSessionLinks,
    remarkLocalPathLinks,
    remarkPreserveRawLocalDestinations,
];
export function normalizeMarkdownRendererContent(content, preserveLineCount = false) {
    return normalizeMathDelimiters(content, { preserveLineCount });
}
