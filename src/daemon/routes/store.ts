import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DaemonConfig } from "../config.js";
import { projectDbPath } from "../project.js";
import { sendJson } from "../server.js";
import type { RouteHandler } from "../server.js";
import { runLcmMigrations } from "../../db/migration.js";
import { PromotedStore } from "../../db/promoted.js";

export function createStoreHandler(config: DaemonConfig): RouteHandler {
  return async (_req, res, body) => {
    const input = JSON.parse(body || "{}");
    const { text, tags = [], metadata = {}, cwd } = input;

    if (!text) {
      sendJson(res, 400, { error: "text is required" });
      return;
    }

    const projectPath = cwd || metadata.projectPath || "";
    if (!projectPath) {
      sendJson(res, 400, { error: "cwd or metadata.projectPath is required" });
      return;
    }

    try {
      // Core: write to SQLite promoted table
      const dbPath = projectDbPath(projectPath);
      mkdirSync(dirname(dbPath), { recursive: true });
      const db = new DatabaseSync(dbPath);
      runLcmMigrations(db);
      const store = new PromotedStore(db);

      const id = store.insert({
        content: text,
        tags,
        projectId: metadata.projectId ?? "manual",
        sessionId: metadata.sessionId ?? "manual",
        depth: metadata.depth ?? 0,
        confidence: 1.0,
      });
      db.close();

      // Optional: also promote to Qdrant (non-fatal)
      try {
        const { promoteSummary } = await import("../../promotion/promoter.js");
        await promoteSummary({
          text,
          tags,
          projectId: metadata.projectId ?? "manual",
          projectPath,
          depth: metadata.depth ?? 0,
          sessionId: metadata.sessionId ?? "manual",
          confidence: 1.0,
          collection: config.cipher.collection,
        });
      } catch {
        // Qdrant not available — SQLite is authoritative, this is fine
      }

      sendJson(res, 200, { stored: true, id });
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : "store failed" });
    }
  };
}
