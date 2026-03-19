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
interface OverallStats {
    projects: number;
    conversations: number;
    messages: number;
    summaries: number;
    maxDepth: number;
    rawTokens: number;
    summaryTokens: number;
    ratio: number;
    promotedCount: number;
    conversationDetails: ConversationStats[];
}
export declare function printStats(stats: OverallStats, verbose: boolean): void;
export declare function collectStats(): OverallStats;
export {};
