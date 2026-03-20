import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DaemonConfig } from "../config.js";
import { projectDbPath } from "../project.js";
import { sendJson } from "../server.js";
import type { RouteHandler } from "../server.js";
import { runLcmMigrations } from "../../db/migration.js";
import { PromotedStore } from "../../db/promoted.js";

export function createPromptSearchHandler(config: DaemonConfig): RouteHandler {
  return async (_req, res, body) => {
    const input = JSON.parse(body || "{}");
    const { query, cwd } = input;

    if (!query || !cwd) {
      sendJson(res, 200, { hints: [] });
      return;
    }

    const dbPath = projectDbPath(cwd);
    if (!existsSync(dbPath)) {
      sendJson(res, 200, { hints: [] });
      return;
    }

    try {
      mkdirSync(dirname(dbPath), { recursive: true });
      const db = new DatabaseSync(dbPath);
      runLcmMigrations(db);

      const store = new PromotedStore(db);
      const maxResults = config.restoration.promptSearchMaxResults ?? 3;
      const minScore = config.restoration.promptSearchMinScore ?? 10;
      const snippetLength = config.restoration.promptSnippetLength ?? 200;

      const results = store.search(query, maxResults);
      // FTS5 rank is negative; more negative = better match
      const filtered = results.filter((r) => r.rank <= -minScore);

      const hints = filtered.map((r) =>
        r.content.length > snippetLength
          ? r.content.slice(0, snippetLength) + "..."
          : r.content
      );

      db.close();
      sendJson(res, 200, { hints });
    } catch {
      sendJson(res, 200, { hints: [] });
    }
  };
}
