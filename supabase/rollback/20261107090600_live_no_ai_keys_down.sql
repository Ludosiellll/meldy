-- Rollback of supabase/migrations/20261107090600_live_no_ai_keys.sql: meldy_private.live_playable(test_items, boolean)
-- as 20261030090000_live_pictures.sql wrote it, meldy_private.live_more as 20261102090200_live_ranges.sql wrote it,
-- meldy_private.live_challenge_kind as 20261106090100_live_challenge.sql wrote it, each byte for byte (CREATE OR REPLACE
-- keeps the grants). A question whose key the AI picked plays in games, duels and challenges again (with no label);
-- games made meanwhile keep their questions. Roll the site back first or with this file (its setup screens would name
-- the skip that no longer happens). Re-runnable.

create or replace function meldy_private.live_playable(p_item public.test_items, p_wide boolean)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select case when p_wide
              then p_item.kind in ('single', 'multiple')
                   and pg_catalog.cardinality(p_item.correct) = 1
                   and pg_catalog.jsonb_array_length(p_item.options) between 2 and 6
              else meldy_private.live_playable(p_item) end
$fn$;

create or replace function meldy_private.live_more(p_item public.test_items, p_text boolean)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case
    when p_item.kind in ('single', 'multiple') and pg_catalog.cardinality(p_item.correct) >= 2
         and pg_catalog.jsonb_array_length(p_item.options) between 2 and 6 then 'multiple'
    when p_item.kind = 'short' and p_text and pg_catalog.cardinality(p_item.answers) between 1 and 10 then 'short'
    when p_item.kind = 'number' and pg_catalog.cardinality(p_item.answers) between 1 and 10 then 'number'
  end
$fn$;

create or replace function meldy_private.live_challenge_kind(p_item public.test_items)
returns text
language sql
stable
set search_path = ''
as $fn$
  select case
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
