import { randomUUID } from "node:crypto";
import { sanitizeFts5Query } from "./fts5-sanitize.js";
import { buildLikeSearchPlan, createFallbackSnippet } from "./full-text-fallback.js";
// ── Row mappers ───────────────────────────────────────────────────────────────
function toConversationRecord(row) {
    return {
        conversationId: row.conversation_id,
        sessionId: row.session_id,
        title: row.title,
        bootstrappedAt: row.bootstrapped_at ? new Date(row.bootstrapped_at) : null,
        createdAt: new Date(row.created_at),
        updatedAt: new Date(row.updated_at),
    };
}
function toMessageRecord(row) {
    return {
        messageId: row.message_id,
        conversationId: row.conversation_id,
        seq: row.seq,
        role: row.role,
        content: row.content,
        tokenCount: row.token_count,
        createdAt: new Date(row.created_at),
    };
}
function toSearchResult(row) {
    return {
        messageId: row.message_id,
        conversationId: row.conversation_id,
        role: row.role,
        snippet: row.snippet,
        createdAt: new Date(row.created_at),
        rank: row.rank,
    };
}
function toMessagePartRecord(row) {
    return {
        partId: row.part_id,
        messageId: row.message_id,
        sessionId: row.session_id,
        partType: row.part_type,
        ordinal: row.ordinal,
        textContent: row.text_content,
        toolCallId: row.tool_call_id,
        toolName: row.tool_name,
        toolInput: row.tool_input,
        toolOutput: row.tool_output,
        metadata: row.metadata,
    };
}
// ── ConversationStore ─────────────────────────────────────────────────────────
export class ConversationStore {
    db;
    fts5Available;
    constructor(db, options) {
        this.db = db;
        this.fts5Available = options?.fts5Available ?? true;
    }
    // ── Transaction helpers ──────────────────────────────────────────────────
    async withTransaction(operation) {
        this.db.exec("BEGIN IMMEDIATE");
        try {
            const result = await operation();
            this.db.exec("COMMIT");
            return result;
        }
        catch (error) {
            this.db.exec("ROLLBACK");
            throw error;
        }
    }
    // ── Conversation operations ───────────────────────────────────────────────
    async createConversation(input) {
        const result = this.db
            .prepare(`INSERT INTO conversations (session_id, title) VALUES (?, ?)`)
            .run(input.sessionId, input.title ?? null);
        const row = this.db
            .prepare(`SELECT conversation_id, session_id, title, bootstrapped_at, created_at, updated_at
       FROM conversations WHERE conversation_id = ?`)
            .get(Number(result.lastInsertRowid));
        return toConversationRecord(row);
    }
    async getConversation(conversationId) {
        const row = this.db
            .prepare(`SELECT conversation_id, session_id, title, bootstrapped_at, created_at, updated_at
       FROM conversations WHERE conversation_id = ?`)
            .get(conversationId);
        return row ? toConversationRecord(row) : null;
    }
    async getConversationBySessionId(sessionId) {
        const row = this.db
            .prepare(`SELECT conversation_id, session_id, title, bootstrapped_at, created_at, updated_at
       FROM conversations
       WHERE session_id = ?
       ORDER BY created_at DESC
       LIMIT 1`)
            .get(sessionId);
        return row ? toConversationRecord(row) : null;
    }
    async getOrCreateConversation(sessionId, title) {
        const existing = await this.getConversationBySessionId(sessionId);
        if (existing) {
            return existing;
        }
        return this.createConversation({ sessionId, title });
    }
    async markConversationBootstrapped(conversationId) {
        this.db
            .prepare(`UPDATE conversations
       SET bootstrapped_at = COALESCE(bootstrapped_at, datetime('now')),
           updated_at = datetime('now')
       WHERE conversation_id = ?`)
            .run(conversationId);
    }
    // ── Message operations ────────────────────────────────────────────────────
    async createMessage(input) {
        const result = this.db
            .prepare(`INSERT INTO messages (conversation_id, seq, role, content, token_count)
       VALUES (?, ?, ?, ?, ?)`)
            .run(input.conversationId, input.seq, input.role, input.content, input.tokenCount);
        const messageId = Number(result.lastInsertRowid);
        this.indexMessageForFullText(messageId, input.content);
        const row = this.db
            .prepare(`SELECT message_id, conversation_id, seq, role, content, token_count, created_at
       FROM messages WHERE message_id = ?`)
            .get(messageId);
        return toMessageRecord(row);
    }
    async createMessagesBulk(inputs) {
        if (inputs.length === 0) {
            return [];
        }
        const insertStmt = this.db.prepare(`INSERT INTO messages (conversation_id, seq, role, content, token_count)
       VALUES (?, ?, ?, ?, ?)`);
        const selectStmt = this.db.prepare(`SELECT message_id, conversation_id, seq, role, content, token_count, created_at
       FROM messages WHERE message_id = ?`);
        const records = [];
        for (const input of inputs) {
            const result = insertStmt.run(input.conversationId, input.seq, input.role, input.content, input.tokenCount);
            const messageId = Number(result.lastInsertRowid);
            this.indexMessageForFullText(messageId, input.content);
            const row = selectStmt.get(messageId);
            records.push(toMessageRecord(row));
        }
        return records;
    }
    async getMessages(conversationId, opts) {
        const afterSeq = opts?.afterSeq ?? -1;
        const limit = opts?.limit;
        if (limit != null) {
            const rows = this.db
                .prepare(`SELECT message_id, conversation_id, seq, role, content, token_count, created_at
         FROM messages
         WHERE conversation_id = ? AND seq > ?
         ORDER BY seq
         LIMIT ?`)
                .all(conversationId, afterSeq, limit);
            return rows.map(toMessageRecord);
        }
        const rows = this.db
            .prepare(`SELECT message_id, conversation_id, seq, role, content, token_count, created_at
       FROM messages
       WHERE conversation_id = ? AND seq > ?
       ORDER BY seq`)
            .all(conversationId, afterSeq);
        return rows.map(toMessageRecord);
    }
    async getLastMessage(conversationId) {
        const row = this.db
            .prepare(`SELECT message_id, conversation_id, seq, role, content, token_count, created_at
       FROM messages
       WHERE conversation_id = ?
       ORDER BY seq DESC
       LIMIT 1`)
            .get(conversationId);
        return row ? toMessageRecord(row) : null;
    }
    async hasMessage(conversationId, role, content) {
        const row = this.db
            .prepare(`SELECT 1 AS count
       FROM messages
       WHERE conversation_id = ? AND role = ? AND content = ?
       LIMIT 1`)
            .get(conversationId, role, content);
        return row?.count === 1;
    }
    async countMessagesByIdentity(conversationId, role, content) {
        const row = this.db
            .prepare(`SELECT COUNT(*) AS count
       FROM messages
       WHERE conversation_id = ? AND role = ? AND content = ?`)
            .get(conversationId, role, content);
        return row?.count ?? 0;
    }
    async getMessageById(messageId) {
        const row = this.db
            .prepare(`SELECT message_id, conversation_id, seq, role, content, token_count, created_at
       FROM messages WHERE message_id = ?`)
            .get(messageId);
        return row ? toMessageRecord(row) : null;
    }
    async createMessageParts(messageId, parts) {
        if (parts.length === 0) {
            return;
        }
        const stmt = this.db.prepare(`INSERT INTO message_parts (
         part_id,
         message_id,
         session_id,
         part_type,
         ordinal,
         text_content,
         tool_call_id,
         tool_name,
         tool_input,
         tool_output,
         metadata
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
        for (const part of parts) {
            stmt.run(randomUUID(), messageId, part.sessionId, part.partType, part.ordinal, part.textContent ?? null, part.toolCallId ?? null, part.toolName ?? null, part.toolInput ?? null, part.toolOutput ?? null, part.metadata ?? null);
        }
    }
    async getMessageParts(messageId) {
        const rows = this.db
            .prepare(`SELECT
         part_id,
         message_id,
         session_id,
         part_type,
         ordinal,
         text_content,
         tool_call_id,
         tool_name,
         tool_input,
         tool_output,
         metadata
       FROM message_parts
       WHERE message_id = ?
       ORDER BY ordinal`)
            .all(messageId);
        return rows.map(toMessagePartRecord);
    }
    async getMessageCount(conversationId) {
        const row = this.db
            .prepare(`SELECT COUNT(*) AS count FROM messages WHERE conversation_id = ?`)
            .get(conversationId);
        return row?.count ?? 0;
    }
    async getMaxSeq(conversationId) {
        const row = this.db
            .prepare(`SELECT COALESCE(MAX(seq), 0) AS max_seq
       FROM messages WHERE conversation_id = ?`)
            .get(conversationId);
        return row?.max_seq ?? 0;
    }
    // ── Deletion ──────────────────────────────────────────────────────────────
    /**
     * Delete messages and their associated records (context_items, FTS, message_parts).
     *
     * Skips messages referenced in summary_messages (already compacted) to avoid
     * breaking the summary DAG. Returns the count of actually deleted messages.
     */
    async deleteMessages(messageIds) {
        if (messageIds.length === 0) {
            return 0;
        }
        let deleted = 0;
        for (const messageId of messageIds) {
            // Skip if referenced by a summary (ON DELETE RESTRICT would fail anyway)
            const refRow = this.db
                .prepare(`SELECT 1 AS found FROM summary_messages WHERE message_id = ? LIMIT 1`)
                .get(messageId);
            if (refRow) {
                continue;
            }
            // Remove from context_items first (RESTRICT constraint)
            this.db
                .prepare(`DELETE FROM context_items WHERE item_type = 'message' AND message_id = ?`)
                .run(messageId);
            this.deleteMessageFromFullText(messageId);
            // Delete the message (message_parts cascade via ON DELETE CASCADE)
            this.db.prepare(`DELETE FROM messages WHERE message_id = ?`).run(messageId);
            deleted += 1;
        }
        return deleted;
    }
    // ── Search ────────────────────────────────────────────────────────────────
    async searchMessages(input) {
        const limit = input.limit ?? 50;
        if (input.mode === "full_text") {
            if (this.fts5Available) {
                try {
                    return this.searchFullText(input.query, limit, input.conversationId, input.since, input.before);
                }
                catch {
                    return this.searchLike(input.query, limit, input.conversationId, input.since, input.before);
                }
            }
            return this.searchLike(input.query, limit, input.conversationId, input.since, input.before);
        }
        return this.searchRegex(input.query, limit, input.conversationId, input.since, input.before);
    }
    indexMessageForFullText(messageId, content) {
        if (!this.fts5Available) {
            return;
        }
        try {
            this.db
                .prepare(`INSERT INTO messages_fts(rowid, content) VALUES (?, ?)`)
                .run(messageId, content);
        }
        catch {
            // Full-text indexing is optional. Message persistence must still succeed.
        }
    }
    deleteMessageFromFullText(messageId) {
        if (!this.fts5Available) {
            return;
        }
        try {
            this.db.prepare(`DELETE FROM messages_fts WHERE rowid = ?`).run(messageId);
        }
        catch {
            // Ignore FTS cleanup failures; the source row deletion is authoritative.
        }
    }
    searchFullText(query, limit, conversationId, since, before) {
        const where = ["messages_fts MATCH ?"];
        const args = [sanitizeFts5Query(query)];
        if (conversationId != null) {
            where.push("m.conversation_id = ?");
            args.push(conversationId);
        }
        if (since) {
            where.push("julianday(m.created_at) >= julianday(?)");
            args.push(since.toISOString());
        }
        if (before) {
            where.push("julianday(m.created_at) < julianday(?)");
            args.push(before.toISOString());
        }
        args.push(limit);
        const sql = `SELECT
         m.message_id,
         m.conversation_id,
         m.role,
         snippet(messages_fts, 0, '', '', '...', 32) AS snippet,
         rank,
         m.created_at
       FROM messages_fts
       JOIN messages m ON m.message_id = messages_fts.rowid
       WHERE ${where.join(" AND ")}
       ORDER BY m.created_at DESC
       LIMIT ?`;
        const rows = this.db.prepare(sql).all(...args);
        return rows.map(toSearchResult);
    }
    searchLike(query, limit, conversationId, since, before) {
        const plan = buildLikeSearchPlan("content", query);
        if (plan.terms.length === 0) {
            return [];
        }
        const where = [...plan.where];
        const args = [...plan.args];
        if (conversationId != null) {
            where.push("conversation_id = ?");
            args.push(conversationId);
        }
        if (since) {
            where.push("julianday(created_at) >= julianday(?)");
            args.push(since.toISOString());
        }
        if (before) {
            where.push("julianday(created_at) < julianday(?)");
            args.push(before.toISOString());
        }
        args.push(limit);
        const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
        const rows = this.db
            .prepare(`SELECT message_id, conversation_id, seq, role, content, token_count, created_at
         FROM messages
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT ?`)
            .all(...args);
        return rows.map((row) => ({
            messageId: row.message_id,
            conversationId: row.conversation_id,
            role: row.role,
            snippet: createFallbackSnippet(row.content, plan.terms),
            createdAt: new Date(row.created_at),
            rank: 0,
        }));
    }
    searchRegex(pattern, limit, conversationId, since, before) {
        // SQLite has no native POSIX regex; fetch candidates and filter in JS
        const re = new RegExp(pattern);
        const where = [];
        const args = [];
        if (conversationId != null) {
            where.push("conversation_id = ?");
            args.push(conversationId);
        }
        if (since) {
            where.push("julianday(created_at) >= julianday(?)");
            args.push(since.toISOString());
        }
        if (before) {
            where.push("julianday(created_at) < julianday(?)");
            args.push(before.toISOString());
        }
        const whereClause = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
        const rows = this.db
            .prepare(`SELECT message_id, conversation_id, seq, role, content, token_count, created_at
         FROM messages
         ${whereClause}
         ORDER BY created_at DESC`)
            .all(...args);
        const results = [];
        for (const row of rows) {
            if (results.length >= limit) {
                break;
            }
            const match = re.exec(row.content);
            if (match) {
                results.push({
                    messageId: row.message_id,
                    conversationId: row.conversation_id,
                    role: row.role,
                    snippet: match[0],
                    createdAt: new Date(row.created_at),
                    rank: 0,
                });
            }
        }
        return results;
    }
}
//# sourceMappingURL=conversation-store.js.map