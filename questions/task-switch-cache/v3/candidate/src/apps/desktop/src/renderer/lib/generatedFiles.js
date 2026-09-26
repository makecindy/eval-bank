import { describeToolUse as describeToolUse } from "../../../../../packages/maker-shared/src/index.js";
import { resolveToolFilePath as resolveToolFilePath } from "./localPathResolver.js";
import { basename as basename } from "./utils.js";
import { createdPathsFromDescriptor as createdPathsFromDescriptor } from "../../../../../packages/maker-shared/src/index.js";
import { extractCommandOutputPathCandidates as extractCommandOutputPathCandidates } from "../../shared/commandOutputPaths.js";
import { sourcePathCandidatesFromDescriptor as sourcePathCandidatesFromDescriptor } from "../../../../../packages/maker-shared/src/index.js";
export { extractCommandOutputPathCandidates };
export function documentToolName(toolName) {
    const normalized = toolName.replace(/^mcp__/, 'mcp:').replace(/__/g, ':');
    const name = normalized.split(':').at(-1) ?? normalized;
    return /^(make_docx|make_pptx|make_xlsx|render_pdf)$/.test(name) ? name : null;
}
export function asRecord(value) {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value
        : null;
}
export function isExplicitFailedToolResult(content) {
    if (!content)
        return false;
    if (content.includes('<tool_use_error>'))
        return true;
    const parsed = parseToolResult(content);
    if (!parsed)
        return false;
    if (parsed.ok === false || parsed.success === false)
        return true;
    const status = typeof parsed.status === 'string' ? parsed.status.toLowerCase() : '';
    return status === 'error' || status === 'failed' || status === 'failure';
}
export function parseToolResult(content) {
    if (!content)
        return null;
    try {
        const parsed = JSON.parse(content);
        return asRecord(parsed);
    }
    catch {
        return null;
    }
}
export function stringField(record, key) {
    const value = record?.[key];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
export function previewCellText(value) {
    if (value === null || value === undefined)
        return '';
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return String(value).slice(0, 48);
    }
    const record = asRecord(value);
    if (record && 'result' in record)
        return previewCellText(record.result);
    if (record && 'text' in record)
        return previewCellText(record.text);
    return '';
}
export function sheetPreview(input) {
    const firstSheet = asRecord(Array.isArray(input?.sheets) ? input.sheets[0] : null);
    if (!firstSheet)
        return undefined;
    const header = Array.isArray(firstSheet.header)
        ? firstSheet.header.slice(0, 3).map(previewCellText)
        : [];
    const bodyRows = Array.isArray(firstSheet.rows)
        ? firstSheet.rows
            .slice(0, header.length > 0 ? 3 : 4)
            .filter(Array.isArray)
            .map((row) => row.slice(0, 3).map(previewCellText))
        : [];
    const rows = header.length > 0 ? [header, ...bodyRows] : bodyRows;
    return rows.length > 0 ? { kind: 'sheet', rows, hasHeader: header.length > 0 } : undefined;
}
export function extractDocumentArtifactMetadata(toolName, input, resultContent) {
    const name = documentToolName(toolName);
    if (!name)
        return undefined;
    const inputRecord = asRecord(input);
    const result = parseToolResult(resultContent);
    if (resultContent !== undefined && result?.ok !== true)
        return undefined;
    const resultArtifact = asRecord(result?.artifact);
    const format = name === 'make_docx'
        ? 'docx'
        : name === 'make_pptx'
            ? 'pptx'
            : name === 'make_xlsx'
                ? 'xlsx'
                : 'pdf';
    const theme = stringField(resultArtifact, 'theme') ??
        stringField(result, 'theme') ??
        stringField(inputRecord, 'theme');
    const validTheme = theme === 'light' || theme === 'dark' || theme === 'navy' ? theme : undefined;
    const title = stringField(resultArtifact, 'title') ??
        stringField(result, 'title') ??
        stringField(inputRecord, 'title') ??
        (name === 'make_pptx'
            ? stringField(asRecord(Array.isArray(inputRecord?.slides) ? inputRecord.slides[0] : null), 'title')
            : name === 'make_xlsx'
                ? stringField(asRecord(Array.isArray(inputRecord?.sheets) ? inputRecord.sheets[0] : null), 'name')
                : undefined);
    const subtitle = stringField(resultArtifact, 'subtitle') ??
        stringField(result, 'subtitle') ??
        stringField(inputRecord, 'subtitle');
    const rawSummary = asRecord(resultArtifact?.summary) ?? asRecord(result?.summary);
    const summaryKind = rawSummary?.kind;
    const summaryValue = rawSummary?.value;
    const summary = (summaryKind === 'pages' ||
        summaryKind === 'slides' ||
        summaryKind === 'sheets' ||
        summaryKind === 'rows' ||
        summaryKind === 'bytes') &&
        typeof summaryValue === 'number' &&
        Number.isFinite(summaryValue)
        ? { kind: summaryKind, value: summaryValue }
        : name === 'make_pptx' && Array.isArray(inputRecord?.slides)
            ? { kind: 'slides', value: inputRecord.slides.length }
            : name === 'make_xlsx' && Array.isArray(inputRecord?.sheets)
                ? { kind: 'sheets', value: inputRecord.sheets.length }
                : (name === 'make_docx' || name === 'render_pdf') &&
                    typeof result?.bytes === 'number' &&
                    Number.isFinite(result.bytes)
                    ? { kind: 'bytes', value: result.bytes }
                    : undefined;
    const firstSlide = name === 'make_pptx'
        ? asRecord(Array.isArray(inputRecord?.slides) ? inputRecord.slides[0] : null)
        : null;
    const preview = name === 'make_xlsx'
        ? sheetPreview(inputRecord)
        : name === 'make_pptx'
            ? {
                kind: 'slide',
                ...(stringField(firstSlide, 'title')
                    ? { title: stringField(firstSlide, 'title') }
                    : {}),
                ...(stringField(firstSlide, 'subtitle')
                    ? { subtitle: stringField(firstSlide, 'subtitle') }
                    : {}),
            }
            : undefined;
    return {
        format,
        ...(title ? { title } : {}),
        ...(subtitle ? { subtitle } : {}),
        ...(validTheme ? { theme: validTheme } : {}),
        ...(typeof resultArtifact?.cover === 'boolean'
            ? { cover: resultArtifact.cover }
            : typeof inputRecord?.cover === 'boolean'
                ? { cover: inputRecord.cover }
                : {}),
        ...(summary ? { summary: summary } : {}),
        ...(preview ? { preview } : {}),
    };
}
export function dedupeKeyForPath(abs) {
    const isWindowsShape = /^[a-zA-Z]:[\\/]/.test(abs) || abs.includes('\\');
    if (!isWindowsShape)
        return abs;
    return abs
        .replace(/\//g, '\\')
        .replace(/(?<!^)\\{2,}/g, '\\')
        .toLowerCase();
}
export function canonicalizeWindowsShape(abs) {
    return /^[a-zA-Z]:[\\/]/.test(abs) ? abs.replace(/\//g, '\\').replace(/\\{2,}/g, '\\') : abs;
}
export function collectGeneratedFiles(messages, workingDir) {
    const descriptors = new Map();
    const descriptorFor = (message) => {
        let descriptor = descriptors.get(message);
        if (!descriptor) {
            descriptor = describeToolUse(message.toolName ?? '', message.toolInput);
            descriptors.set(message, descriptor);
        }
        return descriptor;
    };
    const resultByToolUseId = new Map();
    for (const message of messages) {
        if (message.role === 'tool_result' &&
            message.toolUseId &&
            typeof message.content === 'string') {
            resultByToolUseId.set(message.toolUseId, message.content);
        }
    }
    const editedKeys = new Set();
    for (const msg of messages) {
        if (msg.role !== 'tool_use' || !msg.toolName)
            continue;
        const resultContent = msg.toolUseId ? resultByToolUseId.get(msg.toolUseId) : undefined;
        if (msg.toolUseId && resultContent === undefined)
            continue;
        if (isExplicitFailedToolResult(resultContent))
            continue;
        const d = descriptorFor(msg);
        if (d.kind === 'file' && d.action === 'edit' && d.filePath) {
            editedKeys.add(dedupeKeyForPath(resolveToolFilePath(d.filePath, workingDir)));
        }
        else if (d.kind === 'fileChange') {
            for (const c of d.changes) {
                if (c.action !== 'add' && c.path) {
                    editedKeys.add(dedupeKeyForPath(resolveToolFilePath(c.path, workingDir)));
                }
            }
        }
    }
    const byKey = new Map();
    for (const msg of messages) {
        if (msg.role !== 'tool_use')
            continue;
        const toolName = msg.toolName ?? '';
        if (!toolName)
            continue;
        const resultContent = msg.toolUseId ? resultByToolUseId.get(msg.toolUseId) : undefined;
        const toolFailed = isExplicitFailedToolResult(resultContent);
        const toolReady = !msg.toolUseId || resultByToolUseId.has(msg.toolUseId);
        const addPath = (rawPath, source) => {
            if (toolFailed)
                return;
            const abs = canonicalizeWindowsShape(resolveToolFilePath(rawPath, workingDir));
            const key = dedupeKeyForPath(abs);
            if (source === 'command' && editedKeys.has(key))
                return;
            const prev = byKey.get(key);
            if (prev) {
                if (prev.source === 'command' && source === 'tool')
                    prev.source = 'tool';
                if (toolReady)
                    delete prev.ready;
                return;
            }
            byKey.set(key, {
                path: abs,
                name: basename(abs),
                source,
                ...(toolReady ? {} : { ready: false }),
            });
        };
        for (const rawPath of createdPathsFromDescriptor(descriptorFor(msg))) {
            addPath(rawPath, 'tool');
        }
        const artifact = extractDocumentArtifactMetadata(toolName, msg.toolInput, resultContent);
        if (artifact) {
            const outputPath = typeof asRecord(msg.toolInput)?.outPath === 'string'
                ? asRecord(msg.toolInput).outPath
                : undefined;
            if (outputPath) {
                const abs = canonicalizeWindowsShape(resolveToolFilePath(outputPath, workingDir));
                const key = dedupeKeyForPath(abs);
                const existing = byKey.get(key);
                const artifactConfirmed = parseToolResult(resultContent)?.ok === true;
                if (existing) {
                    if (!toolReady || toolFailed) {
                    }
                    else {
                        existing.artifact = artifact;
                        if (artifactConfirmed)
                            existing.artifactConfirmed = true;
                        delete existing.ready;
                    }
                }
                else {
                    byKey.set(key, {
                        path: abs,
                        name: basename(abs),
                        source: 'tool',
                        artifact,
                        ...(artifactConfirmed ? { artifactConfirmed: true } : {}),
                        ...(toolReady ? {} : { ready: false }),
                    });
                }
            }
        }
        const descriptor = descriptorFor(msg);
        if (descriptor.kind === 'command' && descriptor.command) {
            for (const rawPath of extractCommandOutputPathCandidates(descriptor.command)) {
                addPath(rawPath, 'command');
            }
        }
        if (descriptor.kind === 'fileChange' && toolReady && !toolFailed) {
            for (const change of descriptor.changes) {
                if ((change.action === 'delete' || change.action === 'move') && change.path) {
                    byKey.delete(dedupeKeyForPath(resolveToolFilePath(change.path, workingDir)));
                }
            }
        }
    }
    for (const msg of messages) {
        if (msg.role !== 'tool_use' || !msg.toolName)
            continue;
        const d = descriptorFor(msg);
        for (const raw of sourcePathCandidatesFromDescriptor(d)) {
            byKey.delete(dedupeKeyForPath(canonicalizeWindowsShape(resolveToolFilePath(raw, workingDir))));
        }
    }
    return [...byKey.values()];
}
