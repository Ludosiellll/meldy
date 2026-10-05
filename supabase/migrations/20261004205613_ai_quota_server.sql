-- ai_quota_server (part 1 of 2: additive)
-- Written on 2026-10-04 by the quota package; applied by the orchestrator to daunnytubqbzafjnpfnw.
-- Additive and re-runnable: new tables, new functions and grants on them only. Nothing here removes
-- rows, takes back an existing grant or drops a policy: those steps are part 2,
-- supabase/migrations/20261005031722_ai_quota_lockdown.sql, which the Supabase connector held for
-- the owner's confirmation; the owner ran it in the SQL Editor on 2026-10-05.
--
-- Why. The daily AI limit was only a hint the browser kept in public.ai_usage: RLS let every user
-- insert and update their own day row (anyone could reset it) and the backend never checked it.
-- Now the backend charges the units before each model call, with the user's own token (it has no
-- service key and keeps it so):
--   consume_ai_units(p_units, p_kind)            -> {allowed, pro, used, limit, resets_at, charge_id}
--   refund_ai_units(p_units, p_kind, p_charge)   -> gives back units of that one charge only
--   ai_quota_status()                            -> {pro, used, limit, day, resets_at} (the meter)
--   ai_daily_limit(p_pro)                        -> 100 free, 1000 PRO (backend/plans.py, lib/plans.ts)
--   log_ai_call(p_kind, p_units, p_provider, p_model, p_ok, p_ms) -> one row of public.ai_calls
-- A refund names a charge id that only the server sees: public.ai_charges has no client grant at
-- all. A refund(units) without it would let every user zero their own counter again.
-- After part 1 the server enforces the limit for every normal request; part 2 also takes the
-- browser's writes off ai_usage, so nobody can lower their own counter by hand.
--
-- Live facts this relies on (read by the orchestrator on 2026-10-04): ai_usage(id uuid default
-- uuid_generate_v4(), user_id uuid null, date date not null, requests_count int default 0,
-- created_at timestamptz default now()) with the unique index ai_usage_user_id_date_key
-- (user_id, date) and no duplicate days; profiles.is_pro boolean default false and not
-- client-writable (20260924055024). The day is the UTC date, as the old client counted it, so
-- today's counts carry over.
-- Rollback: supabase/rollback/20261004205613_ai_quota_server_down.sql. Check after both parts:
-- supabase/tests/ai_quota_server.sql. Local rehearsal: supabase/tests/local/baseline.sql,
-- supabase/tests/local/ai_quota_baseline.sql, this file twice, 20261005031722_ai_quota_lockdown.sql
-- twice, supabase/tests/local/ai_quota_behaviour.sql.

-- 1. One row per user and day: consume_ai_units relies on a unique index on (user_id, date). It is
--    created only when no equivalent valid, non-partial unique index exists (live has one). If a
--    database still had duplicate days, this fails and nothing is applied: part 2 merges them first.
DO $usage$
DECLARE
  v_has_unique boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_index i
     WHERE i.indrelid = 'public.ai_usage'::pg_catalog.regclass
       AND i.indisunique AND i.indisvalid AND i.indpred IS NULL AND i.indexprs IS NULL
       AND i.indnkeyatts = 2
       AND (SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attname::text)
              FROM pg_catalog.pg_attribute a
             WHERE a.attrelid = i.indrelid AND a.attnum = ANY (i.indkey::smallint[])) = ARRAY['date', 'user_id']
  ) INTO v_has_unique;
  IF NOT v_has_unique THEN
    CREATE UNIQUE INDEX IF NOT EXISTS ai_usage_user_day_key ON public.ai_usage (user_id, date);
  END IF;
END
$usage$;

-- 2. Receipts of charges: only the definer functions read and write them.
CREATE TABLE IF NOT EXISTS public.ai_charges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  day date NOT NULL,
  kind text NOT NULL,
  units integer NOT NULL,
  refunded integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_charges_units_check CHECK (units BETWEEN 1 AND 1000),
  CONSTRAINT ai_charges_refunded_check CHECK (refunded BETWEEN 0 AND units)
);
CREATE INDEX IF NOT EXISTS ai_charges_user_created_idx ON public.ai_charges (user_id, created_at);
ALTER TABLE public.ai_charges ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_charges FROM PUBLIC, anon, authenticated;

-- 3. Which model answered: one row per real model call, written by log_ai_call; the owner reads
--    their own rows (and the project owner all of them, in the dashboard).
CREATE TABLE IF NOT EXISTS public.ai_calls (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  kind text NOT NULL,
  units integer NOT NULL DEFAULT 0,
  provider text,
  model text,
  ok boolean NOT NULL,
  ms integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT ai_calls_kind_check CHECK (kind ~ '^[A-Za-z0-9_.:-]{1,40}$'),
  CONSTRAINT ai_calls_units_check CHECK (units BETWEEN 0 AND 1000),
  CONSTRAINT ai_calls_provider_check CHECK (provider IS NULL OR pg_catalog.length(provider) <= 20),
  CONSTRAINT ai_calls_model_check CHECK (model IS NULL OR pg_catalog.length(model) <= 80),
  CONSTRAINT ai_calls_ms_check CHECK (ms IS NULL OR ms BETWEEN 0 AND 3600000)
);
CREATE INDEX IF NOT EXISTS ai_calls_user_created_idx ON public.ai_calls (user_id, created_at DESC);
ALTER TABLE public.ai_calls ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.ai_calls FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.ai_calls TO authenticated;

DO $calls$
BEGIN
  EXECUTE pg_catalog.format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated',
                            pg_catalog.pg_get_serial_sequence('public.ai_calls', 'id'));
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                  WHERE schemaname = 'public' AND tablename = 'ai_calls'
                    AND policyname = 'AI calls: owner reads own') THEN
    CREATE POLICY "AI calls: owner reads own" ON public.ai_calls
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) = user_id);
  END IF;
END
$calls$;

-- 4. Functions. SECURITY DEFINER with a fixed search_path; auth.uid() is the caller's own id.

CREATE OR REPLACE FUNCTION public.ai_daily_limit(p_pro boolean)
RETURNS integer
LANGUAGE sql
IMMUTABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
  -- FREE_DAILY_UNITS / PRO_DAILY_UNITS of backend/plans.py and frontend/src/lib/plans.ts.
  SELECT CASE WHEN COALESCE(p_pro, false) THEN 1000 ELSE 100 END
$fn$;

CREATE OR REPLACE FUNCTION public.ai_quota_status()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_day date := (pg_catalog.now() AT TIME ZONE 'UTC')::date;
  v_pro boolean;
  v_used integer;
  v_limit integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'ai_quota_status: no signed-in user' USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(p.is_pro, false) INTO v_pro FROM public.profiles p WHERE p.id = v_uid;
  v_pro := COALESCE(v_pro, false);
  v_limit := public.ai_daily_limit(v_pro);
  SELECT COALESCE(pg_catalog.sum(GREATEST(COALESCE(u.requests_count, 0), 0)), 0)::integer
    INTO v_used
    FROM public.ai_usage u
   WHERE u.user_id = v_uid AND u.date = v_day;
  RETURN pg_catalog.jsonb_build_object(
    'pro', v_pro,
    'used', v_used,
    'limit', v_limit,
    'day', v_day,
    'resets_at', pg_catalog.to_char(v_day + 1, 'YYYY-MM-DD') || 'T00:00:00Z');
END
$fn$;

CREATE OR REPLACE FUNCTION public.consume_ai_units(p_units integer, p_kind text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_day date := (pg_catalog.now() AT TIME ZONE 'UTC')::date;
  v_pro boolean;
  v_limit integer;
  v_used integer;
  v_allowed boolean;
  v_charge uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'consume_ai_units: no signed-in user' USING ERRCODE = '42501';
  END IF;
  IF p_units IS NULL OR p_units < 0 OR p_units > 1000 THEN
    RAISE EXCEPTION 'consume_ai_units: units must be 0..1000' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind !~ '^[A-Za-z0-9_.:-]{1,40}$' THEN
    RAISE EXCEPTION 'consume_ai_units: kind must be a short identifier' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(p.is_pro, false) INTO v_pro FROM public.profiles p WHERE p.id = v_uid;
  v_pro := COALESCE(v_pro, false);
  v_limit := public.ai_daily_limit(v_pro);

  -- The day row first (a parallel charge may create it: then nothing happens here), then one
  -- guarded UPDATE: concurrent charges serialise on the row and each sees the other's sum.
  INSERT INTO public.ai_usage (user_id, date, requests_count)
  VALUES (v_uid, v_day, 0)
  ON CONFLICT (user_id, date) DO NOTHING;

  UPDATE public.ai_usage u
     SET requests_count = GREATEST(COALESCE(u.requests_count, 0), 0) + p_units
   WHERE u.user_id = v_uid AND u.date = v_day
     AND GREATEST(COALESCE(u.requests_count, 0), 0) + p_units <= v_limit
  RETURNING u.requests_count INTO v_used;
  v_allowed := FOUND;

  IF v_allowed THEN
    IF p_units > 0 THEN
      INSERT INTO public.ai_charges (user_id, day, kind, units)
      VALUES (v_uid, v_day, p_kind, p_units)
      RETURNING id INTO v_charge;
    END IF;
  ELSE
    SELECT GREATEST(COALESCE(u.requests_count, 0), 0) INTO v_used
      FROM public.ai_usage u
     WHERE u.user_id = v_uid AND u.date = v_day;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'allowed', v_allowed,
    'pro', v_pro,
    'used', COALESCE(v_used, 0),
    'limit', v_limit,
    'resets_at', pg_catalog.to_char(v_day + 1, 'YYYY-MM-DD') || 'T00:00:00Z',
    'charge_id', v_charge);
END
$fn$;

CREATE OR REPLACE FUNCTION public.refund_ai_units(p_units integer, p_kind text, p_charge uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_today date := (pg_catalog.now() AT TIME ZONE 'UTC')::date;
  v_charge public.ai_charges%ROWTYPE;
  v_refundable_from timestamptz := pg_catalog.now() - interval '1 hour';
  v_back integer := 0;
  v_pro boolean;
  v_used integer;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'refund_ai_units: no signed-in user' USING ERRCODE = '42501';
  END IF;
  IF p_units IS NULL OR p_units < 1 OR p_units > 1000 THEN
    RAISE EXCEPTION 'refund_ai_units: units must be 1..1000' USING ERRCODE = '22023';
  END IF;
  IF p_kind IS NULL OR p_kind !~ '^[A-Za-z0-9_.:-]{1,40}$' OR p_charge IS NULL THEN
    RAISE EXCEPTION 'refund_ai_units: kind and charge are required' USING ERRCODE = '22023';
  END IF;

  -- Only the caller's own charge of that kind, within an hour, and never more than it spent;
  -- an unknown or foreign charge refunds nothing and says nothing about it.
  SELECT * INTO v_charge
    FROM public.ai_charges c
   WHERE c.id = p_charge AND c.user_id = v_uid AND c.kind = p_kind
     AND c.created_at > v_refundable_from
   FOR UPDATE;
  IF FOUND THEN
    v_back := LEAST(p_units, v_charge.units - v_charge.refunded);
    IF v_back > 0 THEN
      UPDATE public.ai_charges SET refunded = refunded + v_back WHERE id = v_charge.id;
      -- The day of the charge, not today's: a refund after midnight UTC fixes the right day.
      UPDATE public.ai_usage u
         SET requests_count = GREATEST(COALESCE(u.requests_count, 0) - v_back, 0)
       WHERE u.user_id = v_uid AND u.date = v_charge.day;
    END IF;
  END IF;

  SELECT COALESCE(p.is_pro, false) INTO v_pro FROM public.profiles p WHERE p.id = v_uid;
  SELECT COALESCE(pg_catalog.sum(GREATEST(COALESCE(u.requests_count, 0), 0)), 0)::integer
    INTO v_used
    FROM public.ai_usage u
   WHERE u.user_id = v_uid AND u.date = v_today;
  RETURN pg_catalog.jsonb_build_object(
    'refunded', v_back,
    'used', v_used,
    'limit', public.ai_daily_limit(COALESCE(v_pro, false)),
    'resets_at', pg_catalog.to_char(v_today + 1, 'YYYY-MM-DD') || 'T00:00:00Z');
END
$fn$;

CREATE OR REPLACE FUNCTION public.log_ai_call(
  p_kind text, p_units integer, p_provider text, p_model text, p_ok boolean, p_ms integer)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_day_from timestamptz := pg_catalog.now() - interval '1 day';
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'log_ai_call: no signed-in user' USING ERRCODE = '42501';
  END IF;
  IF p_kind IS NULL OR p_kind !~ '^[A-Za-z0-9_.:-]{1,40}$'
     OR p_units IS NULL OR p_units < 0 OR p_units > 1000
     OR p_ok IS NULL
     OR (p_provider IS NOT NULL AND pg_catalog.length(p_provider) > 20)
     OR (p_model IS NOT NULL AND pg_catalog.length(p_model) > 80)
     OR (p_ms IS NOT NULL AND (p_ms < 0 OR p_ms > 3600000)) THEN
    RAISE EXCEPTION 'log_ai_call: bad arguments' USING ERRCODE = '22023';
  END IF;
  -- The log is for the project owner, not a free store: at most 5000 rows a day per user
  -- (part 2 also removes rows older than 90 days).
  IF (SELECT pg_catalog.count(*) FROM public.ai_calls c
       WHERE c.user_id = v_uid AND c.created_at > v_day_from) >= 5000 THEN
    RETURN;
  END IF;
  INSERT INTO public.ai_calls (user_id, kind, units, provider, model, ok, ms)
  VALUES (v_uid, p_kind, p_units, NULLIF(pg_catalog.btrim(p_provider), ''), NULLIF(pg_catalog.btrim(p_model), ''),
          p_ok, p_ms);
END
$fn$;

REVOKE ALL ON FUNCTION public.ai_daily_limit(boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.ai_quota_status() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.consume_ai_units(integer, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.refund_ai_units(integer, text, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.log_ai_call(text, integer, text, text, boolean, integer) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ai_daily_limit(boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ai_quota_status() TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_ai_units(integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.refund_ai_units(integer, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_ai_call(text, integer, text, text, boolean, integer) TO authenticated;
