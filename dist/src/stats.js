import { DatabaseSync } from "node:sqlite";
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { runLcmMigrations } from "./db/migration.js";
function queryProjectStats(dbPath) {
    const db = new DatabaseSync(dbPath);
    runLcmMigrations(db);
    try {
        const msgStats = db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(token_count), 0) as tokens FROM messages`).get();
        const sumStats = db.prepare(`SELECT COUNT(*) as count, COALESCE(SUM(token_count), 0) as tokens, COALESCE(MAX(depth), 0) as maxDepth FROM summaries`).get();
        const promoted = db.prepare(`SELECT COUNT(*) as count FROM promoted`).get();
        const convRows = db.prepare(`
      SELECT
        c.conversation_id,
        COALESCE(m.msg_count, 0) as messages,
        COALESCE(s.sum_count, 0) as summaries,
        COALESCE(s.max_depth, 0) as max_depth,
        COALESCE(m.raw_tokens, 0) as raw_tokens,
        COALESCE(s.sum_tokens, 0) as summary_tokens
      FROM conversations c
      LEFT JOIN (
        SELECT conversation_id, COUNT(*) as msg_count, SUM(token_count) as raw_tokens
        FROM messages GROUP BY conversation_id
      ) m ON m.conversation_id = c.conversation_id
      LEFT JOIN (
        SELECT conversation_id, COUNT(*) as sum_count, SUM(token_count) as sum_tokens, MAX(depth) as max_depth
        FROM summaries GROUP BY conversation_id
      ) s ON s.conversation_id = c.conversation_id
      ORDER BY c.conversation_id DESC
    `).all();
        const conversationDetails = convRows.map((r) => ({
            conversationId: r.conversation_id,
            messages: r.messages,
            summaries: r.summaries,
            maxDepth: r.max_depth,
            rawTokens: r.raw_tokens,
            summaryTokens: r.summary_tokens,
            ratio: r.summary_tokens > 0 && r.raw_tokens > 0 ? r.raw_tokens / r.summary_tokens : 0,
            promotedCount: 0,
        }));
        return {
            conversations: convRows.length,
            messages: msgStats.count,
            summaries: sumStats.count,
            maxDepth: sumStats.maxDepth,
            rawTokens: msgStats.tokens,
            summaryTokens: sumStats.tokens,
            ratio: sumStats.tokens > 0 && msgStats.tokens > 0 ? msgStats.tokens / sumStats.tokens : 0,
            promotedCount: promoted.count,
            conversationDetails,
        };
    }
    finally {
        db.close();
    }
}
function formatNumber(n) {
    if (n >= 1_000_000)
        return (n / 1_000_000).toFixed(1) + "M";
    if (n >= 1_000)
        return (n / 1_000).toFixed(1) + "k";
    return String(n);
}
function pad(s, width, align = "right") {
    return align === "left" ? s.padEnd(width) : s.padStart(width);
}
export function printStats(stats, verbose) {
    const dim = "\x1b[2m";
    const cyan = "\x1b[36m";
    const green = "\x1b[32m";
    const yellow = "\x1b[33m";
    const bold = "\x1b[1m";
    const reset = "\x1b[0m";
    console.log();
    console.log(`  ${cyan}──${reset} ${bold}Overview${reset} ${cyan}──${reset}`);
    console.log();
    const rows = [
        ["Projects", String(stats.projects)],
        ["Conversations", String(stats.conversations)],
        ["Messages stored", formatNumber(stats.messages)],
        ["Summaries created", formatNumber(stats.summaries)],
        ["DAG max depth", String(stats.maxDepth)],
        ["Promoted memories", String(stats.promotedCount)],
    ];
    const labelWidth = Math.max(...rows.map(([l]) => l.length));
    for (const [label, value] of rows) {
        console.log(`  ${dim}${pad(label, labelWidth, "left")}${reset}  ${value}`);
    }
    console.log();
    console.log(`  ${cyan}──${reset} ${bold}Token Savings${reset} ${cyan}──${reset}`);
    console.log();
    const rawStr = formatNumber(stats.rawTokens);
    const sumStr = formatNumber(stats.summaryTokens);
    const savedTokens = stats.rawTokens - stats.summaryTokens;
    const savedPct = stats.rawTokens > 0 ? ((savedTokens / stats.rawTokens) * 100).toFixed(1) : "0.0";
    const ratioStr = stats.ratio > 0 ? stats.ratio.toFixed(1) + "x" : "–";
    const color = savedTokens > 0 ? green : yellow;
    const tokenRows = [
        ["Raw message tokens", rawStr],
        ["Summary tokens", sumStr],
        ["Tokens saved", `${color}${formatNumber(savedTokens)} (${savedPct}%)${reset}`],
        ["Compression ratio", ratioStr],
    ];
    const tLabelWidth = Math.max(...tokenRows.map(([l]) => l.length));
    for (const [label, value] of tokenRows) {
        console.log(`  ${dim}${pad(label, tLabelWidth, "left")}${reset}  ${value}`);
    }
    if (verbose && stats.conversationDetails.length > 0) {
        console.log();
        console.log(`  ${cyan}──${reset} ${bold}Per-Conversation${reset} ${cyan}──${reset}`);
        console.log();
        const hdr = ["#", "msgs", "sums", "depth", "raw", "summary", "saved", "ratio"];
        const colWidths = [4, 6, 6, 5, 8, 8, 8, 6];
        const header = hdr.map((h, i) => pad(h, colWidths[i])).join("  ");
        console.log(`  ${dim}${header}${reset}`);
        console.log(`  ${dim}${"─".repeat(header.length)}${reset}`);
        for (const c of stats.conversationDetails) {
            const saved = c.rawTokens - c.summaryTokens;
            const pct = c.rawTokens > 0 ? ((saved / c.rawTokens) * 100).toFixed(0) + "%" : "–";
            const r = c.ratio > 0 ? c.ratio.toFixed(1) + "x" : "–";
            const cells = [
                pad(String(c.conversationId), colWidths[0]),
                pad(formatNumber(c.messages), colWidths[1]),
                pad(formatNumber(c.summaries), colWidths[2]),
                pad(String(c.maxDepth), colWidths[3]),
                pad(formatNumber(c.rawTokens), colWidths[4]),
                pad(formatNumber(c.summaryTokens), colWidths[5]),
                pad(pct, colWidths[6]),
                pad(r, colWidths[7]),
            ];
            console.log(`  ${cells.join("  ")}`);
        }
    }
    console.log();
}
export function collectStats() {
    const baseDir = join(homedir(), ".lossless-claude", "projects");
    if (!existsSync(baseDir)) {
        return {
            projects: 0, conversations: 0, messages: 0, summaries: 0,
            maxDepth: 0, rawTokens: 0, summaryTokens: 0, ratio: 0,
            promotedCount: 0, conversationDetails: [],
        };
    }
    let totalProjects = 0;
    let totalConversations = 0;
    let totalMessages = 0;
    let totalSummaries = 0;
    let totalMaxDepth = 0;
    let totalRawTokens = 0;
    let totalSummaryTokens = 0;
    let totalPromoted = 0;
    let allDetails = [];
    for (const entry of readdirSync(baseDir, { withFileTypes: true })) {
        if (!entry.isDirectory())
            continue;
        const dbPath = join(baseDir, entry.name, "db.sqlite");
        if (!existsSync(dbPath))
            continue;
        try {
            const projStats = queryProjectStats(dbPath);
            totalProjects++;
            totalConversations += projStats.conversations;
            totalMessages += projStats.messages;
            totalSummaries += projStats.summaries;
            totalMaxDepth = Math.max(totalMaxDepth, projStats.maxDepth);
            totalRawTokens += projStats.rawTokens;
            totalSummaryTokens += projStats.summaryTokens;
            totalPromoted += projStats.promotedCount;
            allDetails = allDetails.concat(projStats.conversationDetails);
        }
        catch {
            // skip corrupt databases
        }
    }
    return {
        projects: totalProjects,
        conversations: totalConversations,
        messages: totalMessages,
        summaries: totalSummaries,
        maxDepth: totalMaxDepth,
        rawTokens: totalRawTokens,
        summaryTokens: totalSummaryTokens,
        ratio: totalSummaryTokens > 0 ? totalRawTokens / totalSummaryTokens : 0,
        promotedCount: totalPromoted,
        conversationDetails: allDetails,
    };
}
//# sourceMappingURL=stats.js.map