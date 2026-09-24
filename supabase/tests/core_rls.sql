-- Run after migrations. This is a metadata-only contract test; it reads no user rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'assignment_completions'
      AND policyname = 'Completions are viewable by everyone' AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND qual ILIKE '%student_id%' AND qual ILIKE '%auth.uid%'
      AND qual ILIKE '%assignments%' AND qual ILIKE '%groups%'
  ) THEN
    RAISE EXCEPTION 'assignment completion reads must be limited to the student or their group teacher';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'co_study_messages'
      AND policyname = 'Users can read co-study messages' AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND qual ILIKE '%materials%' AND qual ILIKE '%material_id%'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'co_study_messages'
      AND policyname = 'Users can insert own co-study messages' AND cmd = 'INSERT'
      AND roles = ARRAY['authenticated']::name[]
      AND with_check ILIKE '%auth.uid%' AND with_check ILIKE '%sender_id%'
      AND with_check ILIKE '%materials%' AND with_check ILIKE '%material_id%'
  ) THEN
    RAISE EXCEPTION 'co-study messages must require authentication and access to the associated material';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'material_likes'
      AND policyname = 'Public read material_likes' AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND qual ILIKE '%auth.uid%' AND qual ILIKE '%user_id%'
  ) THEN
    RAISE EXCEPTION 'material likes must not be publicly enumerable';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles'
      AND policyname = 'Public read profiles'
  ) OR EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'groups'
      AND policyname = 'Anyone can read group by invite code'
  ) OR has_table_privilege('anon', 'public.profiles', 'SELECT') THEN
    RAISE EXCEPTION 'profiles and invite-code-protected groups must not be broadly readable';
  END IF;

  IF to_regprocedure('public.get_public_profiles(uuid[],text,uuid,integer)') IS NULL
    OR NOT has_function_privilege('authenticated', 'public.get_public_profiles(uuid[],text,uuid,integer)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.get_public_profiles(uuid[],text,uuid,integer)', 'EXECUTE')
    OR to_regprocedure('public.get_student_groups()') IS NULL
    OR NOT has_function_privilege('authenticated', 'public.get_student_groups()', 'EXECUTE')
    OR to_regprocedure('public.get_group_members(uuid)') IS NULL
    OR NOT has_function_privilege('authenticated', 'public.get_group_members(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.get_group_members(uuid)', 'EXECUTE')
    OR to_regprocedure('public.get_group_weekly_scores(uuid)') IS NULL
    OR NOT has_function_privilege('authenticated', 'public.get_group_weekly_scores(uuid)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.get_group_weekly_scores(uuid)', 'EXECUTE')
    OR to_regprocedure('public.join_group_by_invite_code(text,text)') IS NULL
    OR NOT has_function_privilege('authenticated', 'public.join_group_by_invite_code(text,text)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.join_group_by_invite_code(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'profile and group RPC access must be authenticated and narrowly granted';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc
          WHERE oid = to_regprocedure('public.get_public_profiles(uuid[],text,uuid,integer)'))
    OR NOT (SELECT prosecdef FROM pg_catalog.pg_proc
            WHERE oid = to_regprocedure('public.get_student_groups()'))
    OR NOT (SELECT prosecdef FROM pg_catalog.pg_proc
            WHERE oid = to_regprocedure('public.get_group_members(uuid)'))
    OR NOT (SELECT prosecdef FROM pg_catalog.pg_proc
            WHERE oid = to_regprocedure('public.get_group_weekly_scores(uuid)'))
    OR NOT (SELECT prosecdef FROM pg_catalog.pg_proc
            WHERE oid = to_regprocedure('public.join_group_by_invite_code(text,text)')) THEN
    RAISE EXCEPTION 'profile and group RPCs must run with their restricted trusted database role';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('public.get_group_members(uuid)')
      AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%teacher_id%auth.uid%'
      AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%group_members%student_id%auth.uid%'
  ) THEN
    RAISE EXCEPTION 'group roster RPC must check teacher or current group membership';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_proc p
    WHERE p.oid = to_regprocedure('public.get_group_weekly_scores(uuid)')
      AND p.proconfig @> ARRAY['search_path=""']::text[]
      AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%teacher_id%auth.uid%'
      AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%group_members%student_id%auth.uid%'
      AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%study_sessions%'
      AND pg_catalog.pg_get_functiondef(p.oid) ILIKE '%exam_sessions%'
  ) THEN
    RAISE EXCEPTION 'weekly class scores must be hardened and restricted to the authorized group roster';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'user_xp'
      AND policyname = 'public_read_user_xp' AND cmd = 'SELECT'
      AND roles = ARRAY['authenticated']::name[]
      AND qual ILIKE '%auth.uid%'
  ) THEN
    RAISE EXCEPTION 'the leaderboard must require an authenticated session';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_policies
    WHERE schemaname = 'public' AND tablename = 'notifications' AND cmd = 'INSERT'
  ) OR has_table_privilege('anon', 'public.notifications', 'INSERT')
    OR has_table_privilege('authenticated', 'public.notifications', 'INSERT')
    OR has_table_privilege('anon', 'public.notifications', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.notifications', 'UPDATE')
    OR NOT has_column_privilege('authenticated', 'public.notifications', 'is_read', 'UPDATE') THEN
    RAISE EXCEPTION 'notifications must be event-created and users may update only their read state';
  END IF;

  IF (SELECT count(*) FROM pg_catalog.pg_trigger t
      JOIN pg_catalog.pg_class c ON c.oid = t.tgrelid
      JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
      WHERE NOT t.tgisinternal AND n.nspname = 'public'
        AND t.tgname IN ('friendship_notification_after_insert',
          'direct_message_notification_after_insert', 'assignment_notification_after_insert')) <> 3 THEN
    RAISE EXCEPTION 'authorized application events must create notifications through database triggers';
  END IF;

  IF has_table_privilege('anon', 'public.group_members', 'INSERT')
    OR has_table_privilege('authenticated', 'public.group_members', 'INSERT')
    OR has_table_privilege('anon', 'public.group_members', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.group_members', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.group_members', 'group_id', 'UPDATE')
    OR NOT has_column_privilege('authenticated', 'public.group_members', 'class_nickname', 'UPDATE')
    OR has_function_privilege('anon', 'public.join_group_by_invite_code(text,text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'group membership changes must use invite validation and protect row identity';
  END IF;

  IF has_table_privilege('anon', 'public.material_likes', 'INSERT')
    OR has_table_privilege('authenticated', 'public.material_likes', 'INSERT')
    OR has_table_privilege('anon', 'public.material_likes', 'DELETE')
    OR has_table_privilege('authenticated', 'public.material_likes', 'DELETE')
    OR has_function_privilege('anon', 'public.toggle_material_like(uuid,boolean)', 'EXECUTE')
    OR NOT has_function_privilege('authenticated', 'public.toggle_material_like(uuid,boolean)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.increment_likes(uuid)', 'EXECUTE')
    OR has_function_privilege('authenticated', 'public.decrement_likes(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'likes and their counters must change atomically under the authenticated user';
  END IF;

  IF NOT (SELECT prosecdef FROM pg_catalog.pg_proc
          WHERE oid = to_regprocedure('public.toggle_material_like(uuid,boolean)'))
    OR has_function_privilege('authenticated', 'private.notify_friend_request()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.notify_direct_message()', 'EXECUTE')
    OR has_function_privilege('authenticated', 'private.notify_group_assignment()', 'EXECUTE') THEN
    RAISE EXCEPTION 'trusted write functions must be security-definer and not directly callable';
  END IF;

  IF has_table_privilege('anon', 'public.profiles', 'INSERT')
    OR has_table_privilege('authenticated', 'public.profiles', 'INSERT') THEN
    RAISE EXCEPTION 'profiles must not be insertable through the client API';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = 'profiles'
      AND (
        has_column_privilege('anon', 'public.profiles', c.column_name, 'INSERT')
        OR has_column_privilege('authenticated', 'public.profiles', c.column_name, 'INSERT')
      )
  ) THEN
    RAISE EXCEPTION 'profiles must not retain column-level client INSERT privileges';
  END IF;

  IF has_table_privilege('anon', 'public.profiles', 'UPDATE')
    OR has_table_privilege('authenticated', 'public.profiles', 'UPDATE') THEN
    RAISE EXCEPTION 'profiles must use column-scoped updates, not table-wide UPDATE';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns AS c
    WHERE c.table_schema = 'public' AND c.table_name = 'profiles'
      AND (
        has_column_privilege('anon', 'public.profiles', c.column_name, 'UPDATE')
        OR (
          c.column_name <> ALL(ARRAY[
            'full_name', 'avatar_url', 'bio', 'university', 'role',
            'onboarding_status', 'public_id', 'updated_at'
          ])
          AND has_column_privilege('authenticated', 'public.profiles', c.column_name, 'UPDATE')
        )
      )
  ) THEN
    RAISE EXCEPTION 'profile updates must be restricted to supported editable fields';
  END IF;

  IF has_column_privilege('anon', 'public.profiles', 'is_pro', 'UPDATE')
    OR has_column_privilege('authenticated', 'public.profiles', 'is_pro', 'UPDATE')
    OR has_column_privilege('anon', 'public.profiles', 'is_pro', 'INSERT')
    OR has_column_privilege('authenticated', 'public.profiles', 'is_pro', 'INSERT') THEN
    RAISE EXCEPTION 'clients must not grant or modify PRO status';
  END IF;

  IF NOT has_column_privilege('authenticated', 'public.profiles', 'full_name', 'UPDATE')
    OR NOT has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')
    OR NOT has_column_privilege('authenticated', 'public.profiles', 'onboarding_status', 'UPDATE') THEN
    RAISE EXCEPTION 'authenticated users must retain access to supported profile settings';
  END IF;
END;
$$;
