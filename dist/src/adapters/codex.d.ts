import { type ChildProcessWithoutNullStreams, type SpawnOptionsWithoutStdio } from "node:child_process";
import { type EnsureDaemonOptions, type EnsureDaemonResult } from "../daemon/lifecycle.js";
import { type ParsedMessage } from "../transcript.js";
export type LosslessCodexSession = {
    lcmSessionId: string;
    codexSessionId?: string;
    cwd: string;
    restoreLoaded: boolean;
};
export type RunLosslessCodexDeps = {
    ensureDaemon: (opts: EnsureDaemonOptions) => Promise<EnsureDaemonResult>;
    client: {
        post: <T = unknown>(path: string, body: unknown) => Promise<T>;
    };
    spawn: (command: string, args: string[], options: SpawnOptionsWithoutStdio) => ChildProcessWithoutNullStreams;
    onSpawnedProcess?: (child: ChildProcessWithoutNullStreams) => void;
    resolveBinaryPath: () => string;
    resolveNativeCodexSessionId: (jsonl: string) => Promise<string | undefined> | string | undefined;
};
export type LosslessCodexTurnResult = {
    exitCode: number;
    stdout: string;
    stderr: string;
    assistantText: string;
};
export declare function createLosslessCodexSessionId(): string;
export declare function composeCodexTurnPrompt(input: {
    restoreContext?: string;
    promptHints?: string[];
    userPrompt: string;
}): string;
export declare function normalizeCodexExecJsonl(jsonl: string): ParsedMessage[];
export declare function createRunLosslessCodexDeps(port?: number): RunLosslessCodexDeps;
export declare function runLosslessCodexTurn(session: LosslessCodexSession, userPrompt: string, deps?: RunLosslessCodexDeps): Promise<LosslessCodexTurnResult>;
