-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. The parity of meldy_private.test_doc_ok (supabase/migrations/
-- 20261019100000_test_docs.sql) and the client's docProblems (frontend/src/lib/studio/doc.ts): both run the documents of
-- contracts/studio/test_doc_cases.json and must give each one its expected first rule (null: valid).
-- test_docs_run.sh hands the file in as the psql variable `cases` (it writes the \set line itself; this file reads no
-- file). The cases' exam (container_id) and another exam (other_container_id) are made here with the cases' fixed ids,
-- their questions as test_items rows; one transaction, rolled back.
-- Prints «PARITY FAIL <case>: expected <rule>, got <rule>» for each disagreement, then the counts, and
-- TEST DOC PARITY PASSED when every case agrees (at least 60 of them).
\set ON_ERROR_STOP 1
begin;
create temp table parity_input (c jsonb not null);
insert into parity_input values (:'cases'::jsonb);
create temp table parity_out (ord integer primary key, name text not null, want text, got text);

do $t$
declare
  v jsonb := (select c from pg_temp.parity_input);
  v_owner uuid := (v ->> 'owner_id')::uuid;
  v_exam uuid := (v ->> 'container_id')::uuid;
  v_other uuid := (v ->> 'other_container_id')::uuid;
  v_s1 uuid := gen_random_uuid();
  v_s2 uuid := gen_random_uuid();
begin
  insert into auth.users (id) values (v_owner) on conflict do nothing;
  insert into public.containers (id, owner_id, title) values (v_exam, v_owner, 'Паритет'), (v_other, v_owner, 'Другой экзамен');
  insert into public.container_subjects (id, container_id, owner_id, title)
  values (v_s1, v_exam, v_owner, 'Вопросы'), (v_s2, v_other, v_owner, 'Вопросы');
  insert into public.test_items (id, container_id, subject_id, position, stem, options, correct, key_source)
  select x::uuid, v_exam, v_s1, o::integer, 'Вопрос ' || o, '["а", "б"]'::jsonb, '{0}'::smallint[], 'manual'
    from jsonb_array_elements_text(v -> 'items') with ordinality t(x, o);
  insert into public.test_items (id, container_id, subject_id, position, stem, options, correct, key_source)
  select x::uuid, v_other, v_s2, o::integer, 'Чужой вопрос ' || o, '["а", "б"]'::jsonb, '{0}'::smallint[], 'manual'
    from jsonb_array_elements_text(v -> 'other_items') with ordinality t(x, o);

  insert into pg_temp.parity_out (ord, name, want, got)
  select o::integer, e.x ->> 'name', e.x ->> 'expect', meldy_private.test_doc_ok(e.x -> 'doc', v_exam)
    from jsonb_array_elements(v -> 'cases') with ordinality e(x, o);
end
$t$;

select 'PARITY FAIL ' || name || ': expected ' || coalesce(want, 'null') || ', got ' || coalesce(got, 'null')
  from pg_temp.parity_out where want is distinct from got order by ord;
select format('PARITY %s cases: %s agree, %s differ', count(*), count(*) filter (where want is not distinct from got),
              count(*) filter (where want is distinct from got))
  from pg_temp.parity_out;
select 'TEST DOC PARITY PASSED'
 where not exists (select 1 from pg_temp.parity_out where want is distinct from got)
   and (select count(*) from pg_temp.parity_out) >= 60;
rollback;
