-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour test of *_exam_shares.sql on the local baseline:
-- supabase/tests/local/baseline.sql, 20261003083154_hackathon_journal_exams_oral.sql, 20261005143420_cheat_sheet.sql,
-- supabase/tests/local/exam_shares_baseline.sql, then 20261007110403_exam_shares.sql (twice), then this file.
-- A is the author (lecture 11111111-…, from the baseline), B and C are classmates. Runs as role authenticated with
-- request.jwt.claim.sub switching between users, and as anon; one transaction that rolls back. A failure raises an
-- exception; success prints EXAM SHARES CHECKS PASSED and ANON CHECKS PASSED. The copy here is a small hand-made
-- one: the backend's planner (backend/exam_shares.py) is covered by pytest and by the rehearsal in the report.
-- Checks:
--   * without auth.uid(): bundle, claim, bind, join and revoke refuse with 28000;
--   * a stranger: a wrong code is MS001, the author's links and their members are invisible, a link of someone
--     else's exam cannot be created, a link cannot be revoked, edited or deleted by anyone but through the function,
--     a seat cannot be written by hand;
--   * the bundle: white-listed keys only — no journal, no answer key of another exam built from other lectures —
--     and the author's own link is MS005;
--   * joining: the copy is the classmate's own rows (lectures «только текст» in the author's order, the sheet's
--     created_at kept), the seat is bound to it, the counter says 1; joining again returns the same copy and the
--     bundle then gives only its id; a bad copy is MS006 and leaves nothing (not even the seat);
--   * with the classmate's token the author's lectures, exam, questions, answer keys and journal read nothing;
--   * a revoked link: MS002 for a newcomer, the classmate who joined still gets their copy; an expired link MS003;
--     the last seat taken: MS004; the preview says revoked / expired / full / own / joined;
--   * the classmate cannot make a link of their copy; the author revokes, and a revoke twice keeps the first time;
--   * oral_rubric_failures: own rows only, the unique key holds.
begin;

create or replace function pg_temp.expect_error(p_sql text, p_state text, p_what text)
returns void language plpgsql as $fn$
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_state;
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if sqlstate is distinct from p_state then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, sqlstate, sqlerrm, p_state;
    end if;
end;
$fn$;
grant execute on function pg_temp.expect_error(text, text, text) to authenticated, anon;

-- A small hand-made copy (what backend/exam_shares.py sends), for the classmate given by p_user's materials.
create or replace function pg_temp.copy_payload(p_exam uuid, p_material uuid, p_rubric_material uuid)
returns jsonb language sql as $fn$
  select pg_catalog.jsonb_build_object(
    'v', 1,
    'exam', pg_catalog.jsonb_build_object('id', p_exam, 'title', 'Макроэкономика', 'kind', 'exam', 'exam_date', '2026-11-10',
                                          'source_kind', 'paste', 'source_text', '1. Денежно-кредитная политика ЦБ',
                                          'ticket_layout', '{"mode": "random", "per_ticket": 2}'::jsonb,
                                          'mapping_state', 'done', 'mapped_at', '2026-10-06T10:00:00+00:00',
                                          'mapped_material_ids', pg_catalog.jsonb_build_array(p_material)),
    'materials', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                   'id', p_material, 'title', 'Денежный рынок', 'subject', 'Макроэкономика', 'original_text', 'Текст лекции')),
    'links', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object('material_id', p_material)),
    'questions', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                   'id', gen_random_uuid(), 'position', 1, 'label', '1', 'section', null,
                   'text', 'Денежно-кредитная политика ЦБ', 'coverage', 'full', 'coverage_method', 'llm',
                   'coverage_reason', 'Ответ есть во фрагментах лекций', 'missing_note', '',
                   'evidence', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                     'material_id', p_material, 'material_title', 'Денежный рынок', 'source_id', 'S01', 'excerpt', 'Текст лекции')),
                   'nearest', '[]'::jsonb, 'materials_fingerprint', 'fp-copy', 'mapping_version', 1,
                   'mapped_at', '2026-10-06T10:00:00+00:00')),
    'rubrics', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                 'id', gen_random_uuid(), 'question_hash', public.meldy_question_hash('Денежно-кредитная политика ЦБ'),
                 'source_key', 'copy-key-' || pg_catalog.replace(p_exam::text, '-', ''), 'material_id', p_rubric_material,
                 'material_ids', pg_catalog.jsonb_build_array(p_rubric_material),
                 'question', 'Денежно-кредитная политика ЦБ',
                 'rubric', pg_catalog.jsonb_build_object('v', 1, 'coverage', 'full', 'points', '[]'::jsonb,
                             'materials', pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_object(
                               'key', 'M1', 'material_id', p_rubric_material, 'title', 'Денежный рынок'))),
                 'rubric_version', 1, 'created_at', '2026-10-06T11:00:00.123456+00:00',
                 'sheet', pg_catalog.jsonb_build_object('v', 1, 'for', '2026-10-06T11:00:00.123456+00:00',
                                                        'short', '{"p1": "цель — ценовая стабильность"}'::jsonb,
                                                        'tried', '{}'::jsonb))))
$fn$;
grant execute on function pg_temp.copy_payload(uuid, uuid, uuid) to authenticated, anon;

-- The author's exam, its answer key, an answer key of another exam (another lecture), the author's journal and links.
insert into public.materials (id, user_id, title, subject, original_text) values
  ('33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-0000-0000-000000000001', 'Лекция другого экзамена', 'Право', 'Другой текст');
insert into public.exams (id, user_id, title, exam_date, mapping_state) values
  ('e0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Макроэкономика', '2026-11-10', 'done'),
  ('e0000000-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000001', 'Другой экзамен', null, 'done');
insert into public.exam_materials (exam_id, material_id, user_id) values
  ('e0000000-0000-4000-8000-00000000000a', '11111111-1111-1111-1111-111111111111', 'aaaaaaaa-0000-0000-0000-000000000001'),
  ('e0000000-0000-4000-8000-00000000000b', '33333333-3333-4333-8333-333333333333', 'aaaaaaaa-0000-0000-0000-000000000001');
insert into public.exam_questions (exam_id, user_id, position, text, coverage, coverage_method, materials_fingerprint, mapping_version) values
  ('e0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 1, 'Денежно-кредитная политика ЦБ', 'full', 'llm', 'fp-a', 1),
  ('e0000000-0000-4000-8000-00000000000b', 'aaaaaaaa-0000-0000-0000-000000000001', 1, 'Денежно-кредитная политика ЦБ', 'full', 'llm', 'fp-b', 1);
insert into public.oral_rubrics (user_id, question_hash, source_key, material_id, material_ids, question, rubric, created_at, sheet) values
  ('aaaaaaaa-0000-0000-0000-000000000001', public.meldy_question_hash('Денежно-кредитная политика ЦБ'), 'author-key-0000001',
   '11111111-1111-1111-1111-111111111111', array['11111111-1111-1111-1111-111111111111']::uuid[], 'Денежно-кредитная политика ЦБ',
   '{"v": 1, "coverage": "full", "points": [{"id": "p1", "title": "Цель — ценовая стабильность"}]}',
   '2026-10-06T11:00:00.123456+00', '{"v": 1, "for": "2026-10-06T11:00:00.123456+00:00", "short": {}, "tried": {}}'),
  ('aaaaaaaa-0000-0000-0000-000000000001', public.meldy_question_hash('Денежно-кредитная политика ЦБ'), 'other-exam-key-001',
   '33333333-3333-4333-8333-333333333333', array['33333333-3333-4333-8333-333333333333']::uuid[], 'Денежно-кредитная политика ЦБ',
   '{"v": 1, "coverage": "full", "points": [{"id": "p1", "title": "ЧУЖАЯ ЛЕКЦИЯ"}]}', now(), null),
  -- Built from this exam's lecture and the other one: quotes of a lecture outside the exam, so it stays too.
  ('aaaaaaaa-0000-0000-0000-000000000001', public.meldy_question_hash('Денежно-кредитная политика ЦБ'), 'mixed-key-00000001',
   '11111111-1111-1111-1111-111111111111',
   array['11111111-1111-1111-1111-111111111111', '33333333-3333-4333-8333-333333333333']::uuid[], 'Денежно-кредитная политика ЦБ',
   '{"v": 1, "coverage": "full", "points": [{"id": "p1", "title": "СМЕШАННЫЙ ЭТАЛОН"}]}', now(), null);
insert into public.oral_rubric_failures (user_id, question_hash, source_key) values
  ('aaaaaaaa-0000-0000-0000-000000000001', public.meldy_question_hash('Денежно-кредитная политика ЦБ'), 'failed-key-0000001');
insert into public.learning_events (user_id, kind, item_key, client_event_id, payload) values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'oral_point', 'oral:x:p1', 'author-event-000001', '{"title": "ОТВЕТ АВТОРА"}');
insert into public.exam_shares (id, exam_id, owner_id, code_hash, consent, created_at, expires_at, revoked_at, max_members) values
  ('5a000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('abcdefghjkmn', 'UTF8')), 'hex'),
   'Делюсь с группой вопросами, текстом моих лекций и пунктами ответа.', now(), now() + interval '90 days', null, 80),
  ('5a000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('bbbbbbbbbbbb', 'UTF8')), 'hex'),
   'Делюсь с группой вопросами, текстом моих лекций и пунктами ответа.', now(), null, now(), 80),
  ('5a000000-0000-4000-8000-000000000003', 'e0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('cccccccccccc', 'UTF8')), 'hex'),
   'Делюсь с группой вопросами, текстом моих лекций и пунктами ответа.', now() - interval '2 days', now() - interval '1 day', null, 80),
  ('5a000000-0000-4000-8000-000000000004', 'e0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('dddddddddddd', 'UTF8')), 'hex'),
   'Делюсь с группой вопросами, текстом моих лекций и пунктами ответа.', now(), null, null, 1);

-- 1. Without auth.uid(): every function but the preview refuses.
set local role authenticated;
select set_config('request.jwt.claim.sub', '', true);
do $t$
begin
  perform pg_temp.expect_error($$select public.exam_share_bundle('abcdefghjkmn')$$, '28000', 'bundle without a user');
  perform pg_temp.expect_error($$select public.exam_share_claim('abcdefghjkmn')$$, '28000', 'claim without a user');
  perform pg_temp.expect_error(
    $$select public.exam_share_bind('5a000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-00000000000a')$$,
    '28000', 'bind without a user');
  perform pg_temp.expect_error(
    $$select public.exam_share_join('abcdefghjkmn', pg_temp.copy_payload(gen_random_uuid(), gen_random_uuid(), gen_random_uuid()))$$,
    '28000', 'join without a user');
  perform pg_temp.expect_error($$select public.exam_share_revoke('5a000000-0000-4000-8000-000000000001')$$, '28000',
    'revoke without a user');
  if (select count(*) from public.exam_shares) <> 0 or (select count(*) from public.exam_share_members) <> 0 then
    raise exception 'FAILED: rows of exam_shares or exam_share_members are readable without a user';
  end if;
end
$t$;

-- 2. A stranger (C): a wrong code, the author's rows, links and seats by hand.
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
declare n integer;
begin
  perform pg_temp.expect_error($$select public.exam_share_bundle('eeeeeeeeeeee')$$, 'MS001', 'bundle of an unknown code');
  perform pg_temp.expect_error($$select public.exam_share_bundle('ABCDEFGHJKMN')$$, 'MS001', 'bundle of a code in capitals');
  perform pg_temp.expect_error($$select public.exam_share_bundle('iiiiiiiiiiii')$$, 'MS001', 'bundle of a malformed code');
  if (select count(*) from public.exam_shares) <> 0 then
    raise exception 'FAILED: a stranger reads the author''s links';
  end if;
  perform pg_temp.expect_error(
    $$insert into public.exam_shares (exam_id, owner_id, code_hash, consent)
      values ('e0000000-0000-4000-8000-00000000000a', 'cccccccc-0000-0000-0000-000000000003', repeat('a', 64),
              'Делюсь с группой вопросами, текстом моих лекций и пунктами ответа.')$$,
    '42501', 'a link of someone else''s exam');
  perform pg_temp.expect_error($$select public.exam_share_revoke('5a000000-0000-4000-8000-000000000001')$$, 'MS001',
    'a stranger revokes the author''s link');
  perform pg_temp.expect_error(
    $$insert into public.exam_share_members (share_id, user_id) values ('5a000000-0000-4000-8000-000000000001', 'cccccccc-0000-0000-0000-000000000003')$$,
    '42501', 'a seat written by hand');
  -- No UPDATE or DELETE policy: nothing is touched (or, with supabase/migrations/20261007110457_exam_shares_revokes.sql
  -- applied, the statement itself is refused).
  begin
    update public.exam_shares set revoked_at = null where id = '5a000000-0000-4000-8000-000000000002';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAILED: a stranger updated a link'; end if;
    delete from public.exam_shares where id = '5a000000-0000-4000-8000-000000000001';
    get diagnostics n = row_count;
    if n <> 0 then raise exception 'FAILED: a stranger deleted a link'; end if;
  exception when insufficient_privilege then null;
  end;
  if (select pg_catalog.jsonb_object_keys(public.exam_share_preview('eeeeeeeeeeee')) limit 1) is distinct from 'status'
     or public.exam_share_preview('eeeeeeeeeeee') ->> 'status' <> 'not_found' then
    raise exception 'FAILED: the preview of an unknown code says more than not_found';
  end if;
end
$t$;

-- 3. The author: their own link is MS005; links of their own exam can be read; a link with seats or revoked cannot be
--    inserted by hand.
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
begin
  perform pg_temp.expect_error($$select public.exam_share_bundle('abcdefghjkmn')$$, 'MS005', 'the author''s own bundle');
  perform pg_temp.expect_error(
    $$select public.exam_share_join('abcdefghjkmn', pg_temp.copy_payload(gen_random_uuid(), gen_random_uuid(), gen_random_uuid()))$$,
    'MS005', 'the author joins their own link');
  if (select count(*) from public.exam_shares) <> 4 then
    raise exception 'FAILED: the author does not read their own links';
  end if;
  if public.exam_share_preview('abcdefghjkmn') ->> 'status' <> 'own' then
    raise exception 'FAILED: the preview of the author''s own link: %', public.exam_share_preview('abcdefghjkmn');
  end if;
  perform pg_temp.expect_error(
    $$insert into public.exam_shares (exam_id, owner_id, code_hash, consent, members)
      values ('e0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', repeat('b', 64),
              'Делюсь с группой вопросами, текстом моих лекций и пунктами ответа.', 5)$$,
    '42501', 'a new link with seats already taken');
  perform pg_temp.expect_error(
    $$insert into public.exam_shares (exam_id, owner_id, code_hash, consent)
      values ('e0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'not-a-hash',
              'Делюсь с группой вопросами, текстом моих лекций и пунктами ответа.')$$,
    '23514', 'a link with a malformed code hash');
end
$t$;

-- 4. B reads the bundle: white-listed keys, no journal, no answer key built from another exam's lecture.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
declare
  v_bundle jsonb;
  v_text text;
begin
  v_bundle := public.exam_share_bundle('abcdefghjkmn');
  v_text := v_bundle::text;
  if (select array_agg(k order by k) from pg_catalog.jsonb_object_keys(v_bundle) k)
     <> array['exam', 'failures', 'links', 'materials', 'questions', 'rubrics', 'v'] then
    raise exception 'FAILED: the bundle keys: %', (select array_agg(k) from pg_catalog.jsonb_object_keys(v_bundle) k);
  end if;
  if v_text like '%ОТВЕТ АВТОРА%' or v_text like '%author-event%' or v_text like '%ЧУЖАЯ ЛЕКЦИЯ%'
     or v_text like '%СМЕШАННЫЙ ЭТАЛОН%' or v_text like '%33333333-3333-4333-8333-333333333333%'
     or v_text like '%Лекция другого экзамена%' then
    raise exception 'FAILED: the bundle carries the journal or another exam: %', v_text;
  end if;
  if pg_catalog.jsonb_array_length(v_bundle -> 'rubrics') <> 1
     or v_bundle -> 'rubrics' -> 0 ->> 'source_key' <> 'author-key-0000001'
     or v_bundle -> 'rubrics' -> 0 ->> 'created_at' is null
     or v_bundle -> 'materials' -> 0 ->> 'original_text' <> 'Текст лекции'
     or pg_catalog.jsonb_array_length(v_bundle -> 'failures') <> 1
     or pg_catalog.jsonb_array_length(v_bundle -> 'questions') <> 1 then
    raise exception 'FAILED: the bundle content: %', v_text;
  end if;
  if (select array_agg(k order by k) from pg_catalog.jsonb_object_keys(v_bundle -> 'questions' -> 0) k)
     <> array['coverage', 'coverage_method', 'coverage_reason', 'evidence', 'id', 'label', 'mapped_at', 'mapping_version',
              'materials_fingerprint', 'missing_note', 'nearest', 'position', 'question_hash', 'section', 'text'] then
    raise exception 'FAILED: the question keys of the bundle';
  end if;
  if public.exam_share_preview('abcdefghjkmn') ->> 'status' <> 'active'
     or public.exam_share_preview('abcdefghjkmn') ->> 'title' <> 'Макроэкономика'
     or (public.exam_share_preview('abcdefghjkmn') ->> 'questions')::int <> 1 then
    raise exception 'FAILED: the preview of a live link: %', public.exam_share_preview('abcdefghjkmn');
  end if;
end
$t$;

-- 5. B joins: the copy is B's own; the sheet's created_at is kept; the seat points at it; joining again — the same copy.
do $t$
declare
  v_result jsonb;
  v_again jsonb;
  v_exam uuid := 'e0000000-0000-4000-8000-0000000000b1';
  v_material uuid := 'b0000000-0000-4000-8000-0000000000b1';
begin
  -- A copy whose answer key names the author's lecture is refused by the existing policies: nothing stays, no seat.
  perform pg_temp.expect_error(
    $$select public.exam_share_join('abcdefghjkmn', pg_temp.copy_payload('e0000000-0000-4000-8000-0000000000b9',
        'b0000000-0000-4000-8000-0000000000b9', '11111111-1111-1111-1111-111111111111'))$$,
    '42501', 'a copy that points at the author''s lecture');
  perform pg_temp.expect_error($$select public.exam_share_join('abcdefghjkmn', '{"v": 2}'::jsonb)$$, 'MS006', 'a malformed copy');
  if exists (select 1 from public.exams where id = 'e0000000-0000-4000-8000-0000000000b9')
     or exists (select 1 from public.exam_share_members) then
    raise exception 'FAILED: a refused copy left rows or a seat';
  end if;

  v_result := public.exam_share_join('abcdefghjkmn', pg_temp.copy_payload(v_exam, v_material, v_material));
  if v_result ->> 'exam_id' <> v_exam::text or (v_result ->> 'joined')::boolean is not true then
    raise exception 'FAILED: the join answer: %', v_result;
  end if;
  if (select user_id from public.exams where id = v_exam) <> 'bbbbbbbb-0000-0000-0000-000000000002'
     or (select summary_json from public.materials where id = v_material) <> '{"text_only": true}'::jsonb
     or (select original_text from public.materials where id = v_material) <> 'Текст лекции'
     or (select count(*) from public.exam_materials where exam_id = v_exam) <> 1
     or (select count(*) from public.exam_questions where exam_id = v_exam) <> 1 then
    raise exception 'FAILED: the copy rows';
  end if;
  if (select created_at from public.oral_rubrics where source_key = 'copy-key-' || replace(v_exam::text, '-', ''))
        <> '2026-10-06T11:00:00.123456+00'::timestamptz
     or (select (sheet ->> 'for')::timestamptz from public.oral_rubrics where source_key = 'copy-key-' || replace(v_exam::text, '-', ''))
        <> (select created_at from public.oral_rubrics where source_key = 'copy-key-' || replace(v_exam::text, '-', '')) then
    raise exception 'FAILED: the sheet''s "for" is not the copied created_at';
  end if;
  if (select question_hash from public.exam_questions where exam_id = v_exam)
     <> public.meldy_question_hash('Денежно-кредитная политика ЦБ') then
    raise exception 'FAILED: the copied question has another hash';
  end if;
  if (select member_exam_id from public.exam_share_members where share_id = '5a000000-0000-4000-8000-000000000001') <> v_exam then
    raise exception 'FAILED: the seat is not bound to the copy';
  end if;

  v_again := public.exam_share_join('abcdefghjkmn', pg_temp.copy_payload(gen_random_uuid(), gen_random_uuid(), gen_random_uuid()));
  if v_again <> pg_catalog.jsonb_build_object('exam_id', v_exam, 'joined', false) then
    raise exception 'FAILED: joining again: %', v_again;
  end if;
  if public.exam_share_bundle('abcdefghjkmn') <> pg_catalog.jsonb_build_object('v', 1, 'joined', pg_catalog.jsonb_build_object('exam_id', v_exam)) then
    raise exception 'FAILED: the bundle after joining is more than the copy''s id';
  end if;
  if (select count(*) from public.exams) <> 1 then
    raise exception 'FAILED: joining again made another copy';
  end if;
  if public.exam_share_preview('abcdefghjkmn') ->> 'status' <> 'joined'
     or public.exam_share_preview('abcdefghjkmn') ->> 'exam_id' <> v_exam::text then
    raise exception 'FAILED: the preview after joining: %', public.exam_share_preview('abcdefghjkmn');
  end if;

  -- With B's token the author's rows read nothing.
  if (select count(*) from public.materials where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') <> 0
     or exists (select 1 from public.materials where id = '11111111-1111-1111-1111-111111111111')
     or exists (select 1 from public.exams where id = 'e0000000-0000-4000-8000-00000000000a')
     or exists (select 1 from public.exam_questions where exam_id = 'e0000000-0000-4000-8000-00000000000a')
     or exists (select 1 from public.oral_rubrics where user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
     or exists (select 1 from public.oral_rubric_failures where user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
     or exists (select 1 from public.learning_events where user_id = 'aaaaaaaa-0000-0000-0000-000000000001')
     or (select count(*) from public.exam_shares) <> 0 then
    raise exception 'FAILED: the classmate''s token reads the author''s rows';
  end if;
  if (select count(*) from public.exam_share_members) <> 1 then
    raise exception 'FAILED: the classmate does not read their own seat';
  end if;

  -- A seat with a copy cannot be pointed at another exam of the classmate (that exam would pass for the copy and
  -- the real copy could then be shared on).
  insert into public.exams (id, user_id, title) values ('e0000000-0000-4000-8000-0000000000b2',
    'bbbbbbbb-0000-0000-0000-000000000002', 'Другой экзамен B');
  perform pg_temp.expect_error(
    $$select public.exam_share_bind('5a000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-0000000000b2')$$,
    'MS006', 'rebinding a seat that has a copy');
  if (select member_exam_id from public.exam_share_members where share_id = '5a000000-0000-4000-8000-000000000001') <> v_exam then
    raise exception 'FAILED: the seat was rebound to another exam';
  end if;
  delete from public.exams where id = 'e0000000-0000-4000-8000-0000000000b2';

  -- The copy cannot be shared on.
  perform pg_temp.expect_error(
    $$insert into public.exam_shares (exam_id, owner_id, code_hash, consent)
      values ('e0000000-0000-4000-8000-0000000000b1', 'bbbbbbbb-0000-0000-0000-000000000002', repeat('c', 64),
              'Делюсь с группой вопросами, текстом моих лекций и пунктами ответа.')$$,
    '42501', 'a link of a copy');
  -- Rubric failures: own rows only, one per key.
  insert into public.oral_rubric_failures (question_hash, source_key) values (pg_catalog.md5('b'), 'b-failed-key-0001');
  perform pg_temp.expect_error(
    $$insert into public.oral_rubric_failures (question_hash, source_key) values (pg_catalog.md5('b'), 'b-failed-key-0001')$$,
    '23505', 'the same failure twice');
  perform pg_temp.expect_error(
    $$insert into public.oral_rubric_failures (user_id, question_hash, source_key)
      values ('aaaaaaaa-0000-0000-0000-000000000001', pg_catalog.md5('a'), 'forged-failure-01')$$,
    '42501', 'a failure written for someone else');
end
$t$;

-- 6. Revoked, expired and full links; the author revokes; the counter.
do $t$
begin
  perform pg_temp.expect_error($$select public.exam_share_bundle('bbbbbbbbbbbb')$$, 'MS002', 'bundle of a revoked link');
  perform pg_temp.expect_error(
    $$select public.exam_share_join('bbbbbbbbbbbb', pg_temp.copy_payload(gen_random_uuid(), gen_random_uuid(), gen_random_uuid()))$$,
    'MS002', 'join of a revoked link');
  perform pg_temp.expect_error($$select public.exam_share_bundle('cccccccccccc')$$, 'MS003', 'bundle of an expired link');
  if public.exam_share_preview('bbbbbbbbbbbb') <> '{"status": "revoked"}'::jsonb
     or public.exam_share_preview('cccccccccccc') <> '{"status": "expired"}'::jsonb then
    raise exception 'FAILED: the preview of revoked or expired links says more than the status';
  end if;
  -- One seat on «dddddddddddd»: B takes it, C is refused.
  perform public.exam_share_join('dddddddddddd', pg_temp.copy_payload(gen_random_uuid(), 'b0000000-0000-4000-8000-0000000000d1',
                                                                     'b0000000-0000-4000-8000-0000000000d1'));
end
$t$;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
begin
  perform pg_temp.expect_error($$select public.exam_share_bundle('dddddddddddd')$$, 'MS004', 'bundle with no seat left');
  perform pg_temp.expect_error(
    $$select public.exam_share_join('dddddddddddd', pg_temp.copy_payload(gen_random_uuid(), gen_random_uuid(), gen_random_uuid()))$$,
    'MS004', 'join with no seat left');
  if public.exam_share_preview('dddddddddddd') <> '{"status": "full"}'::jsonb then
    raise exception 'FAILED: the preview of a full link: %', public.exam_share_preview('dddddddddddd');
  end if;
end
$t$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
do $t$
declare
  v_first jsonb;
  v_second jsonb;
begin
  if (select members from public.exam_shares where id = '5a000000-0000-4000-8000-000000000001') <> 1
     or (select members from public.exam_shares where id = '5a000000-0000-4000-8000-000000000004') <> 1 then
    raise exception 'FAILED: the seat counter';
  end if;
  if exists (select 1 from public.exam_share_members) then
    raise exception 'FAILED: the author reads the classmates'' seats';
  end if;
  v_first := public.exam_share_revoke('5a000000-0000-4000-8000-000000000001');
  v_second := public.exam_share_revoke('5a000000-0000-4000-8000-000000000001');
  if v_first ->> 'revoked_at' is null or v_second ->> 'revoked_at' <> v_first ->> 'revoked_at' then
    raise exception 'FAILED: revoke twice: % then %', v_first, v_second;
  end if;
end
$t$;
-- After the revoke: B still gets the copy B already has; C is refused.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $t$
begin
  if public.exam_share_bundle('abcdefghjkmn') -> 'joined' ->> 'exam_id' <> 'e0000000-0000-4000-8000-0000000000b1' then
    raise exception 'FAILED: the classmate lost the copy with the revoke';
  end if;
end
$t$;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', true);
do $t$
begin
  perform pg_temp.expect_error($$select public.exam_share_bundle('abcdefghjkmn')$$, 'MS002', 'a newcomer after the revoke');
end
$t$;

select 'EXAM SHARES CHECKS PASSED';
rollback;

-- Signed out (anon): the preview answers with the status and the title, nothing else works.
begin;
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_what text)
returns void language plpgsql as $fn$
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_state;
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if sqlstate is distinct from p_state then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, sqlstate, sqlerrm, p_state;
    end if;
end;
$fn$;
grant execute on function pg_temp.expect_error(text, text, text) to anon;
insert into public.exams (id, user_id, title) values
  ('e0000000-0000-4000-8000-00000000000c', 'aaaaaaaa-0000-0000-0000-000000000001', 'Экзамен для гостя');
insert into public.exam_shares (exam_id, owner_id, code_hash, consent) values
  ('e0000000-0000-4000-8000-00000000000c', 'aaaaaaaa-0000-0000-0000-000000000001',
   pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to('ffffffffffff', 'UTF8')), 'hex'),
   'Делюсь с группой вопросами, текстом моих лекций и пунктами ответа.');
set local role anon;
-- The functions refuse anon themselves (28000); with the optional hardening of supabase/pending applied, EXECUTE and
-- the table rights are gone as well (42501). Either is a refusal.
do $t$
declare
  v_preview jsonb;
  v_sql text;
  v_rows bigint;
begin
  v_preview := public.exam_share_preview('ffffffffffff');
  if v_preview ->> 'status' <> 'active' or v_preview ->> 'title' <> 'Экзамен для гостя' or v_preview ? 'exam_id' and v_preview ->> 'exam_id' is not null then
    raise exception 'FAILED: the anonymous preview: %', v_preview;
  end if;
  foreach v_sql in array array[
    $$select public.exam_share_bundle('ffffffffffff')$$,
    $$select public.exam_share_claim('ffffffffffff')$$,
    $$select public.exam_share_join('ffffffffffff', '{"v": 1}'::jsonb)$$,
    $$select public.exam_share_revoke(gen_random_uuid())$$] loop
    begin
      execute v_sql;
      raise exception 'FAILED: anon ran %', v_sql;
    exception when sqlstate '28000' or insufficient_privilege then null;
    end;
  end loop;
  foreach v_sql in array array['public.exam_shares', 'public.exam_share_members', 'public.oral_rubric_failures'] loop
    begin
      execute 'select count(*) from ' || v_sql into v_rows;
      if v_rows <> 0 then raise exception 'FAILED: anon reads %', v_sql; end if;
    exception when insufficient_privilege then null;
    end;
  end loop;
end
$t$;
select 'ANON CHECKS PASSED';
rollback;
