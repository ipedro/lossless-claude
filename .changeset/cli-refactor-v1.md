---
"@ipedro/lossless-claude": major
---

Breaking: CLI binary renamed from `lossless-claude` to `lcm`. The `lossless-codex` wrapper has been removed.

Migration: Run `lcm install` to update hooks and MCP configuration. The installer automatically migrates old `lossless-claude` entries. Data directory (`~/.lossless-claude/`) is unchanged.
