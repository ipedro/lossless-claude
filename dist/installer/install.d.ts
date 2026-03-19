import { rmSync } from "node:fs";
import { type SpawnSyncReturns } from "node:child_process";
export declare function mergeClaudeSettings(existing: any): any;
export interface ServiceDeps {
    spawnSync: (cmd: string, args: string[], opts?: any) => SpawnSyncReturns<string>;
    readFileSync: (path: string, encoding: string) => string;
    writeFileSync: (path: string, data: string) => void;
    mkdirSync: (path: string, opts?: any) => void;
    existsSync: (path: string) => boolean;
    promptUser: (question: string) => Promise<string>;
}
export declare function resolveBinaryPath(deps?: Pick<ServiceDeps, "spawnSync" | "existsSync">): string;
export declare function buildLaunchdPlist(binaryPath: string, logPath: string, nodeBinDir?: string): string;
export declare function buildSystemdUnit(binaryPath: string): string;
export declare function setupDaemonService(deps?: ServiceDeps): void;
export declare function install(deps?: ServiceDeps): Promise<void>;
export { rmSync };
