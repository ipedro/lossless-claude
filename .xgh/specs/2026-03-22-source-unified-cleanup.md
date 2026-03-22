# Source-Unified Repo Cleanup Proposal

## Philosophy: Source Unified
**Thesis:** All runnable TypeScript is source code, not binaries or installers. Unify `src/`, `bin/`, and `installer/` under a single `src/` tree with semantic subdirectories, and configure `tsconfig.json` to compile one hierarchy into `dist/`.

---

## Move
- `bin/lcm.ts` → `src/cli/lcm.ts` — CLI entrypoint is a source module, not special
- `installer/install.ts` → `src/installer/install.ts` — Installer is a runnable module
- `installer/uninstall.ts` → `src/installer/uninstall.ts` — Same rationale
- `installer/dry-run-deps.ts` → `src/installer/dry-run-deps.ts` — Same rationale

## Delete
- `/bin` directory — contents moved to `src/cli/`
- `/installer` directory — contents moved to `src/installer/`

## Add to .gitignore
- `sensitive-patterns-test.txt` — test artifact, not source
- `lcm-cli-*/` — temp directories from test runs
- `.claude/worktrees/` — orphaned agent dirs (or clean manually once)

## Update
- **tsconfig.json** — change `rootDir: "src"` (was `"."`) and `include: ["src/**/*.ts"]` (remove `bin/**` and `installer/**`)
- **package.json** `bin` field — change `"lcm": "dist/bin/lcm.js"` to `"lcm": "dist/cli/lcm.js"`
- **.gitignore** — add patterns above
- **RELEASING.md** (if it references `/bin` or `/installer` paths) — update to `src/cli/` and `src/installer/`

---

## Risk
- **Import paths in code:** Any internal `import { ... } from '../../../installer/...'` statements will break. Use find-and-replace to rewrite to `'../../../installer/...'` (same relative path, different source root).
- **Shell scripts or CI/CD:** `install.sh` may hardcode paths like `./bin/lcm.ts`; audit and update.
- **npm scripts:** `package.json` scripts referencing `bin/lcm.ts` must update to `src/cli/lcm.ts`.

**Mitigation:** Before moving, grep for all references to `bin/` and `installer/` paths. Use TypeScript strict mode to catch import errors at compile time.

---

## Rationale
- **Conceptual clarity:** The repo has one source tree, not three separate entry points. Moving them under `src/` makes this explicit.
- **tsconfig simplicity:** `rootDir: "src"` is the TypeScript standard; current `rootDir: "."` is unusual and complicates module resolution.
- **Cleaner `dist/`:** Compiled output mirrors source: `dist/cli/`, `dist/installer/`, etc. No special `dist/bin/` prefix.
- **Reduced root clutter:** Root becomes cleaner: just config, docs, and CI workflows.
