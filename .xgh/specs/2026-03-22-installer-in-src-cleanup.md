## Philosophy: Installer-in-src

**Thesis:** TypeScript installers live outside `src/` for historical reasons; consolidating them unifies the source tree and simplifies build/import logic.

### Move
- `installer/install.ts` → `src/installer/install.ts` — installation is a first-class feature
- `installer/uninstall.ts` → `src/installer/uninstall.ts` — same rationale
- `installer/dry-run-deps.ts` → `src/installer/dry-run-deps.ts` — dependency injection for testing

### Delete
- `installer/` directory — once files are relocated

### Update
- `tsconfig.json` include: remove `"installer/**/*.ts"` (already in `"src/**/*.ts"`)
- `bin/lcm.ts`: change import paths from `"../installer/"` to `"../src/installer/"`

### Add to .gitignore
- `lcm-cli-*/` — temporary session dirs from tests/runs
- `sensitive-patterns-test.txt` — test artifact

### Risk
**Low.** The installer module has no external dependencies, zero references from other code except `bin/lcm.ts`. Type checking will immediately catch import mismatches. Test coverage exists via `test/installer/` mirrors (if present).

---

**Effort**: ~5 min (move 3 files, update 2 imports, clean build). No breaking changes — distribution still targets `dist/`.
