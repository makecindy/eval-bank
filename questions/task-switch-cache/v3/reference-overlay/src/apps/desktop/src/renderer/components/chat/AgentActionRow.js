import { getDataOwnerGeneration as getDataOwnerGeneration } from "../../contexts/dataOwnerGeneration.js";
export function parseModelFiles(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const m of raw) {
        if (typeof m !== 'object' || m === null)
            continue;
        const mo = m;
        if (mo.provider === 'cindy') {
            const url = typeof mo.url === 'string' ? mo.url : null;
            if (!url?.startsWith('cindy-media://'))
                continue;
            if (!url.toLowerCase().endsWith('.glb'))
                continue;
            const format = typeof mo.format === 'string' && mo.format ? mo.format : 'GLB';
            out.push({ provider: 'cindy', url, format });
        }
    }
    return out;
}
export function parseAudioTracks(raw) {
    if (!Array.isArray(raw))
        return [];
    const out = [];
    for (const t of raw) {
        if (typeof t !== 'object' || t === null)
            continue;
        const obj = t;
        const audioUrl = typeof obj.xdt_audio_url === 'string' ? obj.xdt_audio_url : null;
        if (!audioUrl || !isToolAudioUrl(audioUrl))
            continue;
        const coverUrl = typeof obj.cover_url === 'string' &&
            (obj.cover_url.startsWith('xdt-image://') || obj.cover_url.startsWith('cindy-media://'))
            ? obj.cover_url
            : undefined;
        const kind = obj.kind === 'sound_effect' ? 'sound_effect' : 'music';
        out.push({
            kind,
            audioUrl,
            ...(coverUrl ? { coverUrl } : {}),
            title: typeof obj.title === 'string' ? obj.title : '',
            tags: typeof obj.tags === 'string' ? obj.tags : '',
            lyrics: typeof obj.lyrics === 'string' ? obj.lyrics : '',
            durationSeconds: typeof obj.duration_seconds === 'number' ? obj.duration_seconds : 0,
            ...(typeof obj.suno_id === 'string' && obj.suno_id ? { sunoId: obj.suno_id } : {}),
        });
    }
    return out;
}
export function isToolImageUrl(url) {
    return url.startsWith('xdt-image://') || url.startsWith('cindy-media://');
}
export function isToolVideoUrl(url) {
    return url.startsWith('xdt-video://') || url.startsWith('cindy-media://');
}
export function isToolAudioUrl(url) {
    return url.startsWith('xdt-audio://') || url.startsWith('cindy-media://');
}
export function extractGhostCardId(toolResult) {
    return getToolResultMetadata(toolResult).cardId;
}
export function extractAnchorCardId(toolResult) {
    return getToolResultMetadata(toolResult).anchorId;
}
export function extractToolResultMedia(toolResult) {
    return getToolResultMetadata(toolResult).media.slice();
}
export const EMPTY_TOOL_METADATA = { cardId: null, anchorId: null, media: [] };
export const TOOL_METADATA_MAX_ENTRIES = 512;
export const TOOL_METADATA_MAX_CHARACTERS = 32 * 1024 * 1024;
export const toolMetadataCache = new Map();
export let toolMetadataCharacters = 0;
export let toolMetadataOwner = getDataOwnerGeneration();
export function getToolResultMetadata(toolResult) {
    const owner = getDataOwnerGeneration();
    if (owner !== toolMetadataOwner) {
        toolMetadataCache.clear();
        toolMetadataCharacters = 0;
        toolMetadataOwner = owner;
    }
    if (!toolResult || typeof toolResult !== 'string')
        return EMPTY_TOOL_METADATA;
    const cached = toolMetadataCache.get(toolResult);
    if (cached) {
        toolMetadataCache.delete(toolResult);
        toolMetadataCache.set(toolResult, cached);
        return cached;
    }
    let metadata = EMPTY_TOOL_METADATA;
    if (/xdt_(?:card_id|anchor_card_id|image_url|video_url|audio_url)/.test(toolResult)) {
        try {
            const parsed = JSON.parse(toolResult);
            if (parsed && typeof parsed === 'object') {
                metadata = {
                    cardId: toolResult.includes('xdt_card_id') && typeof parsed.xdt_card_id === 'string' && parsed.xdt_card_id.length > 0
                        ? parsed.xdt_card_id : null,
                    anchorId: toolResult.includes('xdt_anchor_card_id') && typeof parsed.xdt_anchor_card_id === 'string' && parsed.xdt_anchor_card_id.length > 0
                        ? parsed.xdt_anchor_card_id : null,
                    media: extractParsedToolResultMedia(toolResult, parsed),
                };
            }
        }
        catch {
        }
    }
    if (toolResult.length <= TOOL_METADATA_MAX_CHARACTERS) {
        toolMetadataCache.set(toolResult, metadata);
        toolMetadataCharacters += toolResult.length;
        while (toolMetadataCache.size > TOOL_METADATA_MAX_ENTRIES || toolMetadataCharacters > TOOL_METADATA_MAX_CHARACTERS) {
            const oldest = toolMetadataCache.keys().next().value;
            toolMetadataCache.delete(oldest);
            toolMetadataCharacters -= oldest.length;
        }
    }
    return metadata;
}
export function extractParsedToolResultMedia(toolResult, parsed) {
    if (!toolResult || typeof toolResult !== 'string')
        return [];
    if (!toolResult.includes('xdt_image_url') &&
        !toolResult.includes('xdt_video_url') &&
        !toolResult.includes('xdt_audio_url')) {
        return [];
    }
    try {
        if (parsed._xdt_render_image === false)
            return [];
        const modelFiles = parseModelFiles(parsed._xdt_model_files);
        let imageIdx = 0;
        const nextModelFile = () => {
            const m = modelFiles[imageIdx];
            imageIdx += 1;
            return m;
        };
        const items = [];
        const imagesInCard = parsed.xdt_images_in_card === true;
        if (typeof parsed.xdt_image_url === 'string' && isToolImageUrl(parsed.xdt_image_url)) {
            const modelFile = nextModelFile();
            items.push({
                kind: 'image',
                url: parsed.xdt_image_url,
                ...(modelFile ? { modelFile } : {}),
                ...(imagesInCard ? { imageInCard: true } : {}),
            });
        }
        if (Array.isArray(parsed.xdt_image_urls)) {
            for (const u of parsed.xdt_image_urls) {
                if (typeof u === 'string' && isToolImageUrl(u)) {
                    const modelFile = nextModelFile();
                    items.push({
                        kind: 'image',
                        url: u,
                        ...(modelFile ? { modelFile } : {}),
                        ...(imagesInCard ? { imageInCard: true } : {}),
                    });
                }
            }
        }
        if (typeof parsed.xdt_video_url === 'string' && isToolVideoUrl(parsed.xdt_video_url)) {
            items.push({
                kind: 'video',
                url: parsed.xdt_video_url,
            });
        }
        if (Array.isArray(parsed.xdt_video_urls)) {
            for (const u of parsed.xdt_video_urls) {
                if (typeof u === 'string' && isToolVideoUrl(u)) {
                    items.push({
                        kind: 'video',
                        url: u,
                    });
                }
            }
        }
        const audioInCard = parsed.xdt_audio_in_card === true;
        const audioTracks = parseAudioTracks(parsed.xdt_audio_tracks ?? parsed._xdt_audio_tracks);
        if (audioTracks.length > 0) {
            for (const t of audioTracks) {
                items.push({
                    kind: 'audio',
                    url: t.audioUrl,
                    audioTrack: t,
                    ...(audioInCard ? { audioInCard: true } : {}),
                });
            }
        }
        else if (Array.isArray(parsed.xdt_audio_urls)) {
            for (const u of parsed.xdt_audio_urls) {
                if (typeof u === 'string' && isToolAudioUrl(u)) {
                    items.push({
                        kind: 'audio',
                        url: u,
                        ...(audioInCard ? { audioInCard: true } : {}),
                        audioTrack: {
                            kind: 'music',
                            audioUrl: u,
                            title: '',
                            tags: '',
                            lyrics: '',
                            durationSeconds: 0,
                        },
                    });
                }
            }
        }
        const seen = new Set();
        return items.filter((it) => {
            if (seen.has(it.url))
                return false;
            seen.add(it.url);
            return true;
        });
    }
    catch {
    }
    return [];
}
