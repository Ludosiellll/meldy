-- ai_quota_lockdown (part 2 of 2 of the server-side daily AI limit; PENDING, not applied yet)
-- Apply after supabase/migrations/*_ai_quota_server.sql (part 1). It deletes rows and takes back
-- grants, so the Supabase connector asks the owner to confirm it; it did not run unattended on
-- 2026-10-04. How: Supabase dashboard -> SQL Editor -> paste this file -> Run (or let the agent
-- apply it and confirm the prompt). Re-runnable. Then supabase/tests/ai_quota_server.sql must
-- report contract_ok: true. Once applied through the migration tool, move this file to
-- supabase/migrations/ under the version it gets.
-- What it changes:
--   1. duplicate ai_usage day rows are merged into one (there were none on live on 2026-10-04);
--   2. consume_ai_units and log_ai_call also tidy their own old rows: receipts after 2 days,
--      the model log after 90 days;
--   3. browsers lose INSERT, UPDATE, DELETE and TRUNCATE on ai_usage and its client INSERT and
--      UPDATE policies: only the server's functions change the counter; reading own rows stays.
-- Older cached clients that still write ai_usage get a refusal there; it was only their display
-- counter. Rollback: supabase/rollback/20261004205613_ai_quota_server_down.sql (restores the
-- client writes; it also removes part 1's functions).

-- 1. One row per user and day. Duplicate day rows (possible before: the client inserted after a
--    read) are merged into the oldest by summing; then a unique index on (user_id, date), unless an
--    equivalent valid, non-partial unique index already exists (the old client handled 23505).
DO $usage$
DECLARE
  v_has_unique boolean;
BEGIN
  WITH ranked AS (
    SELECT u.id,
           pg_catalog.row_number() OVER (PARTITION BY u.user_id, u.date ORDER BY u.created_at NULLS LAST, u.id) AS rn,
           pg_catalog.count(*) OVER (PARTITION BY u.user_id, u.date) AS copies,
           pg_catalog.sum(GREATEST(COALESCE(u.requests_count, 0), 0)) OVER (PARTITION BY u.user_id, u.date) AS total
      FROM public.ai_usage u
     WHERE u.user_id IS NOT NULL
  ),
  merged AS (
    UPDATE public.ai_usage u
       SET requests_count = LEAST(r.total, 2147483647)::integer
      FROM ranked r
     WHERE u.id = r.id AND r.rn = 1 AND r.copies > 1
    RETURNING u.id
  )
  DELETE FROM public.ai_usage u
   USING ranked r
   WHERE u.id = r.id AND r.rn > 1;

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

-- 2. The two functions again, now with their housekeeping (same signatures and grants).

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
  v_receipts_from timestamptz := pg_catalog.now() - interval '2 days';
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
      -- Receipts are refundable for an hour; older ones of this user are not needed.
      DELETE FROM public.ai_charges c
       WHERE c.user_id = v_uid AND c.created_at < v_receipts_from;
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
  v_kept_from timestamptz := pg_catalog.now() - interval '90 days';
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
  -- The log is for the project owner, not a free store: at most 5000 rows a day per user,
  -- and rows older than 90 days go.
  IF (SELECT pg_catalog.count(*) FROM public.ai_calls c
       WHERE c.user_id = v_uid AND c.created_at > v_day_from) >= 5000 THEN
    RETURN;
  END IF;
  DELETE FROM public.ai_calls c WHERE c.user_id = v_uid AND c.created_at < v_kept_from;
  INSERT INTO public.ai_calls (user_id, kind, units, provider, model, ok, ms)
  VALUES (v_uid, p_kind, p_units, NULLIF(pg_catalog.btrim(p_provider), ''), NULLIF(pg_catalog.btrim(p_model), ''),
          p_ok, p_ms);
END
$fn$;

-- 3. ai_usage: clients read their own day rows and write nothing; the functions above write.
REVOKE ALL ON TABLE public.ai_usage FROM anon, authenticated;
GRANT SELECT ON TABLE public.ai_usage TO authenticated;
ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;

-- The client INSERT and UPDATE policies have nothing left to allow. They go only when the role
-- that owns the functions above is not itself held by ai_usage's RLS (table owner without FORCE
-- ROW LEVEL SECURITY, or BYPASSRLS): otherwise the functions still write through them, and the
-- NOTICE says so. A SELECT policy for the owner's own rows is created only if none exists.
DO $policies$
DECLARE
  v_definer_free boolean;
  v_policy record;
BEGIN
  SELECT r.rolsuper OR r.rolbypassrls
         OR (pg_catalog.pg_has_role(current_user, c.relowner, 'USAGE') AND NOT c.relforcerowsecurity)
    INTO v_definer_free
    FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_roles r ON r.rolname = current_user
   WHERE c.oid = 'public.ai_usage'::pg_catalog.regclass;

  IF COALESCE(v_definer_free, false) THEN
    FOR v_policy IN
      SELECT p.policyname FROM pg_catalog.pg_policies p
       WHERE p.schemaname = 'public' AND p.tablename = 'ai_usage' AND p.cmd IN ('INSERT', 'UPDATE')
    LOOP
      EXECUTE pg_catalog.format('DROP POLICY %I ON public.ai_usage', v_policy.policyname);
    END LOOP;
  ELSE
    RAISE NOTICE 'ai_usage INSERT/UPDATE policies kept: role % is subject to its row security', current_user;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                  WHERE p.schemaname = 'public' AND p.tablename = 'ai_usage' AND p.cmd IN ('SELECT', 'ALL')) THEN
    CREATE POLICY "AI usage: owner reads own days" ON public.ai_usage
      FOR SELECT TO authenticated
      USING ((SELECT auth.uid()) = user_id);
  END IF;
END
$policies$;
