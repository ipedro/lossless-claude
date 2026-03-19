import type { DaemonClient } from "../daemon/client.js";
export declare function handlePreCompact(stdin: string, client: DaemonClient): Promise<{
    exitCode: number;
    stdout: string;
}>;
