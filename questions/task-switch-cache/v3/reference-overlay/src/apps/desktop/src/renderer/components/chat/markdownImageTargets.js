import { normalizeMarkdownRendererContent as normalizeMarkdownRendererContent } from "./MarkdownRenderer.js";
import { unified as unified } from "../../../../../../../runtime/unified.js";
import remarkParse from "../../../../../../../runtime/remark-parse.js";
import { REMARK_PLUGINS_PRIVILEGED as REMARK_PLUGINS_PRIVILEGED } from "./MarkdownRenderer.js";
import { visit as visit } from "../../../../../../../runtime/unist-util-visit.js";
export const markdownImageParser = unified()
    .use(remarkParse)
    .use(REMARK_PLUGINS_PRIVILEGED);
export function extractRenderedMarkdownImageTargets(markdown) {
    if (!markdown.includes('![') && !/<img/i.test(markdown))
        return [];
    const normalized = normalizeMarkdownRendererContent(markdown);
    const tree = markdownImageParser.runSync(markdownImageParser.parse(normalized));
    const urls = [];
    const seen = new Set();
    visit(tree, 'image', (node) => {
        if (!node.url || seen.has(node.url))
            return;
        seen.add(node.url);
        urls.push(node.url);
    });
    return urls;
}
export function extractCachedRenderedMarkdownImageTargets(markdown, cache, cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached?.content === markdown)
        return cached.targets;
    const targets = extractRenderedMarkdownImageTargets(markdown);
    cache.set(cacheKey, { content: markdown, targets });
    return targets;
}
