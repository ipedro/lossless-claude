import type { DaemonClient } from "../daemon/client.js";
export declare function handleUserPromptSubmit(stdin: string, client: DaemonClient, port?: number): Promise<{
    exitCode: number;
    stdout: string;
}>;
