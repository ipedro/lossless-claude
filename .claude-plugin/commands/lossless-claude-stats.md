---
name: lossless-claude-stats
description: Show lossless-claude token savings, compression ratios, and DAG statistics for all projects.
---

# /lossless-claude-stats

Show token savings statistics from the lossless-claude context management system.

## Instructions

When invoked, call the `lcm_stats` MCP tool with `{"verbose": true}`.

Then format and display the result as a compact stats panel. Use this exact layout:

```
## lossless-claude stats

**Context compression** — all projects

| Metric          | Value        |
|-----------------|--------------|
| Projects        | {projects}   |
| Conversations   | {conversations} |
| Messages stored | {messages}   |
| Summaries       | {summaries}  |
| DAG max depth   | {maxDepth}   |
| Promoted memories | {promotedCount} |

**Token savings**

| Raw tokens | Summary tokens | Tokens saved | Compression |
|------------|---------------|--------------|-------------|
| {rawTokens} | {summaryTokens} | {saved} ({pct}%) | {ratio} |
```

If the tool returns per-conversation data, append a **Per project** section as a markdown table.

If `lcm_stats` is unavailable, run `lossless-claude stats -v` via Bash and display the output verbatim.

Do not add commentary — just the formatted stats panel.
