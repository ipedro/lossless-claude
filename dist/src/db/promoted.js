import { randomUUID } from "node:crypto";
export class PromotedStore {
    db;
    constructor(db) {
        this.db = db;
    }
    insert(params) {
        const id = randomUUID();
        const tags = JSON.stringify(params.tags ?? []);
        this.db.prepare(`INSERT INTO promoted (id, content, tags, source_summary_id, project_id, session_id, depth, confidence)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, params.content, tags, params.sourceSummaryId ?? null, params.projectId, params.sessionId ?? null, params.depth ?? 0, params.confidence ?? 1.0);
        // Sync to FTS5
        const row = this.db.prepare("SELECT rowid FROM promoted WHERE id = ?").get(id);
        if (row) {
            this.db.prepare("INSERT INTO promoted_fts (rowid, content, tags) VALUES (?, ?, ?)").run(row.rowid, params.content, tags);
        }
        return id;
    }
    getById(id) {
        return this.db.prepare("SELECT * FROM promoted WHERE id = ?").get(id) ?? null;
    }
    search(query, limit, filterTags) {
        const sanitized = query
            .replace(/[^\w\s]/g, " ")
            .split(/\s+/)
            .filter(Boolean)
            .map((t) => `"${t}"`)
            .join(" OR ");
        if (!sanitized)
            return [];
        const rows = this.db.prepare(`SELECT p.id, p.content, p.tags, p.project_id, p.confidence, p.created_at, rank
       FROM promoted_fts fts
       JOIN promoted p ON p.rowid = fts.rowid
       WHERE promoted_fts MATCH ?
         AND p.archived_at IS NULL
       ORDER BY rank
       LIMIT ?`).all(sanitized, limit);
        let results = rows.map((r) => ({
            id: r.id,
            content: r.content,
            tags: JSON.parse(r.tags),
            projectId: r.project_id,
            confidence: r.confidence,
            createdAt: r.created_at,
            rank: r.rank,
        }));
        if (filterTags && filterTags.length > 0) {
            results = results.filter((r) => filterTags.every((t) => r.tags.includes(t)));
        }
        return results;
    }
    archive(id) {
        const row = this.db.prepare("SELECT rowid FROM promoted WHERE id = ?").get(id);
        this.db.prepare("UPDATE promoted SET archived_at = datetime('now') WHERE id = ?").run(id);
        if (row) {
            this.db.prepare("DELETE FROM promoted_fts WHERE rowid = ?").run(row.rowid);
        }
    }
    deleteById(id) {
        const row = this.db.prepare("SELECT rowid FROM promoted WHERE id = ?").get(id);
        if (row) {
            this.db.prepare("DELETE FROM promoted_fts WHERE rowid = ?").run(row.rowid);
        }
        this.db.prepare("DELETE FROM promoted WHERE id = ?").run(id);
    }
    update(id, fields) {
        const row = this.db.prepare("SELECT rowid, content, tags FROM promoted WHERE id = ?").get(id);
        if (!row)
            return;
        if (fields.content !== undefined) {
            const newTags = fields.tags !== undefined ? JSON.stringify(fields.tags) : row.tags;
            this.db.prepare("UPDATE promoted SET content = ?, confidence = COALESCE(?, confidence), tags = ? WHERE id = ?").run(fields.content, fields.confidence ?? null, newTags, id);
            // Re-sync FTS5: delete old row and insert new one
            this.db.prepare("DELETE FROM promoted_fts WHERE rowid = ?").run(row.rowid);
            this.db.prepare("INSERT INTO promoted_fts (rowid, content, tags) VALUES (?, ?, ?)").run(row.rowid, fields.content, newTags);
        }
        else {
            if (fields.confidence !== undefined) {
                this.db.prepare("UPDATE promoted SET confidence = ? WHERE id = ?").run(fields.confidence, id);
            }
            if (fields.tags !== undefined) {
                const newTags = JSON.stringify(fields.tags);
                this.db.prepare("UPDATE promoted SET tags = ? WHERE id = ?").run(newTags, id);
                // Re-sync FTS5 tags
                this.db.prepare("DELETE FROM promoted_fts WHERE rowid = ?").run(row.rowid);
                this.db.prepare("INSERT INTO promoted_fts (rowid, content, tags) VALUES (?, ?, ?)").run(row.rowid, row.content, newTags);
            }
        }
    }
}
//# sourceMappingURL=promoted.js.map