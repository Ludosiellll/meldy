-- containers rollback (20261009093500_containers.sql and 20261009093501_containers_revokes.sql). The owner runs it by
-- hand in the SQL Editor, never an agent: it deletes the exam containers' data (items, answers, progress, links). The
-- oral path needs nothing back: nothing of it was changed. The derived oral shares the container links made are
-- ordinary exam_shares rows; they are closed (revoked_at), not deleted, so members' oral copies stay as they are.
-- Re-runnable. Locally (containers_run_all.sh) the catalog fingerprint after it equals the one before the migration.
begin;
do $do$
begin
  if pg_catalog.to_regclass('public.container_links') is not null then
    update public.exam_shares sh set revoked_at = coalesce(sh.revoked_at, pg_catalog.now())
     where sh.id in (select pg_catalog.unnest(l.oral_share_ids) from public.container_links l);
  end if;
end
$do$;
drop function if exists public.record_test_answers(jsonb), public.container_mock_finish(jsonb),
  public.container_create(text, date, jsonb), public.container_subject_add(uuid, jsonb),
  public.container_items_add(uuid, jsonb), public.container_item_update(uuid, jsonb),
  public.test_key_doubt(uuid, jsonb, text), public.test_key_doubt_withdraw(uuid), public.container_doubts(uuid),
  public.container_doubt_keep(uuid), public.containers_overview(text), public.container_summary(uuid, text),
  public.plan_inputs(text, uuid), public.test_answer_days(date), public.container_link_create(uuid, integer, text),
  public.container_link_revoke(uuid), public.container_link_preview(text), public.container_join(text),
  public.container_oral_codes(uuid), public.container_bind_copy(uuid, uuid), public.container_leave(uuid),
  public.container_members_list(uuid), public.container_member_remove(uuid, uuid, boolean);
-- The private schema first: meldy_private.rule_step and state_json take the row type of public.test_item_states.
drop schema if exists meldy_private cascade;
drop table if exists public.container_member_exams, public.container_members, public.container_links,
  public.container_plans, public.test_mock_runs, public.test_key_doubts, public.test_answers, public.test_item_states,
  public.test_item_key_changes, public.test_items, public.container_subjects, public.containers;
drop table if exists analytics.excluded_accounts;
drop function if exists public.my_container_ids(), public.containers_touch(), public.containers_guard_delete(),
  public.container_subjects_guard(), public.test_items_guard(), public.meldy_options_ok(jsonb),
  public.meldy_key_ok(smallint[], integer, text), public.meldy_answers_ok(text[], text), public.meldy_short_norm(text),
  public.meldy_topics_ok(jsonb), public.meldy_flags_ok(text[]);
commit;
