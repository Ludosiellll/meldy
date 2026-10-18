-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Fixtures of the backfill of 20261019090000_container_kind.sql, written
-- (committed) on the base BEFORE the migration by supabase/tests/local/container_kind_run.sh, which then reads which of
-- them the migration made 'test' and deletes them (container_kind_backfill_clean.sql). One account, eleven exams named
-- «KB …»: two made the «Новый тест» way since release 47 (→ test), nine that differ in one thing each (→ exam).
\set ON_ERROR_STOP 1
begin;
insert into auth.users (id) values ('c4d00000-0000-4000-8000-0000000000bf') on conflict do nothing;
insert into public.exams (id, user_id, title) values
  ('c4d00000-0000-4000-8000-0000000000be', 'c4d00000-0000-4000-8000-0000000000bf', 'KB устный') on conflict do nothing;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'c4d00000-0000-4000-8000-0000000000bf', true) is null;
do $t$
declare
  r jsonb;
  q constant jsonb := '{"stem": "Вопрос", "options": ["Да", "Нет"], "correct": [0]}';
begin
  -- → test: one subject «Вопросы», no date, questions by hand (the builder's «man:», a copy's «copy:»)
  r := public.container_create('KB test with questions', null, '[{"title": "Вопросы"}]');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid,
    pg_catalog.jsonb_build_array(q || '{"ref": "man:a1"}', q || '{"ref": "copy:a2"}', q || '{"ref": "studio:a3"}'));
  -- → test: the same, still empty
  r := public.container_create('KB empty test', null, '[{"title": "Вопросы"}]');
  -- → exam: made the day before release 47 (created_at set below)
  r := public.container_create('KB before release', null, '[{"title": "Вопросы"}]');
  -- → exam: a question imported from a file
  r := public.container_create('KB imported', null, '[{"title": "Вопросы"}]');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid,
    pg_catalog.jsonb_build_array(q || '{"ref": "man:b1"}', q || '{"ref": "imp-kb:1"}'));
  -- → exam: another subject's name
  r := public.container_create('KB other subject', null, '[{"title": "Химия"}]');
  -- → exam: two subjects
  r := public.container_create('KB two subjects', null, '[{"title": "Вопросы"}, {"title": "Ещё"}]');
  -- → exam: a date of its own
  r := public.container_create('KB dated', current_date + 20, '[{"title": "Вопросы"}]');
  -- → exam: the subject's date
  r := public.container_create('KB subject dated', null, pg_catalog.jsonb_build_array(
         pg_catalog.jsonb_build_object('title', 'Вопросы', 'exam_date', current_date + 20)));
  -- → exam: topics
  r := public.container_create('KB topics', null, '[{"title": "Вопросы", "topics": ["Кислоты"]}]');
  -- → exam: an oral part
  r := public.container_create('KB oral', null, '[{"title": "Вопросы", "exam_id": "c4d00000-0000-4000-8000-0000000000be"}]');
  -- → exam: a question without a ref (set below)
  r := public.container_create('KB no ref', null, '[{"title": "Вопросы"}]');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid, pg_catalog.jsonb_build_array(q || '{"ref": "man:c1"}'));
end
$t$;
reset role;
-- The days: release 47 is 2026-10-18; «before release» an hour before it (UTC), the rest after it.
update public.containers set created_at = timestamptz '2026-10-18 10:00:00+00'
 where owner_id = 'c4d00000-0000-4000-8000-0000000000bf';
update public.containers set created_at = timestamptz '2026-10-17 23:00:00+00'
 where owner_id = 'c4d00000-0000-4000-8000-0000000000bf' and title = 'KB before release';
update public.containers set created_at = timestamptz '2026-10-19 08:00:00+00'
 where owner_id = 'c4d00000-0000-4000-8000-0000000000bf' and title = 'KB empty test';
update public.test_items i set import_ref = null
  from public.containers c where c.id = i.container_id and c.title = 'KB no ref'
   and c.owner_id = 'c4d00000-0000-4000-8000-0000000000bf';
select 'BACKFILL FIXTURES ' || pg_catalog.count(*) from public.containers where owner_id = 'c4d00000-0000-4000-8000-0000000000bf';
commit;
