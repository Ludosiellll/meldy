-- Rollback of supabase/migrations/20261023090000_live_stand_phone.sql: the three functions as
-- 20261021090000_live_game.sql made them (the same text: the same catalog). Re-runnable.
--
-- A look with one of the kit's hats ('party', 'propeller', 'tophat') would be refused by the old check, and the join
-- checks a player's kept wardrobe look again: such hats become 'none' first (in the wardrobe and in the players of
-- games not ended), so nobody is locked out of a game.

update public.live_wardrobe w
   set look = pg_catalog.jsonb_set(w.look, '{hat}', '"none"'::jsonb)
 where w.look ->> 'hat' in ('party', 'propeller', 'tophat');

update public.live_players p
   set look = pg_catalog.jsonb_set(p.look, '{hat}', '"none"'::jsonb)
  from public.live_games g
 where g.id = p.game_id and g.state <> 'ended' and p.look ->> 'hat' in ('party', 'propeller', 'tophat');

create or replace function meldy_private.live_look_check(p_look jsonb, p_unlocked text[])
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_body text;
  v_colour text;
  v_eyes text;
  v_hat text;
begin
  if p_look is null or pg_catalog.jsonb_typeof(p_look) <> 'object'
     or pg_catalog.jsonb_typeof(p_look -> 'body') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_look -> 'colour') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_look -> 'eyes') is distinct from 'string'
     or pg_catalog.jsonb_typeof(p_look -> 'hat') is distinct from 'string' then
    perform meldy_private.live_fail('ML007', 'unknown_part');
  end if;
  v_body := p_look ->> 'body';
  v_colour := p_look ->> 'colour';
  v_eyes := p_look ->> 'eyes';
  v_hat := p_look ->> 'hat';
  if v_body not in ('round', 'square', 'drop', 'bean', 'cloud')
     or v_colour not in ('blue', 'yellow', 'green', 'pink', 'sky', 'orange', 'violet', 'teal', 'graphite', 'snow')
     or v_eyes not in ('round', 'dots', 'one', 'sleepy', 'glasses')
     or v_hat not in ('none', 'cap', 'beanie', 'phones', 'flower', 'antenna', 'bow', 'crown', 'grad', 'horns') then
    perform meldy_private.live_fail('ML007', 'unknown_part');
  end if;
  if (v_colour in ('graphite', 'snow') and not (v_colour = any (coalesce(p_unlocked, '{}'::text[]))))
     or (v_hat in ('crown', 'grad', 'horns') and not (v_hat = any (coalesce(p_unlocked, '{}'::text[])))) then
    perform meldy_private.live_fail('ML007', 'locked');
  end if;
  return pg_catalog.jsonb_build_object('body', v_body, 'colour', v_colour, 'eyes', v_eyes, 'hat', v_hat);
end;
$fn$;

create or replace function public.bot_live_post(p_game uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_g public.live_games;
  v_flags jsonb;
  v_host text;
begin
  perform meldy_private.require_service_role();
  if p_game is null then
    raise exception 'bad live post' using errcode = '22023';
  end if;
  update public.live_games g set tg_claim_at = pg_catalog.now()
   where g.id = p_game and g.chat_id is not null and g.message_id is null and g.tg_claim_at is null and g.state <> 'ended'
  returning g.* into v_g;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'skip');
  end if;
  select c.flags into v_flags from bot.config c where c.id = 1;
  select nullif(pg_catalog.btrim(pr.full_name), '') into v_host from public.profiles pr where pr.id = v_g.owner_id;
  return pg_catalog.jsonb_build_object(
    'status', 'post', 'chat_id', v_g.chat_id, 'title', v_g.title, 'q_count', v_g.q_count, 'host', v_host, 'pin', v_g.pin,
    'players', (select pg_catalog.count(*) from public.live_players p where p.game_id = p_game and p.kicked_at is null),
    'direct', coalesce(v_flags ->> 'live_direct', 'false') = 'true');
end;
$fn$;

create or replace function public.bot_live_sync(p_game uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_g public.live_games;
  v_flags jsonb;
  v_host text;
  v_final jsonb;
  v_terminal boolean;
  v_gap interval;
begin
  perform meldy_private.require_service_role();
  if p_game is null then
    raise exception 'bad live sync' using errcode = '22023';
  end if;
  v_g := meldy_private.live_settle(p_game, true);
  if v_g.id is null or v_g.chat_id is null or v_g.message_id is null then
    return pg_catalog.jsonb_build_object('status', 'skip');
  end if;
  v_terminal := v_g.state in ('podium', 'ended');
  v_gap := case when v_terminal then interval '1 second' when v_g.state = 'lobby' then interval '5 seconds'
                else interval '3 seconds' end;
  if v_g.tg_edit_at is not null and v_g.tg_edit_at > pg_catalog.now() - v_gap then
    return pg_catalog.jsonb_build_object('status', 'skip');
  end if;
  if v_terminal and v_g.won is not null and v_g.tg_final_at is null then
    v_final := pg_catalog.jsonb_build_object(
      'won', v_g.won,
      'top', case when v_g.chat_names then
               (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('name', p.name, 'dmg', p.dmg) order by r.place), '[]'::jsonb)
                  from pg_catalog.unnest((meldy_private.live_rank(v_g.id))[1:3]) with ordinality as r(id, place)
                  join public.live_players p on p.id = r.id) end,
      'accuracy_pct', (select meldy_private.live_accuracy(coalesce(pg_catalog.sum(p.right_n), 0)::integer,
                                                          pg_catalog.count(*)::integer, v_g.qi + 1)
                         from public.live_players p where p.game_id = v_g.id and p.kicked_at is null),
      'game_id', v_g.id, 'container_id', v_g.container_id);
  end if;
  update public.live_games g
     set tg_edit_at = pg_catalog.now(), tg_final_at = case when v_final is not null then pg_catalog.now() else g.tg_final_at end
   where g.id = p_game;
  select c.flags into v_flags from bot.config c where c.id = 1;
  select nullif(pg_catalog.btrim(pr.full_name), '') into v_host from public.profiles pr where pr.id = v_g.owner_id;
  return pg_catalog.jsonb_build_object(
    'status', 'edit', 'chat_id', v_g.chat_id, 'message_id', v_g.message_id, 'state', v_g.state,
    'players', (select pg_catalog.count(*) from public.live_players p where p.game_id = p_game and p.kicked_at is null),
    'qi', v_g.qi, 'q_count', v_g.q_count,
    'hp_pct', case when v_g.hp_max > 0 then pg_catalog.floor(100::float8 * v_g.hp / v_g.hp_max + 0.5)::integer end,
    'title', v_g.title, 'pin', v_g.pin, 'host', v_host,
    'direct', coalesce(v_flags ->> 'live_direct', 'false') = 'true',
    'final', v_final);
end;
$fn$;
