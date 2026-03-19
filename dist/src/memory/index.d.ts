import { DaemonClient } from "../daemon/client.js";
export type SearchResult = {
    episodic: any[];
    semantic: any[];
};
export type MemoryApi = {
    store: (text: string, tags: string[], metadata?: Record<string, unknown>) => Promise<void>;
    search: (query: string, options?: {
        limit?: number;
        threshold?: number;
        projectId?: string;
        layers?: ("episodic" | "semantic")[];
    }) => Promise<SearchResult>;
    compact: (sessionId: string, transcriptPath: string) => Promise<{
        summary: string;
    }>;
    recent: (projectId: string, limit?: number) => Promise<{
        summaries: any[];
    }>;
};
export declare function createMemoryApi(client: DaemonClient): MemoryApi;
export declare const memory: MemoryApi;
