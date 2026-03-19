import type { LcmSummarizeFn } from "./types.js";
export type { LcmSummarizeFn } from "./types.js";
type SummarizerOptions = {
    model: string;
    apiKey: string;
    _clientOverride?: any;
    _retryDelayMs?: number;
};
export declare function createAnthropicSummarizer(opts: SummarizerOptions): LcmSummarizeFn;
