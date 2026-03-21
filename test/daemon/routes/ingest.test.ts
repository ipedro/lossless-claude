import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDaemon, type DaemonInstance } from "../../../src/daemon/server.js";
import { loadDaemonConfig } from "../../../src/daemon/config.js";

const tempDirs: string[] = [];

describe("POST /ingest", () => {
  let daemon: DaemonInstance | undefined;

  afterEach(async () => {
    if (daemon) {
      await daemon.stop();
      daemon = undefined;
    }
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("accepts messages[] as an alternative to transcript_path", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lossless-ingest-"));
    tempDirs.push(tempDir);

    daemon = await createDaemon(loadDaemonConfig("/nonexistent", { daemon: { port: 0 } }));
    const res = await fetch(`http://127.0.0.1:${daemon.address().port}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "codex-test-1",
        cwd: tempDir,
        messages: [
          { role: "user", content: "hello", tokenCount: 1 },
          { role: "assistant", content: "hi", tokenCount: 1 },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ingested: 2, totalTokens: 2 });
  });

  it("accepts tool messages in structured ingestion mode", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lossless-ingest-tool-"));
    tempDirs.push(tempDir);

    daemon = await createDaemon(loadDaemonConfig("/nonexistent", { daemon: { port: 0 } }));
    const res = await fetch(`http://127.0.0.1:${daemon.address().port}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "codex-test-tool",
        cwd: tempDir,
        messages: [
          { role: "user", content: "run rg", tokenCount: 2 },
          { role: "assistant", content: "Tool call shell: rg --files", tokenCount: 6 },
          { role: "tool", content: "README.md", tokenCount: 2 },
          { role: "assistant", content: "Done", tokenCount: 1 },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ingested: 4, totalTokens: 11 });
  });

  it("prefers messages[] over transcript_path when both are present", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lossless-ingest-both-"));
    tempDirs.push(tempDir);

    daemon = await createDaemon(loadDaemonConfig("/nonexistent", { daemon: { port: 0 } }));
    const res = await fetch(`http://127.0.0.1:${daemon.address().port}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "codex-test-2",
        cwd: tempDir,
        transcript_path: "/definitely/missing.jsonl",
        messages: [
          { role: "user", content: "preferred", tokenCount: 2 },
          { role: "assistant", content: "path", tokenCount: 1 },
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ingested: 2, totalTokens: 3 });
  });

  it("returns ingested=0 when transcript_path is missing and messages[] is absent", async () => {
    const tempDir = mkdtempSync(join(tmpdir(), "lossless-ingest-missing-"));
    tempDirs.push(tempDir);

    daemon = await createDaemon(loadDaemonConfig("/nonexistent", { daemon: { port: 0 } }));
    const res = await fetch(`http://127.0.0.1:${daemon.address().port}/ingest`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        session_id: "codex-test-3",
        cwd: tempDir,
        transcript_path: "/definitely/missing.jsonl",
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ingested: 0, totalTokens: 0 });
  });
});
