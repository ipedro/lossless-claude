import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "fs";
import { dirname } from "path";
const _connections = new Map();
function isConnectionHealthy(db) {
    try {
        db.prepare("SELECT 1").get();
        return true;
    }
    catch {
        return false;
    }
}
function forceCloseConnection(entry) {
    try {
        entry.db.close();
    }
    catch {
        // Ignore close failures; caller is already replacing/removing this handle.
    }
}
export function getLcmConnection(dbPath) {
    const existing = _connections.get(dbPath);
    if (existing) {
        if (isConnectionHealthy(existing.db)) {
            existing.refs += 1;
            return existing.db;
        }
        forceCloseConnection(existing);
        _connections.delete(dbPath);
    }
    // Ensure parent directory exists
    mkdirSync(dirname(dbPath), { recursive: true });
    const db = new DatabaseSync(dbPath);
    // Enable WAL mode for better concurrent read performance
    db.exec("PRAGMA journal_mode = WAL");
    // Enable foreign key enforcement
    db.exec("PRAGMA foreign_keys = ON");
    _connections.set(dbPath, { db, refs: 1 });
    return db;
}
export function closeLcmConnection(dbPath) {
    if (typeof dbPath === "string" && dbPath.trim()) {
        const entry = _connections.get(dbPath);
        if (!entry) {
            return;
        }
        entry.refs = Math.max(0, entry.refs - 1);
        if (entry.refs === 0) {
            forceCloseConnection(entry);
            _connections.delete(dbPath);
        }
        return;
    }
    for (const entry of _connections.values()) {
        forceCloseConnection(entry);
    }
    _connections.clear();
}
//# sourceMappingURL=connection.js.map