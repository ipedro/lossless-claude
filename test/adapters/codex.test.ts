import { EventEmitter } from "node:events";
import { readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  composeCodexTurnPrompt,
  createLosslessCodexSessionId,
  normalizeCodexExecJsonl,
  runLosslessCodexTurn,
  type LosslessCodexSession,
  type RunLosslessCodexDeps,
} from "../../src/adapters/codex.js";

function createSpawnedCodexProcess(stdoutText: string, exitCode = 0): ChildProcessWithoutNullStreams {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = vi.fn(() => true as any);
  child.pid = 12345;

  queueMicrotask(() => {
    if (stdoutText) child.stdout.write(stdoutText);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", exitCode);
  });

  return child;
}

function makeDeps(overrides: Partial<RunLosslessCodexDeps> = {}): RunLosslessCodexDeps {
  return {
    ensureDaemon: vi.fn().mockResolvedValue({ connected: true, port: 3737, spawned: false }),
    client: {
      post: vi.fn(async (path: string) => {
        if (path === "/restore") return { context: "Recovered memory" };
        if (path === "/prompt-search") return { hints: ["Use the project daemon"] };
        if (path === "/ingest") return { ingested: 4 };
        if (path === "/compact") return { summary: "Compacted" };
        return {};
      }),
    },
    spawn: vi.fn().mockImplementation(() =>
      createSpawnedCodexProcess(readFileSync("test/fixtures/codex/exec-turn.jsonl", "utf8"))
    ),
    resolveBinaryPath: vi.fn().mockReturnValue("lossless-claude"),
    resolveNativeCodexSessionId: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  };
}

describe("createLosslessCodexSessionId", () => {
  it("prefixes LCM session ids with codex-", () => {
    expect(createLosslessCodexSessionId()).toMatch(/^codex-[0-9a-f-]+$/);
  });
});

describe("normalizeCodexExecJsonl", () => {
  it("normalizes codex jsonl events into parsed messages including tool activity", () => {
    const jsonl = readFileSync("test/fixtures/codex/exec-turn.jsonl", "utf8");
    const messages = normalizeCodexExecJsonl(jsonl);

    expect(messages).toEqual([
      expect.objectContaining({ role: "user", content: "List the project files" }),
      expect.objectContaining({ role: "assistant", content: "Tool call shell: rg --files" }),
      expect.objectContaining({ role: "tool", content: expect.stringContaining("README.md") }),
      expect.objectContaining({ role: "assistant", content: "I found the project files." }),
    ]);
  });
});

describe("composeCodexTurnPrompt", () => {
  it("formats restore and prompt-search context as plain text for codex", () => {
    const prompt = composeCodexTurnPrompt({
      restoreContext: "<memory-orientation>restored</memory-orientation>",
      promptHints: ["remember the daemon port", "project uses sqlite"],
      userPrompt: "continue",
    });

    expect(prompt).toContain("continue");
    expect(prompt).toContain("remember the daemon port");
    expect(prompt).not.toContain("<system-reminder>");
    expect(prompt).not.toContain("<system>");
  });
});

describe("runLosslessCodexTurn", () => {
  it("uses codex exec --json on the first turn", async () => {
    const deps = makeDeps();
    const session: LosslessCodexSession = {
      lcmSessionId: createLosslessCodexSessionId(),
      cwd: "/tmp/project",
      restoreLoaded: false,
    };

    await runLosslessCodexTurn(session, "hello", deps);

    expect(deps.spawn).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["exec", "--json", expect.any(String)]),
      expect.anything(),
    );
  });

  it("uses codex exec resume <native-id> --json on later turns", async () => {
    const deps = makeDeps();
    const session: LosslessCodexSession = {
      lcmSessionId: createLosslessCodexSessionId(),
      codexSessionId: "native-codex-session",
      cwd: "/tmp/project",
      restoreLoaded: true,
    };

    await runLosslessCodexTurn(session, "continue", deps);

    expect(deps.spawn).toHaveBeenCalledWith(
      "codex",
      expect.arrayContaining(["exec", "resume", "native-codex-session", "--json", expect.any(String)]),
      expect.anything(),
    );
  });

  it("falls back to fresh codex exec turns when no native Codex session id can be resolved", async () => {
    const deps = makeDeps({
      resolveNativeCodexSessionId: vi.fn().mockResolvedValue(undefined),
    });
    const session: LosslessCodexSession = {
      lcmSessionId: createLosslessCodexSessionId(),
      cwd: "/tmp/project",
      restoreLoaded: false,
    };

    await runLosslessCodexTurn(session, "hello", deps);
    session.codexSessionId = undefined;
    await runLosslessCodexTurn(session, "continue", deps);

    expect(deps.spawn).toHaveBeenNthCalledWith(
      2,
      "codex",
      expect.arrayContaining(["exec", "--json", expect.any(String)]),
      expect.anything(),
    );
  });

  it("degrades to pass-through codex when daemon startup fails", async () => {
    const deps = makeDeps({
      ensureDaemon: vi.fn().mockResolvedValue({ connected: false, port: 3737, spawned: false }),
    });
    const session: LosslessCodexSession = {
      lcmSessionId: createLosslessCodexSessionId(),
      cwd: "/tmp/project",
      restoreLoaded: false,
    };

    await runLosslessCodexTurn(session, "hello", deps);

    expect(deps.spawn).toHaveBeenCalled();
    expect(deps.client.post).not.toHaveBeenCalledWith("/restore", expect.anything());
    expect(deps.client.post).not.toHaveBeenCalledWith("/ingest", expect.anything());
  });

  it("returns a friendly error when the Codex CLI is missing", async () => {
    const deps = makeDeps({
      spawn: vi.fn().mockImplementation(() => {
        throw Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" });
      }),
    });
    const session: LosslessCodexSession = {
      lcmSessionId: createLosslessCodexSessionId(),
      cwd: "/tmp/project",
      restoreLoaded: false,
    };

    const result = await runLosslessCodexTurn(session, "hello", deps);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain("Codex CLI is not installed or not on PATH");
    expect(result.stderr).toContain("npm install -g @openai/codex");
  });

  it("calls restore once, prompt-search every turn, ingest every turn, and compact with skip_ingest", async () => {
    const deps = makeDeps();
    const session: LosslessCodexSession = {
      lcmSessionId: createLosslessCodexSessionId(),
      cwd: "/tmp/project",
      restoreLoaded: false,
    };

    await runLosslessCodexTurn(session, "hello", deps);
    await runLosslessCodexTurn(session, "continue", deps);

    expect(deps.client.post).toHaveBeenCalledWith(
      "/restore",
      expect.objectContaining({ session_id: session.lcmSessionId }),
    );
    expect(deps.client.post).toHaveBeenCalledWith(
      "/prompt-search",
      expect.objectContaining({ query: "hello" }),
    );
    expect(deps.client.post).toHaveBeenCalledWith(
      "/prompt-search",
      expect.objectContaining({ query: "continue" }),
    );
    expect(deps.client.post).toHaveBeenCalledWith(
      "/ingest",
      expect.objectContaining({ messages: expect.any(Array) }),
    );
    expect(deps.client.post).toHaveBeenCalledWith(
      "/compact",
      expect.objectContaining({ skip_ingest: true }),
    );
  });
});
