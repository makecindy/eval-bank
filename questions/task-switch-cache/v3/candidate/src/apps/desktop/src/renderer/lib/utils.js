export function basename(filePath) {
    if (!filePath)
        return filePath;
    const parts = filePath.split(/[\\/]/);
    return parts[parts.length - 1] || filePath;
}
