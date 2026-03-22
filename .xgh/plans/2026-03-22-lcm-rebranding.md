# LCM Rebranding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the project from `@ipedro/lossless-claude` (GitHub: `ipedro/lossless-claude`) to `@lossless-claude/lcm` (GitHub: `lossless-claude/lcm`), validate with a `0.7.0` publish, and reserve `1.0.0` for official launch.

**Architecture:** The project is a Node.js CLI + daemon (`lcm`) distributed via npm. It has a Claude Code plugin manifest (`.claude-plugin/plugin.json`), GitHub Actions workflows for publishing and versioning, a GitHub Pages site at `lossless-claude.com`, and documentation in `docs/` and `README.md`. All references to the old org/scope must be updated atomically in one PR.

**Tech Stack:** TypeScript, npm, GitHub Actions, GitHub Pages, Claude Code plugin system

---

## Task 1 — Phase 1: Infrastructure (manual)

These steps are performed manually by the repo owner before any code changes. No PR needed.

- [ ] **1.1 Create the new GitHub repo**
  ```bash
  gh repo create lossless-claude/lcm --public --description "Lossless context management for Claude Code"
  ```

- [ ] **1.2 Update git remote**
  ```bash
  git remote set-url origin git@github.com:lossless-claude/lcm.git
  git remote -v
  # Expected:
  # origin  git@github.com:lossless-claude/lcm.git (fetch)
  # origin  git@github.com:lossless-claude/lcm.git (push)
  ```

- [ ] **1.3 Push all branches**
  ```bash
  git push origin main develop github-pages
  # Also push any active fix/feature branches:
  git push origin --all
  git push origin --tags
  ```

- [ ] **1.4 Configure GitHub Pages**
  - Go to `https://github.com/lossless-claude/lcm/settings/pages`
  - Source: Deploy from branch `github-pages`, root `/`
  - Custom domain: `lossless-claude.com`
  - Verify CNAME file on `github-pages` branch contains `lossless-claude.com`

- [ ] **1.5 Set up NPM_TOKEN secret**
  - Go to `https://github.com/lossless-claude/lcm/settings/secrets/actions`
  - Add `NPM_TOKEN` with the npm publish token
  - Do NOT add `MARKETPLACE_TOKEN` (no longer needed)

- [ ] **1.6 Configure npm-publish environment**
  - Go to `https://github.com/lossless-claude/lcm/settings/environments`
  - Create environment `npm-publish` (required by the publish workflow)

- [ ] **1.7 Deprecate old npm package**
  ```bash
  npm deprecate @ipedro/lossless-claude "Package moved to @lossless-claude/lcm"
  ```
  Expected: no output on success. Verify:
  ```bash
  npm view @ipedro/lossless-claude deprecated
  # Expected: "Package moved to @lossless-claude/lcm"
  ```

- [ ] **1.8 Commit checkpoint**
  No code changes in this phase. Confirm all infra is ready before proceeding to Phase 2.

---

## Task 2 — Phase 2: Code Changes (one PR, target `main`)

> **Branch:** Create from `main` — e.g., `chore/rebrand-lcm`
> **Important:** The `github-pages` branch changes are a SEPARATE task (Task 3 below). Do NOT mix them into this PR.

### 2.1 Update `package.json`

File: `/package.json`

- [ ] **2.1.1 Update package name**
  - Old: `"name": "@ipedro/lossless-claude"`
  - New: `"name": "@lossless-claude/lcm"`

- [ ] **2.1.2 Update version**
  - Old: `"version": "0.6.0"`
  - New: `"version": "0.7.0"`

- [ ] **2.1.3 Update repository URL**
  - Old: `"url": "git+https://github.com/ipedro/lossless-claude.git"`
  - New: `"url": "git+https://github.com/lossless-claude/lcm.git"`

- [ ] **2.1.4 Update homepage**
  - Old: `"homepage": "https://github.com/ipedro/lossless-claude#readme"`
  - New: `"homepage": "https://github.com/lossless-claude/lcm#readme"`

- [ ] **2.1.5 Update bugs URL**
  - Old: `"url": "https://github.com/ipedro/lossless-claude/issues"`
  - New: `"url": "https://github.com/lossless-claude/lcm/issues"`

- [ ] **2.1.6 Commit**: `chore: rebrand package.json to @lossless-claude/lcm`

### 2.2 Update `.claude-plugin/plugin.json`

File: `/.claude-plugin/plugin.json`

- [ ] **2.2.1 Update repository field**
  - Old: `"repository": "https://github.com/ipedro/lossless-claude"`
  - New: `"repository": "https://github.com/lossless-claude/lcm"`

- [ ] **2.2.2 Update version field**
  - Old: `"version": "0.5.0"`
  - New: `"version": "0.7.0"`

- [ ] **2.2.3 Update author URL**
  No change needed. Author URL `https://github.com/ipedro` is Pedro's personal profile, not the repo. Leave as-is.

- [ ] **2.2.4 Commit**: `chore: rebrand claude-plugin manifest`

### 2.3 Update `README.md`

File: `/README.md`

- [ ] **2.3.1 Update npm badge URL**
  - Old: `https://www.npmjs.com/package/@ipedro/lossless-claude`
  - New: `https://www.npmjs.com/package/@lossless-claude/lcm`

- [ ] **2.3.2 Update npm badge image**
  - Old: `https://img.shields.io/npm/v/@ipedro/lossless-claude`
  - New: `https://img.shields.io/npm/v/@lossless-claude/lcm`

- [ ] **2.3.3 Update license badge**
  - Old: `https://img.shields.io/github/license/ipedro/lossless-claude`
  - New: `https://img.shields.io/github/license/lossless-claude/lcm`

- [ ] **2.3.4 Update node version badge**
  - Old: `https://img.shields.io/node/v/@ipedro/lossless-claude`
  - New: `https://img.shields.io/node/v/@lossless-claude/lcm`

- [ ] **2.3.5 Update npm install command**
  - Old: `npm install -g @ipedro/lossless-claude  # provides the `lcm` command`
  - New: `npm install -g @lossless-claude/lcm  # provides the `lcm` command`

- [ ] **2.3.6 Update marketplace install instructions**
  - Old:
    ```
    claude plugin marketplace add ipedro/xgh-marketplace
    claude plugin install lossless-claude
    lcm install
    ```
  - New:
    ```
    claude plugin add github:lossless-claude/lcm
    lcm install
    ```
  - Remove the marketplace section entirely (no longer using external marketplace). Merge into the standalone section.

- [ ] **2.3.7 Update standalone plugin install**
  - Old: `claude plugin add github:ipedro/lossless-claude`
  - New: `claude plugin add github:lossless-claude/lcm`

- [ ] **2.3.8 Commit**: `docs: rebrand README to @lossless-claude/lcm`

### 2.4 Update `docs/*.md`

Three files contain `ipedro` references:

- [ ] **2.4.1 Update `docs/configuration.md` line 8**
  - Old: `git clone https://github.com/ipedro/lossless-claude.git`
  - New: `git clone https://github.com/lossless-claude/lcm.git`

- [ ] **2.4.2 Update `docs/tui.md` line 9**
  - Old: `[Releases](https://github.com/ipedro/lossless-claude/releases)`
  - New: `[Releases](https://github.com/lossless-claude/lcm/releases)`

- [ ] **2.4.3 Update `docs/tui.md` line 17**
  - Old: `# or: go install github.com/ipedro/lossless-claude/tui@latest`
  - New: `# or: go install github.com/lossless-claude/lcm/tui@latest`

- [ ] **2.4.4 Commit**: `docs: rebrand docs/ references to lossless-claude/lcm`

### 2.5 Rewrite `.github/workflows/publish.yml`

File: `/.github/workflows/publish.yml`

The entire "Update marketplace entry" step (lines 83-110) must be **removed** and replaced with a self-referential version update that commits the new version into `.claude-plugin/plugin.json` on the current branch, before tagging.

- [ ] **2.5.1 Remove the old marketplace step** (lines 83-110)
  Delete the entire step:
  ```yaml
      - name: Update marketplace entry
        env:
          GH_TOKEN: ${{ secrets.MARKETPLACE_TOKEN }}
        run: |
          ...everything through the end of the file...
  ```

- [ ] **2.5.2 Insert new self-referential marketplace step**
  Add this step **after** the "Create GitHub release" step (after line 81):
  ```yaml
      - name: Update plugin manifest version
        run: |
          version="${{ steps.package.outputs.version }}"
          # Update version in .claude-plugin/plugin.json
          node -e "
            const fs = require('fs');
            const path = '.claude-plugin/plugin.json';
            const manifest = JSON.parse(fs.readFileSync(path, 'utf8'));
            manifest.version = process.env.VERSION;
            fs.writeFileSync(path, JSON.stringify(manifest, null, 2) + '\n');
          " VERSION="$version"
          # Commit and push to the current branch
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git add .claude-plugin/plugin.json
          git commit -m "chore: bump plugin manifest to $version [skip ci]"
          git push origin HEAD:${{ github.ref_name }}
        env:
          GH_TOKEN: ${{ github.token }}
  ```

- [ ] **2.5.3 Verify the full workflow file** after edits. The complete step list should be:
  1. Checkout
  2. Setup Node
  3. Install dependencies
  4. Type-check
  5. Run tests
  6. Build
  7. Read package version
  8. Ensure release tag does not already exist
  9. Verify npm identity
  10. Publish to npm
  11. Create and push release tag
  12. Create GitHub release
  13. Update plugin manifest version (**new**)

- [ ] **2.5.4 Commit**: `ci: replace external marketplace update with self-referential plugin manifest bump`

### 2.6 Update `.github/workflows/version-pr.yml`

File: `/.github/workflows/version-pr.yml`

- [ ] **2.6.1 Audit for `ipedro` references**
  The current file contains NO `ipedro` references. No changes needed. Confirm and move on.

### 2.7 Final verification before PR

- [ ] **2.7.1 Run global search for stale references**
  ```bash
  grep -r "ipedro/lossless-claude" --include="*.json" --include="*.md" --include="*.yml" --include="*.yaml" .
  grep -r "@ipedro/lossless-claude" --include="*.json" --include="*.md" --include="*.yml" --include="*.yaml" .
  ```
  Expected: zero results (excluding `node_modules/`, `dist/`, and `.git/`).

- [ ] **2.7.2 Run `npm pack --dry-run`**
  ```bash
  npm pack --dry-run
  ```
  Verify output shows:
  - Package name: `@lossless-claude/lcm`
  - Version: `0.7.0`
  - No unexpected files included

- [ ] **2.7.3 Run tests**
  ```bash
  npm test
  npm run typecheck
  ```
  Expected: all tests pass, no type errors.

- [ ] **2.7.4 Open PR**
  ```bash
  gh pr create --title "chore: rebrand to @lossless-claude/lcm" \
    --body "Rebrands all references from ipedro/lossless-claude to lossless-claude/lcm. See spec: .xgh/specs/sensitive-patterns-architecture.md"
  ```

---

## Task 3 — Phase 2b: `github-pages` Branch Changes (separate from main)

> **Important:** These changes are on the `github-pages` branch, NOT `main`. Check out that branch separately.

- [ ] **3.1 Check out `github-pages` branch**
  ```bash
  git checkout github-pages
  ```

- [ ] **3.2 Audit for stale references**
  ```bash
  grep -r "ipedro/lossless-claude" .
  grep -r "@ipedro/lossless-claude" .
  grep -r "ipedro/xgh-marketplace" .
  ```
  Note every file and line that matches.

- [ ] **3.3 Update all found references**
  For each match:
  - `ipedro/lossless-claude` -> `lossless-claude/lcm`
  - `@ipedro/lossless-claude` -> `@lossless-claude/lcm`
  - `ipedro/xgh-marketplace` -> remove marketplace references entirely
  - Update any `npm install` commands to use `@lossless-claude/lcm`
  - Update any `claude plugin add` commands to use `github:lossless-claude/lcm`

- [ ] **3.4 Verify CNAME file**
  ```bash
  cat CNAME
  # Expected: lossless-claude.com
  ```
  If missing or wrong, create/fix it.

- [ ] **3.5 Commit and push**
  ```bash
  git add -A
  git commit -m "docs: rebrand site to lossless-claude/lcm"
  git push origin github-pages
  ```

- [ ] **3.6 Return to main branch**
  ```bash
  git checkout main
  ```

---

## Task 4 — Phase 3: Validation

- [ ] **4.1 Audit user-facing content**
  Manually verify:
  - README install instructions say `npm install -g @lossless-claude/lcm`
  - Plugin install says `claude plugin add github:lossless-claude/lcm`
  - Website at `lossless-claude.com` shows correct install commands (after github-pages deploy)

- [ ] **4.2 Dry-run npm pack**
  ```bash
  npm pack --dry-run 2>&1 | head -5
  # Expected first line: npm notice name: @lossless-claude/lcm
  # Expected second line: npm notice version: 0.7.0
  ```

- [ ] **4.3 Trigger publish workflow**
  ```bash
  gh workflow run publish.yml --ref main
  ```
  Monitor:
  ```bash
  gh run list --workflow=publish.yml --limit 1
  gh run watch  # watch latest run
  ```

- [ ] **4.4 Verify npm registry**
  ```bash
  npm view @lossless-claude/lcm@0.7.0
  ```
  Expected: package metadata with correct name, version, repository URL.

- [ ] **4.5 Verify website**
  ```bash
  curl -sI https://lossless-claude.com | head -5
  # Expected: HTTP/2 200
  ```

- [ ] **4.6 Verify install end-to-end**
  ```bash
  npm install -g @lossless-claude/lcm
  lcm -v
  # Expected: 0.7.0
  ```

- [ ] **4.7 Handle failures**
  If any validation step fails:
  - Fix the issue on `main`
  - Bump version to `0.7.1` in `package.json`
  - Re-trigger publish workflow
  - Do NOT cut `1.0.0` until a clean `0.7.x` publish succeeds

---

## What Does NOT Change

- CLI binary name: `lcm`
- Domain: `lossless-claude.com`
- Author credit: Pedro Almeida
- License: MIT
- Version `1.0.0` is reserved for the official public launch
