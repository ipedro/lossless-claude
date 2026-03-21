# Development Workflow

This workflow is the default for all non-trivial features. When superpowers brainstorming asks design questions, these defaults apply unless the user overrides.

## Defaults (predefined answers for brainstorming)

| Question | Default Answer |
|----------|---------------|
| Spec location | `.xgh/specs/YYYY-MM-DD-<topic>-design.md` |
| Visual companion | No (CLI project, no visual questions) |
| Implementation approach | Parallel tracks — breaking changes isolated from additive work |
| Registry/config format | TypeScript (type-safe, compile-time checks) |
| Install behavior | Auto-write files (match ByteRover (brv) UX) |
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
7. Write implementation plan to `.xgh/specs/`

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

### Actions

- **Trigger code review:** Add `copilot-pull-request-reviewer[bot]` to PR reviewers list via REST API
- **Re-trigger review** (after pushing fixes): Remove then re-add Copilot from reviewers list
- **Delegate work** (have Copilot open a PR): Tag `@copilot` in a PR comment
- **Reply to Copilot comments:** Start inline replies with `@copilot`
- **Never** tag `@copilot` in comments when you want a review — it opens a new PR instead

### Exact Commands

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

Note: the DELETE may return 422 if Copilot already consumed the request. That's fine — proceed with the POST.

### Polling for Review Completion

Copilot reviews take 1-3 minutes. Do NOT sleep-poll in a loop. Use background commands.

```bash
# 1. Check if review request is still pending (Copilot hasn't started):
gh pr view {n} --json reviewRequests --jq '.reviewRequests[].login'
# Empty = Copilot picked it up. "Copilot" = still pending.

# 2. Check review count (compare before/after):
gh api repos/{owner}/{repo}/pulls/{n}/reviews --jq '. | length'

# 3. Most reliable: check timeline for reviewed event:
gh api repos/{owner}/{repo}/issues/{n}/timeline \
  --jq '[.[] | select(.event == "review_requested" or .event == "reviewed")] | .[-2:]'
# If last event is "reviewed" → review complete.
# If last event is "review_requested" → still in progress.

# 4. Get latest review details:
gh api repos/{owner}/{repo}/pulls/{n}/reviews \
  --jq '.[-1] | {state: .state, body: .body[:300]}'

# 5. Get new inline comments (after a timestamp):
gh api repos/{owner}/{repo}/pulls/{n}/comments \
  --jq '[.[] | select(.created_at > "TIMESTAMP")] | .[] | {path: .path, line: .line, body: .body[:250]}'
```

### Review Loop Procedure

1. Request review (POST to requested_reviewers)
2. Launch background command: `sleep 120 && <check review count>`
3. When notified, check latest review state and comments
4. If comments found: fix issues, commit, push, re-trigger review (DELETE + POST)
5. Repeat until review has 0 new comments or state is not CHANGES_REQUESTED

### Common Pitfalls

- **Stale diff**: If main has unpushed commits, push main first or the PR diff will include unrelated code
- **@copilot in comments**: Opens a new PR instead of triggering review. Always use the reviewers API.
- **DELETE 422**: Expected when Copilot already consumed the request. Ignore and POST.
