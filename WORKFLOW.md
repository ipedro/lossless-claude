# Development Workflow

This workflow is the default for all non-trivial features. When superpowers brainstorming asks design questions, these defaults apply unless the user overrides.

## Continuous Improvement

This document is a living record. **Update it whenever you learn something:**

- A step that failed or caused rework → add it to Common Pitfalls
- A new default answer that proved correct → add it to the Defaults table
- A Copilot interaction pattern that worked (or didn't) → update the Copilot section
- A phase that needed reordering or an extra step → revise the phase
- A new tool, command, or technique that saved time → document it

**When to update:** At the end of every feature cycle (after the implementation PR merges), review this doc against what actually happened. If reality diverged from the doc, fix the doc — not reality.

**How to update:** Create a `docs/<topic>` branch, push, get Copilot review, merge to develop. Same flow as any other docs change.

## Branch Strategy

```
feature/docs branches → develop (default, protected) → main (releases only, protected)
```

- **`develop`** — Default branch. All PRs target develop. Protected: PRs required, linear history, no force push.
- **`main`** — Releases only. Merging develop → main triggers the publish workflow.
- **Feature branches** — `feat/<topic>`, `docs/<topic>`, `fix/<topic>`. Always branch from develop.

### Release Flow

1. Changesets accumulate on `develop` (`.changeset/*.md` files)
2. Version PR is auto-created by `changesets/action` on each develop push
3. When ready to release: merge the version PR on develop (bumps package.json)
4. Create PR: `develop` → `main`
5. Merge to main triggers publish workflow:
   - Type-check, test, build
   - Publish to npm (`@ipedro/lossless-claude`)
   - Create git tag + GitHub release
   - Update xgh-marketplace entry (Claude plugin marketplace)

### CI Triggers

| Workflow | Trigger | Purpose |
|----------|---------|---------|
| `ci.yml` | Push to develop/main + all PRs | Type-check, test, build |
| `version-pr.yml` | Push to develop | Auto-create version PR from changesets |
| `publish.yml` | `workflow_dispatch` (manual from main) | Publish npm + marketplace + tag |

## Defaults (predefined answers for brainstorming)

| Question | Default Answer |
|----------|---------------|
| Spec location | `.xgh/specs/YYYY-MM-DD-<topic>-design.md` |
| Plan location | `.xgh/plans/YYYY-MM-DD-<topic>.md` |
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
7. Write implementation plan to `.xgh/plans/`

## Phase 2: Spec Review via PR

1. **Sync first:** `git fetch origin develop && git rebase origin/develop` — stale diffs cause Copilot to review unrelated code
2. Create `docs/<topic>` branch from develop
3. Ensure only documentation files are in the diff — specs, plans, workflow docs
4. Push and open PR
5. Request Copilot review (see Copilot Exact Commands below)
6. Run review loop (see Copilot Review Loop below)
7. Merge once Copilot has no issues (max 3 rounds — see Review Loop)

## Phase 3: Implementation (model-appropriate subagents)

1. **Sync first:** `git pull origin develop` to get latest (including merged specs)
2. Dispatch subagents with `isolation: worktree` for each task in the plan
3. **Model selection by complexity:**
   - **Haiku** — style fixes, renames, simple edits, doc updates
   - **Sonnet** — feature implementation, test writing, multi-file changes
   - **Opus** — architectural decisions, complex refactors, final review
4. **Independent tasks** → launch in parallel (e.g., PR A: delete files, PR D: add new module)
5. **Sequential tasks** → launch one at a time; after merging upstream PR, rebase downstream branch: `git fetch origin develop && git rebase origin/develop`
6. Each subagent: implement code + tests, run `npm test`, commit (do NOT push)
7. After subagent completes: Opus reviews the diff, push, open PR, request Copilot review

## Phase 4: Final Review (Opus, max effort)

1. Review all implementation work against the spec
2. Run full test suite — all tests must pass
3. Fix any issues found
4. Ensure changeset file exists if user-facing changes

## Phase 5: Implementation PR + Copilot Review

1. Push implementation branch, open PR
2. Request Copilot review (see Exact Commands)
3. Run review loop (see below)
4. Merge per Review Loop rules (max 3 rounds, then judgment call)

## Copilot Interaction

### Two Copilot Systems

| Trigger | System | Effect |
|---------|--------|--------|
| `copilot-pull-request-reviewer[bot]` in reviewer list | Reviewer bot | Code review with inline comments |
| `@copilot` in PR comment | SWE agent | Opens a new PR with suggested changes (delegation) |

**NEVER tag `@copilot` when you want a review.** It opens a new PR instead.

### Exact Commands

```bash
# Request review (initial or re-trigger after fixes)
# The [bot] suffix is REQUIRED — without it the API silently fails or returns 422
gh api repos/{owner}/{repo}/pulls/{n}/requested_reviewers \
  -X DELETE -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
gh api repos/{owner}/{repo}/pulls/{n}/requested_reviewers \
  -X POST -f 'reviewers[]=copilot-pull-request-reviewer[bot]'
```

**Alternative (also works):**
```bash
gh pr edit {n} --repo {owner}/{repo} --remove-reviewer copilot-pull-request-reviewer[bot]
sleep 2
gh pr edit {n} --repo {owner}/{repo} --add-reviewer copilot-pull-request-reviewer[bot]
```

### Methods That Do NOT Work

- `reviewers[]=Copilot` (no `[bot]` suffix) — silently fails, 0 reviewers requested
- `reviewers[]=copilot-pull-request-reviewer` (no `[bot]`) — 422 for bot reviewers
- `gh pr edit --add-reviewer Copilot` — GraphQL error "Could not resolve user"
- Tagging `@copilot` in comments for review — opens new PRs instead
- Empty commits — Copilot does not reliably trigger on diffs with no substantive changes

### Replying to Copilot Comments

Reply inline **without** tagging `@copilot`. Just describe the fix plainly:
- Good: "Fixed — re-indented the callback body consistently."
- Bad: "@copilot Fixed — re-indented the callback body." ← this opens a new PR

### Polling for Review Completion

Copilot reviews take 1-5 minutes. Use cron jobs or background agents, not sleep loops.

```bash
# Check if review request is still pending:
gh pr view {n} --json reviewRequests --jq '.reviewRequests[].login'
# Empty = review submitted or reviewer removed. "copilot-pull-request-reviewer[bot]" = still pending.

# Get latest review state:
gh api repos/{owner}/{repo}/pulls/{n}/reviews \
  --jq '[.[] | select(.user.login == "copilot-pull-request-reviewer[bot]")] | last | {state: .state, submitted_at: .submitted_at}'

# Get new inline comments from a specific review:
gh api repos/{owner}/{repo}/pulls/{n}/reviews/{review_id}/comments \
  --jq '.[] | {path: .path, line: .line, body: .body}'

# Count total Copilot inline comments:
# Note: inline comments use login "Copilot", reviews use "copilot-pull-request-reviewer[bot]"
gh api repos/{owner}/{repo}/pulls/{n}/comments \
  --jq '[.[] | select(.user.login == "Copilot")] | length'
```

### Copilot Review Loop

1. Request review (DELETE + POST to requested_reviewers with `[bot]` suffix)
2. Set up a cron job or background agent to poll every 5 minutes
3. When review arrives, check comment count against baseline
4. If new comments found:
   a. Dispatch a haiku agent (worktree isolation) to fix all comments in a single commit
   b. If haiku fails (typecheck/test errors), escalate to sonnet
   c. Push, re-request review (DELETE + POST)
5. **Max 3 rounds.** After round 3, if remaining comments are minor nits (1-2 editorial suggestions), merge. If substantive comments remain, escalate to Opus for a judgment call. Do not chase zero comments indefinitely.
6. Review is "clean" when: 0 new comments, or only context-specific nits that Copilot can't understand (e.g., Claude Code conventions)

### Common Pitfalls

- **Stale diff**: Always rebase from develop before creating branches. If develop has unpushed commits, the PR diff includes unrelated code and Copilot reviews the wrong things.
- **`@copilot` in comments**: Opens a new PR instead of triggering review. Always use the reviewers API. This caused 23 unwanted sub-PRs in one session.
- **Missing `[bot]` suffix**: `copilot-pull-request-reviewer` without `[bot]` returns 422 via REST API. Always use `copilot-pull-request-reviewer[bot]`.
- **Empty commits don't trigger Copilot**: Copilot only reviews on substantive diffs. Use DELETE+POST re-request instead.
- **Code in docs PRs**: Cherry-pick only docs commits if the branch has mixed content. Use `git checkout -B <clean-branch> origin/develop && git cherry-pick <docs-commits>`.
- **Sequential PR chains**: After merging PR A, rebase PR B onto updated develop before pushing: `git fetch origin develop && git rebase origin/develop`.

## Orchestration Pattern

For multi-PR workflows, use an orchestrator (Opus) that delegates to model-appropriate agents:

```
Opus (orchestrator)
├── Haiku agents — PR monitoring, style fixes, simple edits
├── Sonnet agents — feature implementation, plan execution
└── Opus review — quality gate before each PR ships
```

1. **Opus** reads specs/plans and sets up the pipeline
2. **Cron job** polls PRs every 5 minutes for Copilot responses
3. **Haiku agents** handle fixes (escalate to sonnet if they fail)
4. **Sonnet agents** execute implementation plans (superpowers methodology, worktree isolation)
5. **Opus reviews** every sonnet output before the PR goes up
6. **Opus merges** PRs following the full workflow (typecheck, test, changeset, Copilot review)
