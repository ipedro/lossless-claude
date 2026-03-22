## Philosophy: Flat is Fine
**Thesis:** Delete dead specs, purge .claude junk, add sensible gitignore patterns, keep root structure shallow and navigable.

### Delete
- `specs/` directory (6 old specs) — moved to `.xgh/specs/` with dated naming; this is the old convention
- `.claude/scheduled_tasks.lock` — session ephemera, not version control material
- `.claude/worktrees/lcm-cli-*` (7 dirs) — abandoned agent worktrees from development
- `sensitive-patterns-test.txt` at root — test artifact, belongs in `test/` or temp dirs
- `.changeset/cli-refactor-v1.md` — stale changelog entry (proper format in CHANGELOG.md)

### Add to .gitignore
- `data/*.db`, `data/*.db-shm`, `data/*.db-wal` — SQLite session files (runtime, not version control)
- `.claude/scheduled_tasks.lock` — cron locks
- `.claude/worktrees/` — local agent worktrees (regenerated per session)
- `lcm-cli-*/` — temp directories for agent runs
- `sensitive-patterns-test.txt` — test artifacts at root

### Leave alone (and why flat is good)
- `agents/`, `installer/`, `bin/` at root — discoverable, rarely change, no organizational overhead
- `docs/` — well-named docs for architecture/setup/plugins; flat enough
- `.xgh/specs/`, `.xgh/plans/` — dated naming auto-organizes chronologically; canonical location per CLAUDE.md
- `src/`, `test/` — already well-organized internally; don't flatten further
- `package.json`, `README.md`, `CLAUDE.md`, `AGENTS.md` at root — standard, essential files belong at top level

### Risk
- **Breakage:** If any scripts reference `specs/` directory, they will fail. Search CI/docs before delete.
- **Lost context:** Old specs in root may contain useful historical context; consider archiving to `.xgh/archived/` if uncertain.

### Summary
This cleanup removes session junk, unifies design specs in `.xgh/` with proper dating, and fixes gitignore to exclude runtime artifacts. The repo stays shallow: root files (config, docs, CLI), `src/test/docs/agents/installer/bin/` (logical groups), `.xgh/` (superpowers artifacts). No deep nesting. Ready to ship.
