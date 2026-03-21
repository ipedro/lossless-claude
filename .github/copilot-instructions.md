# Copilot Instructions

## Reference Documents

When reviewing changes, consult the relevant sources of truth:

| Area | Document |
|------|----------|
| PR review & merge conventions | [AGENTS.md](/AGENTS.md) |
| Development workflow & phases | [WORKFLOW.md](/WORKFLOW.md) |
| Release & publish process | [RELEASING.md](/RELEASING.md) |
| Hook lifecycle & auto-heal | [.claude-plugin/hooks/README.md](/.claude-plugin/hooks/README.md) |
| Design specs & decisions | `.xgh/specs/YYYY-MM-DD-<topic>-design.md` |
| Implementation plans | `.xgh/specs/YYYY-MM-DD-<topic>-plan.md` |
| CLI entry points | `bin/lossless-claude.ts` |
| Daemon routes | `src/daemon/routes/*.ts` |
| Config type & defaults | `src/daemon/config.ts` (`DaemonConfig`) |

## Review Scope

Always review every file in the PR diff, including documentation, specs, plans, configs, and markdown files — not just code. If a PR contains design specs (`.xgh/specs/`), implementation plans, workflow docs, or instruction files, review them for clarity, correctness, internal consistency, and alignment with existing project conventions.

## Code Review Checklist

When reviewing pull requests that include code, verify these invariants:

### Hook Safety
- All hook handlers in `src/hooks/*.ts` must return `{ exitCode: 0 }` on error — never throw or return non-zero
- Hooks must never crash Claude Code, even if the daemon is unreachable

### Database Safety
- Every `new DatabaseSync()` call must have a matching `db.close()` in a `finally` block
- Every database must set `PRAGMA busy_timeout = 5000` before queries
- `--dry-run` commands must not call `runLcmMigrations()` or otherwise write to disk

### Import Discipline
- Required dependencies are limited — see `package.json` `dependencies` (not `devDependencies`)
- All other packages (e.g., `openai`, `@anthropic-ai/sdk`) must use lazy `await import()`, never top-level imports
- Use `node:` prefix for Node.js built-ins

### Type Completeness
- When adding fields to shared types (e.g., `DaemonConfig`), verify all test mocks and fixtures include the new field
