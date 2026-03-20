export interface ParsedMessage {
    role: string;
    content: string;
    tokenCount: number;
}
export declare function estimateTokens(text: string): number;
export declare function parseTranscript(transcriptPath: string): ParsedMessage[];
