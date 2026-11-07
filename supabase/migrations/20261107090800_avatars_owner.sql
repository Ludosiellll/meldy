-- avatars_owner: the «avatars» bucket — each account reads, writes and deletes only its own pictures (security audit
-- 07.11, SEC-4). Repo file: supabase/migrations/20261107090800_avatars_owner.sql. Base: the live order up to
-- 20261107090700_item_points.sql.
-- Check after the apply: supabase/tests/avatars_owner.sql (read-only). Rollback:
-- supabase/rollback/20261107090800_avatars_owner_down.sql (the four live-only policies back as they were, the bucket
-- without limits).
--
-- Why: the bucket's four policies («Avatars Access 1oj01fe_0..3», made in the dashboard, never in the repo) gave every
-- signed-in account SELECT, INSERT, UPDATE and DELETE on any object of the bucket with only bucket_id = 'avatars': any
-- account could list the bucket, replace or delete anyone's avatar, and upload files of any size and type (free public
-- hosting under the project's domain; the Free plan's 1 GB of storage is shared with the questions' pictures).
--
-- Now: the site names an avatar «<user id>-<ms>.<ext>» (frontend/src/api/social.ts uploadAvatar) — a policy lets an
-- account touch only names that start with its own id and a hyphen. Reading stays public through the bucket's public
-- URLs (the bucket is public; the SELECT policy only governs listing and the API reads that upsert needs). The bucket
-- takes pictures up to 2 MB (the site scales a crop to 512 px, utils/cropImage.ts): jpeg, png, webp, gif.

update storage.buckets
   set file_size_limit = 2097152,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/gif']
 where id = 'avatars';

drop policy if exists "Avatars Access 1oj01fe_0" on storage.objects;
drop policy if exists "Avatars Access 1oj01fe_1" on storage.objects;
drop policy if exists "Avatars Access 1oj01fe_2" on storage.objects;
drop policy if exists "Avatars Access 1oj01fe_3" on storage.objects;
drop policy if exists "Avatars: own read" on storage.objects;
drop policy if exists "Avatars: own upload" on storage.objects;
drop policy if exists "Avatars: own update" on storage.objects;
drop policy if exists "Avatars: own delete" on storage.objects;

create policy "Avatars: own read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and name like (select auth.uid())::text || '-%');
create policy "Avatars: own upload" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and name like (select auth.uid())::text || '-%');
create policy "Avatars: own update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and name like (select auth.uid())::text || '-%')
  with check (bucket_id = 'avatars' and name like (select auth.uid())::text || '-%');
create policy "Avatars: own delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and name like (select auth.uid())::text || '-%');
