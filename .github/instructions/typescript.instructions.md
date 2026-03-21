---
applyTo: "**/*.ts"
---

# TypeScript Conventions

- For new or modified files, use the `node:` prefix for all Node.js built-in imports
- `import type { ... }` when only importing types
- `DatabaseSync` from `node:sqlite` (not third-party SQLite wrappers)
- Vitest for testing (`describe`, `it`, `expect`, `vi`)
