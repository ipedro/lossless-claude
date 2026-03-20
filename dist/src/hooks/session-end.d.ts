import type { DaemonClient } from "../daemon/client.js";
export declare function handleSessionEnd(stdin: string, client: DaemonClient, port?: number): Promise<{
    exitCode: number;
    stdout: string;
}>;
