export type DaemonConfig = {
    version: number;
    daemon: {
        port: number;
        socketPath: string;
        logLevel: string;
        logMaxSizeMB: number;
        logRetentionDays: number;
        idleTimeoutMs: number;
    };
    compaction: {
        leafTokens: number;
        maxDepth: number;
        promotionThresholds: {
            minDepth: number;
            compressionRatio: number;
            keywords: Record<string, string[]>;
            architecturePatterns: string[];
            dedupBm25Threshold: number;
            mergeMaxEntries: number;
            confidenceDecayRate: number;
        };
    };
    restoration: {
        recentSummaries: number;
    };
    llm: {
        provider: "claude-process" | "anthropic" | "openai" | "disabled";
        model: string;
        apiKey?: string;
        baseURL: string;
    };
};
export declare function loadDaemonConfig(configPath: string, overrides?: any, env?: Record<string, string | undefined>): DaemonConfig;
