-- live_no_ai_keys (a question whose key the AI picked plays in no game, duel or challenge)
-- Repo file: supabase/migrations/20261107090600_live_no_ai_keys.sql. Base: the live order up to
-- 20261107090500_studio_pages.sql (20261107090300_ai_key_flag.sql brought the flag ai_key in test_items.flags).
-- Why (owner, 05.11, the default of release 51's open question): a key from «Подобрать ключи с ИИ» is labelled
-- «Ключ подобран ИИ, не из файла» in the import's check, «Вопросы и ключи», a session and the bot, but a game, a duel
-- and a challenge show a key with no label: on the projector the whole class would learn an AI's mistake as the answer.
-- «Вопрос дня» (bot.group_item_ok) already skips such a question; now the games do too.
-- What changes (each function is its newest body with this file's change; grants are not touched):
-- 1. meldy_private.live_playable(test_items, boolean) (20261030090000_live_pictures.sql): false for a question whose
--    flags hold 'ai_key'. Its one-argument form is reached through it only (v_wide is true in every live_create since
--    20261031090000), so it stays as it is.
-- 2. meldy_private.live_more(test_items, boolean) (20261102090200_live_ranges.sql): null for such a question.
-- 3. meldy_private.live_challenge_kind(test_items) (20261106090100_live_challenge.sql): null for such a question — the
--    challenge's and the duel's (live_duel_fill, the rematch) only filter.
-- So public.live_create (a battle, a battle with mini-games, «Встань на ответ», a game from the bot), challenge_create,
-- duel_create and a duel's rematch draw, count and name such a question as skipped; games, duels and challenges made
-- before keep their questions (they are copied into their own rows at the start). The flag goes when the author sets a
-- key by hand (20261107090300), and the question plays again from the next game on.
-- Check after the apply: supabase/tests/live_no_ai_keys.sql (catalog and pure calls; read-only). Local rehearsal (never
-- live): supabase/tests/local/live_no_ai_keys_run.sh. Rollback: supabase/rollback/20261107090600_live_no_ai_keys_down.sql.
-- Release order: this file first, then the site (the setup screens name the skip «Ключ подобран ИИ»); either alone is
-- safe. Re-runnable (OR REPLACE). The whole file is one request (supabase/migrate.py).

do $do$
begin
  if pg_catalog.to_regprocedure('meldy_private.live_playable(public.test_items, boolean)') is null
     or pg_catalog.to_regprocedure('meldy_private.live_more(public.test_items, boolean)') is null
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('meldy_private.live_more(public.test_items, boolean)'::regprocedure),
                          'when p_item.kind = ''number'' and pg_catalog.cardinality(p_item.answers) between 1 and 10') = 0
     or pg_catalog.to_regprocedure('meldy_private.live_challenge_kind(public.test_items)') is null
     or pg_catalog.strpos(pg_catalog.pg_get_functiondef('bot.group_item_ok(public.test_items)'::regprocedure), 'ai_key') = 0 then
    raise exception 'the base is expected: 20261107090300_ai_key_flag.sql on 20261106090100_live_challenge.sql';
  end if;
end;
$do$;

-- 1. A choice question the arena or a battle plays (20261030090000 §2): never one whose key the AI picked.
create or replace function meldy_private.live_playable(p_item public.test_items, p_wide boolean)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select not ('ai_key' = any (p_item.flags))
     and case when p_wide
              then p_item.kind in ('single', 'multiple')
                   and pg_catalog.cardinality(p_item.correct) = 1
                   and pg_catalog.jsonb_array_length(p_item.options) between 2 and 6
              else meldy_private.live_playable(p_item) end
$fn$;

-- 2. The other kinds a game plays (20261102090200 §2): none for a question whose key the AI picked.
create or replace function meldy_private.live_more(p_item public.test_items, p_text boolean)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case
    when 'ai_key' = any (p_item.flags) then null
    when p_item.kind in ('single', 'multiple') and pg_catalog.cardinality(p_item.correct) >= 2
         and pg_catalog.jsonb_array_length(p_item.options) between 2 and 6 then 'multiple'
    when p_item.kind = 'short' and p_text and pg_catalog.cardinality(p_item.answers) between 1 and 10 then 'short'
    when p_item.kind = 'number' and pg_catalog.cardinality(p_item.answers) between 1 and 10 then 'number'
  end
$fn$;

-- 3. The kind a challenge or a duel plays an item as (20261106090100 §2a): none for a question whose key the AI picked.
create or replace function meldy_private.live_challenge_kind(p_item public.test_items)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case
    when 'ai_key' = any (p_item.flags) then null
    when coalesce(pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(p_item.images -> 'stem') = 'array'
                                                     then p_item.images -> 'stem' end), 0) > 0
         or exists (select 1
                      from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_item.images -> 'options') = 'array'
                                                                then p_item.images -> 'options' else '[]'::jsonb end) o
                     where pg_catalog.jsonb_typeof(o) = 'array' and pg_catalog.jsonb_array_length(o) > 0) then null
    when p_item.kind in ('single', 'multiple') and pg_catalog.cardinality(p_item.correct) = 1
         and pg_catalog.jsonb_array_length(p_item.options) between 2 and 6 then 'single'
    else meldy_private.live_more(p_item, true)
  end
$fn$;
