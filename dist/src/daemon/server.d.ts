import { type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { DaemonConfig } from "./config.js";
import type { ProxyManager } from "./proxy-manager.js";
export type RouteHandler = (req: IncomingMessage, res: ServerResponse, body: string) => Promise<void>;
export type DaemonInstance = {
    address: () => AddressInfo;
    stop: () => Promise<void>;
    registerRoute: (method: string, path: string, handler: RouteHandler) => void;
};
export type DaemonOptions = {
    proxyManager?: ProxyManager;
};
export declare function readBody(req: IncomingMessage): Promise<string>;
export declare function sendJson(res: ServerResponse, status: number, data: unknown): void;
export declare function createDaemon(config: DaemonConfig, options?: DaemonOptions): Promise<DaemonInstance>;
