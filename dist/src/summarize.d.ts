import type { LcmDependencies } from "./types.js";
export type LcmSummarizeOptions = {
    previousSummary?: string;
    isCondensed?: boolean;
    depth?: number;
};
export type LcmSummarizeFn = (text: string, aggressive?: boolean, options?: LcmSummarizeOptions) => Promise<string>;
export type LcmSummarizerLegacyParams = {
    provider?: unknown;
    model?: unknown;
    config?: unknown;
    agentDir?: unknown;
    authProfileId?: unknown;
};
type SummaryMode = "normal" | "aggressive";
export declare const LCM_SUMMARIZER_SYSTEM_PROMPT: string;
/**
 * Resolve a practical target token count for leaf and condensed summaries.
 * Aggressive leaf mode intentionally aims lower so compaction converges faster.
 */
export declare function resolveTargetTokens(params: {
    inputTokens: number;
    mode: SummaryMode;
    isCondensed: boolean;
    condensedTargetTokens: number;
}): number;
/**
 * Build a leaf (segment) summarization prompt.
 *
 * Normal leaf mode preserves details; aggressive leaf mode keeps only the
 * highest-value facts needed for follow-up turns.
 */
export declare function buildLeafSummaryPrompt(params: {
    text: string;
    mode: SummaryMode;
    targetTokens: number;
    previousSummary?: string;
    customInstructions?: string;
}): string;
/** Build a condensed prompt variant based on the output node depth. */
export declare function buildCondensedSummaryPrompt(params: {
    text: string;
    targetTokens: number;
    depth: number;
    previousSummary?: string;
    customInstructions?: string;
}): string;
/**
 * Builds a model-backed LCM summarize callback from runtime legacy params.
 *
 * Returns `undefined` when model/provider context is unavailable so callers can
 * choose a fallback summarizer.
 */
export declare function createLcmSummarizeFromLegacyParams(params: {
    deps: LcmDependencies;
    legacyParams: LcmSummarizerLegacyParams;
    customInstructions?: string;
}): Promise<LcmSummarizeFn | undefined>;
export {};
