-- telegram_webapp
-- Repo file: supabase/migrations/20261010150000_telegram_webapp.sql (Meldy as a Telegram Mini App, 2026-10-10).
-- Spec: meldy-notes/10_Project/Telegram_Mini_App_Spec_2026-10-10.md (§2 decisions 6, 8, 9, 15; §3; §4; «Проверка
-- безопасности 2026-10-11»).
-- Needs 20261010120000_telegram_bot.sql (schema bot, bot.links, bot.active_link, bot.tz_ok) and the container's
-- meldy_private.require_service_role(). Rollback: supabase/rollback/20261010150000_telegram_webapp_down.sql. Local
-- rehearsal (never live): supabase/tests/local/telegram_webapp.sql, run by supabase/tests/local/telegram_bot_run.sh
-- (stage WA). The read-only contract supabase/tests/telegram_bot.sql carries this package as «WA» (checks 90–99).
--
-- The site's /tg page signs a student in through Telegram. The Edge Function `telegram` checks the signature of
-- Telegram's initData itself (HMAC with the bot token, auth_date within an hour), then asks
-- bot_webapp_session(Telegram user, sha256 of the initData's hash, auth_date): one use per initData → the Meldy account
-- linked to this Telegram and its e-mail, for the one-time sign-in the function asks Supabase Auth for. The account
-- always comes from bot.links, which only the bot's /start L<code> fills (bot_link_claim).
-- Nothing here links a Telegram. A valid initData proves only that its Telegram user opened the Mini App, and anyone
-- can put their own fresh one into someone else's browser (a link to /tg with it in the address); the in-page link of
-- the first draft (bot_webapp_link) would have handed such a Telegram the account signed in there, so it was removed by
-- the security review of 2026-10-11, before this file was ever applied.
-- bot.webapp_uses keeps the uses for two hours (sha256 of the hash only, never initData): a replay within the
-- initData's hour is refused, and the brake counts them (30 sessions an hour per Telegram).
-- Every expected outcome is a status. Errors: 42501 (without the service role), 22023 (a call the function never
-- means). Additive and re-runnable (IF NOT EXISTS, OR REPLACE); the grants of section 3 follow T1's revokes file.

-- 1. The uses (spec §2 decision 8). init_hash = sha256 hex of the initData's own `hash` (itself an HMAC; the hash does
--    not depend on the order of the fields, so a reordered replay meets the same key); purpose = 'session', the only
--    one written ('link' and user_id were the removed in-page link's; the table is kept as it was reviewed);
--    auth_date = when Telegram signed the data; used_at = when it was used.
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
comment on table bot.webapp_uses is 'Mini App sign-ins by Telegram initData: one use each (sha256 of its hash), kept two hours, for replays and the brake.';

-- 2. The bot (service role): POST /telegram/webapp/session, after the function checked the signature. linked
--     (+ user_id, email): the account linked to this Telegram, for a one-time sign-in; unlinked: no active link (the
--     Mini App says how to link it from the profile); replayed: this initData was used before; slow_down: 30 an hour
--     for this Telegram; no_email: the account cannot sign in by e-mail (none, deleted, banned). Opening the Mini App
--     counts as the user's action in the bot (last_seen_at ends K2's silence). Uses older than two hours go first (at
--     most 200 a call).
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

-- 3. Grants, as T1's revokes file does for its objects (re-runnable). Supabase gives new public functions to anon and
--    authenticated, PostgreSQL gives every new function to PUBLIC: taken back here. Safety does not depend on it:
--    the function checks the service role first, schema bot has no USAGE for clients and bot.webapp_uses has row
--    security without a policy.
revoke all on table bot.webapp_uses from public, anon, authenticated;
revoke all on function public.bot_webapp_session(bigint, text, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.bot_webapp_session(bigint, text, timestamptz, timestamptz) to service_role;
