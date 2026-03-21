import type { DaemonClient } from "./daemon/client.js";
interface ImportOptions {
    all?: boolean;
    verbose?: boolean;
    dryRun?: boolean;
    cwd?: string;
    /** Override ~/.claude/projects path — used in tests only */
    _claudeProjectsDir?: string;
    /** Override ~/.lossless-claude path — used in tests only */
    _lcmDir?: string;
}
interface ImportResult {
    imported: number;
    skippedEmpty: number;
    failed: number;
    totalMessages: number;
}
export declare function cwdToProjectHash(cwd: string): string;
export declare function findSessionFiles(projectDir: string): {
    path: string;
    sessionId: string;
}[];
export declare function importSessions(client: DaemonClient, options?: ImportOptions): Promise<ImportResult>;
export {};
