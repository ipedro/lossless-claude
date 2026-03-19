type StoreWithDedup = (text: string, tags: string[], meta: Record<string, unknown>) => Promise<unknown>;
export type PromotionParams = {
    text: string;
    tags: string[];
    projectId: string;
    projectPath: string;
    depth: number;
    sessionId: string;
    confidence: number;
    collection: string;
    _storeWithDedup?: StoreWithDedup;
};
export declare function promoteSummary(params: PromotionParams): Promise<void>;
export {};
