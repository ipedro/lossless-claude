# Cross-Project Improvements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port four improvements from OpenViking and context-mode into lossless-claude: YAML prompt templates, promoted memory dedup/merge, UserPromptSubmit hook, and CLAUDE.md persistence through compaction.

**Architecture:** Bottom-up phasing — each phase improves the foundation for the next. All LLM calls use the existing `claude-process` provider. One new hook (UserPromptSubmit) is added. Storage stays in per-project SQLite.

**Tech Stack:** TypeScript, Node.js, SQLite (FTS5), Vitest, YAML (js-yaml), claude-process provider

**Spec:** `.xgh/specs/2026-03-20-cross-project-improvements-design.md`

---

## File Structure

### New files
- `src/prompts/loader.ts` — YAML template loader with `{{var}}` interpolation
- `src/prompts/system.yaml` — system prompt template
- `src/prompts/leaf-normal.yaml` — normal leaf summarization template
- `src/prompts/leaf-aggressive.yaml` — aggressive leaf summarization template
- `src/prompts/condensed-d1.yaml` — depth-1 condensation template
- `src/prompts/condensed-d2.yaml` — depth-2 condensation template
- `src/prompts/condensed-d3plus.yaml` — depth-3+ condensation template
- `src/prompts/promoted-merge.yaml` — promoted memory merge template
- `src/promotion/dedup.ts` — dedup/merge logic for promoted memories
- `src/hooks/user-prompt.ts` — UserPromptSubmit hook handler
- `src/daemon/routes/prompt-search.ts` — daemon route for prompt-based search
- `test/prompts/loader.test.ts` — tests for YAML loader
- `test/promotion/dedup.test.ts` — tests for dedup/merge
- `test/hooks/user-prompt.test.ts` — tests for UserPromptSubmit hook
- `test/daemon/routes/prompt-search.test.ts` — tests for prompt-search route

### Modified files
- `src/summarize.ts` — delegate prompt building to loader
- `src/db/promoted.ts` — add `archive()`, `deleteById()`, `update()`, `WHERE archived_at IS NULL`
- `src/db/migration.ts` — add `archived_at` column, `session_instructions` table
- `src/daemon/routes/compact.ts` — wire dedup into promotion flow
- `src/daemon/config.ts` — add dedup thresholds + prompt search config
- `src/daemon/server.ts` — register `/prompt-search` route
- `src/daemon/routes/restore.ts` — CLAUDE.md capture + inject
- `bin/lossless-claude.ts` — add `user-prompt` command
- `.claude-plugin/plugin.json` — register UserPromptSubmit hook
- `package.json` — add `js-yaml` dependency, `postbuild` copy script

---

## Task 1: Add js-yaml dependency and postbuild script

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install js-yaml**

```bash
npm install js-yaml && npm install -D @types/js-yaml
```

- [ ] **Step 2: Add postbuild script to package.json**

In `package.json` scripts, add a `postbuild` entry that copies YAML files to dist:

```json
"postbuild": "mkdir -p dist/src/prompts && cp -r src/prompts/*.yaml dist/src/prompts/"
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add js-yaml dependency and postbuild copy for prompt templates"
```

---

## Task 2: YAML template loader

**Files:**
- Create: `src/prompts/loader.ts`
- Create: `test/prompts/loader.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// test/prompts/loader.test.ts
import { describe, it, expect } from "vitest";
import { loadTemplate, interpolate } from "../../src/prompts/loader.js";

describe("interpolate", () => {
  it("replaces {{var}} placeholders", () => {
    const result = interpolate("Hello {{name}}, you have {{count}} items", {
      name: "Alice",
      count: "3",
    });
    expect(result).toBe("Hello Alice, you have 3 items");
  });

  it("leaves unmatched placeholders as empty string", () => {
    const result = interpolate("Hello {{name}}", {});
    expect(result).toBe("Hello ");
  });

  it("handles multiple occurrences of same variable", () => {
    const result = interpolate("{{x}} and {{x}}", { x: "yes" });
    expect(result).toBe("yes and yes");
  });
});

describe("loadTemplate", () => {
  it("loads and parses a YAML template file", () => {
    const tpl = loadTemplate("system");
    expect(tpl.name).toBe("system");
    expect(tpl.template).toBeTruthy();
    expect(typeof tpl.template).toBe("string");
  });

  it("throws on unknown template name", () => {
    expect(() => loadTemplate("nonexistent-template")).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/prompts/loader.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Write the loader implementation**

```typescript
// src/prompts/loader.ts
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export type PromptTemplate = {
  name: string;
  description: string;
  variables: string[];
  template: string;
};

const cache = new Map<string, PromptTemplate>();

export function loadTemplate(name: string): PromptTemplate {
  const cached = cache.get(name);
  if (cached) return cached;

  const filePath = join(__dirname, `${name}.yaml`);
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf-8");
  } catch {
    throw new Error(`Prompt template not found: ${name} (looked at ${filePath})`);
  }

  const parsed = yaml.load(raw) as PromptTemplate;
  if (!parsed || typeof parsed.template !== "string") {
    throw new Error(`Invalid prompt template: ${name} — missing 'template' field`);
  }

  cache.set(name, parsed);
  return parsed;
}

export function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => vars[key] ?? "");
}

export function renderTemplate(name: string, vars: Record<string, string>): string {
  const tpl = loadTemplate(name);
  return interpolate(tpl.template, vars);
}
```

- [ ] **Step 4: Create the system.yaml template** (needed for test to pass)

```yaml
# src/prompts/system.yaml
name: system
description: System prompt for the LCM summarization engine
variables: []
template: |
  You are a context-compaction summarization engine. Follow user instructions exactly and return plain text summary content only.
```

- [ ] **Step 5: Run test to verify it passes**

```bash
npx vitest run test/prompts/loader.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/prompts/loader.ts src/prompts/system.yaml test/prompts/loader.test.ts
git commit -m "feat: add YAML prompt template loader with interpolation"
```

---

## Task 3: Extract prompts to YAML templates

**Files:**
- Create: `src/prompts/leaf-normal.yaml`
- Create: `src/prompts/leaf-aggressive.yaml`
- Create: `src/prompts/condensed-d1.yaml`
- Create: `src/prompts/condensed-d2.yaml`
- Create: `src/prompts/condensed-d3plus.yaml`
- Modify: `src/summarize.ts`

- [ ] **Step 1: Create leaf-normal.yaml**

Extract the normal-mode prompt from `buildLeafSummaryPrompt` (summarize.ts:426-472). The template must produce identical output to the current function when interpolated.

```yaml
name: leaf-normal
description: Summarize a conversation segment preserving key details
variables:
  - targetTokens
  - text
  - previousContext
  - instructionBlock
template: |
  You summarize a SEGMENT of a Claude Code conversation for future model turns.
  Treat this as incremental memory compaction input, not a full-conversation summary.

  Normal summary policy:
  - Preserve key decisions, rationale, constraints, and active tasks.
  - Keep essential technical details needed to continue work safely.
  - Remove obvious repetition and conversational filler.

  {{instructionBlock}}

  Output requirements:
  - Plain text only.
  - No preamble, headings, or markdown formatting.
  - Keep it concise while preserving required details.
  - Track file operations (created, modified, deleted, renamed) with file paths and current status.
  - If no file operations appear, include exactly: "Files: none".
  - End with exactly: "Expand for details about: <comma-separated list of what was dropped or compressed>".
  - Target length: about {{targetTokens}} tokens or less.

  <previous_context>
  {{previousContext}}
  </previous_context>

  <conversation_segment>
  {{text}}
  </conversation_segment>
```

- [ ] **Step 2: Create leaf-aggressive.yaml**

Same structure, aggressive policy from `buildLeafSummaryPrompt` aggressive branch.

- [ ] **Step 3: Create condensed-d1.yaml**

Extract from `buildD1Prompt` (summarize.ts:475-523).

- [ ] **Step 4: Create condensed-d2.yaml**

Extract from `buildD2Prompt` (summarize.ts:525-559).

- [ ] **Step 5: Create condensed-d3plus.yaml**

Extract from `buildD3PlusPrompt` (summarize.ts:561-595).

- [ ] **Step 6: Refactor summarize.ts to use loader**

Replace `buildLeafSummaryPrompt` and `buildCondensedSummaryPrompt` to call `renderTemplate()` instead of inline string building. The function signatures and return types stay identical — only the internal prompt construction changes.

Key mapping:
- `buildLeafSummaryPrompt` with `mode === "normal"` → `renderTemplate("leaf-normal", {...})`
- `buildLeafSummaryPrompt` with `mode === "aggressive"` → `renderTemplate("leaf-aggressive", {...})`
- `buildD1Prompt` → `renderTemplate("condensed-d1", {...})`
- `buildD2Prompt` → `renderTemplate("condensed-d2", {...})`
- `buildD3PlusPrompt` → `renderTemplate("condensed-d3plus", {...})`

The `LCM_SUMMARIZER_SYSTEM_PROMPT` constant stays exported (used by `openai.ts` and `claude-process.ts`) but becomes a lazy getter that loads from `system.yaml` via `loadTemplate("system").template.trim()` on first access. This avoids failing at module evaluation time if YAML files aren't deployed yet.

- [ ] **Step 7: Run existing summarize tests to verify no regression**

```bash
npx vitest run test/summarize.test.ts
```

Expected: all existing tests PASS (prompt output is identical).

- [ ] **Step 8: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 9: Build and verify postbuild copies YAML**

```bash
npm run build && ls dist/src/prompts/
```

Expected: all 6 `.yaml` files present in `dist/src/prompts/`.

- [ ] **Step 10: Commit**

```bash
git add src/prompts/*.yaml src/summarize.ts
git commit -m "refactor: extract summarization prompts to YAML templates"
```

---

## Task 4: Add archived_at column and PromotedStore methods

**Files:**
- Modify: `src/db/migration.ts`
- Modify: `src/db/promoted.ts`
- Modify: `test/db/promoted.test.ts`

- [ ] **Step 1: Write failing tests for new PromotedStore methods**

Add to `test/db/promoted.test.ts`:

```typescript
it("archive() soft-deletes entry and removes from FTS5", () => {
  const db = makeDb();
  const store = new PromotedStore(db);
  const id = store.insert({ content: "React is the framework", tags: ["decision"], projectId: "p1" });

  store.archive(id);

  const row = store.getById(id);
  expect(row!.archived_at).toBeTruthy();

  // Should not appear in search results
  const results = store.search("React framework", 10);
  expect(results.find((r) => r.id === id)).toBeUndefined();
});

it("deleteById() removes entry and FTS5 row", () => {
  const db = makeDb();
  const store = new PromotedStore(db);
  const id = store.insert({ content: "Delete me", tags: [], projectId: "p1" });

  store.deleteById(id);
  expect(store.getById(id)).toBeNull();
});

it("update() changes content and re-syncs FTS5", () => {
  const db = makeDb();
  const store = new PromotedStore(db);
  const id = store.insert({ content: "Old content about React", tags: ["decision"], projectId: "p1", confidence: 0.9 });

  store.update(id, { content: "New content about Vue", confidence: 0.7 });

  const row = store.getById(id);
  expect(row!.content).toBe("New content about Vue");
  expect(row!.confidence).toBe(0.7);

  // FTS5 should find new content
  const results = store.search("Vue", 10);
  expect(results.length).toBe(1);

  // FTS5 should NOT find old content
  const oldResults = store.search("React", 10);
  expect(oldResults.length).toBe(0);
});

it("search() excludes archived entries", () => {
  const db = makeDb();
  const store = new PromotedStore(db);
  store.insert({ content: "Active React decision", tags: ["decision"], projectId: "p1" });
  const archivedId = store.insert({ content: "Archived React memory", tags: ["decision"], projectId: "p1" });
  store.archive(archivedId);

  const results = store.search("React", 10);
  expect(results.length).toBe(1);
  expect(results[0].content).toContain("Active");
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/db/promoted.test.ts
```

Expected: FAIL — `archive`, `deleteById`, `update` not defined, `archived_at` column missing.

- [ ] **Step 3: Add migration for archived_at column**

In `src/db/migration.ts`, add a new migration that runs:

```sql
ALTER TABLE promoted ADD COLUMN archived_at TEXT DEFAULT NULL;
```

Use the existing migration pattern in the file.

- [ ] **Step 4: Add archive(), deleteById(), update() to PromotedStore**

In `src/db/promoted.ts`:

```typescript
archive(id: string): void {
  const row = this.db.prepare("SELECT rowid FROM promoted WHERE id = ?").get(id) as { rowid: number } | undefined;
  if (!row) return;
  this.db.prepare("UPDATE promoted SET archived_at = datetime('now') WHERE id = ?").run(id);
  this.db.prepare("DELETE FROM promoted_fts WHERE rowid = ?").run(row.rowid);
}

deleteById(id: string): void {
  const row = this.db.prepare("SELECT rowid FROM promoted WHERE id = ?").get(id) as { rowid: number } | undefined;
  if (row) {
    this.db.prepare("DELETE FROM promoted_fts WHERE rowid = ?").run(row.rowid);
  }
  this.db.prepare("DELETE FROM promoted WHERE id = ?").run(id);
}

update(id: string, fields: { content?: string; confidence?: number; tags?: string[] }): void {
  const row = this.db.prepare("SELECT rowid FROM promoted WHERE id = ?").get(id) as { rowid: number } | undefined;
  if (!row) return;

  if (fields.content !== undefined) {
    this.db.prepare("UPDATE promoted SET content = ? WHERE id = ?").run(fields.content, id);
    // Re-sync FTS5
    this.db.prepare("DELETE FROM promoted_fts WHERE rowid = ?").run(row.rowid);
    const tags = fields.tags ? JSON.stringify(fields.tags) : (this.getById(id)?.tags ?? "[]");
    this.db.prepare("INSERT INTO promoted_fts (rowid, content, tags) VALUES (?, ?, ?)").run(row.rowid, fields.content, tags);
  }
  if (fields.confidence !== undefined) {
    this.db.prepare("UPDATE promoted SET confidence = ? WHERE id = ?").run(fields.confidence, id);
  }
  if (fields.tags !== undefined && fields.content === undefined) {
    const tagsJson = JSON.stringify(fields.tags);
    this.db.prepare("UPDATE promoted SET tags = ? WHERE id = ?").run(tagsJson, id);
  }
}
```

Also add `WHERE p.archived_at IS NULL` to the `search()` method's SQL query.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/db/promoted.test.ts
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/db/migration.ts src/db/promoted.ts test/db/promoted.test.ts
git commit -m "feat: add archive/delete/update to PromotedStore with FTS5 sync"
```

---

## Task 5: Promoted memory dedup/merge

**Files:**
- Create: `src/promotion/dedup.ts`
- Create: `src/prompts/promoted-merge.yaml`
- Create: `test/promotion/dedup.test.ts`
- Modify: `src/daemon/config.ts`

- [ ] **Step 1: Add dedup config to DaemonConfig**

In `src/daemon/config.ts`, add to `compaction.promotionThresholds`:

```typescript
dedupBm25Threshold: 15,
mergeMaxEntries: 3,
confidenceDecayRate: 0.1,
```

- [ ] **Step 2: Create promoted-merge.yaml**

```yaml
name: promoted-merge
description: Merge overlapping promoted memory entries into one
variables:
  - entries
template: |
  You are merging overlapping memory entries from a coding agent's long-term memory.
  Combine them into a single entry that:
  - Removes duplicate information
  - Keeps the most recent state of any decision that evolved
  - Preserves all unique facts, file paths, and identifiers
  - Uses plain text, no headings or formatting
  - Is concise (aim for the length of the longest input entry)

  Entries to merge:

  {{entries}}

  Output the merged entry as plain text. Nothing else.
```

- [ ] **Step 3: Write failing tests**

```typescript
// test/promotion/dedup.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLcmConnection, closeLcmConnection } from "../../src/db/connection.js";
import { runLcmMigrations } from "../../src/db/migration.js";
import { PromotedStore } from "../../src/db/promoted.js";
import { deduplicateAndInsert } from "../../src/promotion/dedup.js";

const tempDirs: string[] = [];
afterEach(() => {
  closeLcmConnection();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function makeDb() {
  const tempDir = mkdtempSync(join(tmpdir(), "lcm-dedup-"));
  tempDirs.push(tempDir);
  const dbPath = join(tempDir, "test.db");
  const db = getLcmConnection(dbPath);
  runLcmMigrations(db);
  return db;
}

describe("deduplicateAndInsert", () => {
  it("inserts new entry when no duplicates exist", async () => {
    const db = makeDb();
    const store = new PromotedStore(db);
    const mockSummarize = vi.fn();

    await deduplicateAndInsert({
      store,
      content: "Decided to use PostgreSQL for the database",
      tags: ["decision"],
      projectId: "p1",
      sessionId: "s1",
      depth: 2,
      confidence: 0.8,
      summarize: mockSummarize,
      thresholds: { dedupBm25Threshold: 15, mergeMaxEntries: 3, confidenceDecayRate: 0.1 },
    });

    const results = store.search("PostgreSQL database", 10);
    expect(results.length).toBe(1);
    expect(mockSummarize).not.toHaveBeenCalled();
  });

  it("merges when duplicate found above threshold", async () => {
    const db = makeDb();
    const store = new PromotedStore(db);

    store.insert({
      content: "Decided to use PostgreSQL for the database layer",
      tags: ["decision"],
      projectId: "p1",
      confidence: 0.9,
    });

    const mockSummarize = vi.fn().mockResolvedValue("Merged: PostgreSQL is the database, confirmed twice");

    await deduplicateAndInsert({
      store,
      content: "Confirmed PostgreSQL as the database choice after benchmarks",
      tags: ["decision"],
      projectId: "p1",
      sessionId: "s1",
      depth: 2,
      confidence: 0.8,
      summarize: mockSummarize,
      thresholds: { dedupBm25Threshold: 5, mergeMaxEntries: 3, confidenceDecayRate: 0.1 },
    });

    const results = store.search("PostgreSQL database", 10);
    expect(results.length).toBe(1);
    expect(results[0].content).toContain("Merged");
    expect(results[0].confidence).toBe(0.8); // max(0.9, 0.8) - 0.1
    expect(mockSummarize).toHaveBeenCalledOnce();
  });

  it("archives entry when confidence decays below 0.2", async () => {
    const db = makeDb();
    const store = new PromotedStore(db);

    store.insert({
      content: "Old stale decision about PostgreSQL",
      tags: ["decision"],
      projectId: "p1",
      confidence: 0.2,
    });

    const mockSummarize = vi.fn().mockResolvedValue("Merged content");

    await deduplicateAndInsert({
      store,
      content: "PostgreSQL decision updated again",
      tags: ["decision"],
      projectId: "p1",
      sessionId: "s1",
      depth: 2,
      confidence: 0.15,
      summarize: mockSummarize,
      thresholds: { dedupBm25Threshold: 5, mergeMaxEntries: 3, confidenceDecayRate: 0.1 },
    });

    // The merged entry should have confidence max(0.2, 0.15) - 0.1 = 0.1, which is < 0.2
    // So it gets archived and a fresh entry is inserted
    const results = store.search("PostgreSQL", 10);
    expect(results.length).toBeGreaterThanOrEqual(1);
  });
});
```

- [ ] **Step 4: Run tests to verify they fail**

```bash
npx vitest run test/promotion/dedup.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 5: Implement deduplicateAndInsert**

```typescript
// src/promotion/dedup.ts
import type { PromotedStore } from "../db/promoted.js";
import { renderTemplate } from "../prompts/loader.js";

type DedupThresholds = {
  dedupBm25Threshold: number;
  mergeMaxEntries: number;
  confidenceDecayRate: number;
};

type DedupParams = {
  store: PromotedStore;
  content: string;
  tags: string[];
  projectId: string;
  sessionId?: string;
  depth: number;
  confidence: number;
  summarize: (text: string) => Promise<string>;
  thresholds: DedupThresholds;
};

export async function deduplicateAndInsert(params: DedupParams): Promise<string> {
  const { store, content, tags, projectId, sessionId, depth, confidence, summarize, thresholds } = params;

  // Search for duplicates using FTS5
  const candidates = store.search(content, thresholds.mergeMaxEntries);

  // Filter to entries above BM25 threshold (rank is negative; more negative = better match)
  const duplicates = candidates.filter((c) => c.rank <= -thresholds.dedupBm25Threshold);

  if (duplicates.length === 0) {
    // No duplicates — insert as new
    return store.insert({ content, tags, projectId, sessionId, depth, confidence });
  }

  // Merge: combine all duplicate entries + new content
  const allEntries = [...duplicates.map((d) => d.content), content];
  const entriesText = allEntries.map((e, i) => `Entry ${i + 1}:\n${e}`).join("\n\n");
  const mergePrompt = renderTemplate("promoted-merge", { entries: entriesText });

  let mergedContent: string;
  try {
    mergedContent = await summarize(mergePrompt);
  } catch {
    // Merge failed — insert as new entry rather than losing data
    return store.insert({ content, tags, projectId, sessionId, depth, confidence });
  }

  if (!mergedContent.trim()) {
    return store.insert({ content, tags, projectId, sessionId, depth, confidence });
  }

  // Calculate merged confidence
  const maxConfidence = Math.max(confidence, ...duplicates.map((d) => d.confidence));
  const mergedConfidence = Math.max(0, maxConfidence - thresholds.confidenceDecayRate);

  // Delete old duplicates
  for (const dup of duplicates) {
    store.deleteById(dup.id);
  }

  // Archive if confidence too low
  if (mergedConfidence < 0.2) {
    const id = store.insert({ content: mergedContent, tags, projectId, sessionId, depth, confidence: mergedConfidence });
    store.archive(id);
    // Insert a fresh entry with the new content at original confidence
    return store.insert({ content, tags, projectId, sessionId, depth, confidence });
  }

  // Insert merged entry
  return store.insert({ content: mergedContent, tags, projectId, sessionId, depth, confidence: mergedConfidence });
}
```

- [ ] **Step 6: Run tests to verify they pass**

```bash
npx vitest run test/promotion/dedup.test.ts
```

Expected: PASS

- [ ] **Step 7: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 8: Commit**

```bash
git add src/promotion/dedup.ts src/prompts/promoted-merge.yaml src/daemon/config.ts test/promotion/dedup.test.ts
git commit -m "feat: add promoted memory dedup/merge with confidence decay"
```

---

## Task 6: Wire dedup into compaction flow

**Files:**
- Modify: `src/daemon/routes/compact.ts` — where `shouldPromote()` result triggers `store.insert()`

This task connects the dedup logic from Task 5 into the existing promotion path. Currently `shouldPromote()` is called from the compact route and the caller does the insert. The caller should now call `deduplicateAndInsert()` instead of `store.insert()` when promotion is approved.

- [ ] **Step 1: Identify the call site in compact.ts**

Find where `shouldPromote` result leads to `store.insert` in `src/daemon/routes/compact.ts`. The summarizer function is created earlier in the handler scope — reference that same variable.

- [ ] **Step 2: Replace direct insert with deduplicateAndInsert**

At the call site, replace:
```typescript
store.insert({ content, tags, projectId, ... });
```
with:
```typescript
await deduplicateAndInsert({ store, content, tags, projectId, summarize: summarizer, thresholds: config.compaction.promotionThresholds, ... });
```

Where `summarizer` is the summarize function already in scope from the compact handler, and `config` is the `DaemonConfig` passed to the handler factory.

Note: `deduplicateAndInsert` is async but the compact handler is already `async`, so `await` works naturally here. Merge operations happen inline during compaction — the sequential execution of the compaction handler (guarded by `compactingNow`) already prevents concurrent merges.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add src/daemon/routes/compact.ts
git commit -m "feat: wire dedup/merge into compaction promotion flow"
```

---

## Task 7: UserPromptSubmit hook handler

**Files:**
- Create: `src/hooks/user-prompt.ts`
- Create: `test/hooks/user-prompt.test.ts`
- Modify: `bin/lossless-claude.ts`

- [ ] **Step 1: Write failing tests**

```typescript
// test/hooks/user-prompt.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleUserPromptSubmit } from "../../src/hooks/user-prompt.js";

vi.mock("../../src/daemon/lifecycle.js", () => ({
  ensureDaemon: vi.fn(),
}));

import { ensureDaemon } from "../../src/daemon/lifecycle.js";
const mockEnsureDaemon = vi.mocked(ensureDaemon);

describe("handleUserPromptSubmit", () => {
  it("returns hint when daemon returns matches", async () => {
    mockEnsureDaemon.mockResolvedValue({ connected: true, port: 3737, spawned: false });
    const client = {
      health: vi.fn(),
      post: vi.fn().mockResolvedValue({
        hints: ["Decided to use PostgreSQL for storage", "Fixed race condition in compaction"],
      }),
    };
    const result = await handleUserPromptSubmit(
      JSON.stringify({ session_id: "s1", cwd: "/proj", prompt: "what database do we use?" }),
      client as any,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("<memory-context>");
    expect(result.stdout).toContain("PostgreSQL");
  });

  it("returns empty when daemon returns no matches", async () => {
    mockEnsureDaemon.mockResolvedValue({ connected: true, port: 3737, spawned: false });
    const client = {
      health: vi.fn(),
      post: vi.fn().mockResolvedValue({ hints: [] }),
    };
    const result = await handleUserPromptSubmit(
      JSON.stringify({ session_id: "s1", cwd: "/proj", prompt: "hello" }),
      client as any,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("returns empty when daemon unreachable", async () => {
    mockEnsureDaemon.mockResolvedValue({ connected: false, port: 3737, spawned: false });
    const client = { health: vi.fn(), post: vi.fn() };
    const result = await handleUserPromptSubmit("{}", client as any);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });

  it("returns empty when prompt is missing", async () => {
    mockEnsureDaemon.mockResolvedValue({ connected: true, port: 3737, spawned: false });
    const client = {
      health: vi.fn(),
      post: vi.fn().mockResolvedValue({ hints: [] }),
    };
    const result = await handleUserPromptSubmit(
      JSON.stringify({ session_id: "s1", cwd: "/proj" }),
      client as any,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run test/hooks/user-prompt.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the hook handler**

```typescript
// src/hooks/user-prompt.ts
import type { DaemonClient } from "../daemon/client.js";
import { ensureDaemon } from "../daemon/lifecycle.js";
import { join } from "node:path";
import { homedir } from "node:os";

type PromptSearchResponse = {
  hints: string[];
};

export async function handleUserPromptSubmit(
  stdin: string,
  client: DaemonClient,
  port?: number,
): Promise<{ exitCode: number; stdout: string }> {
  const daemonPort = port ?? 3737;
  const pidFilePath = join(homedir(), ".lossless-claude", "daemon.pid");
  const { connected } = await ensureDaemon({ port: daemonPort, pidFilePath, spawnTimeoutMs: 5000 });
  if (!connected) return { exitCode: 0, stdout: "" };

  try {
    const input = JSON.parse(stdin || "{}");
    if (!input.prompt || typeof input.prompt !== "string" || !input.prompt.trim()) {
      return { exitCode: 0, stdout: "" };
    }

    const result = await client.post<PromptSearchResponse>("/prompt-search", {
      query: input.prompt,
      cwd: input.cwd,
      session_id: input.session_id,
    });

    if (!result.hints || result.hints.length === 0) {
      return { exitCode: 0, stdout: "" };
    }

    const snippets = result.hints.map((h) => `- ${h}`).join("\n");
    const hint = `<memory-context>\nRelevant context from previous sessions (use lcm_expand for details):\n${snippets}\n</memory-context>`;
    return { exitCode: 0, stdout: hint };
  } catch {
    return { exitCode: 0, stdout: "" };
  }
}
```

- [ ] **Step 4: Add CLI command in bin/lossless-claude.ts**

Add `case "user-prompt":` alongside the existing `case "compact":`, `case "restore":`, `case "session-end":`. Follow the same pattern — read stdin, call `handleUserPromptSubmit`, write stdout.

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/hooks/user-prompt.test.ts
```

Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/hooks/user-prompt.ts test/hooks/user-prompt.test.ts bin/lossless-claude.ts
git commit -m "feat: add UserPromptSubmit hook handler with memory hint injection"
```

---

## Task 8: Prompt-search daemon route

**Files:**
- Create: `src/daemon/routes/prompt-search.ts`
- Create: `test/daemon/routes/prompt-search.test.ts`
- Modify: `src/daemon/server.ts`
- Modify: `src/daemon/config.ts`

- [ ] **Step 1: Add prompt search config**

In `src/daemon/config.ts`, add to the `restoration` section:

```typescript
promptSearchMinScore: 10,
promptSearchMaxResults: 3,
promptSnippetLength: 200,
```

- [ ] **Step 2: Write failing test**

```typescript
// test/daemon/routes/prompt-search.test.ts
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, it, expect } from "vitest";
import { createPromptSearchHandler } from "../../src/daemon/routes/prompt-search.js";
import { projectDbPath } from "../../src/daemon/project.js";
import { runLcmMigrations } from "../../src/db/migration.js";
import { PromotedStore } from "../../src/db/promoted.js";
import { loadDaemonConfig } from "../../src/daemon/config.js";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function setupProject(entries: string[]) {
  const tempDir = mkdtempSync(join(tmpdir(), "lcm-prompt-search-"));
  tempDirs.push(tempDir);
  const dbPath = projectDbPath(tempDir);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  runLcmMigrations(db);
  const store = new PromotedStore(db);
  for (const content of entries) {
    store.insert({ content, tags: ["decision"], projectId: "p1", confidence: 0.9 });
  }
  db.close();
  return tempDir;
}

describe("createPromptSearchHandler", () => {
  const config = loadDaemonConfig("/x");

  it("returns hints for matching promoted entries", async () => {
    const cwd = setupProject(["Decided to use PostgreSQL for the database"]);
    const handler = createPromptSearchHandler(config);
    // Invoke handler with mock req/res following existing route test patterns
    // Verify response has { hints: ["Decided to use PostgreSQL..."] }
  });

  it("returns empty hints when no matches", async () => {
    const cwd = setupProject(["Decided to use PostgreSQL"]);
    const handler = createPromptSearchHandler(config);
    // Invoke with query that won't match, verify { hints: [] }
  });

  it("truncates snippets to configured length", async () => {
    const longContent = "A".repeat(500);
    const cwd = setupProject([longContent]);
    const handler = createPromptSearchHandler(config);
    // Invoke and verify snippet length <= promptSnippetLength + "..."
  });
});
```

- [ ] **Step 3: Implement prompt-search route**

```typescript
// src/daemon/routes/prompt-search.ts
import { existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { DaemonConfig } from "../config.js";
import { projectDbPath } from "../project.js";
import { sendJson } from "../server.js";
import type { RouteHandler } from "../server.js";
import { runLcmMigrations } from "../../db/migration.js";
import { PromotedStore } from "../../db/promoted.js";

export function createPromptSearchHandler(config: DaemonConfig): RouteHandler {
  return async (_req, res, body) => {
    const input = JSON.parse(body || "{}");
    const { query, cwd } = input;

    if (!query || !cwd) {
      sendJson(res, 200, { hints: [] });
      return;
    }

    const dbPath = projectDbPath(cwd);
    if (!existsSync(dbPath)) {
      sendJson(res, 200, { hints: [] });
      return;
    }

    try {
      mkdirSync(dirname(dbPath), { recursive: true });
      const db = new DatabaseSync(dbPath);
      runLcmMigrations(db);

      const store = new PromotedStore(db);
      const maxResults = config.restoration.promptSearchMaxResults ?? 3;
      const minScore = config.restoration.promptSearchMinScore ?? 10;
      const snippetLength = config.restoration.promptSnippetLength ?? 200;

      const results = store.search(query, maxResults);
      const filtered = results.filter((r) => r.rank <= -minScore);

      const hints = filtered.map((r) =>
        r.content.length > snippetLength
          ? r.content.slice(0, snippetLength) + "..."
          : r.content
      );

      db.close();
      sendJson(res, 200, { hints });
    } catch {
      sendJson(res, 200, { hints: [] });
    }
  };
}
```

- [ ] **Step 4: Register route in server.ts**

Add `POST /prompt-search` route in `src/daemon/server.ts`, following the pattern of existing routes.

- [ ] **Step 5: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/routes/prompt-search.ts src/daemon/server.ts src/daemon/config.ts test/daemon/routes/prompt-search.test.ts
git commit -m "feat: add /prompt-search daemon route for memory hint injection"
```

---

## Task 9: Register UserPromptSubmit hook in plugin

**Files:**
- Modify: `.claude-plugin/plugin.json`

- [ ] **Step 1: Add UserPromptSubmit hook**

Add to the `hooks` section in `.claude-plugin/plugin.json`:

```json
"UserPromptSubmit": [
  {
    "matcher": "",
    "hooks": [{ "type": "command", "command": "lossless-claude user-prompt" }]
  }
]
```

- [ ] **Step 2: Build and verify**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 3: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "feat: register UserPromptSubmit hook for passive memory surfacing"
```

---

## Task 10: CLAUDE.md persistence — migration and capture

**Files:**
- Modify: `src/db/migration.ts`
- Modify: `src/daemon/routes/restore.ts`
- Modify: `test/daemon/routes/restore.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/daemon/routes/restore.test.ts`. These tests require a temp directory with a real SQLite DB and CLAUDE.md files on disk:

```typescript
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// Add to the existing describe block:

it("injects session_instructions on compact restore", async () => {
  // Set up a temp project dir with a DB that has session_instructions
  const tempDir = mkdtempSync(join(tmpdir(), "lcm-restore-"));
  const dbPath = projectDbPath(tempDir);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  runLcmMigrations(db);
  db.prepare(
    "INSERT OR REPLACE INTO session_instructions (id, content, content_hash) VALUES (1, ?, ?)"
  ).run("# Test instructions\nDo not use mocks", "abc123");
  db.close();

  // Call the restore handler with source="compact" and session_id that triggers isPostCompact
  // The response should include <project-instructions> even on post-compact path
  const handler = createRestoreHandler(config);
  const { res, getBody } = mockResponse();
  await handler(mockReq(), res, JSON.stringify({ session_id: "s1", cwd: tempDir, source: "compact" }));
  const body = getBody();
  expect(body.context).toContain("<project-instructions>");
  expect(body.context).toContain("Do not use mocks");

  rmSync(tempDir, { recursive: true, force: true });
});

it("captures CLAUDE.md on startup restore", async () => {
  const tempDir = mkdtempSync(join(tmpdir(), "lcm-restore-"));

  // Write a CLAUDE.md in the temp project dir
  writeFileSync(join(tempDir, "CLAUDE.md"), "# Project Rules\nAlways write tests first");

  // Set up DB
  const dbPath = projectDbPath(tempDir);
  mkdirSync(dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  runLcmMigrations(db);
  db.close();

  // Call restore with source="startup"
  const handler = createRestoreHandler(config);
  const { res, getBody } = mockResponse();
  await handler(mockReq(), res, JSON.stringify({ session_id: "s1", cwd: tempDir, source: "startup" }));

  // Verify session_instructions was written to DB
  const db2 = new DatabaseSync(dbPath);
  const row = db2.prepare("SELECT content FROM session_instructions WHERE id = 1").get() as { content: string } | undefined;
  expect(row).toBeTruthy();
  expect(row!.content).toContain("Always write tests first");
  db2.close();

  rmSync(tempDir, { recursive: true, force: true });
});
```

Adapt the `mockResponse` and `mockReq` helpers to match the existing test patterns in `restore.test.ts`. If those helpers don't exist, create minimal versions that capture the JSON response.

- [ ] **Step 2: Run test to verify it fails**

```bash
npx vitest run test/daemon/routes/restore.test.ts
```

Expected: FAIL

- [ ] **Step 3: Add session_instructions migration**

In `src/db/migration.ts`, add:

```sql
CREATE TABLE IF NOT EXISTS session_instructions (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  content TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

- [ ] **Step 4: Modify restore handler**

In `src/daemon/routes/restore.ts`, add two behaviors:

**On startup** (`source !== "compact"` and not post-compact):
After the existing logic, read CLAUDE.md files from disk:
```typescript
const claudeMdPaths = [
  join(homedir(), ".claude", "CLAUDE.md"),
  join(cwd, "CLAUDE.md"),
  join(cwd, ".claude", "CLAUDE.md"),
];
```
Concatenate contents with path headers, SHA-256 hash, upsert into `session_instructions` if hash changed.

**On compact/resume** (always, including `isPostCompact`):
Query `session_instructions` table. If row exists, add `<project-instructions>` block to context.

Restructure the `isPostCompact` early return:
```typescript
// Before (old):
if (isPostCompact) {
  sendJson(res, 200, { context: orientation });
  return;
}

// After (new):
let instructionsContext = "";
// ... query session_instructions ...
if (isPostCompact) {
  const context = [orientation, instructionsContext].filter(Boolean).join("\n\n");
  sendJson(res, 200, { context });
  return;
}
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
npx vitest run test/daemon/routes/restore.test.ts
```

Expected: PASS

- [ ] **Step 6: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 7: Build**

```bash
npm run build
```

Expected: clean build.

- [ ] **Step 8: Commit**

```bash
git add src/db/migration.ts src/daemon/routes/restore.ts test/daemon/routes/restore.test.ts
git commit -m "feat: persist CLAUDE.md through compaction via session_instructions"
```

---

## Task 11: Final integration test and build verification

**Files:** None new — verification only.

- [ ] **Step 1: Run full test suite**

```bash
npm test
```

Expected: all tests PASS.

- [ ] **Step 2: Clean build**

```bash
rm -rf dist && npm run build
```

Expected: clean build, YAML files present in `dist/src/prompts/`.

- [ ] **Step 3: Verify YAML files copied**

```bash
ls dist/src/prompts/*.yaml
```

Expected: 7 files (system, leaf-normal, leaf-aggressive, condensed-d1, condensed-d2, condensed-d3plus, promoted-merge).

- [ ] **Step 4: Type check**

```bash
npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Commit any final fixes**

If any fixes were needed, commit them.
