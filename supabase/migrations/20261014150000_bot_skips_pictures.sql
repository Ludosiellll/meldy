-- The Telegram bot and pictures of questions (owner, 2026-10-14). The bot writes text only (every message through
-- send(), no photos: _shared/bot/security.test.ts), so a question with carried pictures (test_items.images, migration
-- 20261014120000) is not asked in Telegram: without its picture it cannot be answered. It is studied on the site and in
-- the Mini App, which show the pictures.
--   1. public.bot_session_items: only questions without pictures (the bot's startQueue leaves out a question it gets
--      no facts for, as it does for one without a key).
--   2. bot.group_item_ok: «Вопрос дня» never posts a question with pictures (one with a lost picture, has_image, was
--      already out).
-- Both bodies are as in 20261010120003 / 20261010120004 plus the one condition. CREATE OR REPLACE keeps grants and
-- comments. Rollback: supabase/rollback/20261014150000_bot_skips_pictures_down.sql.

-- 1.
create or replace function public.bot_session_items(p_tg_user_id bigint, p_container_id uuid, p_item_ids uuid[])
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_l bot.links%rowtype;
begin
  perform meldy_private.require_service_role();
  select * into v_l from bot.active_link(p_tg_user_id);
  if v_l.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_container_id is null or p_item_ids is null or pg_catalog.array_ndims(p_item_ids) is distinct from 1
     or pg_catalog.cardinality(p_item_ids) not between 1 and 60 then
    return pg_catalog.jsonb_build_object('status', 'invalid', 'reason', 'arguments');
  end if;
  if meldy_private.role_in(v_l.user_id, p_container_id) is null then
    return pg_catalog.jsonb_build_object('status', 'unavailable');
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'items', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'id', i.id, 'subject_id', i.subject_id, 'kind', i.kind, 'keep_order', i.keep_order, 'code', i.code,
             'rev', i.rev, 'options', i.options) order by x.o), '[]'::jsonb)
      from pg_catalog.unnest(p_item_ids) with ordinality x(id, o)
      join public.test_items i on i.id = x.id
     where i.container_id = p_container_id and i.keyed
       and i.images = '{}'::jsonb));
end;
$fn$;

-- 2.
create or replace function bot.group_item_ok(p_i public.test_items)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select p_i.id is not null and p_i.kind = 'single' and p_i.keyed and pg_catalog.cardinality(p_i.correct) = 1
     and not ('has_image' = any (p_i.flags))
     and p_i.images = '{}'::jsonb
     and pg_catalog.jsonb_array_length(p_i.options) between 2 and 8
     and pg_catalog.char_length(p_i.stem)
         + coalesce((select pg_catalog.sum(pg_catalog.char_length(o.value))
                       from pg_catalog.jsonb_array_elements_text(p_i.options) o), 0) <= 1500
     and not exists (select 1 from public.test_key_doubts d where d.item_id = p_i.id and d.resolved_at is null)
$fn$;
