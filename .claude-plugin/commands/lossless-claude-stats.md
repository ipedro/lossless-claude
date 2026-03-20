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
