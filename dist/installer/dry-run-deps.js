import { existsSync as realExistsSync, readFileSync as realReadFileSync, } from "node:fs";
import { spawnSync as realSpawnSync } from "node:child_process";
const fakeZeroExit = () => ({
    status: 0,
    stdout: "",
    stderr: "",
    pid: 0,
    output: [],
    signal: null,
    error: undefined,
});
export class DryRunServiceDeps {
    // ── intercepted ───────────────────────────────────────────────────────────
    writeFileSync(path, _data) {
        console.log(`[dry-run] would write: ${path}`);
    }
    mkdirSync(path, _opts) {
        if (!realExistsSync(path)) {
            console.log(`[dry-run] would create: ${path}`);
        }
    }
    rmSync(path) {
        console.log(`[dry-run] would remove: ${path}`);
    }
    spawnSync(cmd, args, opts) {
        // Special case 1: setup.sh — actually run it with XGH_DRY_RUN=1 so it prints its own preview.
        // Use stdio:"pipe" (not inherited) so we can capture stdout and forward it ourselves,
        // enabling both user-visible output and testable result.stdout.
        if (cmd === "bash" && typeof args[0] === "string" && args[0].endsWith("setup.sh")) {
            const env = { ...(opts?.env ?? process.env), XGH_DRY_RUN: "1" };
            const result = realSpawnSync(cmd, args, { encoding: "utf-8", env, stdio: "pipe" });
            if (result.stdout)
                process.stdout.write(result.stdout);
            if (result.stderr)
                process.stderr.write(result.stderr);
            return result;
        }
        // Special case 2: binary resolution — return canned result, no output printed
        if (cmd === "sh" && args[0] === "-c" && typeof args[1] === "string" && args[1].startsWith("command -v")) {
            return { ...fakeZeroExit(), stdout: "lossless-claude" };
        }
        // All other commands: print and fake
        console.log(`[dry-run] would run: ${cmd} ${args.join(" ")}`);
        return fakeZeroExit();
    }
    async promptUser(question) {
        console.log(`[dry-run] would prompt: ${question}`);
        return "";
    }
    async ensureDaemon(_opts) {
        console.log(`[dry-run] would start daemon on port ${_opts.port}`);
        return { connected: true };
    }
    async runDoctor() {
        console.log(`[dry-run] would run doctor checks`);
        return [];
    }
    // ── pass-through ──────────────────────────────────────────────────────────
    readFileSync(path, encoding) {
        return realReadFileSync(path, encoding);
    }
    existsSync(path) {
        return realExistsSync(path);
    }
}
//# sourceMappingURL=dry-run-deps.js.map