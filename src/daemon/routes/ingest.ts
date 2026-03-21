import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { DaemonConfig } from "../config.js";
import { projectDbPath, ensureProjectDir } from "../project.js";
import { sendJson } from "../server.js";
import type { RouteHandler } from "../server.js";
import { runLcmMigrations } from "../../db/migration.js";
import { ConversationStore } from "../../store/conversation-store.js";
import { SummaryStore } from "../../store/summary-store.js";
import { parseTranscript, type ParsedMessage } from "../../transcript.js";

function isParsedMessage(value: unknown): value is ParsedMessage {
  if (!value || typeof value !== "object") return false;

  const message = value as Record<string, unknown>;
  return (
    typeof message.role === "string" &&
    ["user", "assistant", "system", "tool"].includes(message.role) &&
    typeof message.content === "string" &&
    typeof message.tokenCount === "number"
  );
}

function resolveMessages(input: { messages?: unknown; transcript_path?: string }): ParsedMessage[] {
  if (Array.isArray(input.messages)) {
    return input.messages.filter(isParsedMessage);
  }

  if (input.transcript_path && existsSync(input.transcript_path)) {
    return parseTranscript(input.transcript_path);
  }

  return [];
}

export function createIngestHandler(_config: DaemonConfig): RouteHandler {
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

    const db = new DatabaseSync(dbPath);
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

      const inputs = newMessages.map((m, i) => ({
        conversationId: conversation.conversationId,
        seq: storedCount + i,
        role: m.role as "user" | "assistant" | "system" | "tool",
        content: m.content,
        tokenCount: m.tokenCount,
      }));
      const records = await conversationStore.createMessagesBulk(inputs);
      await summaryStore.appendContextMessages(conversation.conversationId, records.map((r) => r.messageId));

      const totalTokens = await summaryStore.getContextTokenCount(conversation.conversationId);
      sendJson(res, 200, { ingested: records.length, totalTokens });
    } finally {
      db.close();
    }
  };
}
