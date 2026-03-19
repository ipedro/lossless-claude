export async function handlePreCompact(stdin, client) {
    const health = await client.health();
    if (!health)
        return { exitCode: 0, stdout: "" };
    try {
        const input = JSON.parse(stdin || "{}");
        const result = await client.post("/compact", input);
        return { exitCode: 2, stdout: result.summary || "" };
    }
    catch {
        return { exitCode: 0, stdout: "" };
    }
}
//# sourceMappingURL=compact.js.map