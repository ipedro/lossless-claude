# @ipedro/lossless-claude

## 0.6.0

### Minor Changes

- ce73e97: ### New features

  - **YAML prompt templates**: Extract all summarization prompts into editable YAML files with `{{var}}` interpolation (`src/prompts/*.yaml`)
  - **Promoted memory dedup/merge**: FTS5-based duplicate detection with LLM-powered merge, confidence decay, and archive lifecycle
  - **UserPromptSubmit hook**: Passive memory surfacing — searches promoted store on each user turn and injects relevant context as `<memory-context>` hints
  - **CLAUDE.md persistence**: Capture project instructions at session start, persist through compaction via `session_instructions` table, inject on restore
  - **Multi-session concurrency**: Shared memory across concurrent sessions with per-session compaction guards
  - **Custom agents**: 4 autonomous agents for memory operations (compact, restore, search, doctor)

  ### Fixes

  - Harden claude subprocess with proper flags (`--no-input`, timeout)
  - Fix installer tests (injectable daemon/doctor deps, remove orphaned test files)
  - Fix restore handler to include session instructions on all paths
  - Add path traversal guard to template loader
  - Correct dedup archive behavior (no phantom fresh-entry on low confidence)
  - Register all 4 hooks in settings.json (SessionEnd, UserPromptSubmit were missing — conversations not ingested)
  - Auto-heal: every hook CLI entry point validates and repairs missing hooks on each invocation
  - Upgrade skill (`/lossless-claude:upgrade`) for manual rebuild/restart/doctor

## 0.3.0

### Minor Changes

- f1dfa5c: Catch up the release notes for work merged after `0.2.8`.

  This release adds Anthropic OAuth setup-token support in the TUI, resolves
  SecretRef-backed auth-profile credentials and provider-level custom provider
  configuration during summarization, and formats LCM tool timestamps in the local
  timezone instead of UTC.
