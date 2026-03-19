import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DaemonConfig } from "../config.js";
import { projectDbPath } from "../project.js";
import { buildOrientationPrompt } from "../orientation.js";
import { sendJson } from "../server.js";
import type { RouteHandler } from "../server.js";
import { runLcmMigrations } from "../../db/migration.js";
import { PromotedStore } from "../../db/promoted.js";
import { justCompactedMap, JUST_COMPACTED_TTL_MS } from "./compact.js";

export function createRestoreHandler(config: DaemonConfig): RouteHandler {
  return async (_req, res, body) => {
    const input = JSON.parse(body || "{}");
    const { session_id, cwd, source } = input;
    const orientation = buildOrientationPrompt();

    // Post-compaction detection
    const isPostCompact =
      source === "compact" ||
      (justCompactedMap.has(session_id) && Date.now() - justCompactedMap.get(session_id)! < JUST_COMPACTED_TTL_MS);

    if (isPostCompact) {
      sendJson(res, 200, { context: orientation });
      return;
    }

    let episodicContext = "";
    let promotedContext = "";

    // Episodic: query recent summaries from project SQLite DB
    if (cwd) {
      const dbPath = projectDbPath(cwd);
      if (existsSync(dbPath)) {
        mkdirSync(dirname(dbPath), { recursive: true });
        const db = new DatabaseSync(dbPath);
        try {
          runLcmMigrations(db);

          const rows = db.prepare(
            `SELECT s.content FROM summaries s
             JOIN conversations c ON s.conversation_id = c.conversation_id
             WHERE c.session_id = ?
             ORDER BY s.depth DESC, s.created_at DESC
             LIMIT ?`,
          ).all(session_id, config.restoration.recentSummaries) as Array<{ content: string }>;

          if (rows.length > 0) {
            episodicContext = `<recent-session-context>\n${rows.map((r) => r.content).join("\n\n")}\n</recent-session-context>`;
          }

          // Promoted: cross-session knowledge from SQLite
          try {
            const promotedStore = new PromotedStore(db);
            const results = promotedStore.search(`project context ${cwd}`, 5);
            if (results.length > 0) {
              promotedContext = `<project-knowledge>\n${results.map((r) => r.content).join("\n\n")}\n</project-knowledge>`;
            }
          } catch { /* non-fatal */ }

          db.close();
        } catch { /* non-fatal */ }
      }
    }

    const context = [orientation, episodicContext, promotedContext].filter(Boolean).join("\n\n");
    sendJson(res, 200, { context });
  };
}
