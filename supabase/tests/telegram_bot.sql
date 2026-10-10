-- Run after the Telegram bot's migrations (T1: *_telegram_bot.sql, *_telegram_bot_cron.sql, *_telegram_bot_revokes.sql;
-- the later packages' files after them): the single read-only check of that apply (spec §8.2 «Контракт»). ONE SELECT
-- returning ONE JSON object (column telegram_bot). It never raises: a missing schema, table, column, function, type or
-- the cron schema reads as false or null, so the report always comes back (on the base, with T1 alone, with any later
-- package applied or rolled back). Catalog only (pg_catalog, plus cron.job and supabase_migrations.schema_migrations
-- when they exist) and a few counts; no row content leaves the database: no token, no URL, no Telegram id.
-- contract_ok is true when every check of every package holds; failed names the checks that do not; packages gives
-- each package {migration, applied, ok, failed}. A package counts as applied when any object of its lists exists. The
-- checks that hold for every listed object (2, 4–11) take T1's objects and those of the applied packages, so T1's
-- checks hold with T1 alone, and a package not applied fails its own checks (its range below) instead. In packages,
-- an applied package's failed also names those checks when one of its own objects fails them; the schema-wide checks
-- (1, 3, 12, and 4 for a relation of schema bot in no list) count for T1.
-- Between T1's main file and its revokes file exactly three of T1's checks fail — what Supabase's default privileges
-- (and PostgreSQL's PUBLIC EXECUTE on new functions) give clients, which the revokes file takes back:
-- bot_functions_closed_to_clients, site_functions_authenticated_only, bot_helpers_closed_to_clients. Safety does not
-- depend on them: every bot_* checks the service role first, every telegram_* checks auth.uid(), schema bot has no
-- USAGE for clients.
-- Checks (T1; what the Edge Function `telegram` and the site depend on):
--   * schema bot exists and anon/authenticated have no USAGE or CREATE on it;
--   * the listed tables exist with row security on, no policy in schema bot, no client privilege on any of its tables;
--   * every bot_* function: SECURITY DEFINER, search_path empty, meldy_private.require_service_role() its first
--     statement, not executable by anon or authenticated, executable by service_role;
--   * every telegram_* function: SECURITY DEFINER, search_path empty, executable by authenticated, not by anon;
--   * the helpers of schema bot (bot.tick, bot.tick_mode, bot.tick_due, bot.active_link, bot.local_day, …): present,
--     search_path empty; no function of schema bot executable by clients; bot.tick is SECURITY DEFINER;
--   * the cron job meldy-telegram-tick runs `select bot.tick()` every minute; net.http_post exists;
--   * the uniqueness of spec §6.2 / §6.5: one active link per user and per Telegram account; deliveries unique (kind,
--     chat_id, local_day, ref) NULLS NOT DISTINCT and one day card (reminder | ask) per chat and day; the ledger key;
--     days per (link, local day); codes by hash;
--   * the delivery and ledger states; bot.config has its one row;
--   * bot_today and the night's close can read package T5's bot.sessions when it exists (user_id, status, chat_id,
--     message_id).
-- Later packages add a row to packages, their names to the lists below and their own checks in their range: T5 30–49
-- (20261010120003), T7 50–59 (20261010120004), T10 60–69 (20261010120006), T9 70–79 (20261010120005), T11 80–89
-- (20261010120007, bot_oral_inputs), WA 90–99 (20261010150000, the Mini App's sign-in). The only functions a client without a session may run are
-- T10's two entry points for the Space (public.bridge_voice_take(text), bridge_voice_refund(text): anon and the service
-- role with a single-use 64-hex ticket, checks 60 and 65); every bot_* stays the service role's. Local rehearsal of all
-- of it: supabase/tests/local/telegram_bot_run.sh.
WITH
-- ── the packages: each one's migration and its range of checks (a later package adds its row) ───────────────────────────
packages(pkg, migration, first_check, last_check) AS (VALUES
  ('T1', '20261010120000', 1, 29),
  ('T5', '20261010120003', 30, 49),
  ('T7', '20261010120004', 50, 59),
  ('T9', '20261010120005', 70, 79),
  ('T10', '20261010120006', 60, 69)
  -- T11 (20261010120007_oral_plan_inputs.sql, bot_oral_inputs):
  , ('T11', '20261010120007', 80, 89)
  -- WA (20261010150000_telegram_webapp.sql, the Mini App's sign-in):
  , ('WA', '20261010150000', 90, 99)
),
-- ── the lists (one line per object; later packages append theirs) ──────────────────────────────────────────────────────
bot_tables(pkg, name) AS (VALUES
  ('T1', 'config'), ('T1', 'link_codes'), ('T1', 'links'), ('T1', 'updates'), ('T1', 'claim_failures'),
  ('T1', 'deliveries'), ('T1', 'days'), ('T1', 'usage')
  -- T5 (20261010120003_telegram_bot_sessions.sql):
  , ('T5', 'sessions')
  -- T7 (20261010120004_telegram_bot_groups.sql):
  , ('T7', 'groups'), ('T7', 'group_posts'), ('T7', 'group_answers')
  -- T9 (20261010120005_telegram_bot_files.sql):
  , ('T9', 'files')
  -- T10 (20261010120006_telegram_bot_voice.sql):
  , ('T10', 'voice_attempts'), ('T10', 'voice_tickets'), ('T10', 'voice_audio'), ('T10', 'voice_days')
  -- T11 slot (20261010120007): its tables of schema bot, if any
  -- WA (20261010150000_telegram_webapp.sql):
  , ('WA', 'webapp_uses')
),
bot_fns(pkg, sig) AS (VALUES
  ('T1', 'bot_setup(text,bigint,text,text,text)'), ('T1', 'bot_update_begin(bigint,timestamptz)'),
  ('T1', 'bot_update_done(bigint)'), ('T1', 'bot_update_failed(bigint,text)'), ('T1', 'bot_tick_beat(jsonb)'),
  ('T1', 'bot_status()'), ('T1', 'bot_link_claim(text,bigint,bigint,text,timestamptz)'),
  ('T1', 'bot_chat_event(bigint,text)'), ('T1', 'bot_whoami(bigint)'), ('T1', 'bot_settings(bigint,jsonb)'),
  ('T1', 'bot_today(bigint)'), ('T1', 'bot_card_sent(bigint,bigint,text)'),
  ('T1', 'bot_claim_reminders(integer,timestamptz)'), ('T1', 'bot_reminder_context(bigint)'),
  ('T1', 'bot_delivery_sending(bigint,timestamptz)'), ('T1', 'bot_delivery_retry(bigint,text,timestamptz)'),
  ('T1', 'bot_delivery_done(bigint,text,bigint,text,timestamptz)'),
  ('T1', 'bot_claim_day_close(integer,timestamptz)'), ('T1', 'bot_claim_after_date(integer,timestamptz)')
  -- T5 (20261010120003_telegram_bot_sessions.sql):
  , ('T5', 'bot_session_items(bigint,uuid,uuid[])'), ('T5', 'bot_session_start(bigint,text,uuid,uuid,text,jsonb,bigint,jsonb)'),
  ('T5', 'bot_session_view(bigint,text,integer)'), ('T5', 'bot_session_answer(bigint,text,integer,jsonb)'),
  ('T5', 'bot_session_resolve(bigint,text,integer,text,jsonb)'), ('T5', 'bot_session_finish(bigint,text)'),
  ('T5', 'bot_session_move(bigint,text,bigint)'), ('T5', 'bot_key_doubt(bigint,text,integer)'),
  ('T5', 'bot_flush_pending(timestamptz)')
  -- T7 (20261010120004_telegram_bot_groups.sql):
  , ('T7', 'bot_group_claim(text,bigint,text,text,bigint,timestamptz)'), ('T7', 'bot_group_event(bigint,text,bigint)'),
  ('T7', 'bot_group_entry(bigint,bigint)'), ('T7', 'bot_claim_group_posts(integer,timestamptz)'),
  ('T7', 'bot_group_pick(bigint,text)'), ('T7', 'bot_group_sending(bigint,integer[],timestamptz)'),
  ('T7', 'bot_group_posted(bigint,text,bigint,text,timestamptz)'),
  ('T7', 'bot_group_answer(bigint,bigint,integer,bigint,bigint,timestamptz)'),
  ('T7', 'bot_group_counters(integer,timestamptz)'), ('T7', 'bot_group_counter_done(bigint,integer,text)'),
  ('T7', 'bot_claim_group_closes(integer,timestamptz)'), ('T7', 'bot_group_closed(bigint,text,timestamptz)')
  -- T9 (20261010120005_telegram_bot_files.sql):
  , ('T9', 'bot_file_offer(bigint,text,text,bigint,text)'), ('T9', 'bot_file_redeem(text)')
  -- T10 (20261010120006_telegram_bot_voice.sql); its two entry points for the Space (bridge_voice_*, run by anon with a
  -- ticket) are no bot_* function: check 60 holds them
  , ('T10', 'bot_voice_state(bigint)'), ('T10', 'bot_voice_start(bigint,uuid,uuid,uuid,text,uuid[],integer)'),
  ('T10', 'bot_voice_next(bigint,text)'), ('T10', 'bot_voice_sent(bigint,text,text,bigint)'),
  ('T10', 'bot_voice_ticket(bigint,text,text,integer,bigint)'), ('T10', 'bot_voice_part(bigint,text,text,integer,bigint)'),
  ('T10', 'bot_voice_restart(bigint,text)'), ('T10', 'bot_voice_checked(bigint,text,jsonb)'),
  ('T10', 'bot_voice_followup(bigint,text,text,text,text)'), ('T10', 'bot_voice_release(bigint,text)'),
  ('T10', 'bot_voice_record(bigint,text,jsonb,text)'), ('T10', 'bot_voice_self(bigint,text)'),
  ('T10', 'bot_voice_rate(bigint,text,text)')
  -- T11 (20261010120007):
  , ('T11', 'bot_oral_inputs(bigint)')
  -- WA (20261010150000_telegram_webapp.sql):
  , ('WA', 'bot_webapp_session(bigint,text,timestamptz,timestamptz)'),
  ('WA', 'bot_webapp_link(bigint,uuid,text,timestamptz,text,text,timestamptz)')
),
site_fns(pkg, sig) AS (VALUES
  ('T1', 'telegram_link_start(text)'), ('T1', 'telegram_link_state()'), ('T1', 'telegram_settings(boolean,time,text)'),
  ('T1', 'telegram_unlink()')
  -- T7 (20261010120004_telegram_bot_groups.sql):
  , ('T7', 'telegram_group_code(uuid,integer)'), ('T7', 'telegram_groups(uuid)'),
  ('T7', 'telegram_group_set(bigint,integer,boolean)')
  -- T9 (20261010120005_telegram_bot_files.sql):
  , ('T9', 'telegram_file_take(text)')
  -- T10: none; T11 slot: its telegram_* functions, if any
),
helpers(pkg, sig) AS (VALUES
  ('T1', 'tick(timestamptz)'), ('T1', 'tick_mode(timestamptz)'), ('T1', 'tick_due(timestamptz)'),
  ('T1', 'active_link(bigint)'), ('T1', 'local_day(text,timestamptz)'), ('T1', 'tz_ok(text)'),
  ('T1', 'in_window(timestamp,time)'), ('T1', 'recently_active(uuid,timestamptz,date)'),
  ('T1', 'answered_since(uuid,timestamptz)'), ('T1', 'link_json(bot.links,timestamptz)'), ('T1', 'exams_json(uuid)'),
  ('T1', 'site_state(uuid)'), ('T1', 'calls_json(timestamptz)'), ('T1', 'sweep(text[],timestamptz)'),
  ('T1', 'after_date_json(uuid,uuid,date)'), ('T1', 'session_message(bigint,bigint)'), ('T1', 'cleanup(timestamptz)')
  -- T5 (20261010120003_telegram_bot_sessions.sql):
  , ('T5', 'tick_due_sessions(timestamptz)'), ('T5', 'session_order_ok(jsonb,integer)'), ('T5', 'session_identity(integer)'),
  ('T5', 'session_count(jsonb,text,integer)'), ('T5', 'session_set_add(jsonb,text)'), ('T5', 'session_counts_json(jsonb)'),
  ('T5', 'session_figure_json(jsonb)'), ('T5', 'session_live(bot.sessions,text,timestamptz,boolean)'),
  ('T5', 'session_save(bot.sessions)'), ('T5', 'session_stamp(bot.sessions,timestamptz)'),
  ('T5', 'session_tally(bot.sessions,jsonb,jsonb)'), ('T5', 'session_record(bot.sessions,boolean)'),
  ('T5', 'session_close(bot.sessions,text,boolean,timestamptz)'), ('T5', 'session_logged(uuid,text,integer)'),
  ('T5', 'session_json(bot.sessions,text,timestamptz)'), ('T5', 'session_view_json(bot.sessions)'),
  ('T5', 'session_reply(text,bot.sessions,text,timestamptz,jsonb)'),
  ('T5', 'session_refusal(text,bot.sessions,text,timestamptz,jsonb)'), ('T5', 'session_take(bigint,text,timestamptz,boolean)'),
  ('T5', 'session_requeue(bot.sessions,jsonb)'), ('T5', 'session_drop(bot.sessions,integer,uuid,smallint)')
  -- T7 (20261010120004_telegram_bot_groups.sql):
  , ('T7', 'tick_due_groups(timestamptz)'), ('T7', 'group_candidates(bigint,uuid,date,text,timestamptz)'),
  ('T7', 'group_post_view(bigint)'), ('T7', 'group_item_ok(public.test_items)'),
  ('T7', 'group_stop(bot.groups,date,timestamptz)'), ('T7', 'group_day_stop(uuid,date)'),
  ('T7', 'group_link_active(uuid,timestamptz)'), ('T7', 'group_in_window(timestamp,integer)'),
  ('T7', 'group_close_at(date,text)'), ('T7', 'group_hour_ok(integer)'), ('T7', 'group_title(text)'),
  ('T7', 'group_figure(uuid,uuid)'), ('T7', 'group_five_empty(bigint,timestamptz,date)'),
  ('T7', 'group_json(bot.groups,timestamptz)'), ('T7', 'group_sweep(timestamptz)'), ('T7', 'group_cleanup(timestamptz)')
  -- T9: no helper of schema bot
  -- T10 (20261010120006_telegram_bot_voice.sql):
  , ('T10', 'voice_on()'), ('T10', 'voice_limits()'), ('T10', 'voice_aid()'), ('T10', 'voice_units(uuid)'),
  ('T10', 'voice_audio_state(uuid,timestamptz)'), ('T10', 'voice_attempt_json(bot.voice_attempts,timestamptz)'),
  ('T10', 'voice_expire(uuid,date)'), ('T10', 'voice_cleanup(timestamptz)'),
  ('T10', 'voice_open(bot.links,uuid,uuid,uuid,text,uuid[],integer,timestamptz)')
  -- T11 slot: its helpers of schema bot, if any
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
-- A package is applied when any object of its lists exists.
applied AS (
  SELECT p.pkg,
         EXISTS (SELECT 1 FROM rels r WHERE r.pkg = p.pkg AND r.oid IS NOT NULL)
         OR EXISTS (SELECT 1 FROM fns f WHERE f.pkg = p.pkg AND f.oid IS NOT NULL)
         OR EXISTS (SELECT 1 FROM sites s WHERE s.pkg = p.pkg AND s.oid IS NOT NULL)
         OR EXISTS (SELECT 1 FROM helper_fns h WHERE h.pkg = p.pkg AND h.oid IS NOT NULL) AS yes
    FROM packages p
),
-- One row per listed object and per check that holds for every listed object (2, 4–11).
per_object(pkg, ord, ok) AS (
  SELECT pkg, 2, oid IS NOT NULL AND relrowsecurity FROM rels
  UNION ALL
  SELECT pkg, 4, oid IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM (VALUES ('anon'), ('authenticated')) r(role),
                                       (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
                          WHERE pg_catalog.has_table_privilege(r.role, oid, p.priv))
    FROM rels
  UNION ALL
  SELECT pkg, 5, oid IS NOT NULL AND prosecdef AND config IN ('search_path=""', 'search_path=') FROM fns
  UNION ALL
  SELECT pkg, 6, oid IS NOT NULL
         AND pg_catalog.regexp_instr(prosrc, '\mbegin\M', 1, 1, 0, 'i') > 0
         AND pg_catalog.substr(prosrc, pg_catalog.regexp_instr(prosrc, '\mbegin\M', 1, 1, 0, 'i'))
             ~* '^begin\s+perform\s+meldy_private\.require_service_role\(\s*\)\s*;'
    FROM fns
  UNION ALL
  SELECT pkg, 7, oid IS NOT NULL AND NOT pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')
         AND NOT pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')
    FROM fns
  UNION ALL
  SELECT pkg, 8, oid IS NOT NULL AND pg_catalog.has_function_privilege('service_role', oid, 'EXECUTE') FROM fns
  UNION ALL
  SELECT pkg, 9, oid IS NOT NULL AND prosecdef AND config IN ('search_path=""', 'search_path=') FROM sites
  UNION ALL
  SELECT pkg, 10, oid IS NOT NULL AND pg_catalog.has_function_privilege('authenticated', oid, 'EXECUTE')
         AND NOT pg_catalog.has_function_privilege('anon', oid, 'EXECUTE')
    FROM sites
  UNION ALL
  SELECT pkg, 11, oid IS NOT NULL AND config IN ('search_path=""', 'search_path=') AND (sig <> 'tick(timestamptz)' OR prosecdef)
    FROM helper_fns
),
-- Those checks over T1's objects and the objects of every applied package.
every_object(ord, ok) AS (
  SELECT o.ord, pg_catalog.bool_and(o.ok IS TRUE)
    FROM per_object o JOIN applied a ON a.pkg = o.pkg
   WHERE a.yes OR o.pkg = 'T1'
   GROUP BY o.ord
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
         coalesce((SELECT ok FROM every_object WHERE ord = 2), false)
  UNION ALL
  SELECT 3, 'no_policy_in_schema_bot',
         EXISTS (SELECT 1 FROM schema_bot)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname = 'bot')
  UNION ALL
  SELECT 4, 'tables_closed_to_clients',
         coalesce((SELECT ok FROM every_object WHERE ord = 4), false)
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_class c, (VALUES ('anon'), ('authenticated')) r(role),
                                       (VALUES ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE')) p(priv)
                          WHERE c.relnamespace = (SELECT oid FROM schema_bot) AND c.relkind IN ('r', 'p', 'v', 'm')
                            AND pg_catalog.has_table_privilege(r.role, c.oid, p.priv))
  UNION ALL
  SELECT 5, 'bot_functions_definer_empty_search_path',
         coalesce((SELECT ok FROM every_object WHERE ord = 5), false)
  UNION ALL
  SELECT 6, 'bot_functions_gate_first',
         coalesce((SELECT ok FROM every_object WHERE ord = 6), false)
  UNION ALL
  SELECT 7, 'bot_functions_closed_to_clients',
         coalesce((SELECT ok FROM every_object WHERE ord = 7), false)
  UNION ALL
  SELECT 8, 'service_role_runs_bot_functions',
         coalesce((SELECT ok FROM every_object WHERE ord = 8), false)
  UNION ALL
  SELECT 9, 'site_functions_definer_empty_search_path',
         coalesce((SELECT ok FROM every_object WHERE ord = 9), false)
  UNION ALL
  SELECT 10, 'site_functions_authenticated_only',
         coalesce((SELECT ok FROM every_object WHERE ord = 10), false)
  UNION ALL
  SELECT 11, 'bot_helpers_present_empty_search_path',   -- bot.tick is SECURITY DEFINER too
         coalesce((SELECT ok FROM every_object WHERE ord = 11), false)
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
  -- ── T5: 30–49 (20261010120003_telegram_bot_sessions.sql: the «занятие», spec §6.2, §6.3) ──
  UNION ALL
  SELECT 30, 'sessions_one_open_per_user',
         EXISTS (SELECT 1 FROM idx WHERE tbl = 'sessions' AND indisunique
                    AND def ~ ' ON bot\.sessions USING btree \(user_id\) WHERE \(status = ''open''::text\)$')
  UNION ALL
  SELECT 31, 'sessions_sid_and_session_uuid',
         EXISTS (SELECT 1 FROM cons WHERE tbl = 'sessions' AND contype = 'p' AND def = 'PRIMARY KEY (sid)')
         AND EXISTS (SELECT 1 FROM cons WHERE tbl = 'sessions' AND contype = 'c' AND def LIKE '%sid ~ ''^[0-9a-z]{8}$''%')
         AND EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
                      WHERE a.attrelid = pg_catalog.to_regclass('bot.sessions') AND a.attname = 'session_uuid'
                        AND a.attgenerated = 's' AND NOT a.attisdropped)
         AND EXISTS (SELECT 1 FROM idx WHERE tbl = 'sessions' AND indisunique
                        AND def ~ ' ON bot\.sessions USING btree \(session_uuid\)$')
  UNION ALL
  SELECT 32, 'sessions_states_and_kinds',
         coalesce((SELECT pg_catalog.bool_and((SELECT pg_catalog.string_agg(def, ' ') FROM cons
                                                WHERE tbl = 'sessions' AND contype = 'c' AND def LIKE '%status%')
                                              LIKE '%''' || s || '''%')
                     FROM pg_catalog.unnest(ARRAY['open', 'finished', 'abandoned']) s), false)
         AND coalesce((SELECT pg_catalog.bool_and((SELECT pg_catalog.string_agg(def, ' ') FROM cons
                                                    WHERE tbl = 'sessions' AND contype = 'c' AND def LIKE '%kind%')
                                                  LIKE '%''' || k || '''%')
                         FROM pg_catalog.unnest(ARRAY['plan', 'errors', 'extra']) k), false)
  UNION ALL
  SELECT 33, 'sessions_message_and_flush_indexes',
         EXISTS (SELECT 1 FROM idx WHERE tbl = 'sessions'
                    AND def ~ ' ON bot\.sessions USING btree \(chat_id, message_id\)')
         AND EXISTS (SELECT 1 FROM idx WHERE tbl = 'sessions'
                        AND def ~ ' ON bot\.sessions USING btree \(pending_at\) WHERE \(pending_at IS NOT NULL\)$')
  UNION ALL
  SELECT 34, 'sessions_follow_the_account',
         EXISTS (SELECT 1 FROM cons WHERE tbl = 'sessions' AND contype = 'f'
                    AND def = 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE')
  UNION ALL
  SELECT 35, 'session_cores_present',
         pg_catalog.to_regprocedure('meldy_private.record_test_answers_for(uuid,jsonb,text,integer,text,uuid)') IS NOT NULL
         AND pg_catalog.to_regprocedure('meldy_private.grade_answer(text,integer,smallint[],text[],jsonb)') IS NOT NULL
         AND pg_catalog.to_regprocedure('meldy_private.test_key_doubt_for(uuid,uuid,jsonb,text)') IS NOT NULL
         AND pg_catalog.to_regprocedure('meldy_private.role_in(uuid,uuid)') IS NOT NULL
  UNION ALL
  SELECT 36, 'tick_due_sessions_hook',
         coalesce((SELECT p.prorettype = 'pg_catalog.bool'::pg_catalog.regtype FROM pg_catalog.pg_proc p
                    WHERE p.oid = pg_catalog.to_regprocedure('bot.tick_due_sessions(timestamptz)')), false)
  -- ── T7: 50–59 (20261010120004_telegram_bot_groups.sql: the group chat, spec §4.6, §6.5, §6.6) ──
  UNION ALL
  SELECT 50, 'group_keys',
         EXISTS (SELECT 1 FROM cons WHERE tbl = 'groups' AND contype = 'p' AND def = 'PRIMARY KEY (chat_id)')
         AND EXISTS (SELECT 1 FROM cons WHERE tbl = 'group_posts' AND contype = 'u' AND def = 'UNIQUE (chat_id, local_day)')
         AND EXISTS (SELECT 1 FROM cons WHERE tbl = 'group_answers' AND contype = 'p' AND def = 'PRIMARY KEY (post_id, tg_user_id)')
  UNION ALL
  SELECT 51, 'group_post_states',
         coalesce((SELECT pg_catalog.bool_and((SELECT pg_catalog.string_agg(def, ' ') FROM cons
                                                WHERE tbl = 'group_posts' AND contype = 'c' AND def LIKE '%status%')
                                              LIKE '%''' || s || '''%')
                     FROM pg_catalog.unnest(ARRAY['claimed', 'sending', 'open', 'closed', 'failed', 'unknown']) s), false)
  UNION ALL
  SELECT 52, 'group_cascades',   -- pg_get_constraintdef leaves out public. when it is on the search path
         EXISTS (SELECT 1 FROM cons WHERE tbl = 'groups' AND contype = 'f'
                    AND def ~ '^FOREIGN KEY \(container_id\) REFERENCES (public\.)?containers\(id\) ON DELETE CASCADE$')
         AND EXISTS (SELECT 1 FROM cons WHERE tbl = 'group_posts' AND contype = 'f'
                        AND def = 'FOREIGN KEY (chat_id) REFERENCES bot.groups(chat_id) ON UPDATE CASCADE ON DELETE CASCADE')
         AND EXISTS (SELECT 1 FROM cons WHERE tbl = 'group_posts' AND contype = 'f'
                        AND def ~ '^FOREIGN KEY \(item_id\) REFERENCES (public\.)?test_items\(id\) ON DELETE SET NULL$')
         AND EXISTS (SELECT 1 FROM cons WHERE tbl = 'group_answers' AND contype = 'f'
                        AND def = 'FOREIGN KEY (post_id) REFERENCES bot.group_posts(id) ON DELETE CASCADE')
  UNION ALL
  SELECT 53, 'group_tick_hook_read_only',
         coalesce((SELECT p.provolatile IN ('s', 'i') FROM pg_catalog.pg_proc p
                    WHERE p.oid = pg_catalog.to_regprocedure('bot.tick_due_groups(timestamptz)')), false)
  UNION ALL
  SELECT 54, 'group_posts_never_read_the_key',
         (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
           WHERE p.oid IN (pg_catalog.to_regprocedure('bot.group_post_view(bigint)'),
                           pg_catalog.to_regprocedure('bot.group_candidates(bigint,uuid,date,text,timestamptz)'),
                           pg_catalog.to_regprocedure('public.bot_claim_group_posts(integer,timestamptz)'),
                           pg_catalog.to_regprocedure('public.bot_group_pick(bigint,text)'),
                           pg_catalog.to_regprocedure('public.bot_group_counters(integer,timestamptz)'),
                           pg_catalog.to_regprocedure('public.bot_claim_group_closes(integer,timestamptz)'),
                           pg_catalog.to_regprocedure('public.bot_group_claim(text,bigint,text,text,bigint,timestamptz)'),
                           pg_catalog.to_regprocedure('public.bot_group_entry(bigint,bigint)'),
                           pg_catalog.to_regprocedure('public.telegram_groups(uuid)'))
             AND p.prosrc !~* '\mcorrect\M' AND p.prosrc !~* '\manswers\M') = 9
  UNION ALL
  SELECT 55, 'group_codes_in_link_codes',
         EXISTS (SELECT 1 FROM cons WHERE tbl = 'link_codes' AND contype = 'c' AND def LIKE '%purpose%' AND def LIKE '%''group''%')
  -- ── T10: 60–69 (20261010120006_telegram_bot_voice.sql: voice behind bot.config.flags.voice, spec §4.9, §6.2, §10) ──
  UNION ALL
  -- The Space's two entry points: SECURITY DEFINER, search_path empty, run by anon (the Space's public key) and the
  -- service role, never by a signed-in user (the ticket is their whole authority). Nothing wider: no other signature
  -- of them, and no bot_voice_* function a client can run.
  SELECT 60, 'voice_bridge_entry_points',
         coalesce((SELECT pg_catalog.bool_and(p.oid IS NOT NULL AND p.prosecdef
                     AND pg_catalog.array_to_string(p.proconfig, ',') IN ('search_path=""', 'search_path=')
                     AND pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                     AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
                     AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
                     FROM (VALUES ('bridge_voice_take(text)'), ('bridge_voice_refund(text)')) v(sig)
                     LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure('public.' || v.sig)), false)
         AND (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
               WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'bridge\_voice\_%') = 2
         AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_proc p
                          WHERE p.pronamespace = 'public'::regnamespace AND p.proname LIKE 'bot\_voice\_%'
                            AND (pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                                 OR pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE')))
  UNION ALL
  -- The cores the bot charges and records with are the site's functions word for word, but the line that reads the user
  -- (auth.uid() → p_user): a later change of a site function without its core shows here. Closed to clients. Line ends
  -- are compared as LF: live, public.consume_ai_units was stored with CRLF (same code, same behaviour).
  SELECT 61, 'voice_cores_match_the_site',
         coalesce((SELECT pg_catalog.bool_and(c.oid IS NOT NULL AND s.oid IS NOT NULL
                     AND pg_catalog.replace(pg_catalog.replace(c.prosrc, E'\r\n', E'\n'), v.core_line, v.site_line)
                         = pg_catalog.replace(s.prosrc, E'\r\n', E'\n')
                     AND NOT pg_catalog.has_function_privilege('anon', c.oid, 'EXECUTE')
                     AND NOT pg_catalog.has_function_privilege('authenticated', c.oid, 'EXECUTE'))
                     FROM (VALUES ('meldy_private.ai_quota_status_for(uuid)', 'public.ai_quota_status()',
                                   'v_uid uuid := p_user;', 'v_uid uuid := auth.uid();'),
                                  ('meldy_private.consume_ai_units_for(uuid,integer,text)', 'public.consume_ai_units(integer,text)',
                                   'v_uid uuid := p_user;', 'v_uid uuid := auth.uid();'),
                                  ('meldy_private.refund_ai_units_for(uuid,integer,text,uuid)', 'public.refund_ai_units(integer,text,uuid)',
                                   'v_uid uuid := p_user;', 'v_uid uuid := auth.uid();'),
                                  ('meldy_private.record_oral_attempt_for(uuid,jsonb)', 'public.record_oral_attempt(jsonb)',
                                   'v_user uuid := p_user;', 'v_user uuid := auth.uid();')) v(core, site, core_line, site_line)
                     LEFT JOIN pg_catalog.pg_proc c ON c.oid = pg_catalog.to_regprocedure(v.core)
                     LEFT JOIN pg_catalog.pg_proc s ON s.oid = pg_catalog.to_regprocedure(v.site)), false)
  UNION ALL
  -- Single-use tickets are kept only as sha256 hex.
  SELECT 62, 'voice_tickets_hash_only',
         EXISTS (SELECT 1 FROM cons WHERE tbl = 'voice_tickets' AND contype = 'p' AND def = 'PRIMARY KEY (ticket_hash)')
         AND EXISTS (SELECT 1 FROM cons WHERE tbl = 'voice_tickets' AND contype = 'c' AND def LIKE '%ticket_hash ~ ''^[0-9a-f]{64}$''%')
  UNION ALL
  -- One open oral question per student.
  SELECT 63, 'voice_one_open_attempt_per_user',
         EXISTS (SELECT 1 FROM idx WHERE tbl = 'voice_attempts' AND indisunique
                    AND def ~ ' ON bot\.voice_attempts USING btree \(user_id\) WHERE ')
  UNION ALL
  -- The switch is a JSON boolean in bot.config.flags (false after the migration; the owner sets true). The query
  -- aggregates, so it returns one row even without the config row and xpath always gets a document.
  SELECT 64, 'voice_switch_is_a_boolean',
         CASE WHEN (SELECT oid FROM rels WHERE name = 'config') IS NOT NULL THEN
           coalesce(((pg_catalog.xpath('/row/n/text()', pg_catalog.query_to_xml(
             'select coalesce(pg_catalog.bool_or(pg_catalog.jsonb_typeof(c.flags -> ''voice'') = ''boolean''), false) as n
                from bot.config c where c.id = 1', false, true, '')))[1])::text = 'true', false)
         ELSE false END
  UNION ALL
  -- The ticket is the entry points' whole authority: the first thing each does is refuse anything but 64 hex characters,
  -- and the ticket is looked up by its sha256 only.
  SELECT 65, 'voice_bridge_ticket_first',
         coalesce((SELECT pg_catalog.bool_and(p.oid IS NOT NULL
                     AND pg_catalog.regexp_instr(p.prosrc, '\mbegin\M', 1, 1, 0, 'i') > 0
                     AND pg_catalog.substr(p.prosrc, pg_catalog.regexp_instr(p.prosrc, '\mbegin\M', 1, 1, 0, 'i'))
                         ~* '^begin\s+if\s+p_ticket\s+is\s+null\s+or\s+p_ticket\s+!~\s+''\^\[0-9a-f\]\{64\}\$''\s+then\s+return\M'
                     AND p.prosrc ~* 'v_hash\s*:=\s*pg_catalog\.encode\(pg_catalog\.sha256\('
                     AND p.prosrc ~* 'from\s+bot\.voice_tickets\s+t\s+where\s+t\.ticket_hash\s*=\s*v_hash\M')
                     FROM (VALUES ('bridge_voice_take(text)'), ('bridge_voice_refund(text)')) v(sig)
                     LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure('public.' || v.sig)), false)
  -- ── T9: 70–79 (20261010120005_telegram_bot_files.sql: the file hand-off, spec §8.2 «Файлы») ──
  UNION ALL
  SELECT 70, 'files_ticket_and_token_keys',
         EXISTS (SELECT 1 FROM cons WHERE tbl = 'files' AND contype = 'p' AND def = 'PRIMARY KEY (ticket_hash)')
         AND EXISTS (SELECT 1 FROM idx WHERE tbl = 'files' AND indisunique
                        AND def ~ ' ON bot\.files USING btree \(token_hash\) WHERE \(token_hash IS NOT NULL\)$')
  UNION ALL
  SELECT 71, 'files_hashes_only',
         (SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attname::text COLLATE "C") FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = pg_catalog.to_regclass('bot.files') AND a.attnum > 0 AND NOT a.attisdropped)
         = ARRAY['expires_at', 'file_id', 'mime', 'name', 'size', 'ticket_hash', 'token_expires_at', 'token_hash', 'used_at',
                 'user_id']
         AND EXISTS (SELECT 1 FROM cons WHERE tbl = 'files' AND contype = 'c' AND def LIKE '%(ticket_hash ~ ''^[0-9a-f]{64}$''%')
         AND EXISTS (SELECT 1 FROM cons WHERE tbl = 'files' AND contype = 'c' AND def LIKE '%(token_hash ~ ''^[0-9a-f]{64}$''%')
  UNION ALL
  SELECT 72, 'files_go_with_the_account',
         EXISTS (SELECT 1 FROM cons WHERE tbl = 'files' AND contype = 'f'
                    AND def = 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE')
  UNION ALL
  SELECT 73, 'file_functions_one_signature_each',
         (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace
             AND p.proname IN ('bot_file_offer', 'bot_file_redeem', 'telegram_file_take')) = 3
  -- ── T11: 80–89 (20261010120007_oral_plan_inputs.sql: bot_oral_inputs, the oral plan on the server) ──
  UNION ALL
  SELECT 80, 'oral_cores_private',
         coalesce((SELECT pg_catalog.bool_and(p.oid IS NOT NULL AND NOT p.prosecdef
                     AND pg_catalog.array_to_string(p.proconfig, ',') LIKE 'search_path=%'
                     AND NOT pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                     AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
                     FROM (VALUES ('oral_sheet_for(uuid,uuid)'), ('oral_events_for(uuid,text[])'),
                                  ('oral_events_json(uuid,text[],text[])'),
                                  ('oral_rubric_key(text,text[],jsonb,text)'), ('oral_clean_points(jsonb)'),
                                  ('oral_clean_materials(jsonb)'), ('oral_sheet_short(jsonb,timestamptz,text)'), ('py_str(jsonb)'),
                                  ('py_repr(jsonb)'), ('py_repr_text(text)'), ('py_float_repr(text)')) s(sig)
                     LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure('meldy_private.' || s.sig)), false)
  UNION ALL
  SELECT 81, 'oral_inputs_read_only_through_the_link',
         coalesce((SELECT p.provolatile = 's' AND p.prosrc ~ 'bot\.active_link\(' AND p.prosrc ~ 'meldy_private\.oral_sheet_for\('
                          AND p.prosrc ~ 'meldy_private\.oral_events_json\('
                     FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure('public.bot_oral_inputs(bigint)')), false)
  -- ── WA: 90–99 (20261010150000_telegram_webapp.sql: the Mini App's sign-in, Telegram_Mini_App_Spec_2026-10-10 §3–§4) ──
  UNION ALL
  SELECT 90, 'webapp_uses_one_use_each',
         EXISTS (SELECT 1 FROM cons WHERE tbl = 'webapp_uses' AND contype = 'p' AND def = 'PRIMARY KEY (init_hash, purpose)')
         AND EXISTS (SELECT 1 FROM cons WHERE tbl = 'webapp_uses' AND contype = 'c' AND def LIKE '%(init_hash ~ ''^[0-9a-f]{64}$''%')
  UNION ALL
  SELECT 91, 'webapp_uses_hashes_only',
         (SELECT pg_catalog.array_agg(a.attname::text ORDER BY a.attname::text COLLATE "C") FROM pg_catalog.pg_attribute a
           WHERE a.attrelid = pg_catalog.to_regclass('bot.webapp_uses') AND a.attnum > 0 AND NOT a.attisdropped)
         = ARRAY['auth_date', 'init_hash', 'purpose', 'tg_user_id', 'used_at', 'user_id']
  UNION ALL
  SELECT 92, 'webapp_uses_go_with_the_account',
         EXISTS (SELECT 1 FROM cons WHERE tbl = 'webapp_uses' AND contype = 'f'
                    AND def = 'FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE')
  UNION ALL
  SELECT 93, 'webapp_functions_one_signature_each',
         (SELECT pg_catalog.count(*) FROM pg_catalog.pg_proc p
           WHERE p.pronamespace = 'public'::regnamespace AND p.proname IN ('bot_webapp_session', 'bot_webapp_link')) = 2
),
-- Per package: its own checks (its range) that fail and, for an applied package other than T1, the checks over every
-- listed object that one of its own objects fails.
pkg_failed(pkg, ord, name) AS (
  SELECT p.pkg, c.ord, c.name
    FROM packages p JOIN checks c ON c.ord BETWEEN p.first_check AND p.last_check
   WHERE c.ok IS NOT TRUE
  UNION
  SELECT o.pkg, o.ord, c.name
    FROM per_object o JOIN applied a ON a.pkg = o.pkg AND a.yes JOIN checks c ON c.ord = o.ord
   WHERE o.ok IS NOT TRUE AND o.pkg <> 'T1'
)
SELECT pg_catalog.json_build_object(
  'contract_ok', (SELECT pg_catalog.bool_and(ok IS TRUE) FROM checks),
  'failed', (SELECT coalesce(pg_catalog.json_agg(name ORDER BY ord), '[]'::json) FROM checks WHERE ok IS NOT TRUE),
  'checks', (SELECT pg_catalog.json_object_agg(name, ok IS TRUE ORDER BY ord) FROM checks),
  'packages', (SELECT pg_catalog.json_object_agg(p.pkg, pg_catalog.json_build_object(
                 'migration', p.migration,
                 'applied', a.yes,
                 'ok', a.yes AND NOT EXISTS (SELECT 1 FROM pkg_failed f WHERE f.pkg = p.pkg),
                 'failed', coalesce((SELECT pg_catalog.json_agg(f.name ORDER BY f.ord) FROM pkg_failed f WHERE f.pkg = p.pkg),
                                    '[]'::json)) ORDER BY p.migration)
                 FROM packages p JOIN applied a ON a.pkg = p.pkg),
  'configured', (SELECT configured = 1 FROM counts),
  'active_links', (SELECT active_links FROM counts),
  'migrations', CASE WHEN pg_catalog.to_regclass('supabase_migrations.schema_migrations') IS NOT NULL THEN
                  (pg_catalog.xpath('/row/m/text()', pg_catalog.query_to_xml(
                    'select coalesce(json_agg(json_build_object(''version'', m.version, ''name'', m.name) order by m.version desc), ''[]'')::text as m
                       from (select s.version, s.name from supabase_migrations.schema_migrations s order by s.version desc limit 8) m',
                    false, true, '')))[1]::text::json
                END
) AS telegram_bot;
