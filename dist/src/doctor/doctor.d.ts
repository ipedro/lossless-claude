import type { CheckResult, DoctorDeps } from "./types.js";
export declare function runDoctor(overrides?: Partial<DoctorDeps>): Promise<CheckResult[]>;
export declare function printResults(results: CheckResult[]): void;
