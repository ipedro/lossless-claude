# lcm import — Design Spec

**Date:** 2026-03-21
**Status:** Draft

## Context

Claude Code stores session transcripts as JSONL files at `~/.claude/projects/<project-hash>/<session-uuid>.jsonl`. lcm's ingest pipeline (`POST /ingest`) already parses this exact JSONL format via `parseTranscript()`. Sessions that weren't captured by hooks (failed SessionEnd, pre-lcm sessions, or lost during refactoring) can be recovered by scanning Claude Code's internal storage and feeding them to lcm.

## CLI Interface

```
lcm import [--all] [--skip-existing] [--verbose] [--dry-run]
```

| Flag | Default | Behavior |
|------|---------|----------|
| (no flag) | — | Import current project's sessions |
| `--all` | off | Import every project under `~/.claude/projects/` |
| `--skip-existing` | off | Skip sessions already in the lcm database |
| `--verbose` | off | Print per-session details |
| `--dry-run` | off | Show what would be imported without writing |

Post-import, users can run `lcm compact --all` separately to summarize imported sessions.

## Data Flow

```
~/.claude/projects/<project-hash>/*.jsonl
  → parseTranscript(filePath) → ParsedMessage[]
  → POST /ingest { session_id, cwd, messages }
```

### Session ID

Derived from the JSONL filename: `cf1c71a9-5584-4f19-b138-7e16188a89f5.jsonl` → session_id `cf1c71a9-5584-4f19-b138-7e16188a89f5`.

### Project CWD

Claude Code's project hash is NOT losslessly reversible (hyphens in directory names make it ambiguous). Instead, use lcm's own `~/.lossless-claude/projects/*/meta.json` files to map project dirs to cwds. The `batch-compact.ts` module already uses this pattern.

For the current project (no `--all`), use `process.cwd()` to derive the hash and find the matching Claude sessions directory.

For `--all`, scan `~/.lossless-claude/projects/` for `meta.json` files, extract the cwd, compute the Claude hash, and match against `~/.claude/projects/` directories.

### Subagent Transcripts

Some sessions have `subagents/agent-<id>.jsonl` files. These are imported as separate sessions under the same project, with session_id `agent-<id>`.

### Dedup

The store layer handles duplicate messages naturally when the same session_id and content are re-ingested. With `--skip-existing`, the import checks if the session_id already has messages in the database and skips the file entirely (faster for large imports).

## Implementation

### New file: `src/import.ts`

```typescript
import { readdirSync, readFileSync, existsSync } from "node:fs";
import { join, basename } from "node:path";
import { homedir } from "node:os";
import { DaemonClient } from "./daemon/client.js";
import { parseTranscript } from "./transcript.js";

interface ImportOptions {
  all?: boolean;
  skipExisting?: boolean;
  verbose?: boolean;
  dryRun?: boolean;
  cwd?: string;
}

interface ImportResult {
  imported: number;
  skipped: number;
  failed: number;
  totalMessages: number;
}

function cwdToProjectHash(cwd: string): string {
  return cwd.replace(/\//g, '-');
}

function buildProjectMap(): Map<string, string> {
  // Map Claude project hash → cwd using lcm's own meta.json files
  const lcmProjectsDir = join(homedir(), '.lossless-claude', 'projects');
  const map = new Map<string, string>();
  if (!existsSync(lcmProjectsDir)) return map;
  for (const entry of readdirSync(lcmProjectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const metaPath = join(lcmProjectsDir, entry.name, 'meta.json');
    if (!existsSync(metaPath)) continue;
    try {
      const meta = JSON.parse(readFileSync(metaPath, 'utf-8'));
      if (meta.cwd) {
        const hash = cwdToProjectHash(meta.cwd);
        map.set(hash, meta.cwd);
      }
    } catch {}
  }
  return map;
}

function findSessionFiles(projectDir: string): { path: string; sessionId: string }[] {
  const files: { path: string; sessionId: string }[] = [];
  if (!existsSync(projectDir)) return files;

  for (const entry of readdirSync(projectDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.jsonl')) {
      files.push({
        path: join(projectDir, entry.name),
        sessionId: basename(entry.name, '.jsonl'),
      });
    }
    // Session subdirectories may contain subagents/
    if (entry.isDirectory()) {
      const subagentsDir = join(projectDir, entry.name, 'subagents');
      if (existsSync(subagentsDir)) {
        for (const sub of readdirSync(subagentsDir, { withFileTypes: true })) {
          if (sub.isFile() && sub.name.endsWith('.jsonl')) {
            files.push({
              path: join(subagentsDir, sub.name),
              sessionId: basename(sub.name, '.jsonl'),
            });
          }
        }
      }
    }
  }
  return files;
}

export async function importSessions(
  client: DaemonClient,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const claudeProjectsDir = join(homedir(), '.claude', 'projects');
  const result: ImportResult = { imported: 0, skipped: 0, failed: 0, totalMessages: 0 };

  let projectDirs: { dir: string; cwd: string }[] = [];

  if (options.all) {
    // Use lcm's meta.json to build hash→cwd mapping
    const projectMap = buildProjectMap();
    for (const entry of readdirSync(claudeProjectsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const cwd = projectMap.get(entry.name);
      if (!cwd) continue; // Skip projects without known cwd
      projectDirs.push({ dir: join(claudeProjectsDir, entry.name), cwd });
    }
  } else {
    const cwd = options.cwd ?? process.cwd();
    const hash = cwdToProjectHash(cwd);
    const dir = join(claudeProjectsDir, hash);
    if (existsSync(dir)) {
      projectDirs.push({ dir, cwd });
    }
  }

  for (const { dir, cwd } of projectDirs) {
    const sessionFiles = findSessionFiles(dir);

    for (const { path, sessionId } of sessionFiles) {
      const messages = parseTranscript(path);
      if (messages.length === 0) {
        result.skipped++;
        continue;
      }

      if (options.skipExisting) {
        try {
          const check = await client.post<{ storedCount: number }>('/ingest', {
            session_id: sessionId, cwd, messages: [],
          });
          if (check.storedCount > 0) {
            result.skipped++;
            if (options.verbose) console.log(`  ⊘ ${sessionId}: already exists (${check.storedCount} messages)`);
            continue;
          }
        } catch {}
      }

      if (options.dryRun) {
        if (options.verbose) console.log(`  [dry-run] ${sessionId}: ${messages.length} messages`);
        result.imported++;
        result.totalMessages += messages.length;
        continue;
      }

      try {
        await client.post('/ingest', {
          session_id: sessionId,
          cwd,
          messages,
        });
        result.imported++;
        result.totalMessages += messages.length;
        if (options.verbose) console.log(`  ✓ ${sessionId}: ${messages.length} messages`);
      } catch {
        result.failed++;
        if (options.verbose) console.log(`  ✗ ${sessionId}: failed`);
      }
    }
  }

  return result;
}
```

### CLI: add to `bin/lcm.ts`

```typescript
case "import": {
  const all = argv.includes("--all");
  const skipExisting = argv.includes("--skip-existing");
  const verbose = argv.includes("--verbose");
  const dryRun = argv.includes("--dry-run");

  const { ensureDaemon } = await import("../src/daemon/lifecycle.js");
  const { DaemonClient } = await import("../src/daemon/client.js");
  const { loadDaemonConfig } = await import("../src/daemon/config.js");
  const { importSessions } = await import("../src/import.js");

  const config = loadDaemonConfig(join(homedir(), ".lossless-claude", "config.json"));
  const port = config.daemon?.port ?? 3737;
  const pidFilePath = join(homedir(), ".lossless-claude", "daemon.pid");
  const { connected } = await ensureDaemon({ port, pidFilePath, spawnTimeoutMs: 5000 });
  if (!connected) { console.error("  Daemon not available"); exit(1); }

  const client = new DaemonClient(`http://127.0.0.1:${port}`);
  console.log(`\n  Importing Claude Code sessions${all ? " (all projects)" : ""}...\n`);

  const result = await importSessions(client, { all, skipExisting, verbose, dryRun });

  if (dryRun) console.log("  [dry-run] No changes written.\n");
  console.log(`  ${result.imported} sessions imported (${result.totalMessages} messages)`);
  if (result.skipped > 0) console.log(`  ${result.skipped} skipped (empty)`);
  if (result.failed > 0) console.log(`  ${result.failed} failed`);
  console.log();
  break;
}
```

### Plugin skill: `.claude-plugin/commands/lcm-import.md`

```markdown
# /lossless-claude-import

Import Claude Code session transcripts into lcm memory.

## Instructions

Run `lcm import` to import the current project's sessions. Use `--all` for all projects.

After importing, run `lcm compact --all` to summarize the imported sessions.

## When to use

- After installing lcm for the first time (backfill existing sessions)
- After a session that failed to ingest (hook error, daemon down)
- To recover lost conversations
- After upgrading lcm (ensure all sessions are captured)

## Commands

- `lcm import` — import current project's sessions
- `lcm import --all` — import all projects
- `lcm import --verbose` — show per-session details
- `lcm import --dry-run` — preview without writing
- `lcm import --skip-existing` — skip sessions already in database
- `lcm compact --all` — summarize all uncompacted sessions (run after import)
```

### Tests: `test/import.test.ts`

- Mock filesystem with sample JSONL files
- Verify `findSessionFiles` discovers files + subagents
- Verify `projectHashToCwd` / `cwdToProjectHash` roundtrip
- Verify `importSessions` calls `/ingest` for each session
- Verify `--skip-existing` skips, `--dry-run` doesn't write
- Verify empty sessions are skipped

## Update existing connector skill template

Add to `src/connectors/templates/sections/command-reference.md`:
```
- `lcm import` — Import Claude Code session transcripts into memory
- `lcm import --all` — Import from all projects
- `lcm compact --all` — Summarize all uncompacted sessions
```

## Files Summary

| File | Action |
|------|--------|
| `src/import.ts` | Create — core import logic |
| `bin/lcm.ts` | Edit — add `import` case |
| `.claude-plugin/commands/lcm-import.md` | Create — plugin skill |
| `test/import.test.ts` | Create — tests |
| `src/connectors/templates/sections/command-reference.md` | Edit — add import/compact |
| `src/connectors/templates/skill/SKILL.md` | Edit — add import/compact to decision table |
