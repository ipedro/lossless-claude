import { type SpawnSyncReturns } from "node:child_process";
import type { ServiceDeps } from "./install.js";
import type { TeardownDeps } from "./uninstall.js";
export declare class DryRunServiceDeps implements ServiceDeps, TeardownDeps {
    writeFileSync(path: string, _data: string): void;
    mkdirSync(path: string, _opts?: any): void;
    rmSync(path: string): void;
    spawnSync(cmd: string, args: string[], opts?: any): SpawnSyncReturns<string>;
    promptUser(question: string): Promise<string>;
    readFileSync(path: string, encoding: string): string;
    existsSync(path: string): boolean;
}
