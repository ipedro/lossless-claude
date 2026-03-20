import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { projectDbPath, ensureProjectDir } from "../project.js";
import { sendJson } from "../server.js";
import { runLcmMigrations } from "../../db/migration.js";
import { ConversationStore } from "../../store/conversation-store.js";
import { SummaryStore } from "../../store/summary-store.js";
import { parseTranscript } from "../../transcript.js";
export function createIngestHandler(_config) {
    return async (_req, res, body) => {
        const input = JSON.parse(body || "{}");
        const { session_id, cwd, transcript_path } = input;
        if (!session_id || !cwd) {
            sendJson(res, 400, { error: "session_id and cwd are required" });
            return;
        }
        if (!transcript_path || !existsSync(transcript_path)) {
            sendJson(res, 200, { ingested: 0 });
            return;
        }
        const dbPath = projectDbPath(cwd);
        ensureProjectDir(cwd);
        const db = new DatabaseSync(dbPath);
        runLcmMigrations(db);
        try {
            const conversationStore = new ConversationStore(db);
            const summaryStore = new SummaryStore(db);
            const conversation = await conversationStore.getOrCreateConversation(session_id);
            const parsed = parseTranscript(transcript_path);
            const storedCount = await conversationStore.getMessageCount(conversation.conversationId);
            const newMessages = parsed.slice(storedCount);
            if (newMessages.length === 0) {
                sendJson(res, 200, { ingested: 0 });
                return;
            }
            const inputs = newMessages.map((m, i) => ({
                conversationId: conversation.conversationId,
                seq: storedCount + i,
                role: m.role,
                content: m.content,
                tokenCount: m.tokenCount,
            }));
            const records = await conversationStore.createMessagesBulk(inputs);
            await summaryStore.appendContextMessages(conversation.conversationId, records.map((r) => r.messageId));
            sendJson(res, 200, { ingested: records.length });
        }
        finally {
            db.close();
        }
    };
}
//# sourceMappingURL=ingest.js.map