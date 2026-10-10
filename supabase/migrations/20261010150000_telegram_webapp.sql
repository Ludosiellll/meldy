-- telegram_webapp
-- Repo file: supabase/migrations/20261010150000_telegram_webapp.sql (Meldy as a Telegram Mini App, 2026-10-10).
-- Spec: meldy-notes/10_Project/Telegram_Mini_App_Spec_2026-10-10.md (§2 decisions 6–10, 15; §3; §4).
-- Needs 20261010120000_telegram_bot.sql (schema bot, bot.links, bot.active_link, bot.tz_ok) and the container's
-- meldy_private.require_service_role(). Rollback: supabase/rollback/20261010150000_telegram_webapp_down.sql. Local
-- rehearsal (never live): supabase/tests/local/telegram_webapp.sql, run by supabase/tests/local/telegram_bot_run.sh
-- (stage WA). The read-only contract supabase/tests/telegram_bot.sql carries this package as «WA» (checks 90–99).
--
-- The site's /tg page signs a student in through Telegram. The Edge Function `telegram` checks the signature of
-- Telegram's initData itself (HMAC with the bot token, auth_date within an hour), then asks:
--   * bot_webapp_session(Telegram user, sha256 of the initData's hash, auth_date): one use per initData → the Meldy
--     account linked to this Telegram and its e-mail, for the one-time sign-in the function asks Supabase Auth for;
--   * bot_webapp_link(Telegram user, the account of the user's JWT — checked by Auth —, sha256 of the hash, auth_date,
--     language, zone): the student signed in by e-mail inside the Mini App → this Telegram is linked to that account,
--     once per initData. A Telegram linked to another account is not taken over (linked_elsewhere); this account's
--     earlier Telegram is unlinked (the newest link wins, as bot_link_claim; replaced_chat_id names its chat for M6).
-- bot.webapp_uses keeps the uses for two hours (sha256 of the hash only, never initData): a replay within the
-- initData's hour is refused, and the brake counts them (30 sessions and 10 links an hour per Telegram, 10 links an
-- hour per account). The user always comes from bot.links (session) or from the JWT the function checked (link).
-- Every expected outcome is a status. Errors: 42501 (without the service role), 22023 (a call the function never
-- means). Additive and re-runnable (IF NOT EXISTS, OR REPLACE); the grants of section 3 follow T1's revokes file.

-- 1. The uses (spec §2 decision 8). init_hash = sha256 hex of the initData's own `hash` (itself an HMAC; the hash does
--    not depend on the order of the fields, so a reordered replay meets the same key); purpose = session | link;
--    user_id = the account a link was made for (a link's replay by the same pair answers linked again); auth_date =
--    when Telegram signed the data; used_at = when it was used.
create table if not exists bot.webapp_uses (
  init_hash text not null,
  purpose text not null,
  tg_user_id bigint not null,
  user_id uuid references auth.users(id) on delete cascade,
  auth_date timestamptz not null,
  used_at timestamptz not null default now(),
  primary key (init_hash, purpose),
  constraint webapp_uses_hash_check check (init_hash ~ '^[0-9a-f]{64}$'),
  constraint webapp_uses_purpose_check check (purpose in ('session', 'link')),
  constraint webapp_uses_tg_check check (tg_user_id > 0),
  constraint webapp_uses_link_user_check check ((purpose = 'link') = (user_id is not null))
);
create index if not exists webapp_uses_tg_idx on bot.webapp_uses (tg_user_id, purpose, used_at);
create index if not exists webapp_uses_user_idx on bot.webapp_uses (user_id, used_at) where user_id is not null;
create index if not exists webapp_uses_used_idx on bot.webapp_uses (used_at);
alter table bot.webapp_uses enable row level security;
comment on table bot.webapp_uses is 'Mini App sign-ins and links by Telegram initData: one use each (sha256 of its hash), kept two hours, for replays and the brake.';

-- 2. The bot (service role).
-- 2a. POST /telegram/webapp/session, after the function checked the signature. linked (+ user_id, email): the account
--     linked to this Telegram, for a one-time sign-in; unlinked: no active link (the Mini App asks for an e-mail
--     sign-in); replayed: this initData was used before; slow_down: 30 an hour for this Telegram; no_email: the
--     account cannot sign in by e-mail (none, deleted, banned). Opening the Mini App counts as the user's action in the
--     bot (last_seen_at ends K2's silence). Uses older than two hours go first (at most 200 a call).
create or replace function public.bot_webapp_session(p_tg_user_id bigint, p_init_hash text, p_auth_date timestamptz,
                                                     p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_link bot.links;
  v_email text;
begin
  perform meldy_private.require_service_role();
  if p_tg_user_id is null or p_tg_user_id <= 0 or p_init_hash is null or p_init_hash !~ '^[0-9a-f]{64}$'
     or p_auth_date is null then
    raise exception 'bad mini app session' using errcode = '22023';
  end if;
  -- One Telegram's requests in turn: the brake and the replay hold under concurrency.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bot.webapp:' || p_tg_user_id::text, 0));
  delete from bot.webapp_uses u
   using (select x.init_hash, x.purpose from bot.webapp_uses x where x.used_at < v_now - interval '2 hours' limit 200) old
   where u.init_hash = old.init_hash and u.purpose = old.purpose;
  if (select pg_catalog.count(*) from bot.webapp_uses u
       where u.tg_user_id = p_tg_user_id and u.purpose = 'session' and u.used_at > v_now - interval '1 hour') >= 30 then
    return pg_catalog.jsonb_build_object('status', 'slow_down');
  end if;
  insert into bot.webapp_uses (init_hash, purpose, tg_user_id, auth_date, used_at)
  values (p_init_hash, 'session', p_tg_user_id, p_auth_date, v_now)
  on conflict (init_hash, purpose) do nothing;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'replayed');
  end if;
  v_link := bot.active_link(p_tg_user_id);
  if v_link.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  update bot.links l set last_seen_at = v_now where l.id = v_link.id;
  select u.email into v_email from auth.users u
   where u.id = v_link.user_id and u.deleted_at is null and (u.banned_until is null or u.banned_until <= v_now);
  if v_email is null or pg_catalog.btrim(v_email) = '' then
    return pg_catalog.jsonb_build_object('status', 'no_email');
  end if;
  return pg_catalog.jsonb_build_object('status', 'linked', 'user_id', v_link.user_id, 'email', v_email);
end;
$fn$;
comment on function public.bot_webapp_session(bigint, text, timestamptz, timestamptz) is 'Telegram Mini App (service role): one use of a checked initData → {status: linked, user_id, email} | unlinked | replayed | slow_down | no_email.';

-- 2b. POST /telegram/webapp/link, after the function checked the signature and the user's JWT. linked (+ again: the
--     same pair was already linked, nothing new to say in the chat; + replaced_chat_id: the chat of this account's
--     earlier Telegram, for M6); linked_elsewhere: this Telegram is linked to another account (never taken over here:
--     a captured initData could otherwise move it); replayed: this initData linked before (another account, or the
--     link is gone); slow_down: 10 an hour for this Telegram or this account. The zone (the browser's) and the language
--     go to a new link; an existing link of the same pair takes them too.
create or replace function public.bot_webapp_link(p_tg_user_id bigint, p_user_id uuid, p_init_hash text,
                                                  p_auth_date timestamptz, p_lang text default null,
                                                  p_tz text default null, p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_use bot.webapp_uses%rowtype;
  v_row bot.links%rowtype;
  v_mine bot.links%rowtype;
  v_theirs bot.links%rowtype;
  v_lang text;
  v_tz text;
  v_replaced bigint;
begin
  perform meldy_private.require_service_role();
  if p_tg_user_id is null or p_tg_user_id <= 0 or p_user_id is null or p_init_hash is null
     or p_init_hash !~ '^[0-9a-f]{64}$' or p_auth_date is null
     or not exists (select 1 from auth.users u where u.id = p_user_id) then
    raise exception 'bad mini app link' using errcode = '22023';
  end if;
  -- The Telegram and the account in turn (always in this order: two crossed links never deadlock).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bot.webapp:' || p_tg_user_id::text, 0));
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('bot.webapp_user:' || p_user_id::text, 0));
  if (select pg_catalog.count(*) from bot.webapp_uses u
       where u.tg_user_id = p_tg_user_id and u.purpose = 'link' and u.used_at > v_now - interval '1 hour') >= 10
     or (select pg_catalog.count(*) from bot.webapp_uses u
          where u.user_id = p_user_id and u.purpose = 'link' and u.used_at > v_now - interval '1 hour') >= 10 then
    return pg_catalog.jsonb_build_object('status', 'slow_down');
  end if;
  select u.* into v_use from bot.webapp_uses u where u.init_hash = p_init_hash and u.purpose = 'link';
  if found then
    if v_use.user_id = p_user_id and v_use.tg_user_id = p_tg_user_id
       and exists (select 1 from bot.links l
                    where l.tg_user_id = p_tg_user_id and l.user_id = p_user_id and l.unlinked_at is null) then
      return pg_catalog.jsonb_build_object('status', 'linked', 'again', true, 'replaced_chat_id', null);
    end if;
    return pg_catalog.jsonb_build_object('status', 'replayed');
  end if;
  insert into bot.webapp_uses (init_hash, purpose, tg_user_id, user_id, auth_date, used_at)
  values (p_init_hash, 'link', p_tg_user_id, p_user_id, p_auth_date, v_now);
  v_lang := case when p_lang ~ '^[A-Za-z0-9-]{2,16}$' then p_lang end;
  v_tz := case when bot.tz_ok(p_tz) then p_tz end;

  -- Both sides' active links, locked in id order (as bot_link_claim).
  for v_row in
    select l.* from bot.links l
     where l.unlinked_at is null and (l.user_id = p_user_id or l.tg_user_id = p_tg_user_id)
     order by l.id
       for update
  loop
    if v_row.user_id = p_user_id then
      v_mine := v_row;
    end if;
    if v_row.tg_user_id = p_tg_user_id then
      v_theirs := v_row;
    end if;
  end loop;
  if v_theirs.id is not null and v_theirs.user_id <> p_user_id then
    return pg_catalog.jsonb_build_object('status', 'linked_elsewhere');
  end if;
  if v_theirs.id is not null then
    update bot.links l
       set chat_id = p_tg_user_id, tg_lang = coalesce(v_lang, l.tg_lang), tz = coalesce(v_tz, l.tz),
           last_seen_at = v_now, updated_at = v_now
     where l.id = v_theirs.id;
    return pg_catalog.jsonb_build_object('status', 'linked', 'again', true, 'replaced_chat_id', null);
  end if;
  if v_mine.id is not null then
    update bot.links l set unlinked_at = v_now, updated_at = v_now where l.id = v_mine.id;
    v_replaced := nullif(v_mine.chat_id, p_tg_user_id);
  end if;
  -- A private chat's id is the user's id (bot_link_claim takes only such chats).
  insert into bot.links (user_id, tg_user_id, chat_id, tg_lang, tz, linked_at, last_seen_at, updated_at)
  values (p_user_id, p_tg_user_id, p_tg_user_id, v_lang, coalesce(v_tz, 'Europe/Minsk'), v_now, v_now, v_now);
  return pg_catalog.jsonb_build_object('status', 'linked', 'again', false, 'replaced_chat_id', v_replaced);
end;
$fn$;
comment on function public.bot_webapp_link(bigint, uuid, text, timestamptz, text, text, timestamptz) is 'Telegram Mini App (service role): link this Telegram to the account of a checked JWT, once per initData → {status: linked, again, replaced_chat_id} | linked_elsewhere | replayed | slow_down.';

-- 3. Grants, as T1's revokes file does for its objects (re-runnable). Supabase gives new public functions to anon and
--    authenticated, PostgreSQL gives every new function to PUBLIC: taken back here. Safety does not depend on it:
--    both functions check the service role first, schema bot has no USAGE for clients and bot.webapp_uses has row
--    security without a policy.
revoke all on table bot.webapp_uses from public, anon, authenticated;
revoke all on function public.bot_webapp_session(bigint, text, timestamptz, timestamptz),
  public.bot_webapp_link(bigint, uuid, text, timestamptz, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.bot_webapp_session(bigint, text, timestamptz, timestamptz),
  public.bot_webapp_link(bigint, uuid, text, timestamptz, text, text, timestamptz)
  to service_role;
