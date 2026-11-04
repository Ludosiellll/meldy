-- container_orals_go (deleting an exam takes its oral subjects with it)
-- Repo file: supabase/migrations/20261107090000_container_orals_go.sql. Base: 20261009093500_containers.sql
-- (public.containers, public.container_subjects.exam_id → public.exams).
-- Why (owner, 2026-11-04): an import made every file's form header («Задание на выполнение контрольной работы…») an oral
-- subject of its own, saved as an oral exam (public.exams) attached to the exam container. The owner deleted the
-- container; its oral exams stayed (the dialog said «Устные предметы останутся в «Экзаменах» отдельно») and turned up in
-- «Экзамены» as ten «Предмет N» of one question each: «они в целом не должны появляться». The oral part of a subject is
-- shown only inside its container, so it goes with the container now.
-- What this file adds:
--   1. The BEFORE DELETE trigger containers_take_orals on public.containers (meldy_private.take_container_orals, SECURITY
--      DEFINER, search_path ''): the oral exams of the container's subjects that belong to its owner are deleted in the
--      same transaction (their questions, lecture links and shares cascade; container_subjects.exam_id is set null). It
--      fires after containers_guard_delete (names in order), so a delete refused for members (MC009) deletes nothing.
--      Every delete counts: the owner's, a cascade from auth.users, a service-role one.
--   2. A one-off clean-up of the ten oral exams that delete left on 2026-11-04 (05:50 UTC): «Предмет N», made from a
--      file, one question that is the form header, attached to nothing, shared with nobody. A second apply finds none.
-- Release order: this file, then the site whose dialog says the oral subjects go too.
-- Check after the apply: supabase/tests/container_orals_go.sql (catalog only; read-only). Local rehearsal (never live):
-- supabase/tests/local/container_orals_go_run.sh. Rollback: supabase/rollback/20261107090000_container_orals_go_down.sql
-- (the trigger and its function; the deleted rows do not come back).
-- Re-runnable: OR REPLACE; the clean-up deletes only what matches.

set local lock_timeout = '2s';

do $do$
begin
  if pg_catalog.to_regclass('public.containers') is null or pg_catalog.to_regclass('public.container_subjects') is null
     or pg_catalog.to_regclass('public.exams') is null then
    raise exception 'the base is expected: 20261009093500_containers.sql';
  end if;
end;
$do$;

-- 1. The trigger.
create or replace function meldy_private.take_container_orals()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  delete from public.exams e
   using public.container_subjects s
   where s.container_id = old.id
     and s.exam_id = e.id
     and e.user_id = old.owner_id;
  return old;
end;
$fn$;
comment on function meldy_private.take_container_orals() is
  'BEFORE DELETE on public.containers: the oral exams of its subjects (the owner''s) go with it.';
revoke all on function meldy_private.take_container_orals() from public;
do $do$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    revoke all on function meldy_private.take_container_orals() from anon, authenticated;
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    revoke all on function meldy_private.take_container_orals() from service_role;
  end if;
end;
$do$;

create or replace trigger containers_take_orals
  before delete on public.containers
  for each row execute function meldy_private.take_container_orals();

-- 2. The one-off clean-up of 2026-11-04.
delete from public.exams e
 where e.title ~ '^Предмет [0-9]+$'
   and e.source_kind = 'file'
   and e.created_at >= '2026-11-04 05:50:00+00' and e.created_at < '2026-11-04 05:51:00+00'
   and (select count(*) from public.exam_questions q where q.exam_id = e.id) = 1
   and exists (select 1 from public.exam_questions q where q.exam_id = e.id and q.text like 'Задание на выполнение контрольной%')
   and not exists (select 1 from public.container_subjects s where s.exam_id = e.id)
   and not exists (select 1 from public.container_member_exams m where m.exam_id = e.id)
   and not exists (select 1 from public.exam_shares x where x.exam_id = e.id);
