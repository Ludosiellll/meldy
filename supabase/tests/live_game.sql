-- Run once after migration 20261021090000_live_game.sql: the read-only check of that apply. A DO block that raises
-- nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not. Catalog
-- only, plus the pure numbers (no row is read or written).
-- Checks: the five tables in public and the address throttle in meldy_private exist with row security on, no policy and
-- nothing granted to the API roles (nor PUBLIC); the PIN is unique among open games; every public live_* function is
-- SECURITY DEFINER with search_path = '' and executable by anon and authenticated, not by PUBLIC; every bot_live_*
-- function likewise but only for service_role, and it checks the service role first; the meldy_private helpers have
-- search_path = '' and no EXECUTE for PUBLIC, anon or authenticated; the key leaves only in a closed question
-- (live_closed_json and live_review read closed_at); the hint is a deferred constraint trigger sending
-- realtime.send({rev, state}, 'hint', 'live:' || topic, false); refusals use the PGRST status override; bot.webapp_uses
-- takes purpose 'game'; bot.config.live_token is checked; the numbers of rules.test.ts (damage, phases, heal, the right
-- answers needed, accuracy, unlocks), a few names and a default look.
-- The behaviour is rehearsed locally: supabase/tests/local/live_game_run.sh.
DO $check$
DECLARE
  v_rel regclass;
  v_fn record;
  v_src text;
  v_n integer;
BEGIN
  IF pg_catalog.to_regprocedure('extensions.gen_random_bytes(integer)') IS NULL THEN
    RAISE EXCEPTION 'pgcrypto_in_extensions';
  END IF;

  -- 1. Tables: closed to the API roles.
  FOR v_rel IN SELECT pg_catalog.to_regclass(t) FROM pg_catalog.unnest(array['public.live_games', 'public.live_questions',
      'public.live_players', 'public.live_answers', 'public.live_wardrobe', 'meldy_private.live_join_hits']) t LOOP
    IF v_rel IS NULL THEN
      RAISE EXCEPTION 'tables_exist';
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_rel)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = v_rel)
       OR pg_catalog.has_table_privilege('anon', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR pg_catalog.has_table_privilege('authenticated', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
                   WHERE c.oid = v_rel AND a.grantee = 0) THEN
      RAISE EXCEPTION 'tables_closed: %', v_rel;
    END IF;
  END LOOP;
  IF pg_catalog.has_table_privilege('service_role', 'meldy_private.live_join_hits', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'throttle_closed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = 'live_games_pin_open_uidx'
                    AND i.indexdef LIKE 'CREATE UNIQUE INDEX%(pin) WHERE (state <> ''ended''::text)') THEN
    RAISE EXCEPTION 'pin_unique_among_open_games';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = 'live_players_token_uidx')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_answers'::regclass AND k.contype = 'p'
                       AND pg_catalog.pg_get_constraintdef(k.oid) = 'PRIMARY KEY (game_id, qi, player_id)') THEN
    RAISE EXCEPTION 'one_answer_per_question_and_token_per_game';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid IN ('public.live_games'::regclass, 'public.live_players'::regclass) AND a.attnum > 0
                AND NOT a.attisdropped AND a.attname ~ 'token' AND a.attname NOT IN ('token_hash')) THEN
    RAISE EXCEPTION 'tokens_kept_as_hashes_only';
  END IF;

  -- 2. The site's functions and the bot's.
  v_n := 0;
  FOR v_fn IN SELECT p.oid, p.proname, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS cfg, p.prosrc
                FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND (p.proname LIKE 'live\_%' OR p.proname LIKE 'bot\_live\_%') LOOP
    v_n := v_n + 1;
    IF NOT v_fn.prosecdef OR v_fn.cfg NOT IN ('search_path=""', 'search_path=') THEN
      RAISE EXCEPTION 'definer_and_empty_search_path: %', v_fn.proname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
                WHERE p.oid = v_fn.oid AND a.grantee = 0) THEN
      RAISE EXCEPTION 'no_public_execute: %', v_fn.proname;
    END IF;
    IF v_fn.proname LIKE 'bot\_%' THEN
      IF pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
         OR NOT pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
         OR pg_catalog.strpos(v_fn.prosrc, 'perform meldy_private.require_service_role();') = 0 THEN
        RAISE EXCEPTION 'bot_functions_service_role_only: %', v_fn.proname;
      END IF;
    ELSIF NOT pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE')
          OR NOT pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'site_functions_for_anon_and_authenticated: %', v_fn.proname;
    END IF;
  END LOOP;
  -- 18, and live_stand_close once 20261022090000_live_stand.sql is applied (supabase/tests/live_stand.sql checks it),
  -- live_pin once 20261025090000_live_pin.sql is (supabase/tests/live_pin.sql), live_submit and live_practice once
  -- 20261102090000_live_kinds_teams.sql is (supabase/tests/live_kinds_teams.sql).
  IF v_n <> 18 + (CASE WHEN pg_catalog.to_regprocedure('public.live_stand_close(uuid,text,integer,jsonb)') IS NULL THEN 0 ELSE 1 END)
               + (CASE WHEN pg_catalog.to_regprocedure('public.live_pin(text,text)') IS NULL THEN 0 ELSE 1 END)
               + (CASE WHEN pg_catalog.to_regprocedure('public.live_submit(uuid,text,integer,jsonb)') IS NULL THEN 0 ELSE 1 END)
               + (CASE WHEN pg_catalog.to_regprocedure('public.live_practice(uuid,text)') IS NULL THEN 0 ELSE 1 END) THEN
    RAISE EXCEPTION 'eighteen_functions: %', v_n;
  END IF;
  FOR v_fn IN SELECT x.sig, pg_catalog.to_regprocedure(x.sig) AS oid FROM pg_catalog.unnest(array[
      'public.live_create(jsonb,jsonb)', 'public.live_host_state(uuid,text,bigint)', 'public.live_next(uuid,text,text)',
      'public.live_kick(uuid,text,uuid)', 'public.live_end(uuid,text)', 'public.live_join(text,text,text,jsonb)',
      'public.live_set_look(uuid,text,jsonb)', 'public.live_answer(uuid,text,integer,integer)', 'public.live_state(uuid,text,bigint)',
      'public.live_review(uuid,text)', 'public.live_wardrobe()', 'public.live_wardrobe_set(jsonb)', 'public.live_tg_post(uuid,bigint)',
      'public.bot_live_join(text,bigint,text,jsonb,text,text,timestamptz)', 'public.bot_live_post(uuid)',
      'public.bot_live_posted(uuid,bigint,bigint)', 'public.bot_live_sync(uuid)', 'public.bot_live_setup(text)']) x(sig) LOOP
    IF v_fn.oid IS NULL THEN
      RAISE EXCEPTION 'contract_signature: %', v_fn.sig;
    END IF;
  END LOOP;

  -- 3. The private helpers.
  FOR v_fn IN SELECT p.oid, p.proname, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS cfg
                FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'meldy_private' AND p.proname LIKE 'live\_%' LOOP
    IF v_fn.cfg NOT IN ('search_path=""', 'search_path=')
       OR pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid = v_fn.oid AND a.grantee = 0)
       OR (v_fn.prosecdef AND v_fn.proname <> 'live_hint') THEN
      RAISE EXCEPTION 'private_helpers_closed: %', v_fn.proname;
    END IF;
  END LOOP;

  -- 4. The key leaves only in a closed question.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_closed_json(public.live_games)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'q.closed_at is not null') = 0 OR pg_catalog.strpos(v_src, '''reveal'', ''leaderboard'', ''podium'', ''ended''') = 0 THEN
    RAISE EXCEPTION 'key_only_after_close';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_review(uuid,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'q.game_id = p_game and q.closed_at is not null') = 0 OR pg_catalog.strpos(v_src, '''podium'', ''ended''') = 0 THEN
    RAISE EXCEPTION 'review_keys_of_closed_questions_of_this_game';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('public', 'meldy_private') AND p.proname IN ('live_base_json', 'live_host_json', 'live_player_json', 'live_answer', 'bot_live_sync', 'bot_live_post')
                AND p.prosrc ~ '''key''') THEN
    RAISE EXCEPTION 'no_key_elsewhere';
  END IF;

  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'meldy_private.live_join_as(public.live_games,uuid,bigint,text,text,text,jsonb,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'h.ip_hash = p_ip and h.at > pg_catalog.now() - interval ''1 minute'') >= 120') = 0
     OR pg_catalog.strpos(v_src, 'p.joined_at > pg_catalog.now() - interval ''1 minute'') >= 120') = 0
     OR pg_catalog.strpos(v_src, ') >= 300 then') = 0 THEN
    RAISE EXCEPTION 'join_limits_120_a_minute_per_address_and_game_300_players';
  END IF;

  -- 5. The hint and the errors.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.live_games'::regclass AND t.tgname = 'live_games_hint' AND t.tgdeferrable AND t.tginitdeferred
                    AND t.tgfoid = 'meldy_private.live_hint()'::regprocedure) THEN
    RAISE EXCEPTION 'hint_deferred_trigger';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_hint()'::regprocedure;
  IF pg_catalog.strpos(v_src, 'realtime.send(pg_catalog.jsonb_build_object(''rev'', v_g.rev, ''state'', v_g.state), ''hint'', ''live:'' || v_g.topic, false)') = 0 THEN
    RAISE EXCEPTION 'hint_rev_and_state_on_the_public_channel';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_fail(text,text,integer,integer)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'raise sqlstate ''PGRST''') = 0 OR pg_catalog.strpos(v_src, '''status'', p_status') = 0
     OR pg_catalog.strpos(v_src, '''Retry-After''') = 0 THEN
    RAISE EXCEPTION 'pgrst_status_override';
  END IF;

  -- 6. The bot's tables.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'bot.webapp_uses'::regclass AND k.conname = 'webapp_uses_purpose_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%''game''%' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%''session''%') THEN
    RAISE EXCEPTION 'webapp_uses_purpose_game';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'bot.config'::regclass AND k.conname = 'config_live_token_check') THEN
    RAISE EXCEPTION 'config_live_token';
  END IF;

  -- 7. The numbers of rules.test.ts.
  IF meldy_private.live_damage(900, 20, 1, true) <> 98 OR meldy_private.live_damage(0, 20, 5, true) <> 200
     OR meldy_private.live_damage(20000, 20, 1, true) <> 50 OR meldy_private.live_damage(5000, 20, 2, false) <> 125
     OR meldy_private.live_damage(0, 20, 9, true) <> 200 OR meldy_private.live_damage(99999, 10, 1, true) <> 50
     OR meldy_private.live_damage(-50, 10, 1, true) <> 100 OR meldy_private.live_damage(8500, 10, 1, true) <> 57
     OR meldy_private.live_damage(720, 10, 2, true) <> 120 THEN
    RAISE EXCEPTION 'damage_numbers';
  END IF;
  IF meldy_private.live_phase_for(7920, 7920) <> 0 OR meldy_private.live_phase_for(5280, 7920) <> 1
     OR meldy_private.live_phase_for(5281, 7920) <> 0 OR meldy_private.live_phase_for(2640, 7920) <> 2
     OR meldy_private.live_heal(7920) <> 396 OR meldy_private.live_right_needed(24) <> 16 OR meldy_private.live_right_needed(25) <> 17
     OR meldy_private.live_accuracy(1, 8, 1) <> 13 OR meldy_private.live_accuracy(0, 0, 3) <> 0 THEN
    RAISE EXCEPTION 'boss_numbers';
  END IF;
  IF meldy_private.live_unlocks(2, 700, 5, 3, 10, 5, array['grad']) <> array['crown', 'graphite', 'horns', 'snow']
     OR meldy_private.live_unlocks(2, 0, 1, 0, 1, 0, '{}') <> '{}'::text[] THEN
    RAISE EXCEPTION 'unlock_rules';
  END IF;
  IF meldy_private.live_name_check('  Дима  ') <> 'Дима' OR meldy_private.live_name_check('Сукачев') <> 'Сукачев'
     OR meldy_private.live_name_check('Ребане') <> 'Ребане' OR NOT meldy_private.live_name_rude('Су-ка')
     OR NOT meldy_private.live_name_rude('cyka') OR meldy_private.live_name_rude('Shitikov') THEN
    RAISE EXCEPTION 'names_whole_words';
  END IF;
  IF meldy_private.live_default_look('Дима') <> '{"body": "round", "colour": "pink", "eyes": "dots", "hat": "antenna"}'::jsonb THEN
    RAISE EXCEPTION 'default_look';
  END IF;
END
$check$;
