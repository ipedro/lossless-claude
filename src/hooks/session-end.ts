import type { DaemonClient } from "../daemon/client.js";
import { ensureDaemon } from "../daemon/lifecycle.js";
import { loadDaemonConfig } from "../daemon/config.js";
import { join } from "node:path";
import { homedir } from "node:os";

export async function handleSessionEnd(
  stdin: string,
  client: DaemonClient,
  port?: number,
): Promise<{ exitCode: number; stdout: string }> {
  const daemonPort = port ?? 3737;
  const pidFilePath = join(homedir(), ".lossless-claude", "daemon.pid");
  const { connected } = await ensureDaemon({
    port: daemonPort,
    pidFilePath,
    spawnTimeoutMs: 5000,
  });
  if (!connected) return { exitCode: 0, stdout: "" };

  try {
    const input = JSON.parse(stdin || "{}");
    const ingestResult = await client.post<{
      ingested: number;
      totalTokens?: number;
    }>("/ingest", input);

    // Auto-compact if conversation exceeds threshold
    const configPath = join(homedir(), ".lossless-claude", "config.json");
    const config = loadDaemonConfig(configPath);
    const threshold = config.compaction.autoCompactMinTokens;

    if (
      threshold > 0 &&
      typeof ingestResult.totalTokens === "number" &&
      ingestResult.totalTokens >= threshold
    ) {
      // Fire-and-forget: compact runs async in the daemon, hook must not block
      client
        .post("/compact", {
          session_id: input.session_id,
          cwd: input.cwd,
          skip_ingest: true,
          client: "claude",
        })
        .catch(() => {
          // Non-fatal: compact failure must not break the hook
        });
    }

    return { exitCode: 0, stdout: "" };
  } catch {
    return { exitCode: 0, stdout: "" };
  }
}
