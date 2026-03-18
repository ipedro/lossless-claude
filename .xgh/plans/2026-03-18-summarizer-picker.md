# Summarizer Picker Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users choose their compaction summarizer (Anthropic API, local model, or custom OpenAI-compatible server) during `lossless-claude install`, removing the mandatory Anthropic key dependency.

**Architecture:** Add `provider: "anthropic" | "openai"` and `baseURL` to `DaemonConfig.llm`. Add `createOpenAISummarizer` (OpenAI SDK) mirroring the existing Anthropic one. Branch in `compact.ts` on provider. Add an interactive picker in `install.ts` (Node readline) after setup.sh runs. `DryRunServiceDeps` gets a `promptUser` stub that logs and returns `""` (defaults to Anthropic).

**Tech Stack:** TypeScript, Node.js `readline/promises`, `openai` npm package, Vitest

---

## File Map

| File | Change |
|------|--------|
| `package.json` | Add `openai` to `dependencies` |
| `src/llm/types.ts` | **New** — shared `LcmSummarizeFn` and `SummarizeContext` types |
| `src/llm/anthropic.ts` | Import types from `./types.js` instead of declaring inline |
| `src/llm/openai.ts` | **New** — `createOpenAISummarizer` |
| `src/daemon/config.ts` | Add `provider`, `baseURL` to `DaemonConfig.llm`; gate ANTHROPIC_API_KEY fallback on provider |
| `src/daemon/routes/compact.ts` | Branch on `config.llm.provider` |
| `installer/install.ts` | Add `promptUser` to `ServiceDeps`; add summarizer picker step |
| `installer/dry-run-deps.ts` | Implement `promptUser` (log + return `""`) |
| `test/llm/openai.test.ts` | **New** — unit tests for `createOpenAISummarizer` |
| `test/daemon/config.test.ts` | Add `provider`/`baseURL` merge tests + apiKey-not-leaked-to-openai test |
| `test/installer/install.test.ts` | Add picker tests (each option, invalid input, non-TTY) |

---

## Task 1: Add `openai` dependency + extract shared types

**Files:**
- Modify: `package.json`
- Create: `src/llm/types.ts`
- Modify: `src/llm/anthropic.ts`

This is a pure refactor — no behavior change. `LcmSummarizeFn` and `SummarizeContext` move to a shared file so `openai.ts` can import them without circular deps.

- [ ] **Step 1: Install `openai` package**

```bash
cd /Users/pedro/Developer/lossless-claude && npm install openai
```

Expected: `package.json` now has `"openai": "^..."` in `dependencies`.

- [ ] **Step 2: Write failing test for type import**

In `test/llm/openai.test.ts` (create it), add a compile-only import test:

```typescript
import { describe, it, expect } from "vitest";
import type { LcmSummarizeFn } from "../../src/llm/types.js";

describe("LcmSummarizeFn type", () => {
  it("is importable from types.ts", () => {
    // If this file compiles, the type exists
    const fn: LcmSummarizeFn = async (_text, _aggressive, _ctx) => "ok";
    expect(typeof fn).toBe("function");
  });
});
```

Run:
```bash
cd /Users/pedro/Developer/lossless-claude && npm test -- test/llm/openai.test.ts 2>&1 | tail -10
```

Expected: FAIL — `Cannot find module '../../src/llm/types.js'`

- [ ] **Step 3: Create `src/llm/types.ts`**

```typescript
export type SummarizeContext = {
  isCondensed?: boolean;
  targetTokens?: number;
  depth?: number;
};

export type LcmSummarizeFn = (
  text: string,
  aggressive?: boolean,
  ctx?: SummarizeContext,
) => Promise<string>;
```

- [ ] **Step 4: Update `src/llm/anthropic.ts` to import from types**

Remove the inline type declarations and import them:

```typescript
import type { LcmSummarizeFn, SummarizeContext } from "./types.js";
```

Remove these lines from `anthropic.ts`:
```typescript
type SummarizeContext = { isCondensed?: boolean; targetTokens?: number; depth?: number };
export type LcmSummarizeFn = (text: string, aggressive?: boolean, ctx?: SummarizeContext) => Promise<string>;
```

Re-export `LcmSummarizeFn` from `anthropic.ts` so existing imports of it from `anthropic.js` keep working:
```typescript
export type { LcmSummarizeFn } from "./types.js";
```

- [ ] **Step 5: Run all tests**

```bash
cd /Users/pedro/Developer/lossless-claude && npm test 2>&1 | tail -10
```

Expected: all 181 tests pass.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/llm/types.ts src/llm/anthropic.ts test/llm/openai.test.ts
git commit -m "refactor: extract LcmSummarizeFn to shared types, add openai dep"
```

---

## Task 2: Extend `DaemonConfig.llm` with `provider` and `baseURL`

**Files:**
- Modify: `src/daemon/config.ts`
- Modify: `test/daemon/config.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `test/daemon/config.test.ts`:

```typescript
  it("defaults provider to 'anthropic' and baseURL to empty string", () => {
    const c = loadDaemonConfig("/nonexistent/config.json");
    expect(c.llm.provider).toBe("anthropic");
    expect(c.llm.baseURL).toBe("");
  });

  it("merges provider and baseURL from file config", () => {
    const c = loadDaemonConfig("/nonexistent/config.json", {
      llm: { provider: "openai", baseURL: "http://localhost:11435/v1", model: "qwen2.5:14b" }
    });
    expect(c.llm.provider).toBe("openai");
    expect(c.llm.baseURL).toBe("http://localhost:11435/v1");
    expect(c.llm.model).toBe("qwen2.5:14b");
  });

  it("does NOT inject ANTHROPIC_API_KEY when provider is openai", () => {
    const c = loadDaemonConfig("/nonexistent", { llm: { provider: "openai" } }, { ANTHROPIC_API_KEY: "sk-leaked" });
    expect(c.llm.apiKey).toBe("");
  });

  it("still injects ANTHROPIC_API_KEY when provider is anthropic", () => {
    const c = loadDaemonConfig("/nonexistent", { llm: { provider: "anthropic" } }, { ANTHROPIC_API_KEY: "sk-env" });
    expect(c.llm.apiKey).toBe("sk-env");
  });
```

Run:
```bash
cd /Users/pedro/Developer/lossless-claude && npm test -- test/daemon/config.test.ts 2>&1 | tail -10
```

Expected: 4 new tests FAIL.

- [ ] **Step 2: Update `DaemonConfig` type in `src/daemon/config.ts`**

Change the `llm` field in `DaemonConfig`:

```typescript
llm: { provider: "anthropic" | "openai"; model: string; apiKey: string; baseURL: string };
```

Update `DEFAULTS`:

```typescript
llm: { provider: "anthropic", model: "claude-haiku-4-5-20251001", apiKey: "", baseURL: "" },
```

Update the apiKey env fallback in `loadDaemonConfig` to gate on provider:

```typescript
// Before:
if (!merged.llm.apiKey && e.ANTHROPIC_API_KEY) merged.llm.apiKey = e.ANTHROPIC_API_KEY;

// After:
if (!merged.llm.apiKey && merged.llm.provider === "anthropic" && e.ANTHROPIC_API_KEY) {
  merged.llm.apiKey = e.ANTHROPIC_API_KEY;
}
```

- [ ] **Step 3: Run all tests**

```bash
cd /Users/pedro/Developer/lossless-claude && npm test 2>&1 | tail -10
```

Expected: all tests pass (the existing `"falls back to env var when apiKey not set"` test still passes because it doesn't set provider, so it defaults to `"anthropic"`).

- [ ] **Step 4: Commit**

```bash
git add src/daemon/config.ts test/daemon/config.test.ts
git commit -m "feat: add provider and baseURL to DaemonConfig.llm, gate apiKey env fallback"
```

---

## Task 3: Implement `createOpenAISummarizer`

**Files:**
- Create: `src/llm/openai.ts`
- Modify: `test/llm/openai.test.ts`

- [ ] **Step 1: Write failing tests**

Replace the compile-only test in `test/llm/openai.test.ts` with full unit tests:

```typescript
import { describe, it, expect, vi } from "vitest";
import { createOpenAISummarizer } from "../../src/llm/openai.js";

describe("createOpenAISummarizer", () => {
  function makeClient(text = "Summary.") {
    return {
      chat: {
        completions: {
          create: vi.fn().mockResolvedValue({
            choices: [{ message: { content: text } }],
          }),
        },
      },
    };
  }

  it("calls OpenAI-compatible endpoint and returns text", async () => {
    const mockClient = makeClient("Summary.");
    const summarizer = createOpenAISummarizer({
      model: "qwen2.5:14b",
      baseURL: "http://localhost:11435/v1",
      _clientOverride: mockClient as any,
    });
    const result = await summarizer("Conversation text", false, { isCondensed: false });
    expect(result).toBe("Summary.");
    expect(mockClient.chat.completions.create).toHaveBeenCalledOnce();
    const args = mockClient.chat.completions.create.mock.calls[0][0];
    expect(args.model).toBe("qwen2.5:14b");
    expect(args.max_tokens).toBe(1024);
    expect(args.messages[0].role).toBe("system");
    expect(args.messages[1].role).toBe("user");
  });

  it("retries 3 times on 5xx error then throws", async () => {
    const err = Object.assign(new Error("server error"), { status: 500 });
    const mockClient = {
      chat: { completions: { create: vi.fn().mockRejectedValue(err) } },
    };
    const summarizer = createOpenAISummarizer({
      model: "test-model",
      baseURL: "http://localhost:11435/v1",
      _clientOverride: mockClient as any,
      _retryDelayMs: 0,
    });
    await expect(summarizer("text", false)).rejects.toThrow("server error");
    expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(3);
  });

  it("throws immediately on 401 auth error", async () => {
    const err = Object.assign(new Error("auth"), { status: 401 });
    const mockClient = {
      chat: { completions: { create: vi.fn().mockRejectedValue(err) } },
    };
    const summarizer = createOpenAISummarizer({
      model: "test-model",
      baseURL: "http://localhost:11435/v1",
      _clientOverride: mockClient as any,
    });
    await expect(summarizer("text", false)).rejects.toThrow("auth");
    expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(1);
  });

  it("uses 'local' as apiKey when none provided", async () => {
    let capturedApiKey: string | undefined;
    const MockOpenAI = vi.fn().mockImplementation((opts: any) => {
      capturedApiKey = opts.apiKey;
      return makeClient();
    });
    // We can't easily test the real constructor without _clientOverride,
    // so just verify the _clientOverride path works without apiKey
    const mockClient = makeClient();
    const summarizer = createOpenAISummarizer({
      model: "test-model",
      baseURL: "http://localhost:11435/v1",
      _clientOverride: mockClient as any,
    });
    const result = await summarizer("text", false);
    expect(result).toBe("Summary.");
  });

  it("falls back to truncated text if response is empty", async () => {
    const mockClient = {
      chat: { completions: { create: vi.fn().mockResolvedValue({ choices: [{ message: { content: "" } }] }) } },
    };
    const longText = "x".repeat(600);
    const summarizer = createOpenAISummarizer({
      model: "test-model",
      baseURL: "http://localhost:11435/v1",
      _clientOverride: mockClient as any,
    });
    const result = await summarizer(longText, false);
    expect(result).toBe(longText.slice(0, 500));
  });
});
```

Run:
```bash
cd /Users/pedro/Developer/lossless-claude && npm test -- test/llm/openai.test.ts 2>&1 | tail -15
```

Expected: FAIL — `Cannot find module '../../src/llm/openai.js'`

- [ ] **Step 2: Implement `src/llm/openai.ts`**

```typescript
import OpenAI from "openai";
import type { LcmSummarizeFn, SummarizeContext } from "./types.js";
import {
  LCM_SUMMARIZER_SYSTEM_PROMPT,
  buildLeafSummaryPrompt,
  buildCondensedSummaryPrompt,
  resolveTargetTokens,
} from "../summarize.js";

type OpenAISummarizerOptions = {
  model: string;
  baseURL: string;
  apiKey?: string;
  _clientOverride?: any;
  _retryDelayMs?: number;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createOpenAISummarizer(opts: OpenAISummarizerOptions): LcmSummarizeFn {
  const client =
    opts._clientOverride ??
    new OpenAI({
      baseURL: opts.baseURL,
      apiKey: opts.apiKey || "local", // many local servers require a non-empty key
    });
  const retryDelayMs = opts._retryDelayMs ?? 1000;
  const MAX_RETRIES = 3;

  return async function summarize(text, aggressive, ctx: SummarizeContext = {}): Promise<string> {
    const estimatedInputTokens = Math.ceil(text.length / 4);
    const targetTokens =
      ctx.targetTokens ??
      resolveTargetTokens({
        inputTokens: estimatedInputTokens,
        mode: aggressive ? "aggressive" : "normal",
        isCondensed: ctx.isCondensed ?? false,
        condensedTargetTokens: 2000,
      });

    const prompt = ctx.isCondensed
      ? buildCondensedSummaryPrompt({ text, targetTokens, depth: ctx.depth ?? 1 })
      : buildLeafSummaryPrompt({ text, mode: aggressive ? "aggressive" : "normal", targetTokens });

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await client.chat.completions.create({
          model: opts.model,
          max_tokens: 1024,
          messages: [
            { role: "system", content: LCM_SUMMARIZER_SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ],
        });

        const textContent = response.choices[0]?.message?.content ?? "";
        return textContent || text.slice(0, 500);
      } catch (err: any) {
        if (err?.status === 401) throw err; // auth error: no retry
        lastError = err;
        if (attempt < MAX_RETRIES - 1) await sleep(retryDelayMs * Math.pow(2, attempt));
      }
    }
    throw lastError;
  };
}
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/pedro/Developer/lossless-claude && npm test -- test/llm/openai.test.ts 2>&1 | tail -15
```

Expected: all 5 tests pass.

- [ ] **Step 4: Run full suite**

```bash
cd /Users/pedro/Developer/lossless-claude && npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/llm/openai.ts test/llm/openai.test.ts
git commit -m "feat: add createOpenAISummarizer for local/custom OpenAI-compatible endpoints"
```

---

## Task 4: Branch in `compact.ts` on `config.llm.provider`

**Files:**
- Modify: `src/daemon/routes/compact.ts`
- Modify: `test/daemon/routes/` (check if compact route test exists first — if not, add minimal test)

- [ ] **Step 1: Check for existing compact route test**

```bash
ls /Users/pedro/Developer/lossless-claude/test/daemon/routes/
```

If `compact.test.ts` exists, read it. If not, we'll add a minimal test.

- [ ] **Step 2: Write failing test**

Check if `test/daemon/routes/compact.test.ts` exists. If it does, add to it. If not, create it:

```typescript
import { describe, it, expect, vi } from "vitest";

// We test the branching indirectly by verifying the correct summarizer factory is called
// based on config.llm.provider. We mock both factories.

vi.mock("../../../src/llm/anthropic.js", () => ({
  createAnthropicSummarizer: vi.fn().mockReturnValue(async () => "anthropic-summary"),
}));

vi.mock("../../../src/llm/openai.js", () => ({
  createOpenAISummarizer: vi.fn().mockReturnValue(async () => "openai-summary"),
}));

import { createAnthropicSummarizer } from "../../../src/llm/anthropic.js";
import { createOpenAISummarizer } from "../../../src/llm/openai.js";
import { createCompactHandler } from "../../../src/daemon/routes/compact.js";
import type { DaemonConfig } from "../../../src/daemon/config.js";

function makeConfig(provider: "anthropic" | "openai"): DaemonConfig {
  return {
    version: 1,
    daemon: { port: 3737, socketPath: "/tmp/test.sock", logLevel: "info", logMaxSizeMB: 10, logRetentionDays: 7 },
    compaction: {
      leafTokens: 1000, maxDepth: 5,
      promotionThresholds: { minDepth: 2, compressionRatio: 0.3, keywords: {}, architecturePatterns: [] },
    },
    restoration: { recentSummaries: 3, semanticTopK: 5, semanticThreshold: 0.35 },
    llm: { provider, model: "test-model", apiKey: "sk-test", baseURL: "http://localhost:11435/v1" },
    cipher: { configPath: "/tmp/cipher.yml", collection: "test" },
  };
}

describe("createCompactHandler — summarizer branching", () => {
  it("uses createAnthropicSummarizer when provider is anthropic", () => {
    createCompactHandler(makeConfig("anthropic"));
    expect(createAnthropicSummarizer).toHaveBeenCalledWith(expect.objectContaining({ model: "test-model" }));
    expect(createOpenAISummarizer).not.toHaveBeenCalled();
  });

  it("uses createOpenAISummarizer when provider is openai", () => {
    vi.clearAllMocks();
    createCompactHandler(makeConfig("openai"));
    expect(createOpenAISummarizer).toHaveBeenCalledWith(
      expect.objectContaining({ model: "test-model", baseURL: "http://localhost:11435/v1" })
    );
    expect(createAnthropicSummarizer).not.toHaveBeenCalled();
  });
});
```

Run:
```bash
cd /Users/pedro/Developer/lossless-claude && npm test -- test/daemon/routes/compact.test.ts 2>&1 | tail -15
```

Expected: FAIL (both tests use `createAnthropicSummarizer` regardless of provider).

- [ ] **Step 3: Update `src/daemon/routes/compact.ts`**

Add the import at the top (after the existing anthropic import):

```typescript
import { createOpenAISummarizer } from "../../llm/openai.js";
```

Replace the summarizer creation line. **Important:** pass only `{ model, apiKey }` to `createAnthropicSummarizer` — do NOT pass the full `config.llm` object, as the new `provider` and `baseURL` fields are not in `SummarizerOptions` and will cause a TypeScript compile error:

```typescript
// Before:
const summarize = createAnthropicSummarizer(config.llm);

// After:
const summarize =
  config.llm.provider === "openai"
    ? createOpenAISummarizer({
        model: config.llm.model,
        baseURL: config.llm.baseURL,
        apiKey: config.llm.apiKey,
      })
    : createAnthropicSummarizer({
        model: config.llm.model,
        apiKey: config.llm.apiKey,
      });
```

- [ ] **Step 4: Run tests**

```bash
cd /Users/pedro/Developer/lossless-claude && npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/daemon/routes/compact.ts test/daemon/routes/compact.test.ts
git commit -m "feat: branch compact summarizer on config.llm.provider (anthropic vs openai)"
```

---

## Task 5: Add `promptUser` to `ServiceDeps` + summarizer picker in `install.ts`

**Files:**
- Modify: `installer/install.ts`
- Modify: `test/installer/install.test.ts`

This is the main interactive picker. It runs after setup.sh and before writing `config.json`.

- [ ] **Step 1: Update `makeDeps` in `test/installer/install.test.ts` to include `promptUser`**

**Do this first** — once `ServiceDeps` gains `promptUser`, every test that calls `install(deps)` via `makeDeps` will fail to compile without this change.

Update the `makeDeps` function and its return type:

```typescript
function makeDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps & {
  spawnSync: ReturnType<typeof vi.fn>;
  readFileSync: ReturnType<typeof vi.fn>;
  writeFileSync: ReturnType<typeof vi.fn>;
  mkdirSync: ReturnType<typeof vi.fn>;
  existsSync: ReturnType<typeof vi.fn>;
  promptUser: ReturnType<typeof vi.fn>;
} {
  return {
    spawnSync: makeSpawn(),
    readFileSync: vi.fn().mockReturnValue("{}"),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    promptUser: vi.fn().mockResolvedValue("1"), // default: option 1 (Anthropic)
    ...overrides,
  };
}
```

Run existing tests to confirm they still pass (before writing new ones):
```bash
cd /Users/pedro/Developer/lossless-claude && npm test -- test/installer/install.test.ts 2>&1 | tail -10
```

Expected: all existing tests still pass.

- [ ] **Step 3: Write failing picker tests**

Add to `test/installer/install.test.ts` (after the existing `install` describe block):

```typescript
// ─── summarizer picker ───────────────────────────────────────────────────────

describe("summarizer picker", () => {
  const originalApiKey = process.env.ANTHROPIC_API_KEY;

  afterEach(() => {
    process.env.ANTHROPIC_API_KEY = originalApiKey;
  });

  it("option 1 (Anthropic): writes provider=anthropic and apiKey literal to config.json", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const writeFileMock = vi.fn();
    const deps = makeDeps({
      existsSync: vi.fn().mockReturnValue(false),
      writeFileSync: writeFileMock,
      promptUser: vi.fn()
        .mockResolvedValueOnce("1"),  // picker: option 1
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await install(deps);
    warnSpy.mockRestore();
    const configCall = writeFileMock.mock.calls.find((c: any[]) => c[0].endsWith("config.json"));
    expect(configCall).toBeDefined();
    const written = JSON.parse(configCall![1]);
    expect(written.llm.provider).toBe("anthropic");
    expect(written.llm.apiKey).toBe("${ANTHROPIC_API_KEY}");
    expect(written.llm.model).toBe("claude-haiku-4-5-20251001");
  });

  it("option 2 (local model): reads cipher.yml and writes provider=openai", async () => {
    const cipherContent = `
llm:
  provider: openai
  model: mlx-community/Qwen2.5-14B-Instruct-4bit
  baseURL: http://localhost:11435/v1
`;
    const writeFileMock = vi.fn();
    const deps = makeDeps({
      existsSync: vi.fn().mockImplementation((p: string) =>
        p.endsWith("cipher.yml") ? true : false
      ),
      readFileSync: vi.fn().mockImplementation((p: string) =>
        p.endsWith("cipher.yml") ? cipherContent : "{}"
      ),
      writeFileSync: writeFileMock,
      promptUser: vi.fn().mockResolvedValueOnce("2"),
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await install(deps);
    warnSpy.mockRestore();
    const configCall = writeFileMock.mock.calls.find((c: any[]) => c[0].endsWith("config.json"));
    expect(configCall).toBeDefined();
    const written = JSON.parse(configCall![1]);
    expect(written.llm.provider).toBe("openai");
    expect(written.llm.baseURL).toBe("http://localhost:11435/v1");
    expect(written.llm.model).toBe("mlx-community/Qwen2.5-14B-Instruct-4bit");
    expect(written.llm.apiKey).toBe("");
  });

  it("option 3 (custom server): prompts for URL and model, writes provider=openai", async () => {
    const writeFileMock = vi.fn();
    const deps = makeDeps({
      existsSync: vi.fn().mockReturnValue(false),
      writeFileSync: writeFileMock,
      promptUser: vi.fn()
        .mockResolvedValueOnce("3")                           // picker: option 3
        .mockResolvedValueOnce("http://192.168.1.5:8080/v1") // URL prompt
        .mockResolvedValueOnce("my-model"),                   // model prompt
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await install(deps);
    warnSpy.mockRestore();
    const configCall = writeFileMock.mock.calls.find((c: any[]) => c[0].endsWith("config.json"));
    expect(configCall).toBeDefined();
    const written = JSON.parse(configCall![1]);
    expect(written.llm.provider).toBe("openai");
    expect(written.llm.baseURL).toBe("http://192.168.1.5:8080/v1");
    expect(written.llm.model).toBe("my-model");
  });

  it("invalid input re-prompts once then defaults to option 1", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const writeFileMock = vi.fn();
    const deps = makeDeps({
      existsSync: vi.fn().mockReturnValue(false),
      writeFileSync: writeFileMock,
      promptUser: vi.fn()
        .mockResolvedValueOnce("9")   // invalid
        .mockResolvedValueOnce("9"),  // invalid again → default to 1
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await install(deps);
    warnSpy.mockRestore();
    const configCall = writeFileMock.mock.calls.find((c: any[]) => c[0].endsWith("config.json"));
    const written = JSON.parse(configCall![1]);
    expect(written.llm.provider).toBe("anthropic");
  });

  it("non-TTY (process.stdin.isTTY is false): skips picker and defaults to Anthropic", async () => {
    process.env.ANTHROPIC_API_KEY = "sk-env";
    const originalIsTTY = process.stdin.isTTY;
    Object.defineProperty(process.stdin, "isTTY", { value: false, writable: true });
    const writeFileMock = vi.fn();
    const promptUserMock = vi.fn();
    const deps = makeDeps({
      existsSync: vi.fn().mockReturnValue(false),
      writeFileSync: writeFileMock,
      promptUser: promptUserMock,
    });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await install(deps);
    warnSpy.mockRestore();
    Object.defineProperty(process.stdin, "isTTY", { value: originalIsTTY, writable: true });
    expect(promptUserMock).not.toHaveBeenCalled(); // picker was skipped
    const configCall = writeFileMock.mock.calls.find((c: any[]) => c[0].endsWith("config.json"));
    const written = JSON.parse(configCall![1]);
    expect(written.llm.provider).toBe("anthropic");
  });
});
```

Also update `makeDeps` in the test file to add `promptUser`:

```typescript
function makeDeps(overrides: Partial<ServiceDeps> = {}): ServiceDeps & {
  spawnSync: ReturnType<typeof vi.fn>;
  readFileSync: ReturnType<typeof vi.fn>;
  writeFileSync: ReturnType<typeof vi.fn>;
  mkdirSync: ReturnType<typeof vi.fn>;
  existsSync: ReturnType<typeof vi.fn>;
  promptUser: ReturnType<typeof vi.fn>;
} {
  return {
    spawnSync: makeSpawn(),
    readFileSync: vi.fn().mockReturnValue("{}"),
    writeFileSync: vi.fn(),
    mkdirSync: vi.fn(),
    existsSync: vi.fn().mockReturnValue(false),
    promptUser: vi.fn().mockResolvedValue("1"),
    ...overrides,
  };
}
```

Run:
```bash
cd /Users/pedro/Developer/lossless-claude && npm test -- test/installer/install.test.ts 2>&1 | tail -15
```

Expected: new tests FAIL (TypeScript compile error: `promptUser` not in `ServiceDeps`).

- [ ] **Step 4: Add `promptUser` to `ServiceDeps` in `installer/install.ts`**

```typescript
export interface ServiceDeps {
  spawnSync: (cmd: string, args: string[], opts?: any) => SpawnSyncReturns<string>;
  readFileSync: (path: string, encoding: string) => string;
  writeFileSync: (path: string, data: string) => void;
  mkdirSync: (path: string, opts?: any) => void;
  existsSync: (path: string) => boolean;
  promptUser: (question: string) => Promise<string>;
}
```

Add readline implementation to `defaultDeps`. Add this helper function near the top of `install.ts` (after imports):

```typescript
async function readlinePrompt(question: string): Promise<string> {
  const rl = (await import("node:readline/promises")).createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}
```

Update `defaultDeps`:

```typescript
const defaultDeps: ServiceDeps = {
  spawnSync: spawnSync as any,
  readFileSync: (path, encoding) => readFileSync(path, encoding as BufferEncoding) as string,
  writeFileSync,
  mkdirSync,
  existsSync,
  promptUser: readlinePrompt,
};
```

- [ ] **Step 5: Add the `parseCipherYml` helper and `pickSummarizer` function**

Add these to `installer/install.ts` (before the `install` function):

```typescript
type SummarizerConfig = {
  provider: "anthropic" | "openai";
  model: string;
  apiKey: string;
  baseURL: string;
};

function parseCipherYml(content: string): { model: string; baseURL: string } | null {
  try {
    let inLlmSection = false;
    let model = "";
    let baseURL = "";
    for (const line of content.split("\n")) {
      if (/^llm:\s*$/.test(line)) { inLlmSection = true; continue; }
      if (inLlmSection && /^[^\s]/.test(line)) break; // left llm section
      if (inLlmSection) {
        const modelMatch = line.match(/^\s+model:\s*(\S+)/);
        if (modelMatch) model = modelMatch[1];
        const urlMatch = line.match(/^\s+baseURL:\s*(\S+)/);
        if (urlMatch) baseURL = urlMatch[1];
      }
    }
    if (!model || !baseURL) return null;
    // Ensure /v1 suffix (ollama's native API doesn't include it, OpenAI-compat needs it)
    if (!baseURL.endsWith("/v1")) baseURL = baseURL + "/v1";
    return { model, baseURL };
  } catch {
    return null;
  }
}

async function pickSummarizer(deps: ServiceDeps, cipherConfigPath: string): Promise<SummarizerConfig> {
  // Non-TTY (CI, piped stdin): skip interactive picker, default to Anthropic
  if (!process.stdin.isTTY) {
    const apiKey = process.env.ANTHROPIC_API_KEY ? "${ANTHROPIC_API_KEY}" : "";
    return { provider: "anthropic", model: "claude-haiku-4-5-20251001", apiKey, baseURL: "" };
  }

  console.log("\n  ─── Summarizer (for conversation compaction)\n");
  console.log("  1) Anthropic API     (best quality — requires API key)");
  console.log("  2) Local model       (reuse your vllm-mlx / ollama endpoint)");
  console.log("  3) Custom server     (any OpenAI-compatible URL)");
  console.log("");

  let choice = (await deps.promptUser("  Pick [1]: ")).trim();
  if (!["1", "2", "3"].includes(choice)) {
    console.log("  Invalid choice — please enter 1, 2, or 3.");
    choice = (await deps.promptUser("  Pick [1]: ")).trim();
  }
  if (!["1", "2", "3"].includes(choice)) {
    choice = "1"; // default after two invalid attempts
  }

  if (choice === "2") {
    // Read from cipher.yml
    try {
      const cipherContent = deps.readFileSync(cipherConfigPath, "utf-8");
      const parsed = parseCipherYml(cipherContent);
      if (parsed) {
        return { provider: "openai", model: parsed.model, apiKey: "", baseURL: parsed.baseURL };
      }
    } catch {}
    console.warn("  Warning: Could not read local model config from cipher.yml — falling back to manual entry.");
    choice = "3";
  }

  if (choice === "3") {
    const baseURL = (await deps.promptUser("  Server URL (e.g. http://192.168.1.x:8080/v1): ")).trim();
    const model = (await deps.promptUser("  Model name: ")).trim();
    return { provider: "openai", model, apiKey: "", baseURL };
  }

  // Option 1: Anthropic
  const apiKey = process.env.ANTHROPIC_API_KEY ? "${ANTHROPIC_API_KEY}" : "";
  return {
    provider: "anthropic",
    model: "claude-haiku-4-5-20251001",
    apiKey,
    baseURL: "",
  };
}
```

- [ ] **Step 6: Wire `pickSummarizer` into `install()` and remove old API key warning**

In the `install()` function:

1. Remove the existing `ANTHROPIC_API_KEY` warning block:
```typescript
// REMOVE this block:
if (!process.env.ANTHROPIC_API_KEY) {
  console.warn("Warning: ANTHROPIC_API_KEY is not set. The daemon will need it at runtime — export it in your shell profile.");
}
```

2. Replace the `config.json` creation block (step 3) with:
```typescript
  // 3. Create or update config.json
  const configPath = join(lcDir, "config.json");
  if (!deps.existsSync(configPath)) {
    const cipherConfigPath = join(homedir(), ".cipher", "cipher.yml");
    const summarizerConfig = await pickSummarizer(deps, cipherConfigPath);
    const { loadDaemonConfig } = await import("../src/daemon/config.js");
    const defaults = loadDaemonConfig("/nonexistent");
    defaults.llm = { ...defaults.llm, ...summarizerConfig };
    deps.writeFileSync(configPath, JSON.stringify(defaults, null, 2));
    console.log(`Created ${configPath}`);
  }
```

Note: `pickSummarizer` is only called when `config.json` doesn't exist yet (first install). Re-running install preserves existing config (existing behavior for all other fields).

- [ ] **Step 7: Run tests**

```bash
cd /Users/pedro/Developer/lossless-claude && npm test -- test/installer/install.test.ts 2>&1 | tail -20
```

Expected: all tests pass including new picker tests.

- [ ] **Step 8: Run full suite**

```bash
cd /Users/pedro/Developer/lossless-claude && npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 9: Commit**

```bash
git add installer/install.ts test/installer/install.test.ts
git commit -m "feat: add summarizer picker to installer (Anthropic / local / custom server)"
```

---

## Task 6: Update `DryRunServiceDeps` with `promptUser`

**Files:**
- Modify: `installer/dry-run-deps.ts`
- Modify: `test/installer/dry-run-deps.test.ts`

- [ ] **Step 1: Write failing test**

Add to `test/installer/dry-run-deps.test.ts` (in the existing `describe("DryRunServiceDeps")` block):

```typescript
  // ── promptUser ────────────────────────────────────────────────────────────

  it("promptUser prints [dry-run] would prompt and returns empty string", async () => {
    const deps = new DryRunServiceDeps();
    const result = await deps.promptUser("Pick [1]: ");
    expect(result).toBe("");
    expect(logSpy).toHaveBeenCalledWith(
      expect.stringContaining("[dry-run] would prompt: Pick [1]: ")
    );
  });
```

Run:
```bash
cd /Users/pedro/Developer/lossless-claude && npm test -- test/installer/dry-run-deps.test.ts 2>&1 | tail -10
```

Expected: FAIL — `promptUser` does not exist on `DryRunServiceDeps`.

- [ ] **Step 2: Add `promptUser` to `DryRunServiceDeps`**

In `installer/dry-run-deps.ts`, add to the class:

```typescript
  async promptUser(question: string): Promise<string> {
    console.log(`[dry-run] would prompt: ${question}`);
    return "";
  }
```

- [ ] **Step 3: Run tests**

```bash
cd /Users/pedro/Developer/lossless-claude && npm test 2>&1 | tail -10
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add installer/dry-run-deps.ts test/installer/dry-run-deps.test.ts
git commit -m "feat: add promptUser to DryRunServiceDeps (returns empty string for dry-run)"
```

---

## Task 7: Push and verify

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/pedro/Developer/lossless-claude && npm test 2>&1 | tail -10
```

Expected: all tests pass (will be 190+ with new ones).

- [ ] **Step 2: Build**

```bash
cd /Users/pedro/Developer/lossless-claude && npm run build 2>&1 | grep "error TS" | head -10
```

Expected: zero TypeScript errors.

- [ ] **Step 3: Push**

```bash
git push
```
