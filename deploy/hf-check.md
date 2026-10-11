# Hugging Face checks

Each change to this file runs `.github/workflows/deploy-hf.yml` in check-only mode: the test job first passes every suite on the pushed commit (a dry run of the release gate), then it waits until the Space runs its current `main` and smoke-checks `/` and `/api/health`, without pushing.

- 2026-10-04: check the release 77d43d8 (tree of 2938979); the first run pushed it but its wait step failed on API parsing.
- 2026-10-04 01:35: re-check after following the API redirect (the API answers 307 to /api/spaces/Ludosiel/StudyForge).
- 2026-10-11: dry run of the new release gate (Vitest, bot tests and plan copy, frontend build in the Docker layout, pytest) and of the smoke check that waits up to two minutes for /api/health.
