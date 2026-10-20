-- live_game (the live class game «Битва с монстром», MVP for 24.10)
-- Repo file: supabase/migrations/20261021090000_live_game.sql. Base: every migration up to 20261019110000_doc_video.sql.
-- Contract: docs/live/CONTRACT.md (states, timing, numbers, who sees what, RPCs, errors, limits); the numbers are those of
-- frontend/src/lib/live/rules.ts (rules.test.ts and contracts/live/*.json hold the shared cases). Spec: meldy-notes
-- 10_Project/Telegram_Live_Game_Spec_2026-10-20.md.
-- Check after the apply: supabase/tests/live_game.sql (catalog and the pure numbers; read-only). Local rehearsal (never
-- live): supabase/tests/local/live_game_run.sh (live_game_behaviour.sql: a whole game, the key's secrecy, limits,
-- tokens; then real.ts end to end through PostgREST). Rollback: supabase/rollback/20261021090000_live_game_down.sql.
--
-- 1. Tables in public, row security on and no policy, nothing granted to the API roles: live_games (one game: source,
--    PIN, Realtime topic, sha256 of the host token, settings, the state machine and its server times, the boss, rev, the
--    bot's message), live_questions (the questions drawn at create: text and options in the shown order, the key as a
--    shown index; at close: counts, hits, freezes, heal, the ranking before), live_players (sha256 of the player token;
--    exactly one identity: user_id and/or tg_user_id, or guest_hash), live_answers (one per player and question: the pk),
--    live_wardrobe (unlocked parts of an account or a Telegram user). meldy_private.live_join_hits: the address throttle
--    (HMAC of the address, meldy_private.quiz_ip_hash), two minutes kept.
-- 2. Everything goes through SECURITY DEFINER functions with search_path = '': public.live_* for the site (anon and
--    authenticated) and public.bot_live_* for the `telegram` function (service role). Time-driven moves are applied
--    lazily by meldy_private.live_settle at the start of every call (reads take the game row's lock only when a move is
--    due; every writer holds it, so an answer and the close never cross).
-- 3. The key of a question leaves only in `result`, which exists only once the question is closed — for the host too.
--    live_review gives the keys of this game's closed questions only.
-- 4. Realtime: a deferred trigger sends one hint {rev, state} per transaction that changed rev, on the public channel
--    'live:' || topic (realtime.send(…, false)); answers never change rev. The author posts the game into a group bound
--    to the exam with live_tg_post (the JWT is checked by PostgREST, never by the bot's function); the database then
--    calls the function through pg_net: /telegram/game/post (send the post), and /telegram/game/sync on state changes
--    (edit it), each with x-meldy-live = bot.config.live_token, which POST /telegram/setup stores through
--    bot_live_setup: HMAC-SHA256(bot token, 'meldy:live:v1').
-- 5. Errors: «not found» P0002 → 404, ML011 → 409, ML005 → 429, 28000 → 401, 42501 and ML003 → 403 through the
--    PostgREST status override (raise sqlstate 'PGRST': message = {code, message, details}, detail = {status, headers});
--    every other refusal (22023, ML0xx) the same way with 400, so the body's `code` and `details` are always ours.
-- 6. bot.webapp_uses.purpose takes 'game' (one use of a Mini App launch to join a game); bot.config.live_token.
-- Needs pgcrypto in schema extensions (gen_random_bytes, hmac through quiz_ip_hash). realtime.send and net.http_post are
-- called inside exception blocks: without Realtime or pg_net the game still works (no hints, no edits).
-- Re-runnable: IF NOT EXISTS, OR REPLACE, guarded blocks. The whole file is one request (supabase/migrate.py).

do $do$
begin
  if pg_catalog.to_regprocedure('extensions.gen_random_bytes(integer)') is null then
    raise exception 'pgcrypto is expected in schema extensions (gen_random_bytes)';
  end if;
  if pg_catalog.to_regprocedure('meldy_private.quiz_ip_hash()') is null
     or pg_catalog.to_regprocedure('meldy_private.quiz_draw(public.quizzes)') is null
     or pg_catalog.to_regclass('bot.webapp_uses') is null or pg_catalog.to_regclass('bot.groups') is null then
    raise exception 'the base is expected: quiz_guards, test_docs, the bot and the Mini App';
  end if;
end;
$do$;

-- ─────────────────────────────────────────── 1. Tables ───────────────────────────────────────────

-- 1a. A game. pin: 6 digits, unique among the games not ended; topic: 22 random base64url characters (the channel);
--     host_hash: sha256 hex of the host token (the token is returned once). qi = the current or last question (-1 in
--     the lobby); q_ready_at / q_opens_at / q_closes_at: the server's times of question qi. hp_max, hp, phase: the boss.
--     won: set at podium. chat_id / message_id: the bot's message in a group; tg_*: its cadence.
create table if not exists public.live_games (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  container_id uuid not null references public.containers(id) on delete cascade,
  quiz_id uuid references public.quizzes(id) on delete set null,
  title text not null,
  pin text not null,
  topic text not null,
  host_hash text not null,
  mode text not null default 'boss',
  time_s smallint not null default 20,
  speed boolean not null default true,
  who text not null default 'pin',
  chat_names boolean not null default true,
  q_count smallint not null,
  skipped integer not null default 0,
  state text not null default 'lobby',
  state_at timestamptz not null default now(),
  qi smallint not null default -1,
  q_ready_at timestamptz,
  q_opens_at timestamptz,
  q_closes_at timestamptz,
  hp_max integer not null default 0,
  hp integer not null default 0,
  phase smallint not null default 0,
  won boolean,
  end_reason text,
  rev bigint not null default 1,
  chat_id bigint,
  message_id bigint,
  tg_posted_at timestamptz,
  tg_edit_at timestamptz,
  tg_sync_at timestamptz,
  tg_synced text,
  tg_final_at timestamptz,
  tg_claim_at timestamptz,
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  constraint live_games_title_check check (char_length(btrim(title)) between 1 and 200),
  constraint live_games_pin_check check (pin ~ '^[1-9][0-9]{5}$'),
  constraint live_games_topic_check check (topic ~ '^[A-Za-z0-9_-]{22}$'),
  constraint live_games_host_hash_check check (host_hash ~ '^[0-9a-f]{64}$'),
  constraint live_games_mode_check check (mode = 'boss'),
  constraint live_games_time_check check (time_s in (10, 20, 30)),
  constraint live_games_who_check check (who in ('pin', 'members')),
  constraint live_games_q_count_check check (q_count between 1 and 30),
  constraint live_games_skipped_check check (skipped >= 0),
  constraint live_games_state_check check (state in ('lobby', 'countdown', 'open', 'reveal', 'leaderboard', 'podium', 'ended')),
  constraint live_games_qi_check check (qi between -1 and q_count - 1 and (qi >= 0 or state in ('lobby', 'ended'))),
  constraint live_games_hp_check check (hp_max >= 0 and hp between 0 and hp_max),
  constraint live_games_phase_check check (phase in (0, 1, 2)),
  constraint live_games_end_check check ((state = 'ended') = (ended_at is not null)
                                         and (end_reason is null or end_reason in ('host', 'expired', 'podium'))),
  constraint live_games_rev_check check (rev >= 1),
  constraint live_games_chat_check check ((chat_id is null or chat_id < 0) and (message_id is null or (chat_id is not null and message_id > 0)))
);
create unique index if not exists live_games_pin_open_uidx on public.live_games (pin) where state <> 'ended';
create unique index if not exists live_games_topic_uidx on public.live_games (topic);
create index if not exists live_games_owner_idx on public.live_games (owner_id, created_at desc);
create index if not exists live_games_container_idx on public.live_games (container_id);
create index if not exists live_games_quiz_idx on public.live_games (quiz_id) where quiz_id is not null;
create index if not exists live_games_open_idx on public.live_games (created_at) where state <> 'ended';
create index if not exists live_games_ended_idx on public.live_games (ended_at) where state = 'ended';
create index if not exists live_games_pin_idx on public.live_games (pin, created_at desc);
alter table public.live_games enable row level security;
comment on table public.live_games is 'Live class games («Битва с монстром»): only through the live_* / bot_live_* functions.';

-- 1b. The questions of a game, drawn at create (a copy: an edit of the exam does not change a running game). options:
--     the texts in the shown order; shown: the file indexes in that order; key: the shown index of the right option.
--     phase: the phase the question opened with (its rules). The rest is written when it closes.
create table if not exists public.live_questions (
  game_id uuid not null references public.live_games(id) on delete cascade,
  qi smallint not null,
  item_id uuid,
  text text not null,
  options jsonb not null,
  shown smallint[] not null,
  key smallint not null,
  phase smallint,
  opens_at timestamptz,
  closes_at timestamptz,
  closed_at timestamptz,
  counts integer[],
  right_n integer,
  healed integer,
  phase_changed smallint,
  hits jsonb,
  frozen_now uuid[],
  thawed uuid[],
  rank_before uuid[],
  primary key (game_id, qi),
  constraint live_questions_qi_check check (qi between 0 and 29),
  constraint live_questions_options_check check (jsonb_typeof(options) = 'array' and jsonb_array_length(options) between 2 and 4
                                                 and cardinality(shown) = jsonb_array_length(options)),
  constraint live_questions_key_check check (key >= 0 and key < cardinality(shown)),
  constraint live_questions_phase_check check (phase is null or phase in (0, 1, 2))
);
alter table public.live_questions enable row level security;
comment on table public.live_questions is 'Questions of a live game, with their keys: never readable by clients; the key leaves in a closed question''s result only.';

-- 1c. Players. token_hash: sha256 hex of the player token (unique per game). Identity: user_id (a signed-in site user, or
--     a Telegram linked to an account) and/or tg_user_id (Telegram), or guest_hash (a web guest: the hash of their first
--     token). One player per identity per game.
create table if not exists public.live_players (
  id uuid primary key default gen_random_uuid(),
  game_id uuid not null references public.live_games(id) on delete cascade,
  token_hash text not null,
  user_id uuid references auth.users(id) on delete cascade,
  tg_user_id bigint,
  guest_hash text,
  name text not null,
  look jsonb not null,
  joined_at timestamptz not null default now(),
  kicked_at timestamptz,
  dmg integer not null default 0,
  streak smallint not null default 0,
  best smallint not null default 0,
  right_n smallint not null default 0,
  frozen boolean not null default false,
  thaws smallint not null default 0,
  unlocked_now text[] not null default '{}'::text[],
  constraint live_players_token_check check (token_hash ~ '^[0-9a-f]{64}$'),
  constraint live_players_guest_check check (guest_hash is null or guest_hash ~ '^[0-9a-f]{64}$'),
  constraint live_players_tg_check check (tg_user_id is null or tg_user_id > 0),
  constraint live_players_identity_check check ((guest_hash is not null) = (user_id is null and tg_user_id is null)),
  constraint live_players_name_check check (char_length(name) between 1 and 24),
  constraint live_players_look_check check (jsonb_typeof(look) = 'object'),
  constraint live_players_numbers_check check (dmg >= 0 and streak >= 0 and best >= streak and right_n >= 0 and thaws >= 0)
);
create unique index if not exists live_players_token_uidx on public.live_players (game_id, token_hash);
create unique index if not exists live_players_user_uidx on public.live_players (game_id, user_id) where user_id is not null;
create unique index if not exists live_players_tg_uidx on public.live_players (game_id, tg_user_id) where tg_user_id is not null;
create unique index if not exists live_players_guest_uidx on public.live_players (game_id, guest_hash) where guest_hash is not null;
create index if not exists live_players_game_idx on public.live_players (game_id, joined_at);
create index if not exists live_players_user_idx on public.live_players (user_id) where user_id is not null;
alter table public.live_players enable row level security;
comment on table public.live_players is 'Players of live games (sha256 of their tokens only): only through the live_* functions.';

-- 1d. Answers: one per player and question (the pk). elapsed_ms by the server's clock; correct and dmg at close.
create table if not exists public.live_answers (
  game_id uuid not null,
  qi smallint not null,
  player_id uuid not null references public.live_players(id) on delete cascade,
  choice smallint not null,
  at timestamptz not null default now(),
  elapsed_ms integer not null,
  correct boolean,
  dmg integer,
  primary key (game_id, qi, player_id),
  foreign key (game_id, qi) references public.live_questions(game_id, qi) on delete cascade,
  constraint live_answers_choice_check check (choice between 0 and 3),
  constraint live_answers_elapsed_check check (elapsed_ms between 0 and 30000),
  constraint live_answers_dmg_check check (dmg is null or dmg between 0 and 200)
);
create index if not exists live_answers_player_idx on public.live_answers (player_id);
alter table public.live_answers enable row level security;
comment on table public.live_answers is 'Answers of live games: only through the live_* functions.';

-- 1e. The wardrobe of an account ('user', its id) or a Telegram user without an account ('tg', its id).
create table if not exists public.live_wardrobe (
  owner_kind text not null,
  owner_key text not null,
  look jsonb,
  unlocked text[] not null default '{}'::text[],
  games integer not null default 0,
  wins integer not null default 0,
  updated_at timestamptz not null default now(),
  primary key (owner_kind, owner_key),
  constraint live_wardrobe_kind_check check (owner_kind in ('user', 'tg')),
  constraint live_wardrobe_key_check check (case owner_kind
    when 'user' then owner_key ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    else owner_key ~ '^[1-9][0-9]{0,18}$' end),
  constraint live_wardrobe_look_check check (look is null or jsonb_typeof(look) = 'object'),
  constraint live_wardrobe_unlocked_check check (unlocked <@ array['graphite', 'snow', 'crown', 'grad', 'horns']::text[]),
  constraint live_wardrobe_numbers_check check (games >= 0 and wins between 0 and games)
);
alter table public.live_wardrobe enable row level security;
comment on table public.live_wardrobe is 'Live game characters: the saved look and the parts opened by playing (account or Telegram user).';

-- 1f. The address throttle of joins from the site (HMAC of the address, meldy_private.quiz_ip_hash); two minutes kept.
create table if not exists meldy_private.live_join_hits (
  ip_hash text not null,
  at timestamptz not null default now()
);
create index if not exists live_join_hits_idx on meldy_private.live_join_hits (ip_hash, at);
create index if not exists live_join_hits_at_idx on meldy_private.live_join_hits (at);
alter table meldy_private.live_join_hits enable row level security;

-- 1g. The bot: a Mini App launch may be used once to join a game; the token the database signs its sync calls with.
do $do$
begin
  if exists (select 1 from pg_catalog.pg_constraint k
              where k.conrelid = 'bot.webapp_uses'::regclass and k.conname = 'webapp_uses_purpose_check'
                and pg_catalog.pg_get_constraintdef(k.oid) not like '%game%') then
    alter table bot.webapp_uses drop constraint webapp_uses_purpose_check;
  end if;
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'bot.webapp_uses'::regclass and k.conname = 'webapp_uses_purpose_check') then
    alter table bot.webapp_uses add constraint webapp_uses_purpose_check check (purpose in ('session', 'link', 'game'));
  end if;
end;
$do$;
alter table bot.config add column if not exists live_token text;
do $do$
begin
  if not exists (select 1 from pg_catalog.pg_constraint k
                  where k.conrelid = 'bot.config'::regclass and k.conname = 'config_live_token_check') then
    alter table bot.config add constraint config_live_token_check check (live_token is null or live_token ~ '^[A-Za-z0-9_-]{43}$');
  end if;
end;
$do$;

-- ─────────────────────────────────────────── 2. Pure helpers (the numbers of rules.ts) ───────────────────────────────────────────

-- 2a. A refusal with our code in the body and the contract's HTTP status (PostgREST's PGRST override); a 429 also says
--     when to come back (Retry-After, seconds).
create or replace function meldy_private.live_fail(p_code text, p_details text default null, p_status integer default 400,
                                                   p_retry_after integer default null)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  raise sqlstate 'PGRST' using
    message = pg_catalog.jsonb_build_object('code', p_code, 'message', 'live: ' || p_code || coalesce('/' || p_details, ''),
                                            'details', p_details)::text,
    detail = pg_catalog.jsonb_build_object('status', p_status, 'headers',
               case when p_retry_after is null then '{}'::jsonb
                    else pg_catalog.jsonb_build_object('Retry-After', greatest(1, p_retry_after)::text) end)::text;
end;
$fn$;

-- Seconds until the oldest of the counted moments leaves a window (the Retry-After of a limit), 1 at least.
create or replace function meldy_private.live_retry_after(p_oldest timestamptz, p_window interval)
returns integer
language sql
stable
set search_path = ''
as $fn$
  select greatest(1, pg_catalog.ceil(extract(epoch from (coalesce(p_oldest, pg_catalog.now()) + p_window - pg_catalog.now())))::integer)
$fn$;

-- 2b. Tokens: 32 random bytes as base64url (43 characters); the database keeps sha256 hex.
create or replace function meldy_private.live_new_token(p_bytes integer default 32)
returns text
language sql
volatile
set search_path = ''
as $fn$
  select pg_catalog.rtrim(pg_catalog.translate(pg_catalog.encode(extensions.gen_random_bytes(p_bytes), 'base64'), '+/', '-_'), '=')
$fn$;

create or replace function meldy_private.live_hash(p_token text)
returns text
language sql
immutable
strict
set search_path = ''
as $fn$
  select pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_token, 'UTF8')), 'hex')
$fn$;

-- The server's time as the clients read it: ISO 8601, UTC, milliseconds.
create or replace function meldy_private.live_iso(p_at timestamptz)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select pg_catalog.to_char(p_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$fn$;

-- 2c. Damage (CONTRACT §3, rules.ts damage): round(100 × speed × mult) computed in doubles in the order JavaScript does,
--     rounded as Math.round (half up on the double: floor(x + 0.5)). Exact fractions would round 73 of the 300 015
--     cases of 10/20/30 s × every millisecond × streak 1–5 the other way (e.g. 8500 ms of 10 s: 57.4999… → 57).
create or replace function meldy_private.live_damage(p_elapsed_ms integer, p_time_s integer, p_streak_after integer, p_speed boolean)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select pg_catalog.floor(
           (100::float8 * (case when p_speed
                                then 0.5::float8 + 0.5::float8 * greatest(0::float8,
                                       1::float8 - least(greatest(p_elapsed_ms, 0), p_time_s * 1000)::float8 / (p_time_s * 1000)::float8)
                                else 1::float8 end))
           * (1::float8 + 0.25::float8 * least(greatest(p_streak_after - 1, 0), 4)::float8)
           + 0.5::float8)::integer
$fn$;

-- The phase the HP points to (hp ≤ ⅔ → 1, ≤ ⅓ → 2); the boss takes the max with its current phase.
create or replace function meldy_private.live_phase_for(p_hp integer, p_hp_max integer)
returns smallint
language sql
immutable
set search_path = ''
as $fn$
  select (case when p_hp * 3 <= p_hp_max then 2 when p_hp * 3 <= p_hp_max * 2 then 1 else 0 end)::smallint
$fn$;

-- round(0.05 × hp_max) as Math.round of the double.
create or replace function meldy_private.live_heal(p_hp_max integer)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select pg_catalog.floor(p_hp_max::float8 * 0.05::float8 + 0.5::float8)::integer
$fn$;

-- ceil(⅔ × active players).
create or replace function meldy_private.live_right_needed(p_active integer)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select (2 * p_active + 2) / 3
$fn$;

-- round(100 × right answers / (players × questions asked)); 0 when nobody played.
create or replace function meldy_private.live_accuracy(p_right integer, p_players integer, p_asked integer)
returns integer
language sql
immutable
set search_path = ''
as $fn$
  select case when p_players * p_asked = 0 then 0
              else pg_catalog.floor((100 * p_right)::float8 / (p_players * p_asked)::float8 + 0.5::float8)::integer end
$fn$;

-- The parts a finished game opens (rules.ts unlocksAfter), in its order, without those already open.
create or replace function meldy_private.live_unlocks(p_place integer, p_dmg integer, p_best integer, p_thaws integer,
                                                      p_games integer, p_wins integer, p_already text[])
returns text[]
language sql
immutable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.array_agg(u.id order by u.ord), '{}'::text[])
    from (values (1, 'crown', p_place <= 3 and p_dmg > 0), (2, 'graphite', p_best >= 5), (3, 'horns', p_thaws >= 3),
                 (4, 'grad', p_games >= 10), (5, 'snow', p_wins >= 5)) as u(ord, id, got)
   where u.got and not (u.id = any (coalesce(p_already, '{}'::text[])))
$fn$;

-- 2d. A look (rules.ts checkLook): four known ids, the locked ones only when opened → the look with these four keys;
--     else ML007 unknown_part / locked.
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

-- 2e. The free look of a name (rules.ts defaultLook): FNV-1a (32 bits) of '<part>|<name>' over its code points.
create or replace function meldy_private.live_fnv(p_text text)
returns bigint
language plpgsql
immutable
strict
set search_path = ''
as $fn$
declare
  v_h bigint := 2166136261;
begin
  for i in 1 .. pg_catalog.char_length(p_text) loop
    v_h := ((v_h # pg_catalog.ascii(pg_catalog.substr(p_text, i, 1))::bigint) * 16777619) % 4294967296;
  end loop;
  return v_h;
end;
$fn$;

create or replace function meldy_private.live_default_look(p_name text)
returns jsonb
language sql
immutable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object(
    'body', (array['round', 'square', 'drop', 'bean', 'cloud'])[meldy_private.live_fnv('body|' || p_name) % 5 + 1],
    'colour', (array['blue', 'yellow', 'green', 'pink', 'sky', 'orange', 'violet', 'teal'])[meldy_private.live_fnv('colour|' || p_name) % 8 + 1],
    'eyes', (array['round', 'dots', 'one', 'sleepy', 'glasses'])[meldy_private.live_fnv('eyes|' || p_name) % 5 + 1],
    'hat', (array['none', 'cap', 'beanie', 'phones', 'flower', 'antenna', 'bow'])[meldy_private.live_fnv('hat|' || p_name) % 7 + 1])
$fn$;

-- 2f. Names (rules.ts checkName / nameIsRude). Runs of JavaScript's whitespace → one space, trimmed; 1–24 code points.
--     Rude, word by word (a word: a run between spaces, lower case, letters only — «Су-ка» → «сука»; checked as typed
--     and with Latin look-alikes read as Cyrillic): a root anywhere, a root at the start after at most one prefix, or the
--     whole word. Lower case by an explicit Latin/Cyrillic table (never the server's locale).
create or replace function meldy_private.live_name_norm(p_raw text)
returns text
language sql
immutable
set search_path = ''
as $fn$
  select pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_raw, ''),
           '[\t\n\v\f\r    -     　﻿]+', ' ', 'g'), ' ')
$fn$;

create or replace function meldy_private.live_rude_word(p_word text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select p_word <> '' and (
    exists (select 1 from pg_catalog.unnest(array['хуй', 'хуё', 'пизд', 'бляд', 'блят', 'fuck']) r
             where pg_catalog.strpos(p_word, r) > 0)
    or exists (select 1
                 from pg_catalog.unnest(array['', 'за', 'вы', 'на', 'от', 'по', 'при', 'раз', 'рас', 'до', 'у', 'о', 'об', 'съ',
                                              'объ', 'отъ', 'подъ', 'въ', 'изъ', 'разъ', 'пере', 'недо']) p
                cross join pg_catalog.unnest(array['ебат', 'ебан', 'ебал', 'ебу', 'ебл', 'ёб', 'хуя', 'пидор', 'пидар', 'пидр',
                                                   'мудак', 'мудил', 'залуп', 'гандон', 'гондон', 'bitch', 'cunt']) r
                where pg_catalog.left(p_word, pg_catalog.char_length(p || r)) = p || r)
    or p_word = any (array['сука', 'суки', 'суку', 'суке', 'сукой', 'сучка', 'сучара', 'бля', 'блядь', 'хер', 'нахер', 'похер',
                           'жопа', 'говно', 'shit', 'shitty', 'bullshit', 'ass', 'asshole']))
$fn$;

create or replace function meldy_private.live_name_rude(p_name text)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select exists (
    select 1
      from pg_catalog.unnest(pg_catalog.string_to_array(pg_catalog.translate(p_name,
             'ABCDEFGHIJKLMNOPQRSTUVWXYZАБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ',
             'abcdefghijklmnopqrstuvwxyzабвгдеёжзийклмнопрстуфхцчшщъыьэюя'), ' ')) t
     where meldy_private.live_rude_word(pg_catalog.regexp_replace(t, '[^a-zа-яё]', '', 'g'))
        or meldy_private.live_rude_word(pg_catalog.regexp_replace(
             pg_catalog.translate(t, 'acehkmoptxy03', 'асенкмортхуоз'), '[^a-zа-яё]', '', 'g')))
$fn$;

-- The name as kept, or ML006 length / rude.
create or replace function meldy_private.live_name_check(p_raw text)
returns text
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_name text := meldy_private.live_name_norm(p_raw);
begin
  if pg_catalog.char_length(v_name) not between 1 and 24 then
    perform meldy_private.live_fail('ML006', 'length');
  end if;
  if meldy_private.live_name_rude(v_name) then
    perform meldy_private.live_fail('ML006', 'rude');
  end if;
  return v_name;
end;
$fn$;

-- 2g. A playable question in the MVP: one right option of 2–4, no pictures (CONTRACT §4; the player has no way to the
--     private pictures yet).
create or replace function meldy_private.live_playable(p_item public.test_items)
returns boolean
language sql
stable
set search_path = ''
as $fn$
  select p_item.kind in ('single', 'multiple')
     and pg_catalog.cardinality(p_item.correct) = 1
     and pg_catalog.jsonb_array_length(p_item.options) between 2 and 4
     and coalesce(pg_catalog.jsonb_array_length(case when pg_catalog.jsonb_typeof(p_item.images -> 'stem') = 'array'
                                                     then p_item.images -> 'stem' end), 0) = 0
     and not exists (select 1
                       from pg_catalog.jsonb_array_elements(case when pg_catalog.jsonb_typeof(p_item.images -> 'options') = 'array'
                                                                 then p_item.images -> 'options' else '[]'::jsonb end) o
                      where pg_catalog.jsonb_typeof(o) = 'array' and pg_catalog.jsonb_array_length(o) > 0)
$fn$;

-- ─────────────────────────────────────────── 3. The game engine ───────────────────────────────────────────

-- 3a. The ranking: players not kicked by dmg, right, best (desc), then who joined first.
create or replace function meldy_private.live_rank(p_game uuid)
returns uuid[]
language sql
stable
set search_path = ''
as $fn$
  select coalesce(pg_catalog.array_agg(p.id order by p.dmg desc, p.right_n desc, p.best desc, p.joined_at, p.id), '{}'::uuid[])
    from public.live_players p
   where p.game_id = p_game and p.kicked_at is null
$fn$;

-- 3b. Is a time-driven move due (CONTRACT §1): 3 h after create → ended; countdown at q_opens_at → open; open after
--     q_closes_at + 1.5 s → closed (reveal); reveal and leaderboard after 30 s → next.
create or replace function meldy_private.live_due(p_g public.live_games, p_now timestamptz)
returns boolean
language sql
immutable
set search_path = ''
as $fn$
  select (p_g.state <> 'ended' and p_now >= p_g.created_at + interval '3 hours')
      or (p_g.state = 'countdown' and p_now >= p_g.q_opens_at)
      or (p_g.state = 'open' and p_now > p_g.q_closes_at + interval '1.5 seconds')
      or (p_g.state in ('reveal', 'leaderboard') and p_now >= p_g.state_at + interval '30 seconds')
$fn$;

-- 3c. Question qi is announced: countdown 3 s, then time_s to answer. At the first one the boss gets its HP: players ×
--     questions × 55. The question keeps the boss's phase of this moment.
create or replace function meldy_private.live_countdown(p_game uuid, p_qi integer)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_g public.live_games;
  v_now timestamptz := pg_catalog.now();
  v_opens timestamptz := pg_catalog.now() + interval '3 seconds';
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  if p_qi = 0 then
    v_g.hp_max := (select pg_catalog.count(*)::integer from public.live_players p
                    where p.game_id = p_game and p.kicked_at is null) * v_g.q_count * 55;
    v_g.hp := v_g.hp_max;
  end if;
  update public.live_questions q
     set phase = v_g.phase, opens_at = v_opens, closes_at = v_opens + pg_catalog.make_interval(secs => v_g.time_s)
   where q.game_id = p_game and q.qi = p_qi;
  update public.live_games g
     set state = 'countdown', state_at = v_now, qi = p_qi, q_ready_at = v_now, q_opens_at = v_opens,
         q_closes_at = v_opens + pg_catalog.make_interval(secs => v_g.time_s), hp_max = v_g.hp_max, hp = v_g.hp,
         rev = g.rev + 1
   where g.id = p_game;
end;
$fn$;

-- 3d. Closing question qi (rules.ts closeQuestion): answers of players not kicked in order of elapsed_ms, then player id;
--     a right answer of a frozen player thaws them (no damage, streak 1); a right answer hits: streak + 1, damage by
--     time and streak, hp down to 0 (hp_after recorded); a wrong one: streak 0, frozen. No answer from an active player
--     (not kicked, joined by q_opens_at): streak 0, frozen from phase 1. Phase 2: fewer right than ⅔ of the active → heal
--     5 % (never above hp_max). The phase only grows. → reveal.
create or replace function meldy_private.live_close(p_game uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_g public.live_games;
  v_q public.live_questions;
  v_p public.live_players;
  v_a record;
  v_hp integer;
  v_right integer := 0;
  v_dmg integer;
  v_hits jsonb := '[]'::jsonb;
  v_frozen uuid[] := '{}'::uuid[];
  v_thawed uuid[] := '{}'::uuid[];
  v_none uuid[];
  v_active integer;
  v_healed integer := 0;
  v_phase smallint;
  v_rank uuid[];
  v_counts integer[];
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  select q.* into v_q from public.live_questions q where q.game_id = p_game and q.qi = v_g.qi;
  if v_g.state <> 'open' or v_q.closed_at is not null then
    return;
  end if;
  v_rank := meldy_private.live_rank(p_game);
  v_hp := v_g.hp;
  v_counts := pg_catalog.array_fill(0, array[pg_catalog.jsonb_array_length(v_q.options)]);
  for v_a in
    select a.player_id, a.choice, a.elapsed_ms
      from public.live_answers a
      join public.live_players p on p.id = a.player_id
     where a.game_id = p_game and a.qi = v_g.qi and p.kicked_at is null
     order by a.elapsed_ms, a.player_id
  loop
    select p.* into v_p from public.live_players p where p.id = v_a.player_id;
    v_counts[v_a.choice + 1] := v_counts[v_a.choice + 1] + 1;
    if v_a.choice = v_q.key then
      v_right := v_right + 1;
      if v_p.frozen then
        update public.live_players p
           set frozen = false, streak = 1, thaws = p.thaws + 1, best = greatest(p.best, 1), right_n = p.right_n + 1
         where p.id = v_p.id;
        update public.live_answers a set correct = true, dmg = 0
         where a.game_id = p_game and a.qi = v_g.qi and a.player_id = v_p.id;
        v_thawed := v_thawed || v_p.id;
      else
        v_dmg := meldy_private.live_damage(v_a.elapsed_ms, v_g.time_s, v_p.streak + 1, v_g.speed);
        v_hp := greatest(0, v_hp - v_dmg);
        update public.live_players p
           set streak = p.streak + 1, best = greatest(p.best, p.streak + 1), dmg = p.dmg + v_dmg, right_n = p.right_n + 1
         where p.id = v_p.id;
        update public.live_answers a set correct = true, dmg = v_dmg
         where a.game_id = p_game and a.qi = v_g.qi and a.player_id = v_p.id;
        v_hits := v_hits || pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('player_id', v_p.id, 'dmg', v_dmg, 'hp_after', v_hp));
      end if;
    else
      if not v_p.frozen then
        v_frozen := v_frozen || v_p.id;
      end if;
      update public.live_players p set streak = 0, frozen = true where p.id = v_p.id;
      update public.live_answers a set correct = false, dmg = 0
       where a.game_id = p_game and a.qi = v_g.qi and a.player_id = v_p.id;
    end if;
  end loop;
  -- No answer from an active player: those not yet frozen are frozen now from phase 1.
  select coalesce(pg_catalog.array_agg(p.id order by p.joined_at, p.id), '{}'::uuid[]) into v_none
    from public.live_players p
   where p.game_id = p_game and p.kicked_at is null and p.joined_at <= v_q.opens_at and not p.frozen
     and not exists (select 1 from public.live_answers a where a.game_id = p_game and a.qi = v_g.qi and a.player_id = p.id);
  if v_q.phase >= 1 then
    v_frozen := v_frozen || v_none;
  end if;
  update public.live_players p
     set streak = 0, frozen = p.frozen or v_q.phase >= 1
   where p.game_id = p_game and p.kicked_at is null and p.joined_at <= v_q.opens_at
     and not exists (select 1 from public.live_answers a where a.game_id = p_game and a.qi = v_g.qi and a.player_id = p.id);
  select pg_catalog.count(*)::integer into v_active
    from public.live_players p
   where p.game_id = p_game and p.kicked_at is null and p.joined_at <= v_q.opens_at;
  if v_q.phase = 2 and v_hp > 0 and v_right < meldy_private.live_right_needed(v_active) then
    v_healed := least(meldy_private.live_heal(v_g.hp_max), v_g.hp_max - v_hp);
    v_hp := v_hp + v_healed;
  end if;
  v_phase := greatest(v_g.phase, meldy_private.live_phase_for(v_hp, v_g.hp_max));
  update public.live_questions q
     set closed_at = pg_catalog.now(), counts = v_counts, right_n = v_right, healed = v_healed,
         phase_changed = case when v_phase > v_g.phase then v_phase end, hits = v_hits, frozen_now = v_frozen,
         thawed = v_thawed, rank_before = v_rank
   where q.game_id = p_game and q.qi = v_g.qi;
  update public.live_games g
     set state = 'reveal', state_at = pg_catalog.now(), hp = v_hp, phase = v_phase, rev = g.rev + 1
   where g.id = p_game;
end;
$fn$;

-- 3e. The podium: the class won when the boss is at 0. Every player not kicked with an account or a Telegram gets the
--     game counted in their wardrobe (games, wins) and the parts it opens (final.unlocked_now). Web guests: nothing.
create or replace function meldy_private.live_podium(p_game uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_g public.live_games;
  v_won boolean;
  v_p record;
  v_w public.live_wardrobe;
  v_kind text;
  v_key text;
  v_new text[];
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  v_won := v_g.hp_max > 0 and v_g.hp = 0;
  for v_p in
    select p.*, r.place::integer as place
      from pg_catalog.unnest(meldy_private.live_rank(p_game)) with ordinality as r(id, place)
      join public.live_players p on p.id = r.id
  loop
    v_kind := case when v_p.user_id is not null then 'user' when v_p.tg_user_id is not null then 'tg' end;
    continue when v_kind is null;
    v_key := case when v_kind = 'user' then v_p.user_id::text else v_p.tg_user_id::text end;
    insert into public.live_wardrobe as w (owner_kind, owner_key, games, wins)
    values (v_kind, v_key, 1, case when v_won then 1 else 0 end)
    on conflict (owner_kind, owner_key) do update
      set games = w.games + 1, wins = w.wins + excluded.wins, updated_at = pg_catalog.now()
    returning w.* into v_w;
    v_new := meldy_private.live_unlocks(v_p.place, v_p.dmg, v_p.best, v_p.thaws, v_w.games, v_w.wins, v_w.unlocked);
    if pg_catalog.cardinality(v_new) > 0 then
      update public.live_wardrobe w set unlocked = w.unlocked || v_new
       where w.owner_kind = v_kind and w.owner_key = v_key;
      update public.live_players p set unlocked_now = v_new where p.id = v_p.id;
    end if;
  end loop;
  update public.live_games g
     set state = 'podium', state_at = pg_catalog.now(), won = v_won, rev = g.rev + 1
   where g.id = p_game;
end;
$fn$;

-- 3f. The next state (the host's «Дальше», or the server after 30 s): lobby → countdown 0; reveal → podium when the boss
--     is defeated or that was the last question, else leaderboard; leaderboard → countdown qi + 1; podium → ended.
create or replace function meldy_private.live_advance(p_game uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_g public.live_games;
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  if v_g.state = 'lobby' then
    perform meldy_private.live_countdown(p_game, 0);
  elsif v_g.state = 'reveal' then
    if v_g.hp = 0 or v_g.qi >= v_g.q_count - 1 then
      perform meldy_private.live_podium(p_game);
    else
      update public.live_games g set state = 'leaderboard', state_at = pg_catalog.now(), rev = g.rev + 1 where g.id = p_game;
    end if;
  elsif v_g.state = 'leaderboard' then
    perform meldy_private.live_countdown(p_game, v_g.qi + 1);
  elsif v_g.state = 'podium' then
    update public.live_games g
       set state = 'ended', state_at = pg_catalog.now(), ended_at = pg_catalog.now(), end_reason = 'podium', rev = g.rev + 1
     where g.id = p_game;
  end if;
end;
$fn$;

-- 3g. The time-driven moves, applied lazily (like quiz_settle). Without p_lock the row is read without a lock and
--     locked only when a move is due; with p_lock it is locked first (every writer). Returns the game as it is now, or
--     null when there is none.
create or replace function meldy_private.live_settle(p_game uuid, p_lock boolean default false)
returns public.live_games
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_g public.live_games;
  v_now timestamptz := pg_catalog.now();
  v_steps integer := 0;
begin
  if p_lock then
    select g.* into v_g from public.live_games g where g.id = p_game for update;
  else
    select g.* into v_g from public.live_games g where g.id = p_game;
  end if;
  if not found then
    return null;
  end if;
  if not meldy_private.live_due(v_g, v_now) then
    return v_g;
  end if;
  if not p_lock then
    select g.* into v_g from public.live_games g where g.id = p_game for update;
  end if;
  while meldy_private.live_due(v_g, v_now) and v_steps < 100 loop
    v_steps := v_steps + 1;
    if v_g.state <> 'ended' and v_now >= v_g.created_at + interval '3 hours' then
      update public.live_games g
         set state = 'ended', state_at = v_now, ended_at = v_now, end_reason = 'expired', rev = g.rev + 1
       where g.id = p_game;
    elsif v_g.state = 'countdown' then
      update public.live_games g set state = 'open', state_at = v_g.q_opens_at, rev = g.rev + 1 where g.id = p_game;
    elsif v_g.state = 'open' then
      perform meldy_private.live_close(p_game);
    else
      perform meldy_private.live_advance(p_game);
    end if;
    select g.* into v_g from public.live_games g where g.id = p_game;
  end loop;
  return v_g;
end;
$fn$;

-- 3h. Closes question qi at once when every active player (not kicked, joined by q_opens_at) has answered.
create or replace function meldy_private.live_close_if_all(p_game uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_g public.live_games;
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  if v_g.state = 'open'
     and exists (select 1 from public.live_players p
                  where p.game_id = p_game and p.kicked_at is null and p.joined_at <= v_g.q_opens_at)
     and not exists (select 1 from public.live_players p
                      where p.game_id = p_game and p.kicked_at is null and p.joined_at <= v_g.q_opens_at
                        and not exists (select 1 from public.live_answers a
                                         where a.game_id = p_game and a.qi = v_g.qi and a.player_id = p.id)) then
    perform meldy_private.live_close(p_game);
  end if;
end;
$fn$;

-- ─────────────────────────────────────────── 4. What the screens read ───────────────────────────────────────────

-- 4a. The common part of PlayerState and HostState (CONTRACT §8). The question (text and options only) from countdown
--     to leaderboard; top five from leaderboard on, with the move since the ranking before this question closed.
create or replace function meldy_private.live_base_json(p_g public.live_games)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_q public.live_questions;
  v_rank uuid[];
  v_top jsonb;
  v_question jsonb;
begin
  if p_g.qi >= 0 then
    select q.* into v_q from public.live_questions q where q.game_id = p_g.id and q.qi = p_g.qi;
  end if;
  if p_g.qi >= 0 and p_g.state in ('countdown', 'open', 'reveal', 'leaderboard') then
    v_question := pg_catalog.jsonb_build_object(
      'qi', p_g.qi, 'text', v_q.text, 'options', v_q.options, 'opens_at', meldy_private.live_iso(v_q.opens_at),
      'closes_at', meldy_private.live_iso(v_q.closes_at), 'phase', v_q.phase, 'picture', null);
  end if;
  if p_g.state in ('leaderboard', 'podium') or (p_g.state = 'ended' and p_g.won is not null) then
    v_rank := meldy_private.live_rank(p_g.id);
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'player_id', p.id, 'name', p.name, 'look', p.look, 'dmg', p.dmg,
             'move', case when p_g.qi > 0 and pg_catalog.array_position(v_q.rank_before, p.id) is not null
                          then pg_catalog.array_position(v_q.rank_before, p.id) - r.place::integer else 0 end)
             order by r.place), '[]'::jsonb)
      into v_top
      from pg_catalog.unnest(v_rank[1:5]) with ordinality as r(id, place)
      join public.live_players p on p.id = r.id;
  end if;
  return pg_catalog.jsonb_build_object(
    'rev', p_g.rev,
    'now', meldy_private.live_iso(pg_catalog.clock_timestamp()),
    'state', p_g.state,
    'mode', p_g.mode,
    'qi', p_g.qi,
    'q_count', p_g.q_count,
    'time_s', p_g.time_s,
    'speed', p_g.speed,
    'players', (select pg_catalog.count(*) from public.live_players p where p.game_id = p_g.id and p.kicked_at is null),
    'answered', case when p_g.qi >= 0 then
                  (select pg_catalog.count(*) from public.live_answers a join public.live_players p on p.id = a.player_id
                    where a.game_id = p_g.id and a.qi = p_g.qi and p.kicked_at is null) else 0 end,
    'question', v_question,
    'boss', pg_catalog.jsonb_build_object('hp', p_g.hp, 'hp_max', p_g.hp_max, 'phase', p_g.phase,
                                          'defeated', p_g.hp_max > 0 and p_g.hp = 0),
    'top', v_top);
end;
$fn$;

-- 4b. The closed question's public part, or null while it is not closed (the key is never in anything else).
create or replace function meldy_private.live_closed_json(p_g public.live_games)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select pg_catalog.jsonb_build_object('qi', q.qi, 'key', q.key, 'counts', pg_catalog.to_jsonb(q.counts), 'right', q.right_n,
                                       'healed', q.healed, 'phase_changed', q.phase_changed)
    from public.live_questions q
   where q.game_id = p_g.id and q.qi = p_g.qi and q.closed_at is not null
     and p_g.state in ('reveal', 'leaderboard', 'podium', 'ended')
$fn$;

-- 4c. PlayerState.
create or replace function meldy_private.live_player_json(p_g public.live_games, p_player uuid)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_p public.live_players;
  v_rank uuid[] := meldy_private.live_rank(p_g.id);
  v_closed jsonb := meldy_private.live_closed_json(p_g);
  v_a public.live_answers;
  v_q public.live_questions;
  v_result jsonb;
  v_final jsonb;
  v_crowd jsonb;
begin
  select p.* into v_p from public.live_players p where p.id = p_player;
  if p_g.qi >= 0 then
    select a.* into v_a from public.live_answers a where a.game_id = p_g.id and a.qi = p_g.qi and a.player_id = p_player;
  end if;
  if v_closed is not null then
    select q.* into v_q from public.live_questions q where q.game_id = p_g.id and q.qi = p_g.qi;
    v_result := v_closed || pg_catalog.jsonb_build_object(
      'correct', coalesce(v_a.correct, false),
      'none', v_a.player_id is null,
      'dmg', coalesce(v_a.dmg, 0),
      'thawed', p_player = any (coalesce(v_q.thawed, '{}'::uuid[])),
      'frozen', v_p.frozen);
  end if;
  if p_g.state in ('podium', 'ended') and p_g.won is not null then
    v_final := pg_catalog.jsonb_build_object(
      'won', p_g.won,
      'place', pg_catalog.array_position(v_rank, p_player),
      'dmg', v_p.dmg, 'best', v_p.best, 'right', v_p.right_n,
      'accuracy_pct', (select meldy_private.live_accuracy(coalesce(pg_catalog.sum(p.right_n), 0)::integer,
                                                          pg_catalog.count(*)::integer, p_g.qi + 1)
                         from public.live_players p where p.game_id = p_g.id and p.kicked_at is null),
      'unlocked_now', pg_catalog.to_jsonb(v_p.unlocked_now));
  end if;
  if p_g.state = 'lobby' then
    select coalesce(pg_catalog.jsonb_agg(x.look order by x.joined_at, x.id), '[]'::jsonb) into v_crowd
      from (select p.look, p.joined_at, p.id from public.live_players p
             where p.game_id = p_g.id and p.kicked_at is null and p.id <> p_player
             order by p.joined_at, p.id limit 40) x;
  end if;
  return meldy_private.live_base_json(p_g) || pg_catalog.jsonb_build_object(
    'me', pg_catalog.jsonb_build_object(
      'player_id', v_p.id, 'name', v_p.name, 'look', v_p.look, 'dmg', v_p.dmg, 'streak', v_p.streak, 'best', v_p.best,
      'frozen', v_p.frozen, 'place', pg_catalog.array_position(v_rank, p_player), 'choice', v_a.choice),
    'result', v_result,
    'final', v_final,
    'crowd', v_crowd);
end;
$fn$;

-- 4d. HostState: the roster (names, looks, numbers), who answered (ids, during open), the hits and freezes of a closed
--     question, the class's result at the podium.
create or replace function meldy_private.live_host_json(p_g public.live_games)
returns jsonb
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_closed jsonb := meldy_private.live_closed_json(p_g);
  v_q public.live_questions;
  v_result jsonb;
  v_final jsonb;
begin
  if v_closed is not null then
    select q.* into v_q from public.live_questions q where q.game_id = p_g.id and q.qi = p_g.qi;
    v_result := v_closed || pg_catalog.jsonb_build_object(
      'hits', coalesce(v_q.hits, '[]'::jsonb), 'frozen_now', pg_catalog.to_jsonb(coalesce(v_q.frozen_now, '{}'::uuid[])),
      'thawed', pg_catalog.to_jsonb(coalesce(v_q.thawed, '{}'::uuid[])));
  end if;
  if p_g.state in ('podium', 'ended') and p_g.won is not null then
    v_final := (select pg_catalog.jsonb_build_object('won', p_g.won, 'accuracy_pct',
                         meldy_private.live_accuracy(coalesce(pg_catalog.sum(p.right_n), 0)::integer, pg_catalog.count(*)::integer,
                                                     p_g.qi + 1))
                  from public.live_players p where p.game_id = p_g.id and p.kicked_at is null);
  end if;
  return meldy_private.live_base_json(p_g) || pg_catalog.jsonb_build_object(
    'pin', p_g.pin,
    'topic', p_g.topic,
    'settings', pg_catalog.jsonb_build_object('mode', p_g.mode, 'time_s', p_g.time_s, 'speed', p_g.speed, 'who', p_g.who,
                                              'chat_names', p_g.chat_names),
    'skipped', p_g.skipped,
    'roster', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                 'player_id', p.id, 'name', p.name, 'look', p.look, 'dmg', p.dmg, 'right', p.right_n, 'streak', p.streak,
                 'frozen', p.frozen, 'joined_at', meldy_private.live_iso(p.joined_at),
                 'answered', p_g.qi >= 0 and exists (select 1 from public.live_answers a
                                                      where a.game_id = p_g.id and a.qi = p_g.qi and a.player_id = p.id))
                 order by p.joined_at, p.id), '[]'::jsonb)
                 from public.live_players p where p.game_id = p_g.id and p.kicked_at is null),
    'answered_ids', case when p_g.state = 'open' then
                      (select coalesce(pg_catalog.jsonb_agg(a.player_id order by a.at, a.player_id), '[]'::jsonb)
                         from public.live_answers a join public.live_players p on p.id = a.player_id
                        where a.game_id = p_g.id and a.qi = p_g.qi and p.kicked_at is null)
                    else '[]'::jsonb end,
    'result', v_result,
    'final', v_final);
end;
$fn$;

-- 4e. «Nothing changed» for since_rev = rev (never in lobby or open: the roster and the answered count move without rev).
create or replace function meldy_private.live_unchanged(p_g public.live_games, p_since bigint)
returns jsonb
language sql
stable
set search_path = ''
as $fn$
  select case when p_since is not null and p_since = p_g.rev and p_g.state not in ('lobby', 'open')
              then pg_catalog.jsonb_build_object('rev', p_g.rev, 'now', meldy_private.live_iso(pg_catalog.clock_timestamp()),
                                                 'unchanged', true) end
$fn$;

-- ─────────────────────────────────────────── 5. Hints and the bot's message ───────────────────────────────────────────

-- 5a. A call to the bot's function (pg_net, sent after commit): POST <function_url>/game/<route> {game_id}, signed with
--     x-meldy-live. False when the bot is not set up (no function URL, region or live token); pg_net missing: nothing.
create or replace function meldy_private.live_tg_call(p_game uuid, p_route text)
returns boolean
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_c record;
begin
  select c.function_url, c.function_region, c.live_token into v_c from bot.config c where c.id = 1;
  if v_c.function_url is null or v_c.function_region is null or v_c.live_token is null or p_route not in ('post', 'sync') then
    return false;
  end if;
  begin
    perform net.http_post(
      url := v_c.function_url || '/game/' || p_route || '?forceFunctionRegion=' || v_c.function_region,
      body := pg_catalog.jsonb_build_object('game_id', p_game),
      headers := pg_catalog.jsonb_build_object('Content-Type', 'application/json', 'x-meldy-live', v_c.live_token),
      timeout_milliseconds := 5000);
  exception
    when others then
      null;
  end;
  return true;
end;
$fn$;

-- 5b. The bot's message in a group follows the game: /game/sync on countdown, reveal, podium and ended (once per state
--     and question), and on roster changes in the lobby at most every 5 s. The function answers 202 and edits within
--     Telegram's limits.
create or replace function meldy_private.live_tg_sync(p_game uuid)
returns void
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_g public.live_games;
  v_mark text;
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  if v_g.chat_id is null or v_g.message_id is null then
    return;
  end if;
  v_mark := v_g.state || ':' || v_g.qi;
  if v_g.state in ('countdown', 'reveal', 'podium', 'ended') then
    if v_g.tg_synced is not distinct from v_mark then
      return;
    end if;
  elsif v_g.state = 'lobby' then
    if v_g.tg_sync_at is not null and v_g.tg_sync_at > pg_catalog.now() - interval '5 seconds' then
      return;
    end if;
  else
    return;
  end if;
  if meldy_private.live_tg_call(p_game, 'sync') then
    update public.live_games g set tg_synced = v_mark, tg_sync_at = pg_catalog.now() where g.id = p_game;
  end if;
end;
$fn$;

-- 5c. One hint per transaction that changed rev (a deferred trigger: the earlier events of the transaction see a newer
--     rev and stay quiet). The channel is public: guests have no JWT; the hint only says «read again».
create or replace function meldy_private.live_hint()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_g public.live_games;
begin
  select g.* into v_g from public.live_games g where g.id = new.id;
  if not found or v_g.rev <> new.rev then
    return null;
  end if;
  begin
    perform realtime.send(pg_catalog.jsonb_build_object('rev', v_g.rev, 'state', v_g.state), 'hint', 'live:' || v_g.topic, false);
  exception
    when others then
      null;
  end;
  perform meldy_private.live_tg_sync(v_g.id);
  return null;
end;
$fn$;

drop trigger if exists live_games_hint on public.live_games;
create constraint trigger live_games_hint
  after update on public.live_games
  deferrable initially deferred
  for each row
  when (old.rev is distinct from new.rev)
  execute function meldy_private.live_hint();

-- ─────────────────────────────────────────── 6. The host ───────────────────────────────────────────

-- 6a. A new game from a контрольная (its set or a draw by its settings) or from subjects of an exam (count 3–30 drawn
--     now), by the exam's author. Only playable questions (2b); the others are counted in `skipped`; at most 30.
create or replace function public.live_create(p_source jsonb, p_settings jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_settings jsonb := coalesce(p_settings, '{}'::jsonb);
  v_time integer;
  v_speed boolean;
  v_who text;
  v_names boolean;
  v_quiz public.quizzes;
  v_container uuid;
  v_title text;
  v_subjects uuid[];
  v_count integer;
  v_candidates uuid[];
  v_items uuid[];
  v_skipped integer;
  v_token text := meldy_private.live_new_token(32);
  v_g public.live_games;
  v_item public.test_items;
  v_shown smallint[];
  v_flags jsonb;
  v_bot text;
  v_ord integer;
begin
  if v_user is null then
    perform meldy_private.live_fail('28000', null, 401);
  end if;
  -- Settings (defaults for the keys left out).
  if pg_catalog.jsonb_typeof(v_settings) <> 'object' then
    perform meldy_private.live_fail('22023', 'settings');
  end if;
  if coalesce(v_settings ->> 'mode', 'boss') <> 'boss' then
    perform meldy_private.live_fail('22023', 'mode');
  end if;
  if v_settings ? 'time_s' and (pg_catalog.jsonb_typeof(v_settings -> 'time_s') <> 'number'
                                or (v_settings ->> 'time_s') not in ('10', '20', '30')) then
    perform meldy_private.live_fail('22023', 'time_s');
  end if;
  v_time := coalesce((v_settings ->> 'time_s')::integer, 20);
  if v_settings ? 'speed' and pg_catalog.jsonb_typeof(v_settings -> 'speed') <> 'boolean' then
    perform meldy_private.live_fail('22023', 'speed');
  end if;
  v_speed := coalesce((v_settings ->> 'speed')::boolean, true);
  v_who := coalesce(v_settings ->> 'who', 'pin');
  if v_who not in ('pin', 'members') or (v_settings ? 'who' and pg_catalog.jsonb_typeof(v_settings -> 'who') <> 'string') then
    perform meldy_private.live_fail('22023', 'who');
  end if;
  if v_settings ? 'chat_names' and pg_catalog.jsonb_typeof(v_settings -> 'chat_names') <> 'boolean' then
    perform meldy_private.live_fail('22023', 'chat_names');
  end if;
  v_names := coalesce((v_settings ->> 'chat_names')::boolean, true);
  -- The source.
  if p_source is null or pg_catalog.jsonb_typeof(p_source) <> 'object' then
    perform meldy_private.live_fail('22023', 'source');
  end if;
  if p_source ? 'quiz_id' then
    if (p_source ->> 'quiz_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform meldy_private.live_fail('22023', 'quiz_id');
    end if;
    select q.* into v_quiz from public.quizzes q where q.id = (p_source ->> 'quiz_id')::uuid;
    if not found then
      perform meldy_private.live_fail('P0002', 'quiz', 404);
    end if;
    if v_quiz.owner_id <> v_user
       or not exists (select 1 from public.containers c where c.id = v_quiz.container_id and c.owner_id = v_user) then
      perform meldy_private.live_fail('42501', 'author', 403);
    end if;
    v_container := v_quiz.container_id;
    v_title := v_quiz.title;
  elsif p_source ? 'container_id' then
    if (p_source ->> 'container_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
      perform meldy_private.live_fail('22023', 'container_id');
    end if;
    v_container := (p_source ->> 'container_id')::uuid;
    select c.title into v_title from public.containers c where c.id = v_container;
    if not found then
      perform meldy_private.live_fail('P0002', 'container', 404);
    end if;
    if not exists (select 1 from public.containers c where c.id = v_container and c.owner_id = v_user) then
      perform meldy_private.live_fail('42501', 'author', 403);
    end if;
    if pg_catalog.jsonb_typeof(p_source -> 'subject_ids') is distinct from 'array'
       or pg_catalog.jsonb_array_length(p_source -> 'subject_ids') not between 1 and 50
       or exists (select 1 from pg_catalog.jsonb_array_elements(p_source -> 'subject_ids') s
                   where pg_catalog.jsonb_typeof(s) <> 'string'
                      or (s #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') then
      perform meldy_private.live_fail('22023', 'subject_ids');
    end if;
    select pg_catalog.array_agg(distinct (s #>> '{}')::uuid) into v_subjects
      from pg_catalog.jsonb_array_elements(p_source -> 'subject_ids') s;
    if exists (select 1 from pg_catalog.unnest(v_subjects) x(id)
                where not exists (select 1 from public.container_subjects cs where cs.id = x.id and cs.container_id = v_container)) then
      perform meldy_private.live_fail('22023', 'subject_ids');
    end if;
    if pg_catalog.jsonb_typeof(p_source -> 'count') is distinct from 'number'
       or (p_source ->> 'count') !~ '^[0-9]{1,2}$' or (p_source ->> 'count')::integer not between 3 and 30 then
      perform meldy_private.live_fail('22023', 'count');
    end if;
    v_count := (p_source ->> 'count')::integer;
  else
    perform meldy_private.live_fail('22023', 'source');
  end if;
  -- One author's creates in turn; the limits.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('live.create:' || v_user::text, 0));
  update public.live_games g
     set state = 'ended', state_at = pg_catalog.now(), ended_at = pg_catalog.now(), end_reason = 'expired', rev = g.rev + 1
   where g.id in (select x.id from public.live_games x
                   where x.state <> 'ended' and x.created_at < pg_catalog.now() - interval '3 hours'
                   order by x.created_at limit 200);
  delete from public.live_games g
   where g.id in (select x.id from public.live_games x
                   where x.state = 'ended' and x.ended_at < pg_catalog.now() - interval '8 days'
                   order by x.ended_at limit 50);
  if (select pg_catalog.count(*) from public.live_games g
       where g.owner_id = v_user and g.created_at > pg_catalog.now() - interval '1 hour') >= 10 then
    perform meldy_private.live_fail('ML005', 'create', 429, meldy_private.live_retry_after(
      (select pg_catalog.min(g.created_at) from public.live_games g
        where g.owner_id = v_user and g.created_at > pg_catalog.now() - interval '1 hour'), interval '1 hour'));
  end if;
  if (select pg_catalog.count(*) from public.live_games g
       where g.owner_id = v_user and g.state not in ('podium', 'ended')) >= 3 then
    perform meldy_private.live_fail('ML009', null);
  end if;
  -- The questions.
  if v_quiz.id is not null then
    v_candidates := meldy_private.quiz_draw(v_quiz);
    select coalesce(pg_catalog.array_agg(x.id order by x.ord), '{}'::uuid[]) into v_items
      from pg_catalog.unnest(v_candidates) with ordinality as x(id, ord)
      join public.test_items i on i.id = x.id
     where meldy_private.live_playable(i);
    v_skipped := pg_catalog.cardinality(v_candidates) - pg_catalog.cardinality(v_items);
    v_items := v_items[1:30];
  else
    v_candidates := meldy_private.quiz_pool(v_container, v_subjects);
    select coalesce(pg_catalog.array_agg(x.id order by x.ord), '{}'::uuid[]) into v_items
      from (select y.id, y.ord
              from pg_catalog.unnest(v_candidates) with ordinality as y(id, ord)
              join public.test_items i on i.id = y.id
             where meldy_private.live_playable(i)
             order by pg_catalog.random()
             limit v_count) x;
    v_skipped := pg_catalog.cardinality(v_candidates)
                 - (select pg_catalog.count(*)::integer from pg_catalog.unnest(v_candidates) y(id)
                      join public.test_items i on i.id = y.id where meldy_private.live_playable(i));
  end if;
  if pg_catalog.cardinality(v_items) = 0 then
    perform meldy_private.live_fail('ML008', v_skipped::text);
  end if;
  -- The game, with a PIN no open game holds.
  for v_attempt in 1 .. 30 loop
    begin
      insert into public.live_games (owner_id, container_id, quiz_id, title, pin, topic, host_hash, time_s, speed, who,
                                     chat_names, q_count, skipped)
      values (v_user, v_container, v_quiz.id, pg_catalog.left(pg_catalog.btrim(v_title), 200),
              (100000 + pg_catalog.floor(pg_catalog.random() * 900000))::integer::text,
              meldy_private.live_new_token(16), meldy_private.live_hash(v_token), v_time, v_speed, v_who, v_names,
              pg_catalog.cardinality(v_items), v_skipped)
      returning * into v_g;
      exit;
    exception
      when unique_violation then
        if v_attempt = 30 then
          raise;
        end if;
    end;
  end loop;
  v_ord := 0;
  for v_item in
    select i.* from pg_catalog.unnest(v_items) with ordinality as x(id, ord) join public.test_items i on i.id = x.id order by x.ord
  loop
    if v_item.keep_order then
      select pg_catalog.array_agg(s::smallint order by s) into v_shown
        from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(v_item.options) - 1) s;
    else
      select pg_catalog.array_agg(s::smallint order by pg_catalog.random()) into v_shown
        from pg_catalog.generate_series(0, pg_catalog.jsonb_array_length(v_item.options) - 1) s;
    end if;
    insert into public.live_questions (game_id, qi, item_id, text, options, shown, key)
    values (v_g.id, v_ord, v_item.id, v_item.stem,
            (select pg_catalog.jsonb_agg(v_item.options -> s.f::integer order by s.n)
               from pg_catalog.unnest(v_shown) with ordinality as s(f, n)),
            v_shown, (pg_catalog.array_position(v_shown, v_item.correct[1]) - 1)::smallint);
    v_ord := v_ord + 1;
  end loop;
  select c.flags, c.bot_username into v_flags, v_bot from bot.config c where c.id = 1;
  v_bot := coalesce(v_bot, 'Meldyteach_bot');
  return pg_catalog.jsonb_build_object(
    'game_id', v_g.id, 'pin', v_g.pin, 'topic', v_g.topic, 'host_token', v_token, 'q_count', v_g.q_count,
    'skipped', v_g.skipped,
    'join_url', 'https://ludosiel-studyforge.hf.space/play?pin=' || v_g.pin,
    'tg_url', case when coalesce(v_flags ->> 'live_direct', 'false') = 'true'
                   then 'https://t.me/' || v_bot || '/play?startapp=' || v_g.pin
                   else 'https://t.me/' || v_bot || '?start=play_' || v_g.pin end);
end;
$fn$;

-- 6b. The host's token → the game (P0002 game 404, 42501 host 403). The row is locked when p_lock.
create or replace function meldy_private.live_host_game(p_game uuid, p_host_token text, p_lock boolean)
returns public.live_games
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_g public.live_games;
begin
  v_g := meldy_private.live_settle(p_game, p_lock);
  if v_g.id is null then
    perform meldy_private.live_fail('P0002', 'game', 404);
  end if;
  if p_host_token is null or p_host_token !~ '^[A-Za-z0-9_-]{43}$' or meldy_private.live_hash(p_host_token) <> v_g.host_hash then
    perform meldy_private.live_fail('42501', 'host', 403);
  end if;
  return v_g;
end;
$fn$;

create or replace function public.live_host_state(p_game uuid, p_host_token text, p_since_rev bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_g public.live_games := meldy_private.live_host_game(p_game, p_host_token, false);
begin
  return coalesce(meldy_private.live_unchanged(v_g, p_since_rev), meldy_private.live_host_json(v_g));
end;
$fn$;

-- 6c. «Дальше»: p_expect is the state the host shows; another one → ML011 (409) with the current state. The lobby needs a
--     player; countdown and open move by time only.
create or replace function public.live_next(p_game uuid, p_host_token text, p_expect text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_g public.live_games;
begin
  if p_expect is null or p_expect not in ('lobby', 'countdown', 'open', 'reveal', 'leaderboard', 'podium', 'ended') then
    perform meldy_private.live_fail('22023', 'expect');
  end if;
  v_g := meldy_private.live_host_game(p_game, p_host_token, true);
  if v_g.state <> p_expect or v_g.state in ('countdown', 'open', 'ended') then
    perform meldy_private.live_fail('ML011', v_g.state, 409);
  end if;
  if v_g.state = 'lobby'
     and not exists (select 1 from public.live_players p where p.game_id = v_g.id and p.kicked_at is null) then
    perform meldy_private.live_fail('ML011', 'empty', 409);
  end if;
  perform meldy_private.live_advance(v_g.id);
  select g.* into v_g from public.live_games g where g.id = p_game;
  return meldy_private.live_host_json(v_g);
end;
$fn$;

-- 6d. Removing a player: their token stops working (42501 kicked); their damage stays in the boss's HP. During open the
--     question may close at once (everyone left has answered).
create or replace function public.live_kick(p_game uuid, p_host_token text, p_player uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_g public.live_games := meldy_private.live_host_game(p_game, p_host_token, true);
begin
  if not exists (select 1 from public.live_players p where p.id = p_player and p.game_id = v_g.id) then
    perform meldy_private.live_fail('P0002', 'player', 404);
  end if;
  update public.live_players p set kicked_at = pg_catalog.now() where p.id = p_player and p.kicked_at is null;
  if found then
    update public.live_games g set rev = g.rev + 1 where g.id = v_g.id;
    perform meldy_private.live_close_if_all(v_g.id);
  end if;
  return pg_catalog.jsonb_build_object('ok', true);
end;
$fn$;

create or replace function public.live_end(p_game uuid, p_host_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_g public.live_games := meldy_private.live_host_game(p_game, p_host_token, true);
begin
  if v_g.state <> 'ended' then
    update public.live_games g
       set state = 'ended', state_at = pg_catalog.now(), ended_at = pg_catalog.now(), end_reason = 'host', rev = g.rev + 1
     where g.id = v_g.id;
  end if;
  return pg_catalog.jsonb_build_object('ok', true);
end;
$fn$;

-- 6e. The author posts the game into a group chat bound to its exam (telegram_groups lists them): the bot sends the post
--     (pg_net → /telegram/game/post) and then edits it as the game goes. One post a minute per game.
create or replace function public.live_tg_post(p_game uuid, p_chat_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_g public.live_games;
begin
  if v_user is null then
    perform meldy_private.live_fail('28000', null, 401);
  end if;
  v_g := meldy_private.live_settle(p_game, true);
  if v_g.id is null then
    perform meldy_private.live_fail('P0002', 'game', 404);
  end if;
  if v_g.owner_id <> v_user then
    perform meldy_private.live_fail('42501', 'author', 403);
  end if;
  if v_g.state = 'ended' then
    perform meldy_private.live_fail('ML002', case when v_g.end_reason = 'expired' then 'expired' else 'ended' end);
  end if;
  if p_chat_id is null or not exists (select 1 from bot.groups gr
                                       where gr.chat_id = p_chat_id and gr.container_id = v_g.container_id and gr.left_at is null) then
    perform meldy_private.live_fail('P0002', 'group', 404);
  end if;
  if v_g.tg_posted_at is not null and v_g.tg_posted_at > pg_catalog.now() - interval '1 minute' then
    perform meldy_private.live_fail('ML005', 'post', 429, meldy_private.live_retry_after(v_g.tg_posted_at, interval '1 minute'));
  end if;
  update public.live_games g
     set chat_id = p_chat_id, message_id = null, tg_posted_at = pg_catalog.now(), tg_claim_at = null,
         tg_edit_at = pg_catalog.now(), tg_synced = g.state || ':' || g.qi, tg_sync_at = pg_catalog.now(), tg_final_at = null
   where g.id = p_game;
  if not meldy_private.live_tg_call(p_game, 'post') then
    perform meldy_private.live_fail('ML010', 'bot', 503);
  end if;
  return pg_catalog.jsonb_build_object('status', 'posting');
end;
$fn$;

-- ─────────────────────────────────────────── 7. Players ───────────────────────────────────────────

-- 7a. The game of a PIN: the open one, else the latest of the last day (to say «ended» rather than «not found»).
create or replace function meldy_private.live_game_of_pin(p_pin text)
returns uuid
language sql
stable
set search_path = ''
as $fn$
  select g.id from public.live_games g
   where g.pin = p_pin and g.created_at > pg_catalog.now() - interval '1 day'
   order by (g.state <> 'ended') desc, g.created_at desc
   limit 1
$fn$;

-- The wardrobe of an owner, or the empty one.
create or replace function meldy_private.live_wardrobe_of(p_user uuid, p_tg bigint)
returns public.live_wardrobe
language plpgsql
stable
set search_path = ''
as $fn$
declare
  v_w public.live_wardrobe;
begin
  if p_user is not null then
    select w.* into v_w from public.live_wardrobe w where w.owner_kind = 'user' and w.owner_key = p_user::text;
    if not found then
      v_w := row('user', p_user::text, null, '{}'::text[], 0, 0, null)::public.live_wardrobe;
    end if;
  elsif p_tg is not null then
    select w.* into v_w from public.live_wardrobe w where w.owner_kind = 'tg' and w.owner_key = p_tg::text;
    if not found then
      v_w := row('tg', p_tg::text, null, '{}'::text[], 0, 0, null)::public.live_wardrobe;
    end if;
  end if;
  return v_w;
end;
$fn$;

-- 7b. Joining (the site's live_join and the bot's bot_live_join): the game row is locked and settled by the caller.
--     The same identity gets its player back with the new token (kicked → 42501). A new player: not after the podium
--     (ML002), 120 a minute per address and 120 a minute per game (ML005, 429 with Retry-After), members only (ML003), 300 players (ML001), the name (ML006), the
--     look (ML007; none given: the saved one, else the name's). Joining after the first countdown adds 55 HP per
--     question not yet opened (only while the boss is alive). A lobby roster change moves rev.
create or replace function meldy_private.live_join_as(p_g public.live_games, p_user uuid, p_tg bigint, p_guest text,
                                                      p_token_hash text, p_name text, p_look jsonb, p_ip text)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_p public.live_players;
  v_w public.live_wardrobe;
  v_name text;
  v_look jsonb;
  v_add integer;
  v_g public.live_games;
begin
  select p.* into v_p from public.live_players p
   where p.game_id = p_g.id
     and ((p_user is not null and p.user_id = p_user) or (p_tg is not null and p.tg_user_id = p_tg)
          or (p_guest is not null and p.guest_hash = p_guest))
   order by (p.user_id is not distinct from p_user) desc
   limit 1;
  if found then
    if v_p.kicked_at is not null then
      perform meldy_private.live_fail('42501', 'kicked', 403);
    end if;
    if p_g.state = 'ended' then
      perform meldy_private.live_fail('ML002', case when p_g.end_reason = 'expired' then 'expired' else 'ended' end);
    end if;
    update public.live_players p
       set token_hash = p_token_hash, user_id = coalesce(p.user_id, p_user), tg_user_id = coalesce(p.tg_user_id, p_tg)
     where p.id = v_p.id
    returning p.* into v_p;
  else
    if p_g.state in ('ended', 'podium') or pg_catalog.now() >= p_g.created_at + interval '3 hours' then
      perform meldy_private.live_fail('ML002', case when p_g.end_reason = 'expired' or pg_catalog.now() >= p_g.created_at + interval '3 hours'
                                                    then 'expired' else 'ended' end);
    end if;
    if p_ip is not null then
      delete from meldy_private.live_join_hits h where h.at <= pg_catalog.now() - interval '2 minutes';
      if (select pg_catalog.count(*) from meldy_private.live_join_hits h
           where h.ip_hash = p_ip and h.at > pg_catalog.now() - interval '1 minute') >= 120 then
        perform meldy_private.live_fail('ML005', 'join', 429, meldy_private.live_retry_after(
          (select pg_catalog.min(h.at) from meldy_private.live_join_hits h
            where h.ip_hash = p_ip and h.at > pg_catalog.now() - interval '1 minute'), interval '1 minute'));
      end if;
    end if;
    if (select pg_catalog.count(*) from public.live_players p
         where p.game_id = p_g.id and p.joined_at > pg_catalog.now() - interval '1 minute') >= 120 then
      perform meldy_private.live_fail('ML005', 'join', 429, meldy_private.live_retry_after(
        (select pg_catalog.min(p.joined_at) from public.live_players p
          where p.game_id = p_g.id and p.joined_at > pg_catalog.now() - interval '1 minute'), interval '1 minute'));
    end if;
    if p_g.who = 'members' and (p_user is null or meldy_private.role_in(p_user, p_g.container_id) is null) then
      perform meldy_private.live_fail('ML003', 'members', 403);
    end if;
    if (select pg_catalog.count(*) from public.live_players p where p.game_id = p_g.id and p.kicked_at is null) >= 300 then
      perform meldy_private.live_fail('ML001', null);
    end if;
    v_name := meldy_private.live_name_check(p_name);
    v_w := meldy_private.live_wardrobe_of(p_user, p_tg);
    if p_look is null or p_look = 'null'::jsonb then
      v_look := meldy_private.live_default_look(v_name);
      if v_w.look is not null then
        begin
          v_look := meldy_private.live_look_check(v_w.look, v_w.unlocked);
        exception
          when sqlstate 'PGRST' then
            v_look := meldy_private.live_default_look(v_name);
        end;
      end if;
    else
      v_look := meldy_private.live_look_check(p_look, coalesce(v_w.unlocked, '{}'::text[]));
    end if;
    insert into public.live_players (game_id, token_hash, user_id, tg_user_id, guest_hash, name, look)
    values (p_g.id, p_token_hash, p_user, p_tg, case when p_user is null and p_tg is null then p_guest end, v_name, v_look)
    returning * into v_p;
    if p_ip is not null then
      insert into meldy_private.live_join_hits (ip_hash) values (p_ip);
    end if;
    if p_g.hp_max > 0 and p_g.hp > 0 and p_g.state in ('countdown', 'open', 'reveal', 'leaderboard') then
      v_add := 55 * greatest(0, p_g.q_count - p_g.qi - case when p_g.state = 'countdown' then 0 else 1 end);
      update public.live_games g set hp_max = g.hp_max + v_add, hp = g.hp + v_add where g.id = p_g.id;
    end if;
    if p_g.state = 'lobby' then
      update public.live_games g set rev = g.rev + 1 where g.id = p_g.id;
    end if;
  end if;
  select g.* into v_g from public.live_games g where g.id = p_g.id;
  v_w := meldy_private.live_wardrobe_of(v_p.user_id, v_p.tg_user_id);
  return pg_catalog.jsonb_build_object(
    'game_id', v_g.id, 'player_id', v_p.id, 'topic', v_g.topic, 'state', v_g.state, 'rev', v_g.rev,
    'now', meldy_private.live_iso(pg_catalog.clock_timestamp()), 'name', v_p.name, 'look', v_p.look,
    'wardrobe', case when v_w.owner_kind is not null
                     then pg_catalog.jsonb_build_object('unlocked', pg_catalog.to_jsonb(v_w.unlocked), 'games', v_w.games,
                                                        'wins', v_w.wins) end);
end;
$fn$;

-- 7c. Joining from the site (anon or signed in). The token is made on the device (43 base64url characters); the
--     database keeps its sha256. A guest is their token's hash; a signed-in user is their account (a new token from
--     another device replaces the old one).
create or replace function public.live_join(p_pin text, p_name text, p_token text, p_look jsonb default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_id uuid;
  v_g public.live_games;
  v_hash text;
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    perform meldy_private.live_fail('22023', 'token');
  end if;
  if p_pin is null or p_pin !~ '^[0-9]{6}$' then
    perform meldy_private.live_fail('P0002', 'pin', 404);
  end if;
  v_id := meldy_private.live_game_of_pin(p_pin);
  if v_id is null then
    perform meldy_private.live_fail('P0002', 'pin', 404);
  end if;
  v_g := meldy_private.live_settle(v_id, true);
  v_hash := meldy_private.live_hash(p_token);
  return meldy_private.live_join_as(v_g, v_user, null, case when v_user is null then v_hash end, v_hash, p_name, p_look,
                                    meldy_private.quiz_ip_hash());
end;
$fn$;

-- 7d. A player's token → the player (P0002 token 404; kicked → 42501 403). The game is settled first (locked when p_lock).
create or replace function meldy_private.live_player_of(p_game uuid, p_token text, p_lock boolean)
returns public.live_players
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_g public.live_games := meldy_private.live_settle(p_game, p_lock);
  v_p public.live_players;
begin
  if v_g.id is null then
    perform meldy_private.live_fail('P0002', 'game', 404);
  end if;
  if p_token is not null and p_token ~ '^[A-Za-z0-9_-]{43}$' then
    select p.* into v_p from public.live_players p where p.game_id = p_game and p.token_hash = meldy_private.live_hash(p_token);
  end if;
  if v_p.id is null then
    perform meldy_private.live_fail('P0002', 'token', 404);
  end if;
  if v_p.kicked_at is not null then
    perform meldy_private.live_fail('42501', 'kicked', 403);
  end if;
  return v_p;
end;
$fn$;

create or replace function public.live_set_look(p_game uuid, p_token text, p_look jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p public.live_players := meldy_private.live_player_of(p_game, p_token, true);
  v_g public.live_games;
  v_w public.live_wardrobe := meldy_private.live_wardrobe_of(v_p.user_id, v_p.tg_user_id);
  v_look jsonb;
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  if v_g.state <> 'lobby' then
    perform meldy_private.live_fail('ML004', 'not_open');
  end if;
  v_look := meldy_private.live_look_check(p_look, coalesce(v_w.unlocked, '{}'::text[]));
  update public.live_players p set look = v_look where p.id = v_p.id;
  update public.live_games g set rev = g.rev + 1 where g.id = p_game;
  if v_w.owner_kind is not null then
    insert into public.live_wardrobe as w (owner_kind, owner_key, look) values (v_w.owner_kind, v_w.owner_key, v_look)
    on conflict (owner_kind, owner_key) do update set look = excluded.look, updated_at = pg_catalog.now();
  end if;
  return pg_catalog.jsonb_build_object('look', v_look);
end;
$fn$;

-- 7e. An answer (shown index) to question qi, timed by the server: from q_opens_at to q_closes_at + 1.5 s while open.
--     ML004 early / late / not_open / twice / bad_qi / not_joined_yet; 22023 choice. The key is not in the answer.
create or replace function public.live_answer(p_game uuid, p_token text, p_qi integer, p_choice integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p public.live_players := meldy_private.live_player_of(p_game, p_token, true);
  v_g public.live_games;
  v_now timestamptz := pg_catalog.now();
  v_options integer;
  v_answered integer;
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  if v_g.qi < 0 or p_qi is null or p_qi <> v_g.qi then
    perform meldy_private.live_fail('ML004', 'bad_qi');
  end if;
  if v_g.state = 'countdown' or v_now < v_g.q_opens_at then
    perform meldy_private.live_fail('ML004', 'early');
  end if;
  if v_g.state <> 'open' then
    perform meldy_private.live_fail('ML004', case when v_now > v_g.q_closes_at then 'late' else 'not_open' end);
  end if;
  if v_now > v_g.q_closes_at + interval '1.5 seconds' then
    perform meldy_private.live_fail('ML004', 'late');
  end if;
  if v_p.joined_at > v_g.q_opens_at then
    perform meldy_private.live_fail('ML004', 'not_joined_yet');
  end if;
  if exists (select 1 from public.live_answers a where a.game_id = p_game and a.qi = v_g.qi and a.player_id = v_p.id) then
    perform meldy_private.live_fail('ML004', 'twice');
  end if;
  select pg_catalog.jsonb_array_length(q.options) into v_options from public.live_questions q
   where q.game_id = p_game and q.qi = v_g.qi;
  if p_choice is null or p_choice < 0 or p_choice >= v_options then
    perform meldy_private.live_fail('22023', 'choice');
  end if;
  insert into public.live_answers (game_id, qi, player_id, choice, at, elapsed_ms)
  values (p_game, v_g.qi, v_p.id, p_choice, v_now,
          least(greatest(pg_catalog.floor(extract(epoch from (v_now - v_g.q_opens_at)) * 1000), 0), v_g.time_s * 1000)::integer);
  select pg_catalog.count(*)::integer into v_answered
    from public.live_answers a join public.live_players p on p.id = a.player_id
   where a.game_id = p_game and a.qi = v_g.qi and p.kicked_at is null;
  perform meldy_private.live_close_if_all(p_game);
  return pg_catalog.jsonb_build_object('accepted', true, 'answered', v_answered,
                                       'now', meldy_private.live_iso(pg_catalog.clock_timestamp()));
end;
$fn$;

create or replace function public.live_state(p_game uuid, p_token text, p_since_rev bigint default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p public.live_players := meldy_private.live_player_of(p_game, p_token, false);
  v_g public.live_games;
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  return coalesce(meldy_private.live_unchanged(v_g, p_since_rev), meldy_private.live_player_json(v_g, v_p.id));
end;
$fn$;

-- 7f. The review (podium and ended, 7 days after the end): the player's own answers and the keys of this game's closed
--     questions — never another question's key.
create or replace function public.live_review(p_game uuid, p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_p public.live_players := meldy_private.live_player_of(p_game, p_token, false);
  v_g public.live_games;
begin
  select g.* into v_g from public.live_games g where g.id = p_game;
  if v_g.state not in ('podium', 'ended') then
    perform meldy_private.live_fail('ML004', 'not_open');
  end if;
  if v_g.ended_at is not null and v_g.ended_at < pg_catalog.now() - interval '7 days' then
    perform meldy_private.live_fail('ML002', 'expired');
  end if;
  return pg_catalog.jsonb_build_object('items', (
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'qi', q.qi, 'text', q.text, 'options', q.options, 'key', q.key, 'choice', a.choice,
             'correct', coalesce(a.choice = q.key, false)) order by q.qi), '[]'::jsonb)
      from public.live_questions q
      left join public.live_answers a on a.game_id = q.game_id and a.qi = q.qi and a.player_id = v_p.id
     where q.game_id = p_game and q.closed_at is not null));
end;
$fn$;

-- 7g. The wardrobe of the signed-in user.
create or replace function public.live_wardrobe()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_w public.live_wardrobe;
begin
  if v_user is null then
    perform meldy_private.live_fail('28000', null, 401);
  end if;
  v_w := meldy_private.live_wardrobe_of(v_user, null);
  return pg_catalog.jsonb_build_object('look', v_w.look, 'unlocked', pg_catalog.to_jsonb(v_w.unlocked), 'games', v_w.games,
                                       'wins', v_w.wins);
end;
$fn$;

create or replace function public.live_wardrobe_set(p_look jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_w public.live_wardrobe;
  v_look jsonb;
begin
  if v_user is null then
    perform meldy_private.live_fail('28000', null, 401);
  end if;
  v_w := meldy_private.live_wardrobe_of(v_user, null);
  v_look := meldy_private.live_look_check(p_look, v_w.unlocked);
  insert into public.live_wardrobe as w (owner_kind, owner_key, look) values ('user', v_user::text, v_look)
  on conflict (owner_kind, owner_key) do update set look = excluded.look, updated_at = pg_catalog.now()
  returning w.* into v_w;
  return pg_catalog.jsonb_build_object('look', v_w.look, 'unlocked', pg_catalog.to_jsonb(v_w.unlocked), 'games', v_w.games,
                                       'wins', v_w.wins);
end;
$fn$;

-- ─────────────────────────────────────────── 8. The bot (service role) ───────────────────────────────────────────

-- 8a. POST /telegram/game/join, after the function checked initData (HMAC, ≤ 1 h) and made the player token: one use of
--     a launch (bot.webapp_uses purpose 'game'; the same launch may rejoin the game it joined, so a lost answer can be
--     retried), 30 joins an hour per Telegram user, then the join as that Telegram user (a linked Telegram also as its
--     account: members only, the wardrobe). Every expected outcome is a status: joined (+ JoinResult), replayed,
--     slow_down, not_found, ended, full, members_only, kicked, name_refused / look_refused (+ reason).
create or replace function public.bot_live_join(p_pin text, p_tg_user_id bigint, p_name text, p_look jsonb, p_token_hash text,
                                                p_init_hash text, p_auth_date timestamptz)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_id uuid;
  v_g public.live_games;
  v_user uuid;
  v_used boolean;
  v_err jsonb;
  v_r jsonb;
begin
  perform meldy_private.require_service_role();
  if p_tg_user_id is null or p_tg_user_id <= 0 or p_token_hash is null or p_token_hash !~ '^[0-9a-f]{64}$'
     or p_init_hash is null or p_init_hash !~ '^[0-9a-f]{64}$' or p_auth_date is null then
    raise exception 'bad live join' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bot.webapp:' || p_tg_user_id::text, 0));
  delete from bot.webapp_uses u
   using (select x.init_hash, x.purpose from bot.webapp_uses x where x.used_at < v_now - interval '2 hours' limit 200) old
   where u.init_hash = old.init_hash and u.purpose = old.purpose;
  v_id := case when p_pin ~ '^[0-9]{6}$' then meldy_private.live_game_of_pin(p_pin) end;
  -- A launch is spent by a join that worked; it may only rejoin that game (a lost answer retried).
  v_used := exists (select 1 from bot.webapp_uses u where u.init_hash = p_init_hash and u.purpose = 'game');
  if v_used then
    if v_id is null or not exists (select 1 from public.live_players p where p.game_id = v_id and p.tg_user_id = p_tg_user_id) then
      return pg_catalog.jsonb_build_object('status', 'replayed');
    end if;
  elsif (select pg_catalog.count(*) from bot.webapp_uses u
          where u.tg_user_id = p_tg_user_id and u.purpose = 'game' and u.used_at > v_now - interval '1 hour') >= 30 then
    return pg_catalog.jsonb_build_object('status', 'slow_down');
  end if;
  if v_id is null then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  v_g := meldy_private.live_settle(v_id, true);
  v_user := (bot.active_link(p_tg_user_id)).user_id;
  begin
    v_r := meldy_private.live_join_as(v_g, v_user, p_tg_user_id, null, p_token_hash, p_name, p_look, null);
    if not v_used then
      insert into bot.webapp_uses (init_hash, purpose, tg_user_id, auth_date, used_at)
      values (p_init_hash, 'game', p_tg_user_id, p_auth_date, v_now);
    end if;
  exception
    when sqlstate 'PGRST' then
      v_err := sqlerrm::jsonb;
      return case v_err ->> 'code'
        when 'ML001' then pg_catalog.jsonb_build_object('status', 'full')
        when 'ML002' then pg_catalog.jsonb_build_object('status', 'ended')
        when 'ML003' then pg_catalog.jsonb_build_object('status', 'members_only')
        when 'ML005' then pg_catalog.jsonb_build_object('status', 'slow_down')
        when 'ML006' then pg_catalog.jsonb_build_object('status', 'name_refused', 'reason', v_err ->> 'details')
        when 'ML007' then pg_catalog.jsonb_build_object('status', 'look_refused', 'reason', v_err ->> 'details')
        when '42501' then pg_catalog.jsonb_build_object('status', 'kicked')
        else pg_catalog.jsonb_build_object('status', 'not_found') end;
  end;
  return pg_catalog.jsonb_build_object('status', 'joined') || v_r;
end;
$fn$;

-- 8b. POST /telegram/game/post, called by the database after the author's live_tg_post: the post to send, claimed once
--     (a retried call finds it taken: skip) → {status: post, chat_id, title, q_count, host, pin, players, direct}.
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

-- 8c. POST /telegram/setup keeps the live token here: HMAC-SHA256(bot token, 'meldy:live:v1'), the x-meldy-live header
--     of the database's calls to /game/post and /game/sync.
create or replace function public.bot_live_setup(p_live_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform meldy_private.require_service_role();
  if p_live_token is null or p_live_token !~ '^[A-Za-z0-9_-]{43}$' then
    raise exception 'bad live token' using errcode = '22023';
  end if;
  insert into bot.config (id) values (1) on conflict (id) do nothing;
  update bot.config c set live_token = p_live_token, updated_at = pg_catalog.now()
   where c.id = 1 and c.live_token is distinct from p_live_token;
  return pg_catalog.jsonb_build_object('status', 'ok');
end;
$fn$;

-- The message the function sent for a post: later state changes edit it.
create or replace function public.bot_live_posted(p_game uuid, p_chat_id bigint, p_message_id bigint)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  perform meldy_private.require_service_role();
  if p_game is null or p_chat_id is null or p_message_id is null or p_message_id <= 0 then
    raise exception 'bad live posted' using errcode = '22023';
  end if;
  update public.live_games g set message_id = p_message_id where g.id = p_game and g.chat_id = p_chat_id;
  return pg_catalog.jsonb_build_object('status', case when found then 'ok' else 'gone' end);
end;
$fn$;

-- 8c. POST /telegram/game/sync (from the database through pg_net): what the bot's message says now, when an edit is
--     allowed (one per 3 s; the lobby count every 5 s; the end at once). skip, or edit {chat_id, message_id, state,
--     players, qi, q_count, hp_pct, title, pin, host, direct} and, once, at the podium: final {won, top (three, when the
--     author allows names), accuracy_pct, game_id, container_id}. Never a key or a per-question result.
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

-- ─────────────────────────────────────────── 9. Grants ───────────────────────────────────────────
-- Supabase gives new public functions to anon and authenticated and PostgreSQL to PUBLIC: taken back, then given as
-- the contract says. The tables: nothing for the API roles (row security on, no policy).
revoke all on table public.live_games, public.live_questions, public.live_players, public.live_answers, public.live_wardrobe
  from public, anon, authenticated;
revoke all on table meldy_private.live_join_hits from public, anon, authenticated, service_role;

revoke all on function
  meldy_private.live_fail(text, text, integer, integer), meldy_private.live_retry_after(timestamptz, interval),
  meldy_private.live_new_token(integer), meldy_private.live_hash(text),
  meldy_private.live_iso(timestamptz), meldy_private.live_damage(integer, integer, integer, boolean),
  meldy_private.live_phase_for(integer, integer), meldy_private.live_heal(integer), meldy_private.live_right_needed(integer),
  meldy_private.live_accuracy(integer, integer, integer),
  meldy_private.live_unlocks(integer, integer, integer, integer, integer, integer, text[]),
  meldy_private.live_look_check(jsonb, text[]), meldy_private.live_fnv(text), meldy_private.live_default_look(text),
  meldy_private.live_name_norm(text), meldy_private.live_rude_word(text), meldy_private.live_name_rude(text),
  meldy_private.live_name_check(text), meldy_private.live_playable(public.test_items), meldy_private.live_rank(uuid),
  meldy_private.live_due(public.live_games, timestamptz), meldy_private.live_countdown(uuid, integer),
  meldy_private.live_close(uuid), meldy_private.live_podium(uuid), meldy_private.live_advance(uuid),
  meldy_private.live_settle(uuid, boolean), meldy_private.live_close_if_all(uuid),
  meldy_private.live_base_json(public.live_games), meldy_private.live_closed_json(public.live_games),
  meldy_private.live_player_json(public.live_games, uuid), meldy_private.live_host_json(public.live_games),
  meldy_private.live_unchanged(public.live_games, bigint), meldy_private.live_tg_call(uuid, text), meldy_private.live_tg_sync(uuid),
  meldy_private.live_hint(),
  meldy_private.live_host_game(uuid, text, boolean), meldy_private.live_game_of_pin(text),
  meldy_private.live_wardrobe_of(uuid, bigint),
  meldy_private.live_join_as(public.live_games, uuid, bigint, text, text, text, jsonb, text),
  meldy_private.live_player_of(uuid, text, boolean)
  from public, anon, authenticated, service_role;

revoke all on function
  public.live_create(jsonb, jsonb), public.live_host_state(uuid, text, bigint), public.live_next(uuid, text, text),
  public.live_kick(uuid, text, uuid), public.live_end(uuid, text), public.live_join(text, text, text, jsonb),
  public.live_set_look(uuid, text, jsonb), public.live_answer(uuid, text, integer, integer),
  public.live_state(uuid, text, bigint), public.live_review(uuid, text), public.live_wardrobe(), public.live_wardrobe_set(jsonb),
  public.live_tg_post(uuid, bigint),
  public.bot_live_join(text, bigint, text, jsonb, text, text, timestamptz), public.bot_live_post(uuid),
  public.bot_live_posted(uuid, bigint, bigint), public.bot_live_sync(uuid), public.bot_live_setup(text)
  from public, anon, authenticated;
grant execute on function
  public.live_create(jsonb, jsonb), public.live_host_state(uuid, text, bigint), public.live_next(uuid, text, text),
  public.live_kick(uuid, text, uuid), public.live_end(uuid, text), public.live_join(text, text, text, jsonb),
  public.live_set_look(uuid, text, jsonb), public.live_answer(uuid, text, integer, integer),
  public.live_state(uuid, text, bigint), public.live_review(uuid, text), public.live_wardrobe(), public.live_wardrobe_set(jsonb),
  public.live_tg_post(uuid, bigint)
  to anon, authenticated;
grant execute on function
  public.bot_live_join(text, bigint, text, jsonb, text, text, timestamptz), public.bot_live_post(uuid),
  public.bot_live_posted(uuid, bigint, bigint), public.bot_live_sync(uuid), public.bot_live_setup(text)
  to service_role;
