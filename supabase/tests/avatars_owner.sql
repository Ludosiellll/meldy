-- Run once after migration 20261107090800_avatars_owner.sql: the read-only check of that apply. A DO block that raises
-- nothing when every check holds (supabase/migrate.py); it raises the name of the first one that does not. Catalog only.
-- Checks: the bucket has its 2 MB limit and the four picture types; the four dashboard policies are gone; each of the four
-- new policies is there, for authenticated only, and ties the object's name to the caller's id; no other policy of
-- storage.objects names the bucket.
DO $check$
DECLARE
  v_bucket record;
  v_policy record;
  v_names text[] := array['Avatars: own read', 'Avatars: own upload', 'Avatars: own update', 'Avatars: own delete'];
  v_name text;
BEGIN
  SELECT b.file_size_limit, b.allowed_mime_types, b.public INTO v_bucket FROM storage.buckets b WHERE b.id = 'avatars';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'avatars_bucket_missing';
  END IF;
  IF v_bucket.file_size_limit IS DISTINCT FROM 2097152 THEN
    RAISE EXCEPTION 'avatars_size_limit';
  END IF;
  IF v_bucket.allowed_mime_types IS NULL
     OR NOT (v_bucket.allowed_mime_types @> array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
     OR pg_catalog.cardinality(v_bucket.allowed_mime_types) <> 4 THEN
    RAISE EXCEPTION 'avatars_mime_types';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
             AND p.policyname LIKE 'Avatars Access %') THEN
    RAISE EXCEPTION 'avatars_old_policies_left';
  END IF;
  FOREACH v_name IN ARRAY v_names LOOP
    SELECT * INTO v_policy FROM pg_catalog.pg_policies p
     WHERE p.schemaname = 'storage' AND p.tablename = 'objects' AND p.policyname = v_name;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'avatars_policy_missing: %', v_name;
    END IF;
    IF v_policy.roles::text <> '{authenticated}' THEN
      RAISE EXCEPTION 'avatars_policy_roles: %', v_name;
    END IF;
    IF coalesce(v_policy.qual, '') || coalesce(v_policy.with_check, '') NOT LIKE '%auth.uid()%' THEN
      RAISE EXCEPTION 'avatars_policy_not_owner: %', v_name;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_policies p WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
             AND (coalesce(p.qual, '') || coalesce(p.with_check, '')) LIKE '%''avatars''%'
             AND NOT (p.policyname = ANY (v_names))) THEN
    RAISE EXCEPTION 'avatars_other_policy';
  END IF;
END
$check$;
