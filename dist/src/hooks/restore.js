export async function handleSessionStart(stdin, client) {
    const health = await client.health();
    if (!health)
        return { exitCode: 0, stdout: "" };
    try {
        const input = JSON.parse(stdin || "{}");
        const result = await client.post("/restore", input);
        return { exitCode: 0, stdout: result.context || "" };
    }
    catch {
        return { exitCode: 0, stdout: "" };
    }
}
//# sourceMappingURL=restore.js.map