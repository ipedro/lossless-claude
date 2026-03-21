import type { DaemonConfig } from "../config.js";
import type { RouteHandler } from "../server.js";
export declare function buildCompactionMessage(p: {
    tokensBefore: number;
    tokensAfter: number;
    messageCount: number;
    summaryCount: number;
    maxDepth: number;
    promotedCount: number;
}): string;
export declare const justCompactedMap: Map<string, number>;
export declare const JUST_COMPACTED_TTL_MS = 30000;
export declare function createCompactHandler(config: DaemonConfig): RouteHandler;
