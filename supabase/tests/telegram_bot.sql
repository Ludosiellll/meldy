-- Run after migrations *_telegram_bot.sql, *_telegram_bot_cron.sql and *_telegram_bot_revokes.sql: the single read-only
-- check of that apply (spec §8.2 «Контракт»). ONE SELECT returning ONE JSON object (column telegram_bot). It never
-- raises: a missing schema, table, column, function or the cron schema reads as false or null, so the report always
-- comes back (also before the migration). Catalog only (pg_catalog, plus cron.job and
-- supabase_migrations.schema_migrations when they exist) and a few counts; no row content leaves the database: no
-- token, no URL, no Telegram id.
-- contract_ok is true when every check holds; failed names the checks that do not. Between the main file and the
-- revokes file exactly three checks fail — what Supabase's default privileges (and PostgreSQL's PUBLIC EXECUTE on new
-- functions) give clients, which the revokes file takes back: bot_functions_closed_to_clients,
-- site_functions_authenticated_only, bot_helpers_closed_to_clients. Safety does not depend on them: every bot_* checks
-- the service role first, every telegram_* checks auth.uid(), schema bot has no USAGE for clients.
-- Checks (T1; what the Edge Function `telegram` and the site depend on):
--   * schema bot exists and anon/authenticated have no USAGE or CREATE on it;
--   * T1's tables exist with row security on, no policy in schema bot, no client privilege on any of its tables;
--   * every bot_* function: SECURITY DEFINER, search_path empty, meldy_private.require_service_role() its first
--     statement, not executable by anon or authenticated, executable by service_role;
--   * every telegram_* function: SECURITY DEFINER, search_path empty, executable by authenticated, not by anon;
--   * the helpers of schema bot (bot.tick, bot.tick_mode, bot.tick_due, bot.active_link, bot.local_day, …): present,
--     search_path empty, closed to clients; bot.tick is SECURITY DEFINER;
--   * the cron job meldy-telegram-tick runs `select bot.tick()` every minute; net.http_post exists;
--   * the uniqueness of spec §6.2 / §6.5: one active link per user and per Telegram account; deliveries unique (kind,
--     chat_id, local_day, ref) NULLS NOT DISTINCT and one day card (reminder | ask) per chat and day; the ledger key;
--     days per (link, local day); codes by hash;
--   * the delivery and ledger states; bot.config has its one row;
--   * bot_today and the night's close can read package T5's bot.sessions when it exists (user_id, status, chat_id,
--     message_id).
-- Later packages add their names to the lists below (marked T5 / T7 / T9) and their own checks in the reserved ranges
-- (T5: 30–49, T7: 50–69, T9: 70–89). Local rehearsal of the behaviour: supabase/tests/local/telegram_bot_run.sh.
WITH
-- ── the lists (one line per object; later packages append theirs) ──────────────────────────────────────────────────────
bot_tables(pkg, name) AS (VALUES
  ('T1', 'config'), ('T1', 'link_codes'), ('T1', 'links'), ('T1', 'updates'), ('T1', 'claim_failures'),
  ('T1', 'deliveries'), ('T1', 'days'), ('T1', 'usage')
  -- T5: , ('T5', 'sessions')
  -- T7: , ('T7', 'groups'), ('T7', 'group_posts'), ('T7', 'group_answers')
  -- T9: , ('T9', 'files')
),
bot_fns(pkg, sig) AS (VALUES
  ('T1', 'bot_setup(text,bigint,text,text,text)'), ('T1', 'bot_update_begin(bigint,timestamptz)'),
  ('T1', 'bot_update_done(bigint)'), ('T1', 'bot_update_failed(bigint,text)'), ('T1', 'bot_tick_beat(jsonb)'),
  ('T1', 'bot_status()'), ('T1', 'bot_link_claim(text,bigint,bigint,text,timestamptz)'),
  ('T1', 'bot_chat_event(bigint,text)'), ('T1', 'bot_whoami(bigint)'), ('T1', 'bot_settings(bigint,jsonb)'),
  ('T1', 'bot_today(bigint)'), ('T1', 'bot_card_sent(bigint,bigint,text)'),
  ('T1', 'bot_claim_reminders(integer,timestamptz)'), ('T1', 'bot_reminder_context(bigint)'),
  ('T1', 'bot_delivery_sending(bigint,timestamptz)'), ('T1', 'bot_delivery_done(bigint,text,bigint,text,timestamptz)'),
  ('T1', 'bot_claim_day_close(integer,timestamptz)'), ('T1', 'bot_claim_after_date(integer,timestamptz)')
  -- T5: , ('T5', 'bot_session_start(…)'), ('T5', 'bot_session_view(…)'), ('T5', 'bot_session_answer(…)'), …
  -- T7: , ('T7', 'bot_group_claim(…)'), …
  -- T9: , ('T9', 'bot_file_offer(…)'), ('T9', 'bot_file_redeem(…)')
),
site_fns(pkg, sig) AS (VALUES
  ('T1', 'telegram_link_start(text)'), ('T1', 'telegram_link_state()'), ('T1', 'telegram_settings(boolean,time,text)'),
  ('T1', 'telegram_unlink()')
  -- T7: , ('T7', 'telegram_group_code(…)'), ('T7', 'telegram_groups(…)'), ('T7', 'telegram_group_set(…)')
  -- T9: , ('T9', 'telegram_file_take(…)')
),
helpers(pkg, sig) AS (VALUES
  ('T1', 'tick(timestamptz)'), ('T1', 'tick_mode(timestamptz)'), ('T1', 'tick_due(timestamptz)'),
  ('T1', 'active_link(bigint)'), ('T1', 'local_day(text,timestamptz)'), ('T1', 'tz_ok(text)'),
  ('T1', 'in_window(timestamp,time)'), ('T1', 'recently_active(uuid,timestamptz,date)'),
  ('T1', 'answered_since(uuid,timestamptz)'), ('T1', 'link_json(bot.links,timestamptz)'), ('T1', 'exams_json(uuid)'),
  ('T1', 'site_state(uuid)'), ('T1', 'calls_json(timestamptz)'), ('T1', 'sweep(text[],timestamptz)'),
  ('T1', 'after_date_json(uuid,uuid,date)'), ('T1', 'session_message(bigint,bigint)'), ('T1', 'cleanup(timestamptz)')
  -- T5 / T7 / T9: their helpers of schema bot
),
-- ── the catalog ─────────────────────────────────────────────────────────────────────────────────────────────────────────
schema_bot AS (SELECT n.oid FROM pg_catalog.pg_namespace n WHERE n.nspname = 'bot'),
rels AS (
  SELECT t.pkg, t.name, c.oid, c.relrowsecurity
    FROM bot_tables t
    LEFT JOIN pg_catalog.pg_class c ON c.relname = t.name AND c.relnamespace = (SELECT oid FROM schema_bot)
                                    AND c.relkind IN ('r', 'p')
),
fns AS (
  SELECT f.pkg, f.sig, p.oid, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS config, p.prosrc
    FROM bot_fns f LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure('public.' || f.sig)
),
sites AS (
  SELECT f.pkg, f.sig, p.oid, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS config
    FROM site_fns f LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure('public.' || f.sig)
),
-- to_regprocedure reads a missing schema or argument type (bot.links) as null, never as an error.
helper_fns AS (
  SELECT h.pkg, h.sig, p.oid, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS config
    FROM helpers h LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure('bot.' || h.sig)
),
all_bot_schema_fns AS (
  SELECT p.oid FROM pg_catalog.pg_proc p WHERE p.pronamespace = (SELECT oid FROM schema_bot)
),
idx AS (
  SELECT c.relname AS tbl, pg_catalog.pg_get_indexdef(i.indexrelid) AS def, i.indisunique
    FROM pg_catalog.pg_index i JOIN pg_catalog.pg_class c ON c.oid = i.indrelid
   WHERE c.relnamespace = (SELECT oid FROM schema_bot)
),
cons AS (
  SELECT c.relname AS tbl, k.contype, pg_catalog.pg_get_constraintdef(k.oid) AS def
    FROM pg_catalog.pg_constraint k JOIN pg_catalog.pg_class c ON c.oid = k.conrelid
   WHERE c.relnamespace = (SELECT oid FROM schema_bot)
),
session_cols AS (
  SELECT a.attname FROM pg_catalog.pg_attribute a
   WHERE a.attrelid = pg_catalog.to_regclass('bot.sessions') AND a.attnum > 0 AND NOT a.attisdropped
),
-- Counts through query_to_xml, each only when its object exists: a missing one reads as null, not an error.
counts AS (
  SELECT
    CASE WHEN pg_catalog.to_regclass('cron.job') IS NOT NULL THEN
      ((pg_catalog.xpath('/row/n/text()', pg_catalog.query_to_xml(
        'select count(*) as n from cron.job where jobname = ''meldy-telegram-tick'' and schedule = ''* * * * *''
            and command = ''select bot.tick()'' and active', false, true, '')))[1])::text::bigint
    END AS tick_jobs,
    CASE WHEN (SELECT oid FROM rels WHERE name = 'config') IS NOT NULL THEN
      ((pg_catalog.xpath('/row/n/text()', pg_catalog.query_to_xml(
        'select count(*) as n from bot.config', false, true, '')))[1])::text::bigint
    END AS config_rows,
    CASE WHEN (SELECT oid FROM rels WHERE name = 'config') IS NOT NULL THEN
      ((pg_catalog.xpath('/row/n/text()', pg_catalog.query_to_xml(
        'select count(*) as n from bot.config where function_url is not null and tick_token is not null', false, true, '')))[1])::text::bigint
    END AS configured,
    CASE WHEN (SELECT oid FROM rels WHERE name = 'links') IS NOT NULL THEN
      ((pg_catalog.xpath('/row/n/text()', pg_catalog.query_to_xml(
        'select count(*) as n from bot.links where unlinked_at is null', false, true, '')))[1])::text::bigint
    END AS active_links
),
checks (ord, name, ok) AS (
  -- ── T1: 1–29 ──
  SELECT 1, 'schema_bot_closed',
         EXISTS (SELECT 1 FROM schema_bot)
         AND NOT pg_catalog.has_schema_privilege('anon', (SELECT oid FROM schema_bot), 'USAGE')
         AND NOT pg_catalog.has_schema_privilege('authenticated', (SELECT oid FROM schema_bot), 'USAGE')
         AND NOT pg_catalog.has_schema_privilege('anon', (SELECT oid FROM schema_bot), 'CREATE')
         AND NOT pg_catalog.has_schema_privilege('authenticated', (SELECT oid FROM schema_bot), 'CREATE')
  UNION ALL
  SELECT 2, 'tables_with_row_security',
         coalesce((SELECT pg_catalog.bool_and(oid IS NOT NULL AND relrowsecurity) FROM rels), false)
  UNION ALL
  SELECT 3, 'no_policy_in_schema_bot',
         EXISTS (SELECT 1 FROM schema_bot)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname = 'bot')
  UNION ALL
  SELECT 4, 'tables_closed_to_clients',
         (SELECT pg_catalog.count(*) FROM rels WHERE oid IS NULL) = 0
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c, (VALUES ('anon'), ('authenticated')) r(role),
                                       (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
                          WHERE c.relnamespace = (SELECT oid FROM schema_bot) AND c.relkind IN ('r', 'p', 'v', 'm')
                            AND pg_catalog.has_table_privilege(r.role, c.oid, p.priv))
  UNION ALL
  SELECT 5, 'bot_functions_definer_empty_search_path',
         coalesce((SELECT pg_catalog.bool_and(oid IS NOT NULL AND prosecdef AND config IN ('search_path=""', 'search_path='))
                     FROM fns), false)
  UNION ALL
  SELECT 6, 'bot_functions_gate_first',
         coalesce((SELECT pg_catalog.bool_and(oid IS NOT NULL
                     AND pg_catalog.regexp_instr(prosrc, '\mbegin\M', 1, 1, 0, 'i') > 0
                     AND pg_catalog.substr(prosrc, pg_catalog.regexp_instr(prosrc, '\mbegin\M', 1, 1, 0, 'i'))
                         ~* '^begin\s+perform\s+meldy_private\.require_service_role\(\s*\)\s*;')
                     FROM fns), false)
  UNION ALL
  SELECT 7, 'bot_functions_closed_to_clients',
         coalesce((SELECT pg_catalog.bool_and(oid IS NOT NULL
                     AND NOT pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')
                     AND NOT pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE'))
                     FROM fns), false)
  UNION ALL
  SELECT 8, 'service_role_runs_bot_functions',
         coalesce((SELECT pg_catalog.bool_and(oid IS NOT NULL AND pg_catalog.has_function_privilege('service_role', oid, 'EXECUTE'))
                     FROM fns), false)
  UNION ALL
  SELECT 9, 'site_functions_definer_empty_search_path',
         coalesce((SELECT pg_catalog.bool_and(oid IS NOT NULL AND prosecdef AND config IN ('search_path=""', 'search_path='))
                     FROM sites), false)
  UNION ALL
  SELECT 10, 'site_functions_authenticated_only',
         coalesce((SELECT pg_catalog.bool_and(oid IS NOT NULL
                     AND pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')
                     AND NOT pg_catalog.has_function_privilege('anon', oid, 'EXECUTE'))
                     FROM sites), false)
  UNION ALL
  SELECT 11, 'bot_helpers_present_empty_search_path',
         coalesce((SELECT pg_catalog.bool_and(oid IS NOT NULL AND config IN ('search_path=""', 'search_path='))
                     FROM helper_fns), false)
         AND coalesce((SELECT prosecdef FROM helper_fns WHERE sig = 'tick(timestamptz)'), false)
  UNION ALL
  SELECT 12, 'bot_helpers_closed_to_clients',
         EXISTS (SELECT 1 FROM all_bot_schema_fns)
         AND NOT EXISTS (SELECT 1 FROM all_bot_schema_fns f, (VALUES ('anon'), ('authenticated')) r(role)
                          WHERE pg_catalog.has_function_privilege(r.role, f.oid, 'EXECUTE'))
  UNION ALL
  SELECT 13, 'tick_job_every_minute',
         coalesce((SELECT tick_jobs FROM counts), 0) = 1
  UNION ALL
  SELECT 14, 'net_http_post_present',
         pg_catalog.to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NOT NULL
  UNION ALL
  SELECT 15, 'one_active_link_per_user_and_telegram',
         EXISTS (SELECT 1 FROM idx WHERE tbl = 'links' AND indisunique
                    AND def ~ ' ON bot\.links USING btree \(user_id\) WHERE \(unlinked_at IS NULL\)$')
         AND EXISTS (SELECT 1 FROM idx WHERE tbl = 'links' AND indisunique
                        AND def ~ ' ON bot\.links USING btree \(tg_user_id\) WHERE \(unlinked_at IS NULL\)$')
  UNION ALL
  SELECT 16, 'deliveries_once',
         EXISTS (SELECT 1 FROM idx WHERE tbl = 'deliveries' AND indisunique
                    AND def ~ ' ON bot\.deliveries USING btree \(kind, chat_id, local_day, ref\) NULLS NOT DISTINCT$')
         AND EXISTS (SELECT 1 FROM idx WHERE tbl = 'deliveries' AND indisunique
                        AND def ~ ' ON bot\.deliveries USING btree \(chat_id, local_day\) WHERE \(kind = ANY \(ARRAY\[''reminder''::text, ''ask''::text\]\)\)$')
  UNION ALL
  SELECT 17, 'ledger_days_codes_keys',
         EXISTS (SELECT 1 FROM cons WHERE tbl = 'updates' AND contype = 'p' AND def = 'PRIMARY KEY (update_id)')
         AND EXISTS (SELECT 1 FROM cons WHERE tbl = 'days' AND contype = 'p' AND def = 'PRIMARY KEY (link_id, local_day)')
         AND EXISTS (SELECT 1 FROM cons WHERE tbl = 'link_codes' AND contype = 'p' AND def = 'PRIMARY KEY (code_hash)')
  UNION ALL
  SELECT 18, 'delivery_and_ledger_states',
         coalesce((SELECT pg_catalog.bool_and((SELECT pg_catalog.string_agg(def, ' ') FROM cons
                                                WHERE tbl = 'deliveries' AND contype = 'c' AND def LIKE '%status%')
                                              LIKE '%''' || s || '''%')
                     FROM pg_catalog.unnest(ARRAY['claimed', 'sending', 'sent', 'failed', 'skipped', 'unknown']) s), false)
         AND coalesce((SELECT pg_catalog.bool_and((SELECT pg_catalog.string_agg(def, ' ') FROM cons
                                                    WHERE tbl = 'deliveries' AND contype = 'c' AND def LIKE '%kind%')
                                                  LIKE '%''' || k || '''%')
                         FROM pg_catalog.unnest(ARRAY['reminder', 'ask', 'after_date', 'day_close', 'notice']) k), false)
         AND coalesce((SELECT pg_catalog.bool_and((SELECT pg_catalog.string_agg(def, ' ') FROM cons
                                                    WHERE tbl = 'updates' AND contype = 'c' AND def LIKE '%status%')
                                                  LIKE '%''' || u || '''%')
                         FROM pg_catalog.unnest(ARRAY['started', 'failed', 'done']) u), false)
  UNION ALL
  SELECT 19, 'config_has_one_row',
         coalesce((SELECT config_rows FROM counts), 0) = 1
  UNION ALL
  SELECT 20, 'sessions_readable_by_t1',
         pg_catalog.to_regclass('bot.sessions') IS NULL
         OR (SELECT pg_catalog.count(*) FROM session_cols
              WHERE attname IN ('user_id', 'status', 'chat_id', 'message_id')) = 4
  -- ── T5: 30–49 ── (UNION ALL SELECT 30, '<name>', <boolean> …)
  -- ── T7: 50–69 ──
  -- ── T9: 70–89 ──
)
SELECT pg_catalog.json_build_object(
  'contract_ok', (SELECT pg_catalog.bool_and(ok IS TRUE) FROM checks),
  'failed', (SELECT coalesce(pg_catalog.json_agg(name ORDER BY ord), '[]'::json) FROM checks WHERE ok IS NOT TRUE),
  'checks', (SELECT pg_catalog.json_object_agg(name, ok IS TRUE ORDER BY ord) FROM checks),
  'configured', (SELECT configured = 1 FROM counts),
  'active_links', (SELECT active_links FROM counts),
  'migrations', CASE WHEN pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
                  (pg_catalog.xpath('/row/m/text()', pg_catalog.query_to_xml(
                    'select coalesce(json_agg(json_build_object(''version'', m.version, ''name'', m.name) order by m.version desc), ''[]'')::text as m
                       from (select s.version, s.name from supabase_migrations.schema_migrations s order by s.version desc limit 4) m',
                    false, true, '')))[1]::text::json
                END
) AS telegram_bot;
