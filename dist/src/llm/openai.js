import OpenAI from "openai";
import { LCM_SUMMARIZER_SYSTEM_PROMPT, buildLeafSummaryPrompt, buildCondensedSummaryPrompt, resolveTargetTokens, } from "../summarize.js";
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
export function createOpenAISummarizer(opts) {
    const client = opts._clientOverride ??
        new OpenAI({
            baseURL: opts.baseURL,
            apiKey: opts.apiKey || "local", // many local servers require a non-empty key
        });
    const retryDelayMs = opts._retryDelayMs ?? 1000;
    const MAX_RETRIES = 3;
    return async function summarize(text, aggressive, ctx = {}) {
        const estimatedInputTokens = Math.ceil(text.length / 4);
        const targetTokens = ctx.targetTokens ??
            resolveTargetTokens({
                inputTokens: estimatedInputTokens,
                mode: aggressive ? "aggressive" : "normal",
                isCondensed: ctx.isCondensed ?? false,
                condensedTargetTokens: 2000,
            });
        const prompt = ctx.isCondensed
            ? buildCondensedSummaryPrompt({ text, targetTokens, depth: ctx.depth ?? 1 })
            : buildLeafSummaryPrompt({ text, mode: aggressive ? "aggressive" : "normal", targetTokens });
        let lastError;
        for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
            try {
                const response = await client.chat.completions.create({
                    model: opts.model,
                    max_tokens: 1024,
                    // Merge system content into user message for compatibility with local
                    // servers (e.g. MLX/llama.cpp) that don't support role:"system".
                    messages: [
                        { role: "user", content: `${LCM_SUMMARIZER_SYSTEM_PROMPT}\n\n${prompt}` },
                    ],
                });
                const textContent = response.choices[0]?.message?.content ?? "";
                return textContent || text.slice(0, 500);
            }
            catch (err) {
                if (err?.status === 401)
                    throw err; // auth error: no retry
                lastError = err;
                if (attempt < MAX_RETRIES - 1)
                    await sleep(retryDelayMs * Math.pow(2, attempt));
            }
        }
        throw lastError;
    };
}
//# sourceMappingURL=openai.js.map