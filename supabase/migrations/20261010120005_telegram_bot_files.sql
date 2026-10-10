-- telegram_bot_files
-- Repo file: supabase/migrations/20261010120005_telegram_bot_files.sql (package T9 of the Telegram bot @Meldyteach_bot,
-- stage 4, 2026-10-10). Spec: meldy-notes/10_Project/Telegram_Bot_Spec_2026-10-09.md (§2 decision 27; §4.7 F1; §6.1
-- GET /telegram/file; §6.2 files; §6.3 telegram_file_take, bot_file_offer, bot_file_redeem; §6.4; §8.2 «Файлы»).
-- Needs 20261010120000_telegram_bot.sql (schema bot, bot.links, bot.active_link) and the container's
-- meldy_private.require_service_role() and meldy_private.code_hash(). Rollback:
-- supabase/rollback/20261010120005_telegram_bot_files_down.sql. Local rehearsal (never live):
-- supabase/tests/local/telegram_bot_files.sql. The read-only contract supabase/tests/telegram_bot.sql carries T9's block.
--
-- A file forwarded to the bot opens in the site's import (spec decision 27):
--   1. the function calls bot_file_offer(tg user, file_id, name, size, mime) for a document of a linked student: a ticket
--      F + 32 hex (122 random bits), 30 minutes, bound to the Meldy account of that Telegram; the bot answers F1 with
--      «Открыть в Meldy» → /exams/import?tg=<ticket>;
--   2. the import page calls telegram_file_take(ticket) as the signed-in user: only the ticket's own account gets a token
--      (64 hex, 60 seconds). Taking again before the file was fetched replaces the token (a reload, a second tab);
--   3. the page fetches GET /functions/v1/telegram/file?t=<token>: the function calls bot_file_redeem(token), once (the
--      ticket is spent with it), then getFile and streams the bytes; the bot token never leaves the function.
-- Only sha256 hashes of the ticket and the token are kept (meldy_private.code_hash). A row stays one day after its ticket
-- expired (diagnostics, «used» versus «invalid»); the next offer deletes older ones.
-- Every expected outcome is a status. Errors: 42501 (bot_* without the service role), 28000 (telegram_file_take while
-- signed out), 22023 (a call the function never means: a bad Telegram user id or file id).
-- Additive and re-runnable (IF NOT EXISTS, OR REPLACE). The grants of section 4 follow T1's revokes file.

-- 1. The table (spec §6.2). user_id = the Meldy account of the Telegram that sent the file (from bot.links, never from
--    the caller); file_id = Telegram's id of the document (only the bot can fetch it: getFile needs the bot token);
--    name, size, mime = what Telegram said about it (the name cleaned of control and direction marks: the site shows it
--    and its extension picks the reader); expires_at = the ticket's 30 minutes; token_hash / token_expires_at = the
--    last token the site took (60 seconds); used_at = the file was fetched, the ticket is spent.
create table if not exists bot.files (
  ticket_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  file_id text not null,
  name text,
  size bigint,
  mime text,
  expires_at timestamptz not null,
  token_hash text,
  token_expires_at timestamptz,
  used_at timestamptz,
  constraint files_ticket_hash_check check (ticket_hash ~ '^[0-9a-f]{64}$'),
  constraint files_token_hash_check check (token_hash is null or token_hash ~ '^[0-9a-f]{64}$'),
  constraint files_token_pair_check check ((token_hash is null) = (token_expires_at is null)),
  constraint files_used_check check (used_at is null or token_hash is not null),
  constraint files_file_id_check check (file_id ~ '^[!-~]+$' and pg_catalog.char_length(file_id) <= 512),
  constraint files_name_check check (name is null or pg_catalog.char_length(name) between 1 and 255),
  constraint files_size_check check (size is null or size between 0 and 20971520),
  constraint files_mime_check check (mime is null or mime ~ '^[a-z0-9][a-z0-9.+-]{0,62}/[a-z0-9][a-z0-9.+-]{0,126}$')
);
create unique index if not exists files_token_key on bot.files (token_hash) where token_hash is not null;
create index if not exists files_expires_idx on bot.files (expires_at);
create index if not exists files_user_idx on bot.files (user_id);
alter table bot.files enable row level security;
comment on table bot.files is 'Files forwarded to the bot, offered to the site''s import by a one-time ticket (30 min) and a token (60 s); sha256 hashes only.';

-- 2. The bot (service role, spec §6.3 «файлы»).
-- 2a. A document a student forwarded: a ticket for the import, 30 minutes, bound to the account linked to that Telegram.
--     unlinked: the Telegram is not linked (F1's refusal); too_big: over 20 MB, the most getFile downloads (the function
--     refuses earlier: this is the second line). Rows whose ticket expired more than a day ago go first (at most 100).
create or replace function public.bot_file_offer(p_tg_user_id bigint, p_file_id text, p_name text default null,
                                                 p_size bigint default null, p_mime text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_link bot.links;
  v_now timestamptz := pg_catalog.now();
  v_expires timestamptz := pg_catalog.now() + interval '30 minutes';
  v_ticket text;
  v_name text;
  v_mime text;
begin
  perform meldy_private.require_service_role();
  if p_tg_user_id is null or p_tg_user_id <= 0 or p_file_id is null or p_file_id !~ '^[!-~]+$'
     or pg_catalog.char_length(p_file_id) > 512 or (p_size is not null and p_size < 0) then
    raise exception 'bad file offer' using errcode = '22023';
  end if;
  v_link := bot.active_link(p_tg_user_id);
  if v_link.id is null then
    return pg_catalog.jsonb_build_object('status', 'unlinked');
  end if;
  if p_size is not null and p_size > 20971520 then
    return pg_catalog.jsonb_build_object('status', 'too_big');
  end if;
  -- One line, no control, format or direction marks (U+202E could hide the real extension), at most 255 characters.
  v_name := pg_catalog.regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g');
  v_name := pg_catalog.regexp_replace(v_name,
              '[\u0001-\u001f\u007f-\u009f­؜᠎​-‏‪-‮⁠-⁯﻿￹-￻]', '', 'g');
  v_name := pg_catalog.btrim(pg_catalog.left(pg_catalog.btrim(v_name), 255));
  v_mime := pg_catalog.lower(pg_catalog.btrim(coalesce(p_mime, '')));
  if v_mime !~ '^[a-z0-9][a-z0-9.+-]{0,62}/[a-z0-9][a-z0-9.+-]{0,126}$' then
    v_mime := null;
  end if;
  delete from bot.files f
   where f.ticket_hash in (select x.ticket_hash from bot.files x where x.expires_at < v_now - interval '1 day' limit 100);
  v_ticket := 'F' || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');   -- 122 random bits
  insert into bot.files (ticket_hash, user_id, file_id, name, size, mime, expires_at)
  values (meldy_private.code_hash(v_ticket), v_link.user_id, p_file_id, nullif(v_name, ''), p_size, v_mime, v_expires);
  return pg_catalog.jsonb_build_object('status', 'ok', 'ticket', v_ticket, 'expires_at', v_expires);
end;
$fn$;
comment on function public.bot_file_offer(bigint, text, text, bigint, text) is 'Telegram bot (service role): a ticket F<32 hex> for /exams/import?tg=, 30 minutes, for the account linked to this Telegram. {status: ok, ticket, expires_at} | unlinked | too_big.';

-- 2b. GET /telegram/file?t=<token>: the token the site took → the file to fetch, once; the ticket is spent with it.
--     invalid: no such token (malformed, or replaced by a later take); expired: its 60 seconds are over; used: fetched.
--     Two redeems at once: the row lock lets one through, the other reads used.
create or replace function public.bot_file_redeem(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := pg_catalog.now();
  v_row bot.files;
begin
  perform meldy_private.require_service_role();
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  select f.* into v_row from bot.files f where f.token_hash = meldy_private.code_hash(p_token) for update;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  if v_row.used_at is not null then
    return pg_catalog.jsonb_build_object('status', 'used');
  end if;
  if v_row.token_expires_at <= v_now then
    return pg_catalog.jsonb_build_object('status', 'expired');
  end if;
  update bot.files f set used_at = v_now where f.ticket_hash = v_row.ticket_hash;
  return pg_catalog.jsonb_build_object('status', 'ok', 'file_id', v_row.file_id, 'name', v_row.name, 'size', v_row.size,
                                       'mime', v_row.mime);
end;
$fn$;
comment on function public.bot_file_redeem(text) is 'Telegram bot (service role): the site''s 60-second token → {status: ok, file_id, name, size, mime}, once | invalid | expired | used.';

-- 3. The site (authenticated, spec §6.3 «Сайт»).
-- 3a. /exams/import?tg=<ticket>: the signed-in user's own ticket → a token for 60 seconds and what the file is called.
--     Another account's ticket answers other_user and nothing else about it; expired: the 30 minutes are over; used:
--     the file was already fetched with this ticket; invalid: no such ticket. A take while no file was fetched replaces
--     the earlier token.
create or replace function public.telegram_file_take(p_ticket text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_now timestamptz := pg_catalog.now();
  v_expires timestamptz := pg_catalog.now() + interval '60 seconds';
  v_row bot.files;
  v_token text;
begin
  if v_uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  if p_ticket is null or p_ticket !~ '^F[0-9a-f]{32}$' then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  select f.* into v_row from bot.files f where f.ticket_hash = meldy_private.code_hash(p_ticket) for update;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'invalid');
  end if;
  if v_row.user_id is distinct from v_uid then
    return pg_catalog.jsonb_build_object('status', 'other_user');
  end if;
  if v_row.used_at is not null then
    return pg_catalog.jsonb_build_object('status', 'used');
  end if;
  if v_row.expires_at <= v_now then
    return pg_catalog.jsonb_build_object('status', 'expired');
  end if;
  v_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '')
          || pg_catalog.replace(pg_catalog.gen_random_uuid()::text, '-', '');   -- 244 random bits
  update bot.files f set token_hash = meldy_private.code_hash(v_token), token_expires_at = v_expires
   where f.ticket_hash = v_row.ticket_hash;
  return pg_catalog.jsonb_build_object('status', 'ok', 'token', v_token, 'expires_at', v_expires,
                                       'name', v_row.name, 'size', v_row.size, 'mime', v_row.mime);
end;
$fn$;
comment on function public.telegram_file_take(text) is 'Site (signed-in user): the own ticket of /exams/import?tg= → {status: ok, token (60 s), expires_at, name, size, mime} | other_user | expired | used | invalid.';

-- 4. Grants, as T1's revokes file does for its objects (re-runnable). Supabase gives new public functions to anon and
--    authenticated, PostgreSQL gives every new function to PUBLIC: taken back here. Safety does not depend on it:
--    bot_* check the service role first, telegram_file_take checks auth.uid(), schema bot has no USAGE for clients and
--    bot.files has row security without a policy.
revoke all on table bot.files from public, anon, authenticated;
revoke all on function public.bot_file_offer(bigint, text, text, bigint, text), public.bot_file_redeem(text)
  from public, anon, authenticated;
grant execute on function public.bot_file_offer(bigint, text, text, bigint, text), public.bot_file_redeem(text)
  to service_role;
revoke all on function public.telegram_file_take(text) from public, anon;
grant execute on function public.telegram_file_take(text) to authenticated;
