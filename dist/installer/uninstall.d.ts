import { type SpawnSyncReturns } from "node:child_process";
export declare function removeClaudeSettings(existing: any): any;
export interface TeardownDeps {
    spawnSync: (cmd: string, args: string[], opts?: any) => SpawnSyncReturns<string>;
    existsSync: (path: string) => boolean;
    rmSync: (path: string) => void;
    readFileSync: (path: string, encoding: string) => string;
    writeFileSync: (path: string, data: string) => void;
}
export declare function teardownDaemonService(deps?: TeardownDeps): void;
export declare function uninstall(deps?: TeardownDeps): Promise<void>;
