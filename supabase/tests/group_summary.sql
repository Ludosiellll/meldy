-- Run once after migration 20261109090000_group_summary.sql: the read-only check of that apply. A DO block that raises
-- nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not. Catalog only.
-- Checks: public.container_group_summary(uuid) is there, returns jsonb, is STABLE, SECURITY DEFINER with an empty
-- search_path; authenticated may run it, anon and the service role may not; its body keeps the guards of
-- docs/answers-privacy.md — the caller must be the exam's author (28000, P0002), no number under 5 members, a topic
-- only from 5 different members and 30 answers, members who left or were removed and the author left out, the rows of
-- quiz_send_mistakes (source 'quiz') left out — and builds no key that could say who (no account id, no name, no read
-- of public.profiles or auth.users). The behaviour is rehearsed locally: supabase/tests/local/group_summary_run.sh.
DO $check$
DECLARE
  v_sig constant text := 'public.container_group_summary(uuid)';
  v_fn regprocedure := pg_catalog.to_regprocedure(v_sig);
  v_proc pg_catalog.pg_proc%rowtype;
  v_src text;
  v_need text;
  v_ban text;
BEGIN
  IF v_fn IS NULL THEN
    RAISE EXCEPTION 'function_missing';
  END IF;
  SELECT p.* INTO v_proc FROM pg_catalog.pg_proc p WHERE p.oid = v_fn;
  v_src := v_proc.prosrc;
  IF v_proc.prorettype <> 'jsonb'::regtype THEN
    RAISE EXCEPTION 'returns_jsonb';
  END IF;
  IF v_proc.provolatile <> 's' THEN
    RAISE EXCEPTION 'stable';
  END IF;
  IF NOT v_proc.prosecdef THEN
    RAISE EXCEPTION 'security_definer';
  END IF;
  IF NOT coalesce(v_proc.proconfig @> ARRAY['search_path=""'], false) THEN
    RAISE EXCEPTION 'empty_search_path';
  END IF;

  -- Who runs it: authenticated only.
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'authenticated')
     AND NOT pg_catalog.has_function_privilege('authenticated', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'granted_to_authenticated';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'anon')
     AND pg_catalog.has_function_privilege('anon', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'not_for_anon';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles r WHERE r.rolname = 'service_role')
     AND pg_catalog.has_function_privilege('service_role', v_sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'not_for_service_role';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.aclexplode(coalesce(v_proc.proacl, pg_catalog.acldefault('f', v_proc.proowner))) a
              WHERE a.grantee = 0 AND a.privilege_type = 'EXECUTE') THEN
    RAISE EXCEPTION 'not_for_public';
  END IF;

  -- The guards, as the body writes them.
  FOREACH v_need IN ARRAY ARRAY[
    'v_user uuid := auth.uid();',
    'errcode = ''28000''',
    'where c.id = p_container_id and c.owner_id = v_user) then',
    'errcode = ''P0002''',
    'c_min constant integer := 5;',
    'if v_members < c_min then',
    'return pg_catalog.jsonb_build_object(''members'', v_members, ''min_members'', c_min);',
    'm.left_at is null and m.removed_at is null and m.user_id <> v_user',
    'c_topic_answers constant integer := 30;',
    'having pg_catalog.count(distinct a.user_id) >= c_min and pg_catalog.count(*) >= c_topic_answers',
    'on i.id = st.item_id and i.rev = st.item_rev and i.keyed',
    'on i.id = a.item_id and i.rev = a.item_rev and i.container_id = p_container_id',
    'where h.place <= 3'
  ] LOOP
    IF pg_catalog.strpos(v_src, v_need) = 0 THEN
      RAISE EXCEPTION 'guard_missing: %', v_need;
    END IF;
  END LOOP;
  -- Both reads of the answers leave out the rows the author's «send the mistakes» wrote, and take the members' only.
  IF (pg_catalog.length(v_src) - pg_catalog.length(pg_catalog.replace(v_src, 'a.source <> ''quiz''', ''))) / pg_catalog.length('a.source <> ''quiz''') <> 2 THEN
    RAISE EXCEPTION 'quiz_rows_left_out_twice';
  END IF;
  IF (pg_catalog.length(v_src) - pg_catalog.length(pg_catalog.replace(v_src, 'a.user_id in (select mem.user_id from mem)', '')))
       / pg_catalog.length('a.user_id in (select mem.user_id from mem)') <> 2 THEN
    RAISE EXCEPTION 'members_answers_only';
  END IF;
  -- Nothing that could say who.
  FOREACH v_ban IN ARRAY ARRAY['''user_id''', 'full_name', 'profiles', 'auth.users', 'email', 'joined_at'] LOOP
    IF pg_catalog.strpos(v_src, v_ban) > 0 THEN
      RAISE EXCEPTION 'could_say_who: %', v_ban;
    END IF;
  END LOOP;
END
$check$;
