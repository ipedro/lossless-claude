import { describe, it, expect, afterEach, vi } from "vitest";
import { createDaemon, type DaemonInstance } from "../../../src/daemon/server.js";
import { loadDaemonConfig } from "../../../src/daemon/config.js";

// --- Summarizer branching unit tests ---

vi.mock("../../../src/llm/anthropic.js", () => ({
  createAnthropicSummarizer: vi.fn().mockReturnValue(async () => "anthropic-summary"),
}));

vi.mock("../../../src/llm/openai.js", () => ({
  createOpenAISummarizer: vi.fn().mockReturnValue(async () => "openai-summary"),
}));

import { createAnthropicSummarizer } from "../../../src/llm/anthropic.js";
import { createOpenAISummarizer } from "../../../src/llm/openai.js";
import { createCompactHandler } from "../../../src/daemon/routes/compact.js";
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

describe("createCompactHandler — summarizer branching", () => {
  it("uses createAnthropicSummarizer when provider is anthropic", async () => {
    vi.clearAllMocks();
    const handler = createCompactHandler(makeConfig("anthropic"));
    // Trigger the handler to resolve the lazy import
    const { res, getBody } = mockRes();
    await handler({} as any, res, JSON.stringify({ session_id: "s1", cwd: "/tmp/test-anthropic" }));
    expect(createAnthropicSummarizer).toHaveBeenCalledWith(expect.objectContaining({ model: "test-model" }));
    expect(createOpenAISummarizer).not.toHaveBeenCalled();
  });

  it("uses createOpenAISummarizer when provider is openai", async () => {
    vi.clearAllMocks();
    const handler = createCompactHandler(makeConfig("openai"));
    const { res, getBody } = mockRes();
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
  afterEach(async () => { if (daemon) { await daemon.stop(); daemon = undefined; } });

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
