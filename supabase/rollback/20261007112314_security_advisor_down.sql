-- Rollback of 20261007112314_security_advisor.sql: the grants and settings as they were before it (read from
-- pg_proc.proacl on 2026-10-07). NOT applied by any package or agent. To bring back only one legacy section
-- (teacher groups, public profiles, likes), run just its grant lines.
alter function public.handle_new_user() reset search_path;
grant execute on function public.handle_new_user() to public, anon, authenticated;
grant execute on function public.rls_auto_enable() to public, anon, authenticated;

alter function public.increment_likes(uuid) reset search_path;
alter function public.decrement_likes(uuid) reset search_path;

grant execute on function public.get_public_profiles(uuid[], text, uuid, integer) to authenticated;
grant execute on function public.get_group_members(uuid) to authenticated;
grant execute on function public.get_group_weekly_scores(uuid) to authenticated;
grant execute on function public.get_student_groups() to authenticated;
grant execute on function public.join_group_by_invite_code(text, text) to authenticated;
grant execute on function public.toggle_material_like(uuid, boolean) to authenticated;
