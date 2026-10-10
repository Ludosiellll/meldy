-- The T10 block of supabase/tests/telegram_bot.sql (package T10, the voice stage: 20261010120006_telegram_bot_voice.sql).
-- T1 owns that file: each part below goes right after the line named in its header (telegram_bot_voice_run.sh pastes
-- them into a scratch copy the same way and checks contract_ok). Catalog only, never raises (to_regprocedure and the
-- guarded query_to_xml read a missing object as false). Checks 90–94 are T10's range (90–109).
-- >>> tables
  -- T10: the voice stage (after «  -- T9: , ('T9', 'files')»)
  , ('T10', 'voice_attempts'), ('T10', 'voice_tickets'), ('T10', 'voice_audio'), ('T10', 'voice_days')
-- <<< tables
-- >>> functions
  -- T10: the voice stage (after «  -- T9: , ('T9', 'bot_file_offer(…)'), ('T9', 'bot_file_redeem(…)')»)
  , ('T10', 'bot_voice_state(bigint)'), ('T10', 'bot_voice_start(bigint,uuid,uuid,uuid,text,uuid[],integer)'),
  ('T10', 'bot_voice_next(bigint,text)'), ('T10', 'bot_voice_sent(bigint,text,text,bigint)'),
  ('T10', 'bot_voice_ticket(bigint,text,text,integer)'), ('T10', 'bot_voice_part(bigint,text,text,integer,bigint)'),
  ('T10', 'bot_voice_restart(bigint,text)'), ('T10', 'bot_voice_checked(bigint,text,jsonb)'),
  ('T10', 'bot_voice_followup(bigint,text,text,text,text)'), ('T10', 'bot_voice_release(bigint,text)'),
  ('T10', 'bot_voice_record(bigint,text,jsonb,text)'), ('T10', 'bot_voice_self(bigint,text)'),
  ('T10', 'bot_voice_rate(bigint,text,text)')
-- <<< functions
-- >>> helpers
  -- T10: the voice stage (after «  -- T5 / T7 / T9: their helpers of schema bot»)
  , ('T10', 'voice_on()'), ('T10', 'voice_limits()'), ('T10', 'voice_aid()'), ('T10', 'voice_units(uuid)'),
  ('T10', 'voice_audio_state(uuid,timestamptz)'), ('T10', 'voice_attempt_json(bot.voice_attempts,timestamptz)'),
  ('T10', 'voice_expire(uuid,date)'), ('T10', 'voice_cleanup(timestamptz)'),
  ('T10', 'voice_open(bot.links,uuid,uuid,uuid,text,uuid[],integer,timestamptz)')
-- <<< helpers
-- >>> checks
  -- ── T10: 90–109 ── (after «  -- ── T9: 70–89 ──»)
  UNION ALL
  -- The Space's two entry points: SECURITY DEFINER, search_path empty, run by anon (the Space's public key) and the
  -- service role, never by a signed-in user (the ticket is their whole authority).
  SELECT 90, 'voice_bridge_entry_points',
         coalesce((SELECT pg_catalog.bool_and(p.oid IS NOT NULL AND p.prosecdef
                     AND pg_catalog.array_to_string(p.proconfig, ',') IN ('search_path=""', 'search_path=')
                     AND pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE')
                     AND pg_catalog.has_function_privilege('service_role', p.oid, 'EXECUTE')
                     AND NOT pg_catalog.has_function_privilege('authenticated', p.oid, 'EXECUTE'))
                     FROM (VALUES ('bridge_voice_take(text)'), ('bridge_voice_refund(text)')) v(sig)
                     LEFT JOIN pg_catalog.pg_proc p ON p.oid = pg_catalog.to_regprocedure('public.' || v.sig)), false)
  UNION ALL
  -- The cores the bot charges and records with are the site's functions word for word, but the line that reads the user
  -- (auth.uid() → p_user): a later change of a site function without its core shows here. Closed to clients.
  SELECT 91, 'voice_cores_match_the_site',
         coalesce((SELECT pg_catalog.bool_and(c.oid IS NOT NULL AND s.oid IS NOT NULL
                     AND pg_catalog.replace(c.prosrc, v.core_line, v.site_line) = s.prosrc
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
  SELECT 92, 'voice_tickets_hash_only',
         EXISTS (SELECT 1 FROM cons WHERE tbl = 'voice_tickets' AND contype = 'p' AND def = 'PRIMARY KEY (ticket_hash)')
         AND EXISTS (SELECT 1 FROM cons WHERE tbl = 'voice_tickets' AND contype = 'c' AND def LIKE '%ticket_hash ~ ''^[0-9a-f]{64}$''%')
  UNION ALL
  -- One open oral question per student.
  SELECT 93, 'voice_one_open_attempt_per_user',
         EXISTS (SELECT 1 FROM idx WHERE tbl = 'voice_attempts' AND indisunique
                    AND def ~ ' ON bot\.voice_attempts USING btree \(user_id\) WHERE ')
  UNION ALL
  -- The switch is a JSON boolean in bot.config.flags (false after the migration; the owner sets true).
  SELECT 94, 'voice_switch_is_a_boolean',
         CASE WHEN (SELECT oid FROM rels WHERE name = 'config') IS NOT NULL THEN
           coalesce(((pg_catalog.xpath('/row/n/text()', pg_catalog.query_to_xml(
             'select pg_catalog.jsonb_typeof(flags -> ''voice'') = ''boolean'' as n from bot.config where id = 1', false, true, '')))[1])::text = 'true', false)
         ELSE false END
-- <<< checks
