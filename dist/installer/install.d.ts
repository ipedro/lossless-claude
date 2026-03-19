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
export interface CipherConfig {
    embeddingModel: string;
    embeddingBaseURL: string;
    embeddingDimensions: string;
    llmModel: string;
    llmBaseURL: string;
    backend: string;
}
export declare function parseCipherConfig(cipherYmlPath: string, deps: Pick<ServiceDeps, "readFileSync">): CipherConfig | null;
export declare function installCipherPackage(deps: Pick<ServiceDeps, "spawnSync">): boolean;
export declare function installCipherWrapper(deps: Pick<ServiceDeps, "mkdirSync" | "existsSync">): void;
export declare function mergeCipherSettings(existing: any, config: CipherConfig): any;
export declare function installClaudeServer(deps: Pick<ServiceDeps, "spawnSync">, config: {
    provider: string;
}): boolean;
export declare function waitForHealth(url: string, timeoutMs?: number, fetchFn?: typeof globalThis.fetch): Promise<boolean>;
export declare function install(deps?: ServiceDeps): Promise<void>;
export { rmSync };
