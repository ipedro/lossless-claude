# Summarizer Picker — Design Spec

**Date**: 2026-03-18
**Scope**: Let users choose how lossless-claude summarizes conversations: Anthropic API, local model, or custom OpenAI-compatible server.

---

## Problem

The compaction summarizer is hardcoded to the Anthropic API (`createAnthropicSummarizer`). Users running a local model stack (vllm-mlx / ollama) must still provide an Anthropic key just for summarization — an unnecessary dependency.

---

## Approach

Add `provider: "anthropic" | "openai"` and `baseURL?: string` to `DaemonConfig.llm`. Add a `createOpenAISummarizer` that calls any OpenAI-compatible endpoint. Branch in `compact.ts` based on provider. Add an interactive picker to `install.ts` (after setup.sh, before writing `config.json`) using Node.js readline.

---

## Config Shape

### Current `~/.lossless-claude/config.json` (llm section)

```json
{
  "llm": {
    "model": "claude-haiku-4-5-20251001",
    "apiKey": ""
  }
}
```

### New

```json
{
  "llm": {
    "provider": "anthropic",
    "model": "claude-haiku-4-5-20251001",
    "apiKey": "",
    "baseURL": ""
  }
}
```

- `provider` defaults to `"anthropic"` for backwards compatibility (existing installs keep working)
- `baseURL` is used when `provider = "openai"`; ignored when `provider = "anthropic"`
- `apiKey` is used when `provider = "anthropic"`; may be empty for local servers

---

## Components

### 1. `src/daemon/config.ts`

Extend `DaemonConfig.llm`:

```typescript
llm: {
  provider: "anthropic" | "openai";
  model: string;
  apiKey: string;
  baseURL: string;
};
```

Update `DEFAULTS`:

```typescript
llm: { provider: "anthropic", model: "claude-haiku-4-5-20251001", apiKey: "", baseURL: "" }
```

`loadDaemonConfig` already deep-merges from file + env. No other changes needed — `provider` and `baseURL` are just new fields that merge cleanly.

### 2. `src/llm/openai.ts` (new)

Mirrors `src/llm/anthropic.ts` but uses the `openai` npm package:

```typescript
import OpenAI from "openai";

type OpenAISummarizerOptions = {
  model: string;
  baseURL: string;
  apiKey?: string;
  _clientOverride?: any;
  _retryDelayMs?: number;
};

export function createOpenAISummarizer(opts: OpenAISummarizerOptions): LcmSummarizeFn {
  const client = opts._clientOverride ?? new OpenAI({
    baseURL: opts.baseURL,
    apiKey: opts.apiKey || "local",  // local servers often require a non-empty key
  });
  // ... same retry loop as anthropic.ts, using client.chat.completions.create
}
```

Uses the same `LcmSummarizeFn` type and same prompt builders (`buildLeafSummaryPrompt`, `buildCondensedSummaryPrompt`). Same retry logic (3 attempts, exponential backoff, no retry on 401).

### 3. `src/daemon/routes/compact.ts`

Replace:
```typescript
const summarize = createAnthropicSummarizer(config.llm);
```

With:
```typescript
const summarize = config.llm.provider === "openai"
  ? createOpenAISummarizer({ model: config.llm.model, baseURL: config.llm.baseURL, apiKey: config.llm.apiKey })
  : createAnthropicSummarizer(config.llm);
```

### 4. `installer/install.ts` — summarizer picker

Added as a new step between setup.sh and writing `config.json`. Uses Node.js `readline/promises` (built-in, no extra deps):

```
  ─── Summarizer (for conversation compaction)

  1) Anthropic API     (best quality — requires API key)
  2) Local model       (reuse your vllm-mlx / ollama endpoint)
  3) Custom server     (any OpenAI-compatible URL)

  Pick [1]:
```

**Option 1 — Anthropic:**
- Read `ANTHROPIC_API_KEY` from env as default; if not set, prompt "Enter Anthropic API key:"
- Model: `claude-haiku-4-5-20251001` (hardcoded default, good quality/cost for summarization)
- Writes to config: `{ provider: "anthropic", model: "...", apiKey: "${ANTHROPIC_API_KEY}", baseURL: "" }`
- Note: `apiKey` is stored as the literal string `"${ANTHROPIC_API_KEY}"` so the daemon resolves it from env at runtime — the key is never persisted in plaintext (existing behavior preserved)

**Option 2 — Local model:**
- Reads `baseURL` and `model` from `~/.cipher/cipher.yml` (written by setup.sh)
- YAML parsing: simple regex/line scan (no yaml lib dependency) — extract `llm.baseURL` and `llm.model`
- For ollama: append `/v1` if baseURL doesn't already include it (ollama supports OpenAI-compat at `/v1`)
- Writes to config: `{ provider: "openai", model: "<from cipher.yml>", apiKey: "", baseURL: "<from cipher.yml>" }`

**Option 3 — Custom server:**
- Prompt: "Server URL (e.g. http://192.168.1.x:8080/v1):"
- Prompt: "Model name:"
- Writes to config: `{ provider: "openai", model: "<entered>", apiKey: "", baseURL: "<entered>" }`

**Non-interactive / dry-run fallback:**
- If stdin is not a TTY (`!process.stdin.isTTY`), default to Option 1 (Anthropic) silently — preserves existing headless install behavior
- `DryRunServiceDeps` skips the picker entirely and prints `[dry-run] would configure summarizer: <provider>` based on env

**Removing the old `ANTHROPIC_API_KEY` warning:**
The existing warning `"ANTHROPIC_API_KEY is not set"` in `install.ts` is removed. It's only relevant if the user chose Option 1, in which case the picker itself handles the prompt/warning.

---

## Backwards Compatibility

- Existing `config.json` files without `provider` default to `"anthropic"` via `deepMerge` with `DEFAULTS` — no migration needed
- Existing installs without `baseURL` in config still work — `baseURL: ""` is the default

---

## Testing

- **Unit: `createOpenAISummarizer`** — mock `openai` client, assert correct prompt sent, retry on 5xx, no retry on 401
- **Unit: `compact.ts` branching** — mock both summarizers, assert correct one called based on `config.llm.provider`
- **Unit: `loadDaemonConfig`** — assert `provider` and `baseURL` merge correctly from file and defaults
- **Integration: installer picker** — mock readline, assert each option writes correct `config.json` shape
- **Integration: Option 2 cipher.yml parsing** — write a temp cipher.yml, assert correct baseURL/model extracted

---

## Out of Scope

- Letting users change the summarizer model separately from the cipher LLM model
- Streaming summarization
- Per-project summarizer config
