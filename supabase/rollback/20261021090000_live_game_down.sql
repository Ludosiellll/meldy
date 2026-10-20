-- Rollback of supabase/migrations/20261021090000_live_game.sql: the catalog of the base again (the rehearsal
-- supabase/tests/local/live_game_run.sh compares the fingerprint). DROPS EVERY LIVE GAME, ITS PLAYERS, ANSWERS AND THE
-- WARDROBES. bot.webapp_uses keeps its rows but those of purpose 'game' (the base's check does not take them);
-- bot.config loses live_token. Re-runnable (IF EXISTS).

drop trigger if exists live_games_hint on public.live_games;

drop function if exists public.bot_live_sync(uuid);
drop function if exists public.bot_live_posted(uuid, bigint, bigint);
drop function if exists public.bot_live_post(uuid, uuid, bigint, text);
drop function if exists public.bot_live_join(text, bigint, text, jsonb, text, text, timestamptz);
drop function if exists public.live_wardrobe_set(jsonb);
drop function if exists public.live_wardrobe();
drop function if exists public.live_review(uuid, text);
drop function if exists public.live_state(uuid, text, bigint);
drop function if exists public.live_answer(uuid, text, integer, integer);
drop function if exists public.live_set_look(uuid, text, jsonb);
drop function if exists public.live_join(text, text, text, jsonb);
drop function if exists public.live_end(uuid, text);
drop function if exists public.live_kick(uuid, text, uuid);
drop function if exists public.live_next(uuid, text, text);
drop function if exists public.live_host_state(uuid, text, bigint);
drop function if exists public.live_create(jsonb, jsonb);

drop function if exists meldy_private.live_player_of(uuid, text, boolean);
drop function if exists meldy_private.live_join_as(public.live_games, uuid, bigint, text, text, text, jsonb, text);
drop function if exists meldy_private.live_wardrobe_of(uuid, bigint);
drop function if exists meldy_private.live_game_of_pin(text);
drop function if exists meldy_private.live_host_game(uuid, text, boolean);
drop function if exists meldy_private.live_hint();
drop function if exists meldy_private.live_tg_sync(uuid);
drop function if exists meldy_private.live_unchanged(public.live_games, bigint);
drop function if exists meldy_private.live_host_json(public.live_games);
drop function if exists meldy_private.live_player_json(public.live_games, uuid);
drop function if exists meldy_private.live_closed_json(public.live_games);
drop function if exists meldy_private.live_base_json(public.live_games);
drop function if exists meldy_private.live_close_if_all(uuid);
drop function if exists meldy_private.live_settle(uuid, boolean);
drop function if exists meldy_private.live_advance(uuid);
drop function if exists meldy_private.live_podium(uuid);
drop function if exists meldy_private.live_close(uuid);
drop function if exists meldy_private.live_countdown(uuid, integer);
drop function if exists meldy_private.live_due(public.live_games, timestamptz);
drop function if exists meldy_private.live_rank(uuid);
drop function if exists meldy_private.live_playable(public.test_items);
drop function if exists meldy_private.live_name_check(text);
drop function if exists meldy_private.live_name_rude(text);
drop function if exists meldy_private.live_rude_word(text);
drop function if exists meldy_private.live_name_norm(text);
drop function if exists meldy_private.live_default_look(text);
drop function if exists meldy_private.live_fnv(text);
drop function if exists meldy_private.live_look_check(jsonb, text[]);
drop function if exists meldy_private.live_unlocks(integer, integer, integer, integer, integer, integer, text[]);
drop function if exists meldy_private.live_accuracy(integer, integer, integer);
drop function if exists meldy_private.live_right_needed(integer);
drop function if exists meldy_private.live_heal(integer);
drop function if exists meldy_private.live_phase_for(integer, integer);
drop function if exists meldy_private.live_damage(integer, integer, integer, boolean);
drop function if exists meldy_private.live_iso(timestamptz);
drop function if exists meldy_private.live_hash(text);
drop function if exists meldy_private.live_new_token(integer);
drop function if exists meldy_private.live_fail(text, text, integer);

drop table if exists public.live_answers;
drop table if exists public.live_players;
drop table if exists public.live_questions;
drop table if exists public.live_games;
drop table if exists public.live_wardrobe;
drop table if exists meldy_private.live_join_hits;

-- The bot: the base's purpose check (the uses of games go first), no live token.
delete from bot.webapp_uses where purpose = 'game';
do $do$
begin
  if exists (select 1 from pg_catalog.pg_constraint k
              where k.conrelid = 'bot.webapp_uses'::regclass and k.conname = 'webapp_uses_purpose_check'
                and pg_catalog.pg_get_constraintdef(k.oid) like '%game%') then
    alter table bot.webapp_uses drop constraint webapp_uses_purpose_check;
    alter table bot.webapp_uses add constraint webapp_uses_purpose_check check (purpose in ('session', 'link'));
  end if;
end;
$do$;
alter table bot.config drop constraint if exists config_live_token_check;
alter table bot.config drop column if exists live_token;
