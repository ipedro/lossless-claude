import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleSessionEnd } from "../../src/hooks/session-end.js";

vi.mock("../../src/daemon/lifecycle.js", () => ({
  ensureDaemon: vi.fn().mockResolvedValue({ connected: true }),
}));

vi.mock("../../src/daemon/config.js", () => ({
  loadDaemonConfig: vi.fn().mockReturnValue({
    compaction: { autoCompactMinTokens: 10000 },
  }),
}));

function createMockClient(ingestResponse: any, compactResponse?: any) {
  return {
    post: vi.fn().mockImplementation((path: string) => {
      if (path === "/ingest") return Promise.resolve(ingestResponse);
      if (path === "/compact") return Promise.resolve(compactResponse ?? { summary: "done" });
      return Promise.reject(new Error(`unexpected path: ${path}`));
    }),
  } as any;
}

describe("handleSessionEnd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("calls /ingest with parsed stdin", async () => {
    const client = createMockClient({ ingested: 5, totalTokens: 500 });
    const stdin = JSON.stringify({ session_id: "s1", cwd: "/tmp" });
    const result = await handleSessionEnd(stdin, client, 3737);
    expect(result.exitCode).toBe(0);
    expect(client.post).toHaveBeenCalledWith("/ingest", { session_id: "s1", cwd: "/tmp" });
  });

  it("calls /compact when totalTokens exceeds threshold", async () => {
    const client = createMockClient(
      { ingested: 100, totalTokens: 25000 },
      { summary: "compacted" },
    );
    const stdin = JSON.stringify({ session_id: "s1", cwd: "/tmp" });
    await handleSessionEnd(stdin, client, 3737);
    expect(client.post).toHaveBeenCalledWith("/compact", {
      session_id: "s1",
      cwd: "/tmp",
      skip_ingest: true,
      client: "claude",
    });
  });

  it("does NOT call /compact when totalTokens is below threshold", async () => {
    const client = createMockClient({ ingested: 5, totalTokens: 500 });
    const stdin = JSON.stringify({ session_id: "s1", cwd: "/tmp" });
    await handleSessionEnd(stdin, client, 3737);
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it("does NOT call /compact when autoCompactMinTokens is 0 (disabled)", async () => {
    const { loadDaemonConfig } = await import("../../src/daemon/config.js");
    vi.mocked(loadDaemonConfig).mockReturnValueOnce({
      compaction: { autoCompactMinTokens: 0 },
    } as any);

    const client = createMockClient({ ingested: 100, totalTokens: 99999 });
    const stdin = JSON.stringify({ session_id: "s1", cwd: "/tmp" });
    await handleSessionEnd(stdin, client, 3737);
    expect(client.post).toHaveBeenCalledTimes(1);
  });

  it("swallows /compact errors without failing the hook", async () => {
    const client = {
      post: vi.fn().mockImplementation((path: string) => {
        if (path === "/ingest") return Promise.resolve({ ingested: 50, totalTokens: 20000 });
        if (path === "/compact") return Promise.reject(new Error("daemon crashed"));
        return Promise.reject(new Error("unexpected"));
      }),
    } as any;
    const stdin = JSON.stringify({ session_id: "s1", cwd: "/tmp" });
    const result = await handleSessionEnd(stdin, client, 3737);
    expect(result.exitCode).toBe(0);
  });

  it("calls /compact at exact threshold boundary (>=)", async () => {
    const client = createMockClient(
      { ingested: 50, totalTokens: 10000 },
      { summary: "compacted" },
    );
    const stdin = JSON.stringify({ session_id: "s1", cwd: "/tmp" });
    await handleSessionEnd(stdin, client, 3737);
    expect(client.post).toHaveBeenCalledWith("/compact", {
      session_id: "s1",
      cwd: "/tmp",
      skip_ingest: true,
      client: "claude",
    });
  });

  it("handles empty stdin gracefully", async () => {
    const client = createMockClient({ ingested: 0 });
    const result = await handleSessionEnd("", client, 3737);
    expect(result.exitCode).toBe(0);
  });
});
