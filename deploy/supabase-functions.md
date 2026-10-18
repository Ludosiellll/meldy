# Supabase Edge Functions

Each new line here runs `.github/workflows/supabase-functions.yml` (`supabase/deploy_functions.py`) with the owner's token
(repository secret `SUPABASE_ACCESS_TOKEN`): every function named after «deploy:» goes to the live project with the
Supabase CLI, which bundles `supabase/functions/<name>/` and the shared `supabase/functions/_shared/`. Whether a function
checks the caller's JWT comes from `supabase/config.toml`; a function without its section there is refused. Only the
newest line is read.
- 2026-10-10 — deploy: telegram
- 2026-10-10 — deploy: telegram
- 2026-10-10 — deploy: telegram
- 2026-10-10 — deploy: telegram
- 2026-10-10 — deploy: telegram
- 2026-10-11 — deploy: telegram
- 2026-10-11 — deploy: telegram
- 2026-10-11 — deploy: telegram
- 2026-10-12 — deploy: telegram
- 2026-10-14 — deploy: telegram
- 2026-10-14 — deploy: telegram
- 2026-10-18 — deploy: quiz-media
