import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createCompactHandler } from "./routes/compact.js";
import { createRestoreHandler } from "./routes/restore.js";
import { createGrepHandler } from "./routes/grep.js";
import { createSearchHandler } from "./routes/search.js";
import { createExpandHandler } from "./routes/expand.js";
import { createDescribeHandler } from "./routes/describe.js";
import { createStoreHandler } from "./routes/store.js";
import { createRecentHandler } from "./routes/recent.js";
import { createIngestHandler } from "./routes/ingest.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
export const PKG_VERSION = (() => {
    try {
        const pkg = JSON.parse(readFileSync(join(__dirname, "..", "..", "package.json"), "utf-8"));
        return pkg.version;
    }
    catch {
        return "0.0.0";
    }
})();
export async function readBody(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    return Buffer.concat(chunks).toString("utf-8");
}
export function sendJson(res, status, data) {
    const body = JSON.stringify(data);
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(body);
}
export async function createDaemon(config, options) {
    const startTime = Date.now();
    const proxyManager = options?.proxyManager;
    const routes = new Map();
    let idleTimer = null;
    let idleTriggered = false;
    const onIdle = options?.onIdle ?? (() => {
        console.log("[lcm] idle timeout — shutting down");
        process.exit(0);
    });
    function resetIdleTimer() {
        if (config.daemon.idleTimeoutMs <= 0)
            return;
        if (idleTimer)
            clearTimeout(idleTimer);
        idleTimer = setTimeout(() => {
            idleTriggered = true;
            onIdle();
        }, config.daemon.idleTimeoutMs);
    }
    routes.set("GET /health", async (_req, res) => sendJson(res, 200, { status: "ok", version: PKG_VERSION, uptime: Math.floor((Date.now() - startTime) / 1000) }));
    routes.set("POST /compact", createCompactHandler(config));
    routes.set("POST /restore", createRestoreHandler(config));
    routes.set("POST /grep", createGrepHandler(config));
    routes.set("POST /search", createSearchHandler());
    routes.set("POST /expand", createExpandHandler(config));
    routes.set("POST /describe", createDescribeHandler(config));
    routes.set("POST /store", createStoreHandler());
    routes.set("POST /recent", createRecentHandler(config));
    routes.set("POST /ingest", createIngestHandler(config));
    // Periodic transcript ingestion scan
    const INGEST_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes
    const ingestHandler = createIngestHandler(config);
    const scanForTranscripts = async () => {
        try {
            const { readdirSync, existsSync, readFileSync } = await import("node:fs");
            const { join } = await import("node:path");
            const { homedir } = await import("node:os");
            const projectsDir = join(homedir(), ".lossless-claude", "projects");
            if (!existsSync(projectsDir))
                return;
            for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
                if (!entry.isDirectory())
                    continue;
                const metaPath = join(projectsDir, entry.name, "meta.json");
                if (!existsSync(metaPath))
                    continue;
                let meta = {};
                try {
                    meta = JSON.parse(readFileSync(metaPath, "utf-8"));
                }
                catch {
                    continue;
                }
                if (!meta.cwd)
                    continue;
                // Find Claude Code session files for this project's cwd
                const cwdDashed = meta.cwd.replace(/\//g, "-").replace(/^-/, "");
                const sessionsDir = join(homedir(), ".claude", "projects", cwdDashed);
                if (!existsSync(sessionsDir))
                    continue;
                for (const file of readdirSync(sessionsDir)) {
                    if (!file.endsWith(".jsonl"))
                        continue;
                    const sessionId = file.replace(".jsonl", "");
                    const transcriptPath = join(sessionsDir, file);
                    // Use the ingest route logic directly
                    const mockReq = {};
                    const response = { statusCode: 200, body: "" };
                    const mockRes = {
                        writeHead: (code) => { response.statusCode = code; },
                        end: (data) => { response.body = data; },
                    };
                    await ingestHandler(mockReq, mockRes, JSON.stringify({
                        session_id: sessionId,
                        cwd: meta.cwd,
                        transcript_path: transcriptPath,
                    }));
                }
            }
        }
        catch {
            // non-fatal: periodic scan failure shouldn't crash daemon
        }
    };
    const ingestInterval = setInterval(scanForTranscripts, INGEST_INTERVAL_MS);
    ingestInterval.unref(); // don't prevent process exit
    const server = createServer(async (req, res) => {
        resetIdleTimer();
        const key = `${req.method} ${req.url?.split("?")[0]}`;
        const handler = routes.get(key);
        if (!handler) {
            sendJson(res, 404, { error: "not found" });
            return;
        }
        try {
            await handler(req, res, req.method !== "GET" ? await readBody(req) : "");
        }
        catch (err) {
            sendJson(res, 500, { error: err instanceof Error ? err.message : "internal error" });
        }
    });
    // Start proxy manager if provided (non-fatal on failure)
    if (proxyManager) {
        try {
            await proxyManager.start();
        }
        catch (err) {
            console.warn(`[lcm] claude-server proxy failed to start: ${err instanceof Error ? err.message : err}`);
        }
    }
    return new Promise((resolve) => {
        server.listen(config.daemon.port, "127.0.0.1", () => {
            resetIdleTimer();
            resolve({
                address: () => server.address(),
                stop: async () => {
                    clearInterval(ingestInterval);
                    if (idleTimer) {
                        clearTimeout(idleTimer);
                        idleTimer = null;
                    }
                    if (proxyManager) {
                        try {
                            await proxyManager.stop();
                        }
                        catch { /* non-fatal */ }
                    }
                    return new Promise((r) => server.close(() => r()));
                },
                registerRoute: (method, path, handler) => routes.set(`${method} ${path}`, handler),
                get idleTriggered() { return idleTriggered; },
            });
        });
    });
}
//# sourceMappingURL=server.js.map