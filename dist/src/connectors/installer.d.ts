import type { ConnectorType } from "./types.js";
export interface InstallResult {
    success: boolean;
    path: string;
    requiresRestart: boolean;
    manual?: string;
}
export interface InstalledConnector {
    agentId: string;
    agentName: string;
    type: ConnectorType;
    path: string;
}
export declare function installConnector(agentIdOrName: string, type?: ConnectorType, cwd?: string): InstallResult;
export declare function removeConnector(agentIdOrName: string, type?: ConnectorType, cwd?: string): boolean;
export declare function listConnectors(cwd?: string): InstalledConnector[];
