-- Run once after migration 20261107090100_group_link_restore.sql: the read-only check of that apply (a DO block that
-- raises the name of the first failed check, supabase/migrate.py). Both links of the owner's exam are open until
-- 2027-02-11.
DO $check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.container_links l
                  WHERE l.id = '37640753-1169-4c01-af85-0c148d029ae4' AND l.revoked_at IS NULL
                    AND l.expires_at > '2027-02-01 00:00:00+00') THEN
    RAISE EXCEPTION 'first_link_open';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.container_links l
                  WHERE l.id = '721adbc2-d350-4be3-8bdb-4acf4717e281' AND l.revoked_at IS NULL
                    AND l.expires_at > '2027-02-01 00:00:00+00') THEN
    RAISE EXCEPTION 'second_link_open_as_long';
  END IF;
END
$check$;
