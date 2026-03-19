# lossless-claude.com Website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and deploy a single-page static marketing site for lossless-claude.com on GitHub Pages.

**Architecture:** Plain HTML/CSS/JS single file + assets on a gh-pages branch. No framework, no build step. DAG visualization built inline with HTML/CSS and optional IntersectionObserver animation.

**Tech Stack:** HTML5, CSS3, vanilla JS (ES6+), GitHub Pages, GitHub Actions (optional for deploy automation)

---

## Task 1: gh-pages branch + repo scaffold

Create the orphan branch and bare-minimum files so GitHub Pages can serve something immediately.

**Files created:**
- `index.html`
- `style.css`
- `CNAME`
- `robots.txt`
- `.gitignore`

**Steps:**

- [ ] From the repo root, create an orphan branch:
  ```bash
  git checkout --orphan gh-pages
  git rm -rf .
  ```

- [ ] Create `CNAME` with exact content (no trailing newline issues):
  ```
  lossless-claude.com
  ```

- [ ] Create `robots.txt`:
  ```
  User-agent: *
  Allow: /
  Sitemap: https://lossless-claude.com/sitemap.xml
  ```

- [ ] Create `.gitignore`:
  ```
  .DS_Store
  *.swp
  *~
  ```

- [ ] Create `style.css` as an empty file (placeholder for Task 2).

- [ ] Create `index.html` with the full HTML skeleton including all SEO/OG meta tags but an empty `<body>`:
  ```html
  <!DOCTYPE html>
  <html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>lossless-claude — permanent memory for Claude Code</title>
    <meta name="description" content="DAG-based summarization that preserves every message. Built natively for Claude Code. Nothing is ever lost.">
    <link rel="canonical" href="https://lossless-claude.com">

    <!-- Open Graph -->
    <meta property="og:type" content="website">
    <meta property="og:title" content="lossless-claude — permanent memory for Claude Code">
    <meta property="og:description" content="DAG-based summarization that preserves every message. Built natively for Claude Code. Nothing is ever lost.">
    <meta property="og:url" content="https://lossless-claude.com">
    <meta property="og:image" content="https://lossless-claude.com/og-image.png">

    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="lossless-claude — permanent memory for Claude Code">
    <meta name="twitter:description" content="DAG-based summarization that preserves every message. Built natively for Claude Code. Nothing is ever lost.">
    <meta name="twitter:image" content="https://lossless-claude.com/og-image.png">

    <!-- Favicon -->
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="icon" href="/favicon.ico" sizes="32x32">

    <link rel="stylesheet" href="style.css">
  </head>
  <body>
    <!-- Content added in subsequent tasks -->
  </body>
  </html>
  ```

- [ ] Create a minimal `favicon.svg` — a simple "L" lettermark in a rounded square:
  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
    <rect width="32" height="32" rx="6" fill="#1a1a2e"/>
    <text x="8" y="24" font-family="system-ui, sans-serif" font-size="22" font-weight="700" fill="#e0e0e0">L</text>
  </svg>
  ```

- [ ] Commit all files:
  ```bash
  git add index.html style.css CNAME robots.txt .gitignore favicon.svg
  git commit -m "scaffold: gh-pages branch with HTML skeleton, CNAME, and meta tags"
  ```

- [ ] Verify by opening `index.html` in a browser — should render a blank white page with the correct `<title>` in the tab.

---

## Task 2: Hero section + base CSS

Add the global styles (typography, colors, spacing) and the hero section with install CTA.

**Files modified:**
- `style.css`
- `index.html`

**Steps:**

- [ ] Replace the contents of `style.css` with the full base styles and hero styles:
  ```css
  /* === Reset & Base === */
  *, *::before, *::after {
    box-sizing: border-box;
    margin: 0;
    padding: 0;
  }

  :root {
    --color-bg: #fafafa;
    --color-surface: #ffffff;
    --color-text: #1a1a2e;
    --color-text-secondary: #555568;
    --color-accent: #4a6cf7;
    --color-accent-hover: #3b5de7;
    --color-border: #e2e2e8;
    --color-code-bg: #f0f0f5;
    --color-code-text: #1a1a2e;
    --font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --font-mono: "SF Mono", SFMono-Regular, ui-monospace, Menlo, Consolas, monospace;
    --max-width: 720px;
    --spacing-xs: 0.5rem;
    --spacing-sm: 1rem;
    --spacing-md: 2rem;
    --spacing-lg: 3rem;
    --spacing-xl: 5rem;
  }

  html {
    font-size: 16px;
    scroll-behavior: smooth;
  }

  body {
    font-family: var(--font-sans);
    color: var(--color-text);
    background: var(--color-bg);
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  a {
    color: var(--color-accent);
    text-decoration: none;
  }

  a:hover {
    text-decoration: underline;
  }

  /* === Layout === */
  .container {
    max-width: var(--max-width);
    margin: 0 auto;
    padding: 0 var(--spacing-md);
  }

  section {
    padding: var(--spacing-xl) 0;
  }

  /* === Hero === */
  .hero {
    padding: var(--spacing-xl) 0 var(--spacing-lg);
    text-align: center;
  }

  .hero h1 {
    font-size: 2rem;
    line-height: 1.25;
    font-weight: 700;
    margin-bottom: var(--spacing-sm);
    letter-spacing: -0.02em;
  }

  .hero .subhead {
    font-size: 1.2rem;
    color: var(--color-text-secondary);
    margin-bottom: var(--spacing-lg);
    max-width: 540px;
    margin-left: auto;
    margin-right: auto;
  }

  /* === Install Code Block === */
  .install-block {
    position: relative;
    background: var(--color-code-bg);
    border: 1px solid var(--color-border);
    border-radius: 8px;
    padding: var(--spacing-sm) var(--spacing-md);
    display: inline-flex;
    align-items: center;
    gap: var(--spacing-sm);
    font-family: var(--font-mono);
    font-size: 0.9rem;
    max-width: 100%;
    overflow-x: auto;
  }

  .install-block code {
    white-space: nowrap;
    user-select: all;
    color: var(--color-code-text);
  }

  .copy-btn {
    background: none;
    border: 1px solid var(--color-border);
    border-radius: 4px;
    padding: 4px 8px;
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--color-text-secondary);
    flex-shrink: 0;
    transition: background 0.15s, color 0.15s;
  }

  .copy-btn:hover {
    background: var(--color-border);
    color: var(--color-text);
  }

  /* === Responsive === */
  @media (max-width: 600px) {
    .hero h1 {
      font-size: 1.5rem;
    }

    .hero .subhead {
      font-size: 1rem;
    }

    .install-block {
      font-size: 0.8rem;
      padding: var(--spacing-xs) var(--spacing-sm);
    }
  }
  ```

- [ ] In `index.html`, replace the `<body>` content with the hero section:
  ```html
  <body>
    <main>
      <!-- Hero -->
      <section class="hero">
        <div class="container">
          <h1>Claude Code has a memory problem.<br>lossless-claude fixes it — nothing is ever lost.</h1>
          <p class="subhead">Every message, forever. Built natively for Claude Code.</p>
          <div class="install-block">
            <code>claude plugins install @ipedro/lossless-claude</code>
            <button class="copy-btn" data-copy="claude plugins install @ipedro/lossless-claude" aria-label="Copy install command">Copy</button>
          </div>
        </div>
      </section>
    </main>

    <script>
    // Copy-to-clipboard
    document.querySelectorAll('.copy-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var text = btn.getAttribute('data-copy');
        if (navigator.clipboard) {
          navigator.clipboard.writeText(text).then(function() {
            btn.textContent = 'Copied!';
            setTimeout(function() { btn.textContent = 'Copy'; }, 1500);
          });
        }
      });
    });
    </script>
  </body>
  ```

- [ ] Commit:
  ```bash
  git add style.css index.html
  git commit -m "feat: hero section with base CSS, install CTA, and copy-to-clipboard"
  ```

- [ ] Verify by opening `index.html` in a browser — hero should be centered, code block styled, copy button functional.

---

## Task 3: Value bullets section

Add three bullet cards below the hero.

**Files modified:**
- `index.html`
- `style.css`

**Steps:**

- [ ] Append the following CSS to `style.css`:
  ```css
  /* === Value Cards === */
  .values {
    background: var(--color-surface);
    border-top: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
  }

  .values-grid {
    display: grid;
    grid-template-columns: 1fr;
    gap: var(--spacing-md);
  }

  @media (min-width: 640px) {
    .values-grid {
      grid-template-columns: repeat(3, 1fr);
    }
  }

  .value-card {
    text-align: center;
    padding: var(--spacing-md) var(--spacing-sm);
  }

  .value-card .icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 48px;
    height: 48px;
    margin-bottom: var(--spacing-sm);
    color: var(--color-accent);
  }

  .value-card .icon svg {
    width: 32px;
    height: 32px;
  }

  .value-card h3 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: var(--spacing-xs);
  }

  .value-card p {
    font-size: 0.9rem;
    color: var(--color-text-secondary);
    line-height: 1.5;
  }
  ```

- [ ] In `index.html`, insert the following section after the closing `</section>` of the hero, inside `<main>`:
  ```html
      <!-- Value Bullets -->
      <section class="values">
        <div class="container">
          <div class="values-grid">
            <div class="value-card">
              <div class="icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z"/>
                  <path d="M12 8v8M8 12h8"/>
                </svg>
              </div>
              <h3>Lossless by design</h3>
              <p>Every message persists in SQLite. Summaries link back to raw source. Agents can always drill in.</p>
            </div>
            <div class="value-card">
              <div class="icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
                  <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
                  <line x1="12" y1="22.08" x2="12" y2="12"/>
                </svg>
              </div>
              <h3>Long-term memory via Cipher</h3>
              <p>High-signal moments — decisions, fixes, architecture — promoted to persistent storage, recalled across sessions.</p>
            </div>
            <div class="value-card">
              <div class="icon">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <rect x="4" y="4" width="16" height="16" rx="2"/>
                  <path d="M9 9h6v6H9z"/>
                </svg>
              </div>
              <h3>Claude Code native</h3>
              <p>Plugin manifest, lifecycle hooks, MCP tools. Not a bolt-on — built from the ground up for Claude Code.</p>
            </div>
          </div>
        </div>
      </section>
  ```

- [ ] Commit:
  ```bash
  git add style.css index.html
  git commit -m "feat: value bullets section with three feature cards"
  ```

- [ ] Verify in browser — three cards should stack on mobile, display in a 3-column grid on wider screens.

---

## Task 4: DAG visualization ("How it works")

Build the static SVG/HTML diagram showing the 5-step pipeline, with optional IntersectionObserver scroll animation.

**Files modified:**
- `index.html`
- `style.css`

**Steps:**

- [ ] Append the following CSS to `style.css`:
  ```css
  /* === DAG Section === */
  .how-it-works h2 {
    text-align: center;
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: var(--spacing-lg);
  }

  .dag-steps {
    display: flex;
    flex-direction: column;
    gap: 0;
    position: relative;
    max-width: 520px;
    margin: 0 auto;
  }

  .dag-step {
    display: flex;
    align-items: flex-start;
    gap: var(--spacing-sm);
    padding: var(--spacing-sm) 0;
    opacity: 0.35;
    transition: opacity 0.4s ease;
  }

  .dag-step.active {
    opacity: 1;
  }

  /* If JS is unavailable, show all steps fully visible */
  .no-js .dag-step {
    opacity: 1;
  }

  .dag-step-number {
    flex-shrink: 0;
    width: 32px;
    height: 32px;
    border-radius: 50%;
    background: var(--color-accent);
    color: #fff;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 0.85rem;
    font-weight: 700;
  }

  .dag-step-content h4 {
    font-size: 0.95rem;
    font-weight: 600;
    margin-bottom: 2px;
  }

  .dag-step-content p {
    font-size: 0.85rem;
    color: var(--color-text-secondary);
    line-height: 1.45;
  }

  .dag-connector {
    width: 2px;
    height: 16px;
    background: var(--color-border);
    margin-left: 15px; /* center under 32px circle */
  }

  @media (max-width: 600px) {
    .how-it-works h2 {
      font-size: 1.25rem;
    }
  }
  ```

- [ ] In `index.html`, insert the following section after the values section, inside `<main>`:
  ```html
      <!-- How It Works -->
      <section class="how-it-works">
        <div class="container">
          <h2>How it works</h2>
          <div class="dag-steps">
            <div class="dag-step" data-step="1">
              <div class="dag-step-number">1</div>
              <div class="dag-step-content">
                <h4>Messages arrive</h4>
                <p>Every message is stored verbatim in a local SQLite database. Nothing is discarded.</p>
              </div>
            </div>
            <div class="dag-connector"></div>
            <div class="dag-step" data-step="2">
              <div class="dag-step-number">2</div>
              <div class="dag-step-content">
                <h4>Compaction</h4>
                <p>Older messages are grouped into leaf summaries by a background daemon — your session is never blocked.</p>
              </div>
            </div>
            <div class="dag-connector"></div>
            <div class="dag-step" data-step="3">
              <div class="dag-step-number">3</div>
              <div class="dag-step-content">
                <h4>DAG nodes</h4>
                <p>Leaf summaries condense further into higher-level nodes, forming a directed acyclic graph of your project history.</p>
              </div>
            </div>
            <div class="dag-connector"></div>
            <div class="dag-step" data-step="4">
              <div class="dag-step-number">4</div>
              <div class="dag-step-content">
                <h4>Cipher promotion</h4>
                <p>High-signal nodes — architectural decisions, bug fixes, design rationale — are promoted to Cipher, the long-term semantic memory store.</p>
              </div>
            </div>
            <div class="dag-connector"></div>
            <div class="dag-step" data-step="5">
              <div class="dag-step-number">5</div>
              <div class="dag-step-content">
                <h4>Context assembly</h4>
                <p>Each new session is assembled from recent raw messages + DAG summaries + Cipher recall. Full fidelity, minimal tokens.</p>
              </div>
            </div>
          </div>
        </div>
      </section>
  ```

- [ ] Add `class="no-js"` to the `<html>` tag as a fallback flag. Then in the `<script>` block at the bottom of `<body>`, add the IntersectionObserver animation code (placing it after the existing copy-to-clipboard code):
  ```js
  // Remove no-js class
  document.documentElement.classList.remove('no-js');

  // Scroll-triggered DAG step animation
  if ('IntersectionObserver' in window) {
    var dagSteps = document.querySelectorAll('.dag-step');
    var observer = new IntersectionObserver(function(entries) {
      entries.forEach(function(entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add('active');
        }
      });
    }, { threshold: 0.5 });
    dagSteps.forEach(function(step) { observer.observe(step); });
  } else {
    // Fallback: show all steps
    document.querySelectorAll('.dag-step').forEach(function(s) {
      s.classList.add('active');
    });
  }
  ```

- [ ] Update the opening `<html>` tag to:
  ```html
  <html lang="en" class="no-js">
  ```

- [ ] Commit:
  ```bash
  git add style.css index.html
  git commit -m "feat: DAG visualization with IntersectionObserver scroll animation"
  ```

- [ ] Verify in browser — steps should start dimmed and highlight as they scroll into view. With JS disabled, all steps should display at full opacity.

---

## Task 5: "What's different" comparison section

Add the comparison table crediting lossless-claw and highlighting lossless-claude additions.

**Files modified:**
- `index.html`
- `style.css`

**Steps:**

- [ ] Append the following CSS to `style.css`:
  ```css
  /* === Comparison Section === */
  .comparison {
    background: var(--color-surface);
    border-top: 1px solid var(--color-border);
    border-bottom: 1px solid var(--color-border);
  }

  .comparison h2 {
    text-align: center;
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: var(--spacing-md);
  }

  .comparison-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.9rem;
    margin-bottom: var(--spacing-md);
  }

  .comparison-table th,
  .comparison-table td {
    padding: var(--spacing-xs) var(--spacing-sm);
    text-align: left;
    border-bottom: 1px solid var(--color-border);
    vertical-align: top;
  }

  .comparison-table th {
    font-weight: 600;
    background: var(--color-code-bg);
    font-size: 0.85rem;
  }

  .comparison-table td:first-child {
    font-weight: 500;
    white-space: nowrap;
  }

  .comparison .attribution {
    font-size: 0.85rem;
    color: var(--color-text-secondary);
    line-height: 1.6;
    text-align: center;
    max-width: 560px;
    margin: 0 auto;
  }

  @media (max-width: 600px) {
    .comparison-table {
      font-size: 0.8rem;
    }

    .comparison-table th,
    .comparison-table td {
      padding: var(--spacing-xs);
    }

    .comparison-table td:first-child {
      white-space: normal;
    }
  }
  ```

- [ ] In `index.html`, insert the following section after the how-it-works section, inside `<main>`:
  ```html
      <!-- What's Different -->
      <section class="comparison">
        <div class="container">
          <h2>What's different</h2>
          <table class="comparison-table">
            <thead>
              <tr>
                <th>Feature</th>
                <th>lossless-claw</th>
                <th>lossless-claude</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Long-term memory</td>
                <td>&mdash;</td>
                <td>Cipher integration — semantic promotion across sessions</td>
              </tr>
              <tr>
                <td>Smart promotion</td>
                <td>&mdash;</td>
                <td>Auto-detects high-signal summaries (decisions, fixes, architecture)</td>
              </tr>
              <tr>
                <td>Background daemon</td>
                <td>&mdash;</td>
                <td>Compaction runs automatically without blocking your session</td>
              </tr>
              <tr>
                <td>Multi-LLM</td>
                <td>Generic abstraction</td>
                <td>Anthropic-native + any OpenAI-compatible endpoint</td>
              </tr>
              <tr>
                <td>Claude Code integration</td>
                <td>Script-based / manual</td>
                <td>Plugin manifest + lifecycle hooks + MCP tools</td>
              </tr>
            </tbody>
          </table>
          <p class="attribution">
            lossless-claude builds on the DAG architecture pioneered by
            <a href="https://github.com/Martian-Engineering/lossless-claude">lossless-claw</a>
            from <a href="https://martian.engineering">Martian Engineering</a>.
            We're grateful for their foundational work.
          </p>
        </div>
      </section>
  ```

- [ ] Commit:
  ```bash
  git add style.css index.html
  git commit -m "feat: comparison table — lossless-claw vs lossless-claude"
  ```

- [ ] Verify in browser — table should be readable on both desktop and mobile, attribution text centered below.

---

## Task 6: Install + CTA section

Add a larger repeated install block and "View on GitHub" button.

**Files modified:**
- `index.html`
- `style.css`

**Steps:**

- [ ] Append the following CSS to `style.css`:
  ```css
  /* === CTA Section === */
  .cta-section {
    text-align: center;
  }

  .cta-section h2 {
    font-size: 1.5rem;
    font-weight: 700;
    margin-bottom: var(--spacing-xs);
  }

  .cta-section .subtext {
    color: var(--color-text-secondary);
    margin-bottom: var(--spacing-md);
    font-size: 1rem;
  }

  .cta-section .install-block {
    margin-bottom: var(--spacing-md);
  }

  .btn-github {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    padding: 12px 24px;
    background: var(--color-text);
    color: var(--color-bg);
    border-radius: 8px;
    font-size: 0.95rem;
    font-weight: 600;
    text-decoration: none;
    transition: background 0.15s;
  }

  .btn-github:hover {
    background: var(--color-text-secondary);
    text-decoration: none;
  }

  .btn-github svg {
    width: 20px;
    height: 20px;
  }
  ```

- [ ] In `index.html`, insert the following section after the comparison section, inside `<main>`:
  ```html
      <!-- Install CTA -->
      <section class="cta-section">
        <div class="container">
          <h2>Get started</h2>
          <p class="subtext">Install in one command. No config required.</p>
          <div class="install-block">
            <code>claude plugins install @ipedro/lossless-claude</code>
            <button class="copy-btn" data-copy="claude plugins install @ipedro/lossless-claude" aria-label="Copy install command">Copy</button>
          </div>
          <br>
          <a href="https://github.com/ipedro/lossless-claude" class="btn-github">
            <svg viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            View on GitHub
          </a>
        </div>
      </section>
  ```

- [ ] Commit:
  ```bash
  git add style.css index.html
  git commit -m "feat: install CTA section with GitHub button"
  ```

- [ ] Verify in browser — code block with copy button should work, GitHub button styled as dark pill.

---

## Task 7: Footer

Add the footer with attribution links and minimal styling.

**Files modified:**
- `index.html`
- `style.css`

**Steps:**

- [ ] Append the following CSS to `style.css`:
  ```css
  /* === Footer === */
  .site-footer {
    border-top: 1px solid var(--color-border);
    padding: var(--spacing-md) 0;
    text-align: center;
    font-size: 0.8rem;
    color: var(--color-text-secondary);
    line-height: 1.8;
  }

  .site-footer p {
    margin-bottom: var(--spacing-xs);
  }

  .site-footer a {
    color: var(--color-text-secondary);
    text-decoration: underline;
    text-underline-offset: 2px;
  }

  .site-footer a:hover {
    color: var(--color-text);
  }
  ```

- [ ] In `index.html`, insert the following after the closing `</main>` tag and before the `<script>` tag:
  ```html
    <footer class="site-footer">
      <div class="container">
        <p>
          Built on the DAG architecture from
          <a href="https://github.com/Martian-Engineering/lossless-claude">lossless-claw</a>
          by <a href="https://martian.engineering">Martian Engineering</a>.
        </p>
        <p>
          Informed by the <a href="https://papers.voltropy.com/LCM">LCM paper</a>
          by <a href="https://x.com/Voltropy">Voltropy</a>.
        </p>
        <p>
          <a href="https://github.com/ipedro/lossless-claude">GitHub</a> &middot;
          MIT License
        </p>
      </div>
    </footer>
  ```

- [ ] Commit:
  ```bash
  git add style.css index.html
  git commit -m "feat: footer with attribution to lossless-claw, LCM paper, and license"
  ```

- [ ] Verify in browser — footer should appear at the bottom with warm attribution text.

---

## Task 8: og:image social card

Create the Open Graph social preview image (1200x630px).

**Files created:**
- `og-image-generator.html` (temporary — used to generate the PNG)
- `og-image.png`

**Steps:**

- [ ] Create `og-image-generator.html` — a standalone HTML file that renders the social card at exact dimensions. This file will be opened in a browser and screenshotted:
  ```html
  <!DOCTYPE html>
  <html>
  <head>
    <meta charset="UTF-8">
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      body {
        width: 1200px;
        height: 630px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: #fafafa;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        color: #1a1a2e;
      }
      h1 {
        font-size: 64px;
        font-weight: 700;
        letter-spacing: -0.03em;
        margin-bottom: 16px;
      }
      p {
        font-size: 28px;
        color: #555568;
      }
    </style>
  </head>
  <body>
    <h1>lossless-claude</h1>
    <p>permanent memory for Claude Code</p>
  </body>
  </html>
  ```

- [ ] Generate the PNG using one of these methods (in order of preference):
  1. **Preferred — CLI screenshot:** If the `pageres-cli` or `puppeteer` tool is available:
     ```bash
     npx pageres og-image-generator.html 1200x630 --filename=og-image
     ```
  2. **Alternative — manual:** Open `og-image-generator.html` in Chrome, use DevTools device mode set to 1200x630, take a screenshot, save as `og-image.png` in the gh-pages root.

- [ ] Verify `og-image.png` exists and is under 100KB. If larger, compress with:
  ```bash
  # If available:
  npx imagemin-cli og-image.png --out-dir=.
  ```

- [ ] Remove the generator file (it's not needed for deployment):
  ```bash
  rm og-image-generator.html
  ```

- [ ] Commit:
  ```bash
  git add og-image.png
  git commit -m "feat: add og:image social card (1200x630)"
  ```

- [ ] Verify by pasting `https://lossless-claude.com` into the Twitter Card Validator or Facebook Sharing Debugger after deployment.

---

## Task 9: DNS + GitHub Pages activation

Configure the custom domain and enable HTTPS. This task is partially manual (DNS registrar) and partially GitHub Settings UI.

**Files already created:** `CNAME` (Task 1)

**Steps:**

- [ ] Push the `gh-pages` branch to the remote:
  ```bash
  git push -u origin gh-pages
  ```

- [ ] In the GitHub repo settings (`https://github.com/ipedro/lossless-claude/settings/pages`):
  1. Under **Source**, select **Deploy from a branch**.
  2. Select branch: `gh-pages`, folder: `/ (root)`.
  3. Click **Save**.

- [ ] At the domain registrar for `lossless-claude.com`, configure DNS:
  - Add four **A records** for the apex domain (`@`):
    ```
    185.199.108.153
    185.199.109.153
    185.199.110.153
    185.199.111.153
    ```
  - Add a **CNAME record** for `www`:
    ```
    www → ipedro.github.io
    ```

- [ ] Wait for DNS propagation (usually 5-30 minutes). Verify with:
  ```bash
  dig lossless-claude.com +short
  ```
  Expected output: the four GitHub Pages IPs listed above.

- [ ] Back in GitHub Pages settings, the custom domain `lossless-claude.com` should appear (auto-detected from the CNAME file). Check the **Enforce HTTPS** checkbox once the DNS check passes.

- [ ] Smoke test checklist:
  - [ ] `curl -I https://lossless-claude.com` returns HTTP 200
  - [ ] `curl -I http://lossless-claude.com` redirects to HTTPS
  - [ ] `curl -I https://www.lossless-claude.com` redirects to the apex domain
  - [ ] All page sections render correctly in the browser

---

## Task 10: Final polish + review

Verify performance budget, cross-browser compatibility, mobile responsiveness, and link validity.

**Files potentially modified:**
- `index.html` (minor fixes if needed)
- `style.css` (minor fixes if needed)

**Steps:**

- [ ] Measure total page weight. Open Chrome DevTools → Network tab → reload with cache disabled. Check that total transfer size is under 200KB. Alternatively:
  ```bash
  curl -s -o /dev/null -w '%{size_download}' https://lossless-claude.com
  ```
  Expected: well under 200KB (likely ~15-25KB for HTML+CSS+JS, plus og-image.png which is only loaded by crawlers).

- [ ] Cross-browser check — open the site in:
  - [ ] Safari (macOS)
  - [ ] Chrome (macOS or any)
  - [ ] Firefox (macOS or any)
  Verify: hero, value cards, DAG animation, comparison table, CTA, and footer all render correctly.

- [ ] Mobile responsive check — in Chrome DevTools, test at:
  - [ ] iPhone SE (375px wide)
  - [ ] iPad (768px wide)
  Verify: no horizontal scrolling, text readable, code blocks don't overflow, table is usable.

- [ ] Validate all external links (open each in a new tab):
  - [ ] `https://github.com/ipedro/lossless-claude`
  - [ ] `https://github.com/Martian-Engineering/lossless-claude`
  - [ ] `https://martian.engineering`
  - [ ] `https://papers.voltropy.com/LCM`
  - [ ] `https://x.com/Voltropy`

- [ ] Run the W3C HTML validator on the page:
  ```
  https://validator.w3.org/nu/?doc=https%3A%2F%2Flossless-claude.com
  ```
  Fix any errors found.

- [ ] If any fixes were made, commit:
  ```bash
  git add index.html style.css
  git commit -m "fix: final polish — cross-browser and responsive fixes"
  git push origin gh-pages
  ```

- [ ] Final verification: open `https://lossless-claude.com` on a phone (or phone simulator) and confirm the full page works end-to-end.
