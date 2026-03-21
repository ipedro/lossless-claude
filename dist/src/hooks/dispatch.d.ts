export declare const HOOK_COMMANDS: readonly ["compact", "restore", "session-end", "user-prompt"];
export type HookCommand = typeof HOOK_COMMANDS[number];
export declare function isHookCommand(cmd: string): cmd is HookCommand;
export declare function dispatchHook(command: HookCommand, stdinText: string): Promise<{
    exitCode: number;
    stdout: string;
}>;
