-- Run once after migration *_test_item_images.sql: the read-only check of that apply. A DO block that raises nothing
-- when every check holds (supabase/migrate.py); it raises the name of the first one that does not. Nothing is written:
-- it reads the catalog and calls the pure validator.
-- Checks: test_items.images (jsonb, not null, default '{}') with test_items_images_check; meldy_images_ok accepts the
-- importer's shape inside the container and refuses another container's folder, a foreign key, a bad path, too many;
-- container_items_add knows «images»; the bucket test-item-images is private with 3 MB and five picture types; the three
-- storage policies exist; anon cannot run the validator.
-- The behaviour (an owner's insert with pictures, a stranger's path refused, the storage policies for owner, member and
-- stranger) is rehearsed locally: supabase/tests/local/test_item_images_run.sh.
DO $check$
DECLARE
  v_c uuid := '11111111-2222-4333-8444-555555555555';
  v_path text := v_c::text || '/' || repeat('ab', 32) || '.png';
  v_other text := '99999999-2222-4333-8444-555555555555/' || repeat('ab', 32) || '.png';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'test_items' AND column_name = 'images'
                    AND data_type = 'jsonb' AND is_nullable = 'NO' AND column_default LIKE '''{}''::jsonb%') THEN
    RAISE EXCEPTION 'column_images';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
                  WHERE conrelid = 'public.test_items'::regclass AND conname = 'test_items_images_check') THEN
    RAISE EXCEPTION 'constraint_images';
  END IF;
  IF NOT public.meldy_images_ok('{}'::jsonb, v_c)
     OR NOT public.meldy_images_ok(jsonb_build_object('stem', jsonb_build_array(v_path), 'options',
                                                      jsonb_build_array('[]'::jsonb, jsonb_build_array(v_path))), v_c) THEN
    RAISE EXCEPTION 'validator_accepts_the_importer_shape';
  END IF;
  IF public.meldy_images_ok(jsonb_build_object('stem', jsonb_build_array(v_other)), v_c)
     OR public.meldy_images_ok(jsonb_build_object('pictures', '[]'::jsonb), v_c)
     OR public.meldy_images_ok(jsonb_build_object('stem', jsonb_build_array('../' || v_path)), v_c)
     OR public.meldy_images_ok(jsonb_build_object('stem', jsonb_build_array(v_c::text || '/x.svg')), v_c)
     OR public.meldy_images_ok(jsonb_build_object('options', jsonb_build_array(jsonb_build_array(v_path, v_path, v_path, v_path, v_path))), v_c)
     OR public.meldy_images_ok('[]'::jsonb, v_c) THEN
    RAISE EXCEPTION 'validator_refuses_what_is_not_the_shape';
  END IF;
  IF strpos(pg_get_functiondef('public.container_items_add(uuid, jsonb)'::regprocedure), '''images''') = 0 THEN
    RAISE EXCEPTION 'items_add_knows_images';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM storage.buckets
                  WHERE id = 'test-item-images' AND public = false AND file_size_limit = 3145728
                    AND allowed_mime_types @> ARRAY['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp']
                    AND cardinality(allowed_mime_types) = 5) THEN
    RAISE EXCEPTION 'bucket_private_3mb_pictures';
  END IF;
  IF (SELECT count(*) FROM pg_catalog.pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
        AND policyname IN ('Test item images: owner uploads', 'Test item images: read own or joined',
                           'Test item images: owner deletes')) <> 3 THEN
    RAISE EXCEPTION 'storage_policies';
  END IF;
  IF has_function_privilege('anon', 'public.meldy_images_ok(jsonb, uuid)', 'execute') THEN
    RAISE EXCEPTION 'anon_cannot_run_the_validator';
  END IF;
END
$check$;
