-- bot_support: support through the main Telegram bot, and the server side of «запрос на удаление аккаунта».
-- Repo file: supabase/migrations/20261109090100_bot_support.sql (the owner, 09.11: «поддержку можно сделать через бота,
-- чтобы писали мне через основного бота»; the audit of 07.11: the app had no way to report a problem and none to ask
-- for one's account to be deleted). The function side: supabase/functions/_shared/bot/support.ts.
-- Base: the Telegram bot (20261010120000_telegram_bot.sql: schema bot, bot.config, bot.links) and the container's
-- meldy_private.require_service_role(). Nothing existing is replaced: bot.config gets three nullable columns, the rest is
-- new. Re-runnable (IF NOT EXISTS, OR REPLACE; the checks of the new columns are dropped and made again; the hash is set
-- only while it is null).
-- Check after the apply: supabase/tests/bot_support.sql (read-only). Local rehearsal (never live):
-- supabase/tests/local/bot_support_run.sh (bot_support_behaviour.sql). Rollback:
-- supabase/rollback/20261109090100_bot_support_down.sql. Release order: this file, then the function `telegram` (until
-- then messages cannot be written: the bot has no /support), then the site's page «Данные и приватность».
--
-- What it adds:
--   1. bot.config.support_username_hash / support_chat_id / support_tg_user_id — where support goes. Support always
--      goes to the owner's own Telegram account, named by its username; the username is NOWHERE in the repository:
--      only its sha256 (lowercased, without «@», hex) is here. A bot cannot write to a person first, so the owner
--      presses «Старт» in the bot once: while no chat is bound, the bot shows the database each private sender's
--      username (public.bot_support_owner), the database compares the hash itself and binds that chat and that
--      Telegram user id, once. After that the binding never moves by itself: the owner is the Telegram user id, not
--      the username (whoever carries the username later gets nothing and cannot claim). A rebind is a manual change:
--      set support_chat_id and support_tg_user_id to null (docs/telegram-bot.md, «Поддержка через бота»).
--   2. bot.support_messages — the queue to the owner's chat: a person's message (kind message: the Telegram chat it came
--      from, the name and @username Telegram gave, the Meldy account when that Telegram is linked, the text ≤ 2 000
--      characters), an account deletion request (kind deletion) or its cancel (deletion_cancel: the account id only).
--      sent_at / owner_chat_id / owner_message_id: the message the bot sent to the owner for it (the owner replies to
--      that message); claimed_at: the tick's lease; error: a row Telegram refused for good (a short code); answered_at:
--      the owner's first reply went out. Row security on, no policy, no grant: only the functions below reach it.
--      Rows older than 90 days are deleted (bot.support_cleanup, run by every claim of the tick). T1's bot.cleanup is
--      left as it is, as every package after T1 leaves it: each cleans its own rows from its own tick function.
--   3. public.account_deletion_requests — one row per account: requested_at, cancelled_at. Row security on, no policy:
--      the three functions of section 6 are the only way in.
--   4. For the bot (service role; each starts with meldy_private.require_service_role()):
--      public.bot_support_add(p_tg_user_id, p_chat_id, p_message_id, p_text, p_name, p_username, p_now) →
--        {status: stored | empty | too_long | slow_down (limit: hour | day) | private_only}: a private chat only; the
--        same Telegram message kept once (a redelivered update); at most 5 an hour and 20 a day per chat.
--      public.bot_support_owner(p_tg_user_id, p_chat_id, p_username) → {status: claimed | set | no | off}: the one-time
--        claim. claimed: this call bound the chat (the bot says its one line); set: a chat is bound already (nothing
--        changes, whoever asks); no: not the owner's username, not a private chat, or no username; off: no hash is set.
--      public.bot_support_claim(p_limit, p_now) → {status: no_chat, waiting} while no chat is bound (the rows wait) |
--        {status: ok, chat_id, tz, rows: [{id, kind: message, name, username, linked, text} |
--        {id, kind: deletion | deletion_cancel, user_id, at}]}: the oldest waiting rows, at most p_limit (1–50), under
--        a lease of 50 seconds (a row not marked sent comes again: at least once).
--      public.bot_support_done(p_id, p_chat_id, p_message_id, p_error, p_now) → {status: ok | gone}: sent (the owner's
--        chat and message id) or closed with a short code (a row Telegram will never take).
--      public.bot_support_reply(p_tg_user_id, p_chat_id, p_message_id) → {status: none} for anyone but the bound
--        Telegram in the bound chat | {status: gone} (no row has that message) | {status: service} (a deletion row:
--        nobody to answer) | {status: ok, id, chat_id} (the sender's chat). Reads only.
--      public.bot_support_answered(p_id, p_now) → {status: ok | gone}: the owner's reply went out.
--   5. For the signed-in user (authenticated only): public.account_deletion_request() → {requested_at}; idempotent
--      while a request is open (the same requested_at); after a cancel a new request sets a new time.
--      public.account_deletion_cancel() → {requested_at: null}. public.account_deletion_status() →
--      {requested_at: … | null}. A request and a cancel each put a row into bot.support_messages, so the owner hears of
--      it through the tick's step «support».
-- Bot functions answer every expected outcome with a status. Errors (SQLSTATE): 42501 without the service role; 22023 a
-- call the function never means (a limit out of 1–50, a done with neither or both of a message and a code). Site
-- functions: 28000 not signed in; MA001 more than 5 deletion requests in 24 hours (each one writes to the owner's chat).
-- No name, username, text or id of a person is in this file; nothing here is logged.
set local lock_timeout = '2s';

do $do$
begin
  if pg_catalog.to_regclass('bot.config') is null or pg_catalog.to_regclass('bot.links') is null
     or pg_catalog.to_regprocedure('meldy_private.require_service_role()') is null then
    raise exception 'the base is expected: the Telegram bot (20261010120000_telegram_bot.sql) and the exam container';
  end if;
end;
$do$;

-- 1. Where support goes (bot.config, one row).
alter table bot.config add column if not exists support_username_hash text;
alter table bot.config add column if not exists support_chat_id bigint;
alter table bot.config add column if not exists support_tg_user_id bigint;
alter table bot.config drop constraint if exists config_support_hash_check;
alter table bot.config add constraint config_support_hash_check
  check (support_username_hash is null or support_username_hash ~ '^[0-9a-f]{64}$');
alter table bot.config drop constraint if exists config_support_ids_check;
alter table bot.config add constraint config_support_ids_check
  check ((support_chat_id is null) = (support_tg_user_id is null)
         and (support_chat_id is null or (support_chat_id > 0 and support_tg_user_id > 0)));
comment on column bot.config.support_username_hash is 'sha256 (hex) of the owner''s Telegram username, lowercased, without «@»: who may claim the support chat. The username itself is stored nowhere.';
comment on column bot.config.support_chat_id is 'The chat support messages go to: bound once by bot_support_owner; null: nothing is bound, the queue waits. Set both ids to null to bind again.';
comment on column bot.config.support_tg_user_id is 'The Telegram user whose replies in that chat are relayed: the owner, by id (never by username once bound).';
insert into bot.config (id) values (1) on conflict (id) do nothing;
-- Set once: a hash changed by hand later is kept.
update bot.config c
   set support_username_hash = '86a3887707f4aaa3021731a3c4fb121bf76dddbe26d20dda9a81685748a60604'
 where c.id = 1 and c.support_username_hash is null;

-- 2. The queue to the owner's chat.
create table if not exists bot.support_messages (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  kind text not null,
  user_id uuid references auth.users(id) on delete cascade,
  chat_id bigint,
  tg_message_id bigint,
  tg_name text,
  tg_username text,
  text text,
  claimed_at timestamptz,
  sent_at timestamptz,
  owner_chat_id bigint,
  owner_message_id bigint,
  error text,
  answered_at timestamptz,
  constraint support_messages_kind_check check (kind in ('message', 'deletion', 'deletion_cancel')),
  constraint support_messages_message_check check (kind <> 'message'
    or (chat_id is not null and chat_id > 0 and tg_message_id is not null and text is not null
        and char_length(text) between 1 and 2000)),
  constraint support_messages_service_check check (kind = 'message'
    or (user_id is not null and chat_id is null and tg_message_id is null and tg_name is null and tg_username is null
        and text is null)),
  constraint support_messages_name_check check (tg_name is null or char_length(tg_name) between 1 and 128),
  constraint support_messages_username_check check (tg_username is null or tg_username ~ '^[A-Za-z0-9_]{4,32}$'),
  constraint support_messages_sent_check check ((sent_at is null) = (owner_message_id is null)
                                                and (owner_message_id is null) = (owner_chat_id is null)),
  constraint support_messages_error_check check (error is null or (error ~ '^[a-z0-9_]{1,32}$' and sent_at is null)),
  constraint support_messages_answered_check check (answered_at is null or (kind = 'message' and sent_at is not null))
);
-- A Telegram message is kept once (a redelivered update); the owner's reply finds its row by the message replied to.
create unique index if not exists support_messages_message_key on bot.support_messages (chat_id, tg_message_id)
  where kind = 'message';
create unique index if not exists support_messages_owner_key on bot.support_messages (owner_chat_id, owner_message_id)
  where owner_message_id is not null;
create index if not exists support_messages_waiting_idx on bot.support_messages (id) where sent_at is null and error is null;
create index if not exists support_messages_chat_idx on bot.support_messages (chat_id, created_at) where kind = 'message';
create index if not exists support_messages_user_idx on bot.support_messages (user_id, created_at);
create index if not exists support_messages_created_idx on bot.support_messages (created_at);
alter table bot.support_messages enable row level security;
comment on table bot.support_messages is 'The queue to the owner''s Telegram chat: people''s support messages (their own words, kept 90 days) and account deletion requests; sent_at / owner_message_id once the tick delivered a row, answered_at once the owner replied.';

-- 3. Account deletion requests: one row per account. An open request has cancelled_at null.
create table if not exists public.account_deletion_requests (
  user_id uuid primary key references auth.users(id) on delete cascade,
  requested_at timestamptz not null default now(),
  cancelled_at timestamptz
);
alter table public.account_deletion_requests enable row level security;
comment on table public.account_deletion_requests is 'Account deletion requests: one row per account (requested_at; cancelled_at when taken back). Reached only through account_deletion_request / _cancel / _status.';

-- 4. Housekeeping: support rows are kept 90 days, sent or not, answered or not. Bounded; run by every claim of the tick.
create or replace function bot.support_cleanup(p_now timestamptz)
returns integer
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_n integer;
begin
  delete from bot.support_messages m
   where m.id in (select x.id from bot.support_messages x where x.created_at < p_now - interval '90 days' limit 5000);
  get diagnostics v_n = row_count;
  return v_n;
end;
$fn$;

-- 5. The bot (service role).
-- 5a. A person's message: a reply to the bot's prompt in a private chat (support.ts decides that; here the chat must be
--     a private one: its id is the sender's). The same Telegram message is kept once, whatever the bot retries. The
--     limits per chat: 5 in an hour, 20 in 24 hours. The account is the one this Telegram is linked to, if any; the
--     sender is not marked as seen (writing to support is not studying). p_now is for tests.
create or replace function public.bot_support_add(p_tg_user_id bigint, p_chat_id bigint, p_message_id bigint, p_text text,
                                                  p_name text default null, p_username text default null,
                                                  p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_text text := pg_catalog.btrim(coalesce(p_text, ''), E' \t\n\r');
begin
  perform meldy_private.require_service_role();
  if p_tg_user_id is null or p_chat_id is null or p_message_id is null or p_tg_user_id <= 0 or p_chat_id <> p_tg_user_id then
    return pg_catalog.jsonb_build_object('status', 'private_only');
  end if;
  -- One chat's messages in turn: the limits hold under concurrency and a redelivery never doubles a row.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bot.support:' || p_chat_id::text, 0));
  if exists (select 1 from bot.support_messages m
              where m.kind = 'message' and m.chat_id = p_chat_id and m.tg_message_id = p_message_id) then
    return pg_catalog.jsonb_build_object('status', 'stored');
  end if;
  if v_text = '' then
    return pg_catalog.jsonb_build_object('status', 'empty');
  end if;
  if pg_catalog.char_length(v_text) > 2000 then
    return pg_catalog.jsonb_build_object('status', 'too_long');
  end if;
  if (select pg_catalog.count(*) from bot.support_messages m
       where m.kind = 'message' and m.chat_id = p_chat_id and m.created_at > v_now - interval '1 hour') >= 5 then
    return pg_catalog.jsonb_build_object('status', 'slow_down', 'limit', 'hour');
  end if;
  if (select pg_catalog.count(*) from bot.support_messages m
       where m.kind = 'message' and m.chat_id = p_chat_id and m.created_at > v_now - interval '24 hours') >= 20 then
    return pg_catalog.jsonb_build_object('status', 'slow_down', 'limit', 'day');
  end if;
  insert into bot.support_messages (created_at, kind, user_id, chat_id, tg_message_id, tg_name, tg_username, text)
  values (v_now, 'message',
          (select l.user_id from bot.links l where l.tg_user_id = p_tg_user_id and l.unlinked_at is null),
          p_chat_id, p_message_id,
          nullif(pg_catalog.left(pg_catalog.btrim(pg_catalog.regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')), 128), ''),
          case when p_username ~ '^[A-Za-z0-9_]{4,32}$' then p_username end,
          v_text);
  return pg_catalog.jsonb_build_object('status', 'stored');
end;
$fn$;
comment on function public.bot_support_add(bigint, bigint, bigint, text, text, text, timestamptz) is 'Support (service role): keeps a person''s message from a private chat → {status: stored | empty | too_long | slow_down (limit hour | day) | private_only}. A Telegram message is kept once; 5 an hour, 20 a day per chat.';

-- 5b. The one-time claim of the owner's chat. The bot shows it a private chat's sender while it does not know that a
--     chat is bound; the comparison is here: sha256 of the lowercased username against bot.config.support_username_hash.
--     Once the ids are set nothing changes them (set, whoever asks): the owner is then a Telegram user id, and a
--     username that moved to someone else binds nothing. Read first without a lock: the common answers touch no row.
create or replace function public.bot_support_owner(p_tg_user_id bigint, p_chat_id bigint, p_username text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_hash text;
  v_chat bigint;
begin
  perform meldy_private.require_service_role();
  select c.support_username_hash, c.support_chat_id into v_hash, v_chat from bot.config c where c.id = 1;
  if v_chat is not null then
    return pg_catalog.jsonb_build_object('status', 'set');
  end if;
  if v_hash is null then
    return pg_catalog.jsonb_build_object('status', 'off');
  end if;
  if p_tg_user_id is null or p_chat_id is null or p_tg_user_id <= 0 or p_chat_id <> p_tg_user_id
     or p_username is null or p_username !~ '^[A-Za-z0-9_]{4,32}$'
     or pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(p_username), 'UTF8')), 'hex') <> v_hash then
    return pg_catalog.jsonb_build_object('status', 'no');
  end if;
  update bot.config c
     set support_chat_id = p_chat_id, support_tg_user_id = p_tg_user_id, updated_at = pg_catalog.now()
   where c.id = 1 and c.support_chat_id is null and c.support_tg_user_id is null and c.support_username_hash = v_hash;
  -- Not found: another call bound a chat between the read and the update.
  return pg_catalog.jsonb_build_object('status', case when found then 'claimed' else 'set' end);
end;
$fn$;
comment on function public.bot_support_owner(bigint, bigint, text) is 'Support (service role): the one-time claim of the owner''s chat by the username''s sha256 → {status: claimed | set | no | off}. Once bound, nothing here changes it.';

-- 5c. The tick's step «support»: the oldest waiting rows for the owner's chat, at most p_limit, each under a lease of
--     50 seconds (longer than a tick works, shorter than the minute between ticks): two ticks at once never take the same
--     row, and a row the bot did not mark (bot_support_done) comes again. While no chat is bound: no_chat and how many
--     wait, nothing is taken. tz: the zone of a deletion request's day — the owner's link when that Telegram is linked,
--     else Europe/Minsk. Rows older than 90 days go first. p_now is for tests.
create or replace function public.bot_support_claim(p_limit integer default 10, p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_chat bigint;
  v_tg bigint;
  v_rows jsonb;
begin
  perform meldy_private.require_service_role();
  if p_limit is null or p_limit < 1 or p_limit > 50 then
    raise exception 'invalid limit' using errcode = '22023';
  end if;
  perform bot.support_cleanup(v_now);
  select c.support_chat_id, c.support_tg_user_id into v_chat, v_tg from bot.config c where c.id = 1;
  if v_chat is null then
    return pg_catalog.jsonb_build_object('status', 'no_chat', 'waiting',
      (select pg_catalog.count(*) from bot.support_messages m where m.sent_at is null and m.error is null));
  end if;
  with picked as (
    select m.id from bot.support_messages m
     where m.sent_at is null and m.error is null
       and (m.claimed_at is null or m.claimed_at <= v_now - interval '50 seconds')
     order by m.id
     limit p_limit
       for update skip locked
  ), taken as (
    update bot.support_messages m set claimed_at = v_now
      from picked p
     where m.id = p.id
    returning m.id, m.kind, m.user_id, m.tg_name, m.tg_username, m.text, m.created_at
  )
  select coalesce(pg_catalog.jsonb_agg(
           case when t.kind = 'message'
                then pg_catalog.jsonb_build_object('id', t.id, 'kind', t.kind, 'name', t.tg_name, 'username', t.tg_username,
                                                   'linked', t.user_id is not null, 'text', t.text)
                else pg_catalog.jsonb_build_object('id', t.id, 'kind', t.kind, 'user_id', t.user_id, 'at', t.created_at)
           end order by t.id), '[]'::jsonb)
    into v_rows
    from taken t;
  return pg_catalog.jsonb_build_object(
    'status', 'ok', 'chat_id', v_chat,
    'tz', coalesce((select l.tz from bot.links l where l.tg_user_id = v_tg and l.unlinked_at is null), 'Europe/Minsk'),
    'rows', v_rows);
end;
$fn$;
comment on function public.bot_support_claim(integer, timestamptz) is 'Support (service role): the tick''s step → {status: no_chat, waiting} | {status: ok, chat_id, tz, rows}: the oldest waiting rows under a 50-second lease. Deletes rows older than 90 days.';

-- 5d. What became of a claimed row: sent (the owner's chat and the message there: a reply to it finds the row) or closed
--     with a short code (Telegram refused it for good: tg_400, bad_row). gone: no such waiting row.
create or replace function public.bot_support_done(p_id bigint, p_chat_id bigint default null, p_message_id bigint default null,
                                                   p_error text default null, p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
begin
  perform meldy_private.require_service_role();
  if p_id is null or (p_chat_id is null) <> (p_message_id is null) or (p_message_id is null) = (p_error is null)
     or (p_error is not null and p_error !~ '^[a-z0-9_]{1,32}$') then
    raise exception 'a sent row has a chat and a message, a closed one a short code' using errcode = '22023';
  end if;
  if p_error is null then
    update bot.support_messages m
       set sent_at = v_now, owner_chat_id = p_chat_id, owner_message_id = p_message_id
     where m.id = p_id and m.sent_at is null and m.error is null;
  else
    update bot.support_messages m set error = p_error
     where m.id = p_id and m.sent_at is null and m.error is null;
  end if;
  return pg_catalog.jsonb_build_object('status', case when found then 'ok' else 'gone' end);
end;
$fn$;
comment on function public.bot_support_done(bigint, bigint, bigint, text, timestamptz) is 'Support (service role): a claimed row was sent (the owner''s chat and message id) or is closed with a short code → {status: ok | gone}.';

-- 5e. A reply in a private chat to a message that reads as one of the tick's: whose is it? none unless the replier is
--     the bound Telegram user in the bound chat — the bot then does nothing of support. Else the row of that message:
--     gone (deleted after 90 days, or never a row's message), service (a deletion request: nobody to answer), or ok with
--     the sender's chat. Reads only.
create or replace function public.bot_support_reply(p_tg_user_id bigint, p_chat_id bigint, p_message_id bigint)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_m bot.support_messages%rowtype;
begin
  perform meldy_private.require_service_role();
  if p_tg_user_id is null or p_chat_id is null or p_message_id is null
     or not exists (select 1 from bot.config c
                     where c.id = 1 and c.support_tg_user_id = p_tg_user_id and c.support_chat_id = p_chat_id) then
    return pg_catalog.jsonb_build_object('status', 'none');
  end if;
  select m.* into v_m from bot.support_messages m
   where m.owner_chat_id = p_chat_id and m.owner_message_id = p_message_id;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'gone');
  end if;
  if v_m.kind <> 'message' then
    return pg_catalog.jsonb_build_object('status', 'service', 'id', v_m.id);
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'id', v_m.id, 'chat_id', v_m.chat_id);
end;
$fn$;
comment on function public.bot_support_reply(bigint, bigint, bigint) is 'Support (service role): the row a reply answers → {status: none} (not the owner in the owner''s chat) | {status: gone} | {status: service} | {status: ok, id, chat_id}. Reads only.';

-- 5f. The owner's reply reached the sender: the row is answered (by the first reply; later ones change nothing).
create or replace function public.bot_support_answered(p_id bigint, p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
begin
  perform meldy_private.require_service_role();
  update bot.support_messages m set answered_at = coalesce(m.answered_at, v_now)
   where m.id = p_id and m.kind = 'message' and m.sent_at is not null;
  return pg_catalog.jsonb_build_object('status', case when found then 'ok' else 'gone' end);
end;
$fn$;
comment on function public.bot_support_answered(bigint, timestamptz) is 'Support (service role): the owner''s reply went out → {status: ok | gone}; answered_at keeps the first.';

-- 6. The site (the signed-in user's own request; the page «Данные и приватность»).
-- 6a. «Удалить аккаунт»: an open request answers with its own time (asking twice changes nothing); a new one, also after
--     a cancel, takes the moment of the call and tells the owner (a row of kind deletion). At most 5 new requests in 24
--     hours: each writes to the owner's chat. The clock is the call's (clock_timestamp), not the transaction's.
create or replace function public.account_deletion_request()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_at timestamptz;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  -- One account's requests in turn.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account_deletion:' || v_uid::text, 0));
  select r.requested_at into v_at from public.account_deletion_requests r
   where r.user_id = v_uid and r.cancelled_at is null;
  if found then
    return pg_catalog.jsonb_build_object('requested_at', v_at);
  end if;
  if (select pg_catalog.count(*) from bot.support_messages m
       where m.user_id = v_uid and m.kind = 'deletion' and m.created_at > v_now - interval '24 hours') >= 5 then
    raise exception 'too many deletion requests: try again tomorrow' using errcode = 'MA001';
  end if;
  insert into public.account_deletion_requests as r (user_id, requested_at, cancelled_at) values (v_uid, v_now, null)
  on conflict (user_id) do update set requested_at = excluded.requested_at, cancelled_at = null;
  insert into bot.support_messages (created_at, kind, user_id) values (v_now, 'deletion', v_uid);
  return pg_catalog.jsonb_build_object('requested_at', v_now);
end;
$fn$;
comment on function public.account_deletion_request() is 'The signed-in user asks for their account to be deleted → {requested_at}. Idempotent while a request is open; tells the owner through the bot.';

-- 6b. «Отменить»: the open request is taken back and the owner is told (a row of kind deletion_cancel); without an open
--     request nothing changes.
create or replace function public.account_deletion_cancel()
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('account_deletion:' || v_uid::text, 0));
  update public.account_deletion_requests r set cancelled_at = v_now
   where r.user_id = v_uid and r.cancelled_at is null;
  if found then
    insert into bot.support_messages (created_at, kind, user_id) values (v_now, 'deletion_cancel', v_uid);
  end if;
  return pg_catalog.jsonb_build_object('requested_at', null);
end;
$fn$;
comment on function public.account_deletion_cancel() is 'The signed-in user takes their deletion request back → {requested_at: null}; tells the owner through the bot.';

-- 6c. The page's state: the open request's time, or null.
create or replace function public.account_deletion_status()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  return pg_catalog.jsonb_build_object('requested_at',
    (select r.requested_at from public.account_deletion_requests r where r.user_id = v_uid and r.cancelled_at is null));
end;
$fn$;
comment on function public.account_deletion_status() is 'The signed-in user''s open deletion request → {requested_at: … | null}.';

-- 7. Grants (re-runnable). Supabase gives new public tables and functions to anon, authenticated and service_role,
--    PostgreSQL gives every new function to PUBLIC: taken back here. The bot's functions are the service role's, the
--    three account functions are authenticated's only, the two tables are nobody's (the functions run as their owner).
--    Safety does not depend on it: the bot's functions check the service role first, the account functions check
--    auth.uid(), schema bot has no USAGE for clients and both tables have row security without a policy.
revoke all on table bot.support_messages from public, anon, authenticated, service_role;
revoke all on table public.account_deletion_requests from public, anon, authenticated, service_role;
revoke all on function bot.support_cleanup(timestamptz) from public, anon, authenticated, service_role;
revoke all on function public.bot_support_add(bigint, bigint, bigint, text, text, text, timestamptz),
  public.bot_support_owner(bigint, bigint, text), public.bot_support_claim(integer, timestamptz),
  public.bot_support_done(bigint, bigint, bigint, text, timestamptz), public.bot_support_reply(bigint, bigint, bigint),
  public.bot_support_answered(bigint, timestamptz) from public, anon, authenticated;
grant execute on function public.bot_support_add(bigint, bigint, bigint, text, text, text, timestamptz),
  public.bot_support_owner(bigint, bigint, text), public.bot_support_claim(integer, timestamptz),
  public.bot_support_done(bigint, bigint, bigint, text, timestamptz), public.bot_support_reply(bigint, bigint, bigint),
  public.bot_support_answered(bigint, timestamptz) to service_role;
revoke all on function public.account_deletion_request(), public.account_deletion_cancel(), public.account_deletion_status()
  from public, anon, service_role;
grant execute on function public.account_deletion_request(), public.account_deletion_cancel(), public.account_deletion_status()
  to authenticated;
