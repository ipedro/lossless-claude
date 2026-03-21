export interface AutoHealDeps {
    readFileSync: (path: string, encoding: string) => string;
    writeFileSync: (path: string, data: string) => void;
    existsSync: (path: string) => boolean;
    mkdirSync: (path: string, opts?: {
        recursive: boolean;
    }) => void;
    appendFileSync: (path: string, data: string) => void;
    settingsPath: string;
    logPath: string;
}
export declare function validateAndFixHooks(deps?: AutoHealDeps): void;
