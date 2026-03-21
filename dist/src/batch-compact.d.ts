export interface UncompactedConversation {
    projectDir: string;
    cwd: string;
    conversationId: number;
    sessionId: string;
    messages: number;
    tokens: number;
}
/** Find all conversations with messages but no summaries, above the token threshold. */
export declare function findUncompacted(minTokens: number): UncompactedConversation[];
/** Compact all uncompacted conversations above threshold via the daemon. */
export declare function batchCompact(opts: {
    minTokens: number;
    dryRun: boolean;
    port: number;
}): Promise<void>;
