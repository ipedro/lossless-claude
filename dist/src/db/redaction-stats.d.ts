import type { DatabaseSync } from "node:sqlite";
export declare function upsertRedactionCounts(db: DatabaseSync, pid: string, counts: {
    builtIn: number;
    global: number;
    project: number;
}): void;
