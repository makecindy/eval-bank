import { stripTrailingPathSeparators as stripTrailingPathSeparators } from "./pathText.js";
export function basenameRemotePath(remotePath) {
    const normalized = stripTrailingPathSeparators(remotePath);
    const slash = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
    return slash < 0 ? normalized : normalized.slice(slash + 1);
}
