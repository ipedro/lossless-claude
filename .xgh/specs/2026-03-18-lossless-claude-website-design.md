# lossless-claude.com — Website Design Spec

**Date:** 2026-03-18
**Domain:** lossless-claude.com
**Hosting:** GitHub Pages (static)

---

## Goals

- **Educate and convert equally** — explain the problem and solution, then drive installs
- **Primary audience:** Claude Code users who've hit the context window limit
- **Secondary audience:** AI developers curious about the DAG/LCM architecture

---

## Visual Tone

Clean, minimal, light background. Approachable OSS project page feel. Not dark/terminal-coded.

---

## Structure

Single scrolling page. No sub-pages.

---

## Page Sections

### 1 · Hero (above the fold)

**Headline:**
> "Claude Code has a memory problem. lossless-claude fixes it — permanently."

**Subhead:**
> DAG-based summarization that preserves every message, built natively for Claude Code. Nothing is ever lost.

**Primary CTA:**
```
claude plugins install @ipedro/lossless-claude
```

---

### 2 · Value bullets (scannable)

Three differentiators at a glance:

- **Lossless by design** — every message persists in SQLite; summaries link back to raw source
- **Long-term memory via Cipher** — high-signal moments (decisions, fixes, architecture) promoted to semantic storage, recalled across sessions
- **Claude Code native** — plugin manifest, lifecycle hooks, MCP tools; not a bolt-on

---

### 3 · How it works

Embed or prominent link to the animated DAG visualization at **losslesscontext.ai**.

Heading: *"See how the DAG works"*

This is the primary technical explainer — we don't replicate it, we point to it.

---

### 4 · What's different (for the curious)

Short comparison explaining that lossless-claude is built on lossless-claw's DAG architecture, with the following additions:

| Feature | lossless-claw | lossless-claude |
|---|---|---|
| Long-term memory | ✗ | Cipher integration — semantic promotion across sessions |
| Smart promotion | ✗ | Auto-detects high-signal summaries (decisions, fixes, architecture) |
| Daemon API | ✗ | Port 3737 REST + socket IPC |
| Multi-LLM | Generic abstraction | Anthropic SDK + OpenAI-compatible endpoints |
| Claude Code native | ✗ | Plugin manifest, lifecycle hooks, MCP tools |

**Tone:** Respectful attribution, confident about our additions. Credit Martian Engineering's work prominently and warmly.

---

### 5 · Install + config

**Quick start block:**
```
claude plugins install @ipedro/lossless-claude
```

Link to GitHub for full docs and configuration reference.

---

### 6 · Footer / Attribution

Full, warm attribution:

- **lossless-claw** by [Martian Engineering](https://martian.engineering) — the DAG architecture, LCM model, and foundational design decisions originate there
- **LCM paper** by [Voltropy](https://x.com/Voltropy)
- MIT License
- GitHub link

---

## Implementation Notes

- **Static site** hosted on GitHub Pages — plain HTML/CSS or a minimal static generator (no JS framework needed)
- **No build complexity** — the site is marketing copy, not an app
- Lives in the `lossless-claude` repo under a `docs/` or `site/` directory, or a dedicated `gh-pages` branch
- The losslesscontext.ai visualization is embedded via `<iframe>` or a prominent linked button — not replicated
- Add `.superpowers/` to `.gitignore` if not already present
