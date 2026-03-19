import { createServer } from "node:http";
import { createCompactHandler } from "./routes/compact.js";
import { createRestoreHandler } from "./routes/restore.js";
import { createGrepHandler } from "./routes/grep.js";
import { createSearchHandler } from "./routes/search.js";
import { createExpandHandler } from "./routes/expand.js";
import { createDescribeHandler } from "./routes/describe.js";
import { createStoreHandler } from "./routes/store.js";
import { createRecentHandler } from "./routes/recent.js";
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
    routes.set("GET /health", async (_req, res) => sendJson(res, 200, { status: "ok", uptime: Math.floor((Date.now() - startTime) / 1000) }));
    routes.set("POST /compact", createCompactHandler(config));
    routes.set("POST /restore", createRestoreHandler(config));
    routes.set("POST /grep", createGrepHandler(config));
    routes.set("POST /search", createSearchHandler(config));
    routes.set("POST /expand", createExpandHandler(config));
    routes.set("POST /describe", createDescribeHandler(config));
    routes.set("POST /store", createStoreHandler(config));
    routes.set("POST /recent", createRecentHandler(config));
    const server = createServer(async (req, res) => {
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
            resolve({
                address: () => server.address(),
                stop: async () => {
                    if (proxyManager) {
                        try {
                            await proxyManager.stop();
                        }
                        catch { /* non-fatal */ }
                    }
                    return new Promise((r) => server.close(() => r()));
                },
                registerRoute: (method, path, handler) => routes.set(`${method} ${path}`, handler),
            });
        });
    });
}
//# sourceMappingURL=server.js.map