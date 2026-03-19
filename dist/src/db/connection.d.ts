import { DatabaseSync } from "node:sqlite";
export declare function getLcmConnection(dbPath: string): DatabaseSync;
export declare function closeLcmConnection(dbPath?: string): void;
