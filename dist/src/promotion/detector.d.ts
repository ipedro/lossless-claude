import type { DaemonConfig } from "../daemon/config.js";
type Thresholds = DaemonConfig["compaction"]["promotionThresholds"];
export type PromotionInput = {
    content: string;
    depth: number;
    tokenCount: number;
    sourceMessageTokenCount: number;
};
export type PromotionResult = {
    promote: boolean;
    tags: string[];
    confidence: number;
};
export declare function shouldPromote(input: PromotionInput, thresholds: Thresholds): PromotionResult;
export {};
