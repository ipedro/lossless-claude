import type { LcmSummarizeFn } from "./types.js";
type OpenAISummarizerOptions = {
    model: string;
    baseURL: string;
    apiKey?: string;
    _clientOverride?: any;
    _retryDelayMs?: number;
};
export declare function createOpenAISummarizer(opts: OpenAISummarizerOptions): LcmSummarizeFn;
export {};
