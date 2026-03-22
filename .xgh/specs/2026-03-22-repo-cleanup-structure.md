# Repo Cleanup & Structure Proposal

## Philosophy: Future-Proof
**Thesis:** Organize for a **multi-package monorepo**: core library in `/packages/lcm`, CLI utilities in `/packages/lcm-cli`, and docs/specs in a separate tree that scales with contributor docs and website content.

---

## Move

- **`bin/` → `packages/lcm-cli/src/bin/`** — CLI belongs in CLI package, not root
- **`installer/` → `packages/lcm-cli/src/installer/`** — Tool code co-located with CLI
- **`specs/ → `.xgh/specs/`** — Consolidate design docs (already have `.xgh/specs/`; obsolete `/specs/` is duplicate)
- **`agents/ → `.xgh/agents/`** — Superpowers agent specs with other design artifacts
- **`.claude/ → .claude/project/`** — Isolate agent threads from project config (`.claude/project/` for CLAUDE.md, settings; `.claude/sessions/` for agent work)

---

## Delete

- **`lcm-cli-*` and `lossless-codex-*` dirs** — Orphaned agent temp directories (safe to rm; agents should use `.claude/worktrees/`)
- **`specs/` dir** — Obsolete; content already in `.xgh/specs/` or should move there
- **`AGENTS.md`** — Superseded by `.xgh/agents/` and superpowers task descriptions
- **`sensitive-patterns-test.txt`** — Test artifact; move to `test/fixtures/` if needed
- **`data/cipher-sessions.db*`** — Runtime artifact; add to `.gitignore`

---

## Add to .gitignore

```
# Agent temp directories
lcm-cli-*/
lossless-codex-*/

# Runtime databases & locks
data/cipher-sessions.db*
data/*.db-shm
data/*.db-wal

# Node compile cache
node-compile-cache/

# Test artifacts
sensitive-patterns-test.txt

# Env & secrets
.env.local
```

---

## Consider Later (Not Now, But Design For It)

- **Monorepo root**: When you add `packages/lcm-website` or `packages/lcm-codex`, move to pnpm workspaces + root `package.json`
- **Docs consolidation**: Merge `/docs/` into website package (e.g., `packages/lcm-website/docs/`)
- **CHANGELOG partitioning**: If multi-package, use per-package `CHANGELOG.md` + aggregate in root
- **Contributing guide**: Add `CONTRIBUTING.md` at root (PR templates, branch naming, release process)

---

## Risk: Adoption Inertia

**Moving** `bin/` and `installer/` creates short-term CI/deploy friction (update GitHub Actions, build scripts, import paths).

**Mitigation:**
1. Do this before a major version bump
2. Update all import paths in one commit
3. Add `bin/` symbolic link at root (legacy bridge) → `packages/lcm-cli/src/bin/`

**Alternative:** Keep current flat structure if single-package forever. But then delete orphaned dirs + add-to-gitignore now (low-risk wins).

---

## Recommendation

**Phase 1 (this week):** Delete orphaned dirs, update `.gitignore`, move `specs/ → .xgh/specs/`.  
**Phase 2 (before v2.0):** Move `bin/` and `installer/` to packages (if website/codex packages planned).
