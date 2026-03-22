# Repo Spring Cleaning Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reorganize the lossless-claude repo by cleaning junk files, archiving legacy specs, and consolidating `bin/`, `installer/`, and `test/` into `src/` for a flat, colocated layout.

**Architecture:** Currently the repo has four top-level TypeScript roots: `src/`, `bin/`, `installer/`, and `test/`. After cleanup, only `src/` (plus `agents/` which stays) will contain TypeScript. Tests move next to their source files inside `src/`. The CLI entry point moves to `src/cli/lcm.ts` and installer to `src/installer/`.

**Tech Stack:** TypeScript 5.7+, Node.js ESM (`"type": "module"`), Vitest 3, `tsconfig.json` with `NodeNext` resolution.

**Platform Note:** Commands use macOS/BSD syntax (e.g., `sed -i ''`). On Linux, adjust to GNU equivalents (e.g., `sed -i`).

---

## Task 1: Gitignore & Delete Junk

**Time:** 2 min | **Risk:** None

Clean up committed runtime artifacts and temp directories.

### Steps

- [ ] **1.1** Append entries to `.gitignore`:

  **File:** `/Users/pedro/Developer/lossless-claude/.gitignore`

  Add these lines at the end:

  ```
  # Runtime SQLite files
  data/*.db*

  # Temp dirs from agent runs
  lcm-cli-*/

  # Test artifacts
  sensitive-patterns-test.txt
  ```

  > Note: `data/` is already gitignored (line 9). The `data/*.db*` pattern is redundant but kept for clarity if someone removes the `data/` line later. Since `data/` already covers it, this line is actually unnecessary. Skip `data/*.db*` since `data/` already handles it.

  Actually, `data/` on line 9 already ignores everything under `data/`. So only add:

  ```
  # Temp dirs from agent runs
  lcm-cli-*/

  # Test artifacts
  sensitive-patterns-test.txt
  ```

- [ ] **1.2** Delete junk files:

  ```bash
  rm -f sensitive-patterns-test.txt
  rm -rf lcm-cli-*/
  ```

  **Expected:** No output, files removed.

- [ ] **1.3** Verify:

  ```bash
  git status
  ```

  **Expected:** `.gitignore` modified, deleted files shown, `lcm-cli-*/` and `sensitive-patterns-test.txt` no longer in untracked.

- [ ] **1.4** Commit:

  ```bash
  git add .gitignore
  git commit -m "chore: gitignore temp dirs and delete junk files"
  ```

---

## Task 2: Archive Legacy Specs

**Time:** 2 min | **Risk:** None

Move 6 legacy spec files from root `specs/` to `.xgh/specs/archive/`.

### Steps

- [ ] **2.1** Create archive directory and move files:

  ```bash
  mkdir -p .xgh/specs/archive
  mv specs/*.md .xgh/specs/archive/
  rmdir specs
  ```

  **Expected:** `specs/` removed. Files now at `.xgh/specs/archive/`:
  - `depth-aware-prompts-and-rewrite.md`
  - `env-config-extraction.md`
  - `extraction-plan.md`
  - `historical-session-backfill.md`
  - `lossless-claw-rename-spec.md`
  - `summary-presentation-and-depth-aware-prompts.md`

- [ ] **2.2** Verify:

  ```bash
  ls .xgh/specs/archive/
  ls specs/ 2>&1  # Should fail: "No such file or directory"
  ```

- [ ] **2.3** Commit:

  ```bash
  git add specs/ .xgh/specs/archive/
  git commit -m "chore: archive legacy specs to .xgh/specs/archive/"
  ```

---

## Task 3: Move `bin/` to `src/cli/`

**Time:** 5 min | **Risk:** Medium (import paths change)

Move the CLI entry point from `bin/lcm.ts` to `src/cli/lcm.ts`. All dynamic imports in the file use `../src/` paths which must become `../` since the file is now inside `src/`.

### Current state

- **File:** `bin/lcm.ts` (single file, 310+ lines)
- **package.json** `"bin"` field: `"lcm": "dist/bin/lcm.js"`
- **tsconfig.json** `"include"`: `["src/**/*.ts", "bin/**/*.ts", "installer/**/*.ts"]`
- **Dynamic imports in `bin/lcm.ts`:**
  - `../src/daemon/server.js` (and ~20 similar `../src/...` paths)
  - `../installer/install.js`, `../installer/uninstall.js`, `../installer/dry-run-deps.js`

### Steps

- [ ] **3.1** Create target dir and move file:

  ```bash
  mkdir -p src/cli
  git mv bin/lcm.ts src/cli/lcm.ts
  rmdir bin
  ```

- [ ] **3.2** Fix dynamic imports in `src/cli/lcm.ts`:

  All `../src/` imports become `../` (one directory up from `src/cli/` is `src/`):

  | Old pattern | New pattern |
  |---|---|
  | `"../src/daemon/server.js"` | `"../daemon/server.js"` |
  | `"../src/daemon/config.js"` | `"../daemon/config.js"` |
  | `"../src/daemon/lifecycle.js"` | `"../daemon/lifecycle.js"` |
  | `"../src/daemon/client.js"` | `"../daemon/client.js"` |
  | `"../src/batch-compact.js"` | `"../batch-compact.js"` |
  | `"../src/hooks/dispatch.js"` | `"../hooks/dispatch.js"` |
  | `"../src/mcp/server.js"` | `"../mcp/server.js"` |
  | `"../src/stats.js"` | `"../stats.js"` |
  | `"../src/doctor/doctor.js"` | `"../doctor/doctor.js"` |
  | `"../src/diagnose.js"` | `"../diagnose.js"` |
  | `"../src/connectors/installer.js"` | `"../connectors/installer.js"` |
  | `"../src/connectors/registry.js"` | `"../connectors/registry.js"` |
  | `"../src/sensitive.js"` | `"../sensitive.js"` |
  | `"../src/import.js"` | `"../import.js"` |
  | `"../installer/install.js"` | `"../installer/install.js"` *(unchanged! stays correct after Task 4)* |
  | `"../installer/uninstall.js"` | `"../installer/uninstall.js"` *(unchanged after Task 4)* |
  | `"../installer/dry-run-deps.js"` | `"../installer/dry-run-deps.js"` *(unchanged after Task 4)* |

  **Important ordering:** The `../installer/` imports will be correct AFTER Task 4 moves `installer/` to `src/installer/`. If running Task 3 in isolation, these would temporarily break. For safety, do a global find-replace:

  ```bash
  sed -i '' 's|"../src/|"../|g' src/cli/lcm.ts
  ```

  Verify no `../src/` remains:
  ```bash
  grep '../src/' src/cli/lcm.ts  # Should return nothing
  ```

- [ ] **3.3** Update `package.json` bin field:

  **File:** `/Users/pedro/Developer/lossless-claude/package.json`

  **Current state (what tsconfig.json produces now):**
  ```json
  "bin": {
    "lcm": "dist/src/cli/lcm.js"
  },
  ```

  This is already correct — `rootDir: "."` compiles `src/cli/lcm.ts` to `dist/src/cli/lcm.js`. No change needed at this step. The final state (after Task 6 changes `rootDir` to `"src"`) will have `"lcm": "dist/cli/lcm.js"`, but that change happens later.

- [ ] **3.4** Update `tsconfig.json` include:

  **File:** `/Users/pedro/Developer/lossless-claude/tsconfig.json`

  Change:
  ```json
  "include": ["src/**/*.ts", "bin/**/*.ts", "installer/**/*.ts"],
  ```
  To:
  ```json
  "include": ["src/**/*.ts", "installer/**/*.ts"],
  ```

  > `src/cli/lcm.ts` is now covered by `src/**/*.ts`.

- [ ] **3.5** Skip typecheck for now:

  ```bash
  # Typecheck will fail here because src/cli/lcm.ts imports ../installer/
  # which should resolve to src/installer/ (not yet moved).
  # Skip this step; full typecheck happens after Task 4.
  ```

  **Expected outcome:** Skip — Task 4 must complete first so `src/installer/` exists.

- [ ] **3.6** Commit:

  ```bash
  git add -A
  git commit -m "refactor: move bin/lcm.ts to src/cli/lcm.ts"
  ```

---

## Task 4: Move `installer/` to `src/installer/`

**Time:** 5 min | **Risk:** Medium (import paths change)

Move 3 files from `installer/` into `src/installer/`. Update imports in test files and CLI.

### Current state

- **Files:** `installer/install.ts`, `installer/uninstall.ts`, `installer/dry-run-deps.ts`
- **Imported by:**
  - `src/cli/lcm.ts` (after Task 3): `"../installer/install.js"`, `"../installer/uninstall.js"`, `"../installer/dry-run-deps.js"` -- these are already correct! From `src/cli/`, `../installer/` resolves to `src/installer/`.
  - `test/installer/install.test.ts`: `"../../installer/install.js"` (will fix in Task 5/6)
  - `test/installer/uninstall.test.ts`: `"../../installer/uninstall.js"`
  - `test/installer/dry-run-deps.test.ts`: `"../../installer/dry-run-deps.js"`

### Steps

- [ ] **4.1** Move files:

  ```bash
  git mv installer/install.ts src/installer/install.ts
  git mv installer/uninstall.ts src/installer/uninstall.ts
  git mv installer/dry-run-deps.ts src/installer/dry-run-deps.ts
  rmdir installer
  ```

  > `src/installer/` directory will be created by `git mv` if needed, but create it first to be safe:
  ```bash
  mkdir -p src/installer
  ```

- [ ] **4.2** Update `tsconfig.json` include:

  **File:** `/Users/pedro/Developer/lossless-claude/tsconfig.json`

  Change:
  ```json
  "include": ["src/**/*.ts", "installer/**/*.ts"],
  ```
  To:
  ```json
  "include": ["src/**/*.ts"],
  ```

  > `src/installer/*.ts` is now covered by `src/**/*.ts`.

- [ ] **4.3** Check for any imports referencing old `installer/` path from `src/`:

  ```bash
  grep -r '"../installer/' src/ --include="*.ts" | grep -v cli/lcm.ts
  grep -r '"../../installer/' src/ --include="*.ts"
  ```

  **Expected:** No matches (only `src/cli/lcm.ts` imports from `../installer/` which is now correct).

- [ ] **4.4** Verify typecheck:

  ```bash
  npx tsc --noEmit
  ```

  **Expected:** 0 errors. All `src/` imports now resolve correctly.

- [ ] **4.5** Commit:

  ```bash
  git add -A
  git commit -m "refactor: move installer/ to src/installer/"
  ```

---

## Task 5: Colocate Flat Test Files

**Time:** 5 min | **Risk:** Low

Move the 12 flat test files from `test/*.test.ts` into `src/` next to their source modules.

### File mapping

| Source | Destination | Import fix |
|---|---|---|
| `test/diagnose.test.ts` | `src/diagnose.test.ts` | `"../src/import.js"` -> `"./import.js"`, `"../src/diagnose.js"` -> `"./diagnose.js"` |
| `test/expansion.test.ts` | `src/expansion.test.ts` | `"../src/..."` -> `"./..."` |
| `test/fts-fallback.test.ts` | `src/fts-fallback.test.ts` | `"../src/..."` -> `"./..."` |
| `test/fts5-sanitize.test.ts` | `src/fts5-sanitize.test.ts` | `"../src/..."` -> `"./..."` |
| `test/import.test.ts` | `src/import.test.ts` | `"../src/..."` -> `"./..."` |
| `test/large-files.test.ts` | `src/large-files.test.ts` | `"../src/..."` -> `"./..."` |
| `test/migration.test.ts` | `src/migration.test.ts` | `"../src/..."` -> `"./..."` |
| `test/package-config.test.ts` | `src/package-config.test.ts` | `"../src/..."` -> `"./..."` |
| `test/scrub.test.ts` | `src/scrub.test.ts` | `"../src/..."` -> `"./..."` |
| `test/sensitive.test.ts` | `src/sensitive.test.ts` | `"../src/..."` -> `"./..."` |
| `test/stats.test.ts` | `src/stats.test.ts` | `"../src/..."` -> `"./..."` |
| `test/summarize.test.ts` | `src/summarize.test.ts` | `"../src/..."` -> `"./..."` |

### Steps

- [ ] **5.1** Move all flat test files:

  ```bash
  for f in test/diagnose.test.ts test/expansion.test.ts test/fts-fallback.test.ts \
           test/fts5-sanitize.test.ts test/import.test.ts test/large-files.test.ts \
           test/migration.test.ts test/package-config.test.ts test/scrub.test.ts \
           test/sensitive.test.ts test/stats.test.ts test/summarize.test.ts; do
    git mv "$f" "src/$(basename "$f")"
  done
  ```

- [ ] **5.2** Fix imports -- replace `"../src/` with `"./` in all moved files:

  ```bash
  for f in src/diagnose.test.ts src/expansion.test.ts src/fts-fallback.test.ts \
           src/fts5-sanitize.test.ts src/import.test.ts src/large-files.test.ts \
           src/migration.test.ts src/package-config.test.ts src/scrub.test.ts \
           src/sensitive.test.ts src/stats.test.ts src/summarize.test.ts; do
    sed -i '' 's|from "../src/|from "./|g' "$f"
    sed -i '' 's|import("../src/|import("./|g' "$f"
  done
  ```

- [ ] **5.3** Verify no stale `../src/` references remain:

  ```bash
  grep -l '../src/' src/*.test.ts
  ```

  **Expected:** No output.

- [ ] **5.4** Commit:

  ```bash
  git add -A
  git commit -m "refactor: colocate flat test files into src/"
  ```

---

## Task 6: Colocate Subdirectory Test Files

**Time:** 5 min | **Risk:** Medium (many files, nested paths)

Move test files from `test/<subdir>/` into `src/<subdir>/` next to their source modules.

### Subdirectory mapping

| Source dir | Destination dir | Files |
|---|---|---|
| `test/connectors/` | `src/connectors/` | `cli.test.ts`, `installer.test.ts`, `registry.test.ts`, `template-service.test.ts` |
| `test/daemon/` | `src/daemon/` | `client.test.ts`, `config.test.ts`, `lifecycle.test.ts`, `orientation.test.ts`, `project-queue.test.ts`, `project.test.ts`, `proxy-manager.test.ts`, `server.test.ts` |
| `test/daemon/routes/` | `src/daemon/routes/` | `compact.test.ts`, `ingest.test.ts`, `prompt-search.test.ts`, `restore.test.ts`, `search.test.ts`, `store.test.ts` |
| `test/db/` | `src/db/` | `promoted.test.ts` |
| `test/doctor/` | `src/doctor/` | `doctor-hooks.test.ts`, `doctor.test.ts` |
| `test/hooks/` | `src/hooks/` | `auto-heal.test.ts`, `compact.test.ts`, `dispatch.test.ts`, `restore.test.ts`, `session-end.test.ts`, `user-prompt.test.ts` |
| `test/installer/` | `src/installer/` | `dry-run-deps.test.ts`, `install.test.ts`, `uninstall.test.ts` |
| `test/llm/` | `src/llm/` | `anthropic.test.ts`, `codex-process.test.ts`, `openai.test.ts`, `summarize-exports.test.ts` |
| `test/mcp/` | `src/mcp/` | `server.test.ts` |
| `test/memory/` | `src/memory/` | `api.test.ts` |
| `test/promotion/` | `src/promotion/` | `dedup.test.ts`, `detector.test.ts` |
| `test/prompts/` | `src/prompts/` | `loader.test.ts` |

### Steps

- [ ] **6.1** Move all subdirectory test files:

  ```bash
  # Connectors
  for f in test/connectors/*.test.ts; do git mv "$f" "src/connectors/$(basename "$f")"; done

  # Daemon (flat)
  for f in test/daemon/*.test.ts; do git mv "$f" "src/daemon/$(basename "$f")"; done

  # Daemon routes
  for f in test/daemon/routes/*.test.ts; do git mv "$f" "src/daemon/routes/$(basename "$f")"; done

  # DB
  for f in test/db/*.test.ts; do git mv "$f" "src/db/$(basename "$f")"; done

  # Doctor
  for f in test/doctor/*.test.ts; do git mv "$f" "src/doctor/$(basename "$f")"; done

  # Hooks
  for f in test/hooks/*.test.ts; do git mv "$f" "src/hooks/$(basename "$f")"; done

  # Installer
  for f in test/installer/*.test.ts; do git mv "$f" "src/installer/$(basename "$f")"; done

  # LLM
  for f in test/llm/*.test.ts; do git mv "$f" "src/llm/$(basename "$f")"; done

  # MCP
  for f in test/mcp/*.test.ts; do git mv "$f" "src/mcp/$(basename "$f")"; done

  # Memory
  for f in test/memory/*.test.ts; do git mv "$f" "src/memory/$(basename "$f")"; done

  # Promotion
  for f in test/promotion/*.test.ts; do git mv "$f" "src/promotion/$(basename "$f")"; done

  # Prompts
  for f in test/prompts/*.test.ts; do git mv "$f" "src/prompts/$(basename "$f")"; done
  ```

- [ ] **6.2** Remove empty `test/` directory tree:

  ```bash
  rm -rf test/
  ```

  **Expected:** Entire `test/` tree gone.

- [ ] **6.3** Fix imports in all moved test files.

  The import pattern depends on nesting depth. All test files currently import from their source using relative paths like `../../src/<module>.js` (for 2-deep tests) or `../src/<module>.js` (for 1-deep, but there are none in subdirs).

  For files that were in `test/<subdir>/`, imports like `../../src/<subdir>/foo.js` become `./foo.js` (same directory) and `../../src/bar.js` becomes `../bar.js`:

  **General rule for `test/<subdir>/*.test.ts` -> `src/<subdir>/*.test.ts`:**
  - `../../src/<subdir>/` -> `./` (same module in same dir)
  - `../../src/` -> `../` (module in parent `src/`)
  - `../../installer/` -> `../installer/` (installer now at `src/installer/`)

  **For `test/daemon/routes/*.test.ts` -> `src/daemon/routes/*.test.ts`:**
  - `../../../src/daemon/routes/` -> `./`
  - `../../../src/daemon/` -> `../`
  - `../../../src/` -> `../../`

  Run targeted sed replacements:

  ```bash
  # === 2-level deep: test/<subdir>/*.test.ts ===
  # Pattern: ../../src/ -> ../
  for dir in connectors daemon db doctor hooks installer llm mcp memory promotion prompts; do
    for f in src/$dir/*.test.ts; do
      [ -f "$f" ] || continue
      # Same-dir imports: ../../src/<dir>/ -> ./
      sed -i '' "s|from \"../../src/$dir/|from \"./|g" "$f"
      sed -i '' "s|import(\"../../src/$dir/|import(\"./|g" "$f"
      # Cross-dir imports: ../../src/ -> ../
      sed -i '' 's|from "../../src/|from "../|g' "$f"
      sed -i '' 's|import("../../src/|import("../|g' "$f"
      # Old installer imports: ../../installer/ -> ../installer/
      sed -i '' 's|from "../../installer/|from "../installer/|g' "$f"
      sed -i '' 's|import("../../installer/|import("../installer/|g' "$f"
    done
  done

  # === 3-level deep: test/daemon/routes/*.test.ts ===
  for f in src/daemon/routes/*.test.ts; do
    [ -f "$f" ] || continue
    # Same-dir: ../../../src/daemon/routes/ -> ./
    sed -i '' 's|from "../../../src/daemon/routes/|from "./|g' "$f"
    sed -i '' 's|import("../../../src/daemon/routes/|import("./|g' "$f"
    # Parent-dir: ../../../src/daemon/ -> ../
    sed -i '' 's|from "../../../src/daemon/|from "../|g' "$f"
    sed -i '' 's|import("../../../src/daemon/|import("../|g' "$f"
    # Grandparent: ../../../src/ -> ../../
    sed -i '' 's|from "../../../src/|from "../../|g' "$f"
    sed -i '' 's|import("../../../src/|import("../../|g' "$f"
  done
  ```

- [ ] **6.4** Verify no stale import paths remain:

  ```bash
  grep -r '"../../src/' src/**/*.test.ts
  grep -r '"../../../src/' src/**/*.test.ts
  grep -r '"../../installer/' src/**/*.test.ts
  ```

  **Expected:** No output from any command.

- [ ] **6.5** Commit:

  ```bash
  git add -A
  git commit -m "refactor: colocate subdirectory test files into src/"
  ```

---

## Task 7: Update Test Config & Verify Full Suite

**Time:** 5 min | **Risk:** Low

Update `vitest.config.ts`, `tsconfig.json`, and `package.json` scripts, then run full test suite.

### Steps

- [ ] **7.1** Update `vitest.config.ts`:

  **File:** `/Users/pedro/Developer/lossless-claude/vitest.config.ts`

  Change:
  ```ts
  test: {
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".claude/**"],
  },
  ```
  To:
  ```ts
  test: {
    include: ["src/**/*.test.ts"],
    exclude: ["node_modules/**", ".claude/**"],
  },
  ```

- [ ] **7.2** Update `package.json` test script:

  **File:** `/Users/pedro/Developer/lossless-claude/package.json`

  Change:
  ```json
  "test": "vitest run --dir test",
  ```
  To:
  ```json
  "test": "vitest run",
  ```

  > Vitest will use the `include` pattern from `vitest.config.ts`.

- [ ] **7.3** Update `tsconfig.json` to exclude test files from compilation:

  **File:** `/Users/pedro/Developer/lossless-claude/tsconfig.json`

  Change:
  ```json
  "exclude": ["node_modules", "dist", "test/**/*.ts"]
  ```
  To:
  ```json
  "exclude": ["node_modules", "dist", "src/**/*.test.ts"]
  ```

  > Tests are now inside `src/` but should not be compiled into `dist/`.

- [ ] **7.4** Run typecheck:

  ```bash
  npx tsc --noEmit
  ```

  **Expected:** 0 errors.

- [ ] **7.5** Run full test suite:

  ```bash
  npm test
  ```

  **Expected:** All tests pass. Same number of test files as before (51 total):
  - 12 flat files in `src/*.test.ts`
  - 39 subdirectory files in `src/**/*.test.ts`

- [ ] **7.6** Build and verify dist output:

  ```bash
  npm run build
  ls dist/src/cli/lcm.js        # CLI entry point exists
  ls dist/src/installer/install.js  # Installer exists
  # Verify no test files in dist
  find dist -name "*.test.js" | head -5
  ```

  **Expected:**
  - `dist/src/cli/lcm.js` exists
  - `dist/src/installer/install.js` exists
  - No `*.test.js` files in `dist/` (excluded by tsconfig)

- [ ] **7.7** Verify `bin` symlink works:

  ```bash
  node dist/src/cli/lcm.js --version
  ```

  **Expected:** Prints version number (e.g., `0.6.0`).

- [ ] **7.8** Final commit:

  ```bash
  git add -A
  git commit -m "chore: update vitest/tsconfig/package.json for colocated tests"
  ```

---

## Summary of Config Changes

### `.gitignore` (Task 1)
```diff
+lcm-cli-*/
+sensitive-patterns-test.txt
```

### `package.json` (Tasks 3, 7)
```diff
-"lcm": "dist/bin/lcm.js"
+"lcm": "dist/src/cli/lcm.js"

-"test": "vitest run --dir test",
+"test": "vitest run",
```

### `tsconfig.json` (Tasks 3, 4, 7)
```diff
-"include": ["src/**/*.ts", "bin/**/*.ts", "installer/**/*.ts"],
-"exclude": ["node_modules", "dist", "test/**/*.ts"]
+"include": ["src/**/*.ts"],
+"exclude": ["node_modules", "dist", "src/**/*.test.ts"]
```

### `vitest.config.ts` (Task 7)
```diff
-include: ["**/*.test.ts"],
+include: ["src/**/*.test.ts"],
```

## Directory Structure After Cleanup

```
lossless-claude/
  agents/           # Unchanged
  src/
    cli/
      lcm.ts        # Was bin/lcm.ts
    connectors/
      cli.test.ts   # Was test/connectors/cli.test.ts
      ...
    daemon/
      server.test.ts  # Was test/daemon/server.test.ts
      routes/
        compact.test.ts  # Was test/daemon/routes/compact.test.ts
        ...
    db/
    doctor/
    hooks/
    installer/      # Was root installer/
      install.ts
      install.test.ts  # Was test/installer/install.test.ts
      ...
    llm/
    mcp/
    memory/
    promotion/
    prompts/
    diagnose.test.ts  # Was test/diagnose.test.ts
    ...
  .xgh/
    specs/
      archive/      # Was root specs/
  dist/             # Build output
  package.json
  tsconfig.json
  vitest.config.ts
```
