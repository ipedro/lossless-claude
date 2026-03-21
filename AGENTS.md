# Repository Instructions

<!-- Claude Code include: @WORKFLOW.md -->
See [WORKFLOW.md](./WORKFLOW.md) for the full development workflow.

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
CACHE=~/.claude/plugins/cache/ipedro/lossless-claude/0.5.0
rm -rf "$CACHE" && mkdir -p "$CACHE"
cp .claude-plugin/plugin.json "$CACHE/"
cp -r .claude-plugin/commands "$CACHE/"
cp -r .claude-plugin/hooks "$CACHE/"
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
