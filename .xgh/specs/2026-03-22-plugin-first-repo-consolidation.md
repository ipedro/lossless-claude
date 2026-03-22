# Plugin-First Repository Consolidation

## Philosophy: Plugin-First
**Thesis:** User-facing interfaces—CLI commands, hooks, agent instructions—live in `.claude-plugin/`; internal docs (architecture, testing, configuration) live in `/docs/`.

## Moves
| From | To | Reason |
|------|-----|--------|
| `/agents/` (4 .md files) | `.claude-plugin/agents/` | Agent prompts are user-facing plugin artifacts; consolidate with commands & hooks |
| `/specs/` (6 legacy .md files) | `.xgh/specs/` (already the canon source) | Avoid duplication; `.xgh/` is the canonical home (established pattern w/ .xgh/plans/) |
| `AGENTS.md` (root) | `.claude-plugin/README.md` section | Integrate agent reference into plugin's own documentation |
| `WORKFLOW.md` (root) | `/docs/workflow.md` | Internal workflow docs belong in `/docs/`, not root |
| `/docs/agent-tools.md` | `.claude-plugin/REFERENCE.md` | Agent tool reference is plugin-facing; move with agents/ |

## Deletes
| File/Folder | Reason |
|-------------|--------|
| `/specs/` (empty after move) | Legacy docs directory, superseded by `.xgh/specs/` |
| `.claude/worktrees/` (7 orphaned dirs) | Temporary agent sandbox dirs; clean up old sessions |

## Add to .gitignore
| Pattern | Reason |
|---------|--------|
| `.claude/worktrees/` | Temp directories for agent sessions; should never persist |
| `*-test.txt` | Test artifacts (e.g., `sensitive-patterns-test.txt`) should not be committed |

## Plugin Structure (Post-Consolidation)

```
.claude-plugin/
├── plugin.json                    # Main manifest
├── README.md                      # Plugin overview + agent reference
├── REFERENCE.md                   # Agent tool reference (from docs/agent-tools.md)
├── hooks/
│   └── README.md
├── commands/                      # User-facing CLI commands
│   ├── lcm-stats.md
│   ├── lcm-import.md
│   ├── lcm-diagnose.md
│   ├── lcm-doctor.md
│   └── lcm-sensitive.md
├── agents/                        # Agent prompts (moved from /agents/)
│   ├── compaction-reviewer.md
│   ├── health-investigator.md
│   ├── memory-explorer.md
│   └── transcript-debugger.md
└── skills/
    └── lossless-claude-upgrade/
        └── SKILL.md
```

## Risk
- **Perception shift**: Users may expect `/agents/` at root for discovery. Mitigate: update `CLAUDE.md` with `.claude-plugin/agents/` location and add index to `.claude-plugin/README.md`.
- **SEO/external links**: If `.claude-plugin/agents/` are shared externally, existing links to `/agents/` will 404. Mitigate: add 301 redirect comments or migration guide in CHANGELOG.

## Timeline
1. **Create** `.claude-plugin/agents/` & `.claude-plugin/REFERENCE.md`
2. **Move** 4 agent .md files + agent-tools.md reference
3. **Update** `.claude-plugin/README.md` with agent index
4. **Move** 6 legacy specs → `.xgh/specs/` (if not already)
5. **Delete** `/agents/`, `/specs/`, `.claude/worktrees/`
6. **Update** `.gitignore` & CLAUDE.md
