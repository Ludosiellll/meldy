-- Rollback of supabase/migrations/20261107090800_avatars_owner.sql: the «avatars» bucket as it was before (the four
-- dashboard policies for any signed-in account, no size or type limit). Only for an emergency: it reopens SEC-4.
update storage.buckets set file_size_limit = null, allowed_mime_types = null where id = 'avatars';

drop policy if exists "Avatars: own read" on storage.objects;
drop policy if exists "Avatars: own upload" on storage.objects;
drop policy if exists "Avatars: own update" on storage.objects;
drop policy if exists "Avatars: own delete" on storage.objects;
drop policy if exists "Avatars Access 1oj01fe_0" on storage.objects;
drop policy if exists "Avatars Access 1oj01fe_1" on storage.objects;
drop policy if exists "Avatars Access 1oj01fe_2" on storage.objects;
drop policy if exists "Avatars Access 1oj01fe_3" on storage.objects;

create policy "Avatars Access 1oj01fe_0" on storage.objects for select to authenticated using (bucket_id = 'avatars');
create policy "Avatars Access 1oj01fe_1" on storage.objects for insert to authenticated with check (bucket_id = 'avatars');
create policy "Avatars Access 1oj01fe_2" on storage.objects for update to authenticated using (bucket_id = 'avatars');
create policy "Avatars Access 1oj01fe_3" on storage.objects for delete to authenticated using (bucket_id = 'avatars');
