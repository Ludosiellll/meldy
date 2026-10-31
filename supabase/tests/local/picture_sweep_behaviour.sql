-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261103090200_picture_sweep.sql on
-- the local chain of oral_journal_sweep_run.sh: which deletes queue a folder, and the bot's two calls. One transaction,
-- rolled back. A failure raises (FAILED: …); success prints PICTURE SWEEP PASSED. Roles as PostgREST sets them; postgres
-- for the fixture. Users: A (aaaa…1, the owner), C (cccc…3, a stranger), D (dddd…4, a member), U (a user deleted with
-- the exam they own).
-- Checks:
--   * the owner's delete queues the container's folder; a stranger's delete (no row: row security) and a delete the
--     database refuses (an active member: MC009) queue nothing; an account deleted with its exam queues it (cascade);
--   * bot_picture_sweep (service role): the queued folders oldest first, each taken at most once a minute (p_now moves
--     the clock), at most p_limit, not after 50 tries; `queued` counts the rows; bot_picture_swept removes a row once;
--   * anon and authenticated may call neither function, nor read the queue.
\set ON_ERROR_STOP 1
begin;

create or replace function pg_temp.expect_error(p_sql text, p_states text[], p_what text)
returns void language plpgsql as $fn$
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_states;
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if not (sqlstate = any (p_states)) then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, sqlstate, sqlerrm, p_states;
    end if;
end;
$fn$;
create or replace function pg_temp.as_role(p_role text, p_sub uuid default null)
returns void language plpgsql as $fn$
begin
  execute 'reset role';
  perform set_config('request.jwt.claim.sub', coalesce(p_sub::text, ''), true);
  perform set_config('request.jwt.claim.role', '', true);
  if p_role = 'postgres' then
    perform set_config('request.jwt.claims', '', true);
  else
    perform set_config('request.jwt.claims', json_build_object('role', p_role, 'sub', p_sub)::text, true);
    execute format('set local role %I', p_role);
  end if;
end;
$fn$;
create or replace function pg_temp.check(p_ok boolean, p_what text, p_got text default null)
returns void language plpgsql as $fn$
begin
  if p_ok is not true then
    raise exception 'FAILED: %', p_what || coalesce(' — got ' || p_got, '');
  end if;
end;
$fn$;
grant execute on function pg_temp.expect_error(text, text[], text), pg_temp.as_role(text, uuid), pg_temp.check(boolean, text, text)
  to anon, authenticated, service_role;

do $t$
declare
  A uuid := 'aaaaaaaa-0000-0000-0000-000000000001';
  C uuid := 'cccccccc-0000-0000-0000-000000000003';
  D uuid := 'dddddddd-0000-4000-8000-0000000000d4';
  U uuid := 'eeeeeeee-0000-4000-8000-0000000000e5';
  K_OWN uuid := 'f1000000-0000-4000-8000-000000000001';
  K_MEMBERS uuid := 'f1000000-0000-4000-8000-000000000002';
  K_ACCOUNT uuid := 'f1000000-0000-4000-8000-000000000003';
  K_OTHER uuid := 'f1000000-0000-4000-8000-000000000004';
  r jsonb;
  n integer;
begin
  -- The fixture (postgres): A's three exams and tests, D a member of one, U's own exam.
  insert into auth.users (id) values (C), (D), (U) on conflict (id) do nothing;
  insert into public.containers (id, owner_id, title) values
    (K_OWN, A, 'Тест с обложкой'), (K_MEMBERS, A, 'Тест группы'), (K_OTHER, A, 'Чужой не удалит'), (K_ACCOUNT, U, 'Экзамен удалённого');
  insert into public.container_members (container_id, user_id) values (K_MEMBERS, D);
  perform pg_temp.check((select count(*) from meldy_private.picture_sweep) = 0, 'the queue starts empty');

  -- The owner deletes a test: queued in the same transaction.
  perform pg_temp.as_role('authenticated', A);
  delete from public.containers where id = K_OWN;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 1, 'the owner deleted the test');
  perform pg_temp.expect_error($$select count(*) from meldy_private.picture_sweep$$, array['42501'], 'a user reads the queue');
  -- A delete the database refuses (an active member) queues nothing.
  perform pg_temp.expect_error(format($$delete from public.containers where id = %L$$, K_MEMBERS), array['MC009'], 'delete with members');
  -- A stranger's delete reaches no row and queues nothing.
  perform pg_temp.as_role('authenticated', C);
  delete from public.containers where id = K_OTHER;
  get diagnostics n = row_count;
  perform pg_temp.check(n = 0, 'a stranger deletes nothing');
  perform pg_temp.as_role('postgres');
  perform pg_temp.check((select array_agg(container_id) from meldy_private.picture_sweep) = array[K_OWN], 'only the deleted test is queued',
                        (select array_agg(container_id)::text from meldy_private.picture_sweep));
  perform pg_temp.check((select tries = 0 and tried_at is null from meldy_private.picture_sweep where container_id = K_OWN), 'a new row: no tries');

  -- An account deleted with its exam (the cascade from auth.users) queues the exam too (one transaction: the same
  -- queued_at, so the order is the id's).
  delete from auth.users where id = U;
  perform pg_temp.check((select count(*) from public.containers where id = K_ACCOUNT) = 0, 'the cascade deleted the exam');
  perform pg_temp.check((select count(*) from meldy_private.picture_sweep) = 2, 'the cascade queued its folder');

  -- Clients may not call the bot's functions.
  perform pg_temp.as_role('anon');
  perform pg_temp.expect_error($$select public.bot_picture_sweep(5)$$, array['42501'], 'anon takes folders');
  perform pg_temp.expect_error(format($$select public.bot_picture_swept(%L)$$, K_OWN), array['42501'], 'anon clears a folder');
  perform pg_temp.as_role('authenticated', A);
  perform pg_temp.expect_error($$select public.bot_picture_sweep(5)$$, array['42501'], 'a user takes folders');
  perform pg_temp.expect_error(format($$select public.bot_picture_swept(%L)$$, K_OWN), array['42501'], 'a user clears a folder');

  -- The bot: oldest first, p_limit, once a minute.
  perform pg_temp.as_role('service_role');
  r := public.bot_picture_sweep(1);
  perform pg_temp.check(r -> 'folders' = jsonb_build_array(K_OWN) and (r ->> 'queued')::int = 2, 'one folder, the oldest', r::text);
  r := public.bot_picture_sweep(5);
  perform pg_temp.check(r -> 'folders' = jsonb_build_array(K_ACCOUNT), 'the other one; the first was taken this minute', r::text);
  r := public.bot_picture_sweep(5);
  perform pg_temp.check(r -> 'folders' = '[]'::jsonb and (r ->> 'queued')::int = 2, 'nothing again within the minute', r::text);
  r := public.bot_picture_sweep(5, now() + interval '61 seconds');
  perform pg_temp.check(r -> 'folders' = jsonb_build_array(K_OWN, K_ACCOUNT), 'both a minute later, oldest first', r::text);
  perform pg_temp.as_role('postgres');
  perform pg_temp.check((select tries from meldy_private.picture_sweep where container_id = K_OWN) = 2, 'two tries counted');

  -- The folder is empty in both buckets: its row goes, once.
  perform pg_temp.as_role('service_role');
  r := public.bot_picture_swept(K_OWN);
  perform pg_temp.check((r ->> 'done')::boolean, 'swept', r::text);
  r := public.bot_picture_swept(K_OWN);
  perform pg_temp.check(not (r ->> 'done')::boolean, 'swept twice: nothing to remove', r::text);
  r := public.bot_picture_sweep(5, now() + interval '5 minutes');
  perform pg_temp.check(r -> 'folders' = jsonb_build_array(K_ACCOUNT) and (r ->> 'queued')::int = 1, 'one folder left', r::text);

  -- A folder storage keeps refusing stops after 50 tries and stays for a look.
  perform pg_temp.as_role('postgres');
  update meldy_private.picture_sweep set tries = 50 where container_id = K_ACCOUNT;
  perform pg_temp.as_role('service_role');
  r := public.bot_picture_sweep(5, now() + interval '10 minutes');
  perform pg_temp.check(r -> 'folders' = '[]'::jsonb and (r ->> 'queued')::int = 1, 'not taken after 50 tries, still queued', r::text);
  r := public.bot_picture_sweep(500, now() + interval '20 minutes');
  perform pg_temp.check(jsonb_array_length(r -> 'folders') = 0, 'a large limit changes nothing', r::text);
  perform pg_temp.as_role('postgres');
  raise notice 'PICTURE SWEEP PASSED';
end
$t$;
rollback;
