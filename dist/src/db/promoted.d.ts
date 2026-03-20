import type { DatabaseSync } from "node:sqlite";
export type PromotedRow = {
    id: string;
    content: string;
    tags: string;
    source_summary_id: string | null;
    project_id: string;
    session_id: string | null;
    depth: number;
    confidence: number;
    created_at: string;
    archived_at: string | null;
};
export type InsertParams = {
    content: string;
    tags?: string[];
    sourceSummaryId?: string;
    projectId: string;
    sessionId?: string;
    depth?: number;
    confidence?: number;
};
export type SearchResult = {
    id: string;
    content: string;
    tags: string[];
    projectId: string;
    confidence: number;
    createdAt: string;
    rank: number;
};
export declare class PromotedStore {
    private db;
    constructor(db: DatabaseSync);
    insert(params: InsertParams): string;
    getById(id: string): PromotedRow | null;
    search(query: string, limit: number, filterTags?: string[]): SearchResult[];
    archive(id: string): void;
    deleteById(id: string): void;
    update(id: string, fields: {
        content?: string;
        confidence?: number;
        tags?: string[];
    }): void;
}
