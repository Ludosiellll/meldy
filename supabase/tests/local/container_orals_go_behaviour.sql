-- LOCAL ONLY. The behaviour of 20261107090000_container_orals_go.sql (run by container_orals_go_run.sh after the apply):
-- a deleted container takes its owner's oral exams (their questions too) and keeps every other exam; a delete refused
-- for members (MC009) keeps them; a container without oral parts deletes as before. As postgres (row security aside:
-- the trigger is SECURITY DEFINER and scopes by the owner itself).
\set ON_ERROR_STOP 1
do $t$
declare
  a constant uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  b constant uuid := 'bbbbbbbb-0000-0000-0000-000000000002';
  e1 uuid; e2 uuid; e3 uuid; eb uuid; c1 uuid; c2 uuid; c3 uuid;
begin
  -- A's container with two oral subjects and a plain one; A's third exam is not in it; B's exam is B's.
  insert into public.exams (user_id, title) values (a, 'Устный 1') returning id into e1;
  insert into public.exams (user_id, title) values (a, 'Устный 2') returning id into e2;
  insert into public.exams (user_id, title) values (a, 'Сам по себе') returning id into e3;
  insert into public.exams (user_id, title) values (b, 'Чужой') returning id into eb;
  insert into public.exam_questions (exam_id, user_id, position, text) values
    (e1, a, 1, 'Вопрос первого устного'), (e2, a, 1, 'Вопрос второго устного'), (e3, a, 1, 'Вопрос отдельного'),
    (eb, b, 1, 'Вопрос чужого');
  insert into public.containers (owner_id, title) values (a, 'Сессия') returning id into c1;
  insert into public.container_subjects (container_id, owner_id, position, title, exam_id) values
    (c1, a, 1, 'Устный 1', e1), (c1, a, 2, 'Устный 2', e2), (c1, a, 3, 'Тест', null);

  -- A delete refused for a member keeps everything.
  insert into public.container_members (container_id, user_id) values (c1, b);
  begin
    delete from public.containers where id = c1;
    raise exception 'FAILED: a container with a member was deleted';
  exception when sqlstate 'MC009' then null;
  end;
  if (select count(*) from public.exams where id in (e1, e2)) <> 2 then
    raise exception 'FAILED: a refused delete took the oral exams'; end if;

  -- The member gone, the delete takes both oral exams and their questions, nothing else.
  delete from public.container_members where container_id = c1;
  delete from public.containers where id = c1;
  if exists (select 1 from public.exams where id in (e1, e2)) then raise exception 'FAILED: oral exams stayed'; end if;
  if exists (select 1 from public.exam_questions where exam_id in (e1, e2)) then raise exception 'FAILED: their questions stayed'; end if;
  if (select count(*) from public.exams where id in (e3, eb)) <> 2 then raise exception 'FAILED: other exams were touched'; end if;

  -- A container without oral parts deletes as before.
  insert into public.containers (owner_id, title) values (a, 'Только тест') returning id into c2;
  insert into public.container_subjects (container_id, owner_id, position, title) values (c2, a, 1, 'Тест');
  delete from public.containers where id = c2;
  if exists (select 1 from public.containers where id = c2) then raise exception 'FAILED: plain delete'; end if;
  if (select count(*) from public.exams where id in (e3, eb)) <> 2 then raise exception 'FAILED: a plain delete touched exams'; end if;

  -- B's container takes B's oral exam; B's other exam stays.
  insert into public.exams (user_id, title) values (b, 'Устный Б') returning id into e2;
  insert into public.containers (owner_id, title) values (b, 'Сессия Б') returning id into c3;
  insert into public.container_subjects (container_id, owner_id, position, title, exam_id) values (c3, b, 1, 'Устный Б', e2);
  delete from public.containers where id = c3;
  if exists (select 1 from public.exams where id = e2) then raise exception 'FAILED: B''s oral exam stayed'; end if;
  if not exists (select 1 from public.exams where id = eb) then raise exception 'FAILED: B''s own exam went'; end if;
  raise notice 'CONTAINER ORALS CHECKS PASSED';
end;
$t$;
