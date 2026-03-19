import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";
function loadStoreWithDedup(collection) {
    const require = createRequire(import.meta.url);
    const store = require(join(homedir(), ".local", "lib", "qdrant-store.js"));
    return (text, tags, meta) => store.storeWithDedup(collection, text, tags, meta);
}
export async function promoteSummary(params) {
    const store = params._storeWithDedup ?? loadStoreWithDedup(params.collection);
    await store(params.text, params.tags, {
        projectId: params.projectId,
        projectPath: params.projectPath,
        depth: params.depth,
        sessionId: params.sessionId,
        timestamp: new Date().toISOString(),
        source: "compaction",
        confidence: params.confidence,
    });
}
//# sourceMappingURL=promoter.js.map