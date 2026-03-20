import { spawn } from "node:child_process";
import { LCM_SUMMARIZER_SYSTEM_PROMPT, buildLeafSummaryPrompt, buildCondensedSummaryPrompt, resolveTargetTokens, } from "../summarize.js";
const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const TIMEOUT_MS = 120_000;
export function createClaudeProcessSummarizer() {
    return async function summarize(text, aggressive, ctx = {}) {
        const estimatedInputTokens = Math.ceil(text.length / 4);
        const targetTokens = ctx.targetTokens ?? resolveTargetTokens({
            inputTokens: estimatedInputTokens,
            mode: aggressive ? "aggressive" : "normal",
            isCondensed: ctx.isCondensed ?? false,
            condensedTargetTokens: 2000,
        });
        const prompt = ctx.isCondensed
            ? buildCondensedSummaryPrompt({ text, targetTokens, depth: ctx.depth ?? 1 })
            : buildLeafSummaryPrompt({ text, mode: aggressive ? "aggressive" : "normal", targetTokens });
        return new Promise((resolve, reject) => {
            const proc = spawn("claude", ["--print", "--model", HAIKU_MODEL], {
                stdio: ["pipe", "pipe", "pipe"],
            });
            let stdout = "";
            let stderr = "";
            proc.stdout.on("data", (d) => { stdout += d.toString(); });
            proc.stderr.on("data", (d) => { stderr += d.toString(); });
            const timer = setTimeout(() => {
                proc.kill();
                reject(new Error(`claude process timed out after ${TIMEOUT_MS / 1000}s`));
            }, TIMEOUT_MS);
            proc.on("close", (code) => {
                clearTimeout(timer);
                const out = stdout.trim();
                if (code === 0 && out) {
                    resolve(out);
                }
                else {
                    reject(new Error(`claude exited ${code}: ${stderr.slice(0, 200) || "no output"}`));
                }
            });
            proc.on("error", (err) => {
                clearTimeout(timer);
                reject(err);
            });
            // Write system + user prompt to stdin
            proc.stdin.write(`${LCM_SUMMARIZER_SYSTEM_PROMPT}\n\n${prompt}`);
            proc.stdin.end();
        });
    };
}
//# sourceMappingURL=claude-process.js.map