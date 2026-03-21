# CLI-First Connector Architecture

**Date:** 2026-03-21  
**Status:** Proposed  
**Owner:** lossless-claude  
**Related:** `.xgh/specs/2026-03-21-auto-process-provider-design.md`

## 1. Summary

Shift `lossless-claude` from an MCP-first / wrapper-assisted integration model to a CLI-first memory architecture with connector installation across agents and platforms.

This proposal does four things together:

1. Removes `lossless-codex` completely.
2. Makes `lcm` the primary memory interface for all non-hook integrations.
3. Adopts a connector model inspired by ByteRover's proven pattern: `skill`, `rules`, `mcp`, and `hook`.
4. Expands support beyond Claude Code and Codex to a wider agent/platform matrix through reusable connector manifests and templates.

The backend remains local-first and shared:

- project SQLite DAG
- promoted memory / semantic recall
- local daemon
- Claude hooks where available
- `lcm` CLI everywhere

The product center becomes shared memory across agents, not a single client wrapper.

## 2. Why Change

The current Codex wrapper approach is the wrong boundary for real coding workflows.

Problems with the wrapper path:

- It creates a parallel chat interface instead of integrating with native Codex TUI usage.
- It is not the actual environment users spend time in.
- It makes the docs claim stronger Codex support than the product really provides.
- It creates maintenance cost around a flow we do not want to recommend.

Separately, the current MCP-heavy mental model is too fragile as the primary integration strategy.

ByteRover's public reasoning is instructive:

- they found MCP installation and tool triggers inconsistent across operating systems, IDEs, CLIs, extensions, and models
- they responded by moving memory operations to a CLI-native surface with agent-specific connectors

That is the correct lesson to import here.

## 3. Product Direction

### New primary shape

`lossless-claude` becomes:

- shared memory runtime for agents
- CLI-first for explicit memory operations
- hook-enhanced where hooks exist
- connector-installed across agents/platforms

### Core principle

There should be one durable memory backend, one explicit memory CLI, and multiple connector types that adapt the CLI to each agent environment.

### Positioning

- Claude Code remains the strongest integration path because hooks exist.
- Codex becomes a first-class supported platform through native TUI usage plus connector guidance, not through a wrapper.
- Other agents are added through the same connector architecture.

## 4. Hard Decisions

### 4.1 Remove `lossless-codex` entirely

Delete:

- `bin/lossless-codex.ts`
- `src/adapters/codex.ts`
- `test/adapters/codex.test.ts`
- `test/fixtures/codex/exec-turn.jsonl`
- `lossless-codex` bin entry from `package.json`
- all README, website, docs, and release-note references to `lossless-codex`
- all “wrapper-first Codex” positioning

`lossless-codex` is not deprecated in this design. It is removed.

### 4.2 Keep `codex-process`

The `codex-process` summarizer remains valid.

Reason:

- it is part of the summarization backend, not the user-facing interaction model
- it still makes sense for `auto` provider resolution and Codex-native summarization

### 4.3 Keep MCP, but demote it

MCP remains supported, but it stops being the default architectural answer for agent memory operations.

New precedence:

1. hooks where available
2. `lcm` CLI everywhere
3. MCP as secondary / optional transport

## 5. New Architecture

### 5.1 Layers

#### Runtime

- daemon
- project SQLite database
- DAG compaction
- promoted memory / search

#### Interfaces

- Claude hooks
- `lcm` CLI
- MCP tools

#### Connectors

- `skill`
- `rules`
- `mcp`
- `hook`

### 5.2 Interface responsibilities

#### Hooks

Use only where the host actually supports them well.

Hooks remain responsible for:

- automatic restore
- prompt-time augmentation
- automatic compaction triggers
- integrity/self-heal where supported

#### `lcm` CLI

The CLI becomes the primary explicit interface for memory operations.

It should support at least:

- `lcm search`
- `lcm grep`
- `lcm describe`
- `lcm expand`
- `lcm store`
- `lcm stats`
- `lcm doctor`
- `lcm connectors list`
- `lcm connectors install`
- `lcm connectors remove`

Strong candidate additions:

- `lcm handoff`
- `lcm capture`
- `lcm status`

#### MCP

MCP remains useful for:

- platforms where it works well
- interactive retrieval convenience
- debugging
- compatibility with existing Claude workflows

But it is no longer the canonical memory interface.

## 6. Connector Model

Adopt the same high-level connector families ByteRover exposes publicly:

- `skill`
- `rules`
- `mcp`
- `hook`

### 6.1 `skill`

Install skill/instruction files into agent-specific project or user directories.

Best for:

- Codex
- Claude Code
- Cursor
- Windsurf
- Gemini CLI
- OpenCode
- Warp
- Copilot
- Roo
- Kiro
- similar skill-aware agents

Purpose:

- teach the agent when to use `lcm`
- standardize memory retrieval and handoff behavior
- keep platform logic out of the core runtime

### 6.2 `rules`

Install a rules file the agent reads at startup.

Best for:

- agents that consume project instructions but do not support rich skill systems
- fallback cases where skill installation is not available

### 6.3 `mcp`

Register MCP only where it is known to work sufficiently well.

Good for:

- Claude Code
- Cline
- Zed
- Qwen Code
- other agents with reliable MCP setup

### 6.4 `hook`

Use only where the host exposes real hook support.

Initially:

- Claude Code

Potential future:

- other platforms if true hook support becomes available

## 7. Platform Roadmap

This proposal includes full platform coverage in one roadmap.

Implementation can still be phased, but the support target is declared upfront.

### 7.1 CLI tools

- Claude Code
- Codex
- Gemini CLI
- OpenCode
- Qwen Code
- Warp
- Auggie CLI

### 7.2 AI IDEs

- Cursor
- Windsurf
- Zed
- Trae.ai
- Qoder
- Antigravity

### 7.3 VS Code agents/extensions

- Cline
- GitHub Copilot
- Roo Code
- Kilo Code
- Augment Code
- Amp
- Kiro
- Junie

### 7.4 Connector manifest approach

Each supported agent should be represented by a manifest:

- `id`
- display name
- category
- default connector type
- supported connector types
- install target paths
- restart instructions
- cleanup instructions
- validation checks

Example shape:

```ts
type ConnectorType = "skill" | "rules" | "mcp" | "hook";

type AgentConnectorManifest = {
  id: string;
  name: string;
  category: "cli" | "ide" | "vscode";
  defaultType: ConnectorType;
  supportedTypes: ConnectorType[];
  installTargets: Array<{
    type: ConnectorType;
    path: string | ((cwd: string, home: string) => string);
  }>;
  restartHint?: string;
  validate(): Promise<CheckResult[]>;
};
```

## 8. Claude Integration After The Shift

Claude integration does not regress.

Claude remains:

- hook-first
- optionally MCP-enabled
- able to use `lcm` CLI manually when needed

The new architecture clarifies Claude rather than replacing it:

- automatic behavior still comes from hooks
- manual/debug/handoff operations can also use the CLI
- MCP becomes convenience, not foundation

## 9. Codex Integration After The Shift

Codex becomes:

- native `codex`
- plus connector-installed guidance
- plus `lcm` CLI memory operations

This means:

- no wrapper
- no fake parity with Claude hooks
- no separate interaction model

Codex support becomes honest and first-class:

- strong retrieval path
- explicit durable storage path
- handoff-friendly workflow
- same backend as Claude

## 10. CLI Surface

### 10.1 Core commands

Required:

- `lcm search <query>`
- `lcm grep <pattern>`
- `lcm describe <id>`
- `lcm expand --query ...` and/or `lcm expand --id ...`
- `lcm store <text>`
- `lcm stats`
- `lcm doctor`

### 10.2 Connector commands

Required:

- `lcm connectors list`
- `lcm connectors install <agent>`
- `lcm connectors install <agent> --type <skill|rules|mcp|hook>`
- `lcm connectors remove <agent>`
- `lcm connectors doctor <agent>`

### 10.3 Handoff commands

Recommended:

- `lcm handoff create`
- `lcm handoff show`
- `lcm capture`

These commands should package high-signal durable state for the next agent and reduce the burden on manual `store` formatting.

## 11. Migration

### 11.1 Immediate removals

Remove all references to:

- “Codex wrapper”
- “wrapper-first Codex”
- “automatic Codex writeback through `lossless-codex`”

Replace with:

- native Codex
- connector-guided memory operations
- CLI-first memory interface

### 11.2 Docs

Update:

- README
- website
- configuration docs
- doctor/status output where necessary
- all Codex install instructions

Codex docs should say:

- install the package
- install/connect Codex support via connector
- use native Codex
- use `lcm` commands for memory operations

### 11.3 Tooling / packaging

Packaging should expose a single user-facing CLI family:

- `lossless-claude`
- `lcm`

Not:

- `lossless-codex`

## 12. Success Criteria

The redesign is successful when:

1. `lossless-codex` no longer exists anywhere in the product surface.
2. Native Codex becomes the official Codex workflow.
3. Claude remains stronger through hooks, without regression.
4. Memory operations are consistently available through `lcm`.
5. Connector installation scales platform support without per-agent product forks.
6. MCP is optional, not a single point of failure.

## 13. Risks

### Risk: CLI-only memory is less automatic

True, but it is more honest and portable.

Mitigation:

- preserve hooks where they exist
- add higher-level CLI commands such as `handoff` / `capture`
- strengthen connector prompts and templates

### Risk: supporting many platforms can sprawl

Mitigation:

- connector manifest abstraction
- reuse connector types instead of custom logic per brand
- treat the roadmap as platform coverage through templates, not bespoke feature branches

### Risk: MCP users may perceive a downgrade

Mitigation:

- keep MCP support
- clarify that CLI is now the canonical interface
- keep Claude hook behavior intact

## 14. Recommended Next Step

Write an implementation plan that does the work in this order:

1. remove `lossless-codex` code/tests/docs/package entries
2. define and ship the `lcm` CLI surface
3. introduce connector manifests and installer commands
4. migrate Claude and Codex docs to the new model
5. add platform templates for the full roadmap
6. update website positioning

