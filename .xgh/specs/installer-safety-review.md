# lossless-claude Installer Safety Review

**Reviewer:** Claude (Opus 4.6)
**Date:** 2026-03-17
**Scope:** `lossless-claude install` on macOS Apple Silicon with existing Claude Code setup

---

## Summary Verdict

**Safe with caveats.** The installer is predominantly additive and merge-based. It will not destroy your existing Claude Code settings, but it has one design flaw that can silently overwrite a specific MCP server entry, and `setup.sh` can kill a running Ollama process without confirmation.

---

## Operations Breakdown

| # | Operation | Target | Reversible? | Additive or Destructive? | Risk |
|---|-----------|--------|-------------|--------------------------|------|
| 1 | Run `setup.sh` | System packages (brew, uv, vllm-mlx, qdrant) | Partially (no auto-uninstall of brew packages) | Additive — conditional `command -v` checks before install | LOW |
| 2 | Create `~/.lossless-claude/` dir | Filesystem | Yes (rmdir) | Additive | NONE |
| 3 | Create `~/.lossless-claude/config.json` | Config file | Yes (delete) | **Additive only if file doesn't exist** — protected by `existsSync` check (line 186) | NONE |
| 4 | Merge `~/.claude/settings.json` | Claude Code settings | Yes (uninstall reverses) | **Merge** — deep-clones existing, appends hooks, adds MCP entry | LOW (see Concern #1) |
| 5 | Create LaunchAgent plist | `~/Library/LaunchAgents/com.lossless-claude.daemon.plist` | Yes (uninstall removes) | Overwrites if exists (idempotent: unload then load) | LOW |
| 6 | `launchctl load` | System daemon | Yes (unload) | Starts a persistent daemon on port 3737 | LOW |
| 7 | Create `~/.cipher/cipher.yml` | Cipher config | Partially (not removed by uninstall) | **Additive if new; model-sync if exists** — protected by `if [ ! -f ]` check | LOW |
| 8 | Kill Ollama (vllm-mlx backend only) | Running process | No | **Destructive** — `pkill -f ollama` + `osascript quit` | MEDIUM |
| 9 | Patch Qdrant plist (MALLOC_CONF) | `~/Library/LaunchAgents/com.qdrant.server.plist` | No auto-revert | Additive (PlistBuddy add, skips if key exists) | LOW |
| 10 | Clean Qdrant WAL locks | `~/.qdrant/storage/*/wal/open-*` | No | Destructive — `find -delete` on stale locks | LOW (harmless if Qdrant stopped first) |

---

## Concerns

### 1. MCP server entry is overwritten, not merged (MEDIUM)

**File:** `installer/install.ts`, line 39
**Code:** `settings.mcpServers["lossless-claude"] = LC_MCP;`

This unconditionally overwrites the `lossless-claude` MCP server entry. If you had previously customized this entry (e.g., added args or env vars), a re-install will silently clobber it.

However: this only affects the `lossless-claude` key. All other MCP servers in `mcpServers` are untouched. Your existing MCP servers (cipher, sosumi, context-mode, etc.) are safe.

**Severity:** MEDIUM — only matters on re-install with customizations to that specific key.

### 2. setup.sh kills Ollama without confirmation (MEDIUM)

**File:** `installer/setup.sh`, lines 180-184
If you choose the `vllm-mlx` backend (auto-detected on Apple Silicon), the script will `pkill -f ollama` and `osascript quit Ollama`. If you're running Ollama for other projects, this will kill it.

**Severity:** MEDIUM — only triggers if vllm-mlx backend is selected (which is the default on Apple Silicon).

### 3. setup.sh failure does not abort install (MEDIUM)

**File:** `installer/install.ts`, lines 165-168
If `setup.sh` exits non-zero, install.ts logs a warning but **continues**. This means you can end up with:
- Claude hooks registered pointing to a daemon that can't start (missing Qdrant/models)
- A half-configured `cipher.yml`

The install will appear "successful" but the daemon won't function.

**Severity:** MEDIUM — functional failure, not data loss.

### 4. Hooks are appended, never deduplicated across re-installs (LOW)

**File:** `installer/install.ts`, lines 28-36
The `hasHookCommand` check prevents duplicate hook entries. This is well-implemented. Re-running install will not create duplicate hooks.

**Severity:** NONE (the code handles this correctly).

### 5. Uninstall does NOT remove `~/.lossless-claude/` or `~/.cipher/` (LOW)

**File:** `installer/uninstall.ts`
Uninstall only removes: (a) the daemon plist, (b) lossless-claude entries from `settings.json`. It does **not** delete `~/.lossless-claude/`, `~/.lossless-claude/config.json`, `~/.cipher/cipher.yml`, or any brew-installed packages.

**Severity:** LOW — orphaned files, not harmful. But be aware uninstall is not a full cleanup.

### 6. `--dry-run` runs `setup.sh` with `XGH_DRY_RUN=1` which is safe (LOW)

**File:** `installer/dry-run-deps.ts`, lines 40-46
The dry-run mode does execute the real `setup.sh`, but passes `XGH_DRY_RUN=1` which causes it to only print what it would do and then `exit 0`. The dry-run deps also intercept `writeFileSync`, `mkdirSync`, `rmSync`, and `spawnSync`. `readFileSync` and `existsSync` are pass-through (they read real state, which is correct for preview).

**However:** the dry-run of `setup.sh` still performs `command -v`, `brew list`, and `uname` checks (read-only commands) to determine what it would install. This is safe.

**Severity:** LOW — dry-run is reliable and safe.

### 7. No backup of `~/.claude/settings.json` before modification (LOW)

The installer reads, merges, and writes `settings.json` without creating a `.bak` copy. If the write is interrupted (power loss, Ctrl+C at the wrong moment), the file could be corrupted.

**Severity:** LOW — extremely unlikely, and the file is small (atomic-ish write).

### 8. Shell RC files are NOT touched (NONE)

Neither `install.ts` nor `setup.sh` modify `.zshrc`, `.bashrc`, `.zprofile`, or any shell profile. PATH is not modified. The installer assumes `lossless-claude` is already in PATH (from `npm install -g`).

**Severity:** NONE.

---

## What Existing Claude Code Settings Survive?

| Setting | Survives install? |
|---------|------------------|
| Existing MCP servers (other than `lossless-claude`) | YES |
| Existing hooks (PreCompact, SessionStart, others) | YES |
| API keys in settings.json | YES (settings are deep-merged) |
| Custom permissions/allowedTools | YES |
| Any top-level settings keys | YES |

---

## Recommendation

1. **Back up `~/.claude/settings.json`** before running install:
   ```
   cp ~/.claude/settings.json ~/.claude/settings.json.bak
   ```

2. **Run `--dry-run` first** to see what would happen:
   ```
   lossless-claude install --dry-run
   ```

3. **If you use Ollama for other projects**, be aware the default vllm-mlx backend will kill it. Either:
   - Choose Ollama as your backend (option 2 in the interactive picker), or
   - Set `XGH_BACKEND=ollama` before running install

4. **If you've previously installed and customized `~/.lossless-claude/config.json`**, it will NOT be overwritten (protected by existence check). Safe to re-install.

5. **If you've previously installed and customized `~/.cipher/cipher.yml`**, it will NOT be overwritten but model names/backend will be synced to your new selections via the Python regex updater.

---

## Architecture Notes

- The installer uses dependency injection (`ServiceDeps` interface) which enables clean dry-run and testing.
- `setup.sh` uses `set -euo pipefail` so individual command failures within it will abort the script (though install.ts continues anyway).
- The launchd setup is idempotent: it unloads before loading.
- The uninstall cleanly reverses the Claude settings changes using a symmetric `removeClaudeSettings` function that filters out only lossless-claude hooks and MCP entries.
