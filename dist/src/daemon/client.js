export class DaemonClient {
    baseUrl;
    constructor(baseUrl) {
        this.baseUrl = baseUrl;
    }
    async health() {
        try {
            const res = await fetch(`${this.baseUrl}/health`);
            return res.ok ? await res.json() : null;
        }
        catch {
            return null;
        }
    }
    async post(path, body) {
        const res = await fetch(`${this.baseUrl}${path}`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
        });
        if (!res.ok) {
            const err = await res.json().catch(() => ({ error: res.statusText }));
            throw new Error(err.error ?? `HTTP ${res.status}`);
        }
        return await res.json();
    }
}
//# sourceMappingURL=client.js.map