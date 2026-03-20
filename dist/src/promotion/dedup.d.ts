import type { PromotedStore } from "../db/promoted.js";
type DedupThresholds = {
    dedupBm25Threshold: number;
    mergeMaxEntries: number;
    confidenceDecayRate: number;
};
type DedupParams = {
    store: PromotedStore;
    content: string;
    tags: string[];
    projectId: string;
    sessionId?: string;
    depth: number;
    confidence: number;
    summarize: (text: string) => Promise<string>;
    thresholds: DedupThresholds;
};
export declare function deduplicateAndInsert(params: DedupParams): Promise<string>;
export {};
