import { DaemonClient } from "../daemon/client.js";
export function createMemoryApi(client) {
    return {
        async store(text, tags, metadata) {
            await client.post("/store", { text, tags, metadata });
        },
        async search(query, options) {
            return client.post("/search", { query, ...options });
        },
        async compact(sessionId, transcriptPath) {
            return client.post("/compact", { session_id: sessionId, transcript_path: transcriptPath });
        },
        async recent(projectId, limit = 5) {
            return client.post("/recent", { projectId, limit });
        },
    };
}
// Convenience singleton with default daemon address
const defaultClient = new DaemonClient("http://127.0.0.1:3737");
export const memory = createMemoryApi(defaultClient);
//# sourceMappingURL=index.js.map