# Lossless-Codex Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `lossless-codex` wrapper that gives Codex first-class shared memory using the existing LCM project database, promoted store, restore flow, and compaction engine.

**Architecture:** Keep the backend runtime-neutral. Extend `/ingest` to accept normalized `ParsedMessage[]` directly and extend `/compact` with `skip_ingest: true` for explicitly stored sessions. Build `lossless-codex` on top of `codex exec --json`, using `codex exec resume --json` only when a native Codex session ID can be resolved safely. Maintain an LCM session ID with a `codex-` prefix, compose Codex-friendly plain-text restore/prompt-search context, ingest each turn live, and compact stored messages after each turn.

**Tech Stack:** TypeScript, Vitest, Node `child_process`, Codex CLI JSONL exec mode, lossless-claude HTTP daemon, SQLite

---

## Guardrails

- Keep `src/transcript.ts` Claude-JSONL-specific. Reuse its `ParsedMessage` type if helpful, but do not make it Codex-aware.
- Do not add a second compaction route. Use one `/compact` route with `skip_ingest: true`.
- Treat the adapter as the integration surface. `restore`, `prompt-search`, `search`, promotion, and the compaction engine stay shared.
- Prefer a thin binary and a testable adapter module. `bin/lossless-codex.ts` should parse args and delegate to `src/adapters/codex.ts`.
- Make the first cut line-oriented and reliable, not TUI-perfect. A simple REPL wrapper is acceptable if it preserves Codex session continuity and LCM memory behavior.
- `composeCodexTurnPrompt()` must emit plain text only. Do not inject Claude-only wrapper tags such as `<system-reminder>`.
- The committed Codex fixture must work offline. Tests must not require live Codex auth, network, or a local session directory.
- Daemon startup must not assume `process.argv[1]` points at `lossless-claude`. Either generalize `ensureDaemon()` with an explicit spawn target or have the adapter start `lossless-claude daemon start` directly.
- If daemon startup or daemon requests fail, `lossless-codex` must degrade to pass-through Codex execution instead of aborting the user turn.
- Native Codex resume is best-effort. If the runner cannot resolve a stable native Codex session ID, continue with fresh `codex exec --json` turns while preserving LCM-side memory behavior.

### Task 1: Structured `/ingest` contract

**Files:**
- Create: `test/daemon/routes/ingest.test.ts`
- Modify: `src/daemon/routes/ingest.ts`
- Reference: `src/transcript.ts`

- [ ] **Step 1: Write failing route tests for structured messages**

Create `test/daemon/routes/ingest.test.ts` with route-level tests that cover:

```ts
it("accepts messages[] as an alternative to transcript_path", async () => {
  const res = await fetch(`${baseUrl}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: "codex-test-1",
      cwd: tmpDir,
      messages: [
        { role: "user", content: "hello", tokenCount: 1 },
        { role: "assistant", content: "hi", tokenCount: 1 },
      ],
    }),
  });
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ ingested: 2 });
});

it("prefers messages[] over transcript_path when both are present", async () => {
  // pass a missing transcript_path and a valid messages[] array
  // expect ingest to succeed from messages[] only
});
```

Also add one regression test that current `transcript_path` ingestion still returns `ingested: 0` when the file is missing.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/daemon/routes/ingest.test.ts --reporter=verbose`
Expected: FAIL because `createIngestHandler()` ignores `messages`.

- [ ] **Step 3: Implement `messages[]` support in `/ingest`**

In `src/daemon/routes/ingest.ts`, extend the input contract:

```ts
type IngestInput = {
  session_id?: string;
  cwd?: string;
  transcript_path?: string;
  messages?: ParsedMessage[];
};
```

Use this source selection order:

```ts
const parsed =
  Array.isArray(input.messages) && input.messages.length > 0
    ? input.messages
    : input.transcript_path && existsSync(input.transcript_path)
      ? parseTranscript(input.transcript_path)
      : [];
```

Keep the existing `session_id` + `cwd` validation and the existing `createMessagesBulk()` + `appendContextMessages()` flow.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/daemon/routes/ingest.test.ts --reporter=verbose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add test/daemon/routes/ingest.test.ts src/daemon/routes/ingest.ts
git commit -m "feat: accept structured messages in ingest route"
```

---

### Task 2: Stored-message compaction path

**Files:**
- Modify: `src/daemon/routes/compact.ts`
- Modify: `test/daemon/routes/compact.test.ts`
- Reference: `test/daemon/routes/ingest.test.ts`
- Reference: `src/daemon/routes/ingest.ts`

- [ ] **Step 1: Write failing tests for `skip_ingest: true`**

Add to `test/daemon/routes/compact.test.ts`:

```ts
function readMessageCount(cwd: string, sessionId: string): number {
  const db = new DatabaseSync(projectDbPath(cwd));
  try {
    return db
      .prepare(`SELECT COUNT(*) AS count FROM messages m JOIN conversations c ON m.conversation_id = c.conversation_id WHERE c.session_id = ?`)
      .get(sessionId).count as number;
  } finally {
    db.close();
  }
}

async function seedMessages(baseUrl: string, cwd: string, sessionId: string) {
  await fetch(`${baseUrl}/ingest`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: sessionId,
      cwd,
      messages: [
        { role: "user", content: "one", tokenCount: 1 },
        { role: "assistant", content: "two", tokenCount: 1 },
        { role: "user", content: "three", tokenCount: 1 },
        { role: "assistant", content: "four", tokenCount: 1 },
      ],
    }),
  });
}

it("compacts already-stored messages when skip_ingest is true", async () => {
  await seedMessages(baseUrl, tmpDir, "codex-test-compact");
  writeFileSync(
    join(tmpDir, "transcript.jsonl"),
    [
      JSON.stringify({ message: { role: "user", content: "extra transcript message" } }),
      JSON.stringify({ message: { role: "assistant", content: "extra transcript reply" } }),
    ].join("\n"),
  );

  const res = await fetch(`${baseUrl}/compact`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      session_id: "codex-test-compact",
      cwd: tmpDir,
      transcript_path: join(tmpDir, "transcript.jsonl"),
      skip_ingest: true,
    }),
  });

  expect(res.status).toBe(200);
  expect((await res.json()).summary).toEqual(expect.any(String));
  expect(readMessageCount(tmpDir, "codex-test-compact")).toBe(4);
});
```

Start the route-level daemon in this test with a mocked summarizer-backed config, for example:

```ts
const config = loadDaemonConfig("/x", {
  daemon: { port: 0 },
  llm: { provider: "openai", model: "test-model", baseURL: "http://localhost:11435/v1", apiKey: "sk-test" },
});
```

That ensures the existing `createOpenAISummarizer()` mock is used instead of a real summarizer.

Also add one regression assertion that `skip_ingest` defaults to `false`, so the old transcript path behavior stays intact when a valid `transcript_path` is present.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/daemon/routes/compact.test.ts --reporter=verbose`
Expected: FAIL because `/compact` still ingests the valid transcript file even when `skip_ingest: true`, so the stored message count grows beyond the seeded 4 messages.

- [ ] **Step 3: Implement `skip_ingest`**

In `src/daemon/routes/compact.ts`, extend the request body:

```ts
const { session_id, cwd, transcript_path, skip_ingest = false } = input;
```

Gate the ingest block like this:

```ts
if (!skip_ingest && transcript_path && existsSync(transcript_path)) {
  // existing parseTranscript() + createMessagesBulk() logic
}
```

Do not add a new route. Do not touch compaction internals. The point of the flag is to make the already-supported "compact stored messages only" path explicit even when a valid transcript file is also present.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/daemon/routes/compact.test.ts --reporter=verbose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/routes/compact.ts test/daemon/routes/compact.test.ts
git commit -m "feat: allow compacting stored sessions without transcript ingest"
```

---

### Task 3: Codex JSON fixture and normalization contract

**Files:**
- Create: `test/fixtures/codex/exec-turn.jsonl`
- Create: `test/adapters/codex.test.ts`
- Create: `src/adapters/codex.ts`
- Reference: `src/transcript.ts`

- [ ] **Step 1: Commit an offline Codex exec fixture**

Preferred path: use the local Codex CLI to capture one real JSONL turn:

```bash
codex exec --json "Reply only with OK" > /tmp/lossless-codex-fixture.jsonl
```

Fallback path: if Codex is unavailable, unauthenticated, or offline, hand-craft `test/fixtures/codex/exec-turn.jsonl` from the observed local session schema under `~/.codex/sessions/`, preserving only the minimal event shapes the adapter needs.

Commit the minimal redacted lines needed into `test/fixtures/codex/exec-turn.jsonl`. Keep enough structure to represent:
- one user prompt
- one assistant text reply
- one tool call + tool output pair

The fixture is the source of truth for event names in this task. Do not assume OpenAI chat/completions naming beyond what the committed fixture actually shows.

- [ ] **Step 2: Write failing adapter tests**

Create `test/adapters/codex.test.ts` covering:

```ts
it("prefixes LCM session ids with codex-", () => {
  expect(createLosslessCodexSessionId()).toMatch(/^codex-[0-9a-f-]+$/);
});

it("normalizes codex jsonl events into ParsedMessage[]", () => {
  const jsonl = readFileSync("test/fixtures/codex/exec-turn.jsonl", "utf8");
  const messages = normalizeCodexExecJsonl(jsonl);
  expect(messages).toEqual([
    expect.objectContaining({ role: "user", content: expect.any(String) }),
    expect.objectContaining({ role: "assistant", content: expect.any(String) }),
  ]);
});

it("formats restore and prompt-search context as plain text for codex", () => {
  const prompt = composeCodexTurnPrompt({
    restoreContext: "<memory-orientation>...</memory-orientation>",
    promptHints: ["remember the daemon port", "project uses sqlite"],
    userPrompt: "continue",
  });
  expect(prompt).toContain("continue");
  expect(prompt).not.toContain("<system-reminder>");
  expect(prompt).not.toContain("<system>");
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run test/adapters/codex.test.ts --reporter=verbose`
Expected: FAIL because `src/adapters/codex.ts` does not exist yet.

- [ ] **Step 4: Implement the normalization module**

Create `src/adapters/codex.ts` with:
- `createLosslessCodexSessionId()` returning `` `codex-${randomUUID()}` ``
- `composeCodexTurnPrompt()` that merges restore context, prompt-search hints, and the raw user prompt into a plain-text Codex prompt block
- `normalizeCodexExecJsonl()` that maps JSONL events into `ParsedMessage[]`

Use the event names and shapes from the committed fixture. For the first cut, normalize only the event types that are present in the fixture and explicitly covered by tests. For example:
- Codex user `message` items become `role: "user"`
- Codex assistant `message` items become `role: "assistant"`
- Codex `function_call` items become `role: "assistant"` with deterministic text such as `Tool call shell: {"command":["rg","--files"]}`
- Codex `function_call_output` items become `role: "tool"` with the plain output payload
- Token counts come from the existing `estimateTokens()` helper in `src/transcript.ts`

- [ ] **Step 5: Run tests to verify they pass and commit**

Run: `npx vitest run test/adapters/codex.test.ts --reporter=verbose`
Expected: PASS.

```bash
git add test/fixtures/codex/exec-turn.jsonl test/adapters/codex.test.ts src/adapters/codex.ts
git commit -m "feat: add codex event normalization adapter"
```

---

### Task 4: Binary-safe daemon startup

**Files:**
- Modify: `src/daemon/lifecycle.ts`
- Modify: `test/daemon/lifecycle.test.ts`
- Reference: `bin/lossless-claude.ts`

- [ ] **Step 1: Write failing lifecycle tests for explicit spawn targets**

Add to `test/daemon/lifecycle.test.ts` tests that verify the daemon helper can be called from a non-`lossless-claude` binary:

```ts
it("spawns a caller-specified command instead of process.argv[1] when provided", async () => {
  const spawnMock = vi.fn().mockReturnValue({ pid: 12345, unref: vi.fn() });
  await ensureDaemon({
    port: 19999,
    pidFilePath: pidFile,
    spawnTimeoutMs: 1000,
    spawnCommand: "lossless-claude",
    spawnArgs: ["daemon", "start"],
    _skipHealthWait: true,
    _spawnOverride: spawnMock,
  });
  expect(spawnMock).toHaveBeenCalledWith(
    "lossless-claude",
    ["daemon", "start"],
    expect.objectContaining({ detached: true, stdio: "ignore" }),
  );
});
```

Keep the existing default-path test coverage so hook callers still use the current spawn path when no overrides are passed.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/daemon/lifecycle.test.ts --reporter=verbose`
Expected: FAIL because `ensureDaemon()` does not yet accept an explicit spawn target.

- [ ] **Step 3: Generalize `ensureDaemon()` spawn configuration**

In `src/daemon/lifecycle.ts`, extend `EnsureDaemonOptions` with explicit spawn overrides:

```ts
spawnCommand?: string;
spawnArgs?: string[];
_spawnOverride?: typeof spawn;
_skipHealthWait?: boolean;
```

Default behavior remains unchanged:

```ts
const spawnCommand = opts.spawnCommand ?? process.execPath;
const spawnArgs = opts.spawnArgs ?? [process.argv[1], "daemon", "start"];
```

Use `opts._spawnOverride ?? spawn` for testing.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/daemon/lifecycle.test.ts --reporter=verbose`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/lifecycle.ts test/daemon/lifecycle.test.ts
git commit -m "refactor: support explicit daemon spawn targets"
```

---

### Task 5: `lossless-codex` session runner

**Files:**
- Modify: `src/adapters/codex.ts`
- Create: `bin/lossless-codex.ts`
- Modify: `package.json`
- Modify: `test/adapters/codex.test.ts`
- Reference: `src/daemon/lifecycle.ts`

- [ ] **Step 1: Write failing orchestration tests**

Extend `test/adapters/codex.test.ts` with tests that mock `spawn`, the daemon client, and the filesystem:

```ts
it("uses codex exec --json on the first turn", async () => {
  await runLosslessCodexTurn(session, "hello", deps);
  expect(deps.spawn).toHaveBeenCalledWith(
    "codex",
    expect.arrayContaining(["exec", "--json", expect.any(String)]),
    expect.anything(),
  );
});

it("uses codex exec resume <native-id> --json on later turns", async () => {
  session.codexSessionId = "native-codex-session";
  await runLosslessCodexTurn(session, "continue", deps);
  expect(deps.spawn).toHaveBeenCalledWith(
    "codex",
    expect.arrayContaining(["exec", "resume", "native-codex-session", "--json", expect.any(String)]),
    expect.anything(),
  );
});

it("falls back to fresh codex exec turns when no native Codex session id can be resolved", async () => {
  deps.resolveNativeCodexSessionId.mockResolvedValue(undefined);
  await runLosslessCodexTurn(session, "hello", deps);
  await runLosslessCodexTurn(session, "continue", deps);
  expect(deps.spawn).toHaveBeenNthCalledWith(
    2,
    "codex",
    expect.arrayContaining(["exec", "--json", expect.any(String)]),
    expect.anything(),
  );
});

it("degrades to pass-through codex when daemon startup fails", async () => {
  deps.ensureDaemon.mockResolvedValue({ connected: false, port: 3737, spawned: false });
  await runLosslessCodexTurn(session, "hello", deps);
  expect(deps.spawn).toHaveBeenCalled();
  expect(deps.client.post).not.toHaveBeenCalledWith("/restore", expect.anything());
  expect(deps.client.post).not.toHaveBeenCalledWith("/ingest", expect.anything());
});

it("calls restore once, prompt-search every turn, ingest every turn, and compact with skip_ingest", async () => {
  await runLosslessCodexTurn(session, "hello", deps);
  expect(deps.client.post).toHaveBeenCalledWith("/restore", expect.objectContaining({ session_id: session.lcmSessionId }));
  expect(deps.client.post).toHaveBeenCalledWith("/prompt-search", expect.objectContaining({ query: "hello" }));
  expect(deps.client.post).toHaveBeenCalledWith("/ingest", expect.objectContaining({ messages: expect.any(Array) }));
  expect(deps.client.post).toHaveBeenCalledWith("/compact", expect.objectContaining({ skip_ingest: true }));
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/adapters/codex.test.ts --reporter=verbose`
Expected: FAIL because the session runner does not exist yet.

- [ ] **Step 3: Implement the runner in `src/adapters/codex.ts`**

Add:
- `type LosslessCodexSession = { lcmSessionId: string; codexSessionId?: string; cwd: string; restoreLoaded: boolean }`
- `runLosslessCodexTurn(session, userPrompt, deps)` that:
  - resolves the installed `lossless-claude` binary via `resolveBinaryPath()` or an equivalent helper
  - calls `ensureDaemon()` with an explicit spawn target that resolves to `lossless-claude daemon start`
  - calls `/restore` once per wrapper session
  - calls `/prompt-search` on every turn
  - builds the effective prompt with `composeCodexTurnPrompt()`
  - spawns `codex exec --json` on the first turn
  - spawns `codex exec resume <native-id> --json` on later turns only when `codexSessionId` is known
  - captures JSONL stdout, normalizes it to `ParsedMessage[]`, posts to `/ingest`, then posts to `/compact` with `skip_ingest: true`
  - if daemon startup or daemon calls fail, skips memory calls and still runs Codex with the raw user prompt
  - if the Codex child exits non-zero or the JSONL stream is incomplete, does not ingest partial output

Native resume resolution is best-effort:
- first, parse a native session ID from the JSONL stream if the committed fixture proves one is available
- if no stable ID is available, keep `session.codexSessionId` undefined and continue with fresh `codex exec --json` turns
- do **not** make `~/.codex/sessions` scanning a correctness requirement for the first cut

- [ ] **Step 4: Add the binary and package it**

Create `bin/lossless-codex.ts` as a thin REPL wrapper:

```ts
#!/usr/bin/env node
// create one LCM session per wrapper process
// accept argv[2] as the first prompt when present
// otherwise enter a readline/promises loop
// preserve the same LosslessCodexSession across turns
// forward SIGINT/SIGTERM to any active Codex child, then exit cleanly
// on Codex failure, print stderr and skip ingest/compact for that partial turn
```

Update `package.json`:

```json
"bin": {
  "lossless-claude": "dist/bin/lossless-claude.js",
  "lossless-codex": "dist/bin/lossless-codex.js"
}
```

- [ ] **Step 5: Run tests to verify they pass and commit**

Run: `npx vitest run test/adapters/codex.test.ts --reporter=verbose`
Expected: PASS.

```bash
git add src/adapters/codex.ts bin/lossless-codex.ts package.json test/adapters/codex.test.ts
git commit -m "feat: add lossless-codex session runner"
```

---

### Task 6: Docs and release notes

**Files:**
- Modify: `README.md`
- Create: `.changeset/lossless-codex.md`

- [ ] **Step 1: Update README for Codex support**

Add to `README.md`:
- a short paragraph near the top that the backend now supports both Claude Code and Codex
- a new install/usage subsection for `lossless-codex`
- a CLI entry for `lossless-codex`
- one architecture note: Claude still uses hook + transcript ingestion, Codex uses live structured ingestion through the wrapper

Use wording like:

```md
`lossless-codex` wraps `codex exec` and opportunistically uses `codex exec resume` when a native Codex session ID is available, giving Codex the same shared project memory model used by multiple Claude sessions.
```

- [ ] **Step 2: Add a changeset**

Create `.changeset/lossless-codex.md`:

```md
---
"@ipedro/lossless-claude": minor
---

Add `lossless-codex`, a Codex wrapper that shares the LCM project database and promoted memory with Claude Code sessions.
```

- [ ] **Step 3: Run lightweight packaging verification**

Run: `npm pack --dry-run`
Expected: the packed file list includes `dist/bin/lossless-codex.js` after build and the updated `README.md`.

- [ ] **Step 4: Review README copy for scope accuracy**

Check that README does **not** claim:
- Codex reuses Claude hooks
- `src/transcript.ts` parses Codex sessions
- the wrapper injects Claude-only tags such as `<system-reminder>`

- [ ] **Step 5: Commit**

```bash
git add README.md .changeset/lossless-codex.md
git commit -m "docs: document lossless-codex support"
```

---

### Task 7: End-to-end verification

**Files:**
- Test: `test/daemon/routes/ingest.test.ts`
- Test: `test/daemon/routes/compact.test.ts`
- Test: `test/daemon/lifecycle.test.ts`
- Test: `test/adapters/codex.test.ts`
- Reference: `bin/lossless-codex.ts`

- [ ] **Step 1: Run focused automated tests**

Run:

```bash
npx vitest run \
  test/daemon/routes/ingest.test.ts \
  test/daemon/routes/compact.test.ts \
  test/daemon/lifecycle.test.ts \
  test/adapters/codex.test.ts \
  --reporter=verbose
```

Expected: PASS.

- [ ] **Step 2: Run nearby regression tests**

Run:

```bash
npx vitest run \
  test/daemon/routes/restore.test.ts \
  test/daemon/routes/prompt-search.test.ts \
  test/daemon/routes/search.test.ts \
  test/mcp/server.test.ts \
  --reporter=verbose
```

Expected: PASS.

- [ ] **Step 3: Run typecheck and build**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit `0`.

- [ ] **Step 4: Manual smoke test with a real Codex session**

Run:

```bash
node dist/bin/lossless-codex.js "Reply only with OK"
```

Verify:
- output is the assistant’s final reply
- `~/.lossless-claude/projects/<hash>/db.sqlite` has a new conversation for a `codex-...` session
- a second prompt in the same wrapper process uses the same `codex-...` LCM session
- if native Codex session resolution is available, the second prompt uses `codex exec resume`
- if native Codex session resolution is unavailable, the second prompt still succeeds via a fresh `codex exec --json` call plus LCM restore/prompt-search memory
- the daemon receives `/compact` with `skip_ingest: true`
- if the daemon is intentionally stopped, the wrapper still runs Codex without memory instead of aborting

If Codex auth/network is unavailable, stop after automated tests and note that the manual smoke test is pending.

- [ ] **Step 5: Final cleanliness check**

Run: `git status --short`
Expected: clean working tree.
