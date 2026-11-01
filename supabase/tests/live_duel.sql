-- Run once after migration 20261106090200_live_duel.sql: the read-only check of that apply (run the other live_*.sql too).
-- A DO block that raises nothing when every check holds (supabase/migrate.py); it raises the name of the first one that
-- does not. Catalog only, plus pure calls on values built in memory (no row is read or written).
-- Checks: the four tables in public and the address throttle in meldy_private exist with row security on, no policy and
-- nothing granted to anyone (anon, authenticated, service_role, PUBLIC); a seat keeps its token as a sha256 only, one
-- seat a token and one an account in a duel, one answer a seat and question (the primary key); every public.duel_*
-- function is SECURITY DEFINER with search_path = '', not for PUBLIC, for anon and authenticated; the private
-- live_duel_* helpers have search_path = '', are not SECURITY DEFINER and no API role (service_role neither) may run
-- them; the token's shape is checked before the duel is read and its seat is found before the duel's lock; the key, the
-- forms and the other seat's answer leave a question only once it closed, the review only a finished duel; every index
-- of the options is in the seat's own order (live_run_perm of the seat's id); the grading is the challenge's
-- (live_challenge_share) and the points the battle's phase 0 (live_damage, 100 without speed, the freeze, the thaw); the
-- winner; presence; the limits (20 an hour and 20 unfinished an account, 120 an hour per address for guests only, joins
-- 120 a minute and 300 a day per address); duel_create checks everything before it cleans up; «Тренировать ошибки» joins
-- the exam only with a standing of the caller's own and never after an expired duel.
-- The behaviour is rehearsed locally: supabase/tests/local/live_game_run.sh (live_duel_behaviour.sql).
DO $check$
DECLARE
  v_rel regclass;
  v_fn record;
  v_src text;
  v_n integer;
  v_p record;
BEGIN
  -- 1. Tables: closed to everyone.
  FOR v_rel IN SELECT pg_catalog.to_regclass(t) FROM pg_catalog.unnest(array['public.live_duels', 'public.live_duel_seats',
      'public.live_duel_questions', 'public.live_duel_answers', 'meldy_private.live_duel_hits']) t LOOP
    IF v_rel IS NULL THEN
      RAISE EXCEPTION 'tables_exist';
    END IF;
    IF NOT (SELECT c.relrowsecurity FROM pg_catalog.pg_class c WHERE c.oid = v_rel)
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_policy p WHERE p.polrelid = v_rel)
       OR pg_catalog.has_table_privilege('anon', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR pg_catalog.has_table_privilege('authenticated', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR pg_catalog.has_table_privilege('service_role', v_rel, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_class c CROSS JOIN LATERAL pg_catalog.aclexplode(c.relacl) a
                   WHERE c.oid = v_rel AND a.grantee = 0) THEN
      RAISE EXCEPTION 'tables_closed: %', v_rel;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
              WHERE a.attrelid IN ('public.live_duels'::regclass, 'public.live_duel_seats'::regclass, 'public.live_duel_answers'::regclass)
                AND a.attnum > 0 AND NOT a.attisdropped AND a.attname ~ 'token' AND a.attname <> 'token_hash') THEN
    RAISE EXCEPTION 'tokens_kept_as_hashes_only';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_duel_seats'::regclass
                    AND k.conname = 'live_duel_seats_token_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%[0-9a-f]{64}%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = 'live_duel_seats_token_uidx'
                       AND i.indexdef LIKE 'CREATE UNIQUE INDEX%(duel_id, token_hash)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = 'live_duel_seats_user_uidx'
                       AND i.indexdef LIKE 'CREATE UNIQUE INDEX%(duel_id, user_id) WHERE (user_id IS NOT NULL)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = 'live_duel_seats_seat_uidx'
                       AND i.indexdef LIKE 'CREATE UNIQUE INDEX%(duel_id, seat)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_duel_answers'::regclass AND k.contype = 'p'
                       AND pg_catalog.pg_get_constraintdef(k.oid) = 'PRIMARY KEY (seat_id, qi)')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_duel_seats'::regclass
                       AND k.conname = 'live_duel_seats_seat_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%seat = ANY (ARRAY[1, 2])%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_indexes i WHERE i.schemaname = 'public' AND i.indexname = 'live_duels_code_uidx'
                       AND i.indexdef LIKE 'CREATE UNIQUE INDEX%(code)') THEN
    RAISE EXCEPTION 'two_seats_one_a_token_and_an_account_one_answer_a_question';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_duels'::regclass
                    AND k.conname = 'live_duels_q_count_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%(q_count >= 1) AND (q_count <= 30)%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_duel_seats'::regclass
                       AND k.conname = 'live_duel_seats_name_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%(char_length(name) >= 1) AND (char_length(name) <= 24)%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_duels'::regclass
                       AND k.conname = 'live_duels_calm_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%(NOT calm) OR (NOT speed)%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_duels'::regclass
                       AND k.conname = 'live_duels_round_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%(round >= 1) AND (round <= 20)%')
     OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k WHERE k.conrelid = 'public.live_duels'::regclass
                       AND k.conname = 'live_duels_end_check' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%''expired''%') THEN
    RAISE EXCEPTION 'caps_questions_names_calm_rounds_ends';
  END IF;

  -- 2. The public functions: ten, for anon and authenticated.
  v_n := 0;
  FOR v_fn IN SELECT p.oid, p.proname, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS cfg
                FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname LIKE 'duel\_%' LOOP
    v_n := v_n + 1;
    IF NOT v_fn.prosecdef OR v_fn.cfg NOT IN ('search_path=""', 'search_path=') THEN
      RAISE EXCEPTION 'definer_and_empty_search_path: %', v_fn.proname;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a
                WHERE p.oid = v_fn.oid AND a.grantee = 0) THEN
      RAISE EXCEPTION 'no_public_execute: %', v_fn.proname;
    END IF;
    IF NOT pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE')
       OR NOT pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'functions_for_anon_and_authenticated: %', v_fn.proname;
    END IF;
  END LOOP;
  IF v_n <> 10 THEN
    RAISE EXCEPTION 'ten_functions: %', v_n;
  END IF;
  FOR v_fn IN SELECT x.sig, pg_catalog.to_regprocedure(x.sig) AS oid FROM pg_catalog.unnest(array[
      'public.duel_create(jsonb,jsonb,text,text,jsonb)', 'public.duel_info(text)', 'public.duel_join(text,text,text,jsonb)',
      'public.duel_state(text,text,bigint)', 'public.duel_ready(text,text)', 'public.duel_answer(text,text,integer,jsonb)',
      'public.duel_next(text,text,integer)', 'public.duel_rematch(text,text)', 'public.duel_review(text,text)',
      'public.duel_practice(text,text)']) x(sig) LOOP
    IF v_fn.oid IS NULL THEN
      RAISE EXCEPTION 'contract_signature: %', v_fn.sig;
    END IF;
  END LOOP;
  -- the token's shape is checked before the duel is read; a seat's call goes through live_duel_enter
  FOR v_fn IN SELECT p.proname, p.prosrc FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'public' AND p.proname IN ('duel_state', 'duel_ready', 'duel_answer', 'duel_next', 'duel_rematch',
                                                            'duel_review', 'duel_practice') LOOP
    IF pg_catalog.strpos(v_fn.prosrc, 'v_s := meldy_private.live_duel_enter(p_code, p_token);') = 0
       OR pg_catalog.strpos(v_fn.prosrc, 'if p_token is null or p_token !~ ''^[A-Za-z0-9_-]{43}$'' then') = 0
       OR pg_catalog.strpos(v_fn.prosrc, 'if p_token is null or p_token !~ ''^[A-Za-z0-9_-]{43}$'' then')
          > pg_catalog.strpos(v_fn.prosrc, 'v_s := meldy_private.live_duel_enter(p_code, p_token);') THEN
      RAISE EXCEPTION 'own_seat_by_the_token_checked_first: %', v_fn.proname;
    END IF;
  END LOOP;
  -- the seat of the token is found before the duel's lock: a wrong token never holds it
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_duel_enter(text,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 's.duel_id = v_d.id and s.token_hash = v_hash') = 0
     OR pg_catalog.strpos(v_src, 'live_fail(''P0002'', ''token'', 404)') = 0
     OR pg_catalog.strpos(v_src, 'live_fail(''P0002'', ''token'', 404)') > pg_catalog.strpos(v_src, 'for update')
     OR pg_catalog.strpos(v_src, 'for update') > pg_catalog.strpos(v_src, 'meldy_private.live_duel_settle(v_d.id, v_s.id)') THEN
    RAISE EXCEPTION 'token_seat_before_the_lock';
  END IF;
  -- an occupied invited seat is refused before any lock or write
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.duel_join(text,text,text,jsonb)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'perform meldy_private.live_fail(''ML001'', ''full'');') = 0
     OR pg_catalog.strpos(v_src, 'perform meldy_private.live_fail(''ML001'', ''full'');')
        > pg_catalog.strpos(v_src, 'perform 1 from public.live_duels d where d.id = v_d.id for update;
  v_d := meldy_private.live_duel_settle(v_d.id, null);')
     OR pg_catalog.strpos(v_src, 'perform meldy_private.live_fail(''ML001'', ''full'');') > pg_catalog.strpos(v_src, 'insert into') THEN
    RAISE EXCEPTION 'full_seat_refused_before_any_lock_or_write';
  END IF;

  -- 3. The private helpers: closed to everyone.
  v_n := 0;
  FOR v_fn IN SELECT p.oid, p.proname, p.prosecdef, pg_catalog.array_to_string(p.proconfig, ',') AS cfg
                FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
               WHERE n.nspname = 'meldy_private' AND p.proname LIKE 'live\_duel\_%' LOOP
    v_n := v_n + 1;
    IF v_fn.cfg NOT IN ('search_path=""', 'search_path=') OR v_fn.prosecdef
       OR pg_catalog.has_function_privilege('anon', v_fn.oid, 'EXECUTE') OR pg_catalog.has_function_privilege('authenticated', v_fn.oid, 'EXECUTE')
       OR pg_catalog.has_function_privilege('service_role', v_fn.oid, 'EXECUTE')
       OR EXISTS (SELECT 1 FROM pg_catalog.pg_proc p CROSS JOIN LATERAL pg_catalog.aclexplode(p.proacl) a WHERE p.oid = v_fn.oid AND a.grantee = 0) THEN
      RAISE EXCEPTION 'private_helpers_closed: %', v_fn.proname;
    END IF;
  END LOOP;
  IF v_n < 20 THEN
    RAISE EXCEPTION 'private_helpers_exist: %', v_n;
  END IF;

  -- 4. The key and the other seat's answer leave only once the question closed; the review only a finished duel; every
  --    index in the seat's own order.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_duel_json(public.live_duels,public.live_duel_seats)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'if v_q.closed_at is not null then
      v_result := pg_catalog.jsonb_build_object(''qi'', v_q.qi)
                  || meldy_private.live_duel_key(v_q, v_perm)') = 0
     OR pg_catalog.strpos(v_src, '''other'', meldy_private.live_duel_side(v_theirs, v_perm, false)') = 0
     OR (SELECT pg_catalog.count(*) FROM pg_catalog.regexp_matches(v_src, 'live_duel_key|live_duel_side', 'g')) <> 3
     OR v_src ~ '''(key|keys|forms|tolerance|explanation)'''
     OR pg_catalog.strpos(v_src, '''answered'', v_theirs.at is not null') = 0
     OR pg_catalog.strpos(v_src, 'if v_q.shown_at is not null and pg_catalog.now() < v_q.shown_at then') = 0
     OR pg_catalog.strpos(v_src, 'v_perm := meldy_private.live_run_perm(p_me.id, v_q.qi, pg_catalog.jsonb_array_length(v_q.options), v_q.keep_order);') = 0 THEN
    RAISE EXCEPTION 'key_and_the_other_answer_only_once_closed_in_the_own_order';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_duel_side(public.live_duel_answers,smallint[],boolean)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'p_a.settled_at is null then null') = 0
     OR pg_catalog.strpos(v_src, 'not p_own and meldy_private.live_duel_rude(p_a.typed) then ''{"masked": true}''::jsonb') = 0 THEN
    RAISE EXCEPTION 'the_other_answer_graded_only_and_masked';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.duel_review(text,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'if v_d.stage <> ''final'' then
    perform meldy_private.live_fail(''ML004'', ''not_done'');') = 0
     OR pg_catalog.strpos(v_src, 'where q.duel_id = v_d.id and q.closed_at is not null') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.live_run_perm(v_s.id, q.qi, pg_catalog.jsonb_array_length(q.options), q.keep_order)') = 0 THEN
    RAISE EXCEPTION 'review_of_a_finished_duel_closed_questions_own_order';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.duel_answer(text,text,integer,jsonb)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'v_perm := meldy_private.live_run_perm(v_s.id, v_q.qi, v_options, v_q.keep_order);') = 0
     OR pg_catalog.strpos(v_src, 'select pg_catalog.array_agg(v_perm[x + 1] order by v_perm[x + 1]) into v_picks') = 0
     OR pg_catalog.strpos(v_src, 'if v_now < v_q.opens_at then') = 0
     OR pg_catalog.strpos(v_src, 'v_now > v_q.closes_at + interval ''1.5 seconds''') = 0
     OR pg_catalog.strpos(v_src, 'when unique_violation then
      perform meldy_private.live_fail(''ML004'', ''twice'');') = 0
     OR v_src ~ 'live_duel_points|live_duel_share' THEN
    RAISE EXCEPTION 'answers_by_the_server_clock_once_ungraded_in_the_question_order';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE (n.nspname, p.proname) IN (('meldy_private', 'live_duel_info_json'), ('public', 'duel_info'), ('public', 'duel_state'))
                AND p.prosrc ~ '''(key|keys|forms|typed|choice|picks)''') THEN
    RAISE EXCEPTION 'no_key_and_no_answer_elsewhere';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname IN ('public', 'meldy_private') AND (p.proname LIKE 'duel\_%' OR p.proname LIKE 'live\_duel\_%')
                AND (p.prosrc ~ '''(token_hash|seat_id)'','
                     OR p.prosrc ~ '''(id|token|seat_id)'', *[a-z_0-9]+\.(id|token_hash)\M'
                     OR p.prosrc ~ '''token'', *p_token')) THEN
    RAISE EXCEPTION 'no_token_hash_or_seat_id_sent';
  END IF;

  -- 5. The grading and the numbers: the challenge's share, the battle's phase 0, the winner, presence.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'meldy_private.live_duel_share(public.live_duel_questions,smallint,smallint[],text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'meldy_private.live_challenge_share(') = 0 THEN
    RAISE EXCEPTION 'grading_is_the_challenges';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p
   WHERE p.oid = 'meldy_private.live_duel_points(integer,boolean,double precision,integer,integer,boolean,boolean)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'meldy_private.live_damage(v_elapsed, p_time_s, p_streak + 1, p_speed)') = 0
     OR pg_catalog.strpos(v_src, 'case when p_calm then 100') = 0 THEN
    RAISE EXCEPTION 'numbers_are_the_battles';
  END IF;
  SELECT x.* INTO v_p FROM meldy_private.live_duel_points(0, false, 1, 1000, 20, true, false) x;
  IF (v_p.dmg, v_p.correct, v_p.streak, v_p.frozen) IS DISTINCT FROM (98, true, 1, false) THEN
    RAISE EXCEPTION 'points_right_at_1s_of_20: %', v_p;
  END IF;
  SELECT x.* INTO v_p FROM meldy_private.live_duel_points(2, false, 0, 1000, 20, true, false) x;
  IF (v_p.dmg, v_p.correct, v_p.streak, v_p.frozen) IS DISTINCT FROM (0, false, 0, true) THEN
    RAISE EXCEPTION 'points_wrong_freezes: %', v_p;
  END IF;
  SELECT x.* INTO v_p FROM meldy_private.live_duel_points(0, true, 1, 0, 20, true, false) x;
  IF (v_p.dmg, v_p.thawed, v_p.streak, v_p.frozen) IS DISTINCT FROM (0, true, 1, false) THEN
    RAISE EXCEPTION 'points_right_thaws: %', v_p;
  END IF;
  SELECT x.* INTO v_p FROM meldy_private.live_duel_points(3, false, null, null, 20, true, false) x;
  IF (v_p.dmg, v_p.streak, v_p.frozen) IS DISTINCT FROM (0, 0, false) THEN
    RAISE EXCEPTION 'points_none_freezes_nobody: %', v_p;
  END IF;
  SELECT x.* INTO v_p FROM meldy_private.live_duel_points(0, false, 0, 5000, 10, false, true) x;
  IF (v_p.dmg, v_p.frozen) IS DISTINCT FROM (0, false) THEN
    RAISE EXCEPTION 'points_calm_freezes_nobody: %', v_p;
  END IF;
  SELECT x.* INTO v_p FROM meldy_private.live_duel_points(0, false, 0.5, 19999, 30, false, true) x;
  IF v_p.dmg <> 50 THEN
    RAISE EXCEPTION 'points_calm_half: %', v_p;
  END IF;
  IF meldy_private.live_duel_winner(300, 2, 200, 3) <> 1 OR meldy_private.live_duel_winner(200, 2, 200, 3) <> 2
     OR meldy_private.live_duel_winner(200, 2, 200, 2) IS NOT NULL THEN
    RAISE EXCEPTION 'winner_points_then_right';
  END IF;
  IF NOT meldy_private.live_duel_here(pg_catalog.now() - interval '19 seconds', pg_catalog.now())
     OR meldy_private.live_duel_here(pg_catalog.now() - interval '21 seconds', pg_catalog.now())
     OR meldy_private.live_duel_here(null, pg_catalog.now()) THEN
    RAISE EXCEPTION 'presence_twenty_seconds';
  END IF;
  IF NOT meldy_private.live_duel_rude('ну  су-ка ') OR meldy_private.live_duel_rude('Москва') THEN
    RAISE EXCEPTION 'rude_filter_of_names';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_duel_settle(uuid,uuid)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'interval ''1 day''') = 0 OR pg_catalog.strpos(v_src, 'interval ''2 minutes''') = 0
     OR pg_catalog.strpos(v_src, 'interval ''60 seconds''') = 0 OR pg_catalog.strpos(v_src, 'interval ''2 seconds''') = 0
     OR pg_catalog.strpos(v_src, 'interval ''1.5 seconds''') = 0
     OR pg_catalog.strpos(v_src, '(p_caller is null or v_s2.id <> p_caller)') = 0
     OR pg_catalog.strpos(v_src, 'for v_i in 1 .. 8 loop') = 0 THEN
    RAISE EXCEPTION 'settle_timeline_and_disconnects';
  END IF;

  -- 6. The limits; the create's checks before any cleanup; practice.
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_duel_limits(uuid,text,boolean)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'd.owner_id = p_user and d.created_at > pg_catalog.now() - interval ''1 hour'') >= 20') = 0
     OR pg_catalog.strpos(v_src, 'perform meldy_private.live_fail(''ML009'', null);') = 0
     OR pg_catalog.strpos(v_src, 'elsif p_ip is not null then') = 0
     OR pg_catalog.strpos(v_src, 'h.kind = ''create'' and h.at > pg_catalog.now() - interval ''1 hour'') >= 120') = 0 THEN
    RAISE EXCEPTION 'create_limits_account_and_guest_address';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.duel_join(text,text,text,jsonb)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'h.kind = ''join'' and h.at > pg_catalog.now() - interval ''1 minute'') >= 120') = 0
     OR pg_catalog.strpos(v_src, 'h.kind = ''join'' and h.at > pg_catalog.now() - interval ''1 day'') >= 300') = 0
     OR pg_catalog.strpos(v_src, 'v_name := meldy_private.live_name_check(p_name);') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.live_look_check(p_look') = 0 THEN
    RAISE EXCEPTION 'join_limits_name_look';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.duel_create(jsonb,jsonb,text,text,jsonb)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'delete from public.live_duels d') = 0
     OR pg_catalog.strpos(v_src, 'v_name := meldy_private.live_name_check(p_name);') > pg_catalog.strpos(v_src, 'delete from public.live_duels d')
     OR pg_catalog.strpos(v_src, 'meldy_private.live_look_check(p_look') > pg_catalog.strpos(v_src, 'delete from public.live_duels d')
     OR pg_catalog.strpos(v_src, 'perform meldy_private.live_duel_limits(v_user, case when v_user is null then v_ip end, false);') > pg_catalog.strpos(v_src, 'delete from public.live_duels d')
     OR pg_catalog.strpos(v_src, 'perform meldy_private.live_fail(''ML008''') > pg_catalog.strpos(v_src, 'delete from public.live_duels d')
     OR pg_catalog.strpos(v_src, 'live_fail(''ML002'', ''expired'')') = 0
     OR pg_catalog.strpos(v_src, 'if not meldy_private.live_challenge_over(v_ch) then') = 0
     OR pg_catalog.strpos(v_src, 'join public.live_challenge_questions q on q.challenge_id = v_new.source_id and q.qi = x.qi') = 0
     OR pg_catalog.strpos(v_src, 'join public.live_questions q on q.game_id = v_new.source_id and q.qi = x.qi') = 0
     OR pg_catalog.strpos(v_src, 'q.closed_at is not null and q.pictures is null') = 0 THEN
    RAISE EXCEPTION 'create_checks_first_frozen_sources_and_windows';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_duel_rematch_make(uuid)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'perform meldy_private.live_duel_limits(v_o.owner_id, case when v_o.owner_id is null then v_ip end, true);') = 0
     OR pg_catalog.strpos(v_src, 'if v_o.round >= 20 then') = 0 THEN
    RAISE EXCEPTION 'rematch_counts_against_the_hourly_limits';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.duel_practice(text,text)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'meldy_private.record_test_answers_for(v_user, v_answers, ''web'', 30)') = 0
     OR pg_catalog.strpos(v_src, 'if v_d.end_reason = ''expired'' or v_d.ended_at < pg_catalog.now() - interval ''7 days'' then') = 0
     OR pg_catalog.strpos(v_src, 'if not coalesce(v_standing, false) then
      perform meldy_private.live_fail(''ML012'', ''practice'', 403);') = 0
     OR pg_catalog.strpos(v_src, 'if not coalesce(v_standing, false) then') > pg_catalog.strpos(v_src, 'insert into public.container_members')
     OR pg_catalog.strpos(v_src, 'c.owner_id = v_d.owner_id') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.live_challenge_end_at(c) >= pg_catalog.now() - interval ''7 days''') = 0
     OR pg_catalog.strpos(v_src, 'p.kicked_at is null') = 0
     OR pg_catalog.strpos(v_src, 'a.quiz_id = v_d.quiz_id and a.user_id = v_user and a.finished_at is not null') = 0
     OR pg_catalog.strpos(v_src, 'meldy_private.quiz_practice_ready(v_d.container_id)') = 0
     OR pg_catalog.strpos(v_src, 'pg_catalog.jsonb_build_object(''rev'', q.item_rev)') = 0 THEN
    RAISE EXCEPTION 'practice_joins_only_with_an_own_standing_never_after_expired';
  END IF;
END
$check$;
