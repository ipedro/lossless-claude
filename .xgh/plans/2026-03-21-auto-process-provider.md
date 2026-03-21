# Auto Process Provider Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `auto` provider resolution plus a new `codex-process` summarizer so Claude defaults to `claude-process`, Codex defaults to `codex-process`, and explicit provider overrides still apply globally.

**Architecture:** Keep caller identity contained in the compact route. Extend `/compact` with optional `client`, resolve the effective provider per request when `llm.provider === "auto"`, and memoize concrete summarizers by provider. Add a subprocess-backed `codex-process` provider parallel to `claude-process`, while installer, doctor, status, and docs present `auto` as the default user-facing mode.

**Tech Stack:** TypeScript, Vitest, Node `child_process`, Codex CLI, Claude CLI, lossless-claude daemon

**Spec:** `.xgh/specs/2026-03-21-auto-process-provider-design.md`

---

## Guardrails

- Do not thread caller identity into `LcmSummarizeFn` or `SummarizeContext`; keep `client` local to the route layer.
- Do not remove explicit `claude-process` or `codex-process` support. They remain valid pinned providers.
- `auto` must be backward-compatible: missing `client` resolves to `claude-process`.
- `codex-process` should use the real `codex exec` non-interactive contract, not the wrapper adapter or JSONL event normalization path.
- `lossless-codex` keeps using `/compact` and must only add `client: "codex"` to the existing request.
- Keep missing-binary errors user-friendly and aligned with the existing `lossless-codex` wording.

### Task 1: Config semantics for `auto` and `codex-process`

**Files:**
- Modify: `src/daemon/config.ts`
- Modify: `test/daemon/config.test.ts`

- [ ] **Step 1: Write failing config tests**

Add to `test/daemon/config.test.ts`:

```ts
it("defaults llm.provider to auto", () => {
  const c = loadDaemonConfig("/nonexistent/config.json");
  expect(c.llm.provider).toBe("auto");
});

it("accepts codex-process as a valid provider", () => {
  const c = loadDaemonConfig("/nonexistent", { llm: { provider: "codex-process" } });
  expect(c.llm.provider).toBe("codex-process");
});

it("accepts LCM_SUMMARY_PROVIDER=auto", () => {
  const c = loadDaemonConfig("/nonexistent", {}, { LCM_SUMMARY_PROVIDER: "auto" });
  expect(c.llm.provider).toBe("auto");
});

it("accepts LCM_SUMMARY_PROVIDER=codex-process", () => {
  const c = loadDaemonConfig("/nonexistent", {}, { LCM_SUMMARY_PROVIDER: "codex-process" });
  expect(c.llm.provider).toBe("codex-process");
});
```

Also update the current default-provider expectation from `claude-process` to `auto`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/daemon/config.test.ts --reporter=verbose`
Expected: FAIL because the provider union and defaults do not include `auto` or `codex-process`

- [ ] **Step 3: Implement config support**

In `src/daemon/config.ts`:

- Change the provider union:

```ts
llm: {
  provider: "auto" | "claude-process" | "codex-process" | "anthropic" | "openai" | "disabled";
  model: string;
  apiKey?: string;
  baseURL: string;
};
```

- Change `DEFAULTS.llm.provider` from `"claude-process"` to `"auto"`
- Extend `VALID_PROVIDERS` to include `"auto"` and `"codex-process"`
- Leave Anthropic API key validation unchanged: only `anthropic` requires `apiKey`

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/daemon/config.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/config.ts test/daemon/config.test.ts
git commit -m "feat: add auto and codex-process provider config"
```

---

### Task 2: `codex-process` subprocess summarizer

**Files:**
- Create: `src/llm/codex-process.ts`
- Create: `test/llm/codex-process.test.ts`
- Reference: `src/llm/claude-process.ts`

- [ ] **Step 1: Write failing provider tests**

Create `test/llm/codex-process.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { createCodexProcessSummarizer } from "../../src/llm/codex-process.js";

function makeChild(exitCode = 0, stdoutText = "", stderrText = "") {
  const child = new EventEmitter() as any;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.stdin = new PassThrough();
  child.kill = vi.fn();
  queueMicrotask(() => {
    if (stdoutText) child.stdout.write(stdoutText);
    if (stderrText) child.stderr.write(stderrText);
    child.stdout.end();
    child.stderr.end();
    child.emit("close", exitCode);
  });
  return child;
}

it("spawns codex exec with stdin prompt, read-only sandbox, and output-last-message", async () => {
  const spawnMock = vi.fn().mockReturnValue(makeChild(0));
  const readFileSync = vi.fn().mockReturnValue("summary text");
  const summarizer = createCodexProcessSummarizer({
    spawn: spawnMock,
    readFileSync,
    mkdtempSync: vi.fn().mockReturnValue("/tmp/lcm-codex-123"),
    rmSync: vi.fn(),
  } as any);

  await expect(summarizer("Conversation text", false)).resolves.toBe("summary text");

  expect(spawnMock).toHaveBeenCalledWith(
    "codex",
    expect.arrayContaining(["exec", "-", "--skip-git-repo-check", "--sandbox", "read-only", "--output-last-message"]),
    expect.anything(),
  );
});

it("passes --model when llm.model is configured", async () => {
  // createCodexProcessSummarizer({ model: "gpt-5.4", ... })
  // expect spawn args to contain ["--model", "gpt-5.4"]
});

it("returns a friendly error when codex is missing", async () => {
  const summarizer = createCodexProcessSummarizer({
    spawn: vi.fn(() => { throw Object.assign(new Error("spawn codex ENOENT"), { code: "ENOENT" }); }),
    readFileSync: vi.fn(),
    mkdtempSync: vi.fn(),
    rmSync: vi.fn(),
  } as any);

  await expect(summarizer("Conversation text", false)).rejects.toThrow("Codex CLI is not installed or not on PATH");
});

it("rejects on non-zero exit", async () => {
  // child closes with 1, stderr "boom"
});

it("rejects on empty output file", async () => {
  // readFileSync returns ""
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/llm/codex-process.test.ts --reporter=verbose`
Expected: FAIL because `src/llm/codex-process.ts` does not exist

- [ ] **Step 3: Implement `createCodexProcessSummarizer()`**

Create `src/llm/codex-process.ts` modeled on `src/llm/claude-process.ts` with injectable deps:

```ts
type CodexProcessDeps = {
  spawn?: typeof import("node:child_process").spawn;
  readFileSync?: typeof import("node:fs").readFileSync;
  mkdtempSync?: typeof import("node:fs").mkdtempSync;
  rmSync?: typeof import("node:fs").rmSync;
  tmpdir?: () => string;
  timeoutMs?: number;
  model?: string;
};
```

Implementation requirements:

- build the prompt using the existing LCM summary builders and `LCM_SUMMARIZER_SYSTEM_PROMPT`
- spawn `codex exec - --skip-git-repo-check --sandbox read-only --output-last-message <tmpfile>`
- add `--model <model>` when `opts.model` is non-empty
- write the prompt to stdin and end stdin
- read the summary from the output file on exit code `0`
- reject on timeout, missing binary, non-zero exit, or empty output
- clean up the temp directory in all cases

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/llm/codex-process.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/llm/codex-process.ts test/llm/codex-process.test.ts
git commit -m "feat: add codex-process summarizer"
```

---

### Task 3: Compact route `client` contract and auto resolution

**Files:**
- Modify: `src/daemon/routes/compact.ts`
- Modify: `test/daemon/routes/compact.test.ts`
- Reference: `src/llm/claude-process.ts`
- Reference: `src/llm/codex-process.ts`

- [ ] **Step 1: Write failing compact-route tests**

Extend `test/daemon/routes/compact.test.ts`:

```ts
vi.mock("../../../src/llm/claude-process.js", () => ({
  createClaudeProcessSummarizer: vi.fn().mockReturnValue(async () => "claude-process-summary"),
}));

vi.mock("../../../src/llm/codex-process.js", () => ({
  createCodexProcessSummarizer: vi.fn().mockReturnValue(async () => "codex-process-summary"),
}));

it("auto + client=claude resolves to claude-process", async () => {
  vi.clearAllMocks();
  const handler = createCompactHandler(makeConfig("auto" as any));
  const { res } = mockRes();
  await handler({} as any, res, JSON.stringify({ session_id: "s1", cwd: "/tmp/test", client: "claude" }));
  expect(createClaudeProcessSummarizer).toHaveBeenCalled();
  expect(createCodexProcessSummarizer).not.toHaveBeenCalled();
});

it("auto + client=codex resolves to codex-process", async () => {
  vi.clearAllMocks();
  const handler = createCompactHandler(makeConfig("auto" as any));
  const { res } = mockRes();
  await handler({} as any, res, JSON.stringify({ session_id: "s1", cwd: "/tmp/test", client: "codex" }));
  expect(createCodexProcessSummarizer).toHaveBeenCalled();
  expect(createClaudeProcessSummarizer).not.toHaveBeenCalled();
});

it("auto + no client falls back to claude-process", async () => {
  vi.clearAllMocks();
  const handler = createCompactHandler(makeConfig("auto" as any));
  const { res } = mockRes();
  await handler({} as any, res, JSON.stringify({ session_id: "s1", cwd: "/tmp/test" }));
  expect(createClaudeProcessSummarizer).toHaveBeenCalled();
});

it("explicit provider ignores client", async () => {
  vi.clearAllMocks();
  const handler = createCompactHandler(makeConfig("openai"));
  const { res } = mockRes();
  await handler({} as any, res, JSON.stringify({ session_id: "s1", cwd: "/tmp/test", client: "codex" }));
  expect(createOpenAISummarizer).toHaveBeenCalled();
  expect(createCodexProcessSummarizer).not.toHaveBeenCalled();
});
```

Also add a memoization test:

```ts
it("memoizes concrete providers across requests", async () => {
  vi.clearAllMocks();
  const handler = createCompactHandler(makeConfig("auto" as any));
  const { res: res1 } = mockRes();
  const { res: res2 } = mockRes();
  await handler({} as any, res1, JSON.stringify({ session_id: "s1", cwd: "/tmp/test", client: "codex" }));
  await handler({} as any, res2, JSON.stringify({ session_id: "s2", cwd: "/tmp/test", client: "codex" }));
  expect(createCodexProcessSummarizer).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/daemon/routes/compact.test.ts --reporter=verbose`
Expected: FAIL because `auto`, `client`, and `codex-process` are not supported

- [ ] **Step 3: Implement route-level effective-provider resolution**

In `src/daemon/routes/compact.ts`:

1. Add:

```ts
type CompactClient = "claude" | "codex";
type ConcreteProvider = "claude-process" | "codex-process" | "anthropic" | "openai" | "disabled";
```

2. Add helper:

```ts
function resolveEffectiveProvider(
  provider: DaemonConfig["llm"]["provider"],
  client?: CompactClient,
): ConcreteProvider {
  if (provider !== "auto") return provider;
  return client === "codex" ? "codex-process" : "claude-process";
}
```

3. Replace the eager `const summarizeP = resolveSummarizer(config);` path with a cache map:

```ts
const summarizerCache = new Map<ConcreteProvider, Promise<any>>();
```

4. Resolve inside the handler using `input.client`
5. Add a `codex-process` branch to the summarizer factory that imports `../../llm/codex-process.js`
6. Preserve existing disabled/openai/anthropic/claude-process behavior

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/daemon/routes/compact.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/routes/compact.ts test/daemon/routes/compact.test.ts
git commit -m "feat: resolve auto summarizer provider per compact request"
```

---

### Task 4: Claude and Codex callers send `client`

**Files:**
- Modify: `src/hooks/compact.ts`
- Modify: `src/adapters/codex.ts`
- Modify: `test/adapters/codex.test.ts`
- Add or modify: `test/hooks/compact.test.ts` if absent; otherwise use route/client posting tests near existing hook coverage

- [ ] **Step 1: Write failing caller tests**

In `test/adapters/codex.test.ts`, tighten the current compact assertion:

```ts
expect(deps.client.post).toHaveBeenCalledWith(
  "/compact",
  expect.objectContaining({ skip_ingest: true, client: "codex" }),
);
```

Add a hook-side test for `handlePreCompact()`:

```ts
import { handlePreCompact } from "../../src/hooks/compact.js";
import { DaemonClient } from "../../src/daemon/client.js";

it("posts client=claude on compact hook requests", async () => {
  const client = { post: vi.fn().mockResolvedValue({ summary: "ok" }) } as unknown as DaemonClient;
  const stdin = JSON.stringify({ session_id: "s1", cwd: "/tmp/project" });
  await handlePreCompact(stdin, client, 3737);
  expect(client.post).toHaveBeenCalledWith(
    "/compact",
    expect.objectContaining({ client: "claude" }),
  );
});
```

Mock `ensureDaemon()` as needed, matching the existing hook test style.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run test/adapters/codex.test.ts test/hooks/compact.test.ts --reporter=verbose
```

Expected: FAIL because neither caller sends `client`

- [ ] **Step 3: Implement caller updates**

In `src/hooks/compact.ts`:

```ts
const input = JSON.parse(stdin || "{}");
const result = await client.post<{ summary: string }>("/compact", {
  ...input,
  client: "claude",
});
```

In `src/adapters/codex.ts`, update the `/compact` post body:

```ts
await deps.client.post("/compact", {
  session_id: session.lcmSessionId,
  cwd: session.cwd,
  skip_ingest: true,
  client: "codex",
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run test/adapters/codex.test.ts test/hooks/compact.test.ts --reporter=verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/hooks/compact.ts src/adapters/codex.ts test/adapters/codex.test.ts test/hooks/compact.test.ts
git commit -m "feat: send compact client identity from claude and codex callers"
```

---

### Task 5: Installer defaults and user-facing semantics

**Files:**
- Modify: `installer/install.ts`
- Modify: `test/installer/install.test.ts`
- Modify: `README.md`
- Modify: `docs/configuration.md`

- [ ] **Step 1: Write failing installer tests**

Update `test/installer/install.test.ts` expectations:

- non-TTY install writes `provider=auto`
- option 1 writes `provider=auto`
- invalid input fallback writes `provider=auto`
- rename the stale test wording from `claude-cli`/`claude-process` default to `auto`

Add one new docs-visible regression in test names:

```ts
it("option 1 (native CLI default): writes provider=auto to config.json", async () => {
  // same structure as existing option 1 test
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run test/installer/install.test.ts --reporter=verbose`
Expected: FAIL because installer still writes `claude-process`

- [ ] **Step 3: Implement installer default and copy changes**

In `installer/install.ts`:

- change the default/non-TTY written provider to `"auto"`
- change picker option 1 copy from Claude-only language to native CLI default language
- leave Anthropic and custom OpenAI server flows explicit

Then update docs:

- [README.md](/Users/pedro/Developer/lossless-claude/README.md)
- [docs/configuration.md](/Users/pedro/Developer/lossless-claude/docs/configuration.md)

Required doc fixes:

- document `auto` as the default provider
- explain:
  - Claude -> `claude-process`
  - Codex -> `codex-process`
  - explicit override applies to both
- fix naming drift: replace stale `claude-cli` default wording with `claude-process` or `auto` as appropriate

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run test/installer/install.test.ts --reporter=verbose`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add installer/install.ts test/installer/install.test.ts README.md docs/configuration.md
git commit -m "docs: make auto the default summarizer mode"
```

---

### Task 6: Doctor and status updates for `auto`

**Files:**
- Modify: `src/doctor/doctor.ts`
- Modify: `test/doctor/doctor-hooks.test.ts`
- Add or modify: `test/doctor/doctor.test.ts`
- Modify: `bin/lossless-claude.ts`

- [ ] **Step 1: Write failing doctor/status tests**

Add to doctor tests:

```ts
it("reports auto mode as claude and codex process defaults", async () => {
  const results = await runDoctor({
    existsSync: () => true,
    readFileSync: (p: string) => {
      if (p.endsWith("config.json")) return JSON.stringify({ llm: { provider: "auto" } });
      if (p.endsWith("settings.json")) return JSON.stringify({ hooks: {}, mcpServers: {} });
      if (p.endsWith("package.json")) return JSON.stringify({ version: "0.5.0" });
      return "{}";
    },
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    spawnSync: vi.fn((cmd: string, args: string[]) => {
      if (cmd === "sh" && args[1].includes("command -v claude")) return { status: 0, stdout: "/usr/bin/claude", stderr: "" };
      if (cmd === "sh" && args[1].includes("command -v codex")) return { status: 0, stdout: "/usr/bin/codex", stderr: "" };
      return { status: 0, stdout: "", stderr: "" };
    }),
    fetch: vi.fn().mockResolvedValue({ ok: false }),
    homedir: "/tmp/test-home",
    platform: "darwin",
  });

  expect(results.find(r => r.name === "stack")?.message).toContain("auto");
  expect(results.some(r => r.name === "claude-process")).toBe(true);
  expect(results.some(r => r.name === "codex-process")).toBe(true);
});
```

Add a status test if none exists nearby; otherwise use a CLI smoke assertion pattern to verify `lossless-claude status` reports `provider: auto`.

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npx vitest run test/doctor/doctor-hooks.test.ts test/doctor/doctor.test.ts --reporter=verbose
```

Expected: FAIL because doctor only understands `claude-cli`/Anthropic naming and does not check Codex

- [ ] **Step 3: Implement doctor and status behavior**

In `src/doctor/doctor.ts`:

- accept `auto` as a configured summarizer mode
- when `config.summarizer === "auto"`:
  - add checks for both `claude` and `codex`
  - name them distinctly, e.g. `claude-process` and `codex-process`
  - show stack line as `Summarizer: auto (Claude->claude-process, Codex->codex-process)`
- preserve explicit-provider behavior
- fix the stale `claude-cli` branch name to `claude-process`

In `bin/lossless-claude.ts`, update the `status` branch so `provider` output does not imply `claude-process` is the universal default when config says `auto`.

- [ ] **Step 4: Run tests to verify they pass**

Run:

```bash
npx vitest run test/doctor/doctor-hooks.test.ts test/doctor/doctor.test.ts --reporter=verbose
```

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/doctor/doctor.ts bin/lossless-claude.ts test/doctor/doctor-hooks.test.ts test/doctor/doctor.test.ts
git commit -m "feat: teach doctor and status about auto process providers"
```

---

### Task 7: Full verification

**Files:**
- Test: `test/daemon/config.test.ts`
- Test: `test/llm/codex-process.test.ts`
- Test: `test/daemon/routes/compact.test.ts`
- Test: `test/adapters/codex.test.ts`
- Test: `test/hooks/compact.test.ts`
- Test: `test/installer/install.test.ts`
- Test: `test/doctor/doctor-hooks.test.ts`
- Test: `test/doctor/doctor.test.ts`

- [ ] **Step 1: Run focused automated tests**

Run:

```bash
npx vitest run \
  test/daemon/config.test.ts \
  test/llm/codex-process.test.ts \
  test/daemon/routes/compact.test.ts \
  test/adapters/codex.test.ts \
  test/hooks/compact.test.ts \
  test/installer/install.test.ts \
  test/doctor/doctor-hooks.test.ts \
  test/doctor/doctor.test.ts \
  --reporter=verbose
```

Expected: PASS

- [ ] **Step 2: Run nearby regression tests**

Run:

```bash
npx vitest run \
  test/daemon/routes/ingest.test.ts \
  test/daemon/lifecycle.test.ts \
  test/daemon/routes/restore.test.ts \
  test/daemon/routes/prompt-search.test.ts \
  test/mcp/server.test.ts \
  --reporter=verbose
```

Expected: PASS

- [ ] **Step 3: Run typecheck and build**

Run:

```bash
npm run typecheck
npm run build
```

Expected: both commands exit `0`

- [ ] **Step 4: Manual smoke checks**

Run:

```bash
lossless-claude status
node dist/bin/lossless-codex.js "Reply only with OK"
PATH="/nonexistent" "$(command -v node)" dist/bin/lossless-codex.js "Reply only with OK"
```

Verify:

- status reports `provider: auto` when config is defaulted
- normal `lossless-codex` execution still succeeds
- missing Codex binary still emits the friendly setup message

- [ ] **Step 5: Commit final verification or follow-up fixes**

If verification changes are required:

```bash
git add <affected files>
git commit -m "fix: complete auto process provider rollout"
```

If no follow-up changes are needed, do not create an extra commit.
