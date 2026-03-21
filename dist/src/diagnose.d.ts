export interface DiagnosticError {
    type: "hook-error" | "mcp-disconnect" | "old-binary" | "duplicate-hook";
    hookEvent?: string;
    command?: string;
    timestamp?: string;
    details?: string;
    count: number;
}
export interface SessionDiagnostic {
    sessionId: string;
    sessionName?: string;
    filePath: string;
    errors: DiagnosticError[];
    lastTimestamp?: string;
}
export interface DiagnoseResult {
    sessionsScanned: number;
    sessionsWithErrors: number;
    totalErrors: number;
    totalWarnings: number;
    sessions: SessionDiagnostic[];
    mostCommon?: {
        type: string;
        count: number;
    };
}
export interface DiagnoseOptions {
    all?: boolean;
    days?: number;
    verbose?: boolean;
    cwd?: string;
    /** Override ~/.claude/projects path — used in tests only */
    _claudeProjectsDir?: string;
    /** Override Date.now() — used in tests only */
    _nowMs?: number;
}
export declare function scanSession(filePath: string): Promise<SessionDiagnostic>;
export declare function diagnose(options?: DiagnoseOptions): Promise<DiagnoseResult>;
export declare function formatDiagnoseResult(result: DiagnoseResult, options?: Pick<DiagnoseOptions, "days" | "verbose">): string;
