-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. The tick's claims of the bot's database core (package T1) on the
-- scratch database of telegram_bot_run.sh: spec §8.2 «Напоминания» entirely — starvation (120 links at 20:00, limit 50
-- → all in 3 ticks), at most once (sending → unknown, never again), the 3-hour window and 23:00, Minsk and
-- Vladivostok, the pause, 30 minutes after the last answer, K2 and its silence, K3 after the date and the
-- night's close (each once); plus the context's reasons, the day card handed back, the retakes and their limits, and
-- the way back after a 429 (bot_delivery_retry). Two claims at once (two sessions) are in telegram_bot_run.sh.
-- One transaction, rolled back. The timeline is a few days ahead of the real clock (every claim takes p_now), so real
-- stamps (now()) are always older than the test's moments. Fixtures and assertions run as postgres (no JWT: the pg_cron
-- path of require_service_role); block 0 runs every claim as service_role. A failure raises (FAILED: …); success prints
-- TELEGRAM BOT CLAIMS PASSED.
\set ON_ERROR_STOP 1
begin;

-- A local wall time in a zone, as a moment.
create or replace function pg_temp.at(p_day date, p_time text, p_tz text default 'Europe/Minsk') returns timestamptz
language sql immutable as $fn$
  select (p_day + p_time::time) at time zone p_tz
$fn$;
-- The first test day: three days after today (UTC).
create or replace function pg_temp.d(p_offset integer default 0) returns date language sql stable as $fn$
  select (now() at time zone 'utc')::date + 3 + p_offset
$fn$;
-- One reminder step of the tick (spec §6.6 step 3) as the function will run it: claim → context → (K1 | K2) sending →
-- sent. Returns one row per claimed card: chat and «K1» | «K2» | «skip:<reason>».
create or replace function pg_temp.remind(p_now timestamptz, p_limit integer default 50)
returns table (chat bigint, card text) language plpgsql as $fn$
declare r record; c jsonb;
begin
  for r in select * from public.bot_claim_reminders(p_limit, p_now) loop
    c := public.bot_reminder_context(r.delivery_id);
    if c ->> 'card' in ('K1', 'K2') then
      if not public.bot_delivery_sending(r.delivery_id, p_now) then raise exception 'FAILED: sending refused for %', r.delivery_id; end if;
      perform public.bot_delivery_done(r.delivery_id, 'sent', 1000000 + r.delivery_id, null, p_now);
    end if;
    chat := r.chat_id;
    card := (c ->> 'card') || case when c ->> 'card' = 'skip' then ':' || (c ->> 'reason') else '' end;
    return next;
  end loop;
end;
$fn$;
-- A link (fixture): a fresh account, Minsk 20:00 unless told otherwise, last action long ago.
create or replace function pg_temp.link(p_tg bigint, p_at time default '20:00', p_tz text default 'Europe/Minsk')
returns uuid language plpgsql as $fn$
declare v_user uuid := ('c1a10000-0000-4000-8000-' || lpad(p_tg::text, 12, '0'))::uuid;
begin
  insert into auth.users (id) values (v_user) on conflict do nothing;
  insert into bot.links (user_id, tg_user_id, chat_id, remind_at, tz, linked_at, last_seen_at)
  values (v_user, p_tg, p_tg, p_at, p_tz, now() - interval '30 days', now() - interval '30 days');
  return v_user;
end;
$fn$;
-- An answer on the site (fixture): only the user, the moment and the day matter to the claims.
create or replace function pg_temp.answer(p_user uuid, p_at timestamptz, p_tz text default 'Europe/Minsk') returns void
language sql as $fn$
  insert into public.test_answers (user_id, client_event_id, created_at, local_date, container_id, subject_id, item_rev,
                                   correct, step)
  values (p_user, 'web-' || md5(p_user::text || p_at::text), p_at, (p_at at time zone p_tz)::date, gen_random_uuid(),
          gen_random_uuid(), 1, true, 'start')
$fn$;
create or replace function pg_temp.cards(p_now timestamptz, p_limit integer default 50) returns text language sql as $fn$
  select coalesce(string_agg(chat || '=' || card, ',' order by chat), '') from pg_temp.remind(p_now, p_limit)
$fn$;
grant execute on function pg_temp.at(date, text, text), pg_temp.d(integer) to service_role;

-- 0. Every claim through the service role (the role path); the rest of the file runs as postgres.
select pg_temp.link(100) is not null;
select set_config('request.jwt.claims', '{"role":"service_role"}', true) is not null;
set local role service_role;
do $t$
declare n integer;
begin
  select count(*) into n from public.bot_claim_reminders(50, pg_temp.at(pg_temp.d(), '20:01'));
  if n is distinct from 1 then raise exception 'FAILED: service role claim % rows', n; end if;
  perform * from public.bot_claim_day_close(50, pg_temp.at(pg_temp.d(), '00:05'));
  perform * from public.bot_claim_after_date(50, pg_temp.at(pg_temp.d(), '20:01'));
end
$t$;
reset role;
select set_config('request.jwt.claims', '', true) is not null;
delete from bot.links where tg_user_id = 100;

-- 1. Starvation (the engineer's case, decision 7): 120 links due at 20:00, 50 a tick → every one in 3 ticks, once.
do $t$
declare n integer; t integer;
begin
  for i in 1..120 loop perform pg_temp.link(10000 + i); end loop;
  for t in 1..4 loop
    select count(*) into n from pg_temp.remind(pg_temp.at(pg_temp.d(), '20:00') + make_interval(mins => t), 50);
    if n is distinct from (case t when 1 then 50 when 2 then 50 when 3 then 20 else 0 end) then
      raise exception 'FAILED: starvation, tick % claimed %', t, n; end if;
  end loop;
  if (select count(distinct chat_id) from bot.deliveries where chat_id between 10001 and 10120 and status = 'sent') is distinct from 120
     or (select count(*) from bot.deliveries where chat_id between 10001 and 10120) is distinct from 120 then
    raise exception 'FAILED: starvation: not every link once'; end if;
  delete from bot.links where tg_user_id between 10001 and 10120;
end
$t$;

-- 2. At most once (decision 7): a worker died after sending → unknown, never again; a worker died before sending →
--    taken again (attempt 2, at most 3), and failed after 3 hours; sending refused for an ended link.
do $t$
declare a bigint; b bigint; n integer; d date := pg_temp.d();
begin
  perform pg_temp.link(501); perform pg_temp.link(502);
  select delivery_id into a from public.bot_claim_reminders(10, pg_temp.at(d, '20:01')) where chat_id = 501;
  select id into b from bot.deliveries where chat_id = 502 and local_day = d;
  if a is null or b is null then raise exception 'FAILED: both claimed'; end if;
  if not public.bot_delivery_sending(a, pg_temp.at(d, '20:01:30')) then raise exception 'FAILED: could not start sending'; end if;
  -- both workers die here: 501 was being sent (maybe delivered), 502 was never tried
  select count(*) into n from public.bot_claim_reminders(10, pg_temp.at(d, '20:05')) where chat_id in (501, 502);
  if n is distinct from 0 then raise exception 'FAILED: taken again before 10 minutes'; end if;
  select count(*) into n from public.bot_claim_reminders(10, pg_temp.at(d, '20:12')) where chat_id = 501;
  if n is distinct from 0 then raise exception 'FAILED: DUPLICATE: a row in sending was taken again'; end if;
  if (select status from bot.deliveries where id = a) is distinct from 'unknown' then raise exception 'FAILED: sending → unknown'; end if;
  if (select row(status, attempts, claimed_at) from bot.deliveries where id = b)
     is distinct from row('claimed'::text, 2::smallint, pg_temp.at(d, '20:12')) then
    raise exception 'FAILED: the never-tried row was not taken again'; end if;
  if public.bot_delivery_sending(a, pg_temp.at(d, '20:13')) then raise exception 'FAILED: an unknown row could be sent again'; end if;
  if public.bot_reminder_context(a) ->> 'reason' is distinct from 'not_claimed' then raise exception 'FAILED: context of an unknown row'; end if;
  -- the third try, then no more; after 3 hours the row is failed
  select count(*) into n from public.bot_claim_reminders(10, pg_temp.at(d, '20:23')) where chat_id = 502;
  if n is distinct from 1 or (select attempts from bot.deliveries where id = b) is distinct from 3 then raise exception 'FAILED: the third try'; end if;
  select count(*) into n from public.bot_claim_reminders(10, pg_temp.at(d, '20:40')) where chat_id = 502;
  if n is distinct from 0 then raise exception 'FAILED: a fourth try'; end if;
  perform * from public.bot_claim_reminders(10, pg_temp.at(d, '23:30'));
  if (select row(status, error) from bot.deliveries where id = b) is distinct from row('failed'::text, 'abandoned'::text) then
    raise exception 'FAILED: abandoned after 3 hours'; end if;
  -- a link that ended between the claim and the send: no send
  perform pg_temp.link(503);
  select delivery_id into a from public.bot_claim_reminders(10, pg_temp.at(d + 1, '20:01')) where chat_id = 503;
  update bot.links set unlinked_at = now() where tg_user_id = 503;
  if public.bot_delivery_sending(a, pg_temp.at(d + 1, '20:01:10')) then raise exception 'FAILED: sending for an ended link'; end if;
  delete from bot.links where tg_user_id in (501, 502, 503);
end
$t$;

-- 3. The window (decision 20): from the chosen time, at most 3 hours late, never at 23:00 or later.
do $t$
declare d date := pg_temp.d(10); v text;
begin
  if bot.in_window(timestamp '2026-01-01 18:59', '19:00') or not bot.in_window(timestamp '2026-01-01 19:00', '19:00')
     or not bot.in_window(timestamp '2026-01-01 21:59:59', '19:00') or bot.in_window(timestamp '2026-01-01 22:00', '19:00')
     or not bot.in_window(timestamp '2026-01-01 22:59:59', '21:30') or bot.in_window(timestamp '2026-01-01 23:00', '21:30')
     or not bot.in_window(timestamp '2026-01-01 22:59:59', '20:00') or bot.in_window(timestamp '2026-01-01 23:00', '20:00')
     or bot.in_window(timestamp '2026-01-01 07:29', '07:30') or not bot.in_window(timestamp '2026-01-01 10:29', '07:30')
     or bot.in_window(timestamp '2026-01-01 10:30', '07:30') or bot.in_window(timestamp '2026-01-02 02:00', '20:00') then
    raise exception 'FAILED: bot.in_window'; end if;
  perform pg_temp.link(601, '19:00'); perform pg_temp.link(602, '20:00'); perform pg_temp.link(603, '21:30');
  perform pg_temp.link(604, '07:30');
  v := pg_temp.cards(pg_temp.at(d, '18:59'));
  if v is distinct from '' then raise exception 'FAILED: 18:59 %', v; end if;
  v := pg_temp.cards(pg_temp.at(d, '22:00'));   -- 19:00 is 3 hours late; 20:00 and 21:30 are in
  if v is distinct from '602=K1,603=K1' then raise exception 'FAILED: 22:00 %', v; end if;
  v := pg_temp.cards(pg_temp.at(d + 1, '23:00'));
  if v is distinct from '' then raise exception 'FAILED: 23:00 %', v; end if;
  v := pg_temp.cards(pg_temp.at(d + 2, '02:00'));
  if v is distinct from '' then raise exception 'FAILED: 02:00 %', v; end if;
  v := pg_temp.cards(pg_temp.at(d + 2, '07:30'));
  if v is distinct from '604=K1' then raise exception 'FAILED: 07:30 %', v; end if;
  v := pg_temp.cards(pg_temp.at(d + 2, '21:59'));
  if v is distinct from '601=K1,602=K1,603=K1' then raise exception 'FAILED: 21:59 %', v; end if;
  delete from bot.links where tg_user_id between 601 and 604;
end
$t$;

-- 4. Minsk (UTC+3) and Vladivostok (UTC+10): each at its own 20:00, each on its own local day.
do $t$
declare d date := pg_temp.d(20); r record;
begin
  perform pg_temp.link(701, '20:00', 'Europe/Minsk'); perform pg_temp.link(702, '20:00', 'Asia/Vladivostok');
  select * into r from public.bot_claim_reminders(10, (d + time '10:05') at time zone 'utc');   -- 20:05 Vladivostok, 13:05 Minsk
  if r.chat_id is distinct from 702::bigint or r.local_day is distinct from d or r.tz is distinct from 'Asia/Vladivostok'
     or (select count(*) from bot.deliveries where chat_id in (701, 702)) is distinct from 1 then
    raise exception 'FAILED: Vladivostok at 10:05 UTC %', r; end if;
  if (select count(*) from public.bot_claim_reminders(10, (d + time '13:00') at time zone 'utc')) is distinct from 0 then   -- 23:00 there
    raise exception 'FAILED: Vladivostok at 23:00'; end if;
  select * into r from public.bot_claim_reminders(10, (d + time '17:05') at time zone 'utc');   -- 20:05 Minsk, 03:05 Vladivostok
  if r.chat_id is distinct from 701::bigint or r.local_day is distinct from d or r.tz is distinct from 'Europe/Minsk' then raise exception 'FAILED: Minsk at 17:05 UTC %', r; end if;
  -- 15:00 UTC is already the next day in Vladivostok (01:00): no card at 01:00, and its 20:00 comes on that day
  if (select count(*) from public.bot_claim_reminders(10, (d + time '15:00') at time zone 'utc')) is distinct from 0 then
    raise exception 'FAILED: 01:00 in Vladivostok'; end if;
  select * into r from public.bot_claim_reminders(10, (d + 1 + time '10:05') at time zone 'utc');
  if r.chat_id is distinct from 702::bigint or r.local_day is distinct from d + 1 then raise exception 'FAILED: Vladivostok the next day %', r; end if;
  delete from bot.links where tg_user_id in (701, 702);
end
$t$;

-- 5. The pause: paused_until = the first day the card comes again; a pause set after the claim skips the card.
do $t$
declare d date := pg_temp.d(30); v text; c jsonb; x bigint;
begin
  perform pg_temp.link(801);
  update bot.links set paused_until = d + 1 where tg_user_id = 801;
  v := pg_temp.cards(pg_temp.at(d, '20:05'));
  if v is distinct from '' then raise exception 'FAILED: a card in the pause %', v; end if;
  v := pg_temp.cards(pg_temp.at(d + 1, '20:05'));
  if v is distinct from '801=K1' then raise exception 'FAILED: the first day back %', v; end if;
  select delivery_id into x from public.bot_claim_reminders(10, pg_temp.at(d + 2, '20:05'));
  update bot.links set paused_until = d + 5 where tg_user_id = 801;
  c := public.bot_reminder_context(x);
  if c ->> 'card' is distinct from 'skip' or c ->> 'reason' is distinct from 'paused' or (select status from bot.deliveries where id = x) is distinct from 'skipped' then
    raise exception 'FAILED: paused after the claim %', c; end if;
  delete from bot.links where tg_user_id = 801;
end
$t$;

-- 6. 30 minutes after the last answer, on the site or in the bot (decision 20: the card waits); an action in the bot
--    (a new time in /settings) does not delay it.
do $t$
declare d date := pg_temp.d(40); v text; u uuid;
begin
  u := pg_temp.link(901);
  perform pg_temp.answer(u, pg_temp.at(d, '19:45'));
  perform pg_temp.link(902);
  update bot.links set last_seen_at = pg_temp.at(d, '19:58') where tg_user_id = 902;
  v := pg_temp.cards(pg_temp.at(d, '20:01'));
  if v is distinct from '902=K1' then raise exception 'FAILED: 16 minutes after an answer; an action does not wait %', v; end if;
  v := pg_temp.cards(pg_temp.at(d, '20:14'));
  if v is distinct from '' then raise exception 'FAILED: 29 minutes after the answer %', v; end if;
  v := pg_temp.cards(pg_temp.at(d, '20:16'));
  if v is distinct from '901=K1' then raise exception 'FAILED: 31 minutes after the answer %', v; end if;
  delete from bot.links where tg_user_id in (901, 902);
end
$t$;

-- 7. K2 and its silence (decision 21): three cards sent in a row with no answer and no action → K2 instead of the
--    fourth (the day card slot: no K1 that day); then nothing until the student answers or writes; a skipped day
--    («nothing to do») does not count; the K2 answer is kept.
do $t$
declare d date := pg_temp.d(50); v text; u uuid; x bigint; c jsonb;
begin
  u := pg_temp.link(1101);
  for i in 0..2 loop
    v := pg_temp.cards(pg_temp.at(d + i, '20:01'));
    if v is distinct from '1101=K1' then raise exception 'FAILED: day % %', i, v; end if;
  end loop;
  select delivery_id into x from public.bot_claim_reminders(10, pg_temp.at(d + 3, '20:01'));
  c := public.bot_reminder_context(x);
  if c ->> 'card' is distinct from 'K2' or c ->> 'kind' is distinct from 'ask' or (select kind from bot.deliveries where id = x) is distinct from 'ask'
     or not (c ? 'plan') or not (c ? 'overview') or c -> 'link' ->> 'tz' is distinct from 'Europe/Minsk' then
    raise exception 'FAILED: K2 instead of the fourth %', c - 'plan' - 'overview'; end if;
  perform public.bot_delivery_sending(x, pg_temp.at(d + 3, '20:01:05'));
  -- (a call and the read of what it changed go in separate statements: a subquery in the same expression reads the
  -- table as it was when that expression began)
  c := public.bot_delivery_done(x, 'sent', 7001, null, pg_temp.at(d + 3, '20:01:06'));
  if c ->> 'kind' is distinct from 'ask' or (select asked_at from bot.links where tg_user_id = 1101) is distinct from pg_temp.at(d + 3, '20:01:06') then
    raise exception 'FAILED: K2 sent → asked_at %', c; end if;
  -- K2 took the day card slot: no K1 later that day
  if pg_temp.cards(pg_temp.at(d + 3, '20:40')) is distinct from '' then raise exception 'FAILED: a K1 on the K2 day'; end if;
  -- silence: two days, each claimed once and skipped
  if pg_temp.cards(pg_temp.at(d + 4, '20:01')) is distinct from '1101=skip:silent' or pg_temp.cards(pg_temp.at(d + 5, '20:01')) is distinct from '1101=skip:silent' then
    raise exception 'FAILED: silence after K2'; end if;
  if (select count(*) from bot.deliveries where chat_id = 1101 and local_day in (d + 4, d + 5) and status = 'skipped' and error = 'silent') is distinct from 2 then
    raise exception 'FAILED: silent days recorded'; end if;
  -- the student answers on the site: the next day a K1 again, and the count starts over
  perform pg_temp.answer(u, pg_temp.at(d + 5, '22:00'));
  if pg_temp.cards(pg_temp.at(d + 6, '20:01')) is distinct from '1101=K1' then raise exception 'FAILED: K1 after an answer'; end if;
  -- a day with nothing to do (the function skips it) does not count toward K2
  select delivery_id into x from public.bot_claim_reminders(10, pg_temp.at(d + 7, '20:01'));
  perform public.bot_reminder_context(x);
  perform public.bot_delivery_done(x, 'skipped', null, 'nothing', pg_temp.at(d + 7, '20:01:01'));
  if pg_temp.cards(pg_temp.at(d + 8, '20:01')) is distinct from '1101=K1' or pg_temp.cards(pg_temp.at(d + 9, '20:01')) is distinct from '1101=K1' then
    raise exception 'FAILED: K1 on days 8 and 9'; end if;
  if pg_temp.cards(pg_temp.at(d + 10, '20:01')) is distinct from '1101=K2' then raise exception 'FAILED: the second K2 (6, 8, 9 sent)'; end if;
  -- the answer «Да» (a bot action, stamped here on the timeline) ends the silence; the answer is kept on the K2 row
  update bot.links set last_seen_at = pg_temp.at(d + 10, '21:00') where tg_user_id = 1101;
  c := public.bot_settings(1101, '{"ask": "yes"}');
  if c ->> 'status' is distinct from 'ok' or (select answer from bot.deliveries where chat_id = 1101 and local_day = d + 10) is distinct from 'yes' then
    raise exception 'FAILED: the K2 answer %', c; end if;
  if public.bot_settings(1101, '{"ask": "maybe"}') ->> 'reason' is distinct from 'format' then raise exception 'FAILED: a bad K2 answer'; end if;
  update bot.links set last_seen_at = pg_temp.at(d + 10, '21:00') where tg_user_id = 1101;
  if pg_temp.cards(pg_temp.at(d + 11, '20:01')) is distinct from '1101=K1' then raise exception 'FAILED: K1 after «Да»'; end if;
  delete from bot.links where tg_user_id = 1101;
end
$t$;

-- 8. The context's other reasons, and the day card handed back by bot_delivery_done.
do $t$
declare d date := pg_temp.d(70); x bigint; c jsonb; r jsonb;
begin
  perform pg_temp.link(1201); perform pg_temp.link(1202); perform pg_temp.link(1203); perform pg_temp.link(1204);
  perform * from public.bot_claim_reminders(10, pg_temp.at(d, '20:01'));
  update bot.links set unlinked_at = now() where tg_user_id = 1201;
  update bot.links set blocked_at = now() where tg_user_id = 1202;
  update bot.links set remind_on = false where tg_user_id = 1203;
  for x, c in select dl.id, public.bot_reminder_context(dl.id) from bot.deliveries dl where dl.chat_id between 1201 and 1203 order by dl.chat_id loop
    if c ->> 'card' is distinct from 'skip' or c ->> 'status' is distinct from 'ok' then raise exception 'FAILED: context % %', x, c; end if;
  end loop;
  if (select string_agg(error, ',' order by chat_id) from bot.deliveries where chat_id between 1201 and 1203) is distinct from 'unlinked,blocked,off'
     or (select count(*) from bot.deliveries where chat_id between 1201 and 1203 and status = 'skipped') is distinct from 3 then
    raise exception 'FAILED: the context''s reasons'; end if;
  if public.bot_reminder_context(-1) ->> 'status' is distinct from 'gone' then raise exception 'FAILED: an unknown delivery'; end if;
  -- /today sent a card at 09:00 that nobody used; the reminder's card replaces it
  insert into bot.days (link_id, local_day, card_message_id) select id, d, 555 from bot.links where tg_user_id = 1204;
  select id into x from bot.deliveries where chat_id = 1204 and local_day = d;
  c := public.bot_reminder_context(x);
  perform public.bot_delivery_sending(x, pg_temp.at(d, '20:01:02'));
  r := public.bot_delivery_done(x, 'sent', 556, null, pg_temp.at(d, '20:01:03'));
  if r is distinct from '{"status": "ok", "kind": "reminder", "prev_card_message_id": 555}'::jsonb
     or (select row(card_message_id, card_used) from bot.days dy join bot.links l on l.id = dy.link_id where l.tg_user_id = 1204 and dy.local_day = d)
        is distinct from row(556::bigint, false) then
    raise exception 'FAILED: the reminder''s card %', r; end if;
  if public.bot_delivery_done(x, 'sent', 556, null, pg_temp.at(d, '20:02')) is distinct from '{"status": "ignored"}'::jsonb then
    raise exception 'FAILED: done twice'; end if;
  begin
    perform public.bot_delivery_done(x, 'delivered', null, null, null);
    raise exception 'FAILED: a bad status was accepted';
  exception when invalid_parameter_value then null;
  end;
  -- a used /today card is never handed back
  insert into bot.days (link_id, local_day, card_message_id, card_used) select id, d + 1, 557, true from bot.links where tg_user_id = 1204;
  select delivery_id into x from public.bot_claim_reminders(10, pg_temp.at(d + 1, '20:01')) where chat_id = 1204;
  perform public.bot_reminder_context(x);
  perform public.bot_delivery_sending(x, pg_temp.at(d + 1, '20:01:02'));
  if public.bot_delivery_done(x, 'sent', 558, null, pg_temp.at(d + 1, '20:01:03')) -> 'prev_card_message_id' is distinct from 'null'::jsonb then
    raise exception 'FAILED: a used card handed back'; end if;
  delete from bot.links where tg_user_id between 1201 and 1204;
end
$t$;

-- 9. K3 after the date (spec §4.2): the day after the last test date, at the usual time, under the reminder's rules,
--    once per user and exam; a subject with its own later date moves it; a pause catches up within 3 days.
do $t$
declare d date := pg_temp.d(80); ux uuid; uy uuid; cx uuid; cy uuid; cz uuid; s uuid; r record; n integer;
begin
  ux := pg_temp.link(1301); uy := pg_temp.link(1302);
  insert into public.containers (id, owner_id, title, exam_date) values
    (gen_random_uuid(), ux, 'Осенняя сессия', d) returning id into cx;
  insert into public.container_subjects (container_id, owner_id, position, title) values (cx, ux, 1, 'Компьютерные сети') returning id into s;
  insert into public.containers (id, owner_id, title, exam_date) values (gen_random_uuid(), ux, 'Зимняя сессия', d - 9) returning id into cz;
  insert into public.containers (id, owner_id, title, exam_date) values (gen_random_uuid(), uy, 'Летняя сессия', d) returning id into cy;
  insert into public.container_subjects (container_id, owner_id, position, title, exam_date) values
    (cy, uy, 1, 'Базы данных', null), (cy, uy, 2, 'Сети', d + 2);   -- the last test date is d + 2
  -- answers of X in «Осенняя сессия»: 3 on two days before the date, 1 after it (not counted)
  insert into public.test_answers (user_id, client_event_id, created_at, local_date, container_id, subject_id, item_rev, correct, step)
  values (ux, 'web-k3-0001', pg_temp.at(d - 2, '18:00'), d - 2, cx, s, 1, true, 'start'),
         (ux, 'web-k3-0002', pg_temp.at(d - 2, '18:01'), d - 2, cx, s, 1, false, 'miss'),
         (ux, 'web-k3-0003', pg_temp.at(d - 1, '18:00'), d - 1, cx, s, 1, true, 'start'),
         (ux, 'web-k3-0004', pg_temp.at(d + 1, '09:00'), d + 1, cx, s, 1, true, 'training');
  update bot.links set paused_until = d + 4 where tg_user_id = 1302;   -- Y's K3 waits for the pause (below)
  if (select count(*) from public.bot_claim_after_date(10, pg_temp.at(d, '20:05'))) is distinct from 0 then raise exception 'FAILED: K3 on the exam day'; end if;
  if (select count(*) from public.bot_claim_after_date(10, pg_temp.at(d + 1, '19:59'))) is distinct from 0 then raise exception 'FAILED: K3 before the time'; end if;
  select * into r from public.bot_claim_after_date(10, pg_temp.at(d + 1, '20:05'));
  if r.chat_id is distinct from 1301::bigint or r.container_id is distinct from cx or r.local_day is distinct from d + 1 or r.tz is distinct from 'Europe/Minsk'
     or r.exam ->> 'title' is distinct from 'Осенняя сессия' or (r.exam ->> 'last_date')::date is distinct from d or (r.exam ->> 'answers')::int is distinct from 3
     or (r.exam ->> 'active_days')::int is distinct from 2 or (r.exam ->> 'keyed')::int is distinct from 0 or (r.exam ->> 'two_days')::int is distinct from 0
     or (r.exam ->> 'first_plan_day')::date > d then
    raise exception 'FAILED: K3 for X %', row_to_json(r); end if;
  if (select count(*) from bot.deliveries where kind = 'after_date') is distinct from 1 then raise exception 'FAILED: one K3 row'; end if;
  perform public.bot_delivery_sending(r.delivery_id, pg_temp.at(d + 1, '20:05:01'));
  perform public.bot_delivery_done(r.delivery_id, 'sent', 9001, null, pg_temp.at(d + 1, '20:05:02'));
  if (select count(*) from public.bot_claim_after_date(10, pg_temp.at(d + 1, '20:30'))) is distinct from 0
     or (select count(*) from public.bot_claim_after_date(10, pg_temp.at(d + 2, '20:05'))) is distinct from 0
     or (select count(*) from public.bot_claim_after_date(10, pg_temp.at(d + 3, '20:05'))) is distinct from 0 then
    raise exception 'FAILED: K3 more than once'; end if;
  -- Y: the exam's own date is d but a subject's is d + 2 → K3 from d + 3; Y is paused until d + 4 → caught up on d + 4
  if (select count(*) from public.bot_claim_after_date(10, pg_temp.at(d + 3, '20:05'))) is distinct from 0 then raise exception 'FAILED: K3 in a pause'; end if;
  select * into r from public.bot_claim_after_date(10, pg_temp.at(d + 4, '20:05'));
  if r.chat_id is distinct from 1302::bigint or r.container_id is distinct from cy or (r.exam ->> 'last_date')::date is distinct from d + 2 then
    raise exception 'FAILED: K3 by the subject''s own date, after the pause %', row_to_json(r); end if;
  -- «Зимняя сессия» (9 days ago) never: K3 only within 3 days
  if exists (select 1 from bot.deliveries where ref = cz::text) then raise exception 'FAILED: an old exam got K3'; end if;
  -- blocked or plan off: no K3
  delete from bot.deliveries where kind = 'after_date';
  update bot.links set blocked_at = now() where tg_user_id = 1301;
  update bot.links set remind_on = false where tg_user_id = 1302;
  select count(*) into n from public.bot_claim_after_date(10, pg_temp.at(d + 1, '20:05'));
  if n is distinct from 0 then raise exception 'FAILED: K3 for blocked or off'; end if;
  delete from bot.links where tg_user_id in (1301, 1302);
  delete from public.containers where id in (cx, cy, cz);
end
$t$;

-- 10. The night's close (spec §6.6 step 5): after local midnight, a day of the last two with an unused card or a
--     summary with a keyboard, once; a card that became a session is never deleted; blocked chats are left alone.
do $t$
declare d date := pg_temp.d(90); l bigint; r record; n integer;
begin
  perform pg_temp.link(1401);
  select id into l from bot.links where tg_user_id = 1401;
  insert into bot.days (link_id, local_day, card_message_id, card_used, last_message_id) values
    (l, d, 301, false, 401),        -- an unused card and a summary
    (l, d + 1, 302, true, null),    -- the card became a session, no summary: nothing to do
    (l, d + 2, 303, false, null),   -- an unused card
    (l, d - 5, 299, false, null);   -- too old: deleteMessage works only 48 hours
  if (select count(*) from public.bot_claim_day_close(10, pg_temp.at(d, '23:59'))) is distinct from 0 then raise exception 'FAILED: a close before midnight'; end if;
  select * into r from public.bot_claim_day_close(10, pg_temp.at(d + 1, '00:05'));
  if r.chat_id is distinct from 1401::bigint or r.local_day is distinct from d or r.card_message_id is distinct from 301 or r.last_message_id is distinct from 401 then
    raise exception 'FAILED: the close of day 0 %', row_to_json(r); end if;
  if (select count(*) from public.bot_claim_day_close(10, pg_temp.at(d + 1, '00:06'))) is distinct from 0 then raise exception 'FAILED: claimed twice'; end if;
  perform public.bot_delivery_done(r.delivery_id, 'sent', null, null, pg_temp.at(d + 1, '00:05:10'));
  if (select closed_at from bot.days where link_id = l and local_day = d) is distinct from pg_temp.at(d + 1, '00:05:10') then
    raise exception 'FAILED: closed_at'; end if;
  if (select count(*) from public.bot_claim_day_close(10, pg_temp.at(d + 2, '00:05'))) is distinct from 0 then
    raise exception 'FAILED: a day with nothing to do'; end if;
  -- the unused card of day 2 is, in fact, package T5's session message: kept
  create table bot.sessions (sid text primary key, user_id uuid, chat_id bigint, message_id bigint, status text);
  insert into bot.sessions values ('s0000303', (select user_id from bot.links where id = l), 1401, 303, 'finished');
  select * into r from public.bot_claim_day_close(10, pg_temp.at(d + 3, '00:05'));
  if r.local_day is distinct from d + 2 or r.card_message_id is not null or r.last_message_id is not null then
    raise exception 'FAILED: a session''s message would be deleted %', row_to_json(r); end if;
  drop table bot.sessions;
  -- blocked: left alone
  insert into bot.days (link_id, local_day, card_message_id) values (l, d + 9, 309);
  update bot.links set blocked_at = now() where id = l;
  select count(*) into n from public.bot_claim_day_close(10, pg_temp.at(d + 10, '00:05'));
  if n is distinct from 0 then raise exception 'FAILED: a close in a blocked chat'; end if;
  if (select count(*) from bot.deliveries where kind = 'day_close' and chat_id = 1401) is distinct from 2 then raise exception 'FAILED: two closes'; end if;
  delete from bot.links where id = l;
end
$t$;

-- 11. A 429 (spec §6.7): Telegram sent nothing, so bot_delivery_retry puts the row back to claimed with its attempts
--     kept; a later claim takes it again after 10 minutes, at most 3 tries in all; a row no longer due (the window
--     closed, the chat blocked, no try left) is closed as failed. Never unknown, never twice. The night's close and K3
--     take the same way back.
do $t$
declare d date := pg_temp.d(100); x bigint; y bigint; z bigint; n integer; ok boolean;
begin
  perform pg_temp.link(1501);
  select delivery_id into x from public.bot_claim_reminders(10, pg_temp.at(d, '20:01')) where chat_id = 1501;
  perform public.bot_reminder_context(x);
  if not public.bot_delivery_sending(x, pg_temp.at(d, '20:01:01')) then raise exception 'FAILED: 429: sending'; end if;
  if not public.bot_delivery_retry(x, '429', pg_temp.at(d, '20:01:02')) then raise exception 'FAILED: 429: retry 1'; end if;
  if (select row(status, attempts, error, claimed_at) from bot.deliveries where id = x)
     is distinct from row('claimed'::text, 1::smallint, '429'::text, pg_temp.at(d, '20:01:02')) then
    raise exception 'FAILED: 429: back to claimed with its attempts'; end if;
  -- (as above: the call first, then the read)
  ok := public.bot_delivery_retry(x, '429', pg_temp.at(d, '20:01:03'));
  if ok or (select status from bot.deliveries where id = x) is distinct from 'claimed' then
    raise exception 'FAILED: 429: a retry of a row not in sending'; end if;
  -- the saving mode sees it once a claim would take it
  if bot.tick_due(pg_temp.at(d, '20:05')) or not bot.tick_due(pg_temp.at(d, '20:12')) then raise exception 'FAILED: 429: tick_due'; end if;
  select count(*) into n from public.bot_claim_reminders(10, pg_temp.at(d, '20:05')) where chat_id = 1501;
  if n is distinct from 0 then raise exception 'FAILED: 429: taken again before 10 minutes'; end if;
  select count(*) into n from public.bot_claim_reminders(10, pg_temp.at(d, '20:12')) where chat_id = 1501;
  if n is distinct from 1 or (select attempts from bot.deliveries where id = x) is distinct from 2 then raise exception 'FAILED: 429: try 2'; end if;
  perform public.bot_reminder_context(x);
  perform public.bot_delivery_sending(x, pg_temp.at(d, '20:12:01'));
  if not public.bot_delivery_retry(x, '429', pg_temp.at(d, '20:12:02')) then raise exception 'FAILED: 429: retry 2'; end if;
  select count(*) into n from public.bot_claim_reminders(10, pg_temp.at(d, '20:23')) where chat_id = 1501;
  if n is distinct from 1 or (select attempts from bot.deliveries where id = x) is distinct from 3 then raise exception 'FAILED: 429: try 3'; end if;
  perform public.bot_reminder_context(x);
  perform public.bot_delivery_sending(x, pg_temp.at(d, '20:23:01'));
  if public.bot_delivery_retry(x, '429', pg_temp.at(d, '20:23:02')) then raise exception 'FAILED: 429: a fourth try'; end if;
  if (select row(status, error) from bot.deliveries where id = x) is distinct from row('failed'::text, '429'::text) then
    raise exception 'FAILED: 429: no try left → failed'; end if;
  perform * from public.bot_claim_reminders(10, pg_temp.at(d, '20:40'));
  perform * from public.bot_claim_reminders(10, pg_temp.at(d, '22:30'));
  if (select count(*) from bot.deliveries where chat_id = 1501) is distinct from 1 or (select status from bot.deliveries where id = x) is distinct from 'failed' then
    raise exception 'FAILED: 429: one row for the day, failed'; end if;
  -- a 429 that comes after the window closed, and one for a chat blocked meanwhile: failed at once
  perform pg_temp.link(1502); perform pg_temp.link(1503);
  perform * from public.bot_claim_reminders(10, pg_temp.at(d + 1, '22:58'));
  select id into y from bot.deliveries where chat_id = 1502 and local_day = d + 1;
  select id into z from bot.deliveries where chat_id = 1503 and local_day = d + 1;
  perform public.bot_reminder_context(y); perform public.bot_reminder_context(z);
  perform public.bot_delivery_sending(y, pg_temp.at(d + 1, '22:58:30'));
  perform public.bot_delivery_sending(z, pg_temp.at(d + 1, '22:58:30'));
  ok := public.bot_delivery_retry(y, '429', pg_temp.at(d + 1, '23:00:30'));
  if ok or (select status from bot.deliveries where id = y) is distinct from 'failed' then
    raise exception 'FAILED: 429: after the window'; end if;
  update bot.links set blocked_at = now() where tg_user_id = 1503;
  ok := public.bot_delivery_retry(z, null, pg_temp.at(d + 1, '22:59'));
  if ok or (select row(status, error) from bot.deliveries where id = z) is distinct from row('failed'::text, '429'::text) then
    raise exception 'FAILED: 429: a blocked chat'; end if;
  delete from bot.links where tg_user_id between 1501 and 1503;
end
$t$;
do $t$
declare d date := pg_temp.d(110); l bigint; r record; u uuid; c uuid;
begin
  -- the night's close
  perform pg_temp.link(1601);
  select id into l from bot.links where tg_user_id = 1601;
  insert into bot.days (link_id, local_day, card_message_id) values (l, d, 611);
  select * into r from public.bot_claim_day_close(10, pg_temp.at(d + 1, '00:05'));
  perform public.bot_delivery_sending(r.delivery_id, pg_temp.at(d + 1, '00:05:01'));
  if not public.bot_delivery_retry(r.delivery_id, '429', pg_temp.at(d + 1, '00:05:02')) then raise exception 'FAILED: 429: the close'; end if;
  if (select count(*) from public.bot_claim_day_close(10, pg_temp.at(d + 1, '00:10'))) is distinct from 0 then
    raise exception 'FAILED: 429: the close taken again too early'; end if;
  select * into r from public.bot_claim_day_close(10, pg_temp.at(d + 1, '00:16'));
  if r.card_message_id is distinct from 611::bigint or (select attempts from bot.deliveries where id = r.delivery_id) is distinct from 2 then
    raise exception 'FAILED: 429: the close taken again %', row_to_json(r); end if;
  -- K3
  u := pg_temp.link(1602);
  insert into public.containers (id, owner_id, title, exam_date) values (gen_random_uuid(), u, 'Осенняя сессия', d) returning id into c;
  select * into r from public.bot_claim_after_date(10, pg_temp.at(d + 1, '20:05'));
  if r.chat_id is distinct from 1602::bigint then raise exception 'FAILED: 429: K3 claim %', row_to_json(r); end if;
  perform public.bot_delivery_sending(r.delivery_id, pg_temp.at(d + 1, '20:05:01'));
  if not public.bot_delivery_retry(r.delivery_id, '429', pg_temp.at(d + 1, '20:05:02')) then raise exception 'FAILED: 429: K3'; end if;
  select * into r from public.bot_claim_after_date(10, pg_temp.at(d + 1, '20:16'));
  if r.chat_id is distinct from 1602::bigint or r.exam ->> 'title' is distinct from 'Осенняя сессия'
     or (select attempts from bot.deliveries where id = r.delivery_id) is distinct from 2 then
    raise exception 'FAILED: 429: K3 taken again %', row_to_json(r); end if;
  delete from bot.links where tg_user_id in (1601, 1602);
  delete from public.containers where id = c;
end
$t$;

do $t$ begin raise notice 'TELEGRAM BOT CLAIMS PASSED'; end $t$;
rollback;
