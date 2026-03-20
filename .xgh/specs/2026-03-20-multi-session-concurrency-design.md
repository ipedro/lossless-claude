# Multi-Session Concurrency with Shared Memory

**Date:** 2026-03-20
**Status:** Approved
**Scope:** SQLite write safety, per-project operation queuing, composite scoring for cross-session memory injection

## Problem

Multiple Claude Code sessions on the same repository share a single SQLite database (`~/.lossless-claude/projects/{SHA256(cwd)}/db.sqlite`). Current concurrency model has three gaps:

1. **No `busy_timeout`** — concurrent writes fail immediately with SQLITE_BUSY instead of retrying
2. **Reject-not-queue** — `compactingNow` Set rejects concurrent compactions for the same session but doesn't serialize compactions across different sessions on the same project
3. **No cross-session awareness** — prompt-search injects promoted memories based solely on FTS5 relevance, with no recency weighting or session context

## Prior Art

lossless-claw's architecture review identified the daemon as the solution to WAL contention ("avoids SQLite WAL contention from concurrent MCP stdio processes"). Its `docs/architecture.md` describes per-session promise queue serialization, but this was never fully implemented. lossless-claude inherited the daemon pattern but only the `compactingNow` Set guard.

## Design

### 1. SQLite Write Safety

Add `PRAGMA busy_timeout = 5000` to `src/db/connection.ts` after WAL mode. This is a safety net — the operation queue (below) is the primary concurrency mechanism, but `busy_timeout` catches any edge cases where two writes slip through (e.g., prompt-search opening its own DB connection while compact is writing).

**File:** `src/db/connection.ts`
**Change:** Add one pragma line after `PRAGMA journal_mode = WAL`.

**Important:** Routes that create `new DatabaseSync(dbPath)` directly (compact.ts, prompt-search.ts) bypass `getLcmConnection()` and won't inherit this pragma. These must either switch to `getLcmConnection()` or set `busy_timeout` independently. The file change list below accounts for this.

### 2. Per-Project Operation Queue

Replace the `compactingNow` Set with a per-project promise queue. Two sessions on the same project serialize their compactions; two sessions on different projects run in parallel.

```typescript
// src/daemon/project-queue.ts

const queues = new Map<string, { chain: Promise<void>; pending: number }>();

export function enqueue<T>(projectId: string, fn: () => Promise<T>): Promise<T> {
  const entry = queues.get(projectId) ?? { chain: Promise.resolve(), pending: 0 };
  entry.pending++;
  queues.set(projectId, entry);

  const result = entry.chain.then(fn, fn); // run fn regardless of previous result
  entry.chain = result.then(() => {}, () => {}); // swallow for chain continuity

  // Clean up when all pending operations complete
  result.finally(() => {
    entry.pending--;
    if (entry.pending === 0) {
      queues.delete(projectId);
    }
  });

  return result;
}
```

**Behavior:**
- Derive `projectId` from `SHA256(cwd)` (already computed by `projectDbPath`)
- Wrap the entire compact handler body in `enqueue(projectId, async () => { ... })`
- Retain the `compactingNow` Set as a fast-path: if the same `session_id` submits twice, return `{skipped: true}` immediately (don't queue)
- The queue is in-memory (daemon-scoped). Daemon restart clears it, which is fine — no compaction survives a restart anyway

**File:** `src/daemon/project-queue.ts` (new)
**File:** `src/daemon/routes/compact.ts` (replace Set-only guard with queue + Set)

### 3. Composite Scoring in prompt-search

Replace the raw FTS5 rank filter with a composite score that incorporates recency and session affinity.

#### Score Formula

```
score = abs(FTS5_rank) × recency_factor × session_affinity
```

#### Recency Factor

Exponential decay based on the promoted entry's `created_at` timestamp:

```typescript
const ageHours = (Date.now() - new Date(entry.created_at).getTime()) / 3_600_000;
const recencyFactor = Math.pow(0.5, ageHours / config.restoration.recencyHalfLifeHours);
```

| Age | Factor (24h half-life) |
|-----|----------------------|
| 1 hour | 0.97 |
| 6 hours | 0.84 |
| 12 hours | 0.71 |
| 24 hours | 0.50 |
| 48 hours | 0.25 |
| 72 hours | 0.13 |

#### Session Affinity

Soft multiplier based on whether the promoted entry's `session_id` matches the querying session:

```typescript
const sessionAffinity = (entry.session_id === querySessionId)
  ? 1.0
  : config.restoration.crossSessionAffinity; // default: 0.85
```

- `null` session_id on entry (pre-existing memories): treated as cross-session (0.85)
- `null` session_id on query (missing from hook payload): skip affinity (1.0 for all)

#### Threshold

**Breaking change in semantics:** Today, `promptSearchMinScore` of 10 means "FTS5 rank must be ≤ -10" (raw negative rank). After this change, it means "composite score must be ≥ threshold" where composite = `abs(rank) × recency × affinity`. A memory with `abs(rank) = 15` that is 48 hours old from another session gets `15 × 0.25 × 0.85 = 3.19` — well below the old threshold.

**Resolution:** Lower the default `promptSearchMinScore` from 10 to **2** to account for the decay factors. This keeps injection behavior roughly equivalent for fresh memories (`abs(15) × 0.97 × 1.0 = 14.6`, still well above 2) while allowing older cross-session memories to surface (`abs(15) × 0.25 × 0.85 = 3.19`, above 2).

Filter on `score >= config.restoration.promptSearchMinScore` (default: **2**).

#### Query Flow

1. FTS5 query returns top N results (N = `promptSearchMaxResults`, default 3) with rank
2. For each result, compute composite score
3. Filter by threshold
4. Truncate content to `promptSnippetLength` (default 200)
5. Return as `hints[]`

**Note:** `PromotedStore.search()` already returns `createdAt` in `SearchResult` (line 33 of promoted.ts) and the SQL SELECT already fetches `p.created_at` (line 84). Only `session_id` is missing from `SearchResult` and the SQL SELECT — add it to both.

**Note:** `user-prompt.ts` already sends `session_id` in the POST body (line 29). `prompt-search.ts` currently ignores it. No hook changes needed — just consume the existing field.

**File:** `src/db/promoted.ts` (extend `SearchResult` type and SQL SELECT to include `session_id`, `created_at`)
**File:** `src/daemon/routes/prompt-search.ts` (composite scoring, consume `session_id` from request body)
**File:** `src/daemon/config.ts` (add config keys)

### 4. Schema

No migration required. All data already exists in the `promoted` table:

| Column | Type | Used For |
|--------|------|----------|
| `session_id` | TEXT (nullable) | Session affinity |
| `created_at` | TEXT (datetime) | Recency decay |
| `confidence` | REAL | Available as future signal (not used in v1 scoring) |
| `archived_at` | TEXT (nullable) | Excluded from search by PromotedStore |

Index `promoted_project_idx ON (project_id, created_at)` already exists.

### 5. Configuration

New keys added to `restoration` in `src/daemon/config.ts`:

| Key | Type | Default | Purpose |
|-----|------|---------|---------|
| `recencyHalfLifeHours` | number | 24 | Hours until recency factor drops to 0.5 |
| `crossSessionAffinity` | number | 0.85 | Score multiplier for cross-session memories |

Existing keys (unchanged):

| Key | Default | Purpose |
|-----|---------|---------|
| `promptSearchMinScore` | 2 | Minimum composite score for injection (lowered from 10 to account for decay factors) |
| `promptSearchMaxResults` | 3 | Max results from FTS5 query |
| `promptSnippetLength` | 200 | Max chars per hint |

### 6. Files Changed

| File | Change | Lines (est.) |
|------|--------|-------------|
| `src/db/connection.ts` | Add `busy_timeout` pragma | +1 |
| `src/db/promoted.ts` | Add `session_id` to `SearchResult` type and SQL SELECT (`created_at` already present) | ~5 changed |
| `src/daemon/project-queue.ts` | New: per-project promise queue (counter-based cleanup) | ~25 |
| `src/daemon/routes/compact.ts` | Replace Set guard with queue + Set; add inline `PRAGMA busy_timeout = 5000` after `new DatabaseSync()` (keep raw constructor due to explicit `db.close()` lifecycle) | ~25 changed |
| `src/daemon/routes/prompt-search.ts` | Composite scoring; add inline `PRAGMA busy_timeout = 5000` after `new DatabaseSync()`; remove `?? 10` fallback (rely on config defaults); consume `session_id` from request body | ~40 changed |
| `src/daemon/config.ts` | Add `recencyHalfLifeHours`, `crossSessionAffinity` to both `DaemonConfig` type definition AND defaults object; lower `promptSearchMinScore` default from 10 to 2 | +8 |
| `test/daemon/project-queue.test.ts` | Queue serialization tests | ~60 |
| `test/daemon/routes/prompt-search.test.ts` | Composite scoring tests (recency decay, session affinity, threshold) | ~80 |

**Total:** ~1 new file, 5 modified files, 2 new test files. ~240 lines.

### 7. What This Does NOT Cover

- **Live sync between sessions** (SSE/polling) — deferred, not needed with prompt-search picking up promoted memories at query time
- **Conflict resolution for contradictory promoted memories** — dedup.ts handles this at compaction time, not at query time
- **Cross-project memory sharing** — out of scope, each project has its own DB
- **Confidence integration into scoring** — available but deferred to avoid over-tuning before real-world calibration
