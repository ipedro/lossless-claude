interface ConversationStats {
    conversationId: number;
    messages: number;
    summaries: number;
    maxDepth: number;
    rawTokens: number;
    summaryTokens: number;
    ratio: number;
    promotedCount: number;
}
export interface RedactionCounts {
    builtIn: number;
    global: number;
    project: number;
    total: number;
}
interface OverallStats {
    projects: number;
    conversations: number;
    compactedConversations: number;
    messages: number;
    summaries: number;
    maxDepth: number;
    rawTokens: number;
    summaryTokens: number;
    ratio: number;
    promotedCount: number;
    conversationDetails: ConversationStats[];
    redactionCounts: RedactionCounts;
}
export declare function formatNumber(n: number): string;
export declare function printStats(stats: OverallStats, verbose: boolean): void;
export declare function collectStats(): OverallStats;
export {};
