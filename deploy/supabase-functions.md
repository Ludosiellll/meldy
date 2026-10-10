# Supabase Edge Functions

Each new line here runs `.github/workflows/supabase-functions.yml` (`supabase/deploy_functions.py`) with the owner's token
(repository secret `SUPABASE_ACCESS_TOKEN`): every function named after «deploy:» goes to the live project with the
Supabase CLI, which bundles `supabase/functions/<name>/` and the shared `supabase/functions/_shared/`. Whether a function
checks the caller's JWT comes from `supabase/config.toml`; a function without its section there is refused. Only the
newest line is read.
