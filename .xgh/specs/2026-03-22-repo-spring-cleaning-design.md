# Repo Spring Cleaning — Design Spec

**Date:** 2026-03-22
**Status:** Approved
**Branch:** `docs/lcm-rebranding-spec`

---

## Summary

Consolidate all TypeScript source under `src/`, colocate tests next to the code they test, archive legacy specs, and clean up gitignored artifacts that leaked into the repo. The goal is a single-source-root layout where `src/` is the only TypeScript compilation target and `dist/` mirrors it exactly.

---

## What Changes

### 1. Universal cleanup (no-debate items)

| Item | Action | Detail |
|------|--------|--------|
| `data/*.db*` | gitignore | Add `data/` is already gitignored — **verified, no change needed** |
| `lcm-cli-*/` | gitignore | Add pattern `lcm-cli-*/` to `.gitignore` |
| `sensitive-patterns-test.txt` | delete | Root-level test artifact; `rm` it |
| `.claude/worktrees/` | delete + gitignore | 7 orphaned agent dirs. Delete all of `.claude/worktrees/`. Pattern `/.claude/worktrees/` already covered by existing `/.claude/` gitignore — **verified, no change needed** |
| `specs/` (root) | archive | Move 6 legacy files to `.xgh/specs/archive/`, then `rm -rf specs/` |

**Legacy spec files to archive:**

```
specs/depth-aware-prompts-and-rewrite.md        → .xgh/specs/archive/
specs/env-config-extraction.md                  → .xgh/specs/archive/
specs/extraction-plan.md                        → .xgh/specs/archive/
specs/historical-session-backfill.md            → .xgh/specs/archive/
specs/lossless-claw-rename-spec.md              → .xgh/specs/archive/
specs/summary-presentation-and-depth-aware-prompts.md → .xgh/specs/archive/
```

### 2. `bin/` → `src/cli/`

| Before | After |
|--------|-------|
| `bin/lcm.ts` | `src/cli/lcm.ts` |

**Config updates:**

- **`tsconfig.json`** `include`: remove `"bin/**/*.ts"`, add `"src/cli/**/*.ts"` (already covered by `"src/**/*.ts"` — no explicit addition needed, just remove `"bin/**/*.ts"`).
- **`package.json`** `bin.lcm`: change from `"dist/bin/lcm.js"` to `"dist/cli/lcm.js"`.

> **Wait — `rootDir` is `.`** The current `tsconfig.json` sets `rootDir: "."` which means `bin/lcm.ts` compiles to `dist/bin/lcm.js`. After the move to `src/cli/lcm.ts`, with `rootDir: "."` it would compile to `dist/src/cli/lcm.js`. To get `dist/cli/lcm.js` we must change `rootDir` to `"src"` — but that breaks `installer/` compilation. The cleanest fix: **change `rootDir` from `"."` to `"src"`** once all source is under `src/`. The `dist/` tree then mirrors `src/` exactly:
>
> ```
> dist/cli/lcm.js          (from src/cli/lcm.ts)
> dist/installer/install.js (from src/installer/install.ts)
> dist/daemon/server.js     (from src/daemon/server.ts)
> ```

**`package.json` updates:**

- `bin.lcm`: `"dist/bin/lcm.js"` → `"dist/cli/lcm.js"`
- `postbuild` script: currently copies `src/prompts/*.yaml` and `src/connectors/templates/`. Paths use `src/` prefix which remains correct. No change needed.

### 3. `installer/` → `src/installer/`

| Before | After |
|--------|-------|
| `installer/dry-run-deps.ts` | `src/installer/dry-run-deps.ts` |
| `installer/install.ts` | `src/installer/install.ts` |
| `installer/uninstall.ts` | `src/installer/uninstall.ts` |

**Config updates:**

- **`tsconfig.json`** `include`: remove `"installer/**/*.ts"`.
- **Import paths in `src/cli/lcm.ts`** (was `bin/lcm.ts`): any imports like `../installer/install` become `../installer/install` — path depth is the same since `bin/` and `cli/` are both one level deep relative to project root. However, since both now live under `src/`, the import becomes `../installer/install.js` (unchanged relative depth).

> **Exact import audit required at implementation time.** The current `bin/lcm.ts` likely imports from `../installer/install`. After the move to `src/cli/lcm.ts`, the installer at `src/installer/install.ts` is reachable via the same `../installer/install.js` relative path. No import change needed.

### 4. `test/` → colocate inside `src/`

Move every test file from `test/<path>/foo.test.ts` to `src/<path>/foo.test.ts`.

**Mapping (directories):**

| Before | After |
|--------|-------|
| `test/connectors/` | `src/connectors/` |
| `test/daemon/` | `src/daemon/` |
| `test/db/` | `src/db/` |
| `test/doctor/` | `src/doctor/` |
| `test/hooks/` | `src/hooks/` |
| `test/installer/` | `src/installer/` |
| `test/llm/` | `src/llm/` |
| `test/mcp/` | `src/mcp/` |
| `test/memory/` | `src/memory/` |
| `test/promotion/` | `src/promotion/` |
| `test/prompts/` | `src/prompts/` |

**Mapping (root-level test files):**

| Before | After |
|--------|-------|
| `test/diagnose.test.ts` | `src/diagnose.test.ts` |
| `test/expansion.test.ts` | `src/expansion.test.ts` |
| `test/fts-fallback.test.ts` | `src/fts-fallback.test.ts` |
| `test/fts5-sanitize.test.ts` | `src/fts5-sanitize.test.ts` |
| `test/import.test.ts` | `src/import.test.ts` |
| `test/large-files.test.ts` | `src/large-files.test.ts` |
| `test/migration.test.ts` | `src/migration.test.ts` |
| `test/package-config.test.ts` | `src/package-config.test.ts` |
| `test/scrub.test.ts` | `src/scrub.test.ts` |
| `test/sensitive.test.ts` | `src/sensitive.test.ts` |
| `test/stats.test.ts` | `src/stats.test.ts` |
| `test/summarize.test.ts` | `src/summarize.test.ts` |

After all files are moved, delete the top-level `test/` directory.

**Import path changes in test files:**

Every test file currently imports source via paths like `../../src/foo` or `../src/foo`. After colocation these become `../foo` or `./foo`. **Every test file must be audited and updated.**

**Config updates:**

- **`tsconfig.json`**:
  - `include`: stays `["src/**/*.ts"]` (tests are now in `src/`)
  - `exclude`: change from `["node_modules", "dist", "test/**/*.ts"]` to `["node_modules", "dist", "src/**/*.test.ts"]` — this keeps test files out of the compilation output
- **`vitest.config.ts`**:
  - `include`: change from `["**/*.test.ts"]` to `["src/**/*.test.ts"]`
  - `exclude`: keep `["node_modules/**", ".claude/**"]`
- **`package.json`**:
  - `test` script: change from `"vitest run --dir test"` to `"vitest run"` (vitest.config.ts `include` handles discovery)

### 5. `agents/` stays at root

No change. AI-discoverability signal for Claude Code / Codex / similar tools.

---

## What Stays

| Item | Reason |
|------|--------|
| `agents/` | AI-discoverability at repo root |
| `src/` | Already the primary source directory |
| `.xgh/` | Specs, plans, project metadata |
| `tui/` | Separate Go binary, own build |
| `data/` | Already gitignored |
| `.claude/` | Already gitignored (except `settings.json`, `CLAUDE.md`) |

---

## `tsconfig.json` — Final State

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "src",          // changed from "."
    "declaration": true,
    "sourceMap": true,
    "resolveJsonModule": true,
    "noEmitOnError": false
  },
  "include": ["src/**/*.ts"],   // simplified: all source under src/
  "exclude": [
    "node_modules",
    "dist",
    "src/**/*.test.ts"          // keep tests out of dist/
  ]
}
```

## `.gitignore` — Additions

```gitignore
# Temp dirs from agent/test runs
lcm-cli-*/

# Test artifacts
sensitive-patterns-test.txt
```

> Note: `data/`, `.claude/` are already gitignored. No additional patterns needed for those.

---

## Risks

| Risk | Mitigation |
|------|------------|
| **Broken imports after test colocation** | Automated search-and-replace for `../../src/` → `../` patterns. Run full test suite after. |
| **`rootDir` change breaks `resolveJsonModule`** | If `src/cli/lcm.ts` imports `../../package.json`, that file is outside `rootDir: "src"`. Fix: use `fs.readFileSync` for package.json reads, or keep a `version.ts` constant. Audit all `import ... from '*.json'` statements. |
| **Published package breaks** | `bin.lcm` path changes from `dist/bin/lcm.js` to `dist/cli/lcm.js`. Any global installs must be re-linked. Publish a minor version bump. |
| **Git history disruption** | Use `git mv` for all moves to preserve blame history. Do moves in dedicated commits before any content edits. |
| **`postbuild` script** | Currently copies from `src/prompts/` and `src/connectors/templates/` — paths are unaffected since those stay in `src/`. No change needed. |
| **CI pipeline** | If CI caches `dist/`, the old `dist/bin/` and `dist/installer/` paths will be stale. Add `rm -rf dist/` to CI build step (or ensure `tsc` clean build). |

---

## Implementation Notes

### Recommended commit sequence

1. **Commit 1 — Cleanup:** Delete `sensitive-patterns-test.txt`, delete `.claude/worktrees/`, update `.gitignore` with `lcm-cli-*/`.
2. **Commit 2 — Archive legacy specs:** `git mv specs/*.md .xgh/specs/archive/`, then `rm -rf specs/`.
3. **Commit 3 — Move `bin/` → `src/cli/`:** `git mv bin/lcm.ts src/cli/lcm.ts`. Update `package.json` bin field.
4. **Commit 4 — Move `installer/` → `src/installer/`:** `git mv installer/*.ts src/installer/`. Update `tsconfig.json` include.
5. **Commit 5 — Colocate tests:** `git mv` each test file/dir. Update all import paths. Update `vitest.config.ts`, `package.json` test script, `tsconfig.json` exclude.
6. **Commit 6 — `rootDir` change:** Change `tsconfig.json` `rootDir` from `"."` to `"src"`. Update `package.json` bin to `dist/cli/lcm.js`. Fix any `resolveJsonModule` imports that reference files outside `src/`. Clean `dist/` and rebuild.
7. **Commit 7 — Verify:** Run full test suite, typecheck, build. Fix any remaining issues.

### Test import path transformation

Pattern (applied to every `.test.ts` file):

```
# Files in test/daemon/server.test.ts that import ../../src/daemon/server
# become src/daemon/server.test.ts importing ./server

# General rule:
#   ../../src/<module>  →  ../<module>   (for files in subdirs)
#   ../src/<module>     →  ./<module>    (for files at test/ root → src/ root)
```

A script or search-replace pass should handle this mechanically. Verify with `tsc --noEmit` after.

### Verification checklist

- [ ] `npm run build` succeeds
- [ ] `npm run typecheck` succeeds
- [ ] `npm test` passes (all tests)
- [ ] `dist/` tree mirrors `src/` (no `dist/bin/`, no `dist/installer/` at old paths)
- [ ] `npx lcm --help` works (bin path resolves)
- [ ] `.gitignore` patterns prevent re-committing artifacts
- [ ] No test files in `dist/` output
