---
"@ipedro/lossless-claude": patch
---

Add CI workflow that runs type-check, tests, and build on pull requests and
pushes to main. Add `typecheck` script to package.json. Harden the publish
workflow with type-check and build verification steps before npm publish.
