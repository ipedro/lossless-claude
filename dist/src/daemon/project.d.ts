export declare const BASE_DIR: string;
export declare const projectId: (cwd: string) => string;
export declare const projectDir: (cwd: string) => string;
export declare const projectDbPath: (cwd: string) => string;
export declare const projectMetaPath: (cwd: string) => string;
/** Ensures the project dir exists and writes cwd to meta.json. */
export declare const ensureProjectDir: (cwd: string) => string;
