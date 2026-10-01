export function hasReviewableTurnChanges(summary) {
    return summary.fileCount > 0 || summary.files.length > 0;
}
