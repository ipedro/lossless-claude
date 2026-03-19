import type { DaemonClient } from "../daemon/client.js";
export declare function handleSessionStart(stdin: string, client: DaemonClient): Promise<{
    exitCode: number;
    stdout: string;
}>;
