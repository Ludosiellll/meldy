-- Run once after migration 20261023090000_live_stand_phone.sql (with live_game.sql and live_stand.sql): the read-only
-- check of that apply. A DO block that raises nothing when every check holds (supabase/migrate.py); it raises the name
-- of the first one that does not. Catalog and pure calls only (no row is read or written).
-- Checks: the look check takes the kit's three hats free and still refuses unknown parts and locked ones; it stays
-- private (not anon, not authenticated, not PUBLIC); bot_live_post and bot_live_sync name the game's mode (the final
-- too), stay SECURITY DEFINER with search_path = '' and for the service role only, and still carry no key.
DO $check$
DECLARE
  v_fn record;
  v_look jsonb;
  v_refused text;
BEGIN
  -- 1. The kit's hats are free parts now; the rest of the check is as before.
  FOREACH v_refused IN ARRAY array['party', 'propeller', 'tophat'] LOOP
    v_look := meldy_private.live_look_check(pg_catalog.jsonb_build_object('body', 'drop', 'colour', 'blue', 'eyes', 'round', 'hat', v_refused), '{}'::text[]);
    IF v_look ->> 'hat' IS DISTINCT FROM v_refused OR v_look ->> 'body' <> 'drop' THEN
      RAISE EXCEPTION 'kit_hat_taken: %', v_refused;
    END IF;
  END LOOP;
  v_refused := NULL;
  BEGIN
    PERFORM meldy_private.live_look_check('{"body": "drop", "colour": "blue", "eyes": "round", "hat": "fez"}'::jsonb, '{}'::text[]);
  EXCEPTION WHEN SQLSTATE 'PGRST' THEN
    v_refused := SQLERRM;
  END;
  IF v_refused IS NULL OR pg_catalog.strpos(v_refused, 'unknown_part') = 0 THEN
    RAISE EXCEPTION 'unknown_hat_refused';
  END IF;
  v_refused := NULL;
  BEGIN
    PERFORM meldy_private.live_look_check('{"body": "drop", "colour": "blue", "eyes": "round", "hat": "crown"}'::jsonb, '{}'::text[]);
  EXCEPTION WHEN SQLSTATE 'PGRST' THEN
    v_refused := SQLERRM;
  END;
  IF v_refused IS NULL OR pg_catalog.strpos(v_refused, 'locked') = 0 THEN
    RAISE EXCEPTION 'locked_hat_still_locked';
  END IF;
  v_look := meldy_private.live_look_check('{"body": "cloud", "colour": "graphite", "eyes": "dots", "hat": "crown"}'::jsonb, array['graphite', 'crown']);
  IF v_look <> '{"body": "cloud", "colour": "graphite", "eyes": "dots", "hat": "crown"}'::jsonb THEN
    RAISE EXCEPTION 'opened_parts_taken';
  END IF;
  SELECT p.oid, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS cfg INTO v_fn
    FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_look_check(jsonb,text[])'::regprocedure;
  IF v_fn.prosecdef OR v_fn.cfg NOT IN ('search_path=""', 'search_path=')
     OR pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
     OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid = v_fn.oid AND a.grantee = 0) THEN
    RAISE EXCEPTION 'look_check_private';
  END IF;

  -- 2. The bot's facts name the mode; the functions keep their rights and keep no key.
  FOR v_fn IN SELECT p.oid, p.proname, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS cfg, p.prosrc
                FROM pg_catalog.pg_proc p
               WHERE p.oid IN ('public.bot_live_post(uuid)'::regprocedure, 'public.bot_live_sync(uuid)'::regprocedure) LOOP
    IF pg_catalog.strpos(v_fn.prosrc, '''mode'', v_g.mode') = 0 THEN
      RAISE EXCEPTION 'bot_facts_name_the_mode: %', v_fn.proname;
    END IF;
    IF NOT v_fn.prosecdef OR v_fn.cfg NOT IN ('search_path=""', 'search_path=')
       OR pg_catalog.strpos(v_fn.prosrc, 'meldy_private.require_service_role()') = 0 THEN
      RAISE EXCEPTION 'bot_facts_definer_service_role: %', v_fn.proname;
    END IF;
    IF pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid = v_fn.oid AND a.grantee = 0) THEN
      RAISE EXCEPTION 'bot_facts_service_role_only: %', v_fn.proname;
    END IF;
    IF v_fn.prosrc ~ '''key''' THEN
      RAISE EXCEPTION 'bot_facts_no_key: %', v_fn.proname;
    END IF;
  END LOOP;
  SELECT p.prosrc INTO v_fn FROM pg_catalog.pg_proc p WHERE p.oid = 'public.bot_live_sync(uuid)'::regprocedure;
  IF pg_catalog.strpos(v_fn.prosrc, '''container_id'', v_g.container_id, ''mode'', v_g.mode') = 0 THEN
    RAISE EXCEPTION 'bot_final_names_the_mode';
  END IF;
END
$check$;
