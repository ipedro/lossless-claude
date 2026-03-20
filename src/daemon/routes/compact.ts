import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { DaemonConfig } from "../config.js";
import { projectId, projectDbPath, projectMetaPath, ensureProjectDir } from "../project.js"
import { enqueue } from "../project-queue.js";
import { sendJson } from "../server.js";
import type { RouteHandler } from "../server.js";
import { runLcmMigrations } from "../../db/migration.js";
import { ConversationStore } from "../../store/conversation-store.js";
import { SummaryStore } from "../../store/summary-store.js";
import { CompactionEngine } from "../../compaction.js";
import { createClaudeProcessSummarizer } from "../../llm/claude-process.js";
import { shouldPromote } from "../../promotion/detector.js";
import { PromotedStore } from "../../db/promoted.js";
import { deduplicateAndInsert } from "../../promotion/dedup.js";
import { parseTranscript } from "../../transcript.js";

// In-memory justCompacted map (session_id -> timestamp)
export const justCompactedMap = new Map<string, number>();
export const JUST_COMPACTED_TTL_MS = 30_000;

// Guard against concurrent compactions for the same session
const compactingNow = new Set<string>();

async function resolveSummarizer(config: DaemonConfig) {
  if (config.llm.provider === "disabled") return null;
  if (config.llm.provider === "claude-process") return createClaudeProcessSummarizer();
  if (config.llm.provider === "openai") {
    const { createOpenAISummarizer } = await import("../../llm/openai.js");
    return createOpenAISummarizer({
      model: config.llm.model,
      baseURL: config.llm.baseURL,
      apiKey: config.llm.apiKey,
    });
  }
  // anthropic
  const { createAnthropicSummarizer } = await import("../../llm/anthropic.js");
  return createAnthropicSummarizer({
    model: config.llm.model,
    apiKey: config.llm.apiKey!,
  });
}

export function createCompactHandler(config: DaemonConfig): RouteHandler {
  const summarizeP = resolveSummarizer(config);

  return async (_req, res, body) => {
    const summarize = await summarizeP;
    // When summarization is disabled, return early with informative message
    if (!summarize) {
      sendJson(res, 200, { summary: "Summarization disabled — no summarizer configured." });
      return;
    }

    const input = JSON.parse(body || "{}");
    const { session_id, cwd, transcript_path } = input;

    if (!session_id || !cwd) {
      sendJson(res, 400, { error: "session_id and cwd are required" });
      return;
    }

    if (compactingNow.has(session_id)) {
      sendJson(res, 200, { skipped: true, summary: "Compaction already in progress for this session." });
      return;
    }
    compactingNow.add(session_id);

    const pid = projectId(cwd);
    const result = await enqueue(pid, async () => {
    try {

    const dbPath = projectDbPath(cwd);
    ensureProjectDir(cwd);

    const db = new DatabaseSync(dbPath);
    db.exec("PRAGMA busy_timeout = 5000");
    runLcmMigrations(db);

    const conversationStore = new ConversationStore(db);
    const summaryStore = new SummaryStore(db);
    const conversation = await conversationStore.getOrCreateConversation(session_id);

    // Ingest new messages from the transcript into the DB.
    if (transcript_path && existsSync(transcript_path)) {
      const parsed = parseTranscript(transcript_path);
      const storedCount = await conversationStore.getMessageCount(conversation.conversationId);
      const newMessages = parsed.slice(storedCount);
      if (newMessages.length > 0) {
        const inputs = newMessages.map((m, i) => ({
          conversationId: conversation.conversationId,
          seq: storedCount + i,
          role: m.role as "user" | "assistant" | "system",
          content: m.content,
          tokenCount: m.tokenCount,
        }));
        const records = await conversationStore.createMessagesBulk(inputs);
        await summaryStore.appendContextMessages(conversation.conversationId, records.map((r) => r.messageId));
      }
    }

    // Check if there's anything to compact
    const tokenCount = await summaryStore.getContextTokenCount(conversation.conversationId);

    if (tokenCount === 0) {
      db.close();
      return { summary: "No messages to compact." };
    }

    const engine = new CompactionEngine(conversationStore, summaryStore, {
      contextThreshold: 0.75,
      freshTailCount: 8,
      leafMinFanout: 3,
      condensedMinFanout: 2,
      condensedMinFanoutHard: 1,
      incrementalMaxDepth: 0,
      leafTargetTokens: config.compaction.leafTokens,
      condensedTargetTokens: 900,
      maxRounds: 10,
    });

    const compactResult = await engine.compact({
      conversationId: conversation.conversationId,
      tokenBudget: 200_000,
      summarize,
      force: true,
    });

    // Promote worthy summaries to cross-session memory (SQLite promoted table)
    let promotedCount = 0;
    if (compactResult.actionTaken && compactResult.createdSummaryId) {
      try {
        const summaries = await summaryStore.getSummariesByConversation(conversation.conversationId);
        const newSummary = summaries.find((s) => s.summaryId === compactResult.createdSummaryId);
        if (newSummary) {
          const promotionResult = shouldPromote(
            {
              content: newSummary.content,
              depth: newSummary.depth,
              tokenCount: newSummary.tokenCount,
              sourceMessageTokenCount: newSummary.sourceMessageTokenCount,
            },
            config.compaction.promotionThresholds,
          );
          if (promotionResult.promote) {
            const promotedStore = new PromotedStore(db);
            await deduplicateAndInsert({
              store: promotedStore,
              content: newSummary.content,
              tags: promotionResult.tags,
              projectId: pid,
              sessionId: session_id,
              depth: newSummary.depth,
              confidence: promotionResult.confidence,
              summarize,
              thresholds: {
                dedupBm25Threshold: config.compaction.promotionThresholds.dedupBm25Threshold,
                mergeMaxEntries: config.compaction.promotionThresholds.mergeMaxEntries,
                confidenceDecayRate: config.compaction.promotionThresholds.confidenceDecayRate,
              },
            });
            promotedCount = 1;
          }
        }
      } catch { /* non-fatal */ }
    }

    // Update meta.json
    try {
      const metaPath = projectMetaPath(cwd);
      let meta: Record<string, unknown> = {};
      if (existsSync(metaPath)) {
        meta = JSON.parse(readFileSync(metaPath, "utf-8"));
      }
      meta.cwd = cwd;
      meta.lastCompact = new Date().toISOString();
      writeFileSync(metaPath, JSON.stringify(meta, null, 2));
    } catch { /* non-fatal */ }

    // Set justCompacted flag
    justCompactedMap.set(session_id, Date.now());

    db.close();

    const tokenDelta = compactResult.tokensBefore - compactResult.tokensAfter;
    const summaryMsg = compactResult.actionTaken
      ? `Compacted ${compactResult.tokensBefore} → ${compactResult.tokensAfter} tokens (saved ${tokenDelta}). ${promotedCount} promoted to long-term memory.`
      : "No compaction needed.";

    return { summary: summaryMsg };

    } finally {
      compactingNow.delete(session_id);
    }
    }) // end enqueue

    sendJson(res, 200, result);
  };
}
