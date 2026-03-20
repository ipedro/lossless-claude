# Stats & Doctor Output Redesign — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reframe stats from "token savings" to "memory + compression" and unify output styling across stats and doctor for both CLI and MCP paths.

**Architecture:** Update data model (`OverallStats`) to track compacted conversation count. Rewrite `printStats()` and MCP `lcm_stats` handler for new framing. Rewrite `printResults()`/`formatResultsPlain()` for doctor. Update slash commands, README, and website.

**Tech Stack:** TypeScript, Node.js, ANSI escape codes (CLI), Markdown tables (MCP)

**Spec:** `.xgh/specs/2026-03-20-stats-doctor-redesign.md`

---

### Task 1: Update data model — add `compactedConversations`

**Files:**
- Modify: `src/stats.ts:7-29` (interfaces)
- Modify: `src/stats.ts:31-98` (`queryProjectStats`)
- Modify: `src/stats.ts:193-249` (`collectStats`)

- [ ] **Step 1: Add `compactedConversations` to interfaces**

In `src/stats.ts`, add field to `OverallStats`:

```typescript
interface OverallStats {
  projects: number;
  conversations: number;
  compactedConversations: number;  // NEW
  messages: number;
  summaries: number;
  maxDepth: number;
  rawTokens: number;
  summaryTokens: number;
  ratio: number;
  promotedCount: number;
  conversationDetails: ConversationStats[];
}
```

- [ ] **Step 2: Return `compactedConversations` from `queryProjectStats`**

After the existing `compacted` filter (line 80), add the count to the return object:

```typescript
return {
  compactedConversations: compacted.length,  // NEW
  conversations: convRows.length,
  // ... rest unchanged
};
```

Update the function return type from `Omit<OverallStats, "projects">` to `Omit<OverallStats, "projects">` (no change needed — `compactedConversations` is now part of `OverallStats`).

- [ ] **Step 3: Aggregate `compactedConversations` in `collectStats`**

Add `let totalCompacted = 0;` alongside the other accumulators. Inside the loop add:

```typescript
totalCompacted += projStats.compactedConversations;
```

Add to the return object:

```typescript
compactedConversations: totalCompacted,
```

Update the zero-state return (line 197-201) to include `compactedConversations: 0`.

- [ ] **Step 4: Build and verify no type errors**

Run: `npm run build`
Expected: Clean compilation

- [ ] **Step 5: Commit**

```bash
git add src/stats.ts
git commit -m "refactor: add compactedConversations to stats data model"
```

---

### Task 2: Rewrite CLI stats output (`printStats`)

**Files:**
- Modify: `src/stats.ts:110-191` (`printStats`)

- [ ] **Step 1: Rewrite `printStats` with new framing**

Replace the entire `printStats` function:

```typescript
export function printStats(stats: OverallStats, verbose: boolean): void {
  const dim = "\x1b[2m";
  const cyan = "\x1b[36m";
  const green = "\x1b[32m";
  const bold = "\x1b[1m";
  const reset = "\x1b[0m";
  const BAR_WIDTH = 30;
  const DIVIDER_WIDTH = 42;

  const divider = (name: string) => {
    const pad = DIVIDER_WIDTH - name.length - 5; // 5 = "── " + " ─"
    return `  ${cyan}──${reset} ${bold}${name}${reset} ${cyan}${"─".repeat(Math.max(1, pad))}${reset}`;
  };

  console.log();
  console.log(`  🧠 lossless-claude`);

  // ── Memory ──
  console.log();
  console.log(divider("Memory"));
  console.log();

  const memRows = [
    ["Projects", String(stats.projects)],
    ["Conversations", String(stats.conversations)],
    ["Messages", formatNumber(stats.messages)],
    ["Summaries", formatNumber(stats.summaries)],
    ["DAG depth", String(stats.maxDepth)],
    ["Promoted memories", String(stats.promotedCount)],
  ];

  const memLabelWidth = Math.max(...memRows.map(([l]) => l.length));
  for (const [label, value] of memRows) {
    console.log(`    ${dim}${pad(label, memLabelWidth, "left")}${reset}  ${value}`);
  }

  // ── Compression ── (only if summaries exist)
  if (stats.summaries > 0) {
    console.log();
    console.log(divider("Compression"));
    console.log();

    const ratioStr = stats.ratio > 0 ? stats.ratio.toFixed(1) + "x" : "–";
    const pct = stats.rawTokens > 0
      ? (((stats.rawTokens - stats.summaryTokens) / stats.rawTokens) * 100).toFixed(1)
      : "0.0";
    const color = stats.ratio > 10 ? green : reset;

    const compRows = [
      ["Compacted", `${stats.compactedConversations} of ${stats.conversations} conversations`],
      ["Tokens", `${formatNumber(stats.rawTokens)} → ${formatNumber(stats.summaryTokens)}`],
      ["Ratio", ratioStr],
    ];

    const compLabelWidth = Math.max(...compRows.map(([l]) => l.length));
    for (const [label, value] of compRows) {
      console.log(`    ${dim}${pad(label, compLabelWidth, "left")}${reset}  ${value}`);
    }

    // Compression bar
    const filled = Math.round((1 - stats.summaryTokens / stats.rawTokens) * BAR_WIDTH);
    const empty = BAR_WIDTH - filled;
    console.log(`    ${" ".repeat(compLabelWidth)}  ${color}${pct}%${reset}`);
    console.log(`    ${" ".repeat(compLabelWidth)}  ${color}${"█".repeat(filled)}${reset}${dim}${"░".repeat(empty)}${reset}`);
  }

  // ── Per Conversation ── (verbose, compacted only)
  if (verbose) {
    const compacted = stats.conversationDetails.filter((c) => c.summaries > 0);
    if (compacted.length > 0) {
      console.log();
      console.log(divider("Per Conversation"));
      console.log();

      const hdr = ["#", "msgs", "sums", "depth", "tokens", "ratio"];
      const colWidths = [4, 7, 6, 5, 18, 6];

      const header = hdr.map((h, i) => pad(h, colWidths[i])).join("  ");
      console.log(`    ${dim}${header}${reset}`);
      console.log(`    ${dim}${"─".repeat(header.length)}${reset}`);

      for (const c of compacted) {
        const tokStr = `${formatNumber(c.rawTokens)} → ${formatNumber(c.summaryTokens)}`;
        const r = c.ratio > 0 ? c.ratio.toFixed(1) + "x" : "–";
        const cells = [
          pad(String(c.conversationId), colWidths[0]),
          pad(formatNumber(c.messages), colWidths[1]),
          pad(formatNumber(c.summaries), colWidths[2]),
          pad(String(c.maxDepth), colWidths[3]),
          pad(tokStr, colWidths[4]),
          pad(r, colWidths[5]),
        ];
        console.log(`    ${cells.join("  ")}`);
      }
    }
  }

  console.log();
}
```

- [ ] **Step 2: Build and test visually**

Run: `npm run build && lossless-claude stats -v`
Expected: New output with Memory section, Compression section with bar, Per Conversation filtered to compacted only

- [ ] **Step 3: Commit**

```bash
git add src/stats.ts
git commit -m "feat: rewrite CLI stats with memory-first framing and compression bar"
```

---

### Task 3: Rewrite MCP stats handler (`lcm_stats`)

**Files:**
- Modify: `src/mcp/server.ts:28-62` (`lcm_stats` handler)

- [ ] **Step 1: Rewrite `lcm_stats` handler to output markdown tables**

Replace the `lcm_stats` handler in `src/mcp/server.ts`:

```typescript
lcm_stats: async (args) => {
  const { collectStats, formatNumber } = await import("../stats.js");
  const stats = collectStats();
  const verbose = args.verbose === true;
  const lines: string[] = [];

  // Memory section (always shown)
  lines.push("## 🧠 Memory");
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| Projects | ${stats.projects} |`);
  lines.push(`| Conversations | ${stats.conversations} |`);
  lines.push(`| Messages | ${formatNumber(stats.messages)} |`);
  lines.push(`| Summaries | ${formatNumber(stats.summaries)} |`);
  lines.push(`| DAG depth | ${stats.maxDepth} |`);
  lines.push(`| Promoted memories | ${stats.promotedCount} |`);

  // Compression section (only when summaries exist)
  if (stats.summaries > 0) {
    const pct = stats.rawTokens > 0
      ? (((stats.rawTokens - stats.summaryTokens) / stats.rawTokens) * 100).toFixed(1)
      : "0.0";
    const ratio = stats.ratio > 0 ? stats.ratio.toFixed(1) + "x" : "–";
    const BAR_WIDTH = 30;
    const filled = stats.rawTokens > 0
      ? Math.round((1 - stats.summaryTokens / stats.rawTokens) * BAR_WIDTH)
      : 0;
    const empty = BAR_WIDTH - filled;
    const bar = "█".repeat(filled) + "░".repeat(empty);

    lines.push("");
    lines.push("## Compression");
    lines.push("");
    lines.push("| Metric | Value |");
    lines.push("|---|---|");
    lines.push(`| Compacted | ${stats.compactedConversations} of ${stats.conversations} conversations |`);
    lines.push(`| Tokens | ${formatNumber(stats.rawTokens)} → ${formatNumber(stats.summaryTokens)} |`);
    lines.push(`| Ratio | ${ratio} |`);
    lines.push(`| | ${pct}% |`);
    lines.push(`| | \`${bar}\` |`);
  }

  // Per Conversation (verbose, compacted only)
  if (verbose) {
    const compacted = stats.conversationDetails.filter((c) => c.summaries > 0);
    if (compacted.length > 0) {
      lines.push("");
      lines.push("## Per Conversation");
      lines.push("");
      lines.push("| # | msgs | sums | depth | tokens | ratio |");
      lines.push("|---|------|------|-------|--------|-------|");
      for (const c of compacted) {
        const r = c.ratio > 0 ? c.ratio.toFixed(1) + "x" : "–";
        lines.push(`| ${c.conversationId} | ${formatNumber(c.messages)} | ${c.summaries} | ${c.maxDepth} | ${formatNumber(c.rawTokens)} → ${formatNumber(c.summaryTokens)} | ${r} |`);
      }
    }
  }

  return lines.join("\n");
},
```

- [ ] **Step 2: Export `formatNumber` from `src/stats.ts`**

Change `function formatNumber` to `export function formatNumber` in `src/stats.ts` (line 100).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Clean compilation

- [ ] **Step 4: Commit**

```bash
git add src/stats.ts src/mcp/server.ts
git commit -m "feat: rewrite MCP lcm_stats with markdown tables and memory-first framing"
```

---

### Task 4: Rewrite doctor output (CLI + MCP)

**Files:**
- Modify: `src/doctor/doctor.ts:237-260` (`printResults`)
- Modify: `src/doctor/doctor.ts:262-285` (`formatResultsPlain`)

- [ ] **Step 1: Rewrite `printResults` (CLI) with new styling**

```typescript
export function printResults(results: CheckResult[]): void {
  const dim = "\x1b[2m";
  const cyan = "\x1b[36m";
  const green = "\x1b[32m";
  const yellow = "\x1b[33m";
  const red = "\x1b[31m";
  const bold = "\x1b[1m";
  const nc = "\x1b[0m";
  const DIVIDER_WIDTH = 42;

  const divider = (name: string) => {
    const pad = DIVIDER_WIDTH - name.length - 5;
    return `  ${cyan}──${nc} ${bold}${name}${nc} ${cyan}${"─".repeat(Math.max(1, pad))}${nc}`;
  };

  console.log();
  console.log(`  🧠 lossless-claude`);

  let currentCategory = "";
  for (const r of results) {
    if (r.category !== currentCategory) {
      currentCategory = r.category;
      console.log();
      console.log(divider(currentCategory));
      console.log();
    }
    if (r.name === "stack") {
      console.log(`    ${dim}${r.message}${nc}`);
      continue;
    }
    const icon = r.status === "pass" ? `${green}✅` : r.status === "warn" ? `${yellow}⚠️ ` : `${red}❌`;
    const suffix = r.fixApplied ? ` ${dim}(auto-fixed)${nc}` : "";
    console.log(`    ${icon}${nc} ${dim}${r.name}${nc}  ${r.message}${suffix}`);
  }

  const pass = results.filter(r => r.status === "pass" && r.name !== "stack").length;
  const fail = results.filter(r => r.status === "fail").length;
  const warn = results.filter(r => r.status === "warn").length;

  console.log();
  console.log(`  ${pass} passed · ${fail} failed · ${warn} warnings`);
  console.log();
}
```

- [ ] **Step 2: Rewrite `formatResultsPlain` (MCP) with markdown tables**

```typescript
export function formatResultsPlain(results: CheckResult[]): string {
  const lines: string[] = [];
  let currentCategory = "";
  let tableStarted = false;

  for (const r of results) {
    if (r.category !== currentCategory) {
      currentCategory = r.category;
      if (tableStarted) lines.push(""); // gap between sections
      lines.push(`## ${currentCategory}`);
      lines.push("");
      lines.push("| Check | Status |");
      lines.push("|---|---|");
      tableStarted = true;
    }
    if (r.name === "stack") {
      // Stack info goes as a plain line before the table
      lines.splice(lines.length - 2, 0, `${r.message}`);
      continue;
    }
    const icon = r.status === "pass" ? "✅" : r.status === "warn" ? "⚠️" : "❌";
    const suffix = r.fixApplied ? " (auto-fixed)" : "";
    lines.push(`| ${r.name} | ${icon} ${r.message}${suffix} |`);
  }

  const pass = results.filter(r => r.status === "pass" && r.name !== "stack").length;
  const fail = results.filter(r => r.status === "fail").length;
  const warn = results.filter(r => r.status === "warn").length;

  lines.push("");
  lines.push(`${pass} passed · ${fail} failed · ${warn} warnings`);

  return lines.join("\n");
}
```

- [ ] **Step 3: Build and verify**

Run: `npm run build && lossless-claude doctor`
Expected: New styled output with emoji header, section dividers, aligned checks

- [ ] **Step 4: Commit**

```bash
git add src/doctor/doctor.ts
git commit -m "feat: rewrite doctor CLI and MCP output with unified styling"
```

---

### Task 5: Update slash command templates

**Files:**
- Modify: `.claude-plugin/commands/lossless-claude-stats.md`
- Modify: `.claude-plugin/commands/lossless-claude-doctor.md`

- [ ] **Step 1: Rewrite `lossless-claude-stats.md`**

```markdown
---
name: lossless-claude-stats
description: Show lossless-claude memory inventory, compression ratios, and DAG statistics.
---

# /lossless-claude-stats

Show memory and compression statistics from lossless-claude.

## Instructions

When invoked, call the `lcm_stats` MCP tool with `{"verbose": true}`.

The tool returns pre-formatted markdown with Memory and Compression tables. Display the output verbatim — it is already formatted correctly.

If `lcm_stats` is unavailable, run `lossless-claude stats -v` via Bash and display the output verbatim.

Do not add commentary — just the stats output.
```

- [ ] **Step 2: Rewrite `lossless-claude-doctor.md`**

```markdown
---
name: lossless-claude-doctor
description: Run lossless-claude diagnostics — checks daemon, hooks, MCP server, and summarizer health.
---

# /lossless-claude-doctor

Run diagnostics on the lossless-claude installation.

## Instructions

When invoked, call the `lcm_doctor` MCP tool (no arguments).

The tool returns pre-formatted markdown with status tables per section. Display the output verbatim — it is already formatted correctly.

If any check shows ❌, add a **Fix** section listing specific remediation steps for each failure.

End with one of:
- *All checks passed — lossless-claude is healthy.*
- *{N} check(s) need attention — see Fix section above.*

If `lcm_doctor` is unavailable, run `lossless-claude doctor` via Bash and display the output verbatim.
```

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/commands/
git commit -m "docs: update slash command templates for new stats/doctor output"
```

---

### Task 6: Update README language

**Files:**
- Modify: `README.md:128` (MCP tools table)
- Modify: `README.md:136` (CLI section)
- Modify: `README.md:169` (project structure)

- [ ] **Step 1: Update three references in README.md**

Line 128 — MCP tools table:
```
| `lcm_stats` | Memory inventory, compression ratios, and usage statistics |
```

Line 136 — CLI section:
```
lossless-claude stats            # Memory and compression overview
```

Line 169 — project structure:
```
  stats.ts                    # Memory and compression statistics
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: update README stats language from savings to memory+compression"
```

---

### Task 7: Update website language

**Files:**
- Modify: `gh-pages` branch `index.html` (lines 64-65, 191)

- [ ] **Step 1: Switch to gh-pages and update**

```bash
git stash
git checkout gh-pages
```

Line 64-65 — stats bar, replace:
```html
<span class="stat-value">60–90%</span>
<span class="stat-label">token reduction</span>
```
With:
```html
<span class="stat-value">35x</span>
<span class="stat-label">compression</span>
```

Line 191 — lcm_stats tool card, replace:
```html
<span class="tool-desc">Token savings and compression ratios</span>
```
With:
```html
<span class="tool-desc">Memory inventory and compression ratios</span>
```

- [ ] **Step 2: Commit and switch back**

```bash
git add index.html
git commit -m "docs: update website stats language from savings to compression"
git checkout main
git stash pop
```

---

### Task 8: Run tests and final verification

**Files:**
- Test: `test/` (full suite)

- [ ] **Step 1: Run full test suite**

Run: `npm run build && npm test`
Expected: 178 passing (2 pre-existing failures for assembler.js and transcript-repair.js)

- [ ] **Step 2: Visual verification — CLI stats**

Run: `lossless-claude stats -v`
Expected: Memory section with 6 rows, Compression section with bar, Per Conversation table (compacted only)

- [ ] **Step 3: Visual verification — CLI doctor**

Run: `lossless-claude doctor`
Expected: Emoji header, section dividers, aligned checks with status icons, result summary

- [ ] **Step 4: Kill MCP server to force reload**

```bash
pkill -f "lossless-claude mcp"
```

Then invoke `/lossless-claude-stats` and `/lossless-claude-doctor` slash commands to verify MCP markdown tables render correctly.

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -A
git commit -m "fix: stats/doctor output polish"
```
