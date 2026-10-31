-- Rollback of supabase/migrations/20261105090000_quiz_stats.sql: the four functions go, bot.answered_since is again
-- T1's (word for word), and test_answers.source again takes web, bot and bot_group only. The answers quiz_send_mistakes
-- put into training stay (they are the participants' own answers, client_event_id qz:…, on the day of their attempt);
-- their source 'quiz' becomes 'web', as the old check wants. That UPDATE reads the whole of test_answers and the
-- restored check is validated in the same transaction (the catalog as before the file), under the ACCESS EXCLUSIVE lock
-- of the DROP/ADD: fine at its size on 2026-11-05 (7 814 rows, 4 MB); on a much bigger table split it. The site's
-- statistics then answer «не удалось посчитать разбор» on the analysis and «Повторить» (the results page itself keeps
-- working); roll the site back first or with it. Re-runnable.
set lock_timeout = '5s';

do $do$
begin
  if exists (select 1 from pg_catalog.pg_constraint k
              where k.conrelid = 'public.test_answers'::regclass and k.conname = 'test_answers_source_check'
                and pg_catalog.pg_get_constraintdef(k.oid) like '%''quiz''%') then
    update public.test_answers a set source = 'web' where a.source = 'quiz';
    alter table public.test_answers drop constraint test_answers_source_check;
    alter table public.test_answers add constraint test_answers_source_check
      check (source in ('web', 'bot', 'bot_group')) not valid;
  end if;
end;
$do$;
alter table public.test_answers validate constraint test_answers_source_check;

create or replace function bot.answered_since(p_user uuid, p_at timestamptz)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select exists (select 1 from public.test_answers a
                  where a.user_id = p_user and a.local_date >= (p_at at time zone 'utc')::date - 2
                    and a.created_at > p_at)
$fn$;

drop function if exists public.quiz_analysis(uuid);
drop function if exists public.quiz_compare(uuid, uuid);
drop function if exists public.quiz_send_mistakes(uuid, text);
drop function if exists public.quiz_send_mistakes(uuid, uuid);
drop function if exists public.quiz_send_mistakes(uuid);
drop function if exists public.test_item_percents(uuid);
