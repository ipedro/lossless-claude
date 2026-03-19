import { spawn } from "node:child_process";
import { readFileSync, writeFileSync, unlinkSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function isProcessAlive(pid, killCheck) {
    if (killCheck)
        return killCheck(pid);
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
export function createClaudeCliProxyManager(opts) {
    const port = opts.port;
    const pidFilePath = opts.pidFilePath ?? join(homedir(), ".lossless-claude", "lcm-proxy.pid");
    const healthPollIntervalMs = opts.healthPollIntervalMs ?? 500;
    const healthMonitorIntervalMs = opts.healthMonitorIntervalMs ?? 30_000;
    const maxHealthMisses = opts.maxHealthMisses ?? 3;
    const fetchFn = opts._fetchOverride ?? globalThis.fetch;
    const healthURL = `http://localhost:${port}/health`;
    let child = null;
    let _available = false;
    let monitorTimer = null;
    let hasAttemptedRestart = false;
    let startPromise = null;
    async function checkHealth() {
        try {
            const res = await fetchFn(healthURL);
            if (!res.ok)
                return { ok: false, isClaudeServer: false };
            const body = await res.json();
            const isClaudeServer = body?.service === "claude-server";
            return { ok: true, isClaudeServer };
        }
        catch {
            return { ok: false, isClaudeServer: false };
        }
    }
    async function waitForHealth() {
        const deadline = Date.now() + opts.startupTimeoutMs;
        while (Date.now() < deadline) {
            const { ok, isClaudeServer } = await checkHealth();
            if (ok && isClaudeServer)
                return true;
            if (ok && !isClaudeServer)
                return false; // foreign process on port
            await sleep(healthPollIntervalMs);
        }
        return false;
    }
    function spawnChild() {
        const cp = spawn("claude-server", ["--port", String(port), "--model", opts.model], {
            stdio: ["ignore", "ignore", "pipe"],
            detached: false,
        });
        cp.stderr?.on("data", () => { }); // drain stderr to prevent buffer fill
        cp.unref();
        return cp;
    }
    function writePid(pid) {
        writeFileSync(pidFilePath, String(pid));
    }
    function deletePidFile() {
        try {
            if (existsSync(pidFilePath))
                unlinkSync(pidFilePath);
        }
        catch { /* ignore */ }
    }
    function startHealthMonitor() {
        if (monitorTimer)
            return;
        let consecutiveMisses = 0;
        monitorTimer = setInterval(async () => {
            const { ok, isClaudeServer } = await checkHealth();
            if (ok && isClaudeServer) {
                consecutiveMisses = 0;
                return;
            }
            consecutiveMisses++;
            if (consecutiveMisses >= maxHealthMisses) {
                stopHealthMonitor();
                if (!hasAttemptedRestart) {
                    hasAttemptedRestart = true;
                    console.warn("[lcm] claude-server health check failed — attempting restart...");
                    try {
                        await doStart();
                    }
                    catch {
                        console.warn("[lcm] claude-server unavailable. Run 'claude login' to authenticate,\n" +
                            "      then restart Claude Code. Alternatively, set LCM_SUMMARY_PROVIDER=anthropic\n" +
                            "      and LCM_SUMMARY_API_KEY=<key> to use the Anthropic API directly.");
                        _available = false;
                        deletePidFile();
                    }
                }
                else {
                    console.warn("[lcm] claude-server unavailable after restart attempt. Summarization disabled for this session.");
                    _available = false;
                    deletePidFile();
                }
            }
        }, healthMonitorIntervalMs);
    }
    function stopHealthMonitor() {
        if (monitorTimer) {
            clearInterval(monitorTimer);
            monitorTimer = null;
        }
    }
    async function _doStartInternal() {
        // Step 1: Check existing PID file
        if (existsSync(pidFilePath)) {
            try {
                const pid = parseInt(readFileSync(pidFilePath, "utf-8").trim(), 10);
                if (!isNaN(pid) && isProcessAlive(pid, opts._killCheck)) {
                    // Process alive — check if it's actually claude-server
                    const { ok, isClaudeServer } = await checkHealth();
                    if (ok && isClaudeServer) {
                        _available = true;
                        startHealthMonitor();
                        return; // reuse existing process
                    }
                }
            }
            catch { /* ignore read errors */ }
            // Stale PID or wrong service — clean up
            deletePidFile();
        }
        // Step 2: Spawn new process
        child = spawnChild();
        child.on("error", (err) => {
            console.warn(`[lcm] claude-server spawn error: ${err.message}`);
            _available = false;
            deletePidFile();
            child = null;
        });
        if (child.pid)
            writePid(child.pid);
        // Handle child exit
        child.on("exit", () => {
            child = null;
        });
        // Step 3: Wait for health
        const healthy = await waitForHealth();
        if (healthy) {
            _available = true;
            startHealthMonitor();
        }
        else {
            // Check if it's a foreign process on the port
            const { ok, isClaudeServer } = await checkHealth();
            if (ok && !isClaudeServer) {
                console.warn(`[lcm] Port ${port} is occupied by another service. claude-server cannot start.`);
            }
            else {
                console.warn("[lcm] claude-server unavailable. Run 'claude login' to authenticate,\n" +
                    "      then restart Claude Code. Alternatively, set LCM_SUMMARY_PROVIDER=anthropic\n" +
                    "      and LCM_SUMMARY_API_KEY=<key> to use the Anthropic API directly.");
            }
            // Kill the child we spawned since it's not healthy
            if (child) {
                child.kill("SIGTERM");
                child = null;
            }
            _available = false;
            deletePidFile();
        }
    }
    async function doStart() {
        if (startPromise)
            return startPromise;
        startPromise = _doStartInternal().finally(() => { startPromise = null; });
        return startPromise;
    }
    const manager = {
        get port() { return port; },
        get available() { return _available; },
        async start() {
            await doStart();
        },
        async stop() {
            stopHealthMonitor();
            hasAttemptedRestart = false;
            if (child) {
                child.kill("SIGTERM");
                child = null;
            }
            _available = false;
            deletePidFile();
        },
        async isHealthy() {
            const { ok, isClaudeServer } = await checkHealth();
            return ok && isClaudeServer;
        },
    };
    return manager;
}
//# sourceMappingURL=proxy-manager.js.map