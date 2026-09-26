export const IMG_TAG_RE = /^\s*<img\b([^>]*)\/?>\s*$/i;
export const ATTR_RE = /([A-Za-z_:][A-Za-z0-9:._-]*)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g;
export const SAFE_DIMENSION_RE = /^\d{1,4}$/;
export const SAFE_HTML_IMAGE_SRC_RE = /^https?:\/\//i;
export function decodeHtmlAttribute(value) {
    return value.replace(/&(amp|quot|#39|apos|lt|gt);/g, (entity, name) => {
        switch (name) {
            case 'amp':
                return '&';
            case 'quot':
                return '"';
            case '#39':
            case 'apos':
                return "'";
            case 'lt':
                return '<';
            case 'gt':
                return '>';
            default:
                return entity;
        }
    });
}
export function parseAttributes(raw) {
    const attrs = new Map();
    ATTR_RE.lastIndex = 0;
    let match;
    while ((match = ATTR_RE.exec(raw)) !== null) {
        const key = match[1].toLowerCase();
        const value = match[2] ?? match[3] ?? match[4] ?? '';
        attrs.set(key, decodeHtmlAttribute(value));
    }
    return attrs;
}
export function hPropertiesFromAttrs(attrs) {
    const hProperties = {};
    for (const key of ['width', 'height']) {
        const value = attrs.get(key);
        if (value && SAFE_DIMENSION_RE.test(value)) {
            hProperties[key] = value;
        }
    }
    return Object.keys(hProperties).length > 0 ? hProperties : undefined;
}
export function isSafeHtmlImageSrc(src) {
    return (SAFE_HTML_IMAGE_SRC_RE.test(src) ||
        src.startsWith('xdt-image://') ||
        src.startsWith('cindy-media://') ||
        src.startsWith('xdt-file://') ||
        src.startsWith('cindy-remote-media://'));
}
export function htmlImgToImageNode(node) {
    const match = node.value.match(IMG_TAG_RE);
    if (!match)
        return null;
    const attrs = parseAttributes(match[1]);
    const src = attrs.get('src')?.trim();
    if (!src || !isSafeHtmlImageSrc(src))
        return null;
    const image = {
        type: 'image',
        url: src,
        alt: attrs.get('alt') ?? '',
        title: attrs.get('title') || null,
        position: node.position,
    };
    const hProperties = hPropertiesFromAttrs(attrs);
    if (hProperties) {
        image.data = { hProperties };
    }
    return image;
}
