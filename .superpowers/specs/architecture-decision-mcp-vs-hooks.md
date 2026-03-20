# Architecture Decision: MCP Server vs Daemon vs Pure Hooks

## Current Architecture (as-built)

### Three Processes

| Process | Transport | Lifecycle | Owner |
|---------|-----------|-----------|-------|
| **Daemon** (HTTP :3737) | HTTP JSON | LaunchAgent plist, `KeepAlive: true` | launchd (macOS) / systemd (Linux) |
| **MCP Server** (stdio) | MCP stdio protocol | Spawned per Claude Code session | Claude Code runtime |
| **claude-server proxy** (:3456) | OpenAI-compat HTTP | Child of daemon via `proxy-manager.ts` | Daemon |

Optional fourth process: **vllm-mlx** (LaunchAgent plist, embedding + LLM serving).

### What Each Process Does

**Daemon** (`src/daemon/server.ts`, routes in `src/daemon/routes/`):
- Owns SQLite (per-project DBs via `projectDbPath(cwd)`)
- 8 HTTP routes: `/health`, `/compact`, `/restore`, `/grep`, `/search`, `/expand`, `/describe`, `/store`, `/recent`
- `/compact` — ingests full conversation from hook stdin, runs `CompactionEngine` (leaf pass, condensed pass, promotion detection), returns summary text
- `/restore` — queries recent summaries from SQLite + semantic results from Qdrant, builds orientation prompt via `buildOrientationPrompt()`
- `/search` — hybrid FTS5 (episodic) + Qdrant (semantic) search
- `/store` — calls `promoteSummary()` to write to Qdrant via `qdrant-store.js`
- `/grep`, `/expand`, `/describe` — query SQLite summary DAG
- `/recent` — returns latest context items
- Spawns/manages `claude-server` proxy as child process via `ProxyManager`

**MCP Server** (`src/mcp/server.ts`):
- Pure proxy — **zero business logic**
- 5 tools: `lcm_grep`, `lcm_search`, `lcm_store`, `lcm_expand`, `lcm_describe`
- Each tool call: `client.post(route, args)` to daemon HTTP
- Tool definitions live in `src/mcp/tools/*.ts` (schema only, no logic)
- Total code: ~40 lines of routing

**Hooks** (registered in `~/.claude/settings.json`):
- `PreCompact` → `lossless-claude compact` → reads stdin, POSTs to daemon `/compact`, exits with code 2 + summary on stdout (replaces Claude's native compaction)
- `SessionStart` → `lossless-claude restore` → reads stdin, POSTs to daemon `/restore`, prints context on stdout
- Both hooks are thin HTTP clients (~15 lines each in `src/hooks/compact.ts` and `src/hooks/restore.ts`)

### Communication Flow

```
Claude Code ──stdio──> MCP Server ──HTTP──> Daemon ──SQLite──> DB
                                       └──> Qdrant
Claude Code ──hook──> lossless-claude CLI ──HTTP──> Daemon
```

The MCP server is a stateless pass-through. Every tool call becomes one HTTP POST to the daemon. The hook scripts do the same thing — they are also stateless HTTP clients to the daemon.

### Install Surface (`installer/install.ts`)

The installer:
1. Creates `~/.lossless-claude/config.json`
2. Writes LaunchAgent plist `com.lossless-claude.daemon.plist` (macOS) or systemd unit (Linux) — daemon runs forever with `KeepAlive: true`
3. Merges into `~/.claude/settings.json`: hooks (PreCompact, SessionStart) + MCP server entry
4. Installs cipher package + wrapper + MCP registration
5. Optionally installs claude-server
6. Writes vllm-mlx LaunchAgent plist (if applicable)

---

## Option A: Keep MCP + Daemon (Status Quo + Child Process Management)

### What Changes for RFC Goals
- Daemon becomes the "unified router" that also manages model server (vllm-mlx) and Qdrant as child processes instead of separate LaunchAgents
- Daemon lifecycle still managed by its own LaunchAgent, but it supervises child services
- MCP server stays as-is (pure proxy)

### Pros
1. **No architectural risk** — zero code changes to working compaction/restore flow
2. **Agent retains explicit memory tools** — lcm_search, lcm_store, lcm_grep, lcm_expand, lcm_describe all work as MCP tools the agent can call on demand
3. **Daemon stays warm** — KeepAlive means no cold start for hook calls
4. **Child process management is additive** — add spawn/monitor logic to `proxy-manager.ts` pattern for vllm-mlx and qdrant
5. **Separation of concerns** — hooks handle lifecycle events, MCP handles agent-initiated queries

### Cons
1. **Still uses LaunchAgent for daemon itself** — EDR tools flag persistent LaunchAgents; the daemon plist is the main EDR concern
2. **Two processes for MCP** — MCP server process exists only to proxy; adds ~30MB RSS per Claude Code session for no logic
3. **Cold start on MCP** — Claude Code spawns MCP server on session start; Node.js import of `@modelcontextprotocol/sdk` adds ~500ms latency
4. **Config duplication** — MCP server hardcodes `http://127.0.0.1:3737` (from `DaemonClient` constructor)
5. **Three LaunchAgents total** if managing vllm-mlx and qdrant separately (daemon + vllm-mlx + qdrant)

### Verdict
Lowest risk but doesn't solve the EDR problem (daemon plist persists). Good if child-process-of-daemon is the only goal.

---

## Option B: Merge MCP into Daemon (Single Process, Still Exposes MCP Tools)

### Technical Feasibility

**The core tension**: Claude Code spawns MCP servers as child processes using stdio transport. The daemon is a long-running HTTP server. Can one process do both?

**Answer: Not straightforwardly.** The MCP stdio transport requires the process to be spawned by Claude Code with stdin/stdout piped. The daemon runs independently (LaunchAgent). These are fundamentally different lifecycle models.

**Possible approach**: The `lossless-claude mcp` command (spawned by Claude Code) could:
1. First ensure the daemon is running (spawn it if not)
2. Serve MCP tools over stdio, proxying to its own HTTP routes
3. This is essentially what it does today — the "merge" would mean the MCP process also hosts the HTTP server

**But this breaks the daemon model**: If the daemon HTTP server lives inside the MCP process, it dies when the Claude Code session ends. Other sessions lose their daemon. You'd need the first MCP instance to become the daemon and subsequent ones to detect and proxy.

**Alternative**: Daemon process listens on both HTTP and a Unix socket for MCP-like communication. Claude Code's MCP entry would point to a thin shim that connects to the Unix socket. But Claude Code's MCP protocol requires stdio, not sockets — the shim still needs to exist.

### Pros
1. **One fewer process if truly merged** — eliminates the 30MB MCP proxy RSS
2. **Single codebase entry** — no `src/mcp/` directory

### Cons
1. **Cannot truly merge** due to lifecycle mismatch — you still need a shim process for stdio
2. **Increases daemon complexity** — daemon now owns MCP protocol handling in addition to HTTP
3. **No real simplification** — the MCP server is already 40 lines; the "merge" saves almost nothing
4. **Breaks multi-session** — if daemon is inside MCP process, second Claude Code session has no daemon
5. **Risk of stdio pollution** — daemon log output would corrupt MCP protocol if not carefully separated

### Verdict
**Not recommended.** The lifecycle mismatch between "spawned per session" (MCP) and "runs forever" (daemon) makes a true merge architecturally unsound. The MCP server's 40 lines of pure proxy code don't justify the risk.

---

## Option C: Drop MCP, Go Pure Hooks

### Which lcm_* Tools Can Be Replaced by Hooks?

| Tool | Hook Replacement? | Analysis |
|------|-------------------|----------|
| `lcm_search` | Partially via `PreToolUse` hook on Bash | Agent could `curl localhost:3737/search` via Bash. But: requires agent to know curl syntax, loses tool schema/discoverability, pollutes context with raw JSON |
| `lcm_store` | Yes via `PostToolUse` hook | Could auto-store decisions after certain tool calls. But loses agent intentionality — agent currently chooses what to store |
| `lcm_grep` | Same as lcm_search | Could use Bash curl, but loses ergonomics |
| `lcm_expand` | Same | Bash curl possible but DAG traversal output is complex |
| `lcm_describe` | Same | Bash curl possible |

### Which CANNOT Be Replaced by Hooks?

**Agent-initiated, on-demand memory retrieval is the critical gap.**

Hooks are event-driven — they fire on specific Claude Code lifecycle events (SessionStart, PreCompact, PreToolUse, PostToolUse, UserPromptSubmit). There is no hook for "agent decides it needs to recall something mid-conversation."

The lcm_* tools give the agent **pull-based** access to memory. The agent can:
- Search for a past decision when it needs context
- Expand a compressed summary when it needs detail
- Store a finding it deems important
- Grep for a specific keyword across sessions

Without MCP tools, the agent can only receive memory at session start (restore hook) and during compaction. It becomes **push-only** — memory is injected at fixed points, never queried on demand.

**The `UserPromptSubmit` hook (from xgh) partially compensates** by injecting guidance like "use lcm_* tools when you need context." But without the tools existing, this guidance becomes useless.

**Could hooks simulate pull?** Only if:
1. A `PreToolUse` hook on Bash intercepted curl commands to the daemon — fragile, unreliable
2. The agent learned to use Bash to call the daemon API directly — possible but degrades UX (no schema, no type safety, verbose output in context)
3. A custom hook event existed for "agent wants to recall" — this doesn't exist in Claude Code

### What's Lost

1. **Structured tool schemas** — Claude Code presents lcm_* tools with typed parameters; the agent knows exactly what it can query
2. **Permission model** — `mcp__lossless-claude__lcm_store` etc. are explicitly allowed in settings.json; Bash curl has no such granularity
3. **Agent autonomy** — the agent currently decides when to search memory; pure hooks make it passive
4. **Expansion/describe** — these DAG navigation tools are fundamentally interactive; no hook event maps to "navigate the summary tree"

### Pros
1. **Eliminates MCP server process entirely** — no per-session 30MB overhead, no MCP SDK dependency
2. **Eliminates `@modelcontextprotocol/sdk` dependency** — simpler package, faster install
3. **Fewer moving parts** — hooks + daemon only, no MCP protocol
4. **EDR improvement** — one fewer process type (though daemon LaunchAgent persists)

### Cons
1. **Loses agent-initiated memory retrieval** — the agent becomes passive, only receiving injected context
2. **Loses structured tool interface** — agent would need Bash curl for ad-hoc queries (ugly, error-prone, context-heavy)
3. **Breaks the "lossless" promise** — if the agent can't expand compressed summaries on demand, compaction information loss becomes permanent within a session
4. **xgh integration degrades** — UserPromptSubmit hook currently tells agent to use lcm_* tools; without them, the guidance is dead code
5. **No way to store memories on demand** — auto-store via hooks is indiscriminate; agent's judgment about what's worth remembering is lost

### Verdict
**Not recommended unless Claude Code adds a "tool call" hook type that lets hooks expose tools.** The loss of agent-initiated memory retrieval fundamentally weakens the system.

---

## Recommendation: Option A with Daemon-as-Supervisor (Modified)

### The Real Problem to Solve

The RFC's goals are:
1. **Eliminate LaunchAgent plists** (EDR/security)
2. **Simplify process management** (unified router)
3. **Session-scoped lifecycle** (services live for MCP session duration)

### Proposed Hybrid: "Lazy Daemon" Architecture

Instead of a persistent LaunchAgent daemon, make the daemon **session-scoped but shared**:

1. **`lossless-claude mcp`** (spawned by Claude Code) becomes the entry point:
   - On startup, checks if daemon is already running (health check on :3737)
   - If not, spawns daemon as a **detached child process** (not a LaunchAgent)
   - Daemon writes a PID file; subsequent MCP instances detect it and connect
   - MCP server proxies tools to daemon as today

2. **`lossless-claude compact`/`restore`** (hook commands) also check and spawn daemon if needed:
   - Same health-check-then-spawn pattern
   - Daemon auto-starts on first hook or MCP invocation

3. **Daemon manages child processes**:
   - Spawns vllm-mlx and qdrant as children (replaces their LaunchAgents)
   - Children die when daemon dies

4. **Daemon auto-exits** after idle timeout (e.g., 30 minutes of no requests):
   - No KeepAlive plist — daemon is transient
   - Next session re-spawns it automatically

### Benefits
- **Zero LaunchAgents for lossless-claude** — daemon, vllm-mlx, qdrant all managed as child processes
- **EDR clean** — no persistent plists or systemd units
- **Agent retains all lcm_* tools** via MCP
- **Cold start mitigated** — daemon spawns on first request, stays warm across sessions
- **Graceful degradation** — hooks return `exitCode: 0` if daemon is down (already implemented in `compact.ts` and `restore.ts`)

### Implementation Sketch

Key changes:
- `src/daemon/lifecycle.ts` (new): health-check, spawn-if-needed, PID file management, idle timeout
- `src/mcp/server.ts`: call `ensureDaemon()` before connecting to daemon
- `src/hooks/compact.ts`, `src/hooks/restore.ts`: call `ensureDaemon()` before POSTing
- `installer/install.ts`: stop writing LaunchAgent plist for daemon; keep writing settings.json hooks + MCP
- `src/daemon/server.ts`: add idle timeout (shutdown after N minutes of no requests)
- `src/daemon/proxy-manager.ts`: extend pattern to manage vllm-mlx and qdrant as children

### Process Tree (New)

```
Claude Code
  ├── lossless-claude mcp (stdio, per-session)
  │     └── ensures daemon exists
  └── hooks (lossless-claude compact/restore)
        └── ensures daemon exists

lossless-claude daemon (detached, shared, auto-spawned)
  ├── claude-server (:3456, child)
  ├── vllm-mlx (:11435, child)
  └── qdrant (:6333, child)
```

---

## Key Files Referenced

| File | Role |
|------|------|
| `src/mcp/server.ts` | MCP stdio server — 40-line pure proxy |
| `src/mcp/tools/*.ts` | Tool schemas (5 files, no logic) |
| `src/daemon/server.ts` | HTTP daemon with 8 routes |
| `src/daemon/routes/*.ts` | Route handlers (compact, restore, grep, search, expand, describe, store, recent) |
| `src/daemon/client.ts` | HTTP client used by MCP and hooks |
| `src/daemon/proxy-manager.ts` | claude-server child process management |
| `src/daemon/config.ts` | Config loading with defaults |
| `src/hooks/compact.ts` | PreCompact hook — POSTs to daemon, exit 2 |
| `src/hooks/restore.ts` | SessionStart hook — POSTs to daemon, exit 0 |
| `src/compaction.ts` | CompactionEngine — leaf/condensed passes (1332 lines) |
| `src/assembler.ts` | Context assembly for restore |
| `src/promotion/detector.ts` | Decides what to promote to Qdrant |
| `src/promotion/promoter.ts` | Writes to Qdrant via qdrant-store.js |
| `installer/install.ts` | Writes LaunchAgent plist + settings.json |
| `installer/uninstall.ts` | Tears down LaunchAgent + settings |
| `dist/bin/lossless-claude.js` | CLI entry — daemon/mcp/compact/restore/install/doctor |
| `~/.claude/settings.json` | Hooks + MCP registration |
| `~/Library/LaunchAgents/com.lossless-claude.daemon.plist` | Current daemon lifecycle |
