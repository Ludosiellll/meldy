# Supabase Auth emails

Each new line here runs `.github/workflows/supabase-auth-email.yml`: the subjects and templates of
`supabase/auth_email/build.py`, the sender name, the hourly email cap and the redirect allow-list entry for the site
are set in the project through the Management API with the owner's token (repository secret `SUPABASE_ACCESS_TOKEN`).

- 2026-10-07 — first apply: Russian Meldy templates instead of the old «StudyForge» ones, sender «Meldy», 100 emails an hour, `https://ludosiel-studyforge.hf.space/**` in the redirect allow list (added only if missing).
