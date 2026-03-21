import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, it, expect, afterEach, vi } from "vitest";
import { createDaemon, type DaemonInstance } from "../../../src/daemon/server.js";
import { loadDaemonConfig } from "../../../src/daemon/config.js";
import { projectDbPath } from "../../../src/daemon/project.js";
import { ConversationStore } from "../../../src/store/conversation-store.js";

// --- Summarizer branching unit tests ---

vi.mock("../../../src/llm/anthropic.js", () => ({
  createAnthropicSummarizer: vi.fn().mockReturnValue(async () => "anthropic-summary"),
}));

vi.mock("../../../src/llm/openai.js", () => ({
  createOpenAISummarizer: vi.fn().mockReturnValue(async () => "openai-summary"),
}));

import { createAnthropicSummarizer } from "../../../src/llm/anthropic.js";
import { createOpenAISummarizer } from "../../../src/llm/openai.js";
import { createCompactHandler, buildCompactionMessage } from "../../../src/daemon/routes/compact.js";
import type { DaemonConfig } from "../../../src/daemon/config.js";

function mockRes() {
  let body = "";
  const res = {
    writeHead: vi.fn().mockReturnThis(),
    end: vi.fn((data?: string) => { body = data ?? ""; }),
  } as any;
  return { res, getBody: () => JSON.parse(body || "{}") };
}

function makeConfig(provider: "anthropic" | "openai" | "disabled"): DaemonConfig {
  return {
    version: 1,
    daemon: { port: 3737, socketPath: "/tmp/test.sock", logLevel: "info", logMaxSizeMB: 10, logRetentionDays: 7, idleTimeoutMs: 1800000 },
    compaction: {
      leafTokens: 1000, maxDepth: 5,
      promotionThresholds: { minDepth: 2, compressionRatio: 0.3, keywords: {}, architecturePatterns: [], dedupBm25Threshold: 15, mergeMaxEntries: 3, confidenceDecayRate: 0.1 },
    },
    restoration: { recentSummaries: 3, promptSearchMinScore: 10, promptSearchMaxResults: 3, promptSnippetLength: 200, recencyHalfLifeHours: 24, crossSessionAffinity: 0.5 },
    llm: { provider, model: "test-model", apiKey: "sk-test", baseURL: "http://localhost:11435/v1" },
    claudeCliProxy: { enabled: true, port: 3456, startupTimeoutMs: 10000, model: "claude-haiku-4-5" },
    cipher: { configPath: "/tmp/cipher.yml", collection: "test" },
  } as DaemonConfig;
}

async function readMessageCount(cwd: string, sessionId: string): Promise<number> {
  const db = new DatabaseSync(projectDbPath(cwd));

  try {
    const conversationStore = new ConversationStore(db);
    const conversation = await conversationStore.getOrCreateConversation(sessionId);
    return conversationStore.getMessageCount(conversation.conversationId);
  } finally {
    db.close();
  }
}

describe("buildCompactionMessage", () => {
  const base = {
    tokensBefore: 10_000, tokensAfter: 1_000,
    messageCount: 50, summaryCount: 3,
    maxDepth: 2, promotedCount: 0,
  };

  it("contains the header and closing motto", () => {
    const msg = buildCompactionMessage(base);
    expect(msg).toContain("lossless-claude · compaction complete");
    expect(msg).toContain("Nothing was lost. Everything is remembered.");
  });

  it("calculates correct compression percentage (90% for 10x)", () => {
    const msg = buildCompactionMessage(base);
    expect(msg).toContain("90.0% saved");
  });

  it("shows message and summary counts", () => {
    const msg = buildCompactionMessage(base);
    expect(msg).toContain("messages  →  3 summaries");
    expect(msg).toContain("DAG layers deep");
  });

  it("shows promoted insight (singular) when promotedCount is 1", () => {
    const msg = buildCompactionMessage({ ...base, promotedCount: 1 });
    expect(msg).toContain("insight promoted to long-term memory");
    expect(msg).not.toContain("insights promoted");
  });

  it("shows promoted insights (plural) when promotedCount > 1", () => {
    const msg = buildCompactionMessage({ ...base, promotedCount: 3 });
    expect(msg).toContain("insights promoted to long-term memory");
  });

  it("omits promoted row when promotedCount is 0", () => {
    const msg = buildCompactionMessage({ ...base, promotedCount: 0 });
    expect(msg).not.toContain("promoted");
  });

  it("shows dash for ratio when tokensAfter is 0", () => {
    const msg = buildCompactionMessage({ ...base, tokensAfter: 0 });
    expect(msg).toContain("–");
  });

  it("bar is fully filled when all tokens are saved", () => {
    // tokensBefore > 0, tokensAfter = 0 → filled = 30, empty = 0
    const msg = buildCompactionMessage({ ...base, tokensAfter: 0 });
    expect(msg).toContain("█".repeat(30));
    expect(msg).not.toContain("░");
  });

  it("bar is fully empty when nothing is saved", () => {
    // tokensBefore === tokensAfter → saved = 0
    const msg = buildCompactionMessage({ ...base, tokensBefore: 1000, tokensAfter: 1000 });
    expect(msg).toContain("░".repeat(30));
    expect(msg).not.toContain("█");
  });

  it("formats token counts with K suffix for large numbers", () => {
    const msg = buildCompactionMessage({ ...base, tokensBefore: 50_000, tokensAfter: 5_000 });
    expect(msg).toContain("50.0K");
    expect(msg).toContain("5.0K");
  });

  it("border is 46 ━ characters wide", () => {
    const msg = buildCompactionMessage(base);
    expect(msg).toContain("━".repeat(46));
  });
});

describe("createCompactHandler — summarizer branching", () => {
  it("uses createAnthropicSummarizer when provider is anthropic", async () => {
    vi.clearAllMocks();
    const handler = createCompactHandler(makeConfig("anthropic"));
    // Trigger the handler to resolve the lazy import
    const { res } = mockRes();
    await handler({} as any, res, JSON.stringify({ session_id: "s1", cwd: "/tmp/test-anthropic" }));
    expect(createAnthropicSummarizer).toHaveBeenCalledWith(expect.objectContaining({ model: "test-model" }));
    expect(createOpenAISummarizer).not.toHaveBeenCalled();
  });

  it("uses createOpenAISummarizer when provider is openai", async () => {
    vi.clearAllMocks();
    const handler = createCompactHandler(makeConfig("openai"));
    const { res } = mockRes();
    await handler({} as any, res, JSON.stringify({ session_id: "s1", cwd: "/tmp/test-openai" }));
    expect(createOpenAISummarizer).toHaveBeenCalledWith(
      expect.objectContaining({ model: "test-model", baseURL: "http://localhost:11435/v1" })
    );
    expect(createAnthropicSummarizer).not.toHaveBeenCalled();
  });

  it("returns no-op when provider is 'disabled' — no summarizer created", async () => {
    vi.clearAllMocks();
    const handler = createCompactHandler(makeConfig("disabled"));
    const { res, getBody } = mockRes();
    await handler({} as any, res, JSON.stringify({ session_id: "s1", cwd: "/tmp/test-disabled" }));
    expect(createAnthropicSummarizer).not.toHaveBeenCalled();
    expect(createOpenAISummarizer).not.toHaveBeenCalled();
    expect(getBody().summary).toContain("disabled");
  });
});

describe("POST /compact", () => {
  let daemon: DaemonInstance | undefined;
  const tempDirs: string[] = [];

  afterEach(async () => {
    if (daemon) {
      await daemon.stop();
      daemon = undefined;
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts compact request and returns summary", async () => {
    daemon = await createDaemon(loadDaemonConfig("/x", { daemon: { port: 0 }, llm: { apiKey: "sk-test" } }));
    const res = await fetch(`http://127.0.0.1:${daemon.address().port}/compact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "test-sess", cwd: "/tmp/test-compact-proj", hook_event_name: "PreCompact" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("summary");
    expect(typeof body.summary).toBe("string");
  });

  it("skips transcript ingestion when skip_ingest is true", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lossless-compact-"));
    tempDirs.push(tempDir);

    const transcriptPath = join(tempDir, "session.jsonl");
    writeFileSync(
      transcriptPath,
      [
        JSON.stringify({ message: { role: "user", content: "transcript user 1" } }),
        JSON.stringify({ message: { role: "assistant", content: "transcript assistant 1" } }),
        JSON.stringify({ message: { role: "user", content: "transcript user 2" } }),
        JSON.stringify({ message: { role: "assistant", content: "transcript assistant 2" } }),
        JSON.stringify({ message: { role: "user", content: "transcript user 3" } }),
        JSON.stringify({ message: { role: "assistant", content: "transcript assistant 3" } }),
      ].join("\n"),
    );

    daemon = await createDaemon(loadDaemonConfig("/x", {
      daemon: { port: 0 },
      llm: { provider: "openai", model: "test-model", apiKey: "sk-test", baseURL: "http://localhost:11435/v1" },
    }));

    const baseUrl = `http://127.0.0.1:${daemon.address().port}`;
    const sessionId = "skip-ingest-session";

    const ingestRes = await fetch(`${baseUrl}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        cwd: tempDir,
        messages: [
          { role: "user", content: "stored user 1", tokenCount: 3 },
          { role: "assistant", content: "stored assistant 1", tokenCount: 4 },
          { role: "user", content: "stored user 2", tokenCount: 3 },
          { role: "assistant", content: "stored assistant 2", tokenCount: 4 },
        ],
      }),
    });

    expect(ingestRes.status).toBe(200);
    expect(await ingestRes.json()).toEqual({ ingested: 4 });
    expect(await readMessageCount(tempDir, sessionId)).toBe(4);

    const compactRes = await fetch(`${baseUrl}/compact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: sessionId,
        cwd: tempDir,
        transcript_path: transcriptPath,
        skip_ingest: true,
      }),
    });

    expect(compactRes.status).toBe(200);
    expect(await readMessageCount(tempDir, sessionId)).toBe(4);
  });
});

describe("POST /compact with disabled provider", () => {
  let daemon: DaemonInstance | undefined;
  afterEach(async () => { if (daemon) { await daemon.stop(); daemon = undefined; } });

  it("returns early with message when provider is disabled", async () => {
    const config = loadDaemonConfig("/x", {
      daemon: { port: 0 },
      llm: { provider: "disabled" },
    });
    daemon = await createDaemon(config);
    const res = await fetch(`http://127.0.0.1:${daemon.address().port}/compact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "test-sess", cwd: "/tmp/test-disabled-proj" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.summary).toContain("disabled");
  });
});
