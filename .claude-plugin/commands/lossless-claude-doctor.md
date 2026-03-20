---
name: lossless-claude-doctor
description: Run lossless-claude diagnostics — checks daemon, hooks, MCP server, and summarizer health.
---

# /lossless-claude-doctor

Run diagnostics on the lossless-claude installation.

## Instructions

When invoked, call the `lcm_doctor` MCP tool (no arguments).

Parse the plain-text output and reformat it as a markdown status table:

| Check | Status | Details |
|-------|--------|---------|
| {check name} | ✅ / ⚠️ / ❌ | {message} |

Rules for status icons:
- ✅ = passed / ok / found / running
- ⚠️ = warning / skipped / not configured
- ❌ = failed / not found / error

After the table, if any check is ❌, add a **Fix** section listing specific remediation steps for each failure.

End with one of:
- *All checks passed — lossless-claude is healthy.*
- *{N} check(s) need attention — see Fix section above.*

If `lcm_doctor` is unavailable, run `lossless-claude doctor` via Bash and display the output verbatim.
