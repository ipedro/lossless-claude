import type { DatabaseSync } from "node:sqlite";
export type LcmDbFeatures = {
    fts5Available: boolean;
};
/**
 * Detect SQLite features exposed by the current Node runtime.
 *
 * The result is cached per DatabaseSync handle because the probe is runtime-
 * specific, not database-file-specific.
 */
export declare function getLcmDbFeatures(db: DatabaseSync): LcmDbFeatures;
