import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { projectDbPath } from "../project.js";
import { sendJson } from "../server.js";
import { runLcmMigrations } from "../../db/migration.js";
import { ConversationStore } from "../../store/conversation-store.js";
export function createRecentHandler(_config) {
    return async (_req, res, body) => {
        const input = JSON.parse(body || "{}");
        const { cwd, limit = 5 } = input;
        if (!cwd) {
            sendJson(res, 200, { summaries: [] });
            return;
        }
        try {
            const dbPath = projectDbPath(cwd);
            if (!existsSync(dbPath)) {
                sendJson(res, 200, { summaries: [] });
                return;
            }
            mkdirSync(dirname(dbPath), { recursive: true });
            const db = new DatabaseSync(dbPath);
            runLcmMigrations(db);
            const convStore = new ConversationStore(db);
            const rows = db.prepare(`SELECT s.summary_id, s.content, s.depth, s.token_count, s.created_at
         FROM summaries s
         ORDER BY s.created_at DESC LIMIT ?`).all(limit);
            db.close();
            sendJson(res, 200, { summaries: rows });
        }
        catch {
            sendJson(res, 200, { summaries: [] });
        }
    };
}
//# sourceMappingURL=recent.js.map