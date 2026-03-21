import { rmSync } from "node:fs";
import { type SpawnSyncReturns } from "node:child_process";
export declare const REQUIRED_HOOKS: {
    event: string;
    command: string;
}[];
export declare function mergeClaudeSettings(existing: any): any;
export interface ServiceDeps {
    spawnSync: (cmd: string, args: string[], opts?: any) => SpawnSyncReturns<string>;
    readFileSync: (path: string, encoding: string) => string;
    writeFileSync: (path: string, data: string) => void;
    mkdirSync: (path: string, opts?: any) => void;
    existsSync: (path: string) => boolean;
    promptUser: (question: string) => Promise<string>;
    ensureDaemon?: (opts: {
        port: number;
        pidFilePath: string;
        spawnTimeoutMs: number;
    }) => Promise<{
        connected: boolean;
    }>;
    runDoctor?: () => Promise<Array<{
        name: string;
        status: string;
        category?: string;
        message?: string;
    }>>;
}
export declare function resolveBinaryPath(deps?: Pick<ServiceDeps, "spawnSync" | "existsSync">): string;
export declare function waitForHealth(url: string, timeoutMs?: number, fetchFn?: typeof globalThis.fetch): Promise<boolean>;
export declare function install(deps?: ServiceDeps): Promise<void>;
export { rmSync };
