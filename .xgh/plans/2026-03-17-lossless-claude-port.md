# lossless-claude Claude Code Port — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Convert lossless-claude from an OpenClaw plugin to a Claude Code memory platform daemon with PreCompact/SessionStart hooks, MCP tools, and a Node.js API for xgh integration.

**Architecture:** Single persistent daemon (HTTP + Unix socket) owns SQLite DAG + Qdrant. Thin MCP stdio client relays tool calls to daemon. Hook CLI commands communicate with daemon. Node.js API imported by xgh replaces direct qdrant-store.js calls.

**Tech Stack:** TypeScript, Node.js, SQLite (node:sqlite), @anthropic-ai/sdk, @modelcontextprotocol/sdk, qdrant-store.js (from ~/.local/lib/), Vitest

---

## File Structure Overview

### New files to create

```
src/daemon/
  server.ts              — HTTP server (Node.js http module), Unix socket + TCP binding
  routes/
    health.ts            — GET /health handler
    compact.ts           — POST /compact handler
    restore.ts           — POST /restore handler
    store.ts             — POST /store handler
    grep.ts              — POST /grep handler
    search.ts            — POST /search handler
    expand.ts            — POST /expand handler
    describe.ts          — POST /describe handler
    recent.ts            — POST /recent handler
  config.ts              — daemon config loader (~/.lossless-claude/config.json)
  project.ts             — project path → sha256 ID, per-project DB/meta.json management
  lock.ts                — flock-based daemon lock protocol
  client.ts              — HTTP client for daemon communication (used by hooks, MCP, API)
  orientation.ts         — memory orientation prompt template

src/hooks/
  compact.ts             — PreCompact hook CLI entry point (reads stdin, POSTs to daemon)
  restore.ts             — SessionStart hook CLI entry point (reads stdin, POSTs to daemon)
  probe-precompact.ts    — C1 verification probe (dumps stdin to file)
  probe-sessionstart.ts  — C3 verification probe (dumps stdin to file)

src/mcp/
  server.ts              — MCP stdio server (thin client → daemon)
  tools/
    lcm-grep.ts          — lcm_grep tool definition
    lcm-expand.ts        — lcm_expand tool definition
    lcm-describe.ts      — lcm_describe tool definition
    lcm-search.ts        — lcm_search tool definition

src/memory/
  index.ts               — Node.js API surface: memory.store/search/compact/recent

src/promotion/
  detector.ts            — promotion signal detection (keywords, patterns, depth, compression)
  promoter.ts            — Qdrant write via qdrant-store.js storeWithDedup

src/llm/
  anthropic.ts           — Anthropic SDK wrapper, replaces deps.complete()

bin/
  lossless-claude.ts     — CLI entry point: daemon/compact/restore/mcp/install/uninstall

installer/
  install.ts             — settings.json merge, launchd plist, config creation, self-test
  uninstall.ts           — reverse of install
  plist-template.ts      — LaunchAgent plist XML template

test/
  daemon/
    server.test.ts
    config.test.ts
    project.test.ts
    lock.test.ts
    client.test.ts
    orientation.test.ts
    routes/
      compact.test.ts
      restore.test.ts
      grep.test.ts
      search.test.ts
      expand.test.ts
      describe.test.ts
      store.test.ts
      recent.test.ts
  hooks/
    compact.test.ts
    restore.test.ts
  mcp/
    server.test.ts
    tools.test.ts
  memory/
    api.test.ts
  promotion/
    detector.test.ts
    promoter.test.ts
  llm/
    anthropic.test.ts
    summarize-exports.test.ts
  installer/
    install.test.ts
    uninstall.test.ts
  package-config.test.ts
```

### Existing files to modify

| File | Change |
|------|--------|
| `package.json` | Rename to `lossless-claude`, update deps (drop OpenClaw/pi-ai/pi-agent-core/typebox, add @anthropic-ai/sdk, @modelcontextprotocol/sdk), add `bin` field, update scripts |
| `src/summarize.ts` | Export `LCM_SUMMARIZER_SYSTEM_PROMPT`, `buildLeafSummaryPrompt`, `buildCondensedSummaryPrompt`, `resolveTargetTokens`. Remove `deps.complete()` calls and `createLcmSummarizeFromLegacyParams` |
| `src/compaction.ts` | Replace `CompactionSummarizeFn` to accept new `LcmSummarizeFn` from `src/llm/anthropic.ts` |
| `src/assembler.ts` | Remove `openclaw/plugin-sdk` import, replace `AgentMessage` with local type |

### Existing files kept as-is

`src/db/`, `src/store/`, `src/retrieval.ts`, `src/expansion.ts`, `src/integrity.ts`, `src/large-files.ts`, `src/transcript-repair.ts`, `src/tools/lcm-conversation-scope.ts`, `tui/`

### Existing files to remove

`index.ts`, `openclaw.plugin.json`, `src/engine.ts`, `src/tools/lcm-expand-query-tool.ts`, `src/tools/lcm-expand-tool.delegation.ts`, `src/expansion-auth.ts`, `src/expansion-policy.ts`, `src/openclaw-bridge.ts`

---

## Chunk 1: Foundation — Daemon Scaffold, Config, Project, Health

### Task 1.1: Update package.json

**Files:**
- Modify: `package.json`
- Create: `test/package-config.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/package-config.test.ts
import { describe, it, expect } from "vitest";
import pkg from "../package.json";

describe("package.json", () => {
  it("has correct name", () => expect(pkg.name).toBe("lossless-claude"));
  it("has bin entry", () => expect(pkg.bin).toHaveProperty("lossless-claude"));
  it("has anthropic sdk", () => expect(pkg.dependencies).toHaveProperty("@anthropic-ai/sdk"));
  it("has mcp sdk", () => expect(pkg.dependencies).toHaveProperty("@modelcontextprotocol/sdk"));
  it("does not have pi-ai", () => expect(pkg.dependencies).not.toHaveProperty("@mariozechner/pi-ai"));
  it("does not have pi-agent-core", () => expect(pkg.dependencies).not.toHaveProperty("@mariozechner/pi-agent-core"));
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/package-config.test.ts
```
Expected: FAIL (name is not lossless-claude yet)

- [ ] **Step 3: Update package.json**

  - `"name"`: `"lossless-claude"`
  - `"description"`: `"Lossless memory platform for Claude Code — DAG-based conversation summarization with semantic promotion"`
  - `"main"`: `"src/memory/index.ts"`
  - `"exports"`: `{ ".": "./src/memory/index.ts" }`
  - `"bin"`: `{ "lossless-claude": "./bin/lossless-claude.ts" }`
  - Remove from `dependencies`: `@mariozechner/pi-agent-core`, `@mariozechner/pi-ai`, `@sinclair/typebox`
  - Add to `dependencies`: `"@anthropic-ai/sdk": "^0.39.0"`, `"@modelcontextprotocol/sdk": "^1.12.0"`
  - Delete `peerDependencies` entirely
  - Update `"files"` to include `bin/`, remove `openclaw.plugin.json`
  - Run: `npm install`

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/package-config.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json test/package-config.test.ts
git commit -m "refactor: rename package to lossless-claude, drop OpenClaw deps, add Anthropic+MCP sdks"
```

---

### Task 1.2: Daemon config loader

**Files:**
- Create: `src/daemon/config.ts`
- Create: `test/daemon/config.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/daemon/config.test.ts
import { describe, it, expect } from "vitest";
import { loadDaemonConfig } from "../../src/daemon/config.js";

describe("loadDaemonConfig", () => {
  it("returns defaults when no config file exists", () => {
    const c = loadDaemonConfig("/nonexistent/config.json");
    expect(c.daemon.port).toBe(3737);
    expect(c.daemon.socketPath).toContain("daemon.sock");
    expect(c.llm.model).toBe("claude-haiku-4-5-20251001");
    expect(c.compaction.leafTokens).toBe(1000);
    expect(c.restoration.recentSummaries).toBe(3);
    expect(c.restoration.semanticTopK).toBe(5);
    expect(c.version).toBe(1);
  });

  it("merges partial config over defaults", () => {
    const c = loadDaemonConfig("/nonexistent/config.json", { daemon: { port: 4000 } });
    expect(c.daemon.port).toBe(4000);
    expect(c.daemon.socketPath).toContain("daemon.sock");
  });

  it("interpolates ${ANTHROPIC_API_KEY} from env", () => {
    const c = loadDaemonConfig("/nonexistent", { llm: { apiKey: "${ANTHROPIC_API_KEY}" } }, { ANTHROPIC_API_KEY: "sk-test" });
    expect(c.llm.apiKey).toBe("sk-test");
  });

  it("falls back to env var when apiKey not set", () => {
    const c = loadDaemonConfig("/nonexistent", undefined, { ANTHROPIC_API_KEY: "sk-env" });
    expect(c.llm.apiKey).toBe("sk-env");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
npm test -- test/daemon/config.test.ts
```
Expected: FAIL (module not found)

- [ ] **Step 3: Implement `src/daemon/config.ts`**

```typescript
// src/daemon/config.ts
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type DaemonConfig = {
  version: number;
  daemon: { port: number; socketPath: string; logLevel: string; logMaxSizeMB: number; logRetentionDays: number };
  compaction: {
    leafTokens: number; maxDepth: number;
    promotionThresholds: { minDepth: number; compressionRatio: number; keywords: Record<string, string[]>; architecturePatterns: string[] };
  };
  restoration: { recentSummaries: number; semanticTopK: number; semanticThreshold: number };
  llm: { model: string; apiKey: string };
  cipher: { configPath: string; collection: string };
};

const DEFAULTS: DaemonConfig = {
  version: 1,
  daemon: { port: 3737, socketPath: join(homedir(), ".lossless-claude", "daemon.sock"), logLevel: "info", logMaxSizeMB: 10, logRetentionDays: 7 },
  compaction: {
    leafTokens: 1000, maxDepth: 5,
    promotionThresholds: {
      minDepth: 2, compressionRatio: 0.3,
      keywords: { decision: ["decided", "agreed", "will use", "going with", "chosen"], fix: ["fixed", "root cause", "workaround", "resolved"] },
      architecturePatterns: ["src/[\\w/]+\\.ts", "[A-Z][a-zA-Z]+(Engine|Store|Service|Manager|Handler|Client)", "interface [A-Z]", "class [A-Z]"],
    },
  },
  restoration: { recentSummaries: 3, semanticTopK: 5, semanticThreshold: 0.35 },
  llm: { model: "claude-haiku-4-5-20251001", apiKey: "" },
  cipher: { configPath: join(homedir(), ".cipher", "cipher.yml"), collection: "lossless_memory" },
};

function deepMerge(target: any, source: any): any {
  if (!source || typeof source !== "object") return target;
  const result = { ...target };
  for (const key of Object.keys(source)) {
    if (source[key] !== undefined) {
      result[key] = (typeof source[key] === "object" && !Array.isArray(source[key]) && typeof target[key] === "object")
        ? deepMerge(target[key], source[key]) : source[key];
    }
  }
  return result;
}

export function loadDaemonConfig(configPath: string, overrides?: any, env?: Record<string, string | undefined>): DaemonConfig {
  const e = env ?? process.env;
  let fileConfig: any = {};
  try { fileConfig = JSON.parse(readFileSync(configPath, "utf-8")); } catch {}
  const merged = deepMerge(DEFAULTS, deepMerge(fileConfig, overrides));
  if (merged.llm.apiKey) merged.llm.apiKey = merged.llm.apiKey.replace(/\$\{(\w+)\}/g, (_: string, k: string) => e[k] ?? "");
  if (!merged.llm.apiKey && e.ANTHROPIC_API_KEY) merged.llm.apiKey = e.ANTHROPIC_API_KEY;
  return merged;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
npm test -- test/daemon/config.test.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/daemon/config.ts test/daemon/config.test.ts
git commit -m "feat: add daemon config loader with defaults and env interpolation"
```

---

### Task 1.3: Project ID and path utilities

**Files:**
- Create: `src/daemon/project.ts`
- Create: `test/daemon/project.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/daemon/project.test.ts
import { describe, it, expect } from "vitest";
import { projectId, projectDbPath, projectMetaPath } from "../../src/daemon/project.js";

describe("projectId", () => {
  it("returns sha256 hex of absolute path", () => expect(projectId("/foo")).toMatch(/^[a-f0-9]{64}$/));
  it("is deterministic", () => expect(projectId("/foo")).toBe(projectId("/foo")));
  it("differs for different paths", () => expect(projectId("/foo")).not.toBe(projectId("/bar")));
});

describe("projectDbPath", () => {
  it("returns path under .lossless-claude/projects/<id>/db.sqlite", () => {
    const p = projectDbPath("/foo/bar");
    expect(p).toContain("projects");
    expect(p).toContain("db.sqlite");
  });
});

describe("projectMetaPath", () => {
  it("returns path ending in meta.json", () => {
    expect(projectMetaPath("/foo")).toContain("meta.json");
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/daemon/project.test.ts
```

- [ ] **Step 3: Implement `src/daemon/project.ts`**

```typescript
// src/daemon/project.ts
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";

export const BASE_DIR = join(homedir(), ".lossless-claude");

export const projectId = (cwd: string): string =>
  createHash("sha256").update(cwd).digest("hex");

export const projectDir = (cwd: string): string =>
  join(BASE_DIR, "projects", projectId(cwd));

export const projectDbPath = (cwd: string): string =>
  join(projectDir(cwd), "db.sqlite");

export const projectMetaPath = (cwd: string): string =>
  join(projectDir(cwd), "meta.json");
```

- [ ] **Step 4: Run and verify PASS**

```bash
npm test -- test/daemon/project.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/daemon/project.ts test/daemon/project.test.ts
git commit -m "feat: add project ID and path utilities"
```

---

### Task 1.4: Daemon HTTP server scaffold with /health

**Files:**
- Create: `src/daemon/server.ts`
- Create: `test/daemon/server.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/daemon/server.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { createDaemon, type DaemonInstance } from "../../src/daemon/server.js";
import { loadDaemonConfig } from "../../src/daemon/config.js";

describe("daemon server", () => {
  let daemon: DaemonInstance | undefined;
  afterEach(async () => { if (daemon) { await daemon.stop(); daemon = undefined; } });

  it("starts and responds to /health", async () => {
    daemon = await createDaemon(loadDaemonConfig("/x", { daemon: { port: 0 } }));
    const port = daemon.address().port;
    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");
  });

  it("returns 404 for unknown routes", async () => {
    daemon = await createDaemon(loadDaemonConfig("/x", { daemon: { port: 0 } }));
    const res = await fetch(`http://127.0.0.1:${daemon.address().port}/nope`);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/daemon/server.test.ts
```

- [ ] **Step 3: Implement `src/daemon/server.ts`**

```typescript
// src/daemon/server.ts
import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import type { DaemonConfig } from "./config.js";

export type RouteHandler = (req: IncomingMessage, res: ServerResponse, body: string) => Promise<void>;
export type DaemonInstance = { address: () => AddressInfo; stop: () => Promise<void>; registerRoute: (method: string, path: string, handler: RouteHandler) => void };

export async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  return Buffer.concat(chunks).toString("utf-8");
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  const body = JSON.stringify(data);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(body);
}

export async function createDaemon(config: DaemonConfig): Promise<DaemonInstance> {
  const startTime = Date.now();
  const routes = new Map<string, RouteHandler>();

  routes.set("GET /health", async (_req, res) =>
    sendJson(res, 200, { status: "ok", uptime: Math.floor((Date.now() - startTime) / 1000) }));

  const server: Server = createServer(async (req, res) => {
    const key = `${req.method} ${req.url?.split("?")[0]}`;
    const handler = routes.get(key);
    if (!handler) { sendJson(res, 404, { error: "not found" }); return; }
    try {
      await handler(req, res, req.method !== "GET" ? await readBody(req) : "");
    } catch (err) {
      sendJson(res, 500, { error: err instanceof Error ? err.message : "internal error" });
    }
  });

  return new Promise((resolve) => {
    server.listen(config.daemon.port, "127.0.0.1", () => {
      resolve({
        address: () => server.address() as AddressInfo,
        stop: () => new Promise<void>((r) => server.close(() => r())),
        registerRoute: (method, path, handler) => routes.set(`${method} ${path}`, handler),
      });
    });
  });
}
```

- [ ] **Step 4: Run and verify PASS**

```bash
npm test -- test/daemon/server.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/daemon/server.ts test/daemon/server.test.ts
git commit -m "feat: add daemon HTTP server scaffold with /health endpoint"
```

---

### Task 1.5: Daemon client utility

**Files:**
- Create: `src/daemon/client.ts`
- Create: `test/daemon/client.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/daemon/client.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { createDaemon, type DaemonInstance } from "../../src/daemon/server.js";
import { DaemonClient } from "../../src/daemon/client.js";
import { loadDaemonConfig } from "../../src/daemon/config.js";

describe("DaemonClient", () => {
  let daemon: DaemonInstance | undefined;
  afterEach(async () => { if (daemon) { await daemon.stop(); daemon = undefined; } });

  it("checks health", async () => {
    daemon = await createDaemon(loadDaemonConfig("/x", { daemon: { port: 0 } }));
    const client = new DaemonClient(`http://127.0.0.1:${daemon.address().port}`);
    expect((await client.health())?.status).toBe("ok");
  });

  it("returns null when daemon not running", async () => {
    expect(await new DaemonClient("http://127.0.0.1:19999").health()).toBeNull();
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/daemon/client.test.ts
```

- [ ] **Step 3: Implement `src/daemon/client.ts`**

```typescript
// src/daemon/client.ts
export class DaemonClient {
  constructor(private baseUrl: string) {}

  async health(): Promise<{ status: string; uptime: number } | null> {
    try {
      const res = await fetch(`${this.baseUrl}/health`);
      return res.ok ? (await res.json() as { status: string; uptime: number }) : null;
    } catch { return null; }
  }

  async post<T = unknown>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText })) as { error?: string };
      throw new Error(err.error ?? `HTTP ${res.status}`);
    }
    return await res.json() as T;
  }
}
```

- [ ] **Step 4: Run and verify PASS**

```bash
npm test -- test/daemon/client.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/daemon/client.ts test/daemon/client.test.ts
git commit -m "feat: add daemon HTTP client utility"
```

---

### Task 1.6: Memory orientation prompt

**Files:**
- Create: `src/daemon/orientation.ts`
- Create: `test/daemon/orientation.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/daemon/orientation.test.ts
import { describe, it, expect } from "vitest";
import { buildOrientationPrompt } from "../../src/daemon/orientation.js";

describe("buildOrientationPrompt", () => {
  it("contains memory-orientation tag", () => {
    const p = buildOrientationPrompt();
    expect(p).toContain("<memory-orientation>");
    expect(p).toContain("</memory-orientation>");
  });
  it("mentions all four tools", () => {
    const p = buildOrientationPrompt();
    expect(p).toContain("lcm_grep");
    expect(p).toContain("lcm_expand");
    expect(p).toContain("lcm_describe");
    expect(p).toContain("lcm_search");
  });
  it("instructs not to store directly", () => {
    const p = buildOrientationPrompt();
    expect(p).toContain("Do not store directly");
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/daemon/orientation.test.ts
```

- [ ] **Step 3: Implement `src/daemon/orientation.ts`**

```typescript
// src/daemon/orientation.ts
export function buildOrientationPrompt(): string {
  return `<memory-orientation>
Memory system active. Guidelines:
- lcm_grep / lcm_expand / lcm_describe / lcm_search → conversation history and project memory
- Do not store directly to any memory system — lossless-claude manages persistence automatically
- When uncertain what was discussed or decided, use lcm_search before asking the user
</memory-orientation>`;
}
```

- [ ] **Step 4: Run and verify PASS**

```bash
npm test -- test/daemon/orientation.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/daemon/orientation.ts test/daemon/orientation.test.ts
git commit -m "feat: add memory orientation prompt template"
```

---

**Chunk 1 complete. Run full test suite:**

```bash
npm test
```
Expected: all Chunk 1 tests PASS, existing tests PASS or skipped (OpenClaw tests will fail — fix in Cleanup)

---

## Chunk 2: Compaction Pipeline — Anthropic SDK, Promotion, /compact, PreCompact Hook

### Task 2.1: Export prompt builders from summarize.ts

**Files:**
- Modify: `src/summarize.ts`
- Create: `test/llm/summarize-exports.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/llm/summarize-exports.test.ts
import { describe, it, expect } from "vitest";
import {
  LCM_SUMMARIZER_SYSTEM_PROMPT,
  buildLeafSummaryPrompt,
  buildCondensedSummaryPrompt,
  resolveTargetTokens,
} from "../../src/summarize.js";

describe("summarize exports", () => {
  it("exports system prompt string", () => {
    expect(typeof LCM_SUMMARIZER_SYSTEM_PROMPT).toBe("string");
    expect(LCM_SUMMARIZER_SYSTEM_PROMPT.length).toBeGreaterThan(10);
  });
  it("buildLeafSummaryPrompt returns non-empty string", () => {
    const p = buildLeafSummaryPrompt({ text: "Hello world", mode: "normal", targetTokens: 200 });
    expect(typeof p).toBe("string");
    expect(p.length).toBeGreaterThan(0);
  });
  it("buildCondensedSummaryPrompt returns non-empty string", () => {
    const p = buildCondensedSummaryPrompt({ text: "Summaries", targetTokens: 200, depth: 2 });
    expect(typeof p).toBe("string");
  });
  it("resolveTargetTokens returns number", () => {
    expect(typeof resolveTargetTokens(1000, false)).toBe("number");
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/llm/summarize-exports.test.ts
```

- [ ] **Step 3: Add exports to `src/summarize.ts`**

Find `LCM_SUMMARIZER_SYSTEM_PROMPT`, `buildLeafSummaryPrompt`, `buildCondensedSummaryPrompt`, `resolveTargetTokens` and add `export` keyword to each. Do not modify any logic.

- [ ] **Step 4: Run and verify PASS**

```bash
npm test -- test/llm/summarize-exports.test.ts
```

- [ ] **Step 5: Run full suite to ensure nothing broken**

```bash
npm test
```

- [ ] **Step 6: Commit**

```bash
git add src/summarize.ts test/llm/summarize-exports.test.ts
git commit -m "refactor: export prompt builders and system prompt from summarize.ts"
```

---

### Task 2.2: Anthropic SDK summarizer

**Files:**
- Create: `src/llm/anthropic.ts`
- Create: `test/llm/anthropic.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/llm/anthropic.test.ts
import { describe, it, expect, vi } from "vitest";
import { createAnthropicSummarizer } from "../../src/llm/anthropic.js";

describe("createAnthropicSummarizer", () => {
  it("calls Anthropic and returns text", async () => {
    const mockCreate = vi.fn().mockResolvedValue({
      content: [{ type: "text", text: "Summary." }],
    });
    const summarizer = createAnthropicSummarizer({
      model: "claude-haiku-4-5-20251001", apiKey: "sk-test",
      _clientOverride: { messages: { create: mockCreate } } as any,
    });
    const result = await summarizer("Conversation text", false, { isCondensed: false });
    expect(result).toBe("Summary.");
    expect(mockCreate).toHaveBeenCalledOnce();
    const args = mockCreate.mock.calls[0][0];
    expect(args.model).toBe("claude-haiku-4-5-20251001");
    expect(args.max_tokens).toBe(1024);
    expect(args.system).toBeDefined();
  });

  it("retries once on empty content, then returns", async () => {
    const mockCreate = vi.fn()
      .mockResolvedValueOnce({ content: [] })
      .mockResolvedValueOnce({ content: [{ type: "text", text: "Retry." }] });
    const summarizer = createAnthropicSummarizer({
      model: "claude-haiku-4-5-20251001", apiKey: "sk-test",
      _clientOverride: { messages: { create: mockCreate } } as any,
    });
    expect(await summarizer("text", false)).toBe("Retry.");
    expect(mockCreate).toHaveBeenCalledTimes(2);
  });

  it("throws immediately on 401 auth error", async () => {
    const err = Object.assign(new Error("auth"), { status: 401 });
    const mockCreate = vi.fn().mockRejectedValue(err);
    const summarizer = createAnthropicSummarizer({
      model: "claude-haiku-4-5-20251001", apiKey: "bad",
      _clientOverride: { messages: { create: mockCreate } } as any,
    });
    await expect(summarizer("text", false)).rejects.toThrow("auth");
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });

  it("retries 3 times on 429 rate limit then throws", async () => {
    const err = Object.assign(new Error("rate limited"), { status: 429 });
    const mockCreate = vi.fn().mockRejectedValue(err);
    const summarizer = createAnthropicSummarizer({
      model: "claude-haiku-4-5-20251001", apiKey: "sk-test",
      _clientOverride: { messages: { create: mockCreate } } as any,
      _retryDelayMs: 0, // no delay in tests
    });
    await expect(summarizer("text", false)).rejects.toThrow("rate limited");
    expect(mockCreate).toHaveBeenCalledTimes(3);
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/llm/anthropic.test.ts
```

- [ ] **Step 3: Implement `src/llm/anthropic.ts`**

```typescript
// src/llm/anthropic.ts
import Anthropic from "@anthropic-ai/sdk";
import { LCM_SUMMARIZER_SYSTEM_PROMPT, buildLeafSummaryPrompt, buildCondensedSummaryPrompt, resolveTargetTokens } from "../summarize.js";

type SummarizerOptions = {
  model: string;
  apiKey: string;
  _clientOverride?: any;
  _retryDelayMs?: number;
};

type SummarizeContext = { isCondensed?: boolean; targetTokens?: number; depth?: number };

export type LcmSummarizeFn = (text: string, aggressive: boolean, ctx?: SummarizeContext) => Promise<string>;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export function createAnthropicSummarizer(opts: SummarizerOptions): LcmSummarizeFn {
  const client = opts._clientOverride ?? new Anthropic({ apiKey: opts.apiKey });
  const retryDelayMs = opts._retryDelayMs ?? 1000;
  const MAX_RETRIES = 3;

  return async function summarize(text, aggressive, ctx = {}): Promise<string> {
    const targetTokens = ctx.targetTokens ?? resolveTargetTokens(text.length / 4, aggressive);
    const prompt = ctx.isCondensed
      ? buildCondensedSummaryPrompt({ text, targetTokens, depth: ctx.depth ?? 1 })
      : buildLeafSummaryPrompt({ text, mode: aggressive ? "aggressive" : "normal", targetTokens });

    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const response = await client.messages.create({
          model: opts.model,
          max_tokens: 1024,
          system: LCM_SUMMARIZER_SYSTEM_PROMPT,
          messages: [{ role: "user", content: prompt }],
        });

        const text_content = response.content.find((c: any) => c.type === "text")?.text ?? "";

        if (!text_content && attempt === 0) {
          // Single retry on empty response
          const retry = await client.messages.create({
            model: opts.model, max_tokens: 1024, system: LCM_SUMMARIZER_SYSTEM_PROMPT,
            messages: [{ role: "user", content: prompt }],
            ...(typeof client === "object" ? {} : { temperature: 0.05 }),
          });
          return retry.content.find((c: any) => c.type === "text")?.text ?? text.slice(0, 500);
        }

        return text_content || text.slice(0, 500);
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

- [ ] **Step 4: Run and verify PASS**

```bash
npm test -- test/llm/anthropic.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/llm/anthropic.ts test/llm/anthropic.test.ts
git commit -m "feat: add Anthropic SDK summarizer replacing deps.complete()"
```

---

### Task 2.3: Promotion signal detector

**Files:**
- Create: `src/promotion/detector.ts`
- Create: `test/promotion/detector.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/promotion/detector.test.ts
import { describe, it, expect } from "vitest";
import { shouldPromote } from "../../src/promotion/detector.js";
import { loadDaemonConfig } from "../../src/daemon/config.js";

const thresholds = loadDaemonConfig("/x").compaction.promotionThresholds;

describe("shouldPromote", () => {
  it("promotes on decision keyword", () => {
    const r = shouldPromote({ content: "We decided to use PostgreSQL", depth: 0, tokenCount: 100, sourceMessageTokenCount: 500 }, thresholds);
    expect(r.promote).toBe(true);
    expect(r.tags).toContain("decision");
  });

  it("promotes on high depth (>= minDepth)", () => {
    const r = shouldPromote({ content: "Routine update", depth: 2, tokenCount: 100, sourceMessageTokenCount: 500 }, thresholds);
    expect(r.promote).toBe(true);
  });

  it("promotes on high compression (< 0.3 ratio)", () => {
    const r = shouldPromote({ content: "Brief", depth: 0, tokenCount: 50, sourceMessageTokenCount: 500 }, thresholds);
    expect(r.promote).toBe(true); // 50/500 = 0.1
  });

  it("does not promote low-signal shallow summary", () => {
    const r = shouldPromote({ content: "Let me check that", depth: 0, tokenCount: 450, sourceMessageTokenCount: 500 }, thresholds);
    expect(r.promote).toBe(false);
  });

  it("promotes on architecture pattern match", () => {
    const r = shouldPromote({ content: "The ConversationStore class in src/store/conversation-store.ts handles CRUD", depth: 0, tokenCount: 200, sourceMessageTokenCount: 500 }, thresholds);
    expect(r.promote).toBe(true);
    expect(r.tags).toContain("architecture");
  });

  it("promotes on fix keyword", () => {
    const r = shouldPromote({ content: "Fixed the root cause of the race condition", depth: 0, tokenCount: 100, sourceMessageTokenCount: 500 }, thresholds);
    expect(r.promote).toBe(true);
    expect(r.tags).toContain("fix");
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/promotion/detector.test.ts
```

- [ ] **Step 3: Implement `src/promotion/detector.ts`**

```typescript
// src/promotion/detector.ts
import type { DaemonConfig } from "../daemon/config.js";

type Thresholds = DaemonConfig["compaction"]["promotionThresholds"];

export type PromotionInput = {
  content: string;
  depth: number;
  tokenCount: number;
  sourceMessageTokenCount: number;
};

export type PromotionResult = {
  promote: boolean;
  tags: string[];
  confidence: number;
};

export function shouldPromote(input: PromotionInput, thresholds: Thresholds): PromotionResult {
  const tags: string[] = [];
  const { content, depth, tokenCount, sourceMessageTokenCount } = input;
  const lower = content.toLowerCase();

  // Keyword signals
  for (const [category, keywords] of Object.entries(thresholds.keywords)) {
    if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) tags.push(category);
  }

  // Architecture pattern signals
  for (const pattern of thresholds.architecturePatterns) {
    if (new RegExp(pattern).test(content)) { tags.push("architecture"); break; }
  }

  // Depth signal
  if (depth >= thresholds.minDepth) tags.push("depth");

  // Compression ratio signal
  if (sourceMessageTokenCount > 0 && tokenCount / sourceMessageTokenCount < thresholds.compressionRatio) {
    tags.push("compressed");
  }

  const signals = new Set(tags);
  return {
    promote: signals.size > 0,
    tags: [...signals],
    confidence: Math.min(signals.size / 4, 1),
  };
}
```

- [ ] **Step 4: Run and verify PASS**

```bash
npm test -- test/promotion/detector.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/promotion/detector.ts test/promotion/detector.test.ts
git commit -m "feat: add promotion signal detector for Qdrant promotion"
```

---

### Task 2.4: Promotion writer

**Files:**
- Create: `src/promotion/promoter.ts`
- Create: `test/promotion/promoter.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/promotion/promoter.test.ts
import { describe, it, expect, vi } from "vitest";
import { promoteSummary } from "../../src/promotion/promoter.js";

describe("promoteSummary", () => {
  it("calls storeWithDedup with correct payload", async () => {
    const mockStore = vi.fn().mockResolvedValue({ action: "ADD" });
    await promoteSummary({
      text: "We decided to use React",
      tags: ["decision"],
      projectId: "abc123",
      projectPath: "/Users/pedro/project",
      depth: 1,
      sessionId: "sess-1",
      confidence: 0.8,
      collection: "lossless_memory",
      _storeWithDedup: mockStore,
    });
    expect(mockStore).toHaveBeenCalledOnce();
    const [text, tags, meta] = mockStore.mock.calls[0];
    expect(text).toBe("We decided to use React");
    expect(tags).toContain("decision");
    expect(meta.projectId).toBe("abc123");
    expect(meta.source).toBe("compaction");
    expect(meta.confidence).toBe(0.8);
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/promotion/promoter.test.ts
```

- [ ] **Step 3: Implement `src/promotion/promoter.ts`**

```typescript
// src/promotion/promoter.ts
import { createRequire } from "node:module";
import { homedir } from "node:os";
import { join } from "node:path";

type StoreWithDedup = (text: string, tags: string[], meta: Record<string, unknown>) => Promise<unknown>;

export type PromotionParams = {
  text: string;
  tags: string[];
  projectId: string;
  projectPath: string;
  depth: number;
  sessionId: string;
  confidence: number;
  collection: string;
  _storeWithDedup?: StoreWithDedup; // injectable for tests
};

function loadStoreWithDedup(collection: string): StoreWithDedup {
  const require = createRequire(import.meta.url);
  const store = require(join(homedir(), ".local", "lib", "qdrant-store.js"));
  return (text: string, tags: string[], meta: Record<string, unknown>) =>
    store.storeWithDedup(collection, text, tags, meta);
}

export async function promoteSummary(params: PromotionParams): Promise<void> {
  const store = params._storeWithDedup ?? loadStoreWithDedup(params.collection);
  await store(params.text, params.tags, {
    projectId: params.projectId,
    projectPath: params.projectPath,
    depth: params.depth,
    sessionId: params.sessionId,
    timestamp: new Date().toISOString(),
    source: "compaction",
    confidence: params.confidence,
  });
}
```

- [ ] **Step 4: Run and verify PASS**

```bash
npm test -- test/promotion/promoter.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/promotion/detector.ts src/promotion/promoter.ts test/promotion/
git commit -m "feat: add Qdrant promotion writer via qdrant-store.js"
```

---

### Task 2.5: POST /compact daemon endpoint

**Files:**
- Create: `src/daemon/routes/compact.ts`
- Modify: `src/daemon/server.ts` (wire route)
- Create: `test/daemon/routes/compact.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/daemon/routes/compact.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { createDaemon, type DaemonInstance } from "../../../src/daemon/server.js";
import { loadDaemonConfig } from "../../../src/daemon/config.js";

describe("POST /compact", () => {
  let daemon: DaemonInstance | undefined;
  afterEach(async () => { if (daemon) { await daemon.stop(); daemon = undefined; } });

  it("accepts compact request and returns summary", async () => {
    daemon = await createDaemon(loadDaemonConfig("/x", { daemon: { port: 0 }, llm: { apiKey: "sk-test" } }));
    const res = await fetch(`http://127.0.0.1:${daemon.address().port}/compact`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "test-sess", cwd: "/tmp/test-compact-proj", hook_event_name: "PreCompact" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toHaveProperty("summary");
    expect(typeof body.summary).toBe("string");
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/daemon/routes/compact.test.ts
```

- [ ] **Step 3: Implement `src/daemon/routes/compact.ts`**

The handler:
1. Parses body: `{ session_id, transcript_path?, cwd, hook_event_name }`
2. Opens (creates if needed) project SQLite DB via `projectDbPath(cwd)`. Creates parent dir with `mkdirSync(..., { recursive: true })`
3. Runs `runLcmMigrations(db)` from `src/db/migration.ts`
4. Creates stores (`ConversationStore`, `SummaryStore`)
5. Gets or creates conversation for `session_id`
6. Reads transcript from `transcript_path` if provided (newline-delimited JSON); parses messages
7. Runs `CompactionEngine` with `createAnthropicSummarizer(config.llm)` as the summarize function
8. Runs promotion on new summary nodes via `shouldPromote` + `promoteSummary`
9. Updates `bootstrapped_at` on conversation
10. Updates `meta.json` with `lastCompact: new Date().toISOString()`
11. Sets in-memory `justCompacted` flag keyed by `session_id` with 30s TTL
12. Returns `{ summary: "Compacted N messages into M summary nodes. K promoted to long-term memory." }`

Note: If the project has no messages (first run, empty project), return `{ summary: "No messages to compact." }` with status 200.

```typescript
// src/daemon/routes/compact.ts — skeleton
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DaemonConfig } from "../config.js";
import { projectDbPath, projectMetaPath } from "../project.js";
import type { RouteHandler } from "../server.js";

// In-memory justCompacted map (session_id -> timestamp)
export const justCompactedMap = new Map<string, number>();
export const JUST_COMPACTED_TTL_MS = 30_000;

export function createCompactHandler(config: DaemonConfig): RouteHandler {
  return async (_req, res, body) => {
    // ... implementation
  };
}
```

- [ ] **Step 4: Run and verify PASS**

```bash
npm test -- test/daemon/routes/compact.test.ts
```

- [ ] **Step 5: Wire route in server.ts**

Import `createCompactHandler` and call `daemon.registerRoute("POST", "/compact", createCompactHandler(config))` after creating the daemon.

- [ ] **Step 6: Commit**

```bash
git add src/daemon/routes/compact.ts src/daemon/server.ts test/daemon/routes/compact.test.ts
git commit -m "feat: add POST /compact endpoint with DAG compaction + Qdrant promotion"
```

---

### Task 2.6: PreCompact hook CLI

**Files:**
- Create: `src/hooks/compact.ts`
- Create: `test/hooks/compact.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/hooks/compact.test.ts
import { describe, it, expect, vi } from "vitest";
import { handlePreCompact } from "../../src/hooks/compact.js";

describe("handlePreCompact", () => {
  it("returns exitCode 2 and summary when daemon healthy", async () => {
    const client = { health: vi.fn().mockResolvedValue({ status: "ok" }), post: vi.fn().mockResolvedValue({ summary: "Compacted 500 tokens" }) };
    const result = await handlePreCompact(JSON.stringify({ session_id: "s1", cwd: "/proj", hook_event_name: "PreCompact" }), client as any);
    expect(result.exitCode).toBe(2);
    expect(result.stdout).toContain("Compacted");
  });

  it("returns exitCode 0 when daemon unreachable", async () => {
    const client = { health: vi.fn().mockResolvedValue(null), post: vi.fn() };
    const result = await handlePreCompact("{}", client as any);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/hooks/compact.test.ts
```

- [ ] **Step 3: Implement `src/hooks/compact.ts`**

```typescript
// src/hooks/compact.ts
import type { DaemonClient } from "../daemon/client.js";

export async function handlePreCompact(stdin: string, client: DaemonClient): Promise<{ exitCode: number; stdout: string }> {
  const health = await client.health();
  if (!health) return { exitCode: 0, stdout: "" };

  try {
    const input = JSON.parse(stdin || "{}");
    const result = await client.post<{ summary: string }>("/compact", input);
    return { exitCode: 2, stdout: result.summary || "" };
  } catch {
    return { exitCode: 0, stdout: "" };
  }
}
```

- [ ] **Step 4: Run and verify PASS**

```bash
npm test -- test/hooks/compact.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/compact.ts test/hooks/compact.test.ts
git commit -m "feat: add PreCompact hook CLI command"
```

---

## Chunk 3: Restoration Pipeline — /restore, SessionStart Hook

### Task 3.1: POST /restore daemon endpoint

**Files:**
- Create: `src/daemon/routes/restore.ts`
- Modify: `src/daemon/server.ts` (wire route)
- Create: `test/daemon/routes/restore.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/daemon/routes/restore.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { createDaemon, type DaemonInstance } from "../../../src/daemon/server.js";
import { loadDaemonConfig } from "../../../src/daemon/config.js";

describe("POST /restore", () => {
  let daemon: DaemonInstance | undefined;
  afterEach(async () => { if (daemon) { await daemon.stop(); daemon = undefined; } });

  it("returns orientation-only for first-ever session", async () => {
    daemon = await createDaemon(loadDaemonConfig("/x", { daemon: { port: 0 } }));
    const res = await fetch(`http://127.0.0.1:${daemon.address().port}/restore`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "new-sess", cwd: "/tmp/brand-new-restore-project", hook_event_name: "SessionStart" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.context).toContain("<memory-orientation>");
    expect(body.context).not.toContain("<recent-session-context>");
  });

  it("returns orientation-only for source=compact", async () => {
    daemon = await createDaemon(loadDaemonConfig("/x", { daemon: { port: 0 } }));
    const res = await fetch(`http://127.0.0.1:${daemon.address().port}/restore`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ session_id: "s1", cwd: "/tmp/compact-test", source: "compact", hook_event_name: "SessionStart" }),
    });
    const body = await res.json();
    expect(body.context).toContain("<memory-orientation>");
    expect(body.context).not.toContain("<recent-session-context>");
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/daemon/routes/restore.test.ts
```

- [ ] **Step 3: Implement `src/daemon/routes/restore.ts`**

```typescript
// src/daemon/routes/restore.ts
import type { DaemonConfig } from "../config.js";
import { projectDbPath } from "../project.js";
import { buildOrientationPrompt } from "../orientation.js";
import { justCompactedMap, JUST_COMPACTED_TTL_MS } from "./compact.js";
import type { RouteHandler } from "../server.js";

export function createRestoreHandler(config: DaemonConfig): RouteHandler {
  return async (_req, res, body) => {
    const { sendJson } = await import("../server.js");
    const input = JSON.parse(body || "{}");
    const { session_id, cwd, source } = input;
    const orientation = buildOrientationPrompt();

    // Post-compaction detection
    const isPostCompact = source === "compact" ||
      (justCompactedMap.has(session_id) && Date.now() - justCompactedMap.get(session_id)! < JUST_COMPACTED_TTL_MS);

    if (isPostCompact) {
      sendJson(res, 200, { context: orientation });
      return;
    }

    // Query episodic memory
    let episodicContext = "";
    let semanticContext = "";

    try {
      // Open project DB and fetch recent summaries
      const { DatabaseSync } = await import("node:sqlite");
      const { runLcmMigrations } = await import("../../db/migration.js");
      const { mkdirSync, existsSync } = await import("node:fs");
      const { dirname } = await import("node:path");
      const dbPath = projectDbPath(cwd);
      if (existsSync(dbPath)) {
        mkdirSync(dirname(dbPath), { recursive: true });
        const db = new DatabaseSync(dbPath);
        runLcmMigrations(db);
        const rows = db.prepare(
          `SELECT s.content FROM summaries s
           JOIN conversations c ON s.conversation_id = c.conversation_id
           WHERE c.session_id = ? AND s.depth = (SELECT MAX(depth) FROM summaries WHERE conversation_id = s.conversation_id)
           ORDER BY s.created_at DESC LIMIT ?`
        ).all(session_id, config.restoration.recentSummaries) as Array<{ content: string }>;

        if (rows.length > 0) {
          episodicContext = `<recent-session-context>\n${rows.map((r) => r.content).join("\n\n")}\n</recent-session-context>`;
        }
        db.close();
      }
    } catch { /* non-fatal */ }

    // Query Qdrant semantic memory
    try {
      const { createRequire } = await import("node:module");
      const { homedir } = await import("node:os");
      const { join } = await import("node:path");
      const req = createRequire(import.meta.url);
      const store = req(join(homedir(), ".local", "lib", "qdrant-store.js"));
      const { projectId } = await import("../project.js");
      const pid = projectId(cwd);
      const results = await store.search(`project context ${cwd}`, config.cipher.collection, config.restoration.semanticTopK, config.restoration.semanticThreshold);
      const relevant = results.filter((r: any) => r.payload?.projectId === pid);
      if (relevant.length > 0) {
        semanticContext = `<project-knowledge>\n${relevant.map((r: any) => r.payload.text).join("\n\n")}\n</project-knowledge>`;
      }
    } catch { /* non-fatal — Qdrant may not be running */ }

    const context = [orientation, episodicContext, semanticContext].filter(Boolean).join("\n\n");
    sendJson(res, 200, { context });
  };
}
```

- [ ] **Step 4: Run and verify PASS**

```bash
npm test -- test/daemon/routes/restore.test.ts
```

- [ ] **Step 5: Wire route in server.ts**

```bash
npm test -- test/daemon/
```
Expected: all daemon tests PASS

- [ ] **Step 6: Commit**

```bash
git add src/daemon/routes/restore.ts src/daemon/server.ts test/daemon/routes/restore.test.ts
git commit -m "feat: add POST /restore endpoint for session context restoration"
```

---

### Task 3.2: SessionStart hook CLI

**Files:**
- Create: `src/hooks/restore.ts`
- Create: `test/hooks/restore.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/hooks/restore.test.ts
import { describe, it, expect, vi } from "vitest";
import { handleSessionStart } from "../../src/hooks/restore.js";

describe("handleSessionStart", () => {
  it("outputs context and exits 0 on success", async () => {
    const client = {
      health: vi.fn().mockResolvedValue({ status: "ok" }),
      post: vi.fn().mockResolvedValue({ context: "<memory-orientation>\nMemory active\n</memory-orientation>" }),
    };
    const result = await handleSessionStart(JSON.stringify({ session_id: "s1", cwd: "/proj", hook_event_name: "SessionStart" }), client as any);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("<memory-orientation>");
  });

  it("exits 0 with empty output when daemon down", async () => {
    const client = { health: vi.fn().mockResolvedValue(null), post: vi.fn() };
    const result = await handleSessionStart("{}", client as any);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe("");
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/hooks/restore.test.ts
```

- [ ] **Step 3: Implement `src/hooks/restore.ts`**

```typescript
// src/hooks/restore.ts
import type { DaemonClient } from "../daemon/client.js";

export async function handleSessionStart(stdin: string, client: DaemonClient): Promise<{ exitCode: number; stdout: string }> {
  const health = await client.health();
  if (!health) return { exitCode: 0, stdout: "" };
  try {
    const input = JSON.parse(stdin || "{}");
    const result = await client.post<{ context: string }>("/restore", input);
    return { exitCode: 0, stdout: result.context || "" };
  } catch {
    return { exitCode: 0, stdout: "" };
  }
}
```

- [ ] **Step 4: Run and verify PASS**

```bash
npm test -- test/hooks/restore.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/hooks/restore.ts test/hooks/restore.test.ts
git commit -m "feat: add SessionStart hook CLI command"
```

---

## Chunk 4: MCP Server — 4 Tools, Daemon Endpoints

### Task 4.1: /grep, /search, /expand, /describe endpoints

**Files:**
- Create: `src/daemon/routes/grep.ts`, `search.ts`, `expand.ts`, `describe.ts`, `store.ts`, `recent.ts`
- Modify: `src/daemon/server.ts`
- Create: `test/daemon/routes/grep.test.ts`, `search.test.ts`, `expand.test.ts`, `describe.test.ts`

- [ ] **Step 1: Write failing tests for all four routes**

```typescript
// test/daemon/routes/grep.test.ts
import { describe, it, expect, afterEach } from "vitest";
import { createDaemon, type DaemonInstance } from "../../../src/daemon/server.js";
import { loadDaemonConfig } from "../../../src/daemon/config.js";

describe("POST /grep", () => {
  let daemon: DaemonInstance | undefined;
  afterEach(async () => { if (daemon) { await daemon.stop(); daemon = undefined; } });

  it("returns matches array for empty project (no matches)", async () => {
    daemon = await createDaemon(loadDaemonConfig("/x", { daemon: { port: 0 } }));
    const res = await fetch(`http://127.0.0.1:${daemon.address().port}/grep`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query: "anything", cwd: "/tmp/empty-grep-project", scope: "all" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.matches)).toBe(true);
  });
});
```

Write similar minimal tests for `/search`, `/expand`, `/describe` that verify the response shape on empty projects.

- [ ] **Step 2: Run and verify all FAIL**

```bash
npm test -- test/daemon/routes/grep.test.ts test/daemon/routes/search.test.ts
```

- [ ] **Step 3: Implement route handlers**

`src/daemon/routes/grep.ts`:
- Parses `{ query, scope?, sessionId?, since?, cwd }`
- Opens project DB (if exists), creates `RetrievalEngine` from existing `src/retrieval.ts`
- Calls `retrieval.grep({ query, scope, sessionId, since })`
- Returns `{ matches: GrepMatch[] }`
- If DB not found: return `{ matches: [] }`

`src/daemon/routes/search.ts`:
- Parses `{ query, limit?, layers?, cwd }`
- `layers` defaults to `["episodic", "semantic"]`
- Episodic: calls `RetrievalEngine.grep` with `scope: "all"`, `full_text: true`
- Semantic: loads qdrant-store.js, calls `search(query, config.cipher.collection, limit, threshold)`
- Returns `{ episodic: [...], semantic: [...] }` — two separate ranked lists, scores NOT merged

`src/daemon/routes/expand.ts`:
- Parses `{ nodeId, depth?, cwd }`
- Opens project DB, creates `ExpansionOrchestrator` from `src/expansion.ts`
- Returns expansion result

`src/daemon/routes/describe.ts`:
- Parses `{ nodeId, cwd }`
- Opens project DB, creates `RetrievalEngine`
- Calls `retrieval.describe(nodeId)`
- Returns describe result

`src/daemon/routes/store.ts`:
- Parses `{ text, tags, metadata }`
- Calls `promoteSummary` with `source: "manual"`
- Returns `{ stored: true }`

`src/daemon/routes/recent.ts`:
- Parses `{ projectId, limit? }`
- Opens project DB, queries recent root summaries
- Returns `{ summaries: SummaryRecord[] }`

- [ ] **Step 4: Wire all routes in server.ts**

Add all route registrations to `createDaemon` or expose a `registerDefaultRoutes(daemon, config)` function.

- [ ] **Step 5: Run and verify all PASS**

```bash
npm test -- test/daemon/routes/
```

- [ ] **Step 6: Commit**

```bash
git add src/daemon/routes/ test/daemon/routes/
git commit -m "feat: add /grep /search /expand /describe /store /recent daemon endpoints"
```

---

### Task 4.2: MCP stdio server

**Files:**
- Create: `src/mcp/server.ts`
- Create: `src/mcp/tools/lcm-grep.ts`, `lcm-expand.ts`, `lcm-describe.ts`, `lcm-search.ts`
- Create: `test/mcp/server.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/mcp/server.test.ts
import { describe, it, expect } from "vitest";
import { getMcpToolDefinitions } from "../../src/mcp/server.js";

describe("MCP tool definitions", () => {
  it("exposes exactly 4 tools", () => {
    const tools = getMcpToolDefinitions();
    expect(tools).toHaveLength(4);
    expect(tools.map((t: any) => t.name).sort()).toEqual(["lcm_describe", "lcm_expand", "lcm_grep", "lcm_search"]);
  });

  it("each tool has name, description, inputSchema", () => {
    for (const tool of getMcpToolDefinitions()) {
      expect(tool).toHaveProperty("name");
      expect(tool).toHaveProperty("description");
      expect(tool).toHaveProperty("inputSchema");
      expect(tool.inputSchema.type).toBe("object");
    }
  });

  it("lcm_grep description mentions conversation history", () => {
    const tool = getMcpToolDefinitions().find((t: any) => t.name === "lcm_grep");
    expect(tool!.description).toContain("conversation history");
  });

  it("lcm_search description mentions episodic", () => {
    const tool = getMcpToolDefinitions().find((t: any) => t.name === "lcm_search");
    expect(tool!.description).toContain("episodic");
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/mcp/server.test.ts
```

- [ ] **Step 3: Create tool definitions**

`src/mcp/tools/lcm-grep.ts`:
```typescript
export const lcmGrepTool = {
  name: "lcm_grep",
  description: "Search conversation history by keyword or regex across raw messages and summaries. Use when recalling what was said, decided, or done in a past session.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Keyword, phrase, or regex to search" },
      scope: { type: "string", enum: ["messages", "summaries", "all"], default: "all" },
      sessionId: { type: "string", description: "Filter to a specific session" },
      since: { type: "string", description: "ISO datetime lower bound" },
    },
    required: ["query"],
  },
};
```

`src/mcp/tools/lcm-expand.ts`:
```typescript
export const lcmExpandTool = {
  name: "lcm_expand",
  description: "Decompress a summary node into its full source content by traversing the DAG. Use when a summary references something that needs more detail.",
  inputSchema: {
    type: "object" as const,
    properties: {
      nodeId: { type: "string", description: "Summary node ID to expand" },
      depth: { type: "number", description: "How many levels of the DAG to traverse (default: 1)" },
    },
    required: ["nodeId"],
  },
};
```

`src/mcp/tools/lcm-describe.ts`:
```typescript
export const lcmDescribeTool = {
  name: "lcm_describe",
  description: "Inspect metadata and lineage of a memory node without expanding content. Returns depth, token count, parent/child links, and whether it was promoted to long-term memory.",
  inputSchema: {
    type: "object" as const,
    properties: {
      nodeId: { type: "string", description: "Node ID to describe" },
    },
    required: ["nodeId"],
  },
};
```

`src/mcp/tools/lcm-search.ts`:
```typescript
export const lcmSearchTool = {
  name: "lcm_search",
  description: "Hybrid semantic search across both episodic memory (SQLite FTS5) and semantic memory (Qdrant). Returns two separate ranked lists — episodic and semantic. Use when looking for project knowledge spanning multiple sessions.",
  inputSchema: {
    type: "object" as const,
    properties: {
      query: { type: "string", description: "Natural language search query" },
      limit: { type: "number", description: "Max results per layer (default: 5)" },
      layers: { type: "array", items: { type: "string", enum: ["episodic", "semantic"] }, description: "Which memory layers to search (default: both)" },
    },
    required: ["query"],
  },
};
```

- [ ] **Step 4: Create `src/mcp/server.ts`**

```typescript
// src/mcp/server.ts
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { DaemonClient } from "../daemon/client.js";
import { lcmGrepTool } from "./tools/lcm-grep.js";
import { lcmExpandTool } from "./tools/lcm-expand.js";
import { lcmDescribeTool } from "./tools/lcm-describe.js";
import { lcmSearchTool } from "./tools/lcm-search.js";

const TOOLS = [lcmGrepTool, lcmExpandTool, lcmDescribeTool, lcmSearchTool];

const TOOL_ROUTES: Record<string, string> = {
  lcm_grep: "/grep",
  lcm_expand: "/expand",
  lcm_describe: "/describe",
  lcm_search: "/search",
};

export function getMcpToolDefinitions() { return TOOLS; }

export async function startMcpServer(): Promise<void> {
  const client = new DaemonClient("http://127.0.0.1:3737");
  const server = new Server({ name: "lossless-claude", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const route = TOOL_ROUTES[req.params.name];
    if (!route) throw new Error(`Unknown tool: ${req.params.name}`);
    const result = await client.post(route, { ...req.params.arguments, cwd: process.env.PWD ?? process.cwd() });
    return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
}
```

- [ ] **Step 5: Run and verify PASS**

```bash
npm test -- test/mcp/server.test.ts
```

- [ ] **Step 6: Commit**

```bash
git add src/mcp/ test/mcp/
git commit -m "feat: add MCP stdio server with 4 tools as thin daemon client"
```

---

## Chunk 5: Node.js API + Qdrant Promotion Integration

### Task 5.1: Node.js memory API

**Files:**
- Create: `src/memory/index.ts`
- Create: `test/memory/api.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/memory/api.test.ts
import { describe, it, expect, vi } from "vitest";
import { createMemoryApi } from "../../src/memory/index.js";

describe("createMemoryApi", () => {
  it("store calls POST /store", async () => {
    const mockPost = vi.fn().mockResolvedValue({ stored: true });
    const api = createMemoryApi({ post: mockPost, health: vi.fn() } as any);
    await api.store("Decision: use PostgreSQL", ["decision"], { projectPath: "/foo" });
    expect(mockPost).toHaveBeenCalledWith("/store", { text: "Decision: use PostgreSQL", tags: ["decision"], metadata: { projectPath: "/foo" } });
  });

  it("search calls POST /search and returns both layers", async () => {
    const mockPost = vi.fn().mockResolvedValue({ episodic: [{ id: "1", content: "test", source: "sqlite", score: 1.5 }], semantic: [] });
    const api = createMemoryApi({ post: mockPost, health: vi.fn() } as any);
    const result = await api.search("PostgreSQL decision");
    expect(result.episodic).toHaveLength(1);
    expect(result.semantic).toHaveLength(0);
  });

  it("compact calls POST /compact via daemon", async () => {
    const mockPost = vi.fn().mockResolvedValue({ summary: "Compacted" });
    const api = createMemoryApi({ post: mockPost, health: vi.fn() } as any);
    const result = await api.compact("sess-1", "/path/transcript");
    expect(result.summary).toBe("Compacted");
    expect(mockPost).toHaveBeenCalledWith("/compact", expect.objectContaining({ session_id: "sess-1" }));
  });

  it("recent calls POST /recent", async () => {
    const mockPost = vi.fn().mockResolvedValue({ summaries: [] });
    const api = createMemoryApi({ post: mockPost, health: vi.fn() } as any);
    await api.recent("project-hash-123");
    expect(mockPost).toHaveBeenCalledWith("/recent", expect.objectContaining({ projectId: "project-hash-123" }));
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/memory/api.test.ts
```

- [ ] **Step 3: Implement `src/memory/index.ts`**

```typescript
// src/memory/index.ts
import { DaemonClient } from "../daemon/client.js";

export type SearchResult = { episodic: any[]; semantic: any[] };

export type MemoryApi = {
  store: (text: string, tags: string[], metadata?: Record<string, unknown>) => Promise<void>;
  search: (query: string, options?: { limit?: number; threshold?: number; projectId?: string; layers?: ("episodic" | "semantic")[] }) => Promise<SearchResult>;
  compact: (sessionId: string, transcriptPath: string) => Promise<{ summary: string }>;
  recent: (projectId: string, limit?: number) => Promise<{ summaries: any[] }>;
};

export function createMemoryApi(client: DaemonClient): MemoryApi {
  return {
    async store(text, tags, metadata) {
      await client.post("/store", { text, tags, metadata });
    },
    async search(query, options) {
      return client.post<SearchResult>("/search", { query, ...options });
    },
    async compact(sessionId, transcriptPath) {
      // Always routes through daemon — daemon serialises per (projectId, sessionId)
      return client.post("/compact", { session_id: sessionId, transcript_path: transcriptPath });
    },
    async recent(projectId, limit = 5) {
      return client.post("/recent", { projectId, limit });
    },
  };
}

// Convenience singleton with default daemon address
const defaultClient = new DaemonClient("http://127.0.0.1:3737");
export const memory: MemoryApi = createMemoryApi(defaultClient);
```

- [ ] **Step 4: Run and verify PASS**

```bash
npm test -- test/memory/api.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add src/memory/index.ts test/memory/api.test.ts
git commit -m "feat: add Node.js memory API surface for xgh integration"
```

---

## Chunk 6: CLI Entry Point + Installer

### Task 6.1: CLI entry point

**Files:**
- Create: `bin/lossless-claude.ts`

- [ ] **Step 1: Create `bin/lossless-claude.ts`**

```typescript
#!/usr/bin/env node
// bin/lossless-claude.ts
import { argv, exit, stdin, stdout } from "node:process";

const command = argv[2];

function readStdin(): Promise<string> {
  return new Promise((resolve) => {
    if (stdin.isTTY) { resolve(""); return; }
    const chunks: Buffer[] = [];
    stdin.on("data", (chunk) => chunks.push(chunk));
    stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf-8")));
  });
}

async function main() {
  switch (command) {
    case "daemon": {
      if (argv[3] === "start") {
        const { createDaemon } = await import("../src/daemon/server.js");
        const { loadDaemonConfig } = await import("../src/daemon/config.js");
        const { join } = await import("node:path");
        const { homedir } = await import("node:os");
        const config = loadDaemonConfig(join(homedir(), ".lossless-claude", "config.json"));
        await createDaemon(config);
        console.log(`lossless-claude daemon started on port ${config.daemon.port}`);
        // Keep alive
        process.on("SIGTERM", () => exit(0));
        process.on("SIGINT", () => exit(0));
      }
      break;
    }
    case "compact": {
      const { handlePreCompact } = await import("../src/hooks/compact.js");
      const { DaemonClient } = await import("../src/daemon/client.js");
      const input = await readStdin();
      const r = await handlePreCompact(input, new DaemonClient("http://127.0.0.1:3737"));
      if (r.stdout) stdout.write(r.stdout);
      exit(r.exitCode);
      break;
    }
    case "restore": {
      const { handleSessionStart } = await import("../src/hooks/restore.js");
      const { DaemonClient } = await import("../src/daemon/client.js");
      const input = await readStdin();
      const r = await handleSessionStart(input, new DaemonClient("http://127.0.0.1:3737"));
      if (r.stdout) stdout.write(r.stdout);
      exit(r.exitCode);
      break;
    }
    case "mcp": {
      const { startMcpServer } = await import("../src/mcp/server.js");
      await startMcpServer();
      break;
    }
    case "install": {
      const { install } = await import("../installer/install.js");
      await install();
      break;
    }
    case "uninstall": {
      const { uninstall } = await import("../installer/uninstall.js");
      await uninstall();
      break;
    }
    default:
      console.error("Usage: lossless-claude <daemon|compact|restore|mcp|install|uninstall>");
      exit(1);
  }
}

main().catch((err) => { console.error(err); exit(1); });
```

- [ ] **Step 2: Commit**

```bash
git add bin/lossless-claude.ts
git commit -m "feat: add CLI entry point"
```

---

### Task 6.2: settings.json merge

**Files:**
- Create: `installer/install.ts`
- Create: `test/installer/install.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/installer/install.test.ts
import { describe, it, expect } from "vitest";
import { mergeClaudeSettings } from "../../installer/install.js";

describe("mergeClaudeSettings", () => {
  it("adds hooks and mcpServers to empty settings", () => {
    const r = mergeClaudeSettings({});
    expect(r.hooks.PreCompact[0].command).toBe("lossless-claude compact");
    expect(r.hooks.SessionStart[0].command).toBe("lossless-claude restore");
    expect(r.mcpServers["lossless-claude"]).toBeDefined();
  });

  it("preserves existing hooks", () => {
    const r = mergeClaudeSettings({ hooks: { PreCompact: [{ type: "command", command: "other" }] } });
    expect(r.hooks.PreCompact).toHaveLength(2);
    expect(r.hooks.PreCompact[0].command).toBe("other");
  });

  it("does not duplicate if already present", () => {
    const r = mergeClaudeSettings({ hooks: { PreCompact: [{ type: "command", command: "lossless-claude compact" }] } });
    expect(r.hooks.PreCompact).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/installer/install.test.ts
```

- [ ] **Step 3: Implement `installer/install.ts`**

```typescript
// installer/install.ts
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const LC_HOOK_COMPACT = { type: "command", command: "lossless-claude compact" };
const LC_HOOK_RESTORE = { type: "command", command: "lossless-claude restore" };
const LC_MCP = { command: "lossless-claude", args: ["mcp"] };

export function mergeClaudeSettings(existing: any): any {
  const settings = JSON.parse(JSON.stringify(existing));
  settings.hooks = settings.hooks ?? {};
  settings.mcpServers = settings.mcpServers ?? {};

  // Merge PreCompact
  settings.hooks.PreCompact = settings.hooks.PreCompact ?? [];
  if (!settings.hooks.PreCompact.some((h: any) => h.command === LC_HOOK_COMPACT.command)) {
    settings.hooks.PreCompact.push(LC_HOOK_COMPACT);
  }

  // Merge SessionStart
  settings.hooks.SessionStart = settings.hooks.SessionStart ?? [];
  if (!settings.hooks.SessionStart.some((h: any) => h.command === LC_HOOK_RESTORE.command)) {
    settings.hooks.SessionStart.push(LC_HOOK_RESTORE);
  }

  // Add MCP server
  settings.mcpServers["lossless-claude"] = LC_MCP;

  return settings;
}

export async function install(): Promise<void> {
  const lcDir = join(homedir(), ".lossless-claude");
  mkdirSync(lcDir, { recursive: true });

  // 1. Check cipher config
  const cipherConfig = join(homedir(), ".cipher", "cipher.yml");
  if (!existsSync(cipherConfig)) {
    console.error(`ERROR: ~/.cipher/cipher.yml not found. Install Cipher first.`);
    process.exit(1);
  }

  // 2. Check ANTHROPIC_API_KEY
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error(`ERROR: ANTHROPIC_API_KEY environment variable is not set.`);
    process.exit(1);
  }

  // 3. Create config.json if not present
  const configPath = join(lcDir, "config.json");
  if (!existsSync(configPath)) {
    const { loadDaemonConfig } = await import("../src/daemon/config.js");
    const defaults = loadDaemonConfig("/nonexistent");
    writeFileSync(configPath, JSON.stringify(defaults, null, 2));
    console.log(`Created ${configPath}`);
  }

  // 4. Merge ~/.claude/settings.json
  const settingsPath = join(homedir(), ".claude", "settings.json");
  let existing: any = {};
  if (existsSync(settingsPath)) {
    existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
  }
  const merged = mergeClaudeSettings(existing);
  writeFileSync(settingsPath, JSON.stringify(merged, null, 2));
  console.log(`Updated ${settingsPath}`);

  console.log(`\nlossless-claude installed successfully!`);
  console.log(`Run: lossless-claude daemon start`);
}
```

- [ ] **Step 4: Run and verify PASS**

```bash
npm test -- test/installer/install.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add installer/install.ts test/installer/install.test.ts
git commit -m "feat: add installer with settings.json merge"
```

---

### Task 6.3: Uninstaller

**Files:**
- Create: `installer/uninstall.ts`
- Create: `test/installer/uninstall.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
// test/installer/uninstall.test.ts
import { describe, it, expect } from "vitest";
import { removeClaudeSettings } from "../../installer/uninstall.js";

describe("removeClaudeSettings", () => {
  it("removes lossless-claude hooks and mcpServer", () => {
    const r = removeClaudeSettings({
      hooks: {
        PreCompact: [{ type: "command", command: "other" }, { type: "command", command: "lossless-claude compact" }],
        SessionStart: [{ type: "command", command: "lossless-claude restore" }],
      },
      mcpServers: { "lossless-claude": {}, "other": {} },
    });
    expect(r.hooks.PreCompact).toHaveLength(1);
    expect(r.hooks.PreCompact[0].command).toBe("other");
    expect(r.hooks.SessionStart).toHaveLength(0);
    expect(r.mcpServers["lossless-claude"]).toBeUndefined();
    expect(r.mcpServers["other"]).toBeDefined();
  });
});
```

- [ ] **Step 2: Run and verify FAIL**

```bash
npm test -- test/installer/uninstall.test.ts
```

- [ ] **Step 3: Implement `installer/uninstall.ts`**

```typescript
// installer/uninstall.ts
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export function removeClaudeSettings(existing: any): any {
  const settings = JSON.parse(JSON.stringify(existing));
  settings.hooks = settings.hooks ?? {};
  settings.mcpServers = settings.mcpServers ?? {};

  const LC_COMMANDS = new Set(["lossless-claude compact", "lossless-claude restore"]);
  for (const event of Object.keys(settings.hooks)) {
    settings.hooks[event] = settings.hooks[event].filter((h: any) => !LC_COMMANDS.has(h.command));
  }
  delete settings.mcpServers["lossless-claude"];
  return settings;
}

export async function uninstall(): Promise<void> {
  const settingsPath = join(homedir(), ".claude", "settings.json");
  if (existsSync(settingsPath)) {
    const existing = JSON.parse(readFileSync(settingsPath, "utf-8"));
    writeFileSync(settingsPath, JSON.stringify(removeClaudeSettings(existing), null, 2));
    console.log(`Removed lossless-claude from ${settingsPath}`);
  }
  console.log("lossless-claude uninstalled.");
}
```

- [ ] **Step 4: Run and verify PASS**

```bash
npm test -- test/installer/uninstall.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add installer/uninstall.ts test/installer/uninstall.test.ts
git commit -m "feat: add uninstaller"
```

---

## Chunk 7: C1/C3 Verification — Probe Hooks

### Task 7.1: PreCompact stdin probe (C1)

**Files:**
- Create: `src/hooks/probe-precompact.ts`

- [ ] **Step 1: Create probe script**

```typescript
// src/hooks/probe-precompact.ts
// Probe hook: dumps PreCompact stdin to ~/.lossless-claude/precompact-probe.json
// Install temporarily in ~/.claude/settings.json to verify hook input schema
import { writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const chunks: Buffer[] = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const raw = Buffer.concat(chunks).toString("utf-8");
  const dir = join(homedir(), ".lossless-claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "precompact-probe.json"), raw);
  process.exit(0); // exit 0 = allow native compaction
});
```

- [ ] **Step 2: Manual verification instructions**

1. Temporarily add to `~/.claude/settings.json`:
   ```json
   "PreCompact": [{ "type": "command", "command": "node /path/to/src/hooks/probe-precompact.ts" }]
   ```
2. Start a Claude Code session, write enough context to trigger compaction (or use `/compact` command)
3. Check `~/.lossless-claude/precompact-probe.json`
4. Verify fields: `session_id`, `transcript_path`, `cwd`, `hook_event_name`
5. Document schema in `docs/hook-protocol.md`

- [ ] **Step 3: Commit**

```bash
git add src/hooks/probe-precompact.ts
git commit -m "feat: add PreCompact stdin probe for C1 verification"
```

---

### Task 7.2: SessionStart source probe (C3)

**Files:**
- Create: `src/hooks/probe-sessionstart.ts`
- Create: `docs/hook-protocol.md`

- [ ] **Step 1: Create probe script**

```typescript
// src/hooks/probe-sessionstart.ts
import { appendFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

const chunks: Buffer[] = [];
process.stdin.on("data", (c) => chunks.push(c));
process.stdin.on("end", () => {
  const raw = Buffer.concat(chunks).toString("utf-8");
  const dir = join(homedir(), ".lossless-claude");
  mkdirSync(dir, { recursive: true });
  const entry = `${new Date().toISOString()} ${raw}\n`;
  appendFileSync(join(dir, "sessionstart-probe.jsonl"), entry);
  process.exit(0);
});
```

- [ ] **Step 2: Create `docs/hook-protocol.md` placeholder**

```markdown
# Claude Code Hook Protocol — Verified Schemas

## PreCompact Hook

**Status:** ⚠️ Pending verification via probe-precompact.ts

Expected fields (unverified):
- `session_id` — session identifier
- `transcript_path` — path to session JSONL transcript
- `cwd` — working directory
- `hook_event_name` — "PreCompact"

## SessionStart Hook

**Status:** ⚠️ Pending verification via probe-sessionstart.ts

Expected fields:
- `session_id`
- `cwd`
- `hook_event_name` — "SessionStart"
- `source` — "startup" | "resume" | "compact" (verify "compact" exists)
```

- [ ] **Step 3: Commit**

```bash
git add src/hooks/probe-sessionstart.ts docs/hook-protocol.md
git commit -m "feat: add SessionStart probe and hook protocol docs for C3 verification"
```

---

## Cleanup Tasks

### Task C.1: Remove OpenClaw files

- [ ] **Step 1: Delete OpenClaw-specific source files**

```bash
rm -f index.ts openclaw.plugin.json
rm -f src/engine.ts
rm -f src/tools/lcm-expand-query-tool.ts
rm -f src/expansion-auth.ts src/expansion-policy.ts
# Check if these exist before deleting
[ -f src/openclaw-bridge.ts ] && rm src/openclaw-bridge.ts
```

- [ ] **Step 2: Delete OpenClaw-specific tests (check these paths exist first)**

```bash
ls test/ | grep -E "engine|expansion-auth|expansion-policy|expand-query|plugin-config|index-complete|secret-ref"
```
Delete any that exist.

- [ ] **Step 3: Run full test suite**

```bash
npm test
```
Expected: all remaining tests PASS

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove OpenClaw-specific files"
```

---

### Task C.2: Clean up assembler.ts

- [ ] **Step 1: Read `src/assembler.ts` and identify OpenClaw imports**

Look for: `import type { ... } from "openclaw/plugin-sdk"` or similar

- [ ] **Step 2: Replace with local type**

Replace the import with a local `type AgentMessage = { role: string; content: unknown }` if needed.

- [ ] **Step 3: Run tests**

```bash
npm test
```
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/assembler.ts
git commit -m "refactor: remove OpenClaw types from assembler.ts"
```

---

### Task C.3: Strip legacy deps.complete() from summarize.ts

- [ ] **Step 1: Identify and remove `createLcmSummarizeFromLegacyParams` and all `deps.complete()` call sites**

These are the only OpenClaw-specific parts of summarize.ts. The prompt builders and system prompt must remain.

- [ ] **Step 2: Run tests**

```bash
npm test
```
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/summarize.ts
git commit -m "refactor: strip deps.complete() legacy code from summarize.ts"
```

---

### Task C.4: Full integration test

- [ ] **Step 1: Start daemon**

```bash
npm run build && node dist/bin/lossless-claude.js daemon start &
```

- [ ] **Step 2: Test health**

```bash
curl http://127.0.0.1:3737/health
```
Expected: `{"status":"ok","uptime":0}`

- [ ] **Step 3: Test compact with empty project**

```bash
echo '{"session_id":"test","cwd":"/tmp/lc-integration-test","hook_event_name":"PreCompact"}' | curl -s -X POST http://127.0.0.1:3737/compact -H 'Content-Type: application/json' -d @-
```
Expected: `{"summary":"No messages to compact."}`

- [ ] **Step 4: Test restore with empty project**

```bash
echo '{"session_id":"test","cwd":"/tmp/lc-integration-test","hook_event_name":"SessionStart"}' | curl -s -X POST http://127.0.0.1:3737/restore -H 'Content-Type: application/json' -d @-
```
Expected: context with `<memory-orientation>` only.

- [ ] **Step 5: Run full test suite one final time**

```bash
npm test
```
Expected: ALL PASS

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: full integration verified — lossless-claude Claude Code port complete"
```

---

## Dependency Graph (Parallelisation)

```
Chunk 1 (Foundation — sequential, blocks all others)
    ↓ complete
    ├── Chunk 2 (Compaction) ─── parallel with Chunk 3, 7
    ├── Chunk 3 (Restoration) ── parallel with Chunk 2, 7
    └── Chunk 7 (Verification) ─ parallel with Chunk 2, 3
          ↓ Chunks 2 + 3 complete
    └── Chunk 4 (MCP) ─────────── depends on Chunk 2 + 3 routes
          ↓ Chunk 4 complete
    └── Chunk 5 (Node.js API) ─── depends on all routes
          ↓ Chunk 5 complete
    └── Chunk 6 (Installer) ───── depends on all chunks
          ↓ Chunk 6 complete
    └── Cleanup (C.1 - C.4)
```

**Chunks 2, 3, and 7 can execute in parallel** once Chunk 1 is done.
**Chunk 4** waits for Chunks 2 + 3.
**Chunk 5** waits for Chunk 4.
**Chunk 6** waits for Chunk 5.
**Cleanup** is last.
