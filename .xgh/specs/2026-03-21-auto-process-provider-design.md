# Auto Process Provider Resolution

> Date: 2026-03-21
> Status: Approved (design phase)
> Related work: `lossless-codex` wrapper, `claude-process` summarizer, `../xgh/commands/codex.md`, `../xgh/skills/codex/codex.md`, `../xgh/tests/test-codex-dispatch.sh`

## Summary

Add a `codex-process` summarizer and shift process-based providers from primary user-facing choices to runtime defaults.

The user-visible default becomes `llm.provider = "auto"`:

- Claude hook flows resolve `auto -> claude-process`
- Codex wrapper flows resolve `auto -> codex-process`
- Explicit user overrides (`anthropic`, `openai`, `disabled`, or a manually pinned process provider) win for both CLIs

Caller identity stays at the route layer. `/compact` accepts an optional `client?: "claude" | "codex"` field, and the compact handler resolves the effective provider per request. The summarizer interface remains unchanged.

## Problem

The current provider model assumes Claude as the only native CLI runtime:

- `config.ts` only supports `"claude-process" | "anthropic" | "openai" | "disabled"`
- `compact.ts` resolves the summarizer once at handler creation time
- compact requests do not identify whether the caller is Claude or Codex

That creates two mismatches:

1. `lossless-codex` can share memory, but compaction still defaults to the Claude CLI path
2. The shared config cannot express "use the native CLI for whichever client is driving this request"

## Goals

- Make `auto` the default summarizer mode
- Add `codex-process` as a first-class concrete provider
- Resolve `auto` per compact request based on the caller
- Keep `LcmSummarizeFn` and compaction engine interfaces unchanged
- Keep explicit provider overrides global and deterministic across both CLIs

## Non-goals

- Changing `/restore`, `/prompt-search`, `/ingest`, `/search`, or promoted memory semantics
- Making the daemon infer caller identity from PID ancestry, sockets, or environment heuristics
- Turning `codex-process` into an HTTP/OpenAI-compatible provider
- Removing explicit `claude-process` / `codex-process` support from manual config immediately

## 1. Request Contract

### `/compact` request body

Extend the compact request body with:

```ts
type CompactRequest = {
  session_id: string;
  cwd: string;
  transcript_path?: string;
  skip_ingest?: boolean;
  client?: "claude" | "codex";
};
```

### Resolution semantics

```text
auto + client=codex  -> codex-process
auto + client=claude -> claude-process
auto + no client     -> claude-process
explicit provider    -> explicit provider (client ignored)
```

### Rationale

- Per-request resolution is necessary because `auto` depends on the caller
- The caller already knows what it is; the daemon should not guess
- Backward compatibility is preserved because missing `client` falls back to current Claude behavior

### Caller updates

The two compact callers must send `client` explicitly:

- [src/hooks/compact.ts](/Users/pedro/Developer/lossless-claude/src/hooks/compact.ts) sends `client: "claude"`
- [src/adapters/codex.ts](/Users/pedro/Developer/lossless-claude/src/adapters/codex.ts) sends `client: "codex"`

The fallback for missing `client` remains in place for older callers and tests.

## 2. Config Semantics

### Provider union

Change the config union to:

```ts
type LlmProvider =
  | "auto"
  | "claude-process"
  | "codex-process"
  | "anthropic"
  | "openai"
  | "disabled";
```

### Default config

Change the default from `claude-process` to `auto`.

```ts
llm: { provider: "auto", model: "", apiKey: "", baseURL: "" }
```

### Meaning of `auto`

`auto` means:

- use the native Claude CLI summarizer for Claude-driven compactions
- use the native Codex CLI summarizer for Codex-driven compactions
- if caller identity is missing, preserve old behavior and use Claude

### Meaning of `llm.model`

`llm.model` remains a cross-CLI override:

- if non-empty, pass it to whichever concrete provider is effective
- if empty and effective provider is a process provider, let the native CLI use its own configured default model

This preserves one shared config while still allowing explicit model pinning.

### User-facing positioning

`claude-process` and `codex-process` become concrete fallback/runtime providers, not the primary user-facing choice.

Implications:

- installer presents `auto` as the default choice
- README describes "native CLI default" rather than `claude-process` as the default mode
- doctor/status display `auto` as the configured mode and explain its effective mapping

Manual pinning to `claude-process` or `codex-process` remains supported for debugging, advanced users, and backward compatibility.

## 3. Route-Level Resolution And Memoization

### Design choice

Resolve the effective provider in the compact route, not inside `LcmSummarizeFn`.

That means:

- no new `client` field in summarizer context
- no change to `CompactionEngine`
- caller identity stays local to the daemon route

### Implementation shape

Replace eager one-time resolution in [src/daemon/routes/compact.ts](/Users/pedro/Developer/lossless-claude/src/daemon/routes/compact.ts):

```ts
const summarizeP = resolveSummarizer(config);
```

with a route-local resolver that memoizes by concrete provider:

```ts
type CompactClient = "claude" | "codex";
type ConcreteProvider =
  | "claude-process"
  | "codex-process"
  | "anthropic"
  | "openai"
  | "disabled";

function resolveEffectiveProvider(
  configured: LlmProvider,
  client?: CompactClient,
): ConcreteProvider

function createSummarizerCache(config: DaemonConfig): {
  get(client?: CompactClient): Promise<LcmSummarizeFn | null>;
}
```

### Memoization rules

- Cache by resolved concrete provider, not by request
- `auto + codex` and explicit `codex-process` share the same cached summarizer instance
- `auto + claude` and explicit `claude-process` share the same cached summarizer instance
- `anthropic`, `openai`, and `disabled` continue to behave as global explicit providers

This preserves per-request correctness without rebuilding process/API clients on every compaction.

## 4. `codex-process` Summarizer

### Provider type

Add:

- [src/llm/codex-process.ts](/Users/pedro/Developer/lossless-claude/src/llm/codex-process.ts)

This is analogous to [src/llm/claude-process.ts](/Users/pedro/Developer/lossless-claude/src/llm/claude-process.ts), but shells out to `codex`.

### Invocation contract

Use the Codex CLI's non-interactive mode rather than JSONL event parsing for summarization.

Recommended command shape:

```bash
codex exec - \
  --skip-git-repo-check \
  --sandbox read-only \
  --output-last-message /tmp/lcm-codex-summary-XXXX.txt
```

Behavior:

- write the summarization prompt to stdin using `-`
- optionally add `--model <model>` when `llm.model` is non-empty
- read final summary text from `--output-last-message`
- treat stdout/stderr as diagnostics, not the primary content channel

### Why this path

- It is closer to `claude-process` than using HTTP
- It avoids JSONL event parsing in the summarizer path
- It matches the Codex CLI contract validated in local help and the related `xgh` Codex integration: thin subprocess invocation, explicit preflight, contract tests

### Prompting and tools

`codex-process` should use the same LCM summarizer prompt builders and system prompt as other providers. The process wrapper is transport-only.

Unlike `claude-process`, the Codex CLI does not currently expose the same explicit "disable tools entirely" flags. The wrapper should therefore:

- use `--sandbox read-only`
- rely on the summarization prompt to instruct no repository changes or tool use
- time out and fail if the CLI does not return a final message

### Errors and timeouts

`codex-process` should mirror `claude-process` behavior:

- non-zero exit -> reject with a bounded stderr summary
- timeout -> kill child and reject
- empty last message -> reject
- missing `codex` binary -> reject with a friendly prerequisite error

Friendly missing-binary guidance should match the wrapper tone:

```text
Codex CLI is not installed or not on PATH.
Install it first, for example: npm install -g @openai/codex
```

## 5. Installer, Doctor, Status, And README

### Installer

Update the summarizer picker in [installer/install.ts](/Users/pedro/Developer/lossless-claude/installer/install.ts):

- default/non-TTY path writes `provider: "auto"`
- user-facing label becomes something like:
  - `Automatic (Claude uses Claude CLI, Codex uses Codex CLI)`
- Anthropic API and custom OpenAI-compatible server remain explicit choices

Do not make users choose between `claude-process` and `codex-process` during normal setup.

### Doctor

Update [src/doctor/doctor.ts](/Users/pedro/Developer/lossless-claude/src/doctor/doctor.ts):

- accept `auto` as a valid configured provider
- report configured provider as:
  - `auto (Claude -> claude-process, Codex -> codex-process)`
- when `auto` is configured:
  - check for `claude` CLI availability
  - check for `codex` CLI availability
  - emit warnings or pass/fail messaging separately rather than pretending there is one single process dependency

For explicit providers:

- `claude-process` -> check only `claude`
- `codex-process` -> check only `codex`
- `anthropic` / `openai` -> keep existing API key/baseURL checks

### Status

Update `lossless-claude status` output to avoid implying the configured provider is always the concrete one in use.

For `auto`, show the configured mode rather than collapsing it:

```text
daemon: up · provider: auto (Claude->claude-process, Codex->codex-process)
```

### README / docs

Update:

- [README.md](/Users/pedro/Developer/lossless-claude/README.md)
- [docs/configuration.md](/Users/pedro/Developer/lossless-claude/docs/configuration.md)

Key doc changes:

- stop calling `claude-process` / `claude-cli` the default user choice
- document `auto` as the default summarizer mode
- explain that explicit provider overrides apply to both Claude and Codex
- document `codex-process` as an advanced/manual pin, not the normal setup choice

## 6. Tests

### Config tests

Update [test/daemon/config.test.ts](/Users/pedro/Developer/lossless-claude/test/daemon/config.test.ts):

- defaults to `auto`
- accepts `codex-process`
- accepts `LCM_SUMMARY_PROVIDER=auto`
- preserves explicit override semantics

### Compact route tests

Extend [test/daemon/routes/compact.test.ts](/Users/pedro/Developer/lossless-claude/test/daemon/routes/compact.test.ts):

- `auto + client=claude -> claude-process`
- `auto + client=codex -> codex-process`
- `auto + no client -> claude-process`
- explicit provider ignores `client`
- concrete providers are memoized by resolved provider, not rebuilt every request

These should stay contract-level and mock the concrete summarizer factories.

### `codex-process` unit tests

Add:

- [test/llm/codex-process.test.ts](/Users/pedro/Developer/lossless-claude/test/llm/codex-process.test.ts)

Coverage:

- spawns `codex exec - --skip-git-repo-check --sandbox read-only`
- passes `--model` when configured
- resolves with last-message file contents
- rejects on timeout
- rejects on non-zero exit
- rejects on empty output
- returns friendly message on missing binary

### Claude and Codex caller tests

Update:

- [src/hooks/compact.ts](/Users/pedro/Developer/lossless-claude/src/hooks/compact.ts) tests or add new ones to verify `client: "claude"` is posted
- [test/adapters/codex.test.ts](/Users/pedro/Developer/lossless-claude/test/adapters/codex.test.ts) to verify `/compact` posts `client: "codex"`

### Installer and doctor tests

Update:

- [test/installer/install.test.ts](/Users/pedro/Developer/lossless-claude/test/installer/install.test.ts)
- doctor tests under [test/doctor](/Users/pedro/Developer/lossless-claude/test/doctor)

Coverage:

- default installer output writes `provider: "auto"`
- doctor output correctly explains auto mode
- doctor checks both CLI dependencies in auto mode

## 7. Files Changed

| File | Change |
|------|--------|
| `src/daemon/config.ts` | Add `auto` + `codex-process`, default provider becomes `auto` |
| `src/daemon/routes/compact.ts` | Add `client` request support, per-request provider resolution, memoized summarizer cache |
| `src/llm/codex-process.ts` | New Codex CLI summarizer |
| `src/hooks/compact.ts` | Send `client: "claude"` |
| `src/adapters/codex.ts` | Send `client: "codex"` on `/compact` |
| `src/doctor/doctor.ts` | Explain/check auto mode and Codex CLI dependency |
| `installer/install.ts` | Default to `auto`, update picker copy |
| `README.md` | Document `auto` as the default summarizer mode |
| `docs/configuration.md` | Update provider documentation |
| `test/daemon/config.test.ts` | New provider semantics |
| `test/daemon/routes/compact.test.ts` | Auto-resolution and memoization tests |
| `test/llm/codex-process.test.ts` | New subprocess summarizer tests |
| `test/adapters/codex.test.ts` | Verify `/compact` caller identity |
| `test/installer/install.test.ts` | Installer default becomes `auto` |
| `test/doctor/*` | Auto-mode doctor coverage |

## 8. Design Notes From `../xgh`

Three lessons from the related `xgh` Codex integration are worth preserving here:

1. **Thin CLI contract beats over-abstraction**
   - `xgh` treats Codex as an explicit subprocess contract, not a hidden transport layer
2. **Preflight missing binaries explicitly**
   - missing `codex` should produce a setup error, not a raw spawn failure
3. **Test the stable contract**
   - narrow tests around spawn flags, prerequisites, and dispatch behavior are more durable than attempting to simulate the whole agent

That is the same posture this design takes for `codex-process`.
