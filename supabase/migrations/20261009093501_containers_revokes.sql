-- containers_revokes (second file of 20261009093500_containers.sql). The Supabase connector may hold REVOKE for a human —
-- then the owner runs this file in the SQL Editor. Safety does not depend on it: every function checks its caller, RLS
-- has no anon policy, and meldy_private has no USAGE for clients. It only takes back what Supabase's default privileges
-- give to NEW objects of the schema public (anon reads and runs nothing but the invitation preview; clients never write
-- the log, the states or the items; the link salt is never readable). Re-runnable; names only objects of
-- 20261009093500_containers.sql. After it, supabase/tests/containers.sql reports contract_ok: true.
revoke all on table public.containers, public.container_subjects, public.test_items, public.test_item_key_changes,
  public.test_item_states, public.test_answers, public.test_key_doubts, public.test_mock_runs, public.container_plans,
  public.container_links, public.container_members, public.container_member_exams from anon;
revoke truncate, references, trigger on table public.containers, public.container_subjects, public.test_items,
  public.test_item_key_changes, public.test_item_states, public.test_answers, public.test_key_doubts,
  public.test_mock_runs, public.container_plans, public.container_links, public.container_members,
  public.container_member_exams from authenticated;
revoke insert, update on table public.test_items from authenticated;
revoke insert, update, delete on table public.test_item_key_changes, public.test_item_states, public.test_answers,
  public.test_key_doubts, public.test_mock_runs, public.container_members, public.container_member_exams from authenticated;
revoke insert, update, delete on table public.container_links from authenticated;
revoke select on table public.container_links from authenticated;
grant select (id, container_id, owner_id, consent, max_members, members, created_at, expires_at, revoked_at)
  on table public.container_links to authenticated;
revoke delete on table public.container_plans from authenticated;
revoke all on function public.record_test_answers(jsonb), public.container_mock_finish(jsonb),
  public.container_create(text, date, jsonb), public.container_subject_add(uuid, jsonb),
  public.container_items_add(uuid, jsonb), public.container_item_update(uuid, jsonb),
  public.test_key_doubt(uuid, jsonb, text), public.test_key_doubt_withdraw(uuid), public.container_doubts(uuid),
  public.container_doubt_keep(uuid), public.containers_overview(text), public.container_summary(uuid, text),
  public.plan_inputs(text, uuid), public.test_answer_days(date), public.container_link_create(uuid, integer, text),
  public.container_link_revoke(uuid), public.container_join(text), public.container_oral_codes(uuid),
  public.container_bind_copy(uuid, uuid), public.container_leave(uuid), public.container_members_list(uuid),
  public.container_member_remove(uuid, uuid, boolean), public.my_container_ids() from public, anon;
revoke all on function public.container_link_preview(text) from public;
grant execute on function public.container_link_preview(text) to anon, authenticated;
revoke all on function public.containers_touch(), public.containers_guard_delete(), public.container_subjects_guard(),
  public.test_items_guard() from public, anon, authenticated;
-- The validators stay callable (pure functions used by CHECK constraints; a client's own write of a subject runs
-- meldy_topics_ok): meldy_options_ok, meldy_key_ok, meldy_short_norm, meldy_answers_ok, meldy_topics_ok, meldy_flags_ok.
