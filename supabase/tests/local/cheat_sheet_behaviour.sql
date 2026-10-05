-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour test of *_cheat_sheet.sql on the local baseline
-- (supabase/tests/local/baseline.sql, then 20261003083154_hackathon_journal_exams_oral.sql, then the migration).
-- As role authenticated, inside a transaction that rolls back: the owner patches only oral_rubrics.sheet, filtered by
-- id and created_at (a stale created_at touches no row), the check refuses a non-object and a sheet over 8 KB, another
-- user's PATCH touches no row, the journal takes kind 'sheet_peek' and still refuses unknown kinds; anon cannot read the
-- column. Success prints CHEAT SHEET CHECKS PASSED.
begin;
set local role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', true);

do $t$
declare
  MAT_A uuid := '11111111-1111-1111-1111-111111111111';
  v_id uuid;
  v_created timestamptz;
  n integer;
  v_failed boolean;
begin
  insert into public.oral_rubrics (question_hash, source_key, material_id, question, rubric)
  values (pg_catalog.md5('вопрос'), 'cheat-sheet-key', MAT_A, 'Вопрос листа', '{"coverage": "full", "points": []}')
  returning id, created_at into v_id, v_created;

  update public.oral_rubrics
     set sheet = pg_catalog.jsonb_build_object('v', 1, 'for', v_created, 'short', '{"p1": "ставка ↑"}'::jsonb, 'tried', '{}'::jsonb)
   where id = v_id and created_at = v_created;
  get diagnostics n = row_count;
  if n is distinct from 1 then raise exception 'the owner could not patch sheet (% rows)', n; end if;

  update public.oral_rubrics set sheet = '{"v": 1}'::jsonb where id = v_id and created_at = v_created + interval '1 second';
  get diagnostics n = row_count;
  if n is distinct from 0 then raise exception 'a stale created_at must touch no row'; end if;
  if (select sheet -> 'short' ->> 'p1' from public.oral_rubrics where id = v_id) is distinct from 'ставка ↑' then
    raise exception 'the sheet changed under a stale created_at';
  end if;

  v_failed := false;
  begin
    update public.oral_rubrics set sheet = '["not", "an", "object"]'::jsonb where id = v_id;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a non-object sheet was accepted'; end if;

  v_failed := false;
  begin
    update public.oral_rubrics set sheet = pg_catalog.jsonb_build_object('v', 1, 'pad', pg_catalog.repeat('я', 4200)) where id = v_id;
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'a sheet over 8 KB was accepted'; end if;

  insert into public.learning_events (kind, item_key, client_event_id, payload)
  values ('sheet_peek', 'sheet:' || pg_catalog.md5('вопрос') || ':p1', 'peek-0000-0001', '{"point_id": "p1"}');

  v_failed := false;
  begin
    insert into public.learning_events (kind, item_key, client_event_id) values ('sheet_erase', 'x', 'peek-0000-0002');
  exception when check_violation then v_failed := true;
  end;
  if not v_failed then raise exception 'an unknown journal kind was accepted'; end if;

  perform pg_catalog.set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', true);
  update public.oral_rubrics set sheet = '{"v": 1}'::jsonb where id = v_id;
  get diagnostics n = row_count;
  if n is distinct from 0 then raise exception 'another user patched the sheet'; end if;
end
$t$;

select 'CHEAT SHEET CHECKS PASSED';
rollback;

begin;
set local role anon;
do $t$
begin
  begin
    perform sheet from public.oral_rubrics limit 1;
    raise exception 'anon read oral_rubrics.sheet';
  exception when insufficient_privilege then null;
  end;
end
$t$;
select 'ANON CHECKS PASSED';
rollback;
