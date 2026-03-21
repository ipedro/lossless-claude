# lossless-claude — shared memory manual fallback for plain Codex

Plain `codex` can access shared project memory through LCM MCP tools.

This is manual fallback mode, not full automatic memory. Hook-based clients (Claude Code) get full automatic memory management.

## Important constraints

- Plain `codex` does not automatically restore, ingest, or compact turns.
- Do not claim that shared memory is automatic in this mode.
- If the user wants automatic shared-memory behavior across turns, use a hook-based client such as Claude Code with LCM installed.

## How to use LCM in plain Codex

- Before saying prior context is unavailable, check LCM.
- Use LCM for cross-session memory: decisions, architecture, prior fixes, conventions, preferences, and important project history.
- Use the repository itself as the source of truth for current behavior. Use LCM mainly for history, rationale, and recovered context.

## Retrieval order

1. Use `lcm_search` for broad memory retrieval across episodic and promoted knowledge.
2. Use `lcm_grep` for exact terms, identifiers, filenames, errors, or regex/full-text lookups.
3. Use `lcm_describe` when you already have a summary or file id and want the stored content directly.
4. Use `lcm_expand` when a relevant summary needs deeper inspection and recovery of underlying detail.

## Store policy

Use `lcm_store` to persist durable, reusable information:
- decisions
- root causes
- fixes and workarounds
- architectural constraints
- team conventions
- important user preferences
- durable follow-ups

When useful, include tags and confidence so stored memory is easier to retrieve and judge later.

Do not store:
- transient scratch notes
- obvious facts already present in code
- every intermediate step
- noisy or duplicated observations

## Response behavior

- If you used LCM and it materially affected the answer, say so briefly.
- If LCM returns nothing useful, say that briefly and continue with normal repository analysis.
- Do not block on LCM if the answer can be derived directly from the code.

## Operational tools

- Use `lcm_stats` to inspect memory coverage or compaction state when relevant.
- Use `lcm_doctor` only when troubleshooting the memory system itself.
