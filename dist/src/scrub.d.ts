export declare const BUILT_IN_PATTERNS: string[];
export declare class ScrubEngine {
    private readonly spanningPatterns;
    private readonly tokenPatterns;
    readonly invalidPatterns: string[];
    constructor(globalPatterns: string[], projectPatterns: string[]);
    /**
     * Redact all matching patterns in text, replacing matches with [REDACTED].
     *
     * Strategy:
     * - "Spanning" patterns (those that can match across whitespace) are applied
     *   to the full text via a multi-range merge to avoid one pattern consuming
     *   another's matches.
     * - "Token" patterns (no whitespace/dot in source) are applied token-by-token
     *   so that greedy `.*`-style patterns in one token don't eat adjacent tokens.
     */
    scrub(text: string): string;
    /** Parse a sensitive-patterns.txt file. Returns empty array if file is absent. */
    static loadProjectPatterns(filePath: string): Promise<string[]>;
    /** Build a ScrubEngine for a given project directory. */
    static forProject(globalPatterns: string[], projectDir: string): Promise<ScrubEngine>;
}
