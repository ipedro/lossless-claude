import { spawn as defaultSpawn } from "node:child_process";
import { mkdtempSync as defaultMkdtempSync, readFileSync as defaultReadFileSync, rmSync as defaultRmSync } from "node:fs";
import { tmpdir } from "node:os";
import type { LcmSummarizeFn } from "./types.js";
type CodexProcessDeps = {
    model?: string;
    spawn?: typeof defaultSpawn;
    mkdtempSync?: typeof defaultMkdtempSync;
    readFileSync?: typeof defaultReadFileSync;
    rmSync?: typeof defaultRmSync;
    tmpdir?: typeof tmpdir;
    timeoutMs?: number;
};
export declare function createCodexProcessSummarizer(opts?: CodexProcessDeps): LcmSummarizeFn;
export {};
