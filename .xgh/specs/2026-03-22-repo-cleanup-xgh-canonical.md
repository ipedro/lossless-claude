# Repo Cleanup: xgh-Canonical Migration

## Philosophy: xgh-Canonical
**Thesis:** `.xgh/` is the standard for planning/design artifacts; consolidate all specs under it, delete the legacy root `specs/` folder, and establish a single source of truth.

---

## Move
- `specs/*.md` → `.xgh/specs/` — 6 legacy specs (depth-aware-prompts, env-config-extraction, extraction-plan, historical-session-backfill, lossless-claw-rename, summary-presentation) are outdated, pre-date xgh adoption, tracked in git but superseded by dated entries in `.xgh/specs/`

---

## Delete
- `specs/` folder entirely — duplicate folder, all content either superseded by `.xgh/specs/` or no longer active; clean break from pre-xgh era
- `agents/` folder — 4 agent metadata files (compaction-reviewer.md, health-investigator.md, memory-explorer.md, transcript-debugger.md) are dead weight; agent state lives in `.claude/worktrees/` or CLI config

---

## Add to .gitignore
- `lcm-cli-*/` pattern — 4+ orphaned temp agent dirs in root; add `lcm-cli-**/` to prevent future cruft
- `.xgh/reviews/` — internal review artifacts; mark as ignored if not already
- `sensitive-patterns-test.txt` — test artifact; add to ignore

---

## Execution Steps

1. **Archive (optional):** Create `.xgh/archive/legacy-specs/` if historical reference needed; otherwise skip
2. **Move & rm:** `git mv specs/*.md .xgh/specs/ 2>/dev/null || cp` + delete `specs/` and `agents/` folders
3. **Clean:** `rm -rf lcm-cli-*/ sensitive-patterns-test.txt`
4. **Update .gitignore:** Add patterns above
5. **Commit:** Single PR with message `chore: consolidate planning artifacts under xgh-canonical`

---

## Risk
- **Blame lineage:** Moving specs under git changes file history; acceptable since specs are mutable design docs, not production code
- **Broken links:** Any external refs to `specs/` paths will 404; acceptable (no external docs link to private specs)
- **Agent state:** `.claude/worktrees/` cleanup not included here; separate housekeeping task

---

## Benefits
- **Single source:** All current planning work lives in `.xgh/` with consistent dating (YYYY-MM-DD)
- **Reduced noise:** Root stays clean; 5 fewer folders to ignore/navigate
- **Standard compliance:** Aligns with CLAUDE.md guidance (specs → `.xgh/specs/`)
