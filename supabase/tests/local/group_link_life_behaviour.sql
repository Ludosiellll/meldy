-- LOCAL ONLY; NEVER RUN AGAINST THE LIVE PROJECT. Behaviour of supabase/migrations/20261107090200_group_link_life.sql on
-- a scratch database with the live order up to it (supabase/tests/local/group_link_life_run.sh builds it).
-- Covered: a new link's end (120 days, or 30 days after a later last date) and that it leaves the open links open;
-- the author's moves for everyone (the whole exam, one subject, «Настройки», a subject added with a later date) give
-- every open link and its oral shares at least the new last date + 30 days and never less, leave closed and expired
-- links alone, and a member's own date moves nothing; container_link_extend (the author only; extend an open link;
-- reopen a closed or an expired one with its oral shares; the 10 open links); joining through an expired, a closed and a
-- reopened link; a member's oral codes while every link is shut and after a reopen; a member who left rejoins through
-- a reopened link without a new seat; /g/<code> says the author's own link is closed; the members' oral copies follow
-- the author's oral date when it is moved for everyone (whole exam, subject, the oral exam's own date), a copy with a
-- date of its member's own and the author's own date ('me') stay.
-- One transaction, rolled back. A failure raises (FAILED: …); success prints GROUP LINK LIFE CHECKS PASSED. Roles as
-- PostgREST sets them: authenticated (request.jwt.claim.sub); postgres for fixtures and for time passing.
\set ON_ERROR_STOP 1
begin;
set local timezone = 'Europe/Minsk';

create temp table ctx (k text primary key, v text);
grant all on ctx to anon, authenticated, service_role;
create or replace function pg_temp.put(p_k text, p_v text) returns void language sql as $fn$
  insert into ctx values (p_k, p_v) on conflict (k) do update set v = excluded.v
$fn$;
create or replace function pg_temp.c(p_k text) returns text language sql stable as $fn$
  select v from ctx where k = p_k
$fn$;
create or replace function pg_temp.check(p_ok boolean, p_what text, p_detail jsonb default null)
returns void language plpgsql as $fn$
begin
  if p_ok is not true then raise exception 'FAILED: % %', p_what, coalesce(p_detail::text, ''); end if;
end;
$fn$;
create or replace function pg_temp.expect_error(p_sql text, p_state text, p_what text)
returns void language plpgsql as $fn$
begin
  execute p_sql;
  raise exception 'FAILED: % — no error, expected SQLSTATE %', p_what, p_state;
exception
  when others then
    if sqlstate = 'P0001' and sqlerrm like 'FAILED:%' then raise; end if;
    if sqlstate <> p_state then
      raise exception 'FAILED: % — SQLSTATE % (%), expected %', p_what, sqlstate, sqlerrm, p_state;
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
-- 00:00 UTC of a day: how a link's end from a date is kept.
create or replace function pg_temp.utc(p_day date) returns timestamptz language sql immutable as $fn$
  select p_day::timestamp at time zone 'utc'
$fn$;
create or replace function pg_temp.link_end(p_k text) returns timestamptz language sql stable security definer as $fn$
  select expires_at from public.container_links where id = pg_temp.c(p_k)::uuid
$fn$;
-- The end (or null) of every oral share of a link, distinct.
create or replace function pg_temp.share_ends(p_k text) returns timestamptz[] language sql stable security definer as $fn$
  select array_agg(distinct sh.expires_at) from public.exam_shares sh
   where sh.id in (select unnest(l.oral_share_ids) from public.container_links l where l.id = pg_temp.c(p_k)::uuid)
$fn$;
create or replace function pg_temp.share_open(p_k text) returns boolean language sql stable security definer as $fn$
  select bool_and(sh.revoked_at is null) from public.exam_shares sh
   where sh.id in (select unnest(l.oral_share_ids) from public.container_links l where l.id = pg_temp.c(p_k)::uuid)
$fn$;
-- Time passes for a link (and its oral shares): it ended an hour ago.
create or replace function pg_temp.expire(p_k text) returns void language sql as $fn$
  update public.container_links set created_at = now() - interval '200 days', expires_at = now() - interval '1 hour'
   where id = pg_temp.c(p_k)::uuid;
  update public.exam_shares set created_at = now() - interval '200 days', expires_at = now() - interval '1 hour'
   where id in (select unnest(l.oral_share_ids) from public.container_links l where l.id = pg_temp.c(p_k)::uuid);
$fn$;
-- The SQLSTATE a statement raises, or '' when it passes.
create or replace function pg_temp.try_code(p_sql text) returns text language plpgsql as $fn$
begin
  execute p_sql;
  return '';
exception when others then
  return sqlstate;
end;
$fn$;
grant execute on all functions in schema pg_temp to anon, authenticated, service_role;

-- The people: A the author, M and N members, S a stranger.
insert into auth.users (id) values
  ('91170000-0000-4000-8000-00000000000a'), ('91170000-0000-4000-8000-00000000000b'),
  ('91170000-0000-4000-8000-00000000000c'), ('91170000-0000-4000-8000-00000000000d')
  on conflict do nothing;
select pg_temp.put('a', '91170000-0000-4000-8000-00000000000a'), pg_temp.put('m', '91170000-0000-4000-8000-00000000000b'),
       pg_temp.put('n', '91170000-0000-4000-8000-00000000000c'), pg_temp.put('s', '91170000-0000-4000-8000-00000000000d');
select pg_temp.put('consent', 'Делюсь с группой вопросами, текстом моих лекций и пунктами ответа. Мои ответы никто не увидит.');
-- The author's oral exam (its date is the exam's).
insert into public.exams (id, user_id, title, exam_date) values
  ('91170000-0000-4000-8000-0000000000e1', '91170000-0000-4000-8000-00000000000a', 'Сети устно', current_date + 10);
insert into public.exam_questions (exam_id, user_id, position, text) values
  ('91170000-0000-4000-8000-0000000000e1', '91170000-0000-4000-8000-00000000000a', 1, 'Модель OSI');

-- 1. A new link: 120 days, or 30 days after a last date that is later; the others stay open.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare
  r jsonb;
  d date := current_date;
  v_c uuid;
begin
  r := public.container_create('Сессия', d + 10, jsonb_build_array(
         jsonb_build_object('title', 'Тест'),
         jsonb_build_object('title', 'Сети', 'exam_id', '91170000-0000-4000-8000-0000000000e1')));
  v_c := (r ->> 'container_id')::uuid;
  perform pg_temp.put('c', v_c::text);
  perform pg_temp.put('s_test', r -> 'subjects' -> 0 ->> 'id');
  perform pg_temp.put('s_oral', r -> 'subjects' -> 1 ->> 'id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid,
    '[{"ref":"g:1","stem":"Сколько уровней в OSI?","options":["5","7"],"correct":[1]}]');
  r := public.container_link_create(v_c, 60, pg_temp.c('consent'));
  perform pg_temp.put('l1', r ->> 'link_id');
  perform pg_temp.put('code1', r ->> 'code');
  perform pg_temp.check((r ->> 'expires_at')::timestamptz = now() + interval '120 days', 'a new link: 120 days when the date is near', r);
  perform pg_temp.check(pg_temp.share_ends('l1') = array[now() + interval '120 days'], 'its oral share ends with it');
  r := public.container_link_create(v_c, 60, pg_temp.c('consent'));
  perform pg_temp.put('l2', r ->> 'link_id');
  perform pg_temp.put('code2', r ->> 'code');
  perform pg_temp.check((select count(*) from public.container_links where container_id = v_c and revoked_at is null) = 2,
                        'a second link leaves the first open');

  r := public.container_create('Далёкий', d + 200, '[{"title": "Право"}]');
  perform pg_temp.put('c_far', r ->> 'container_id');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid,
    '[{"ref":"g:2","stem":"Что такое иск?","options":["a","b"],"correct":[0]}]');
  r := public.container_link_create(pg_temp.c('c_far')::uuid);
  perform pg_temp.check((r ->> 'expires_at')::timestamptz = pg_temp.utc(d + 230), 'a far date: 30 days after it', r);

  r := public.container_create('Без даты', null, '[{"title": "Химия", "exam_date": null}]');
  perform public.container_items_add((r -> 'subjects' -> 0 ->> 'id')::uuid,
    '[{"ref":"g:3","stem":"H2O?","options":["вода","соль"],"correct":[0]}]');
  r := public.container_link_create((r ->> 'container_id')::uuid);
  perform pg_temp.check((r ->> 'expires_at')::timestamptz = now() + interval '120 days', 'no date: 120 days', r);
end
$t$;

-- M joins by the first link, N by the second.
select pg_temp.as_role('authenticated', pg_temp.c('m')::uuid);
select pg_temp.check((public.container_join(pg_temp.c('code1')) ->> 'joined')::boolean, 'M joins');
select pg_temp.as_role('authenticated', pg_temp.c('n')::uuid);
select pg_temp.check((public.container_join(pg_temp.c('code2')) ->> 'joined')::boolean, 'N joins');

-- A closed link (L3) and an expired one (L4) beside the open two.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare r jsonb;
begin
  r := public.container_link_create(pg_temp.c('c')::uuid, 60, pg_temp.c('consent'));
  perform pg_temp.put('l3', r ->> 'link_id');
  perform public.container_link_revoke((r ->> 'link_id')::uuid);
  r := public.container_link_create(pg_temp.c('c')::uuid, 60, pg_temp.c('consent'));
  perform pg_temp.put('l4', r ->> 'link_id');
end
$t$;
select pg_temp.as_role('postgres');
select pg_temp.expire('l4');
select pg_temp.put('l3_end', pg_temp.link_end('l3')::text), pg_temp.put('l4_end', pg_temp.link_end('l4')::text);

-- 2. Moves. A member's own date moves no link.
select pg_temp.as_role('authenticated', pg_temp.c('m')::uuid);
do $t$
begin
  perform public.exam_date_move(pg_temp.c('c')::uuid, current_date + 300, 'me');
  perform pg_temp.check(pg_temp.link_end('l1') = now() + interval '120 days' and pg_temp.link_end('l2') = now() + interval '120 days',
                        'a member''s own date moves no link');
end
$t$;
-- The author moves the whole exam for everyone: every open link at least 30 days past the new last date.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare d date := current_date;
begin
  perform public.exam_date_move(pg_temp.c('c')::uuid, d + 150, 'all');
  perform pg_temp.check(pg_temp.link_end('l1') = pg_temp.utc(d + 180) and pg_temp.link_end('l2') = pg_temp.utc(d + 180),
                        'the whole exam moved: the open links follow', to_jsonb(array[pg_temp.link_end('l1'), pg_temp.link_end('l2')]));
  perform pg_temp.check(pg_temp.share_ends('l1') = array[pg_temp.utc(d + 180)] and pg_temp.share_ends('l2') = array[pg_temp.utc(d + 180)],
                        'their oral shares follow');
  perform pg_temp.check(pg_temp.link_end('l3') = pg_temp.c('l3_end')::timestamptz and pg_temp.link_end('l4') = pg_temp.c('l4_end')::timestamptz,
                        'a closed and an expired link stay as they are');
  perform pg_temp.check(pg_temp.share_ends('l4') = array[pg_temp.c('l4_end')::timestamptz], 'the expired link''s share stays expired');
  -- One subject for everyone, later still.
  perform public.exam_date_move(pg_temp.c('c')::uuid, d + 170, 'all', pg_temp.c('s_test')::uuid);
  perform pg_temp.check(pg_temp.link_end('l1') = pg_temp.utc(d + 200), 'a subject moved: the links follow its date');
  perform pg_temp.check(pg_temp.share_ends('l1') = array[pg_temp.utc(d + 200)], 'and their shares');
  -- Earlier: never shorter.
  perform public.exam_date_move(pg_temp.c('c')::uuid, d + 20, 'all', pg_temp.c('s_test')::uuid);
  perform pg_temp.check(pg_temp.link_end('l1') = pg_temp.utc(d + 200), 'moved earlier: the link is not shortened');
  perform pg_temp.check(pg_temp.share_ends('l1') = array[pg_temp.utc(d + 200)], 'nor its share');
  -- «Настройки» write the dates directly: the links follow them too.
  update public.containers set exam_date = d + 400 where id = pg_temp.c('c')::uuid;
  perform pg_temp.check(pg_temp.link_end('l1') = pg_temp.utc(d + 430), '«Настройки»: the exam''s date');
  update public.container_subjects set exam_date = d + 410 where id = pg_temp.c('s_test')::uuid;
  perform pg_temp.check(pg_temp.link_end('l2') = pg_temp.utc(d + 440), '«Настройки»: a subject''s date');
  -- A subject added with a later date moves no link (container_subject_add holds the exam's row FOR UPDATE; a link
  -- written under it could deadlock with a first join): «Продлить» or the next move takes it along.
  perform public.container_subject_add(pg_temp.c('c')::uuid, jsonb_build_object('title', 'Матан', 'exam_date', to_char(d + 450, 'YYYY-MM-DD')));
  perform pg_temp.check(pg_temp.link_end('l1') = pg_temp.utc(d + 440), 'a subject added with a later date moves no link');
  perform public.container_link_extend(pg_temp.c('l1')::uuid);
  perform pg_temp.check(pg_temp.link_end('l1') = pg_temp.utc(d + 480) and pg_temp.share_ends('l1') = array[pg_temp.utc(d + 480)],
                        '«Продлить» then counts it');
  -- Another exam's links stay.
  perform pg_temp.check((select l.expires_at from public.container_links l where l.container_id = pg_temp.c('c_far')::uuid)
                        = pg_temp.utc(d + 230), 'another exam''s link stays');
  -- Back to a near date for what follows.
  update public.container_subjects set exam_date = null where container_id = pg_temp.c('c')::uuid;
  update public.containers set exam_date = d + 10 where id = pg_temp.c('c')::uuid;
end
$t$;

-- 3. container_link_extend: the author only.
select pg_temp.as_role('authenticated', pg_temp.c('m')::uuid);
select pg_temp.expect_error(format('select public.container_link_extend(%L)', pg_temp.c('l1')), 'MC001', 'a member extends');
select pg_temp.as_role('authenticated', pg_temp.c('s')::uuid);
select pg_temp.expect_error(format('select public.container_link_extend(%L)', pg_temp.c('l1')), 'MC001', 'a stranger extends');
select pg_temp.expect_error('select public.container_link_extend(gen_random_uuid())', 'MC001', 'no such link');
select pg_temp.as_role('authenticated', null);
select pg_temp.expect_error(format('select public.container_link_extend(%L)', pg_temp.c('l1')), '28000', 'not signed in');
select pg_temp.as_role('anon');
select pg_temp.expect_error(format('select public.container_link_extend(%L)', pg_temp.c('l1')), '42501', 'anon cannot run it');

-- An open link keeps a later end; an earlier one grows to the rule's end.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare r jsonb;
begin
  r := public.container_link_extend(pg_temp.c('l1')::uuid);
  perform pg_temp.check((r ->> 'expires_at')::timestamptz = pg_temp.utc(current_date + 480) and (r ->> 'reopened')::boolean is false
                        and r -> 'revoked_at' = 'null'::jsonb and (r ->> 'container_id')::uuid = pg_temp.c('c')::uuid,
                        'extend: a later end stays', r);
end
$t$;
select pg_temp.as_role('postgres');
update public.container_links set expires_at = now() + interval '3 days' where id = pg_temp.c('l2')::uuid;
update public.exam_shares set expires_at = now() + interval '3 days'
 where id in (select unnest(oral_share_ids) from public.container_links where id = pg_temp.c('l2')::uuid);
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare r jsonb;
begin
  r := public.container_link_extend(pg_temp.c('l2')::uuid);
  perform pg_temp.check((r ->> 'expires_at')::timestamptz = now() + interval '120 days' and (r ->> 'reopened')::boolean is false,
                        'extend: 3 days left grow to 120', r);
  perform pg_temp.check(pg_temp.share_ends('l2') = array[now() + interval '120 days'], 'extend: the share grows too');
end
$t$;

-- 4. Closed: nobody new comes in, the author's own page says it is closed; reopened: the same code works again.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
select pg_temp.check(public.container_link_revoke(pg_temp.c('l2')::uuid) ->> 'revoked_at' is not null, 'A closes the second link');
select pg_temp.check(public.container_link_preview(pg_temp.c('code2')) ->> 'link' = 'revoked', 'own preview: the link is closed',
                     public.container_link_preview(pg_temp.c('code2')));
select pg_temp.check(public.container_link_preview(pg_temp.c('code1')) ->> 'link' = 'active', 'own preview: an open link');
select pg_temp.as_role('authenticated', pg_temp.c('s')::uuid);
select pg_temp.check(public.container_link_preview(pg_temp.c('code2')) = '{"status": "revoked"}'::jsonb, 'a visitor: revoked');
select pg_temp.check(not (public.container_link_preview(pg_temp.c('code1')) ? 'link'), 'a visitor never sees the link field');
select pg_temp.expect_error(format('select public.container_join(%L)', pg_temp.c('code2')), 'MC002', 'joining a closed link');
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare r jsonb;
begin
  perform pg_temp.check(pg_temp.share_open('l2') is false, 'the closed link''s shares are closed');
  r := public.container_link_extend(pg_temp.c('l2')::uuid);
  perform pg_temp.check((r ->> 'reopened')::boolean and (r ->> 'expires_at')::timestamptz = now() + interval '120 days',
                        'reopen a closed link', r);
  perform pg_temp.check((select revoked_at is null from public.container_links where id = pg_temp.c('l2')::uuid), 'it is open');
  perform pg_temp.check(pg_temp.share_open('l2') and pg_temp.share_ends('l2') = array[now() + interval '120 days'],
                        'its oral shares open again, with its end');
  perform pg_temp.check(public.container_link_preview(pg_temp.c('code2')) ->> 'link' = 'active', 'own preview: open again');
end
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('s')::uuid);
select pg_temp.check(public.container_link_preview(pg_temp.c('code2')) ->> 'status' = 'active', 'a visitor: active again');
select pg_temp.check((public.container_join(pg_temp.c('code2')) ->> 'joined')::boolean, 'S joins through the reopened link');

-- 5. Expired: no rejoin, no oral code; reopened: both again.
select pg_temp.as_role('postgres');
select pg_temp.expire('l1');
select pg_temp.as_role('authenticated', pg_temp.c('m')::uuid);
select pg_temp.check((public.container_leave(pg_temp.c('c')::uuid) ->> 'left')::boolean, 'M leaves');
select pg_temp.check(public.container_link_preview(pg_temp.c('code1')) = '{"status": "expired"}'::jsonb, 'M left: the link has expired');
select pg_temp.expect_error(format('select public.container_join(%L)', pg_temp.c('code1')), 'MC003', 'rejoining by an expired link');
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
select pg_temp.check(public.container_link_preview(pg_temp.c('code1')) ->> 'link' = 'expired', 'own preview: expired');
-- Every link of the exam shut: N has no copy of «Сети» and none can be made.
select pg_temp.check(public.container_link_revoke(pg_temp.c('l2')::uuid) ->> 'revoked_at' is not null, 'A closes it again');
select pg_temp.as_role('authenticated', pg_temp.c('n')::uuid);
select pg_temp.check(public.container_oral_codes(pg_temp.c('c')::uuid) = '{"status": "closed", "subjects": []}'::jsonb,
                     'every link shut: no oral code', public.container_oral_codes(pg_temp.c('c')::uuid));
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare r jsonb; v_seats integer;
begin
  select members into v_seats from public.container_links where id = pg_temp.c('l1')::uuid;
  perform pg_temp.put('seats1', v_seats::text);
  r := public.container_link_extend(pg_temp.c('l1')::uuid);
  perform pg_temp.check((r ->> 'reopened')::boolean and (r ->> 'expires_at')::timestamptz = now() + interval '120 days',
                        'reopen an expired link', r);
  perform pg_temp.check(pg_temp.share_open('l1') and pg_temp.share_ends('l1') = array[now() + interval '120 days'],
                        'its oral shares live again');
end
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('n')::uuid);
do $t$
declare r jsonb; v_code text;
begin
  r := public.container_oral_codes(pg_temp.c('c')::uuid);
  perform pg_temp.check(r ->> 'status' = 'open' and jsonb_array_length(r -> 'subjects') = 1
                        and r -> 'subjects' -> 0 ->> 'subject_id' = pg_temp.c('s_oral'), 'reopened: N''s oral code again', r);
  v_code := r -> 'subjects' -> 0 ->> 'code';
  perform pg_temp.check(public.exam_share_preview(v_code) ->> 'status' = 'active', 'the oral share takes N',
                        public.exam_share_preview(v_code));
end
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('m')::uuid);
do $t$
declare r jsonb;
begin
  r := public.container_join(pg_temp.c('code1'));
  perform pg_temp.check((r ->> 'joined')::boolean, 'M rejoins through the reopened link', r);
  perform pg_temp.check((select left_at is null from public.container_members
                          where container_id = pg_temp.c('c')::uuid and user_id = pg_temp.c('m')::uuid), 'M is in again');
end
$t$;
select pg_temp.as_role('postgres');
select pg_temp.check((select members from public.container_links where id = pg_temp.c('l1')::uuid) = pg_temp.c('seats1')::integer,
                     'a rejoin takes no new seat');

-- 6. Ten open links: a closed one does not open past them; an open one still extends.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare n integer;
begin
  select count(*) into n from public.container_links where container_id = pg_temp.c('c')::uuid and revoked_at is null and expires_at > now();
  for i in 1 .. 10 - n loop
    perform public.container_link_create(pg_temp.c('c')::uuid, 60, pg_temp.c('consent'));
  end loop;
  perform pg_temp.expect_error(format('select public.container_link_extend(%L)', pg_temp.c('l3')), 'MC007', 'an eleventh open link by a reopen');
  perform pg_temp.expect_error(format('select public.container_link_create(%L, 60, %L)', pg_temp.c('c'), pg_temp.c('consent')),
                               'MC007', 'an eleventh open link by a new one');
  perform pg_temp.check(public.container_link_extend(pg_temp.c('l1')::uuid) ->> 'reopened' = 'false', 'an open one still extends');
end
$t$;

-- 7. The members' oral copies follow the author's oral date. M's copy has the author's date, N set another on theirs;
--    M has no own date of the exam any more (it would win in every read).
select pg_temp.as_role('postgres');
do $t$
declare d date := current_date;
begin
  update public.container_plans set own_exam_date = null where user_id = pg_temp.c('m')::uuid;
  update public.exams set exam_date = d - 1 where id = '91170000-0000-4000-8000-0000000000e1';
  update public.containers set exam_date = d - 1 where id = pg_temp.c('c')::uuid;
  insert into public.exams (id, user_id, title, exam_date) values
    ('91170000-0000-4000-8000-0000000000f1', pg_temp.c('m')::uuid, 'Сети устно', d - 1),
    ('91170000-0000-4000-8000-0000000000f2', pg_temp.c('n')::uuid, 'Сети устно', d + 5),
    ('91170000-0000-4000-8000-0000000000f3', pg_temp.c('s')::uuid, 'Своё, не копия', d - 1);
  insert into public.exam_share_members (share_id, user_id, member_exam_id)
  select sh.id, x.u, x.e from public.exam_shares sh
   cross join (values (pg_temp.c('m')::uuid, '91170000-0000-4000-8000-0000000000f1'::uuid),
                      (pg_temp.c('n')::uuid, '91170000-0000-4000-8000-0000000000f2'::uuid)) x(u, e)
   where sh.id = (select l.oral_share_ids[1] from public.container_links l where l.id = pg_temp.c('l1')::uuid);
  insert into public.container_member_exams (container_id, subject_id, user_id, exam_id) values
    (pg_temp.c('c')::uuid, pg_temp.c('s_oral')::uuid, pg_temp.c('m')::uuid, '91170000-0000-4000-8000-0000000000f1'),
    (pg_temp.c('c')::uuid, pg_temp.c('s_oral')::uuid, pg_temp.c('n')::uuid, '91170000-0000-4000-8000-0000000000f2');
end
$t$;
create or replace function pg_temp.exam_day(p_id text) returns date language sql stable security definer as $fn$
  select exam_date from public.exams where id = p_id::uuid
$fn$;
grant execute on function pg_temp.exam_day(text) to authenticated;
-- The author's own date moves no copy.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare d date := current_date;
begin
  perform public.exam_date_move(pg_temp.c('c')::uuid, d + 3, 'me');
  perform pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000e1') = d - 1
                        and pg_temp.exam_day('91170000-0000-4000-8000-0000000000f1') = d - 1, 'the author''s own date moves no oral exam');
  perform public.exam_date_move(pg_temp.c('c')::uuid, null, 'me');
  -- The whole exam for everyone: the passed oral date moves, and M's copy with it; N's own date stays.
  perform public.exam_date_move(pg_temp.c('c')::uuid, d + 14, 'all');
  perform pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000e1') = d + 14, 'the author''s oral exam moved');
  perform pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000f1') = d + 14, 'M''s copy follows',
                        to_jsonb(pg_temp.exam_day('91170000-0000-4000-8000-0000000000f1')));
  perform pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000f2') = d + 5, 'N''s copy with a date of N''s own stays');
  perform pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000f3') = d - 1, 'an exam that is no copy stays');
end
$t$;
-- The bot plans M's oral part by M's copy (bot_oral_inputs): the new date, so «Сети» is no longer «прошёл» for M.
select pg_temp.as_role('postgres');
insert into bot.links (user_id, tg_user_id, chat_id, tz, remind_at, linked_at, last_seen_at) values
  (pg_temp.c('m')::uuid, 9171, 9171, 'Europe/Minsk', '20:00', now() - interval '3 days', now() - interval '3 days');
select pg_temp.as_role('service_role');
do $t$
declare r jsonb := public.bot_oral_inputs(9171);
begin
  perform pg_temp.check((select (x ->> 'exam_date')::date from jsonb_array_elements(r -> 'parts') x
                          where x ->> 'subject_id' = pg_temp.c('s_oral')) = current_date + 14,
                        'the bot plans M''s oral part by the moved date', r - 'parts');
end
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare d date := current_date;
begin
  -- The subject for everyone.
  perform public.exam_date_move(pg_temp.c('c')::uuid, d + 21, 'all', pg_temp.c('s_oral')::uuid);
  perform pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000f1') = d + 21, 'a subject moved: M''s copy follows');
  -- The oral exam's own page (a direct update of the author's row).
  update public.exams set exam_date = d + 28 where id = '91170000-0000-4000-8000-0000000000e1';
  perform pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000f1') = d + 28, 'the oral exam''s own date: M''s copy follows');
  perform pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000f2') = d + 5, 'N''s copy still stays');
end
$t$;
-- M changes the date of their copy: nothing else moves.
select pg_temp.as_role('authenticated', pg_temp.c('m')::uuid);
update public.exams set exam_date = current_date + 40 where id = '91170000-0000-4000-8000-0000000000f1';
select pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000e1') = current_date + 28, 'a copy''s date moves nothing back');
-- …and from now on it keeps it when the author moves again.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
select pg_temp.check(public.exam_date_move(pg_temp.c('c')::uuid, current_date + 35, 'all', pg_temp.c('s_oral')::uuid) ->> 'for' = 'all', 'A moves «Сети» again');
select pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000f1') = current_date + 40, 'a copy M dated keeps M''s date');
-- …even when the author passes through M's date on the way (review L4: a copy that once had the author's date by chance
-- no longer follows: M set it themselves).
select pg_temp.check(public.exam_date_move(pg_temp.c('c')::uuid, current_date + 40, 'all', pg_temp.c('s_oral')::uuid) ->> 'for' = 'all', 'A moves «Сети» to M''s date');
select pg_temp.check(public.exam_date_move(pg_temp.c('c')::uuid, current_date + 45, 'all', pg_temp.c('s_oral')::uuid) ->> 'for' = 'all', 'and on');
select pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000f1') = current_date + 40, 'M''s own date is not taken over through the author''s',
                     to_jsonb(pg_temp.exam_day('91170000-0000-4000-8000-0000000000f1')));

-- 8–12: the review of 04.11. A second exam «Летняя» with two oral subjects; P (a member with a bound copy), Q (a
-- member without one), R (removed before copying), W (removed with a copy), V (left with a copy).
select pg_temp.as_role('postgres');
insert into auth.users (id) values
  ('91170000-0000-4000-8000-0000000000a1'), ('91170000-0000-4000-8000-0000000000a2'), ('91170000-0000-4000-8000-0000000000a3'),
  ('91170000-0000-4000-8000-0000000000a4'), ('91170000-0000-4000-8000-0000000000a5')
  on conflict do nothing;
select pg_temp.put('p', '91170000-0000-4000-8000-0000000000a1'), pg_temp.put('q', '91170000-0000-4000-8000-0000000000a2'),
       pg_temp.put('r', '91170000-0000-4000-8000-0000000000a3'), pg_temp.put('w', '91170000-0000-4000-8000-0000000000a4'),
       pg_temp.put('v', '91170000-0000-4000-8000-0000000000a5');
insert into public.exams (id, user_id, title, exam_date) values
  ('91170000-0000-4000-8000-0000000000e5', '91170000-0000-4000-8000-00000000000a', 'Право устно', current_date + 10),
  ('91170000-0000-4000-8000-0000000000e6', '91170000-0000-4000-8000-00000000000a', 'ОС устно', current_date + 10),
  ('91170000-0000-4000-8000-0000000000e7', '91170000-0000-4000-8000-00000000000a', 'Только устно', current_date + 200);
insert into public.exam_questions (exam_id, user_id, position, text) values
  ('91170000-0000-4000-8000-0000000000e5', '91170000-0000-4000-8000-00000000000a', 1, 'Иск'),
  ('91170000-0000-4000-8000-0000000000e6', '91170000-0000-4000-8000-00000000000a', 1, 'Планировщик'),
  ('91170000-0000-4000-8000-0000000000e7', '91170000-0000-4000-8000-00000000000a', 1, 'Сокеты');
create or replace function pg_temp.share_of(p_link text, p_exam text) returns uuid language sql stable security definer as $fn$
  select sh.id from public.exam_shares sh
   where sh.id in (select unnest(l.oral_share_ids) from public.container_links l where l.id = pg_temp.c(p_link)::uuid)
     and sh.exam_id = p_exam::uuid
$fn$;
create or replace function pg_temp.share_row(p_id text) returns public.exam_shares language sql stable security definer as $fn$
  select * from public.exam_shares where id = p_id::uuid
$fn$;
create or replace function pg_temp.ids_of(p_link text) returns uuid[] language sql stable security definer as $fn$
  select oral_share_ids from public.container_links where id = pg_temp.c(p_link)::uuid
$fn$;
grant execute on function pg_temp.share_of(text, text), pg_temp.share_row(text), pg_temp.ids_of(text) to authenticated;
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare r jsonb;
begin
  r := public.container_create('Летняя', current_date + 10, jsonb_build_array(
         jsonb_build_object('title', 'Право', 'exam_id', '91170000-0000-4000-8000-0000000000e5'),
         jsonb_build_object('title', 'ОС', 'exam_id', '91170000-0000-4000-8000-0000000000e6')));
  perform pg_temp.put('c3', r ->> 'container_id');
  perform pg_temp.put('s_law', r -> 'subjects' -> 0 ->> 'id');
  perform pg_temp.put('s_os', r -> 'subjects' -> 1 ->> 'id');
  r := public.container_link_create((r ->> 'container_id')::uuid, 60, pg_temp.c('consent'));
  perform pg_temp.put('l6', r ->> 'link_id');
  perform pg_temp.put('code6', r ->> 'code');
end
$t$;
select pg_temp.put('sh_law', pg_temp.share_of('l6', '91170000-0000-4000-8000-0000000000e5')::text),
       pg_temp.put('sh_os', pg_temp.share_of('l6', '91170000-0000-4000-8000-0000000000e6')::text);
do $t$
declare k text;
begin
  foreach k in array array['p', 'q', 'r', 'w', 'v'] loop
    perform pg_temp.as_role('authenticated', pg_temp.c(k)::uuid);
    perform pg_temp.check((public.container_join(pg_temp.c('code6')) ->> 'joined')::boolean, k || ' joins «Летняя»');
  end loop;
end
$t$;
-- Every member reads the same oral codes (container_oral_codes); R keeps them.
select pg_temp.as_role('authenticated', pg_temp.c('r')::uuid);
select pg_temp.put('code_law', (select x ->> 'code' from jsonb_array_elements(public.container_oral_codes(pg_temp.c('c3')::uuid) -> 'subjects') x
                                 where x ->> 'subject_id' = pg_temp.c('s_law'))),
       pg_temp.put('code_os', (select x ->> 'code' from jsonb_array_elements(public.container_oral_codes(pg_temp.c('c3')::uuid) -> 'subjects') x
                                where x ->> 'subject_id' = pg_temp.c('s_os')));
-- P, W and V copy «Право» (as oral-sync binds a copy); W is removed and V leaves afterwards; R is removed with nothing.
select pg_temp.as_role('postgres');
insert into public.exams (id, user_id, title, exam_date) values
  ('91170000-0000-4000-8000-0000000000c1', pg_temp.c('p')::uuid, 'Право устно', current_date + 10),
  ('91170000-0000-4000-8000-0000000000c4', pg_temp.c('w')::uuid, 'Право устно', current_date + 10),
  ('91170000-0000-4000-8000-0000000000c5', pg_temp.c('v')::uuid, 'Право устно', current_date + 10);
insert into public.exam_share_members (share_id, user_id, member_exam_id) values
  (pg_temp.c('sh_law')::uuid, pg_temp.c('p')::uuid, '91170000-0000-4000-8000-0000000000c1'),
  (pg_temp.c('sh_law')::uuid, pg_temp.c('w')::uuid, '91170000-0000-4000-8000-0000000000c4'),
  (pg_temp.c('sh_law')::uuid, pg_temp.c('v')::uuid, '91170000-0000-4000-8000-0000000000c5');
insert into public.container_member_exams (container_id, subject_id, user_id, exam_id) values
  (pg_temp.c('c3')::uuid, pg_temp.c('s_law')::uuid, pg_temp.c('p')::uuid, '91170000-0000-4000-8000-0000000000c1'),
  (pg_temp.c('c3')::uuid, pg_temp.c('s_law')::uuid, pg_temp.c('w')::uuid, '91170000-0000-4000-8000-0000000000c4'),
  (pg_temp.c('c3')::uuid, pg_temp.c('s_law')::uuid, pg_temp.c('v')::uuid, '91170000-0000-4000-8000-0000000000c5');
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
select pg_temp.check((public.container_member_remove(pg_temp.c('c3')::uuid, pg_temp.c('r')::uuid) ->> 'removed')::int = 1, 'A removes R');
select pg_temp.check((public.container_member_remove(pg_temp.c('c3')::uuid, pg_temp.c('w')::uuid) ->> 'removed')::int = 1, 'A removes W');
select pg_temp.as_role('authenticated', pg_temp.c('v')::uuid);
select pg_temp.check((public.container_leave(pg_temp.c('c3')::uuid) ->> 'left')::boolean, 'V leaves');

-- 8. «Продлить» reopens no share the author closed on its own (review M1): «ОС» is taken out of the exam and its share
--    closed on the oral exam's page; the exam's dates move and the open link is extended.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
delete from public.container_subjects where id = pg_temp.c('s_os')::uuid;
select pg_temp.check(public.exam_share_revoke(pg_temp.c('sh_os')::uuid) ->> 'revoked_at' is not null, 'A closes the share of «ОС»');
select pg_temp.put('sh_os_end', (pg_temp.share_row(pg_temp.c('sh_os'))).expires_at::text);
update public.containers set exam_date = current_date + 200 where id = pg_temp.c('c3')::uuid;
select pg_temp.check((pg_temp.share_row(pg_temp.c('sh_os'))).expires_at = pg_temp.c('sh_os_end')::timestamptz,
                     'a move leaves the share of an exam taken out alone');
select pg_temp.check(public.container_link_extend(pg_temp.c('l6')::uuid) ->> 'reopened' = 'false', '«Продлить» on the open link');
select pg_temp.check((pg_temp.share_row(pg_temp.c('sh_os'))).revoked_at is not null, '«Продлить» leaves a closed share closed',
                     to_jsonb(pg_temp.share_row(pg_temp.c('sh_os'))));
select pg_temp.check((pg_temp.share_row(pg_temp.c('sh_law'))).expires_at = pg_temp.utc(current_date + 230)
                     and (pg_temp.share_row(pg_temp.c('sh_law'))).revoked_at is null, 'the open share of «Право» follows the link');
select pg_temp.as_role('authenticated', pg_temp.c('s')::uuid);
select pg_temp.check(pg_temp.try_code(format('select public.exam_share_claim(%L)', pg_temp.c('code_os'))) <> '', 'a stranger cannot take «ОС»');

-- 9. A container's oral share takes its members only (review M2). R was removed before copying; R's codes no longer
--    claim or bundle while the link is open. An ordinary share of an oral exam (/join) still takes anyone.
select pg_temp.as_role('authenticated', pg_temp.c('r')::uuid);
-- /join's preview says the same as the claim (review of 04.11): no invitation that then fails.
select pg_temp.check(public.exam_share_preview(pg_temp.c('code_law')) = '{"status": "not_found"}'::jsonb, 'a removed member''s preview',
                     public.exam_share_preview(pg_temp.c('code_law')));
select pg_temp.as_role('authenticated', pg_temp.c('s')::uuid);
select pg_temp.check(public.exam_share_preview(pg_temp.c('code_law')) = '{"status": "not_found"}'::jsonb, 'a stranger''s preview');
select pg_temp.as_role('anon');
select pg_temp.check(public.exam_share_preview(pg_temp.c('code_law')) = '{"status": "not_found"}'::jsonb, 'a signed-out preview');
select pg_temp.as_role('authenticated', pg_temp.c('q')::uuid);
select pg_temp.check(public.exam_share_preview(pg_temp.c('code_law')) ->> 'status' = 'active', 'a member''s preview is the invitation');
select pg_temp.as_role('authenticated', pg_temp.c('p')::uuid);
select pg_temp.check(public.exam_share_preview(pg_temp.c('code_law')) ->> 'status' = 'joined', 'a member with the copy: joined');
select pg_temp.as_role('authenticated', pg_temp.c('r')::uuid);
select pg_temp.expect_error(format('select public.exam_share_claim(%L)', pg_temp.c('code_law')), 'MS001', 'a removed member claims an oral share');
select pg_temp.expect_error(format('select public.exam_share_bundle(%L)', pg_temp.c('code_law')), 'MS001', 'a removed member reads the bundle');
select pg_temp.as_role('postgres');
insert into public.exam_shares (exam_id, owner_id, code_hash, consent) values
  ('91170000-0000-4000-8000-0000000000e5', '91170000-0000-4000-8000-00000000000a', meldy_private.code_hash('abcd2fghjk98'),
   'Делюсь с группой вопросами, текстом моих лекций и пунктами ответа.');
select pg_temp.as_role('authenticated', pg_temp.c('s')::uuid);
select pg_temp.check(public.exam_share_preview('abcd2fghjk98') ->> 'status' = 'active', 'an ordinary share''s preview for a stranger');
select pg_temp.check(public.exam_share_claim('abcd2fghjk98') ? 'share_id', 'an ordinary share of the oral exam still takes a stranger');
select pg_temp.check(public.exam_share_bundle('abcd2fghjk98') ? 'questions', 'and gives the bundle');
-- Closed and opened again: the old codes are dead for good, the members get new ones, a bound copy stays bound.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
select pg_temp.put('old_ids', pg_temp.ids_of('l6')::text);
select pg_temp.check(public.container_link_revoke(pg_temp.c('l6')::uuid) ->> 'revoked_at' is not null, 'A closes «Летняя»''s link');
select pg_temp.check((public.container_link_extend(pg_temp.c('l6')::uuid) ->> 'reopened')::boolean, 'and opens it again');
select pg_temp.check(not (pg_temp.ids_of('l6') && pg_temp.c('old_ids')::uuid[]) and cardinality(pg_temp.ids_of('l6')) = 1,
                     'reopened: new oral shares only for the subjects there are', to_jsonb(pg_temp.ids_of('l6')));
select pg_temp.check((pg_temp.share_row(pg_temp.c('sh_law'))).revoked_at is not null, 'the old share is closed for good');
select pg_temp.as_role('authenticated', pg_temp.c('r')::uuid);
select pg_temp.expect_error(format('select public.exam_share_claim(%L)', pg_temp.c('code_law')), 'MS002', 'R''s old code after the reopen');
select pg_temp.expect_error(format('select public.exam_share_bundle(%L)', pg_temp.c('code_law')), 'MS002', 'R''s old bundle after the reopen');
select pg_temp.as_role('authenticated', pg_temp.c('q')::uuid);
do $t$
declare r jsonb := public.container_oral_codes(pg_temp.c('c3')::uuid); v_code text;
begin
  v_code := r -> 'subjects' -> 0 ->> 'code';
  perform pg_temp.check(r ->> 'status' = 'open' and jsonb_array_length(r -> 'subjects') = 1 and v_code <> pg_temp.c('code_law'),
                        'Q (no copy yet) gets a new code', r);
  perform pg_temp.check(public.exam_share_claim(v_code) ? 'share_id', 'Q''s new code takes Q');
end
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('p')::uuid);
select pg_temp.check(public.container_oral_codes(pg_temp.c('c3')::uuid) -> 'subjects' = '[]'::jsonb, 'P''s bound copy needs no code');
select pg_temp.check((public.container_summary(pg_temp.c('c3')::uuid) -> 'subjects' -> 0 -> 'oral' ->> 'exam_id')::uuid
                     = '91170000-0000-4000-8000-0000000000c1', 'P''s copy is still P''s oral part');
select pg_temp.check(public.exam_share_bundle(pg_temp.c('code_law')) -> 'joined' ->> 'exam_id' = '91170000-0000-4000-8000-0000000000c1',
                     'P''s old code still names P''s own copy');

-- 10. The copies that follow the author's oral date: active members only, and only dates a move takes (review M3).
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
update public.exams set exam_date = current_date + 20 where id = '91170000-0000-4000-8000-0000000000e5';
select pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000c1') = current_date + 20, 'P (in the exam) follows');
select pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000c4') = current_date + 10, 'W (removed) does not');
select pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000c5') = current_date + 10, 'V (left) does not');
update public.exams set exam_date = current_date + 800 where id = '91170000-0000-4000-8000-0000000000e5';
select pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000c1') = current_date + 20, 'a date past two years is not passed on');
-- 11. Dates out of range are refused where they are written; a link never lives past 760 days (review M4).
select pg_temp.expect_error($$update public.exams set exam_date = 'infinity' where id = '91170000-0000-4000-8000-0000000000e5'$$, '22023', 'infinity on an oral exam');
select pg_temp.expect_error($$update public.exams set exam_date = '1900-01-01' where id = '91170000-0000-4000-8000-0000000000e5'$$, '22023', '1900 on an oral exam');
select pg_temp.expect_error(format($$update public.containers set exam_date = 'infinity' where id = %L$$, pg_temp.c('c3')), '22023', 'infinity on an exam');
select pg_temp.expect_error(format($$update public.containers set exam_date = '300000-01-01' where id = %L$$, pg_temp.c('c3')), '22023', 'year 300000 on an exam');
select pg_temp.expect_error(format($$select public.container_subject_add(%L, '{"title": "Опечатка", "exam_date": "2206-01-20"}')$$, pg_temp.c('c3')),
                            '22023', 'year 2206 on a new subject');
update public.containers set exam_date = '2062-01-20' where id = pg_temp.c('c3')::uuid;
select pg_temp.check(pg_temp.link_end('l6') <= now() + interval '760 days' and pg_temp.link_end('l6') > now() + interval '700 days',
                     'a typo year: the link ends within 760 days', to_jsonb(pg_temp.link_end('l6')));
select pg_temp.check(pg_temp.share_ends('l6') = array[pg_temp.link_end('l6')], 'and its shares with it');
-- A row that already holds a date out of range (written before this file) still takes every other write; a new link
-- of it ignores that date.
select pg_temp.as_role('postgres');
set local session_replication_role = replica;
insert into public.containers (id, owner_id, title, exam_date) values
  ('91170000-0000-4000-8000-0000000000d4', '91170000-0000-4000-8000-00000000000a', 'Старая опечатка', 'infinity');
insert into public.container_subjects (id, container_id, owner_id, position, title) values
  ('91170000-0000-4000-8000-0000000000d5', '91170000-0000-4000-8000-0000000000d4', '91170000-0000-4000-8000-00000000000a', 1, 'Химия');
set local session_replication_role = origin;
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
update public.containers set title = 'Старая опечатка, переименована' where id = '91170000-0000-4000-8000-0000000000d4';
select pg_temp.check(public.container_items_add('91170000-0000-4000-8000-0000000000d5',
                     '[{"ref":"g:9","stem":"H2O?","options":["вода","соль"],"correct":[0]}]') is not null, 'its subject takes questions');
select pg_temp.check((public.container_link_create('91170000-0000-4000-8000-0000000000d4') ->> 'expires_at')::timestamptz
                     = now() + interval '120 days', 'a link of it: 120 days, the infinite date ignored');

-- 12. An oral-only exam: its date is the oral exam's (review L2); a new link counts it, a move of it takes the link.
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare r jsonb;
begin
  r := public.container_create('Только устный', null, jsonb_build_array(
         jsonb_build_object('title', 'Сети', 'exam_id', '91170000-0000-4000-8000-0000000000e7')));
  r := public.container_link_create((r ->> 'container_id')::uuid, 60, pg_temp.c('consent'));
  perform pg_temp.put('l7', r ->> 'link_id');
  perform pg_temp.check((r ->> 'expires_at')::timestamptz = pg_temp.utc(current_date + 230), 'oral-only: 30 days after the oral exam', r);
  update public.exams set exam_date = current_date + 300 where id = '91170000-0000-4000-8000-0000000000e7';
  perform pg_temp.check(pg_temp.link_end('l7') = pg_temp.utc(current_date + 330), 'the oral exam moved: the link follows',
                        to_jsonb(pg_temp.link_end('l7')));
end
$t$;

-- 13. A deleted exam closes the oral shares of its links (review of 04.11): the links, and with them the list that keeps
--     a share for the exam's members, go with the exam; an oral exam taken out of it stays, and so would its share.
select pg_temp.as_role('postgres');
insert into public.exams (id, user_id, title, exam_date) values
  ('91170000-0000-4000-8000-0000000000e8', '91170000-0000-4000-8000-00000000000a', 'Сети к удалению', current_date + 10),
  ('91170000-0000-4000-8000-0000000000e9', '91170000-0000-4000-8000-00000000000a', 'ОС к удалению', current_date + 10);
insert into public.exam_questions (exam_id, user_id, position, text) values
  ('91170000-0000-4000-8000-0000000000e8', '91170000-0000-4000-8000-00000000000a', 1, 'Модель OSI'),
  ('91170000-0000-4000-8000-0000000000e9', '91170000-0000-4000-8000-00000000000a', 1, 'Планировщик');
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
do $t$
declare r jsonb;
begin
  r := public.container_create('К удалению', current_date + 10, jsonb_build_array(
         jsonb_build_object('title', 'Сети', 'exam_id', '91170000-0000-4000-8000-0000000000e8'),
         jsonb_build_object('title', 'ОС', 'exam_id', '91170000-0000-4000-8000-0000000000e9')));
  perform pg_temp.put('c6', r ->> 'container_id');
  perform pg_temp.put('s6_os', r -> 'subjects' -> 1 ->> 'id');
  r := public.container_link_create((r ->> 'container_id')::uuid, 60, pg_temp.c('consent'));
  perform pg_temp.put('code_c6', r ->> 'code');
end
$t$;
select pg_temp.as_role('authenticated', pg_temp.c('q')::uuid);
select pg_temp.check((public.container_join(pg_temp.c('code_c6')) ->> 'joined')::boolean, 'Q joins «К удалению»');
select pg_temp.put('code_c6_os', (select x ->> 'code' from jsonb_array_elements(public.container_oral_codes(pg_temp.c('c6')::uuid) -> 'subjects') x
                                   where x ->> 'subject_id' = pg_temp.c('s6_os')));
select pg_temp.check((public.container_leave(pg_temp.c('c6')::uuid) ->> 'left')::boolean, 'Q leaves');
select pg_temp.as_role('authenticated', pg_temp.c('a')::uuid);
delete from public.container_subjects where id = pg_temp.c('s6_os')::uuid;
delete from public.containers where id = pg_temp.c('c6')::uuid;
select pg_temp.check(pg_temp.exam_day('91170000-0000-4000-8000-0000000000e9') is not null, '«ОС», taken out before, stays an exam');
select pg_temp.as_role('authenticated', pg_temp.c('s')::uuid);
select pg_temp.expect_error(format('select public.exam_share_claim(%L)', pg_temp.c('code_c6_os')), 'MS002', 'the deleted exam''s oral code claims nothing');
select pg_temp.expect_error(format('select public.exam_share_bundle(%L)', pg_temp.c('code_c6_os')), 'MS002', 'and gives no bundle');
select pg_temp.check(public.exam_share_preview(pg_temp.c('code_c6_os')) = '{"status": "revoked"}'::jsonb, 'its preview: closed',
                     public.exam_share_preview(pg_temp.c('code_c6_os')));

select pg_temp.as_role('postgres');
\echo GROUP LINK LIFE CHECKS PASSED
rollback;
