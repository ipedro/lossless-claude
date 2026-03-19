import { existsSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
function sleep(ms) {
    return new Promise((r) => setTimeout(r, ms));
}
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    }
    catch {
        return false;
    }
}
function cleanStalePid(pidFilePath) {
    try {
        if (existsSync(pidFilePath))
            unlinkSync(pidFilePath);
    }
    catch { /* ignore */ }
}
async function checkDaemonHealth(port, fetchFn) {
    try {
        const res = await fetchFn(`http://127.0.0.1:${port}/health`);
        if (!res.ok)
            return null;
        return (await res.json());
    }
    catch {
        return null;
    }
}
export async function ensureDaemon(opts) {
    const fetchFn = opts._fetchOverride ?? globalThis.fetch;
    // Step 1: Check if daemon is already running via health check
    const health = await checkDaemonHealth(opts.port, fetchFn);
    if (health?.status === "ok") {
        // Version check — if mismatch, kill and respawn
        if (opts.expectedVersion && health.version && health.version !== opts.expectedVersion) {
            if (existsSync(opts.pidFilePath)) {
                try {
                    const pid = parseInt(readFileSync(opts.pidFilePath, "utf-8").trim(), 10);
                    if (!isNaN(pid) && isProcessAlive(pid)) {
                        process.kill(pid, "SIGTERM");
                        await sleep(500);
                    }
                }
                catch { /* ignore */ }
                cleanStalePid(opts.pidFilePath);
            }
            // Fall through to spawn
        }
        else {
            return { connected: true, port: opts.port, spawned: false };
        }
    }
    // Step 2: Check PID file for stale process
    if (existsSync(opts.pidFilePath)) {
        try {
            const pid = parseInt(readFileSync(opts.pidFilePath, "utf-8").trim(), 10);
            if (!isNaN(pid) && isProcessAlive(pid)) {
                await sleep(1000);
                const retry = await checkDaemonHealth(opts.port, fetchFn);
                if (retry?.status === "ok") {
                    return { connected: true, port: opts.port, spawned: false };
                }
            }
        }
        catch { /* ignore */ }
        cleanStalePid(opts.pidFilePath);
    }
    // Step 3: Spawn daemon (unless skipped for testing)
    if (opts._skipSpawn) {
        return { connected: false, port: opts.port, spawned: false };
    }
    const child = spawn(process.execPath, [process.argv[1], "daemon", "start"], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env },
    });
    child.unref();
    if (child.pid) {
        writeFileSync(opts.pidFilePath, String(child.pid));
    }
    // Step 4: Wait for health
    const deadline = Date.now() + opts.spawnTimeoutMs;
    while (Date.now() < deadline) {
        const h = await checkDaemonHealth(opts.port, fetchFn);
        if (h?.status === "ok") {
            return { connected: true, port: opts.port, spawned: true };
        }
        await sleep(300);
    }
    return { connected: false, port: opts.port, spawned: true };
}
//# sourceMappingURL=lifecycle.js.map