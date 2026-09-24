-- Run against the target Supabase database after migrations.
-- Checks only policy metadata; it does not inspect notification rows.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND policyname = 'notifications_delete_own'
      AND cmd = 'DELETE'
      AND array_to_string(roles, ',') = 'authenticated'
      AND qual ILIKE '%auth.uid%'
      AND qual ILIKE '%user_id%'
      AND qual <> 'true'
  ) THEN
    RAISE EXCEPTION 'notifications_delete_own must allow authenticated users to delete only their own rows';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_catalog.pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'notifications'
      AND cmd = 'DELETE'
      AND (roles @> ARRAY['public']::name[] OR roles @> ARRAY['anon']::name[])
      AND qual = 'true'
  ) THEN
    RAISE EXCEPTION 'notifications must not have an unrestricted public DELETE policy';
  END IF;
END;
$$;
