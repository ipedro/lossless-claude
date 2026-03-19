export type EnsureDaemonOptions = {
    port: number;
    pidFilePath: string;
    spawnTimeoutMs: number;
    expectedVersion?: string;
    _skipSpawn?: boolean;
    _fetchOverride?: typeof globalThis.fetch;
};
export type EnsureDaemonResult = {
    connected: boolean;
    port: number;
    spawned: boolean;
};
export declare function ensureDaemon(opts: EnsureDaemonOptions): Promise<EnsureDaemonResult>;
