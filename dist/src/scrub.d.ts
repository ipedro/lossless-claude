export declare const BUILT_IN_PATTERNS: string[];
export declare class ScrubEngine {
    private readonly spanningPatterns;
    private readonly tokenPatterns;
    /** Original index (into the combined [builtIn, global, project] array) for each spanning pattern. */
    private readonly _spanningOrigIdx;
    /** Original index for each token pattern. */
    private readonly _tokenOrigIdx;
    /** Number of global patterns (for category accounting). */
    readonly _globalPatternCount: number;
    readonly invalidPatterns: string[];
    constructor(globalPatterns: string[], projectPatterns: string[]);
    /**
     * Redact all matching patterns in text, returning the scrubbed text along
     * with per-category counts of how many redactions were made.
     *
     * Strategy:
     * - "Spanning" patterns (those that can match across whitespace) are applied
     *   to the full text via a multi-range merge to avoid one pattern consuming
     *   another's matches.
     * - "Token" patterns (no whitespace/dot in source) are applied token-by-token
     *   so that greedy `.*`-style patterns in one token don't eat adjacent tokens.
     */
    scrubWithCounts(text: string): {
        text: string;
        builtIn: number;
        global: number;
        project: number;
    };
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
