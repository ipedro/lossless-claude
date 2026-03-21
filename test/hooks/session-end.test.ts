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

const mockHttpReq = vi.hoisted(() => ({
  on: vi.fn().mockReturnThis(),
  write: vi.fn(),
  end: vi.fn(),
}));

vi.mock("node:http", () => ({
  request: vi.fn().mockReturnValue(mockHttpReq),
}));

function createMockClient(ingestResponse: unknown) {
  return {
    post: vi.fn().mockImplementation((path: string) => {
      if (path === "/ingest") return Promise.resolve(ingestResponse);
      return Promise.reject(new Error(`unexpected path: ${path}`));
    }),
  } as any;
}

describe("handleSessionEnd", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHttpReq.on.mockReturnThis();
  });

  it("calls /ingest with parsed stdin", async () => {
    const client = createMockClient({ ingested: 5, totalTokens: 500 });
    const stdin = JSON.stringify({ session_id: "s1", cwd: "/tmp" });
    const result = await handleSessionEnd(stdin, client, 3737);
    expect(result.exitCode).toBe(0);
    expect(client.post).toHaveBeenCalledWith("/ingest", { session_id: "s1", cwd: "/tmp" });
  });

  it("fires compact via http.request when totalTokens exceeds threshold", async () => {
    const { request } = await import("node:http");
    const client = createMockClient({ ingested: 100, totalTokens: 25000 });
    const stdin = JSON.stringify({ session_id: "s1", cwd: "/tmp" });
    await handleSessionEnd(stdin, client, 3737);
    expect(request).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/compact", method: "POST", port: 3737 }),
    );
    expect(mockHttpReq.end).toHaveBeenCalled();
  });

  it("does NOT fire compact when totalTokens is below threshold", async () => {
    const { request } = await import("node:http");
    const client = createMockClient({ ingested: 5, totalTokens: 500 });
    const stdin = JSON.stringify({ session_id: "s1", cwd: "/tmp" });
    await handleSessionEnd(stdin, client, 3737);
    expect(request).not.toHaveBeenCalled();
  });

  it("does NOT fire compact when autoCompactMinTokens is 0 (disabled)", async () => {
    const { loadDaemonConfig } = await import("../../src/daemon/config.js");
    vi.mocked(loadDaemonConfig).mockReturnValueOnce({
      compaction: { autoCompactMinTokens: 0 },
    } as any);
    const { request } = await import("node:http");
    const client = createMockClient({ ingested: 100, totalTokens: 99999 });
    await handleSessionEnd(stdin({}), client, 3737);
    expect(request).not.toHaveBeenCalled();
  });

  it("resolves promptly even when /compact would never respond (non-blocking regression)", async () => {
    // fireCompactRequest uses http.request with socket.unref() — it must NOT
    // block handleSessionEnd waiting for a daemon response.
    const client = createMockClient({ ingested: 100, totalTokens: 25000 });
    const input = JSON.stringify({ session_id: "s1", cwd: "/tmp" });

    const start = Date.now();
    const result = await handleSessionEnd(input, client, 3737);
    const elapsed = Date.now() - start;

    expect(result.exitCode).toBe(0);
    expect(elapsed).toBeLessThan(500); // must not block waiting for compact
  });

  it("fires compact at exact threshold boundary (>=)", async () => {
    const { request } = await import("node:http");
    const client = createMockClient({ ingested: 50, totalTokens: 10000 });
    const input = JSON.stringify({ session_id: "s1", cwd: "/tmp" });
    await handleSessionEnd(input, client, 3737);
    expect(request).toHaveBeenCalled();
  });

  it("handles empty stdin gracefully", async () => {
    const client = createMockClient({ ingested: 0 });
    const result = await handleSessionEnd("", client, 3737);
    expect(result.exitCode).toBe(0);
  });
});

function stdin(obj: Record<string, unknown>): string {
  return JSON.stringify(obj);
}
