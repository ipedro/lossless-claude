<p align="center">
  <strong>Lossless context management for Claude Code and Codex</strong><br>
  DAG-based summarization that preserves every message
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@ipedro/lossless-claude"><img src="https://img.shields.io/npm/v/@ipedro/lossless-claude" alt="npm"></a>
  <a href="LICENSE"><img src="https://img.shields.io/github/license/ipedro/lossless-claude" alt="License: MIT"></a>
  <a href="package.json"><img src="https://img.shields.io/node/v/@ipedro/lossless-claude" alt="Node"></a>
  <a href="https://github.com/anthropics/claude-code"><img src="https://img.shields.io/badge/Claude_Code-plugin-7c3aed" alt="Claude Code"></a>
</p>

<p align="center">
  <a href="https://lossless-claude.com">Website</a> &bull;
  <a href="#installation">Install</a> &bull;
  <a href="#hooks">Hooks</a> &bull;
  <a href="#mcp-tools">MCP Tools</a> &bull;
  <a href="#cli">CLI</a>
</p>

---

Replaces Claude Code's built-in sliding-window compaction with a DAG-based summarization system. Every message is preserved in SQLite, summaries form a hierarchy, and relevant context from past sessions surfaces automatically.

The backend memory model now supports both Claude Code and Codex. Claude still integrates through hooks and transcript ingestion; Codex uses the `lossless-codex` wrapper for live structured turn ingestion into the same project memory.

**It feels like talking to an agent that never forgets. Because it doesn't.**

This is a fork of [lossless-claw](https://github.com/Martian-Engineering/lossless-claude) by [Martian Engineering](https://martian.engineering), rewired for Claude Code's plugin system. The DAG architecture and the LCM model come from the [Voltropy paper](https://papers.voltropy.com/LCM). For a visual explanation, see [losslesscontext.ai](https://losslesscontext.ai).

## How It Works

| Step | What happens |
|------|-------------|
| **Persist** | Every message stored in SQLite, organized by conversation |
| **Summarize** | Older messages grouped into leaf summaries via your configured LLM |
| **Condense** | Summaries roll up into higher-level DAG nodes as they accumulate |
| **Promote** | Key decisions promoted to a cross-session knowledge store (FTS5) |
| **Restore** | Each session assembles context from summaries + recent messages + promoted knowledge |
| **Recall** | Agents search, drill into, and recover any detail on demand |

Nothing is lost. Raw messages stay in the database. Summaries link back to their sources. Agents can drill into any summary to recover the original detail.

## Installation

### Prerequisites

- Claude Code
- Codex CLI for `lossless-codex`
- Node.js 22+

### Marketplace (recommended)

```bash
claude plugin marketplace add ipedro/xgh-marketplace
claude plugin install lossless-claude
```

### Standalone

```bash
claude plugin add github:ipedro/lossless-claude
```

### Setup

Both methods register hooks and MCP server automatically. Then run the setup wizard:

```bash
lossless-claude install
```

### Codex wrapper

Install the wrapper from this package:

```bash
npm install -g @ipedro/lossless-claude
```

Make sure the Codex CLI is also installed and available on your `PATH`, then run Codex through the wrapper:

```bash
lossless-codex "Reply only with OK"
```

`lossless-codex` wraps `codex exec` and opportunistically uses `codex exec resume` when a native Codex session ID is available, giving Codex the same shared project memory model used by multiple Claude sessions.

### Integration model

- Claude Code uses hooks plus Claude transcript ingestion.
- Codex uses the `lossless-codex` wrapper plus live structured turn ingestion.
- Both paths write into the same project SQLite database and promoted memory store.

## Hooks

Four hooks manage the full conversation lifecycle. All hooks auto-heal: each validates that all 4 are registered in `settings.json` before executing, silently repairing any that were removed.

| Hook | Command | What it does |
|------|---------|-------------|
| **PreCompact** | `lossless-claude compact` | Intercepts compaction, runs LLM summarization into a DAG, returns the summary |
| **SessionStart** | `lossless-claude restore` | Restores project context + recent summaries + promoted memories |
| **SessionEnd** | `lossless-claude session-end` | Ingests the session transcript for future recall |
| **UserPromptSubmit** | `lossless-claude user-prompt` | Searches promoted memory, surfaces relevant `<memory-context>` hints |

### Lifecycle

```
SessionStart ──→ conversation ──→ UserPromptSubmit (each turn)
                                         │
                               PreCompact (when context fills)
                                         │
                              SessionEnd (conversation exits)
```

### Compaction

Compaction is **incremental** — not a bulk dump when the window fills up.

- **Leaf pass:** once enough raw messages accumulate, they're grouped into a leaf summary
- **Condensation:** leaf summaries roll up into higher-level DAG nodes
- **Depth:** condensation cascades as deep as needed after each pass

The context window stays within threshold at all times. The raw history lives in SQLite, represented by summaries.

## MCP Tools

| Tool | Description |
|------|-------------|
| `lcm_search` | Search across episodic and promoted knowledge |
| `lcm_grep` | Search conversation history by keyword or regex |
| `lcm_expand` | Drill into a summary to recover original messages |
| `lcm_describe` | Describe the current DAG structure |
| `lcm_store` | Write to the promoted knowledge store |
| `lcm_stats` | Memory inventory, compression ratios, and usage statistics |
| `lcm_doctor` | Diagnostics — checks daemon, hooks, MCP, and summarizer |

## CLI

```bash
lossless-claude install                # Setup wizard
lossless-claude doctor                 # Run diagnostics
lossless-claude stats                  # Memory and compression overview
lossless-claude stats -v               # Per-conversation breakdown
lossless-claude status                 # Daemon and provider status
lossless-claude daemon start --detach  # Start daemon (background)
lossless-claude compact                # PreCompact hook handler
lossless-claude restore                # SessionStart hook handler
lossless-claude session-end            # SessionEnd hook handler
lossless-claude user-prompt            # UserPromptSubmit hook handler
lossless-claude mcp                    # Start MCP server
lossless-claude -v                     # Version
lossless-codex "your prompt"           # Run Codex with shared LCM memory
```

## Configuration

All environment variables are optional — defaults work well out of the box.

| Variable | Default | Description |
|----------|---------|-------------|
| `LCM_CONTEXT_THRESHOLD` | `0.75` | Context fill ratio that triggers compaction |
| `LCM_FRESH_TAIL_COUNT` | `32` | Recent messages protected from compaction |
| `LCM_LEAF_MIN_FANOUT` | `8` | Minimum raw messages per leaf summary |
| `LCM_CONDENSED_MIN_FANOUT` | `4` | Minimum summaries per condensed node |
| `LCM_INCREMENTAL_MAX_DEPTH` | `0` | Condensation depth (0 = leaf only, -1 = unlimited) |
| `LCM_LEAF_CHUNK_TOKENS` | `20000` | Max source tokens per leaf chunk |
| `LCM_LEAF_TARGET_TOKENS` | `1200` | Target tokens for leaf summaries |
| `LCM_CONDENSED_TARGET_TOKENS` | `2000` | Target tokens for condensed summaries |
| `LCM_SUMMARY_MODEL` | `claude-haiku-4-5` | Model for summarization |
| `LCM_SUMMARY_PROVIDER` | `claude-cli` | Provider: `claude-cli`, `anthropic`, or `openai` |

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npx vitest           # Run tests
npx tsc --noEmit     # Type check
```

### Project Structure

```
bin/
  lossless-claude.ts          # CLI entry point
  lossless-codex.ts           # Codex wrapper entry point
src/
  adapters/
    codex.ts                  # Codex JSONL normalization + session runner
  compaction.ts               # CompactionEngine — leaf passes, condensation, sweeps
  summarize.ts                # Depth-aware prompt generation and LLM summarization
  expansion.ts                # DAG expansion for lcm_expand
  stats.ts                    # Memory and compression statistics
  daemon/
    server.ts                 # HTTP daemon (routes, lifecycle)
    config.ts                 # Configuration loader
    client.ts                 # HTTP client for daemon
    lifecycle.ts              # ensureDaemon() — lazy daemon spawning
    routes/                   # Route handlers
  db/
    migration.ts              # SQLite schema migrations
    promoted.ts               # PromotedStore — cross-session knowledge (FTS5)
  hooks/
    auto-heal.ts              # Hook validation and auto-repair
    compact.ts                # PreCompact handler
    dispatch.ts               # Hook dispatcher with auto-heal wiring
    restore.ts                # SessionStart handler
    session-end.ts            # SessionEnd handler
    user-prompt.ts            # UserPromptSubmit handler
  mcp/
    server.ts                 # MCP server (stdio transport)
    tools/                    # MCP tool definitions
  store/
    conversation-store.ts     # Message persistence
    summary-store.ts          # Summary DAG persistence
installer/
  install.ts                  # Setup wizard
  uninstall.ts                # Cleanup
test/                         # Vitest test suite
.claude-plugin/
  plugin.json                 # Plugin manifest
  hooks/                      # Hook documentation
  skills/                     # Plugin skills
  commands/                   # Slash commands
```

## Acknowledgments

lossless-claude stands on the shoulders of [lossless-claw](https://github.com/Martian-Engineering/lossless-claude), the original implementation by [Martian Engineering](https://martian.engineering). The DAG-based compaction architecture, the LCM memory model, and the foundational design decisions all originate there. This fork would not exist without their work — we're grateful for it and for making it open source.

The underlying theory comes from the [LCM paper](https://papers.voltropy.com/LCM) by [Voltropy](https://x.com/Voltropy).

## License

MIT
