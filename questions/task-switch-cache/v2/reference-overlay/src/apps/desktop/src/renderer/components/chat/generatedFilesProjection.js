import { createMessageProjectionCache as createMessageProjectionCache } from "./messageProjectionCache.js";
import { collectGeneratedFiles as collectGeneratedFiles } from "../../lib/generatedFiles.js";
export const project = createMessageProjectionCache();
export function collectCachedGeneratedFiles(messages, workingDir) {
    if (messages.length === 0)
        return [];
    return project(messages[0], [workingDir, messages.length, ...messages], () => collectGeneratedFiles(messages, workingDir));
}
