export type DaemonConfig = {
    version: number;
    daemon: {
        port: number;
        socketPath: string;
        logLevel: string;
        logMaxSizeMB: number;
        logRetentionDays: number;
    };
    compaction: {
        leafTokens: number;
        maxDepth: number;
        promotionThresholds: {
            minDepth: number;
            compressionRatio: number;
            keywords: Record<string, string[]>;
            architecturePatterns: string[];
        };
    };
    restoration: {
        recentSummaries: number;
        semanticTopK: number;
        semanticThreshold: number;
    };
    llm: {
        provider: "claude-cli" | "anthropic" | "openai" | "disabled";
        model: string;
        apiKey?: string;
        baseURL: string;
    };
    claudeCliProxy: {
        enabled: boolean;
        port: number;
        startupTimeoutMs: number;
        model: string;
    };
    cipher: {
        configPath: string;
        collection: string;
    };
};
export declare function loadDaemonConfig(configPath: string, overrides?: any, env?: Record<string, string | undefined>): DaemonConfig;
