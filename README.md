# lossless-claude

[![npm](https://img.shields.io/npm/v/@ipedro/lossless-claude)](https://www.npmjs.com/package/@ipedro/lossless-claude)
[![license](https://img.shields.io/github/license/ipedro/lossless-claude)](LICENSE)
[![node](https://img.shields.io/node/v/@ipedro/lossless-claude)](package.json)
[![Claude Code](https://img.shields.io/badge/Claude_Code-plugin-7c3aed)](https://github.com/anthropics/claude-code)

A fork and reinterpretation of [lossless-claw](https://github.com/Martian-Engineering/lossless-claude) by [Martian Engineering](https://martian.engineering), adapted for [Claude Code](https://github.com/anthropics/claude-code). The core ideas — DAG-based summarization, lossless message retention, and the LCM model from [Voltropy](https://x.com/Voltropy) — are theirs. This fork rewires the integration layer for Claude Code's plugin system and ships as a native Claude Code plugin.

Replaces Claude Code's built-in sliding-window compaction with a DAG-based summarization system that preserves every message while keeping active context within model token limits.

## Table of contents

- [What it does](#what-it-does)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [MCP tools](#mcp-tools)
- [CLI](#cli)
- [Development](#development)
- [License](#license)

## What it does

For a visual explanation, check out [this animated visualization](https://losslesscontext.ai) by [Martian Engineering](https://martian.engineering) (the original lossless-claw authors).

When a conversation grows beyond the model's context window, Claude Code normally truncates older messages. LCM instead:

1. **Persists every message** in a SQLite database, organized by conversation
2. **Summarizes chunks** of older messages into summaries using your configured LLM
3. **Condenses summaries** into higher-level nodes as they accumulate, forming a DAG (directed acyclic graph)
4. **Promotes key decisions** to a cross-session knowledge store (SQLite FTS5)
5. **Assembles context** each turn by combining summaries + recent raw messages + promoted knowledge
6. **Provides tools** (`lcm_grep`, `lcm_expand`, `lcm_describe`, `lcm_search`, `lcm_store`, `lcm_stats`, `lcm_doctor`) so agents can search, recall, and diagnose

Nothing is lost. Raw messages stay in the database. Summaries link back to their source messages. Agents can drill into any summary to recover the original detail.

### How compaction is triggered

Compaction is **incremental and post-turn** — not a bulk dump when the window fills up.

After every turn, the engine checks whether there's enough material to compact:

- **Leaf pass:** once `LCM_LEAF_MIN_FANOUT` (default: 8) raw messages accumulate without a summary, they're grouped into a leaf summary
- **Condensation:** once `LCM_CONDENSED_MIN_FANOUT` (default: 4) leaf summaries accumulate, they condense into a higher-level DAG node — and so on up the tree
- **Depth:** `LCM_INCREMENTAL_MAX_DEPTH=-1` lets condensation cascade as deep as needed after each pass

The context delivered to the model each turn is **assembled fresh** from summaries + recent raw messages (`LCM_FRESH_TAIL_COUNT`, default: 32) + promoted knowledge. The raw history never accumulates in the context window — it lives in SQLite and is represented by summaries instead.

The result: the context window never "fills up and dumps". It stays within `LCM_CONTEXT_THRESHOLD` (default: 75%) at all times.

**It feels like talking to an agent that never forgets. Because it doesn't.**

## Quick start

### Prerequisites

- Claude Code
- Node.js 22+

### Install

**Via marketplace (recommended):**

```bash
claude plugin marketplace add ipedro/xgh-marketplace
claude plugin install lossless-claude
```

**Standalone:**

```bash
claude plugin add github:ipedro/lossless-claude
```

Both methods register the plugin's hooks (PreCompact, SessionStart, SessionEnd, UserPromptSubmit) and MCP server automatically.

Then run the setup wizard to configure your summarizer:

```bash
lossless-claude install
```

## Configuration

LCM is configured through environment variables. All are optional — defaults work well out of the box.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `LCM_ENABLED` | `true` | Enable/disable the plugin |
| `LCM_CONTEXT_THRESHOLD` | `0.75` | Fraction of context window that triggers compaction (0.0-1.0) |
| `LCM_FRESH_TAIL_COUNT` | `32` | Number of recent messages protected from compaction |
| `LCM_LEAF_MIN_FANOUT` | `8` | Minimum raw messages per leaf summary |
| `LCM_CONDENSED_MIN_FANOUT` | `4` | Minimum summaries per condensed node |
| `LCM_CONDENSED_MIN_FANOUT_HARD` | `2` | Relaxed fanout for forced compaction sweeps |
| `LCM_INCREMENTAL_MAX_DEPTH` | `0` | How deep incremental compaction goes (0 = leaf only, -1 = unlimited) |
| `LCM_LEAF_CHUNK_TOKENS` | `20000` | Max source tokens per leaf compaction chunk |
| `LCM_LEAF_TARGET_TOKENS` | `1200` | Target token count for leaf summaries |
| `LCM_CONDENSED_TARGET_TOKENS` | `2000` | Target token count for condensed summaries |
| `LCM_MAX_EXPAND_TOKENS` | `4000` | Token cap for sub-agent expansion queries |
| `LCM_LARGE_FILE_TOKEN_THRESHOLD` | `25000` | File blocks above this size are stored separately |
| `LCM_SUMMARY_MODEL` | `claude-haiku-4-5` | Model for summarization |
| `LCM_SUMMARY_PROVIDER` | `claude-cli` | Provider: `claude-cli`, `anthropic`, or `openai` |
| `LCM_AUTOCOMPACT_DISABLED` | `false` | Disable automatic compaction after turns |

### Recommended starting configuration

```
LCM_FRESH_TAIL_COUNT=32
LCM_INCREMENTAL_MAX_DEPTH=-1
LCM_CONTEXT_THRESHOLD=0.75
```

- **freshTailCount=32** protects the last 32 messages from compaction, giving the model enough recent context for continuity.
- **incrementalMaxDepth=-1** enables unlimited automatic condensation after each compaction pass — the DAG cascades as deep as needed.
- **contextThreshold=0.75** triggers compaction when context reaches 75% of the model's window, leaving headroom for the response.

## MCP tools

| Tool | Description |
|------|-------------|
| `lcm_grep` | Search conversation history by keyword or regex |
| `lcm_expand` | Drill into a summary to recover original messages |
| `lcm_describe` | Describe the current DAG structure |
| `lcm_search` | Search across episodic and promoted knowledge |
| `lcm_store` | Write to the promoted knowledge store |
| `lcm_stats` | Memory inventory, compression ratios, and usage statistics |
| `lcm_doctor` | Diagnostics — checks daemon, hooks, MCP, and summarizer |

## CLI

```bash
lossless-claude install          # Setup wizard (summarizer config + doctor)
lossless-claude doctor           # Run diagnostics
lossless-claude stats            # Memory and compression overview
lossless-claude stats -v         # Per-conversation breakdown
lossless-claude status           # Daemon and provider status
lossless-claude daemon start     # Start daemon (foreground)
lossless-claude daemon start --detach  # Start daemon (background)
lossless-claude mcp              # Start MCP server (used by plugin system)
lossless-claude compact          # Handle PreCompact hook (stdin)
lossless-claude restore          # Handle SessionStart hook (stdin)
lossless-claude session-end      # Handle SessionEnd hook (stdin)
lossless-claude user-prompt      # Handle UserPromptSubmit hook (stdin)
lossless-claude -v               # Version
```

## Development

```bash
npm install          # Install dependencies
npm run build        # Compile TypeScript
npx vitest           # Run tests
npx tsc --noEmit     # Type check
```

### Project structure

```
bin/
  lossless-claude.ts          # CLI entry point
src/
  assembler.ts                # Context assembly (summaries + messages -> model context)
  compaction.ts               # CompactionEngine — leaf passes, condensation, sweeps
  summarize.ts                # Depth-aware prompt generation and LLM summarization
  retrieval.ts                # RetrievalEngine — grep, describe, expand operations
  expansion.ts                # DAG expansion logic for lcm_expand
  large-files.ts              # File interception, storage, and exploration summaries
  integrity.ts                # DAG integrity checks and repair utilities
  stats.ts                    # Memory and compression statistics
  daemon/
    server.ts                 # HTTP daemon (routes, lifecycle)
    config.ts                 # DaemonConfig type and loader
    client.ts                 # HTTP client for daemon communication
    lifecycle.ts              # ensureDaemon() — lazy daemon spawning
    project.ts                # Project path and ID resolution
    routes/                   # Route handlers (compact, search, store, restore, etc.)
  db/
    migration.ts              # SQLite schema migrations
    promoted.ts               # PromotedStore — cross-session knowledge (FTS5)
  doctor/
    doctor.ts                 # Installation diagnostics
  hooks/
    auto-heal.ts              # Hook validation and auto-repair
    compact.ts                # PreCompact hook handler
    dispatch.ts               # Hook dispatcher with auto-heal wiring
    restore.ts                # SessionStart hook handler
    session-end.ts            # SessionEnd hook handler
    user-prompt.ts            # UserPromptSubmit hook handler
  mcp/
    server.ts                 # MCP server (stdio transport)
    tools/                    # MCP tool definitions
  promotion/
    detector.ts               # Decides what summaries to promote to cross-session store
  store/
    conversation-store.ts     # Message persistence and retrieval
    summary-store.ts          # Summary DAG persistence
    fts5-sanitize.ts          # FTS5 query sanitization
  llm/
    anthropic.ts              # Anthropic API provider
    openai.ts                 # OpenAI-compatible provider
installer/
  install.ts                  # Setup wizard
  uninstall.ts                # Cleanup
test/                         # Vitest test suite
.claude-plugin/
  plugin.json                 # Claude Code plugin manifest
```

## Acknowledgments

lossless-claude stands on the shoulders of [lossless-claw](https://github.com/Martian-Engineering/lossless-claude), the original implementation by [Martian Engineering](https://martian.engineering). The DAG-based compaction architecture, the LCM memory model, and the foundational design decisions all originate there. This fork would not exist without their work — we're grateful for it and for making it open source.

The underlying theory comes from the [LCM paper](https://papers.voltropy.com/LCM) by [Voltropy](https://x.com/Voltropy).

## License

MIT
