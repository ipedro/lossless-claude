# Copilot PR Monitor — Dedicated Agent Architecture

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the inline cron prompt with a skill that dispatches purpose-built haiku/sonnet subagents for monitoring, implementing, and auto-healing Copilot PR reviews.

**Architecture:** An orchestrator skill (`copilot-pr-monitor`) dispatches three specialized subagents: a haiku `pr-monitor` that finds the active PR and checks for new reviews, a haiku/sonnet `copilot-implementer` selected by comment complexity, and a haiku `auto-healer` that re-triggers idle Copilot reviews. The orchestrator uses a `/tmp` lockfile and state file to serialize runs, filters already-handled comment IDs, and hands comment payloads to the implementer through a temp JSON file instead of inline prompt interpolation. Comments take precedence over idle: auto-heal only fires when there are no new comments and the PR timeline confirms no newer review request is pending.

**Tech Stack:** Claude Code skills (SKILL.md), Agent tool, haiku + sonnet models, `gh` CLI, `git`, `npm test`

---

## File Map

| File | Role |
|------|------|
| `~/.claude/skills/copilot-pr-monitor/SKILL.md` | Orchestrator — reads state, interpolates prompts, dispatches subagents |
| `~/.claude/skills/copilot-pr-monitor/prompts/pr-monitor.md` | Haiku subagent — finds active PR, returns structured JSON state |
| `~/.claude/skills/copilot-pr-monitor/prompts/auto-healer.md` | Haiku subagent — re-requests Copilot review via gh pr edit |
| `~/.claude/skills/copilot-pr-monitor/prompts/implementer.md` | Haiku/sonnet subagent — implements comments, tests, commits, pushes |

No npm code is changed. All tasks are prompt files. Verification is behavioral.

---

### Task 1: pr-monitor subagent prompt

**Files:**
- Create: `~/.claude/skills/copilot-pr-monitor/prompts/pr-monitor.md`

The monitor runs as a haiku Agent. Its final response must be exactly one JSON object — no prose, no markdown.

- [ ] **Step 1: Create the prompts directory**

```bash
mkdir -p ~/.claude/skills/copilot-pr-monitor/prompts
```

- [ ] **Step 2: Write the pr-monitor prompt**

Create `~/.claude/skills/copilot-pr-monitor/prompts/pr-monitor.md`:

```markdown
You are a PR monitor. Your job is to check the active Copilot-reviewed PR on the repo at REPO_SLUG and return a JSON object. Your final response must be exactly one JSON object, nothing else.

REPO_SLUG is a placeholder that the orchestrator replaces before sending you this prompt.

If any `gh` command fails, immediately return:
`{"status":"gh_error","error":"<message from gh stderr>"}`

If parsing `gh` JSON output fails, immediately return:
`{"status":"invalid_json"}`

## Steps

1. Find the active open PR targeting `develop`:
   ```
   gh pr list --repo REPO_SLUG --base develop --state open --json number,title,headRefName,updatedAt
   ```
   Parse the returned JSON array.
   Sort results by `updatedAt` descending.
   If no open PRs remain, return: `{"status":"no_active_pr"}`
   If more than one PR matches after this filter, return: `{"status":"ambiguous_prs"}`
   Otherwise, take the first entry and use its `number` and `headRefName`.

2. Get the most recent Copilot review:
   ```
   gh api repos/REPO_SLUG/pulls/{number}/reviews --jq '[.[] | select(.user.login == "copilot-pull-request-reviewer[bot]")] | sort_by(.submitted_at) | last | .submitted_at'
   ```
   If no review exists yet, use `"1970-01-01T00:00:00Z"` for `lastReview`.

3. Get the most recent review request timestamp:
   ```
   gh api repos/REPO_SLUG/pulls/{number}/timeline --jq '[.[] | select(.event == "review_requested")] | last | .created_at'
   ```
   If there is no `review_requested` event, use `"1970-01-01T00:00:00Z"` for `lastReviewRequest`.

4. Get the most recent commit push timestamp:
   ```
   gh api repos/REPO_SLUG/pulls/{number}/commits --jq 'last | .commit.committer.date'
   ```

5. Get current UTC time:
   ```
   date -u +"%Y-%m-%dT%H:%M:%SZ"
   ```

6. Compute `minutesSincePush`.
   Before running, replace `NOW_PLACEHOLDER` with the value of `now` and `LAST_PUSH_PLACEHOLDER` with the value of `lastPush` obtained from the previous steps.
   ```
   node -e "const d=s=>new Date(s); console.log(Math.floor((d('NOW_PLACEHOLDER')-d('LAST_PUSH_PLACEHOLDER'))/60000))"
   ```

7. Get new inline comments created after `lastPush`:
   ```
   gh api repos/REPO_SLUG/pulls/{number}/comments --jq '[.[] | select(.created_at > "LAST_PUSH" and .user.login == "copilot-pull-request-reviewer[bot]") | {id, path, line, body, created_at}]'
   ```
   Replace `LAST_PUSH` with the actual `lastPush` timestamp.

## Output format

Successful return:

```json
{
  "status": "ok",
  "pr": 60,
  "branch": "feat/redaction-stats-v2",
  "lastReview": "2026-03-22T00:55:16Z",
  "lastReviewRequest": "2026-03-22T00:52:10Z",
  "lastPush": "2026-03-22T00:51:37Z",
  "now": "2026-03-22T01:10:00Z",
  "minutesSincePush": 18,
  "newComments": [],
  "isIdle": false
}
```

Additional possible returns:
- `{"status":"no_active_pr"}`
- `{"status":"ambiguous_prs"}`
- `{"status":"gh_error","error":"<message from gh stderr>"}`
- `{"status":"invalid_json"}`
- `{"status":"checkout_conflict"}`

`newComments` contains only comments with `created_at > lastPush`.
`isIdle` is true when: `lastReview < lastPush` AND `minutesSincePush > 10` AND `newComments` is empty AND `lastReview > lastReviewRequest` (the orchestrator will do the final timeline check).
```

- [ ] **Step 3: Verify**

```bash
cat ~/.claude/skills/copilot-pr-monitor/prompts/pr-monitor.md | head -3
```

Expected: first line is `You are a PR monitor.`

---

### Task 2: auto-healer subagent prompt

**Files:**
- Create: `~/.claude/skills/copilot-pr-monitor/prompts/auto-healer.md`

- [ ] **Step 1: Write the auto-healer prompt**

Create `~/.claude/skills/copilot-pr-monitor/prompts/auto-healer.md`:

```markdown
You are an auto-healer for Copilot PR reviews. You receive a PR number and a repo slug already substituted into this prompt. Your final response must be exactly one JSON object, nothing else.

PR: PR_NUMBER
Repo: REPO_SLUG

## Steps

1. Remove Copilot as reviewer:
   ```bash
   gh pr edit PR_NUMBER --repo REPO_SLUG --remove-reviewer copilot-pull-request-reviewer
   ```

2. Wait 2 seconds:
   ```bash
   sleep 2
   ```

3. Add Copilot back as reviewer:
   ```bash
   gh pr edit PR_NUMBER --repo REPO_SLUG --add-reviewer copilot-pull-request-reviewer
   ```

4. Verify Copilot was added:
   ```bash
   gh api repos/REPO_SLUG/pulls/PR_NUMBER/requested_reviewers --jq '.users[].login'
   ```
   Confirm `copilot-pull-request-reviewer` appears in the output.
   If not found, report: `{"status":"reviewer_add_failed","pr":PR_NUMBER}`
   If found, report: `{"status":"reviewer_added","pr":PR_NUMBER}`
```

- [ ] **Step 2: Verify**

```bash
cat ~/.claude/skills/copilot-pr-monitor/prompts/auto-healer.md | head -3
```

Expected: first line is `You are an auto-healer for Copilot PR reviews.`

---

### Task 3: implementer subagent prompt

**Files:**
- Create: `~/.claude/skills/copilot-pr-monitor/prompts/implementer.md`

The orchestrator interpolates all placeholders before dispatching. This prompt does NOT handle re-requesting review — that is done by the orchestrator after the implementer succeeds.

- [ ] **Step 1: Write the implementer prompt**

Create `~/.claude/skills/copilot-pr-monitor/prompts/implementer.md`:

```markdown
You are a Copilot review implementer for the lossless-claude repo at `/Users/pedro/Developer/lossless-claude`. Your final response must be exactly one JSON object, nothing else.

You receive a file path containing Copilot inline comments. Read that JSON file, implement all comments, run the test suite, commit, and push. Do NOT re-request Copilot review — the orchestrator handles that after you return.

PR: PR_NUMBER
Branch: BRANCH_NAME
Repo: REPO_SLUG
Comments JSON path:
COMMENTS_JSON_PATH

## Steps

1. Read and validate the comments JSON from `COMMENTS_JSON_PATH`.
   The file contains a JSON array of comment objects with `id`, `path`, `line`, `body`, and `created_at`.
   If the file cannot be read or parsed, stop and report: `{"status":"invalid_comments_json"}`

2. Ensure you are on the correct branch:
   ```bash
   git -C /Users/pedro/Developer/lossless-claude status --porcelain
   ```
   If this returns any output, stop and report: `{"status":"dirty_worktree"}`
   Do NOT proceed.
   Then run:
   ```bash
   git -C /Users/pedro/Developer/lossless-claude checkout BRANCH_NAME
   git -C /Users/pedro/Developer/lossless-claude pull --ff-only origin BRANCH_NAME
   ```

3. For each comment in the Comments array:
   - Read the file at `path` to understand context
   - Apply the fix described in `body`
   - Simple renames and style fixes: apply directly
   - Logic changes: read surrounding code first, then apply carefully
   - Track the exact unique file paths in the `path` fields of the comments you implemented

4. Run the full test suite:
   ```bash
   npm --prefix /Users/pedro/Developer/lossless-claude test
   ```
   - If tests pass: continue to step 5.
   - If tests fail: make one fix attempt. Re-run tests.
   - If tests still fail after one attempt: stop and report `{"status":"tests_failed","pr":PR_NUMBER}`. Do NOT commit.

5. Commit only the touched files:
   Stage only the files listed in the `path` fields of the comments you implemented. Run `git add <file1> <file2> ...` with exactly those paths.
   ```bash
   git -C /Users/pedro/Developer/lossless-claude add path/to/file1 path/to/file2
   git -C /Users/pedro/Developer/lossless-claude commit -m "fix: address Copilot review feedback"
   ```

6. Push:
   ```bash
   git -C /Users/pedro/Developer/lossless-claude push origin BRANCH_NAME
   ```

7. Report:

```json
{
  "status": "implemented",
  "pr": 60,
  "implementedCommentIds": [101, 102],
  "filesChanged": ["src/file-a.ts", "src/file-b.ts"],
  "tests": "passed",
  "commitSha": "abc1234"
}
```
```

- [ ] **Step 2: Verify**

```bash
cat ~/.claude/skills/copilot-pr-monitor/prompts/implementer.md | head -3
```

Expected: first line is `You are a Copilot review implementer`

---

### Task 4: Orchestrator SKILL.md

**Files:**
- Create: `~/.claude/skills/copilot-pr-monitor/SKILL.md`

The orchestrator interpolates prompt templates before dispatching subagents. It is the only place that knows `REPO_SLUG`.

- [ ] **Step 1: Write the orchestrator skill**

Create `~/.claude/skills/copilot-pr-monitor/SKILL.md`:

```markdown
---
name: copilot-pr-monitor
description: Monitor the active Copilot-reviewed PR on ipedro/lossless-claude. Dispatches haiku subagents to check status, auto-heal idle reviews, and implement new comments. Use when the cron loop fires or when manually checking PR status.
---

## Configuration

```
REPO_SLUG = "ipedro/lossless-claude"
```

## Step 0: Concurrency guard and round cap

1. Check for lockfile at `/tmp/lcm-pr-monitor.lock`:
   - If it exists and is less than 5 minutes old: report "⏳ Previous run still active." and stop.
   - Otherwise: write the current timestamp to `/tmp/lcm-pr-monitor.lock`.

2. Read state from `/tmp/lcm-pr-monitor-state.json` (keys: `pr`, `lastHandledCommentIds`, `roundCount`).
   - If file does not exist, initialize state: `{ "pr": null, "lastHandledCommentIds": [], "roundCount": 0 }`.
   - Increment `roundCount`.
   - If `roundCount > 10`: report "🛑 Round cap reached (10). Stopping auto-monitor." Remove lockfile and stop.

3. Wrap all remaining steps in a try/finally. In the finally block: delete `/tmp/lcm-pr-monitor.lock`.

## Step 1: Dispatch pr-monitor (haiku)

Read the file `~/.claude/skills/copilot-pr-monitor/prompts/pr-monitor.md`.
Replace every occurrence of `REPO_SLUG` in the file contents with `ipedro/lossless-claude`.
Pass the resulting string as the prompt to a haiku Agent:

```
Agent(
  subagent_type: "general-purpose",
  model: "haiku",
  prompt: <interpolated pr-monitor prompt>,
  description: "check PR review status"
)
```

Parse the returned JSON.

- If `status == "no_active_pr"`: report "✅ No active PR." and stop.
- If `status == "ambiguous_prs"`: report "⚠️ Multiple open develop PRs matched. Refusing to guess." and stop.
- If `status == "gh_error"`: report `⚠️ pr-monitor gh error: {error}` and stop.
- If `status == "invalid_json"`: report "⚠️ pr-monitor could not parse gh JSON." and stop.
- If `status == "checkout_conflict"`: report "⚠️ Working tree state blocked local checkout. Resolve manually." and stop.
- If parse fails: report "⚠️ pr-monitor returned invalid JSON." and stop.
- After parsing `status == "ok"`, filter `newComments` to exclude any IDs already in `state.lastHandledCommentIds`.

## Step 2: Assess state

**Priority: comments before idle.** Check in this order:

**If filtered `newComments` is non-empty** → go to Step 3 (implement comments).

**Else if monitor `isIdle == true`**:
- Run:
  ```
  gh api repos/REPO_SLUG/pulls/{number}/timeline --jq '[.[] | select(.event == "review_requested")] | last | .created_at'
  ```
- Use the returned timestamp as the final idle guard.
- The PR is truly idle only when the monitor returned `isIdle == true` **and** the last `review_requested` event is older than `lastPush`.
- If that check passes: dispatch auto-healer (haiku):
  - Read `~/.claude/skills/copilot-pr-monitor/prompts/auto-healer.md`
  - Replace `PR_NUMBER` with the PR number, `REPO_SLUG` with `ipedro/lossless-claude`
  - Dispatch as haiku Agent
  - Report the auto-healer's output and stop.
- Otherwise report:
  ```
  ✅ No new comments. Review request already exists after the latest push.
  ```
  Stop.

**Else** → report:
```
✅ No new comments. Last review: {lastReview}. Last push: {lastPush}.
```
Stop.

## Step 3: Assess comment complexity

Default to **sonnet**.

Use **haiku** only when ALL of the following are true:
1. All comments touch a single file (all `path` fields are identical).
2. No comment touches a test file (no `path` contains `test`, `spec`, or `.test.`).
3. No comment body contains the words `logic`, `async`, `transaction`, or `refactor`.
4. Total comment count is 3 or fewer.

If any condition fails, use **sonnet**.

## Step 4: Dispatch implementer

Read `~/.claude/skills/copilot-pr-monitor/prompts/implementer.md`.

Write `newComments` as JSON to `/tmp/lcm-pr-comments-{pr}.json`.
In the implementer prompt, replace `COMMENTS_JSON_PATH` with that file path.

Perform the remaining string substitutions:
- Replace `PR_NUMBER` with the PR number from monitor JSON
- Replace `BRANCH_NAME` with `branch` from monitor JSON
- Replace `REPO_SLUG` with `ipedro/lossless-claude`

Dispatch as Agent with the selected model.

Parse the implementer's returned JSON.

- If `status == "dirty_worktree"`: surface to user, stop.
- If `status == "invalid_comments_json"`: surface to user, stop.
- If `status == "tests_failed"`: surface to user, stop.
- If the implementer reports any non-success status: surface to user, stop.
- After a successful implementer run: update `/tmp/lcm-pr-monitor-state.json` by appending the IDs of all handled comments to `lastHandledCommentIds`, and save the updated `roundCount`.

## Step 5: Dispatch auto-healer (haiku) to re-request review

After a successful implementer run, dispatch auto-healer to re-request Copilot review:
- Read `~/.claude/skills/copilot-pr-monitor/prompts/auto-healer.md`
- Replace `PR_NUMBER` and `REPO_SLUG`
- Dispatch as haiku Agent

## Step 6: Report

Summarize:
- Comments implemented (count)
- Files changed
- Tests result
- Commit SHA
- Model used (haiku/sonnet) and why
- Review re-requested
```

- [ ] **Step 2: Verify**

```bash
head -8 ~/.claude/skills/copilot-pr-monitor/SKILL.md
```

Expected: frontmatter with `name: copilot-pr-monitor`

---

### Task 5: Smoke test + wire to loop

- [ ] **Step 1: Invoke the skill manually once**

In your Claude Code session, run:
```
/copilot-pr-monitor
```

Expected: skill loads, dispatches haiku monitor, reports either "no active PR", "no new comments", or implements comments.

- [ ] **Step 2: Wire to loop**

Stop the old loop (if running). Restart with:
```
/loop 10m /copilot-pr-monitor
```

- [ ] **Step 3: Verify next tick**

After the next loop tick fires, confirm the skill dispatches a haiku subagent and returns a clean one-line report.

---

## Change log (2026-03-22 review)

| Issue | Task affected | Change summary |
|-------|--------------|----------------|
| HIGH-1 | Task 1 | Deterministic PR selection: sort by updatedAt desc, ambiguous_prs guard |
| HIGH-2 | Task 1 | Stdout contract corrected to "final response must be exactly one JSON object" |
| HIGH-3 | Task 3, Task 4 | COMMENTS_JSON replaced with file-based handoff via /tmp/lcm-pr-comments-{pr}.json |
| HIGH-4 | Task 4 | Concurrency lockfile + round cap (10) + state file added as Step 0 |
| MED-5 | Task 1 | minutesSincePush: added portable Node.js one-liner with explicit substitution |
| MED-6 | Task 1 | Added gh_error, invalid_json, checkout_conflict error outputs |
| MED-7 | Task 3 | pull --ff-only; dirty worktree check; explicit file staging instead of add -A |
| MED-8 | Task 1, Task 4 | isIdle tightened: added timeline review_requested check in orchestrator |
| MED-9 | Task 4 | lastHandledCommentIds persisted in state file; newComments filtered on each run |
| MED-10 | Task 2 | Auto-healer verifies reviewer was added; returns structured JSON |
| MED-11 | Task 4 | Complexity routing defaults to sonnet; haiku only when all 4 strict conditions met |
