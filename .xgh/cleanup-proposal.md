# Repo Cleanup Proposal: Minimal-Touch Philosophy

## Philosophy: Minimal Touch
**Thesis:** Only remove clearly dead files and temp artifacts; fix gitignore to prevent future clutter; leave old specs (they're passive history).

---

### Delete
- `lcm-cli-*/` (4 directories) — Orphaned temp agent worktrees. Not part of .gitignore exclusion; should be cleaned.
- `sensitive-patterns-test.txt` — Test artifact left in root. Belongs in `test/` or `.gitignore`, not committed.

### Add to .gitignore
- `/lcm-cli-*/` — Pattern for temp CLI runner directories
- `/sensitive-patterns-test.txt` — Test artifact file
- `.claude/worktrees/` — Already excluded but make explicit to prevent future confusion

### Leave alone (and why)
- `specs/` directory — Old-style specs (pre-.xgh convention). Passive historical record; no maintenance burden. Rename later if needed.
- `dist/src/scrub.* dist/src/sensitive.*` — Already in `.gitignore` as part of `dist/` exclusion; the untracked status is git cache artifact. Run `git clean -fd dist/` to clear.
- `agents/` — Agent runbook docs; low-touch reference material.
- `.claude/` orphaned memory — Auto-cleanup via Serena; no action needed.
- `.xgh/` reviews/ — Passive archive; review metadata should stay.

### Risk
**Minimal.** These are temp files and uncontested deletions. No config rewrites, no structural moves. The only gotcha: ensure `git clean -fd dist/` is run post-gitignore update to clear the untracked dist build artifacts.

---

## Recommended commands
```bash
rm -rf lcm-cli-*/
rm sensitive-patterns-test.txt
echo '/lcm-cli-*/' >> .gitignore
echo '/sensitive-patterns-test.txt' >> .gitignore
git clean -fd dist/
git add .gitignore
git commit -m "chore: clean up temp artifacts and expand .gitignore"
```
