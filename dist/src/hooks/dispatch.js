import { validateAndFixHooks } from "./auto-heal.js";
export const HOOK_COMMANDS = ["compact", "restore", "session-end", "user-prompt"];
export function isHookCommand(cmd) {
    return HOOK_COMMANDS.includes(cmd);
}
export async function dispatchHook(command, stdinText) {
    validateAndFixHooks();
    const { DaemonClient } = await import("../daemon/client.js");
    const { loadDaemonConfig } = await import("../daemon/config.js");
    const { join } = await import("node:path");
    const { homedir } = await import("node:os");
    const config = loadDaemonConfig(join(homedir(), ".lossless-claude", "config.json"));
    const port = config.daemon?.port ?? 3737;
    const client = new DaemonClient(`http://127.0.0.1:${port}`);
    switch (command) {
        case "compact": {
            const { handlePreCompact } = await import("./compact.js");
            return handlePreCompact(stdinText, client, port);
        }
        case "restore": {
            const { handleSessionStart } = await import("./restore.js");
            return handleSessionStart(stdinText, client, port);
        }
        case "session-end": {
            const { handleSessionEnd } = await import("./session-end.js");
            return handleSessionEnd(stdinText, client, port);
        }
        case "user-prompt": {
            const { handleUserPromptSubmit } = await import("./user-prompt.js");
            return handleUserPromptSubmit(stdinText, client, port);
        }
        default:
            throw new Error(`Unknown hook command: ${command}`);
    }
}
//# sourceMappingURL=dispatch.js.map