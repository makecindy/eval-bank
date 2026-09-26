import { visit as visit } from "../../../../../../../runtime/unist-util-visit.js";
export const RAW_LOCAL_IMAGE_SRC_PROP = 'data-cindy-raw-local-image-src';
export const RAW_LOCAL_LINK_HREF_PROP = 'data-cindy-raw-local-link-href';
export const URL_SCHEME_RE = /^[a-z][a-z0-9+.-]*:/i;
export const WINDOWS_ABSOLUTE_PATH_RE = /^[A-Za-z]:[\\/]/;
export function isLocalDestination(url) {
    return (WINDOWS_ABSOLUTE_PATH_RE.test(url) ||
        url.startsWith('file://') ||
        !URL_SCHEME_RE.test(url));
}
export const remarkPreserveRawLocalDestinations = () => {
    return (tree) => {
        visit(tree, ['image', 'link'], (node) => {
            const typed = node;
            if (!isLocalDestination(typed.url))
                return;
            const prop = node.type === 'image' ? RAW_LOCAL_IMAGE_SRC_PROP : RAW_LOCAL_LINK_HREF_PROP;
            typed.data = {
                ...typed.data,
                hProperties: {
                    ...(typed.data?.hProperties ?? {}),
                    [prop]: typed.url,
                },
            };
        });
    };
};
export default remarkPreserveRawLocalDestinations;
