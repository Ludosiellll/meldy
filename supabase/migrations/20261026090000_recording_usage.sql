-- recording_usage: how many seconds of lecture recordings each user sends a day (2026-10-26).
-- Why (the owner, 2026-10-26: «одним запросом можно выжрать весь лимит»): a recording is turned into text by Groq
-- Whisper, whose free plan gives the whole site 7 200 s of audio an hour and 28 800 a day. The backend measures a
-- recording's length before anything is charged (backend/main.py analyze_media, plans.py): one recording is at most
-- 2 hours and costs units by its length; this file adds the third guard, a day's total per user — 2 hours free,
-- 5 hours PRO (plans.RECORDING_DAILY_SECONDS). PRO can be taken without paying (the demo purchase), so the day's
-- total is kept here, not in the server's memory, which a release starts afresh.
--   consume_recording_seconds(p_seconds)  -> {allowed, pro, used, limit, resets_at, charge_id}
--   refund_recording_seconds(p_charge)    -> {refunded}: gives back that one charge of the caller's, within an hour
-- The backend calls both with the user's own token, as consume_ai_units. A refund names a charge id that only the
-- server sees (public.recording_charges has no client grant), so a user cannot zero their own day by hand.
-- Additive and re-runnable: a new table and new functions only. Rollback:
-- supabase/rollback/20261026090000_recording_usage_down.sql. Check: supabase/tests/recording_usage.sql. Local
-- rehearsal: supabase/tests/local/recording_usage_run.sh.

create table if not exists public.recording_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  day date not null,
  seconds integer not null,
  refunded boolean not null default false,
  created_at timestamptz not null default now(),
  constraint recording_charges_seconds_check check (seconds between 1 and 7200)
);
create index if not exists recording_charges_user_day_idx on public.recording_charges (user_id, day);
alter table public.recording_charges enable row level security;
revoke all on table public.recording_charges from public, anon, authenticated;

create or replace function public.consume_recording_seconds(p_seconds integer)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_day date := (pg_catalog.now() at time zone 'UTC')::date;
  v_pro boolean;
  v_limit integer;
  v_used integer;
  v_charge uuid;
begin
  if v_uid is null then
    raise exception 'consume_recording_seconds: no signed-in user' using errcode = '42501';
  end if;
  if p_seconds is null or p_seconds < 1 or p_seconds > 7200 then
    raise exception 'consume_recording_seconds: seconds must be 1..7200' using errcode = '22023';
  end if;
  select coalesce(p.is_pro, false) into v_pro from public.profiles p where p.id = v_uid;
  v_pro := coalesce(v_pro, false);
  -- plans.RECORDING_DAILY_SECONDS: 2 hours free, 5 hours PRO.
  v_limit := case when v_pro then 18000 else 7200 end;

  -- One user's charges in turn: two uploads at once each see the other's seconds.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('recording_charges:' || v_uid::text, 0));
  select coalesce(pg_catalog.sum(c.seconds), 0)::integer into v_used
    from public.recording_charges c
   where c.user_id = v_uid and c.day = v_day and not c.refunded;

  if v_used + p_seconds <= v_limit then
    insert into public.recording_charges (user_id, day, seconds)
    values (v_uid, v_day, p_seconds)
    returning id into v_charge;
    v_used := v_used + p_seconds;
    -- The day's total is all that is needed; older rows of this user go.
    delete from public.recording_charges c where c.user_id = v_uid and c.day < v_day - 2;
  end if;

  return pg_catalog.jsonb_build_object(
    'allowed', v_charge is not null,
    'pro', v_pro,
    'used', v_used,
    'limit', v_limit,
    'resets_at', pg_catalog.to_char(v_day + 1, 'YYYY-MM-DD') || 'T00:00:00Z',
    'charge_id', v_charge);
end
$fn$;

create or replace function public.refund_recording_seconds(p_charge uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_uid uuid := auth.uid();
  v_back integer;
begin
  if v_uid is null then
    raise exception 'refund_recording_seconds: no signed-in user' using errcode = '42501';
  end if;
  if p_charge is null then
    raise exception 'refund_recording_seconds: charge is required' using errcode = '22023';
  end if;
  -- Only the caller's own charge, within an hour, once; an unknown or foreign one gives back nothing and says nothing.
  update public.recording_charges c
     set refunded = true
   where c.id = p_charge and c.user_id = v_uid and not c.refunded
     and c.created_at > pg_catalog.now() - interval '1 hour'
  returning c.seconds into v_back;
  return pg_catalog.jsonb_build_object('refunded', coalesce(v_back, 0));
end
$fn$;

revoke all on function public.consume_recording_seconds(integer) from public, anon;
grant execute on function public.consume_recording_seconds(integer) to authenticated;
revoke all on function public.refund_recording_seconds(uuid) from public, anon;
grant execute on function public.refund_recording_seconds(uuid) to authenticated;
