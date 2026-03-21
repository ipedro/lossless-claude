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

These rules apply to **new and changed code** in the PR. Do not flag pre-existing code that the PR did not touch.

### Hook Safety
- Hook handlers (`handle*` functions in `src/hooks/*.ts`) must return `{ exitCode: 0 }` on error — never throw or return non-zero
- The hook dispatcher (`dispatchHook` in `src/hooks/dispatch.ts`) may throw on invalid input — that is intentional
- Hooks must never crash Claude Code, even if the daemon is unreachable

### Database Safety
- For new or modified database code, prefer using existing helpers (e.g., `getLcmConnection`) rather than constructing raw connections directly.
- For new or modified call sites that use `new DatabaseSync()`, ensure there is a matching `db.close()` in a `finally` block
- For new or modified database initialization code, ensure `PRAGMA busy_timeout = 5000` is set before queries
- For new or modified CLI commands that support `--dry-run`, ensure they do not call `runLcmMigrations()` or otherwise write to disk

### Import Discipline
- Required dependencies are listed in `package.json` `dependencies` (not `devDependencies`)
- Optional SDK packages (e.g., `openai`, `@anthropic-ai/sdk`) have dedicated wrapper modules in `src/llm/` — new call sites should import from those wrappers, not directly from the SDK
- Prefer `node:` prefix for Node.js built-ins in new code

### Type Completeness
- When adding fields to shared types (e.g., `DaemonConfig`), verify all test mocks and fixtures include the new field
