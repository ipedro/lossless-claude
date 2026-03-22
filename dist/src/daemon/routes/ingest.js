import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { projectDbPath, projectDir, projectId, ensureProjectDir } from "../project.js";
import { sendJson } from "../server.js";
import { runLcmMigrations } from "../../db/migration.js";
import { upsertRedactionCounts } from "../../db/redaction-stats.js";
import { ConversationStore } from "../../store/conversation-store.js";
import { SummaryStore } from "../../store/summary-store.js";
import { parseTranscript } from "../../transcript.js";
import { ScrubEngine } from "../../scrub.js";
function isParsedMessage(value) {
    if (!value || typeof value !== "object")
        return false;
    const message = value;
    return (typeof message.role === "string" &&
        ["user", "assistant", "system", "tool"].includes(message.role) &&
        typeof message.content === "string" &&
        typeof message.tokenCount === "number");
}
function resolveMessages(input) {
    if (Array.isArray(input.messages)) {
        return input.messages.filter(isParsedMessage);
    }
    if (input.transcript_path && existsSync(input.transcript_path)) {
        return parseTranscript(input.transcript_path);
    }
    return [];
}
export function createIngestHandler(config) {
    return async (_req, res, body) => {
        const input = JSON.parse(body || "{}");
        const { session_id, cwd } = input;
        if (!session_id || !cwd) {
            sendJson(res, 400, { error: "session_id and cwd are required" });
            return;
        }
        const parsed = resolveMessages(input);
        if (parsed.length === 0) {
            sendJson(res, 200, { ingested: 0, totalTokens: 0 });
            return;
        }
        const dbPath = projectDbPath(cwd);
        ensureProjectDir(cwd);
        const scrubber = await ScrubEngine.forProject(config.security?.sensitivePatterns ?? [], projectDir(cwd));
        const db = new DatabaseSync(dbPath);
        db.exec("PRAGMA busy_timeout = 5000");
        runLcmMigrations(db);
        try {
            const conversationStore = new ConversationStore(db);
            const summaryStore = new SummaryStore(db);
            const conversation = await conversationStore.getOrCreateConversation(session_id);
            const storedCount = await conversationStore.getMessageCount(conversation.conversationId);
            const newMessages = parsed.slice(storedCount);
            if (newMessages.length === 0) {
                sendJson(res, 200, { ingested: 0, totalTokens: 0 });
                return;
            }
            const pid = projectId(cwd);
            const totalCounts = { builtIn: 0, global: 0, project: 0 };
            const inputs = newMessages.map((m, i) => {
                const { text: scrubbedContent, builtIn, global, project } = scrubber.scrubWithCounts(m.content);
                totalCounts.builtIn += builtIn;
                totalCounts.global += global;
                totalCounts.project += project;
                return {
                    conversationId: conversation.conversationId,
                    seq: storedCount + i,
                    role: m.role,
                    content: scrubbedContent,
                    tokenCount: m.tokenCount,
                };
            });
            const records = await conversationStore.createMessagesBulk(inputs);
            await summaryStore.appendContextMessages(conversation.conversationId, records.map((r) => r.messageId));
            upsertRedactionCounts(db, pid, totalCounts);
            const totalTokens = await summaryStore.getContextTokenCount(conversation.conversationId);
            sendJson(res, 200, { ingested: records.length, totalTokens });
        }
        finally {
            db.close();
        }
    };
}
//# sourceMappingURL=ingest.js.map