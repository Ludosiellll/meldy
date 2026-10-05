-- app_telemetry
-- Repo file: supabase/migrations/20261005120000_app_telemetry.sql (the orchestrator applies it and renames it
-- to the version apply_migration records). Written on 2026-10-05.
--
-- First-party error reports and product statistics, kept in this project's own database: no third-party
-- service, nothing leaves the site and this database (152-FZ, and the production CSP allows only 'self' and
-- *.supabase.co anyway).
--
-- Write path. public.app_events gets rows only through public.log_app_events(p_events jsonb), a SECURITY
-- DEFINER function that anon and authenticated may execute. The backend (backend/telemetry_api.py, POST
-- /api/telemetry) calls it with the visitor's own token, or with the anon key for a signed-out visitor; the
-- server's own errors (kind server_error) go the same way. The function:
--   * takes at most the first 50 elements of the array; every element is checked and clamped, and an element
--     without a valid kind and name is dropped silently;
--   * sets user_id from auth.uid() itself (never from the client) and created_at to the server's time;
--   * keeps at most 3000 rows a day (UTC) per account and 50000 anonymous rows a day in all, counted with a
--     bounded index-only scan; what does not fit is dropped;
--   * returns the number of rows stored.
-- The table has RLS on and no grant to anon or authenticated at all: clients cannot read or write it directly.
--
-- Read path. The project owner reads the views of the schema analytics in the SQL Editor (as postgres):
-- analytics.daily_funnel, analytics.retention, analytics.top_errors, analytics.events_daily. The schema is not
-- in the API's exposed schemas, and anon / authenticated have no USAGE on it and no privilege on its views.
-- The views are security_invoker, so a grant given by mistake later would still not open the base tables.
-- Days in the views are Moscow calendar days. Ready queries: docs/analytics.md.
--
-- Additive and re-runnable: a new table, indexes, function, schema and views only (IF NOT EXISTS, CREATE OR
-- REPLACE). Every REVOKE below names one of these new objects. No existing object, grant, policy or row is
-- changed. Nothing is deleted: removing old rows (docs/analytics.md suggests 180 days) is a separate,
-- human-run statement.
--
-- Live facts this relies on: auth.users(id uuid, created_at timestamptz); public.materials(user_id,
-- created_at, original_text) as the baseline; public.exams(user_id, created_at) and
-- public.learning_events(user_id, kind, created_at) from 20261003083154_hackathon_journal_exams_oral.sql.
-- The schema analytics does not exist on the live project before this migration (checked by the orchestrator
-- before the apply: select 1 from pg_namespace where nspname = 'analytics').
-- Rollback: supabase/rollback/20261005120000_app_telemetry_down.sql. Contract check after the apply:
-- supabase/tests/app_telemetry.sql. Local rehearsal: supabase/tests/local/baseline.sql,
-- 20261003083154_hackathon_journal_exams_oral.sql, supabase/tests/local/app_telemetry_baseline.sql, this file
-- twice, supabase/tests/local/app_telemetry_behaviour.sql, supabase/tests/app_telemetry.sql.

-- 1. The events. One row per event; written only by log_app_events below.
CREATE TABLE IF NOT EXISTS public.app_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  kind text NOT NULL,
  name text NOT NULL,
  route text,
  session text,
  user_id uuid REFERENCES auth.users (id) ON DELETE SET NULL,
  device text,
  app_version text,
  props jsonb NOT NULL DEFAULT '{}'::jsonb,
  message text,
  stack text,
  CONSTRAINT app_events_kind_check CHECK (kind IN ('event', 'client_error', 'server_error')),
  CONSTRAINT app_events_name_check CHECK (name ~ '^[a-z0-9_.:-]{1,60}$'),
  CONSTRAINT app_events_route_check
    CHECK (route IS NULL OR (pg_catalog.length(route) <= 120 AND route ~ '^/[A-Za-z0-9/:_.{}*-]*$')),
  CONSTRAINT app_events_session_check CHECK (session IS NULL OR session ~ '^[A-Za-z0-9_-]{1,40}$'),
  CONSTRAINT app_events_device_check CHECK (device IS NULL OR device IN ('mobile', 'tablet', 'desktop')),
  CONSTRAINT app_events_app_version_check CHECK (app_version IS NULL OR app_version ~ '^[A-Za-z0-9._+-]{1,40}$'),
  CONSTRAINT app_events_props_check
    CHECK (pg_catalog.jsonb_typeof(props) = 'object' AND pg_catalog.octet_length(props::text) <= 2048),
  CONSTRAINT app_events_message_check CHECK (message IS NULL OR pg_catalog.length(message) <= 500),
  CONSTRAINT app_events_stack_check CHECK (stack IS NULL OR pg_catalog.length(stack) <= 4000)
);

COMMENT ON TABLE public.app_events IS
  'First-party statistics and error reports (docs/analytics.md). Written only by log_app_events(); read by the owner through the analytics views.';

-- The views scan by time; the caps count today's rows of one account or of all anonymous visitors; an error
-- id the student quotes («Код ошибки: …») finds its server event.
CREATE INDEX IF NOT EXISTS app_events_created_idx ON public.app_events (created_at);
CREATE INDEX IF NOT EXISTS app_events_user_created_idx ON public.app_events (user_id, created_at)
  WHERE user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS app_events_anon_created_idx ON public.app_events (created_at)
  WHERE user_id IS NULL;
CREATE INDEX IF NOT EXISTS app_events_error_id_idx ON public.app_events ((props ->> 'error_id'))
  WHERE (props ->> 'error_id') IS NOT NULL;

ALTER TABLE public.app_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.app_events FROM PUBLIC, anon, authenticated;

DO $seq$
BEGIN
  EXECUTE pg_catalog.format('REVOKE ALL ON SEQUENCE %s FROM PUBLIC, anon, authenticated',
                            pg_catalog.pg_get_serial_sequence('public.app_events', 'id'));
END
$seq$;

-- 2. The only way in.
CREATE OR REPLACE FUNCTION public.log_app_events(p_events jsonb)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  -- Today in UTC, as a timestamptz, for the daily caps.
  v_day_start timestamptz := pg_catalog.date_trunc('day', pg_catalog.now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC';
  v_count integer;
  v_used integer;
  v_room integer;
  v_stored integer := 0;
BEGIN
  IF p_events IS NULL OR pg_catalog.jsonb_typeof(p_events) <> 'array' THEN
    RETURN 0;
  END IF;
  v_count := LEAST(pg_catalog.jsonb_array_length(p_events), 50);
  IF v_count = 0 THEN
    RETURN 0;
  END IF;

  -- A token of an account deleted after it was issued: its events are kept without the account.
  IF v_uid IS NOT NULL AND NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = v_uid) THEN
    v_uid := NULL;
  END IF;

  -- The caps: today's rows of this account (3000) or of all anonymous visitors (50000). The inner LIMIT keeps
  -- the count an index-only scan of at most that many entries.
  IF v_uid IS NOT NULL THEN
    SELECT pg_catalog.count(*)::integer INTO v_used
      FROM (SELECT 1 FROM public.app_events e
             WHERE e.user_id = v_uid AND e.created_at >= v_day_start
             LIMIT 3000) AS today;
    v_room := 3000 - v_used;
  ELSE
    SELECT pg_catalog.count(*)::integer INTO v_used
      FROM (SELECT 1 FROM public.app_events e
             WHERE e.user_id IS NULL AND e.created_at >= v_day_start
             LIMIT 50000) AS today;
    v_room := 50000 - v_used;
  END IF;
  IF v_room <= 0 THEN
    RETURN 0;
  END IF;

  INSERT INTO public.app_events (kind, name, route, session, user_id, device, app_version, props, message, stack)
  SELECT c.kind, c.name, c.route, c.session, v_uid, c.device, c.app_version, c.props,
         CASE WHEN c.kind <> 'event' THEN c.message END,
         CASE WHEN c.kind <> 'event' THEN c.stack END
    FROM (
      SELECT g.i,
             CASE WHEN pg_catalog.jsonb_typeof(x.ev -> 'kind') = 'string'
                       AND (x.ev ->> 'kind') IN ('event', 'client_error', 'server_error')
                  THEN x.ev ->> 'kind' END AS kind,
             CASE WHEN pg_catalog.jsonb_typeof(x.ev -> 'name') = 'string'
                       AND (x.ev ->> 'name') ~ '^[a-z0-9_.:-]{1,60}$'
                  THEN x.ev ->> 'name' END AS name,
             CASE WHEN pg_catalog.jsonb_typeof(x.ev -> 'route') = 'string'
                       AND pg_catalog.length(x.ev ->> 'route') <= 120
                       AND (x.ev ->> 'route') ~ '^/[A-Za-z0-9/:_.{}*-]*$'
                  THEN x.ev ->> 'route' END AS route,
             CASE WHEN pg_catalog.jsonb_typeof(x.ev -> 'session') = 'string'
                       AND (x.ev ->> 'session') ~ '^[A-Za-z0-9_-]{1,40}$'
                  THEN x.ev ->> 'session' END AS session,
             CASE WHEN pg_catalog.jsonb_typeof(x.ev -> 'device') = 'string'
                       AND (x.ev ->> 'device') IN ('mobile', 'tablet', 'desktop')
                  THEN x.ev ->> 'device' END AS device,
             CASE WHEN pg_catalog.jsonb_typeof(x.ev -> 'app_version') = 'string'
                       AND (x.ev ->> 'app_version') ~ '^[A-Za-z0-9._+-]{1,40}$'
                  THEN x.ev ->> 'app_version' END AS app_version,
             CASE WHEN pg_catalog.jsonb_typeof(x.ev -> 'props') = 'object'
                       AND pg_catalog.octet_length((x.ev -> 'props')::text) <= 2048
                  THEN x.ev -> 'props' ELSE '{}'::jsonb END AS props,
             CASE WHEN pg_catalog.jsonb_typeof(x.ev -> 'message') = 'string'
                  THEN NULLIF(pg_catalog.left(pg_catalog.btrim(x.ev ->> 'message'), 500), '') END AS message,
             CASE WHEN pg_catalog.jsonb_typeof(x.ev -> 'stack') = 'string'
                  THEN NULLIF(pg_catalog.left(x.ev ->> 'stack', 4000), '') END AS stack
        FROM pg_catalog.generate_series(0, v_count - 1) AS g (i)
        CROSS JOIN LATERAL (SELECT p_events -> g.i AS ev) AS x
       WHERE pg_catalog.jsonb_typeof(x.ev) = 'object'
    ) AS c
   WHERE c.kind IS NOT NULL AND c.name IS NOT NULL
   ORDER BY c.i
   LIMIT v_room;
  GET DIAGNOSTICS v_stored = ROW_COUNT;
  RETURN v_stored;
END
$fn$;

COMMENT ON FUNCTION public.log_app_events(jsonb) IS
  'Stores up to 50 checked events for the caller (user_id from auth.uid()); caps 3000 rows a day per account, 50000 anonymous rows a day. Returns the number stored.';

REVOKE ALL ON FUNCTION public.log_app_events(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_app_events(jsonb) TO anon, authenticated;

-- 3. The owner's reading: a schema outside the API.
CREATE SCHEMA IF NOT EXISTS analytics;
COMMENT ON SCHEMA analytics IS
  'Owner-only views over app_events and the learning tables (docs/analytics.md). Not exposed to the API.';
REVOKE ALL ON SCHEMA analytics FROM PUBLIC, anon, authenticated;

-- 3a. Product events by name and day (the last 90 days).
CREATE OR REPLACE VIEW analytics.events_daily WITH (security_invoker = true) AS
SELECT (e.created_at AT TIME ZONE 'Europe/Moscow')::date AS day,
       e.kind,
       e.name,
       pg_catalog.count(*) AS events,
       pg_catalog.count(DISTINCT e.session) AS sessions,
       pg_catalog.count(DISTINCT e.user_id) AS users
  FROM public.app_events e
 WHERE e.created_at >= pg_catalog.now() - interval '90 days'
 GROUP BY 1, 2, 3;

-- 3b. The daily funnel (the last 90 days): visits and /try from the events, the steps of a student from the
--     tables that already record them (the first lecture with text, the first exam, the first answered ticket),
--     each counted on the day it happened for the first time.
CREATE OR REPLACE VIEW analytics.daily_funnel WITH (security_invoker = true) AS
WITH days AS (
  SELECT d::date AS day
    FROM pg_catalog.generate_series((pg_catalog.now() AT TIME ZONE 'Europe/Moscow')::date - 89,
                                    (pg_catalog.now() AT TIME ZONE 'Europe/Moscow')::date,
                                    interval '1 day') AS d
),
events AS (
  SELECT (e.created_at AT TIME ZONE 'Europe/Moscow')::date AS day,
         pg_catalog.count(DISTINCT e.session) FILTER (WHERE e.name = 'page_view') AS visits,
         pg_catalog.count(DISTINCT e.session) FILTER (WHERE e.name = 'try_opened') AS try_opened
    FROM public.app_events e
   WHERE e.kind = 'event' AND e.created_at >= pg_catalog.now() - interval '91 days'
   GROUP BY 1
),
signups AS (
  SELECT (u.created_at AT TIME ZONE 'Europe/Moscow')::date AS day, pg_catalog.count(*) AS signups
    FROM auth.users u
   WHERE u.created_at >= pg_catalog.now() - interval '91 days'
   GROUP BY 1
),
first_lecture AS (
  SELECT (f.first_at AT TIME ZONE 'Europe/Moscow')::date AS day, pg_catalog.count(*) AS users
    FROM (SELECT m.user_id, pg_catalog.min(m.created_at) AS first_at
            FROM public.materials m
           WHERE m.original_text <> ''
           GROUP BY m.user_id) f
   GROUP BY 1
),
first_exam AS (
  SELECT (f.first_at AT TIME ZONE 'Europe/Moscow')::date AS day, pg_catalog.count(*) AS users
    FROM (SELECT x.user_id, pg_catalog.min(x.created_at) AS first_at
            FROM public.exams x
           GROUP BY x.user_id) f
   GROUP BY 1
),
first_ticket AS (
  SELECT (f.first_at AT TIME ZONE 'Europe/Moscow')::date AS day, pg_catalog.count(*) AS users
    FROM (SELECT l.user_id, pg_catalog.min(l.created_at) AS first_at
            FROM public.learning_events l
           WHERE l.kind = 'exam_answer'
           GROUP BY l.user_id) f
   GROUP BY 1
)
SELECT d.day,
       COALESCE(ev.visits, 0) AS visits,
       COALESCE(ev.try_opened, 0) AS try_opened,
       COALESCE(s.signups, 0) AS signups,
       COALESCE(fl.users, 0) AS first_lecture,
       COALESCE(fe.users, 0) AS first_exam,
       COALESCE(ft.users, 0) AS first_ticket
  FROM days d
  LEFT JOIN events ev ON ev.day = d.day
  LEFT JOIN signups s ON s.day = d.day
  LEFT JOIN first_lecture fl ON fl.day = d.day
  LEFT JOIN first_exam fe ON fe.day = d.day
  LEFT JOIN first_ticket ft ON ft.day = d.day;

-- 3c. Retention by sign-up day (the last 90 days): who came back on the 1st, 2nd and 7th day after it. Coming
--     back is any journal entry (learning_events) or any product event (app_events) of that day. A share is
--     null until that day has come.
CREATE OR REPLACE VIEW analytics.retention WITH (security_invoker = true) AS
WITH cohort AS (
  SELECT u.id AS user_id, (u.created_at AT TIME ZONE 'Europe/Moscow')::date AS signup_day
    FROM auth.users u
   WHERE u.created_at >= pg_catalog.now() - interval '90 days'
),
active AS (
  SELECT l.user_id, (l.created_at AT TIME ZONE 'Europe/Moscow')::date AS day
    FROM public.learning_events l
    JOIN cohort c ON c.user_id = l.user_id
  UNION
  SELECT a.user_id, (a.created_at AT TIME ZONE 'Europe/Moscow')::date AS day
    FROM public.app_events a
    JOIN cohort c ON c.user_id = a.user_id
   WHERE a.kind = 'event'
),
per_user AS (
  SELECT c.user_id, c.signup_day,
         COALESCE(pg_catalog.bool_or(a.day = c.signup_day + 1), false) AS day1,
         COALESCE(pg_catalog.bool_or(a.day = c.signup_day + 2), false) AS day2,
         COALESCE(pg_catalog.bool_or(a.day = c.signup_day + 7), false) AS day7
    FROM cohort c
    LEFT JOIN active a ON a.user_id = c.user_id
   GROUP BY c.user_id, c.signup_day
),
today AS (
  SELECT (pg_catalog.now() AT TIME ZONE 'Europe/Moscow')::date AS day
)
SELECT p.signup_day,
       pg_catalog.count(*) AS signups,
       pg_catalog.count(*) FILTER (WHERE p.day1) AS day1_active,
       pg_catalog.count(*) FILTER (WHERE p.day2) AS day2_active,
       pg_catalog.count(*) FILTER (WHERE p.day7) AS day7_active,
       CASE WHEN p.signup_day + 1 <= t.day
            THEN pg_catalog.round(100.0 * pg_catalog.count(*) FILTER (WHERE p.day1) / pg_catalog.count(*), 1) END AS day1_pct,
       CASE WHEN p.signup_day + 2 <= t.day
            THEN pg_catalog.round(100.0 * pg_catalog.count(*) FILTER (WHERE p.day2) / pg_catalog.count(*), 1) END AS day2_pct,
       CASE WHEN p.signup_day + 7 <= t.day
            THEN pg_catalog.round(100.0 * pg_catalog.count(*) FILTER (WHERE p.day7) / pg_catalog.count(*), 1) END AS day7_pct
  FROM per_user p
 CROSS JOIN today t
 GROUP BY p.signup_day, t.day;

-- 3d. The errors of the last 30 days, grouped by kind, name and message: how often, for how many sessions and
--     accounts, first and last seen, and the latest one's route, error id and stack.
CREATE OR REPLACE VIEW analytics.top_errors WITH (security_invoker = true) AS
WITH grouped AS (
  SELECT e.kind, e.name, e.message,
         pg_catalog.count(*) AS events,
         pg_catalog.count(DISTINCT e.session) AS sessions,
         pg_catalog.count(DISTINCT e.user_id) AS users,
         pg_catalog.min(e.created_at) AS first_seen,
         pg_catalog.max(e.created_at) AS last_seen,
         pg_catalog.max(e.id) AS last_id
    FROM public.app_events e
   WHERE e.kind IN ('client_error', 'server_error')
     AND e.created_at >= pg_catalog.now() - interval '30 days'
   GROUP BY e.kind, e.name, e.message
)
SELECT g.kind, g.name, g.message, g.events, g.sessions, g.users, g.first_seen, g.last_seen,
       s.route AS last_route,
       s.app_version AS last_app_version,
       s.props ->> 'error_id' AS last_error_id,
       s.stack AS sample_stack
  FROM grouped g
  LEFT JOIN public.app_events s ON s.id = g.last_id;

REVOKE ALL ON TABLE analytics.events_daily, analytics.daily_funnel, analytics.retention, analytics.top_errors
  FROM PUBLIC, anon, authenticated;
