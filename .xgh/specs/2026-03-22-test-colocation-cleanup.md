## Philosophy: Test Colocation

**Thesis:** Tests belong next to source files (e.g., `src/llm/anthropic.test.ts`), not in a separate `test/` tree—colocated tests are easier to discover, maintain, and refactor together.

### Move
- `test/promotion/**` → `src/promotion/` — detector, dedup tests colocate with source
- `test/connectors/**` → `src/connectors/` — registry, installer, template-service, cli tests colocate
- `test/summarize.test.ts` → `src/summarize.test.ts` — single-file summary logic
- `test/llm/**` → `src/llm/` — anthropic, openai, codex-process, summarize-exports tests colocate
- `test/memory/api.test.ts` → `src/memory/api.test.ts` — memory API tests colocate
- `test/doctor/**` → `src/doctor/` — doctor, doctor-hooks tests colocate
- `test/mcp/server.test.ts` → `src/mcp/server.test.ts` — mcp server tests colocate
- `test/{diagnose,expansion,migration,large-files,fts-fallback}.test.ts` → `src/` — colocate by module

### Delete
- `test/` directory (entire tree) — obsolete after migration
- `bin/` directory (if it only contains build artifacts; retain only if source TypeScript)

### Add to .gitignore
- `*.test.ts` in src/ is redundant if already covered; ensure `**/*.test.ts` is indexed

### Update
- **package.json**: change `"test": "vitest run --dir test"` → `"test": "vitest run"`
- **vitest.config.ts**: remove `--dir test` override; keep `include: ["**/*.test.ts"]` (already correct)

### Risk
- **Import path changes**: Moving tests into `src/` may shift relative imports (`../../../` → `../`). Update all test imports carefully.
- **Build pipeline**: Ensure dist output excludes `.test.ts` files (check tsconfig.json or tsc config). TypeScript should already ignore `*.test.ts` by default with standard tooling.
- **IDE/editor discovery**: Some tools cache file locations; restart IDE after migration.

---

**Timeline**: ~2–3 hours for migration (1h move + rename, 1h update imports, 30m verify vitest discovers all tests).
