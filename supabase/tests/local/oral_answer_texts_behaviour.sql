-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour test of *_oral_answer_texts.sql on the local baseline:
-- supabase/tests/local/baseline.sql, then 20261003083154_hackathon_journal_exams_oral.sql, then
-- 20261007095841_oral_answer_texts.sql (twice, to prove it is re-runnable), then this file, then
-- supabase/tests/oral_answer_texts.sql (contract_ok must be true). Users A and B come from the baseline. Runs as
-- role authenticated with request.jwt.claim.sub switching between them, and finally as anon. Everything happens in
-- one transaction that rolls back; a failure raises an exception, success prints ORAL ANSWER TEXTS PASSED.
-- Checks:
--   * consent: a student adds the own row (user_id left to auth.uid()), switches it (upsert as PostgREST sends
--     it), reads only it; updated_at is the server's time and cannot be chosen; nobody writes another's row;
--   * texts: no text without a granted consent of the same version (42501); with it a student stores the text of
--     an own attempt (own exam, own exam_sessions row), reads it back, cannot store a second text of the same
--     attempt (23505), cannot change it (42501), can delete it; no text for another's exam or session, no chosen
--     created_at, no text over 20 000 characters, no unknown input;
--   * B sees none of A's texts or consent and cannot delete them; anon can do nothing;
--   * the exam goes — the text stays without exam_id; the attempt's session goes — the text goes; the account
--     goes — consent and texts go.
begin;

insert into public.exams (id, user_id, title) values
  ('e0000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Базы данных'),
  ('e0000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000002', 'Экономика');
insert into public.exam_sessions (id, user_id, subject, kind) values
  ('5e000000-0000-4000-8000-00000000000a', 'aaaaaaaa-0000-0000-0000-000000000001', 'Базы данных', 'oral_ticket'),
  ('5e000000-0000-4000-8000-0000000000a2', 'aaaaaaaa-0000-0000-0000-000000000001', 'Базы данных', 'oral_ticket'),
  ('5e000000-0000-4000-8000-00000000000b', 'bbbbbbbb-0000-0000-0000-000000000002', 'Экономика', 'oral_ticket');

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

-- A: no consent yet — no text.
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
select pg_temp.expect_error(
  $q$insert into public.oral_answer_texts (exam_id, question_hash, attempt_id, session_id, input, text, consent_version)
     values ('e0000000-0000-4000-8000-00000000000a', '0123456789abcdef0123456789abcdef', 'attempt-a-0001',
             '5e000000-0000-4000-8000-00000000000a', 'speech', 'Ключ — атрибут.', 1)$q$,
  '42501', 'A stores a text without consent');

-- A declines, then grants (the upsert PostgREST sends for on_conflict=user_id).
insert into public.oral_answer_consent (granted, version) values (false, 1);
select pg_temp.expect_error(
  $q$insert into public.oral_answer_texts (question_hash, attempt_id, text, consent_version)
     values ('0123456789abcdef0123456789abcdef', 'attempt-a-0001', 'Ключ — атрибут.', 1)$q$,
  '42501', 'A stores a text after declining');
insert into public.oral_answer_consent (granted, version) values (true, 1)
  on conflict (user_id) do update set granted = excluded.granted, version = excluded.version;
do $$
declare v_rows int; v_granted boolean; v_user uuid; v_updated timestamptz;
begin
  select count(*), bool_and(granted), max(user_id::text)::uuid, max(updated_at)
    into v_rows, v_granted, v_user, v_updated from public.oral_answer_consent;
  if v_rows is distinct from 1 or v_granted is distinct from true
     or v_user is distinct from 'aaaaaaaa-0000-0000-0000-000000000001'::uuid
     or v_updated is null or v_updated < now() - interval '1 minute' then
    raise exception 'FAILED: A reads back the own consent (rows %, granted %, user %, updated %)', v_rows, v_granted, v_user, v_updated;
  end if;
end $$;
select pg_temp.expect_error(
  $q$update public.oral_answer_consent set updated_at = '2020-01-01' where user_id = 'aaaaaaaa-0000-0000-0000-000000000001'$q$,
  '42501', 'A chooses updated_at');
select pg_temp.expect_error(
  $q$insert into public.oral_answer_consent (user_id, granted) values ('bbbbbbbb-0000-0000-0000-000000000002', true)$q$,
  '42501', 'A grants consent for B');

-- A: a text of the wrong consent version, another's exam or session, a chosen created_at — refused.
select pg_temp.expect_error(
  $q$insert into public.oral_answer_texts (question_hash, attempt_id, text, consent_version)
     values ('0123456789abcdef0123456789abcdef', 'attempt-a-0001', 'Ключ — атрибут.', 2)$q$,
  '42501', 'A stores a text under another consent version');
select pg_temp.expect_error(
  $q$insert into public.oral_answer_texts (exam_id, question_hash, attempt_id, text, consent_version)
     values ('e0000000-0000-4000-8000-00000000000b', '0123456789abcdef0123456789abcdef', 'attempt-a-0001', 'Текст.', 1)$q$,
  '42501', 'A stores a text for B''s exam');
select pg_temp.expect_error(
  $q$insert into public.oral_answer_texts (session_id, question_hash, attempt_id, text, consent_version)
     values ('5e000000-0000-4000-8000-00000000000b', '0123456789abcdef0123456789abcdef', 'attempt-a-0001', 'Текст.', 1)$q$,
  '42501', 'A stores a text for B''s session');
select pg_temp.expect_error(
  $q$insert into public.oral_answer_texts (question_hash, attempt_id, text, consent_version, created_at)
     values ('0123456789abcdef0123456789abcdef', 'attempt-a-0001', 'Текст.', 1, '2020-01-01')$q$,
  '42501', 'A chooses created_at');
select pg_temp.expect_error(
  $q$insert into public.oral_answer_texts (user_id, question_hash, attempt_id, text, consent_version)
     values ('bbbbbbbb-0000-0000-0000-000000000002', '0123456789abcdef0123456789abcdef', 'attempt-a-0001', 'Текст.', 1)$q$,
  '42501', 'A stores a text as B');
select pg_temp.expect_error(
  $q$insert into public.oral_answer_texts (question_hash, attempt_id, text, consent_version)
     values ('0123456789abcdef0123456789abcdef', 'attempt-a-0001', repeat('а', 20001), 1)$q$,
  '23514', 'A stores 20 001 characters');
select pg_temp.expect_error(
  $q$insert into public.oral_answer_texts (question_hash, attempt_id, input, text, consent_version)
     values ('0123456789abcdef0123456789abcdef', 'attempt-a-0001', 'video', 'Текст.', 1)$q$,
  '23514', 'A gives an unknown input');
select pg_temp.expect_error(
  $q$insert into public.oral_answer_texts (question_hash, attempt_id, text, consent_version)
     values ('0123456789abcdef0123456789abcdef', 'attempt-a-0001', '   ', 1)$q$,
  '23514', 'A stores an empty text');

-- A: the text of an own attempt, 20 000 characters at most; one per attempt; no change.
insert into public.oral_answer_texts (exam_id, question_hash, attempt_id, session_id, input, text, consent_version)
values ('e0000000-0000-4000-8000-00000000000a', '0123456789abcdef0123456789abcdef', 'attempt-a-0001',
        '5e000000-0000-4000-8000-00000000000a', 'speech', 'Ключ — атрибут, который однозначно определяет кортеж.', 1);
insert into public.oral_answer_texts (exam_id, question_hash, attempt_id, session_id, input, text, consent_version)
values ('e0000000-0000-4000-8000-00000000000a', 'fedcba9876543210fedcba9876543210', 'attempt-a-0002',
        '5e000000-0000-4000-8000-0000000000a2', 'text', repeat('б', 20000), 1);
select pg_temp.expect_error(
  $q$insert into public.oral_answer_texts (question_hash, attempt_id, text, consent_version)
     values ('0123456789abcdef0123456789abcdef', 'attempt-a-0001', 'Повтор той же попытки.', 1)$q$,
  '23505', 'A stores a second text of one attempt');
select pg_temp.expect_error(
  $q$update public.oral_answer_texts set text = 'Другой ответ.' where attempt_id = 'attempt-a-0001'$q$,
  '42501', 'A changes a stored text');
do $$
declare v_rows int; v_created timestamptz;
begin
  select count(*), min(created_at) into v_rows, v_created from public.oral_answer_texts;
  if v_rows is distinct from 2 or v_created is null or v_created < now() - interval '1 minute' then
    raise exception 'FAILED: A reads back own texts (rows %, created %)', v_rows, v_created;
  end if;
end $$;

-- B: sees nothing of A, deletes nothing of A; B's own consent is B's.
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
do $$
declare v_texts int; v_consents int;
begin
  select count(*) into v_texts from public.oral_answer_texts;
  select count(*) into v_consents from public.oral_answer_consent;
  if v_texts is distinct from 0 or v_consents is distinct from 0 then
    raise exception 'FAILED: B sees A''s rows (texts %, consents %)', v_texts, v_consents;
  end if;
end $$;
delete from public.oral_answer_texts where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
update public.oral_answer_consent set granted = false where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';

-- anon: nothing.
reset role;
set local role anon;
select set_config('request.jwt.claim.sub', '', true);
select pg_temp.expect_error($q$select count(*) from public.oral_answer_texts$q$, '42501', 'anon reads texts');
select pg_temp.expect_error($q$select count(*) from public.oral_answer_consent$q$, '42501', 'anon reads consents');
select pg_temp.expect_error(
  $q$insert into public.oral_answer_consent (user_id, granted) values ('aaaaaaaa-0000-0000-0000-000000000001', true)$q$,
  '42501', 'anon grants consent');

-- B's delete and update touched nothing; then A deletes one own text.
reset role;
do $$
begin
  if (select count(*) from public.oral_answer_texts) is distinct from 2::bigint then
    raise exception 'FAILED: B deleted A''s texts';
  end if;
  if (select granted from public.oral_answer_consent where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') is distinct from true then
    raise exception 'FAILED: B changed A''s consent';
  end if;
end $$;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);
delete from public.oral_answer_texts where attempt_id = 'attempt-a-0002';
reset role;

-- The exam goes: the text stays without it. The session goes: the text goes. The account goes: the rest goes.
delete from public.exams where id = 'e0000000-0000-4000-8000-00000000000a';
do $$
begin
  if (select exam_id from public.oral_answer_texts where attempt_id = 'attempt-a-0001') is not null
     or (select count(*) from public.oral_answer_texts) is distinct from 1::bigint then
    raise exception 'FAILED: deleting the exam (texts must stay without exam_id)';
  end if;
end $$;
delete from public.exam_sessions where id = '5e000000-0000-4000-8000-00000000000a';
do $$
begin
  if exists (select 1 from public.oral_answer_texts) then
    raise exception 'FAILED: the text outlived its attempt''s session';
  end if;
end $$;
delete from auth.users where id = 'aaaaaaaa-0000-0000-0000-000000000001';
do $$
begin
  if exists (select 1 from public.oral_answer_consent where user_id = 'aaaaaaaa-0000-0000-0000-000000000001') then
    raise exception 'FAILED: the consent outlived the account';
  end if;
end $$;

select 'ORAL ANSWER TEXTS PASSED' as result;
rollback;
