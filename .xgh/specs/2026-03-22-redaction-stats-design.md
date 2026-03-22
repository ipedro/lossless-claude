# Redaction Stats — Design Spec

**Date:** 2026-03-22
**Branch:** `worktree-feat-redaction-stats`
**Status:** Approved

## Motivation

The scrubbing pipeline (PR #56) protects users from storing secrets in lossless-claude's SQLite DBs, but gives no visibility into whether it is actively firing. A Security section in `lcm stats` makes scrubbing tangible and builds trust.

## Proposed Output

```
── Security ──────────────────────────────────
  🔒 redactions  142 total  (built-in: 139  global: 2  project: 1)
```

Only rendered when `total > 0`. Absence of the section means no redactions were found — not a bug.

---

## Design

### 1. `ScrubEngine` API (`src/scrub.ts`)

Change `scrub()` from returning `string` to returning a structured result. Preferred: pure function (no mutable state on the class).

```ts
export interface RedactionCounts {
  builtIn: number;
  global: number;
  project: number;
}

export interface ScrubResult {
  text: string;
  counts: RedactionCounts;
}

// Before: scrub(text: string): string
// After:
scrub(text: string): ScrubResult
```

Internally, the constructor already separates patterns into three groups (`builtInPatterns`, `globalPatterns`, `projectPatterns`). Count regex hits per group during the range-collection phase. Each match on a range from a built-in pattern increments `builtIn`, etc.

**Call site updates (4 sites):**

| File | Change |
|------|--------|
| `src/daemon/routes/ingest.ts` | Use `.text`; accumulate `.counts` across new messages; write to DB |
| `src/daemon/routes/compact.ts` | Use `.text`; accumulate `.counts` across new messages; write to DB |
| `src/compaction.ts:972` | Use `.text` only — this scrub is for LLM input, not storage; do not count |
| `src/sensitive.ts:230` | Use `.text` only — preview/test command; do not count |

### 2. DB Schema (`src/db/migration.ts`)

New table added via `runLcmMigrations`:

```sql
CREATE TABLE IF NOT EXISTS message_redactions (
  message_id INTEGER NOT NULL REFERENCES messages(message_id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  count    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (message_id, category)
);
```

**Design rationale (from Codex review):**
- Per-message primary key prevents double-counting on replay or reprocessing.
- `ON DELETE CASCADE` keeps counts consistent if messages are removed.
- No `CHECK (category IN (...))` constraint — avoids a table-rebuild migration if a new category is added later. Category validation lives in application code.
- No extra index needed beyond the PK.
- Add an idempotency test mirroring `test/migration.test.ts:266`.

**Write pattern** (ingest/compact routes, after storing messages):

```sql
INSERT INTO message_redactions (message_id, category, count)
VALUES (?, ?, ?)
ON CONFLICT(message_id, category) DO UPDATE SET count = excluded.count
```

One row per `(message_id, category)` pair where `count > 0`. Skip zero-count categories.

**Read pattern** (stats):

```sql
SELECT category, SUM(count) AS total
FROM message_redactions
GROUP BY category
```

Per-conversation breakdown (for verbose mode):

```sql
SELECT m.conversation_id, mr.category, SUM(mr.count) AS total
FROM message_redactions mr
JOIN messages m ON m.message_id = mr.message_id
GROUP BY m.conversation_id, mr.category
```

### 3. `stats.ts` Changes

**`queryProjectStats()`** — add redaction query, use `COALESCE` for missing categories:

```ts
interface ProjectStats {
  // ... existing fields ...
  redactionCounts: RedactionCounts;
}
```

**`OverallStats`** — add field:

```ts
redactionCounts: { builtIn: number; global: number; project: number };
```

**`collectStats()`** — sum `redactionCounts` across all project DBs.

**`printStats()`** — add Security section after Compression:

```
── Security ──────────────────────────────────
  🔒 redactions  142 total  (built-in: 139  global: 2  project: 1)
```

Rendered only when `total > 0`. Styling matches existing `dim` label + value pattern.

### 4. `GET /stats` Daemon Route (`src/daemon/routes/stats.ts`)

New route — no `cwd` parameter. Calls `collectStats()` (reads all project DBs) and returns the full `OverallStats` shape as JSON.

```
GET /stats
→ 200 { projects, conversations, messages, summaries, redactionCounts, ... }
```

Registered in `src/daemon/server.ts`. The CLI (`lcm stats`) and MCP tool (`lcm_stats`) continue calling `collectStats()` directly — this route is for programmatic consumers.

---

## Files Changed

| File | Change |
|------|--------|
| `src/scrub.ts` | `scrub()` return type + per-category count tracking |
| `src/db/migration.ts` | Add `message_redactions` table |
| `src/daemon/routes/ingest.ts` | Use `.text`, write per-message redaction counts |
| `src/daemon/routes/compact.ts` | Use `.text`, write per-message redaction counts |
| `src/compaction.ts` | Use `.text` only |
| `src/sensitive.ts` | Use `.text` only |
| `src/stats.ts` | Read counts, render Security section |
| `src/daemon/routes/stats.ts` *(new)* | `GET /stats` route |
| `src/daemon/server.ts` | Register new stats route |
| `test/scrub.test.ts` | Update tests for new return type |
| `test/migration.test.ts` | Add idempotency test for `message_redactions` |

---

## Out of Scope

- Issue #61 (ingest/compact bypass SQLite connection PRAGMAs) — filed separately, not fixed here.
- Wrapping ingest/compact in a single `BEGIN IMMEDIATE` transaction — existing behavior, separate concern.
- Per-conversation verbose breakdown of redaction counts in `printStats` — can be added later in `--verbose` mode.
