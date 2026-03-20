import { renderTemplate } from "../prompts/loader.js";
export async function deduplicateAndInsert(params) {
    const { store, content, tags, projectId, sessionId, depth, confidence, summarize, thresholds } = params;
    // Search for duplicates using FTS5
    const candidates = store.search(content, thresholds.mergeMaxEntries);
    // Filter to entries above BM25 threshold (rank is negative; more negative = better match)
    const duplicates = candidates.filter((c) => c.rank <= -thresholds.dedupBm25Threshold);
    if (duplicates.length === 0) {
        return store.insert({ content, tags, projectId, sessionId, depth, confidence });
    }
    // Merge: combine all duplicate entries + new content
    const allEntries = [...duplicates.map((d) => d.content), content];
    const entriesText = allEntries.map((e, i) => `Entry ${i + 1}:\n${e}`).join("\n\n");
    const mergePrompt = renderTemplate("promoted-merge", { entries: entriesText });
    let mergedContent;
    try {
        mergedContent = await summarize(mergePrompt);
    }
    catch {
        // Merge failed — insert as new entry rather than losing data
        return store.insert({ content, tags, projectId, sessionId, depth, confidence });
    }
    if (!mergedContent.trim()) {
        return store.insert({ content, tags, projectId, sessionId, depth, confidence });
    }
    // Calculate merged confidence
    const maxConfidence = Math.max(confidence, ...duplicates.map((d) => d.confidence));
    const mergedConfidence = Math.max(0, maxConfidence - thresholds.confidenceDecayRate);
    // Delete old duplicates
    for (const dup of duplicates) {
        store.deleteById(dup.id);
    }
    // Archive if confidence too low
    if (mergedConfidence < 0.2) {
        const id = store.insert({ content: mergedContent, tags, projectId, sessionId, depth, confidence: mergedConfidence });
        store.archive(id);
        // Insert fresh entry with original confidence
        return store.insert({ content, tags, projectId, sessionId, depth, confidence });
    }
    // Insert merged entry
    return store.insert({ content: mergedContent, tags, projectId, sessionId, depth, confidence: mergedConfidence });
}
//# sourceMappingURL=dedup.js.map