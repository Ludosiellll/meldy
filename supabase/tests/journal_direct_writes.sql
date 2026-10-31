-- Run once after migration 20261103090100_journal_direct_writes.sql: the read-only check of that apply. A DO block that
-- raises nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not.
-- Catalog only.
-- Checks: the RESTRICTIVE insert policy «Learning events: direct writes are ratings and peeks» on public.learning_events
-- (role authenticated, the user's own row, the flag meldy.journal_rpc, the self_rating and sheet_peek shapes) next to the
-- permissive «Learning events: add own», which still holds the own-material rule; learning_events still append-only for
-- authenticated; each of review_flashcard, record_quiz_attempt, record_oral_attempt and the bot's
-- meldy_private.record_oral_attempt_for turns the flag on right before every journal insert and off right after it (as
-- many on and off lines as inserts, in that order), still SECURITY INVOKER with an empty search_path; the oral
-- functions still write formula v2 and the bot's copy is still the site's function but the line that reads the user.
-- The behaviour (a direct exam_answer refused, a rating and a peek kept, the three functions writing as before, the flag
-- off after them) is rehearsed locally: supabase/tests/local/oral_journal_sweep_run.sh.
DO $check$
DECLARE
  v_policy record;
  v_fn text;
  v_src text;
  v_inserts integer;
  v_shape text;
  v_site text;
  v_core text;
BEGIN
  SELECT p.permissive, p.roles, p.cmd, p.with_check INTO v_policy
    FROM pg_catalog.pg_policies p
   WHERE p.schemaname = 'public' AND p.tablename = 'learning_events'
     AND p.policyname = 'Learning events: direct writes are ratings and peeks';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'restrictive_policy_exists';
  END IF;
  IF v_policy.permissive IS DISTINCT FROM 'RESTRICTIVE' OR v_policy.cmd IS DISTINCT FROM 'INSERT'
     OR v_policy.roles IS DISTINCT FROM ARRAY['authenticated']::name[] THEN
    RAISE EXCEPTION 'restrictive_policy_is_an_insert_of_authenticated';
  END IF;
  IF coalesce(v_policy.with_check, '') NOT LIKE '%auth.uid()%' OR v_policy.with_check NOT LIKE '%user_id%'
     OR v_policy.with_check NOT LIKE '%meldy.journal_rpc%'
     OR v_policy.with_check NOT LIKE '%self_rating%' OR v_policy.with_check NOT LIKE '%sheet_peek%'
     OR v_policy.with_check NOT LIKE '%session_id IS NULL%' OR v_policy.with_check NOT LIKE '%correct IS NULL%'
     OR v_policy.with_check NOT LIKE '%score IS NULL%' THEN
    RAISE EXCEPTION 'restrictive_policy_shapes';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies p
                  WHERE p.schemaname = 'public' AND p.tablename = 'learning_events' AND p.policyname = 'Learning events: add own'
                    AND p.permissive = 'PERMISSIVE' AND p.cmd = 'INSERT' AND p.with_check LIKE '%materials%') THEN
    RAISE EXCEPTION 'own_material_policy_kept';
  END IF;
  IF pg_catalog.has_table_privilege('authenticated', 'public.learning_events', 'UPDATE')
     OR pg_catalog.has_table_privilege('authenticated', 'public.learning_events', 'DELETE')
     OR NOT pg_catalog.has_table_privilege('authenticated', 'public.learning_events', 'INSERT') THEN
    RAISE EXCEPTION 'journal_append_only';
  END IF;

  FOREACH v_fn IN ARRAY ARRAY['public.review_flashcard(uuid,integer,text,date,uuid)', 'public.record_quiz_attempt(jsonb)',
                              'public.record_oral_attempt(jsonb)', 'meldy_private.record_oral_attempt_for(uuid,jsonb)'] LOOP
    IF pg_catalog.to_regprocedure(v_fn) IS NULL THEN
      RAISE EXCEPTION 'function_exists: %', v_fn;
    END IF;
    SELECT pg_catalog.replace(p.prosrc, E'\r\n', E'\n') INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_fn);
    v_inserts := (SELECT count(*) FROM pg_catalog.regexp_matches(v_src, 'insert into public\.learning_events', 'g'));
    -- Every insert reads «on, the statement, off»: each statement squeezed to a marker, each wrapped one to another.
    v_shape := pg_catalog.regexp_replace(v_src, 'insert into public\.learning_events[^;]*;', '<<insert>>', 'g');
    v_shape := pg_catalog.regexp_replace(v_shape,
      'perform pg_catalog\.set_config\(''meldy\.journal_rpc'', ''on'', true\);\s*<<insert>>\s*perform pg_catalog\.set_config\(''meldy\.journal_rpc'', '''', true\);',
      '<<wrapped>>', 'g');
    IF v_inserts = 0 OR pg_catalog.strpos(v_shape, '<<insert>>') > 0
       OR (SELECT count(*) FROM pg_catalog.regexp_matches(v_shape, '<<wrapped>>', 'g')) IS DISTINCT FROM v_inserts::bigint
       OR (SELECT count(*) FROM pg_catalog.regexp_matches(v_src, 'meldy\.journal_rpc', 'g')) IS DISTINCT FROM (2 * v_inserts)::bigint THEN
      RAISE EXCEPTION 'flag_around_every_journal_insert: %', v_fn;
    END IF;
    IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_fn))
       OR NOT coalesce((SELECT p.proconfig @> ARRAY['search_path=""'] FROM pg_catalog.pg_proc p WHERE p.oid = pg_catalog.to_regprocedure(v_fn)), false) THEN
      RAISE EXCEPTION 'security_invoker_empty_search_path: %', v_fn;
    END IF;
  END LOOP;

  SELECT pg_catalog.replace(p.prosrc, E'\r\n', E'\n') INTO v_site FROM pg_catalog.pg_proc p WHERE p.oid = 'public.record_oral_attempt(jsonb)'::regprocedure;
  SELECT pg_catalog.replace(p.prosrc, E'\r\n', E'\n') INTO v_core FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.record_oral_attempt_for(uuid,jsonb)'::regprocedure;
  IF pg_catalog.strpos(v_site, '''formula'', ''v2''') = 0 OR pg_catalog.strpos(v_core, '''formula'', ''v2''') = 0 THEN
    RAISE EXCEPTION 'formula_v2_kept';
  END IF;
  IF pg_catalog.replace(v_core, 'v_user uuid := p_user;', 'v_user uuid := auth.uid();') IS DISTINCT FROM v_site THEN
    RAISE EXCEPTION 'bot_copy_is_the_site_function';
  END IF;
END
$check$;
