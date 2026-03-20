import { readFileSync } from "node:fs";
function extractText(content) {
    if (typeof content === "string")
        return content;
    if (Array.isArray(content)) {
        return content
            .map((b) => {
            if (b.type === "text" && typeof b.text === "string")
                return b.text;
            if (b.type === "tool_result")
                return extractText(b.content);
            return "";
        })
            .filter(Boolean)
            .join("\n");
    }
    return "";
}
export function estimateTokens(text) {
    return Math.max(1, Math.ceil(text.length / 4));
}
export function parseTranscript(transcriptPath) {
    let raw;
    try {
        raw = readFileSync(transcriptPath, "utf-8");
    }
    catch {
        return [];
    }
    const messages = [];
    for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        try {
            const obj = JSON.parse(trimmed);
            const role = obj.message?.role;
            if (!role || !["user", "assistant", "system"].includes(role))
                continue;
            const content = extractText(obj.message?.content);
            if (!content.trim())
                continue;
            messages.push({ role, content, tokenCount: estimateTokens(content) });
        }
        catch {
            // skip malformed lines
        }
    }
    return messages;
}
//# sourceMappingURL=transcript.js.map