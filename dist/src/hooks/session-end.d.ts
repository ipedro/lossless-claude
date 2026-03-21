import type { DaemonClient } from "../daemon/client.js";
/**
 * Fire a compact request to the daemon without blocking the hook process.
 *
 * Uses a raw http.request with socket.unref() so the Node.js event loop
 * does not wait for a response — the process exits as soon as the request
 * is sent. The daemon receives and processes the request independently.
 *
 * This is intentionally separate from DaemonClient.post() (which uses fetch
 * and keeps the event loop alive until a response is received).
 */
export declare function fireCompactRequest(port: number, body: Record<string, unknown>): void;
export declare function handleSessionEnd(stdin: string, client: DaemonClient, port?: number): Promise<{
    exitCode: number;
    stdout: string;
}>;
