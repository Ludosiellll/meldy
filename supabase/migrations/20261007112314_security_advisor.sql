-- Supabase security advisor, 2026-10-07: functions that are not meant to be API endpoints.
-- Applied through apply_migration by the agent as version 20261007112314 (the owner allows migrations on this
-- project). Checked after applying, on the live database: authenticated has no EXECUTE on handle_new_user(), and an
-- insert by authenticated into a probe table with the same trigger still ran it (the probe was rolled back).
--
-- 1. handle_new_user() is the trigger on auth.users that creates the profile row; rls_auto_enable() is the
--    event trigger ensure_rls. Neither is meant to be called through /rest/v1/rpc, but both were executable
--    by PUBLIC, anon and authenticated. PostgreSQL checks EXECUTE on a trigger function only when the trigger
--    is created, not when it fires (checked on Postgres 16 before applying: a role without EXECUTE inserted
--    into the table and the profile row appeared; a new table still got row level security), so sign-up and
--    the event trigger keep working.
-- 2. handle_new_user() had no search_path; its body names only public.profiles and built-ins, so an empty
--    search_path is safe. increment_likes/decrement_likes (legacy, no app role may run them) name
--    "materials" unqualified, so they get search_path = public.
-- 3. Legacy RPCs of the removed teacher groups, public profiles and likes: nothing in frontend/src or
--    backend calls them since the hidden sections left the build (2026-10-05). get_public_profiles let any
--    signed-in user search every profile by name (name, avatar, university). EXECUTE is taken from
--    signed-in users; the functions and their data stay. To bring a section back, grant EXECUTE again
--    (supabase/rollback/20261007112314_security_advisor_down.sql).
-- Re-runnable.

alter function public.handle_new_user() set search_path = '';
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.rls_auto_enable() from public, anon, authenticated;

alter function public.increment_likes(uuid) set search_path = public;
alter function public.decrement_likes(uuid) set search_path = public;

revoke execute on function public.get_public_profiles(uuid[], text, uuid, integer) from public, anon, authenticated;
revoke execute on function public.get_group_members(uuid) from public, anon, authenticated;
revoke execute on function public.get_group_weekly_scores(uuid) from public, anon, authenticated;
revoke execute on function public.get_student_groups() from public, anon, authenticated;
revoke execute on function public.join_group_by_invite_code(text, text) from public, anon, authenticated;
revoke execute on function public.toggle_material_like(uuid, boolean) from public, anon, authenticated;
