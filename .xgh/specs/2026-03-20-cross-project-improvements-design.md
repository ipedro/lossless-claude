# Cross-Project Improvements — Design Spec

> Date: 2026-03-20
> Status: Approved (design phase)
> Source analysis: OpenViking (volcengine) + context-mode (mksglu)
> Research docs: `~/.xgh/pack/docs/research/openviking-deep-dive.md`, `~/.xgh/pack/docs/research/context-mode-deep-dive.md`

## Summary

Port four improvements to lossless-claude inspired by patterns independently validated by OpenViking and context-mode. All changes use the existing `claude-process` provider (no new dependencies) and add one new hook (UserPromptSubmit, bringing total to 4).

## Constraints

- **LLM provider**: `claude-process` only (spawns `claude --print --model haiku`). No new providers or dependencies.
- **Hook budget**: Add UserPromptSubmit only. No PostToolUse (redundant — transcript JSONL is the durable source; periodic ingestion + SessionEnd already cover crash scenarios).
- **Phasing**: Bottom-up — each phase improves the foundation for the next.

---

## Phase 1: YAML Prompt Templates

### Problem

`src/summarize.ts` has 5 hardcoded prompt builders (`buildLeafSummaryPrompt`, `buildD1Prompt`, `buildD2Prompt`, `buildD3PlusPrompt`) plus the system prompt, all inline as TypeScript string concatenation (~200 lines of prompt logic). Prompts can't be tuned without code changes.

### Design

Extract into YAML template files under `src/prompts/`:

```
src/prompts/
  system.yaml
  leaf-normal.yaml
  leaf-aggressive.yaml
  condensed-d1.yaml
  condensed-d2.yaml
  condensed-d3plus.yaml
  loader.ts
```

Each YAML file follows this structure:

```yaml
name: leaf-normal
description: Summarize a conversation segment preserving key details
variables:
  - targetTokens
  - text
  - previousContext
  - customInstructions
template: |
  You summarize a SEGMENT of a Claude Code conversation...
  {{policy}}
  {{instructionBlock}}
  ...
  <previous_context>
  {{previousContext}}
  </previous_context>
  <conversation_segment>
  {{text}}
  </conversation_segment>
```

### Key decisions

- Templates ship bundled (loaded from package at build time, not from user's filesystem) — no risk of missing files at runtime. Since the project uses plain `tsc`, a `postbuild` copy step copies `src/prompts/*.yaml` to `dist/src/prompts/`. The loader resolves paths relative to `__dirname`.
- `loader.ts` is a thin `readFileSync` + Mustache-style `{{var}}` interpolation — no template engine dependency. Relies on existing `PromotedStore.search()` sanitization for FTS5 queries (no redundant sanitization needed in hook handlers).
- `summarize.ts` shrinks to: resolve template name → load → interpolate → return prompt string.
- Existing prompt logic is preserved verbatim in YAML — this is a refactor, not a rewrite.

### Files changed

| File | Change |
|------|--------|
| `src/prompts/*.yaml` | New — 6 template files |
| `src/prompts/loader.ts` | New — YAML loader with variable interpolation |
| `src/summarize.ts` | Refactor — delegate to loader, remove inline prompt strings |

---

## Phase 2: Promoted Memory Dedup/Merge

### Problem

`shouldPromote()` fires on any signal and inserts into the `promoted` FTS5 table. No dedup — repeated compaction rounds about the same topic accumulate duplicate promoted entries, degrading restore quality over time.

### Design

Add a dedup/merge step between detection and insertion:

```
shouldPromote() → YES
  ↓
searchExisting(content, projectId) → FTS5 query for similar promoted entries
  ↓
  ├─ No matches (BM25 below threshold) → INSERT as new
  ├─ 1 match above threshold → MERGE: replace old with combined content
  └─ Multiple matches → MERGE all into single entry, delete others
```

### Merge strategy

- Uses FTS5 BM25 scoring (already available via `PromotedStore.search()`) to find candidates.
- Merge runs through `claude-process` with a short merge prompt: "Combine these memory entries into one, removing duplicates, keeping the most recent state of any decision that evolved."
- Merge prompt added as `src/prompts/promoted-merge.yaml`.
- Merge is async and non-blocking — happens after compaction completes, doesn't slow down the PreCompact hook response.

### Confidence decay

- Existing entries lose 0.1 confidence per merge cycle.
- If confidence drops below 0.2, the entry is archived (soft-deleted via `archived_at` column) rather than surfaced in restore.

### BM25 scoring note

FTS5 BM25 `rank` values are **negative** (closer to 0 = better match). All threshold comparisons use `rank <= -threshold` (i.e., `rank <= -15` means "match at least as strong as 15"). The `PromotedStore.search()` method already orders by `rank ASC` (most negative = best match).

### Config additions (`DaemonConfig.compaction.promotionThresholds`)

```typescript
dedupBm25Threshold: 15       // entries with rank <= -15 are considered duplicates
mergeMaxEntries: 3           // max entries to merge in a single pass (FTS5 LIMIT)
confidenceDecayRate: 0.1     // per-merge confidence reduction
```

### Merge concurrency

Merge operations are queued sequentially (single promise chain) to prevent multiple concurrent `claude-process` spawns during a compaction cycle. The queue drains after compaction completes; if the daemon shuts down mid-queue, remaining merges are skipped (they'll be caught on next compaction).

### Confidence inheritance on merge

When N entries merge into one:
1. The merged entry inherits `max(confidence of all inputs) - confidenceDecayRate`.
2. Floor: confidence never drops below 0. Entries with confidence < 0.2 are archived.
3. The merged entry's `created_at` is set to the most recent input's `created_at`.

### FTS5 cleanup on archive

`archive()` must delete the corresponding row from `promoted_fts` (by rowid) in the same transaction as setting `archived_at`. The `search()` method also adds `WHERE p.archived_at IS NULL` as a safety filter.

### Files changed

| File | Change |
|------|--------|
| `src/promotion/dedup.ts` | New — `deduplicateAndInsert()` function |
| `src/prompts/promoted-merge.yaml` | New — merge prompt template |
| `src/promotion/detector.ts` | Modify — call dedup before insert |
| `src/db/promoted.ts` | Modify — add `archive()` method, `WHERE archived_at IS NULL` filter to `search()` |
| `src/daemon/config.ts` | Modify — add dedup thresholds to config schema |
| `src/db/migration.ts` | Modify — add `archived_at` column to `promoted` table |

---

## Phase 3: UserPromptSubmit Hook

### Problem

lossless-claude's MCP tools (`lcm_search`, `lcm_expand`, `lcm_grep`) exist but Claude doesn't know when to use them. The user must explicitly ask. Both OpenViking and context-mode independently use UserPromptSubmit to surface memory passively.

### Design

Register a UserPromptSubmit hook that searches promoted memories against the user's prompt and injects relevant context when found.

```
User types a message
  ↓
UserPromptSubmit fires → lossless-claude user-prompt
  ↓
Extract user's prompt text → POST /prompt-search to daemon
  ↓
FTS5 search against promoted store (top 3, BM25 > threshold)
  ↓
  ├─ No matches → exitCode 0, stdout "" (silent)
  └─ Matches → exitCode 0, stdout: hint as additionalContext
```

### Hint format

```xml
<memory-context>
Relevant context from previous sessions (use lcm_expand for details):
- [snippet 1, truncated to 200 chars]
- [snippet 2, truncated to 200 chars]
</memory-context>
```

### Hook payload schema

The UserPromptSubmit hook receives JSON on stdin with the following fields (from Claude Code plugin hook contract):

```typescript
{
  session_id: string;      // active session ID
  cwd: string;             // project working directory
  prompt: string;          // the user's prompt text
  source?: string;         // hook trigger source
}
```

The `prompt` field is extracted and used as the FTS5 search query. If `prompt` is missing or empty, the hook returns silently.

### Key decisions

- **No LLM call** — pure FTS5 search. Fast (<50ms round trip to daemon).
- **Threshold gating** — only inject when BM25 `rank <= -threshold` exceeds `promptSearchMinScore` (config, default 10). Uses same negative-rank convention as Phase 2. Most prompts won't trigger.
- **Snippet truncation** — 200 chars per result. Hint is a pointer, not a dump.
- **Graceful degradation** — daemon down, missing `prompt` field, or no matches = silent pass-through (exitCode 0, empty stdout).
- **XML in additionalContext** — Claude Code passes stdout verbatim as `additionalContext`. XML tags are not stripped or escaped (consistent with existing restore hook behavior).

### Config additions (`DaemonConfig.restoration`)

```typescript
promptSearchMinScore: 10     // minimum rank <= -threshold to inject hint
promptSearchMaxResults: 3    // max promoted entries to include in hint
promptSnippetLength: 200     // chars per snippet in hint
```

### Files changed

| File | Change |
|------|--------|
| `src/hooks/user-prompt.ts` | New — hook handler |
| `src/daemon/routes/prompt-search.ts` | New — thin wrapper around PromotedStore.search() |
| `src/daemon/server.ts` | Modify — register POST /prompt-search route |
| `src/daemon/config.ts` | Modify — add prompt search config |
| `bin/lossless-claude.ts` | Modify — add `case "user-prompt":` command |
| `.claude-plugin/plugin.json` | Modify — register UserPromptSubmit hook |

---

## Phase 4: CLAUDE.md Persistence Through Compaction

### Problem

When compaction fires, Claude Code discards the conversation and injects the PreCompact summary. CLAUDE.md project instructions may not be re-injected on the `compact` sub-event of SessionStart. Context-mode solves this by capturing and replaying CLAUDE.md content.

### Design

Capture CLAUDE.md content at SessionStart (startup) and include it in restore context on compaction.

```
SessionStart (source="startup")
  ↓
Read CLAUDE.md files:
  - ~/.claude/CLAUDE.md
  - <cwd>/CLAUDE.md
  - <cwd>/.claude/CLAUDE.md
  ↓
Upsert into session_instructions table (hash-based, skip if unchanged)
  ↓

SessionStart (source="compact")
  ↓
Query session_instructions → inject as <project-instructions> block
```

### Storage

The `session_instructions` table lives in the **per-project SQLite database** (same as conversations, summaries, promoted). Since each DB is already scoped to a project via `projectDbPath(cwd)`, the table uses a simple single-row design:

```sql
CREATE TABLE IF NOT EXISTS session_instructions (
  id INTEGER PRIMARY KEY CHECK (id = 1),  -- single row per DB
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

### Restore handler restructuring

The current `isPostCompact` early return in `restore.ts` (line 24-26) must be modified. Currently it returns orientation-only and skips all DB queries. The new flow:

```
isPostCompact?
  ├─ YES → return orientation + session_instructions (skip episodic + promoted)
  └─ NO  → return orientation + episodic + promoted + session_instructions
```

The `session_instructions` block is injected in **both** paths (compact and resume), but episodic/promoted are still skipped on post-compact (unchanged behavior).

### Key decisions

- **Hash-based upsert** — SHA-256 of concatenated files. Only writes when content changes.
- **Read from disk** — SessionStart hook payload includes `cwd`; no dependency on Claude Code passing file contents.
- **Single combined entry** — all CLAUDE.md files concatenated with path headers. One row per project DB.
- **Injected on compact AND resume** — Claude Code re-reads CLAUDE.md on fresh startup, but on compact and resume sub-events it may not. We inject in both cases for safety.
- **`@import` directives** — captured as literal text (e.g., `@RTK.md`), not resolved. Claude Code handles resolution natively on fresh starts; on compaction recovery, the literal reference is a known limitation. If a user's CLAUDE.md is primarily `@import` directives (common pattern), the restored block will contain only references, not resolved content. This is documented as a known limitation — resolving imports would require reimplementing Claude Code's `@`-resolution logic, which is out of scope.

### Restored context format

```xml
<project-instructions>
# ~/.claude/CLAUDE.md
[contents]

# <cwd>/CLAUDE.md
[contents]
</project-instructions>
```

### Files changed

| File | Change |
|------|--------|
| `src/db/migration.ts` | Modify — add session_instructions table |
| `src/daemon/routes/restore.ts` | Modify — read CLAUDE.md on startup, inject on compact |

---

## Phase dependency graph

```
Phase 1 (YAML templates)
  ↓
Phase 2 (Dedup/merge) — uses new merge template from Phase 1
  ↓
Phase 3 (UserPromptSubmit) — surfaces clean promoted memories from Phase 2
  ↓
Phase 4 (CLAUDE.md persistence) — completes the restore context assembly
```

## Out of scope

- PostToolUse hook (redundant with transcript-based ingestion)
- Embedding-based search (keeping FTS5/BM25 only)
- New LLM providers or dependencies
- OpenViking's AGFS filesystem abstraction (SQLite DAG is sufficient)
- L0/L1/L2 lazy loading controls (implicit via DAG depth, not worth explicit configuration)
