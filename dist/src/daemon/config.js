import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
const DEFAULTS = {
    version: 1,
    daemon: { port: 3737, socketPath: join(homedir(), ".lossless-claude", "daemon.sock"), logLevel: "info", logMaxSizeMB: 10, logRetentionDays: 7, idleTimeoutMs: 1800000 },
    compaction: {
        leafTokens: 1000, maxDepth: 5,
        promotionThresholds: {
            minDepth: 2, compressionRatio: 0.3,
            keywords: { decision: ["decided", "agreed", "will use", "going with", "chosen"], fix: ["fixed", "root cause", "workaround", "resolved"] },
            architecturePatterns: ["src/[\\w/]+\\.ts", "[A-Z][a-zA-Z]+(Engine|Store|Service|Manager|Handler|Client)", "interface [A-Z]", "class [A-Z]"],
        },
    },
    restoration: { recentSummaries: 3 },
    llm: { provider: "claude-cli", model: "claude-haiku-4-5", apiKey: "", baseURL: "" },
    claudeCliProxy: { enabled: true, port: 3456, startupTimeoutMs: 10000, model: "claude-haiku-4-5" },
};
function deepMerge(target, source) {
    if (!source || typeof source !== "object")
        return target;
    const result = { ...target };
    for (const key of Object.keys(source)) {
        if (source[key] !== undefined) {
            result[key] = (typeof source[key] === "object" && !Array.isArray(source[key]) && typeof target[key] === "object")
                ? deepMerge(target[key], source[key]) : source[key];
        }
    }
    return result;
}
export function loadDaemonConfig(configPath, overrides, env) {
    const e = env ?? process.env;
    let fileConfig = {};
    try {
        fileConfig = JSON.parse(readFileSync(configPath, "utf-8"));
    }
    catch { }
    const merged = deepMerge(structuredClone(DEFAULTS), deepMerge(fileConfig, overrides));
    if (merged.llm.apiKey)
        merged.llm.apiKey = merged.llm.apiKey.replace(/\$\{(\w+)\}/g, (_, k) => e[k] ?? "");
    // Env var override: LCM_SUMMARY_PROVIDER takes precedence over config
    const VALID_PROVIDERS = new Set(["claude-cli", "anthropic", "openai", "disabled"]);
    if (e.LCM_SUMMARY_PROVIDER) {
        if (!VALID_PROVIDERS.has(e.LCM_SUMMARY_PROVIDER)) {
            throw new Error(`[lcm] Invalid LCM_SUMMARY_PROVIDER="${e.LCM_SUMMARY_PROVIDER}". ` +
                `Valid values: ${[...VALID_PROVIDERS].join(", ")}`);
        }
        merged.llm.provider = e.LCM_SUMMARY_PROVIDER;
        // When overriding away from claude-cli, disable the proxy
        if (merged.llm.provider !== "claude-cli") {
            merged.claudeCliProxy.enabled = false;
        }
    }
    // Disable proxy when provider is not claude-cli
    if (merged.llm.provider !== "claude-cli") {
        merged.claudeCliProxy.enabled = false;
    }
    // Anthropic API key fallback from env
    if (!merged.llm.apiKey && merged.llm.provider === "anthropic" && e.ANTHROPIC_API_KEY) {
        merged.llm.apiKey = e.ANTHROPIC_API_KEY;
    }
    // Resolve "claude-cli" provider
    if (merged.llm.provider === "claude-cli") {
        if (merged.claudeCliProxy.enabled) {
            merged.llm.provider = "openai";
            merged.llm.baseURL = `http://localhost:${merged.claudeCliProxy.port}/v1`;
        }
        else {
            merged.llm.provider = "disabled";
        }
    }
    // Validate: anthropic provider requires an API key
    if (merged.llm.provider === "anthropic" && !merged.llm.apiKey) {
        throw new Error("[lcm] LCM_SUMMARY_API_KEY is required when using the Anthropic provider. " +
            "Set it in your environment or switch to 'claude-cli' provider.");
    }
    return merged;
}
//# sourceMappingURL=config.js.map