-- Rollback of supabase/migrations/20261105090000_quiz_stats.sql: the three functions go. The answers quiz_send_mistakes
-- put into training stay (they are the participants' own answers, as if given in a lesson; client_event_id qz:…). The site's
-- statistics then answer «не удалось загрузить разбор» on the analysis and «Повторить» (the results page itself keeps
-- working); roll the site back first or with it. Re-runnable.
drop function if exists public.quiz_analysis(uuid);
drop function if exists public.quiz_send_mistakes(uuid);
drop function if exists public.test_item_percents(uuid);
