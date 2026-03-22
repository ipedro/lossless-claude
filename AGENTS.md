# Repository Instructions

<!-- Claude Code include: @WORKFLOW.md -->
See [WORKFLOW.md](./WORKFLOW.md) for the full development workflow.

## Copilot Review Automation

**NEVER tag `@copilot` in PR comments or replies** — it triggers Copilot SWE agent to open a new PR (delegation mode), not re-review.

### Triggering Copilot re-review

```bash
# The [bot] suffix is REQUIRED — without it the API silently fails or returns 422
gh api repos/{owner}/{repo}/pulls/{n}/requested_reviewers \
  -X DELETE -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
gh api repos/{owner}/{repo}/pulls/{n}/requested_reviewers \
  -X POST -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```

### Two Copilot systems

| Trigger | System | Effect |
|---------|--------|--------|
| `@copilot` in comment | SWE agent | Opens a new PR with suggested changes |
| `copilot-pull-request-reviewer[bot]` in reviewer list | Reviewer bot | Code review with inline comments |

### What does NOT work

- `reviewers[]=Copilot` (no `[bot]`) — silently fails
- `reviewers[]=copilot-pull-request-reviewer` (no `[bot]`) — 422
- `gh pr edit --add-reviewer Copilot` — GraphQL error
- Tagging `@copilot` for review — opens PRs instead

## PR Review And Merge

- Before merging a PR, check whether it changes user-facing behavior or should appear in npm release notes.
- If yes, make sure a maintainer adds a `.changeset/*.md` file before merge or immediately after in a follow-up PR.
- Do not expect external contributors to know or run the Changesets workflow.
- Use the smallest appropriate bump:
  - `patch`: fixes, compatibility work, docs-visible behavior changes
  - `minor`: new features or notable new behavior
  - `major`: breaking changes
- Treat a PR as not release-ready until the changeset question has been answered.

## Local Environment Stability

After merging a feature PR, always rebuild and verify the local environment before moving on:

```bash
git checkout develop && git fetch origin develop && git reset --hard origin/develop
npm run build && chmod +x dist/bin/lcm.js && npm link
lcm doctor          # must show 0 failures
npm test            # must pass
```

Also sync the global plugin cache so Claude Code picks up updated hooks and commands:

```bash
# Find the cached plugin directory (version and owner may vary)
CACHE=$(ls -d ~/.claude/plugins/cache/*/lossless-claude/*/ 2>/dev/null | head -1)
if [ -n "$CACHE" ]; then
  rm -rf "$CACHE" && mkdir -p "$CACHE"
  cp .claude-plugin/plugin.json "$CACHE/"
  cp -r .claude-plugin/commands "$CACHE/"
  cp -r .claude-plugin/hooks "$CACHE/"
fi
```

Then run `/reload-plugins` inside Claude Code to apply the changes.

If anything fails, fix it before starting the next feature. A broken local env wastes time on every subsequent session (stale dist, wrong binary, hook errors, mismatched plugin cache).

## Bug Triage During Investigation

When you stumble across a bug while working on something else, **stop and file a GitHub issue immediately** before continuing:

```bash
gh issue create \
  --title "Short description of bug" \
  --body "**Observed:** what you saw\n**Expected:** what should happen\n**Root cause:** if known\n**Repro:** steps or code snippet" \
  --label bug
```

Then carry on with the original task. This ensures bugs are tracked and can be assigned to another agent without holding up the current work.

## Release Notes Source Of Truth

- Follow [RELEASING.md](./RELEASING.md) for the repo's full Changesets and publish workflow.
