export interface ProxyManager {
    start(): Promise<void>;
    stop(): Promise<void>;
    isHealthy(): Promise<boolean>;
    readonly port: number;
    readonly available: boolean;
}
export type ProxyManagerOptions = {
    port: number;
    startupTimeoutMs: number;
    model: string;
    pidFilePath?: string;
    healthPollIntervalMs?: number;
    healthMonitorIntervalMs?: number;
    maxHealthMisses?: number;
    /** Override fetch for testing */
    _fetchOverride?: typeof globalThis.fetch;
    /** Override process.kill(pid, 0) check for testing */
    _killCheck?: (pid: number) => boolean;
};
export declare function createClaudeCliProxyManager(opts: ProxyManagerOptions): ProxyManager;
