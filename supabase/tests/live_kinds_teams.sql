-- Run once after migration 20261102090000_live_kinds_teams.sql: the read-only check of that apply (run live_game.sql,
-- live_stand.sql, live_mixed.sql, live_pin.sql, live_pictures.sql and live_wide_rounds.sql too). A DO block that raises
-- nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not. Catalog only,
-- plus pure calls of the new private rules (no row is read).
-- Checks: the columns (live_questions kind / keys / forms / explanation / tops, live_answers picks / typed with a choice
-- that may be null, live_games.teams, live_players.team) and their checks; the trigger that gives a team on join;
-- live_create draws several right answers and text answers (not in «Встань на ответ»), puts choice questions on the
-- movement rounds and takes settings.teams; the one close scores the share and the text answers and keeps the tops;
-- «Встань на ответ» takes any right zone; the new public functions (live_submit, live_practice) are SECURITY DEFINER with
-- search_path = '' for anon and authenticated, the new helpers private; the right options, forms and tops leave only
-- from a closed question; the numbers of live_share and the order of live_arrange. The behaviour (a whole game of every
-- kind in two teams, the review, practice, a mixed and a stand game) is rehearsed locally:
-- supabase/tests/local/live_game_run.sh (live_kinds_teams_behaviour.sql).
DO $check$
DECLARE
  v_fn record;
  v_src text;
  v_u uuid[] := array['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002',
                      '00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000004',
                      '00000000-0000-4000-8000-000000000005']::uuid[];
  v_item public.test_items;
BEGIN
  -- 1. Columns and checks.
  IF (SELECT pg_catalog.count(*) FROM information_schema.columns c
       WHERE c.table_schema = 'public'
         AND ((c.table_name = 'live_questions' AND c.column_name IN ('kind', 'keys', 'forms', 'explanation', 'tops'))
              OR (c.table_name = 'live_answers' AND c.column_name IN ('picks', 'typed'))
              OR (c.table_name = 'live_games' AND c.column_name = 'teams')
              OR (c.table_name = 'live_players' AND c.column_name = 'team'))) <> 9 THEN
    RAISE EXCEPTION 'columns';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = 'live_questions'
                    AND c.column_name = 'kind' AND c.is_nullable = 'NO' AND c.column_default = '''single''::text')
     OR NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = 'live_games'
                       AND c.column_name = 'teams' AND c.is_nullable = 'NO' AND c.column_default = '0') THEN
    RAISE EXCEPTION 'kind_and_teams_defaults';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public' AND c.table_name = 'live_answers'
                    AND c.column_name = 'choice' AND c.is_nullable = 'YES') THEN
    RAISE EXCEPTION 'choice_may_be_null';
  END IF;
  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_constraint k
       WHERE (k.conrelid = 'public.live_questions'::regclass AND k.conname IN ('live_questions_kind_check', 'live_questions_keys_check',
                                                                             'live_questions_forms_check', 'live_questions_tops_check'))
          OR (k.conrelid = 'public.live_answers'::regclass AND k.conname = 'live_answers_shape_check')
          OR (k.conrelid = 'public.live_games'::regclass AND k.conname = 'live_games_teams_check')
          OR (k.conrelid = 'public.live_players'::regclass AND k.conname = 'live_players_team_check')) <> 7 THEN
    RAISE EXCEPTION 'checks';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.live_questions'::regclass AND k.conname = 'live_questions_options_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%''short''%' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%>= 2)%'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%<= 6)%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                     WHERE k.conrelid = 'public.live_questions'::regclass AND k.conname = 'live_questions_key_check'
                       AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%''short''%' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%''-1''%') THEN
    RAISE EXCEPTION 'options_and_key_of_a_text_question';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.live_answers'::regclass AND k.conname = 'live_answers_shape_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%num_nonnulls(choice, picks, typed) = 1%') THEN
    RAISE EXCEPTION 'one_answer_shape';
  END IF;

  -- 2. The team on join.
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_trigger t
                  WHERE t.tgrelid = 'public.live_players'::regclass AND t.tgname = 'live_players_team' AND NOT t.tgisinternal
                    AND t.tgenabled = 'O' AND t.tgfoid = 'meldy_private.live_player_team()'::regprocedure
                    AND pg_catalog.pg_get_triggerdef(t.oid) LIKE '%BEFORE INSERT ON public.live_players FOR EACH ROW%') THEN
    RAISE EXCEPTION 'team_trigger';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_player_team()'::regprocedure;
  IF pg_catalog.strpos(v_src, 'p.team = s.team and p.kicked_at is null), s.team') = 0 THEN
    RAISE EXCEPTION 'team_the_smallest_then_the_lower';
  END IF;

  -- 3. Create.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_create(jsonb,jsonb)'::regprocedure;
  IF (pg_catalog.length(v_src) - pg_catalog.length(pg_catalog.replace(v_src, 'meldy_private.live_more(i, v_text) is not null', '')))
       / pg_catalog.length('meldy_private.live_more(i, v_text) is not null') <> 3
     OR pg_catalog.strpos(v_src, 'v_text := v_mode <> ''stand'';') = 0
     OR pg_catalog.strpos(v_src, 'v_items := meldy_private.live_arrange(v_items,') = 0
     OR pg_catalog.strpos(v_src, 'live_fail(''22023'', ''teams'')') = 0
     OR pg_catalog.strpos(v_src, 'not in (''0'', ''2'', ''3'', ''4'')') = 0 THEN
    RAISE EXCEPTION 'create_draws_the_new_kinds';
  END IF;

  -- 4. The engine.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_close(uuid)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'v_share := meldy_private.live_share(v_a.picks, v_keys);') = 0
     OR pg_catalog.strpos(v_src, 'public.meldy_short_norm(v_a.typed) = any (coalesce(v_norms, ''{}''::text[]))') = 0
     OR pg_catalog.strpos(v_src, 'elsif v_share > 0 then') = 0
     OR pg_catalog.strpos(v_src, 'not meldy_private.live_name_rude(x.norm)') = 0
     OR pg_catalog.strpos(v_src, 'limit 3') = 0 THEN
    RAISE EXCEPTION 'close_scores_the_share_and_the_text';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_close_stand(uuid)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'if v_a.choice = any (v_keys) then') = 0 THEN
    RAISE EXCEPTION 'stand_any_right_zone';
  END IF;

  -- 5. The public functions and the private helpers.
  FOR v_fn IN SELECT x.sig, pg_catalog.to_regprocedure(x.sig) AS oid
                FROM pg_catalog.unnest(array['public.live_submit(uuid,text,integer,jsonb)', 'public.live_practice(uuid,text)']) x(sig) LOOP
    IF v_fn.oid IS NULL THEN
      RAISE EXCEPTION 'public_exists: %', v_fn.sig;
    END IF;
    IF NOT (SELECT p.prosecdef AND pg_catalog.array_to_string(p.proconfig, ',') IN ('search_path=""', 'search_path=')
              FROM pg_catalog.pg_proc p WHERE p.oid = v_fn.oid)
       OR NOT pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
                   WHERE p.oid = v_fn.oid AND a.grantee = 0) THEN
      RAISE EXCEPTION 'public_definer_and_grants: %', v_fn.sig;
    END IF;
  END LOOP;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_practice(uuid,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'meldy_private.record_test_answers_for(v_user, v_answers, ''web'', 30)') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.quiz_practice_ready(v_g.container_id)') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.role_in(v_user, v_g.container_id) is null') = 0
     OR pg_catalog.strpos(v_src, 'live_fail(''ML012'', ''practice'', 403)') = 0
     OR pg_catalog.strpos(v_src, 'perform meldy_private.live_fail(''28000'', null, 401);') = 0 THEN
    RAISE EXCEPTION 'practice_who_and_what';
  END IF;
  FOR v_fn IN SELECT x.sig, pg_catalog.to_regprocedure(x.sig) AS oid FROM pg_catalog.unnest(array[
      'meldy_private.live_more(public.test_items,boolean)', 'meldy_private.live_share(smallint[],smallint[])',
      'meldy_private.live_arrange(uuid[],boolean[],integer)', 'meldy_private.live_teams_json(public.live_games)',
      'meldy_private.live_player_team()']) x(sig) LOOP
    IF v_fn.oid IS NULL THEN
      RAISE EXCEPTION 'helper_exists: %', v_fn.sig;
    END IF;
    IF (SELECT p.prosecdef FROM pg_catalog.pg_proc p WHERE p.oid = v_fn.oid)
       OR pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'helper_private: %', v_fn.sig;
    END IF;
  END LOOP;

  -- 6. The right options, the forms and the tops leave only from a closed question.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('public', 'meldy_private')
                AND p.proname IN ('live_base_json', 'live_host_json', 'live_player_json', 'live_answer', 'live_submit')
                AND p.prosrc ~ '''(key|keys|forms|tops)''') THEN
    RAISE EXCEPTION 'no_keys_elsewhere';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_closed_json(public.live_games)'::regprocedure;
  IF pg_catalog.strpos(v_src, '''keys'', pg_catalog.to_jsonb(q.keys)') = 0 OR pg_catalog.strpos(v_src, '''tops'', coalesce(q.tops') = 0
     OR pg_catalog.strpos(v_src, 'q.closed_at is not null') = 0 THEN
    RAISE EXCEPTION 'keys_forms_tops_after_close';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_review(uuid,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, '''explanation'', q.explanation') = 0 OR pg_catalog.strpos(v_src, 'q.game_id = p_game and q.closed_at is not null') = 0 THEN
    RAISE EXCEPTION 'review_explanations_of_closed_questions';
  END IF;

  -- 7. The numbers.
  IF meldy_private.live_share('{0,2}', '{0,2}') <> 1 OR meldy_private.live_share('{2}', '{0,2}') <> 0.5
     OR meldy_private.live_share('{0,1}', '{0,2}') <> 0 OR meldy_private.live_share('{1,3,4}', '{0,2}') <> 0
     OR meldy_private.live_share('{1,3,0}', '{1,3,5}') <> 1.0::double precision / 3 THEN
    RAISE EXCEPTION 'share_numbers';
  END IF;
  IF meldy_private.live_arrange(v_u, '{t,f,t,t,f}', 3) <> array[v_u[1], v_u[3], v_u[2], v_u[4], v_u[5]]
     OR meldy_private.live_arrange(v_u, '{t,t,t,t,t}', 3) <> '{}'::uuid[]
     OR meldy_private.live_arrange(v_u, '{t,t,t,t,t}', 0) <> v_u THEN
    RAISE EXCEPTION 'arrange_order';
  END IF;
  v_item := pg_catalog.jsonb_populate_record(null::public.test_items, pg_catalog.jsonb_build_object(
              'kind', 'multiple', 'options', '["a", "b", "c"]'::jsonb, 'correct', '{0,2}', 'answers', '{}'));
  IF meldy_private.live_more(v_item, true) IS DISTINCT FROM 'multiple' THEN
    RAISE EXCEPTION 'more_several_right';
  END IF;
  v_item := pg_catalog.jsonb_populate_record(null::public.test_items, pg_catalog.jsonb_build_object(
              'kind', 'short', 'options', '[]'::jsonb, 'correct', '{}', 'answers', '{Москва}'));
  IF meldy_private.live_more(v_item, true) IS DISTINCT FROM 'short' OR meldy_private.live_more(v_item, false) IS NOT NULL THEN
    RAISE EXCEPTION 'more_text_not_in_stand';
  END IF;
END
$check$;
