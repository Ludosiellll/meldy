-- Run once after migration 20261106090100_live_challenge.sql: the read-only check of that apply (run the other live_*.sql
-- too). A DO block that raises nothing when every check holds (supabase/migrate.py); it raises the name of the first
-- one that does not. Catalog only, plus pure calls on rows built in memory (no row is read or written).
-- Checks: the four tables in public and the address throttle in meldy_private exist with row security on, no policy and
-- nothing granted to the API roles (nor PUBLIC); a run keeps its token as a sha256 only, one run a token and one an
-- account in a challenge, one answer a run and question; every public.challenge* function is SECURITY DEFINER with
-- search_path = '', not for PUBLIC; the player's eight for anon and authenticated, the author's five for authenticated
-- only; the private helpers have search_path = '' and no EXECUTE for the API roles; the key and the forms leave a run's
-- question only once it is graded (live_run_json reads settled_at), the review only graded questions of that run; the
-- grading is the battle's (live_share, meldy_number_right, meldy_short_norm, live_damage, 100 without speed, the freeze,
-- the heal); the start's limits (120 a minute per address and per link, 300 runs, the name and look checks); the table
-- orders by points, right answers and time; «Тренировать ошибки» goes through record_test_answers_for with lc:<run>:<qi>.
-- The behaviour is rehearsed locally: supabase/tests/local/live_game_run.sh (live_challenge_behaviour.sql).
DO $check$
DECLARE
  v_rel regclass;
  v_fn record;
  v_src text;
  v_n integer;
  v_q public.live_challenge_questions;
BEGIN
  -- 1. Tables: closed to the API roles.
  FOR v_rel IN SELECT pg_catalog.to_regclass(t) FROM pg_catalog.unnest(array['public.live_challenges', 'public.live_challenge_questions',
      'public.live_runs', 'public.live_run_answers', 'meldy_private.live_challenge_hits']) t LOOP
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
  IF pg_catalog.has_table_privilege('service_role', 'meldy_private.live_challenge_hits', 'SELECT,INSERT,UPDATE,DELETE') THEN
    RAISE EXCEPTION 'throttle_closed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid IN ('public.live_challenges'::regclass, 'public.live_runs'::regclass, 'public.live_run_answers'::regclass)
                AND a.attnum > 0 AND NOT a.attisdropped AND a.attname ~ 'token' AND a.attname <> 'token_hash') THEN
    RAISE EXCEPTION 'tokens_kept_as_hashes_only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_runs'::regclass
                    AND k.conname = 'live_runs_token_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%[0-9a-f]{64}%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = 'live_runs_token_uidx'
                       AND i.indexdef LIKE 'CREATE UNIQUE INDEX%(challenge_id, token_hash)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = 'live_runs_user_uidx'
                       AND i.indexdef LIKE 'CREATE UNIQUE INDEX%(challenge_id, user_id) WHERE (user_id IS NOT NULL)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_run_answers'::regclass AND k.contype = 'p'
                       AND pg_catalog.pg_get_constraintdef(k.oid) = 'PRIMARY KEY (run_id, qi)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = 'live_challenges_code_uidx'
                       AND i.indexdef LIKE 'CREATE UNIQUE INDEX%(code)') THEN
    RAISE EXCEPTION 'one_run_a_token_and_an_account_one_answer_a_question';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = 'live_runs_board_idx'
                    AND i.indexdef LIKE '%(challenge_id, dmg DESC, right_n DESC, time_ms, finished_at, id) WHERE ((finished_at IS NOT NULL) AND (removed_at IS NULL))') THEN
    RAISE EXCEPTION 'board_index';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_challenges'::regclass
                    AND k.conname = 'live_challenges_q_count_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%(q_count >= 1) AND (q_count <= 30)%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_runs'::regclass
                       AND k.conname = 'live_runs_name_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%(char_length(name) >= 1) AND (char_length(name) <= 24)%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_challenges'::regclass
                       AND k.conname = 'live_challenges_calm_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%(NOT calm) OR (NOT speed)%') THEN
    RAISE EXCEPTION 'caps_questions_names_calm';
  END IF;

  -- 2. The public functions: the player's eight for anon and authenticated, the author's five for authenticated only.
  v_n := 0;
  FOR v_fn IN SELECT p.oid, p.proname, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS cfg
                FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND (p.proname LIKE 'challenge\_%' OR p.proname = 'challenges_mine') LOOP
    v_n := v_n + 1;
    IF NOT v_fn.prosecdef OR v_fn.cfg NOT IN ('search_path=""', 'search_path=') THEN
      RAISE EXCEPTION 'definer_and_empty_search_path: %', v_fn.proname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
                WHERE p.oid = v_fn.oid AND a.grantee = 0) THEN
      RAISE EXCEPTION 'no_public_execute: %', v_fn.proname;
    END IF;
    IF v_fn.proname IN ('challenge_create', 'challenge_close', 'challenge_remove', 'challenge_results', 'challenges_mine') THEN
      IF pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE') OR NOT pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') THEN
        RAISE EXCEPTION 'author_functions_for_authenticated_only: %', v_fn.proname;
      END IF;
    ELSIF NOT pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE')
          OR NOT pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'player_functions_for_anon_and_authenticated: %', v_fn.proname;
    END IF;
  END LOOP;
  IF v_n <> 13 THEN
    RAISE EXCEPTION 'thirteen_functions: %', v_n;
  END IF;
  FOR v_fn IN SELECT x.sig, pg_catalog.to_regprocedure(x.sig) AS oid FROM pg_catalog.unnest(array[
      'public.challenge_create(jsonb,jsonb)', 'public.challenge_close(uuid)', 'public.challenge_remove(uuid,uuid)',
      'public.challenge_results(uuid)', 'public.challenges_mine(uuid)', 'public.challenge_info(text)',
      'public.challenge_join(text,text,text,jsonb)', 'public.challenge_state(text,text)', 'public.challenge_next(text,text,integer)',
      'public.challenge_answer(text,text,integer,jsonb)', 'public.challenge_board(text,text)', 'public.challenge_review(text,text)',
      'public.challenge_practice(text,text)']) x(sig) LOOP
    IF v_fn.oid IS NULL THEN
      RAISE EXCEPTION 'contract_signature: %', v_fn.sig;
    END IF;
  END LOOP;
  -- the author's take the caller from the session; the player's take the code and the own token
  FOR v_fn IN SELECT p.proname, p.prosrc FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname IN ('challenge_create', 'challenges_mine', 'challenge_practice') LOOP
    IF pg_catalog.strpos(v_fn.prosrc, 'v_user uuid := auth.uid();') = 0 OR pg_catalog.strpos(v_fn.prosrc, 'live_fail(''28000'', null, 401)') = 0 THEN
      RAISE EXCEPTION 'caller_from_the_session: %', v_fn.proname;
    END IF;
  END LOOP;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_challenge_owned(uuid,boolean)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'v_user uuid := auth.uid();') = 0 OR pg_catalog.strpos(v_src, 'if v_c.owner_id <> v_user then') = 0 THEN
    RAISE EXCEPTION 'author_is_the_owner';
  END IF;
  FOR v_fn IN SELECT p.proname, p.prosrc FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname IN ('challenge_state', 'challenge_next', 'challenge_answer', 'challenge_review',
                                                            'challenge_practice') LOOP
    IF pg_catalog.strpos(v_fn.prosrc, 'meldy_private.live_run_of(v_c, p_token)') = 0 THEN
      RAISE EXCEPTION 'own_run_by_the_token: %', v_fn.proname;
    END IF;
  END LOOP;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_run_of(public.live_challenges,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'r.challenge_id = p_c.id and r.token_hash = meldy_private.live_hash(p_token)') = 0
     OR pg_catalog.strpos(v_src, 'live_fail(''42501'', ''removed'', 403)') = 0 THEN
    RAISE EXCEPTION 'run_of_this_link_and_token';
  END IF;

  -- 3. The private helpers.
  FOR v_fn IN SELECT p.oid, p.proname, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS cfg
                FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'meldy_private' AND (p.proname LIKE 'live\_challenge\_%' OR p.proname LIKE 'live\_run\_%') LOOP
    IF v_fn.cfg NOT IN ('search_path=""', 'search_path=') OR v_fn.prosecdef
       OR pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid = v_fn.oid AND a.grantee = 0) THEN
      RAISE EXCEPTION 'private_helpers_closed: %', v_fn.proname;
    END IF;
  END LOOP;

  -- 4. The key leaves only once that person's question is graded; the review only the run's graded questions.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_run_json(public.live_challenges,public.live_runs)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'if v_a.settled_at is not null then
      v_result := pg_catalog.jsonb_build_object(
        ''qi'', v_q.qi, ''key'', v_q.key') = 0
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.regexp_matches(v_src, '''(key|keys|forms|tolerance|explanation)''', 'g')) <> 6 THEN
    RAISE EXCEPTION 'key_only_once_graded';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.challenge_review(text,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'where a.run_id = v_r.id and a.settled_at is not null') = 0
     OR pg_catalog.strpos(v_src, 'if v_r.finished_at is null then') = 0 THEN
    RAISE EXCEPTION 'review_of_the_own_finished_run';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE (n.nspname, p.proname) IN (('meldy_private', 'live_challenge_json'), ('meldy_private', 'live_challenge_board_json'),
                                               ('public', 'challenge_info'), ('public', 'challenge_board'), ('public', 'challenge_results'),
                                               ('public', 'challenges_mine'))
                AND p.prosrc ~ '''(key|keys|forms)''') THEN
    RAISE EXCEPTION 'no_key_elsewhere';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.challenge_answer(text,text,integer,jsonb)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'if v_now < v_a.opens_at then') = 0
     OR pg_catalog.strpos(v_src, 'if v_now > v_a.closes_at + interval ''1.5 seconds'' then') = 0
     OR pg_catalog.strpos(v_src, 'case when v_a.at is null then ''late'' else ''twice'' end') = 0 THEN
    RAISE EXCEPTION 'answers_by_the_server_clock_once';
  END IF;

  -- 5. The battle's grading and numbers.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'meldy_private.live_challenge_share(public.live_challenge_questions,smallint,smallint[],text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'meldy_private.live_share(p_picks, coalesce(p_q.keys, array[p_q.key]))') = 0
     OR pg_catalog.strpos(v_src, 'public.meldy_number_right(p_typed, p_q.forms, p_q.tolerance, p_q.unit)') = 0
     OR pg_catalog.strpos(v_src, 'public.meldy_short_norm(p_typed)') = 0 THEN
    RAISE EXCEPTION 'grading_is_the_battles';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'meldy_private.live_run_score(uuid,integer,smallint,smallint[],text,timestamptz)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'meldy_private.live_damage(v_elapsed, v_c.time_s, v_streak + 1, v_c.speed)') = 0
     OR pg_catalog.strpos(v_src, 'v_dmg := case when v_c.calm then 100') = 0
     OR pg_catalog.strpos(v_src, '* v_share + 0.5)::integer end;') = 0
     OR pg_catalog.strpos(v_src, 'v_frozen := v_frozen or not v_c.calm;') = 0
     OR pg_catalog.strpos(v_src, 'v_frozen := v_frozen or (not v_c.calm and v_a.phase >= 1);') = 0
     OR pg_catalog.strpos(v_src, 'if v_a.phase = 2 and v_hp > 0 and not v_right then') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.live_phase_for(v_hp, v_r.hp_max)') = 0 THEN
    RAISE EXCEPTION 'numbers_are_the_battles';
  END IF;
  v_q := row(null, 0, null, 'multiple', 'Q', '["a","b","c","d"]'::jsonb, '{0,1,2,3}'::smallint[], 0, '{0,2}'::smallint[], null,
             null, null, null)::public.live_challenge_questions;
  IF meldy_private.live_challenge_share(v_q, null, '{0,2}', null) <> 1 OR meldy_private.live_challenge_share(v_q, null, '{2}', null) <> 0.5
     OR meldy_private.live_challenge_share(v_q, null, '{0,1}', null) <> 0 OR meldy_private.live_challenge_share(v_q, null, null, null) <> 0 THEN
    RAISE EXCEPTION 'share_of_ticks';
  END IF;
  v_q := row(null, 0, null, 'short', 'Q', '[]'::jsonb, '{}'::smallint[], -1, null, '{Москва}'::text[], null, null, null)::public.live_challenge_questions;
  IF meldy_private.live_challenge_share(v_q, null, null, '  москва. ') <> 1 OR meldy_private.live_challenge_share(v_q, null, null, 'Питер') <> 0 THEN
    RAISE EXCEPTION 'share_of_a_text';
  END IF;
  v_q := row(null, 0, null, 'number', 'Q', '[]'::jsonb, '{}'::smallint[], -1, null, '{42}'::text[], 0.5, 'м', null)::public.live_challenge_questions;
  IF meldy_private.live_challenge_share(v_q, null, null, '41,6 м') <> 1 OR meldy_private.live_challenge_share(v_q, null, null, '43') <> 0 THEN
    RAISE EXCEPTION 'share_of_a_number';
  END IF;
  v_q := row(null, 0, null, 'single', 'Q', '["a","b"]'::jsonb, '{1,0}'::smallint[], 1, null, null, null, null, null)::public.live_challenge_questions;
  IF meldy_private.live_challenge_share(v_q, 1::smallint, null, null) <> 1 OR meldy_private.live_challenge_share(v_q, 0::smallint, null, null) <> 0 THEN
    RAISE EXCEPTION 'share_of_a_tap';
  END IF;

  -- 6. The limits of a start, the table's order, practice.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.challenge_join(text,text,text,jsonb)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'h.ip_hash = v_ip and h.at > pg_catalog.now() - interval ''1 minute'') >= 120') = 0
     OR pg_catalog.strpos(v_src, 'r.joined_at > pg_catalog.now() - interval ''1 minute'') >= 120') = 0
     OR pg_catalog.strpos(v_src, 'r.removed_at is null) >= 300 then') = 0
     OR pg_catalog.strpos(v_src, 'v_name := meldy_private.live_name_check(p_name);') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.live_look_check(p_look') = 0
     OR pg_catalog.strpos(v_src, 'v_hash := meldy_private.live_hash(p_token);') = 0 THEN
    RAISE EXCEPTION 'join_limits_120_a_minute_per_address_and_link_300_runs_name_look';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_challenge_board_json(public.live_challenges,uuid)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'pg_catalog.rank() over (order by r.dmg desc, r.right_n desc, r.time_ms)') = 0
     OR pg_catalog.strpos(v_src, 'limit 50') = 0 THEN
    RAISE EXCEPTION 'board_order_and_size';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.challenge_practice(text,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'meldy_private.record_test_answers_for(v_user, v_answers, ''web'', 30)') = 0
     OR pg_catalog.strpos(v_src, '''client_event_id'', ''lc:'' || pg_catalog.replace(v_r.id::text, ''-'', '''') || '':'' || q.qi') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.quiz_practice_ready(v_c.container_id)') = 0
     OR pg_catalog.strpos(v_src, 'v_q.offer_practice') = 0 THEN
    RAISE EXCEPTION 'practice_as_live_practice';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_challenge_kind(public.test_items)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'else meldy_private.live_more(p_item, true)') = 0 OR pg_catalog.strpos(v_src, 'p_item.images -> ''stem''') = 0 THEN
    RAISE EXCEPTION 'the_battles_kinds_without_pictures';
  END IF;
END
$check$;
