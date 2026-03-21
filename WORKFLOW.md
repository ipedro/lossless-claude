# Development Workflow

This workflow is the default for all non-trivial features. When superpowers brainstorming asks design questions, these defaults apply unless the user overrides.

## Defaults (predefined answers for brainstorming)

| Question | Default Answer |
|----------|---------------|
| Spec location | `.xgh/specs/YYYY-MM-DD-<topic>-design.md` |
| Visual companion | No (CLI project, no visual questions) |
| Implementation approach | Parallel tracks — breaking changes isolated from additive work |
| Registry/config format | TypeScript (type-safe, compile-time checks) |
| Install behavior | Auto-write files (match brv UX) |
| State tracking | Filesystem scan (no state files) |
| Release strategy | Parallel tracks with separate PRs |
| PR review | Copilot via reviewers list, not @copilot tag |

## Phase 1: Design (Opus, max effort)

1. Study the spec/requirements using brainstorming skill
2. Ask clarifying questions only for genuinely ambiguous decisions — use defaults above for standard questions
3. Propose 2-3 approaches with trade-offs, recommend one
4. Present design sections incrementally, get user approval
5. Write design spec to `.xgh/specs/`
6. Run spec review loop (code-reviewer agent + user review)
7. Write implementation plan to `.claude/plans/`

## Phase 2: Spec Review via PR

1. Create `docs/<topic>` branch from main
2. Ensure only spec/plan files are in the diff (push main first if it has unpushed commits)
3. Push and open PR
4. Request Copilot review (add `copilot-pull-request-reviewer[bot]` to reviewers)
5. Address any Copilot findings
6. Merge once Copilot has no issues

## Phase 3: Implementation (Sonnet subagents)

1. Create `feat/<topic>` branch from main
2. Dispatch Sonnet-model subagents for each independent task in the plan
3. Each subagent works in an isolated worktree
4. Subagents follow the plan, write code + tests
5. All work merged back to the feature branch

## Phase 4: Final Review (Opus, max effort)

1. Review all implementation work against the spec
2. Run full test suite — all tests must pass
3. Fix any issues found
4. Ensure changeset file exists if user-facing changes

## Phase 5: Implementation PR + Copilot Review

1. Push implementation branch, open PR
2. Request Copilot review (add to reviewers list)
3. Address Copilot comments (reply inline with `@copilot`, push fixes, re-request review)
4. Merge once Copilot approves

## Copilot Interaction

- **Trigger code review:** Add `copilot-pull-request-reviewer[bot]` to PR reviewers list via REST API
- **Re-trigger review** (after pushing fixes): Remove then re-add Copilot from reviewers list
- **Delegate work** (have Copilot open a PR): Tag `@copilot` in a PR comment
- **Reply to Copilot comments:** Start inline replies with `@copilot`
- **Never** tag `@copilot` in comments when you want a review — it opens a new PR instead

```bash
# Request review
gh api -X POST repos/{owner}/{repo}/pulls/{n}/requested_reviewers \
  -f 'reviewers[]=copilot-pull-request-reviewer[bot]'

# Re-trigger review (remove + add)
gh api -X DELETE repos/{owner}/{repo}/pulls/{n}/requested_reviewers \
  -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
gh api -X POST repos/{owner}/{repo}/pulls/{n}/requested_reviewers \
  -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```
