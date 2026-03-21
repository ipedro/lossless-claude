import { readFileSync, writeFileSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { REQUIRED_HOOKS, mergeClaudeSettings } from "../../installer/install.js";
function defaultDeps() {
    return {
        readFileSync: (p, enc) => readFileSync(p, enc),
        writeFileSync,
        existsSync,
        mkdirSync,
        appendFileSync,
        settingsPath: join(homedir(), ".claude", "settings.json"),
        logPath: join(homedir(), ".lossless-claude", "auto-heal.log"),
    };
}
function hasHookCommand(entries, command) {
    return entries.some((entry) => Array.isArray(entry.hooks) && entry.hooks.some((h) => h.command === command));
}
export function validateAndFixHooks(deps = defaultDeps()) {
    try {
        let settings = {};
        if (deps.existsSync(deps.settingsPath)) {
            settings = JSON.parse(deps.readFileSync(deps.settingsPath, "utf-8"));
        }
        const hooks = settings.hooks ?? {};
        const allPresent = REQUIRED_HOOKS.every(({ event, command }) => {
            const entries = hooks[event];
            return Array.isArray(entries) && hasHookCommand(entries, command);
        });
        if (allPresent)
            return;
        const merged = mergeClaudeSettings(settings);
        deps.mkdirSync(dirname(deps.settingsPath), { recursive: true });
        deps.writeFileSync(deps.settingsPath, JSON.stringify(merged, null, 2));
    }
    catch (err) {
        try {
            deps.mkdirSync(dirname(deps.logPath), { recursive: true });
            const msg = `[${new Date().toISOString()}] auto-heal error: ${err instanceof Error ? err.message : String(err)}\n`;
            deps.appendFileSync(deps.logPath, msg);
        }
        catch {
            // Last resort: silently fail
        }
    }
}
//# sourceMappingURL=auto-heal.js.map