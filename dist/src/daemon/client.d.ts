export declare class DaemonClient {
    private baseUrl;
    constructor(baseUrl: string);
    health(): Promise<{
        status: string;
        uptime: number;
    } | null>;
    post<T = unknown>(path: string, body: unknown): Promise<T>;
}
