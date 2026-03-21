import { spawn } from "node:child_process";
export type EnsureDaemonOptions = {
    port: number;
    pidFilePath: string;
    spawnTimeoutMs: number;
    expectedVersion?: string;
    spawnCommand?: string;
    spawnArgs?: string[];
    _skipSpawn?: boolean;
    _spawnOverride?: typeof spawn;
    _skipHealthWait?: boolean;
    _fetchOverride?: typeof globalThis.fetch;
};
export type EnsureDaemonResult = {
    connected: boolean;
    port: number;
    spawned: boolean;
};
export declare function ensureDaemon(opts: EnsureDaemonOptions): Promise<EnsureDaemonResult>;
