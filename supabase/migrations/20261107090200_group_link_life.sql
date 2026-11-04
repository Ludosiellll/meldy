-- group_link_life (a group link lives as long as its exam; a moved exam takes its links and its members' oral dates along)
-- Repo file: supabase/migrations/20261107090200_group_link_life.sql. Base: the live order up to
-- 20261107090100_group_link_restore.sql (container_link_create and container_link_preview are their
-- 20261009093500_containers.sql bodies; nothing later replaced them).
-- Rollback: supabase/rollback/20261107090200_group_link_life_down.sql. Check after the apply (read-only, catalog only):
-- supabase/tests/group_link_life.sql. Local rehearsal (never live): supabase/tests/local/group_link_life_run.sh.
--
-- Why (owner, 2026-11-04: «ссылка истекает, хотя не должна, и потом люди не могут продлить / продолжить экзамен»):
--   * a link ended two days after the exam's last date and nothing ever moved that end: «Перенести экзамен» left the
--     link of a moved exam to die at the old date, and with it the oral shares made from it (no new member, no rejoin
--     after leaving, no oral copy for a member who had none yet);
--   * once a link was closed or had expired nothing could open it again, though its code was in the group's chat;
--   * the author's «Перенести экзамен» for everyone moved the author's oral exams but not the members' copies of them,
--     and an oral-only subject plans by its oral exam's date: for the members it stayed «Экзамен прошёл».
-- What this file does:
--   1. meldy_private.link_date_end(container) — the exam's last date (the exam's own and every subject's) + 30 days, at
--      00:00 UTC; null without a date.
--   2. public.container_link_create (replaced, its 20261009093500 body): a new link ends at the later of now + 120 days
--      and link_date_end. Nothing else changes (it never closed the other links: the site did).
--   3. Triggers links_follow_date on public.containers (AFTER UPDATE OF exam_date) and public.container_subjects (AFTER
--      INSERT OR UPDATE OF exam_date), function meldy_private.links_follow_date(): whenever the exam's dates change — the
--      author's «Перенести экзамен» for everyone (exam_date_move 'all', with or without a subject; the bot's too) and the
--      dates of «Настройки» — every open link of the exam (not closed, not expired, with an end) ends no earlier than
--      link_date_end, never earlier than before; its oral shares (exam_shares in oral_share_ids) take the same end. A
--      member's own date ('me') writes container_plans and moves no link.
--   4. public.container_link_extend(p_link_id) jsonb (new; authenticated; the link's author only): an open link ends
--      at the later of its end and the end of 2; a closed or expired one opens again with that end (the 10 open links
--      of container_link_create still hold: MC007). Its oral shares take the same end and are open again. Returns
--      {id, container_id, expires_at, revoked_at: null, reopened}. Errors: 28000; MC001 not the caller's link; MC007.
--   5. public.container_link_preview (replaced, its 20261009093500 body): the author's own link says its state too
--      (link: active | revoked | expired | full), so /g/<code> does not promise the author that a closed link works.
--      Nothing changes for anyone else.
--   6. Trigger copies_follow_date on public.exams (AFTER UPDATE OF exam_date), function
--      meldy_private.copies_follow_date(): when the author's oral exam of a subject gets another date (exam_date_move
--      'all', «Настройки», the oral exam's own page), every member's bound copy of it that still has the old date takes
--      the new one. A copy whose date its member set otherwise keeps it; a member's own date of the exam still wins in
--      every read.
-- Re-runnable: CREATE OR REPLACE (the replaced functions keep their grants), CREATE OR REPLACE TRIGGER; the grants of
-- the new functions are explicit at the end. Locks: the exam's row before its links and their shares, as
-- container_link_create, exam_date_move and container_link_revoke take them.

set local lock_timeout = '2s';

do $do$
begin
  if pg_catalog.to_regprocedure('public.container_link_create(uuid, integer, text)') is null
     or pg_catalog.to_regprocedure('meldy_private.ensure_oral_shares(uuid)') is null
     or pg_catalog.to_regprocedure('meldy_private.exam_date_move_for(uuid, uuid, date, text, uuid, date)') is null then
    raise exception 'the base is expected: 20261009093500_containers.sql and 20261018120000_exam_move_bot_exams.sql';
  end if;
end;
$do$;

-- 1. The exam's last date + 30 days (00:00 UTC), null without a date.
create or replace function meldy_private.link_date_end(p_container_id uuid)
returns timestamptz
language sql
stable
set search_path = ''
as $fn$
  select ((pg_catalog.max(x.d) + 30)::timestamp at time zone 'utc')
    from (select c.exam_date as d from public.containers c where c.id = p_container_id
          union all
          select s.exam_date from public.container_subjects s where s.container_id = p_container_id) x
$fn$;
comment on function meldy_private.link_date_end(uuid) is
  'The exam''s last date (its own and every subject''s) + 30 days at 00:00 UTC; null without a date. A group link lives at least that long.';

-- 2. container_link_create (20261009093500_containers.sql): the new end; the rest as it was.
create or replace function public.container_link_create(p_container_id uuid, p_max_members integer default 60,
                                                        p_consent text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_c public.containers%rowtype;
  v_code text := meldy_private.random_code();
  v_link uuid;
  v_oral integer;
  v_shares uuid[];
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select c.* into v_c from public.containers c where c.id = p_container_id and c.owner_id = v_user for update;
  if not found then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  if (select pg_catalog.count(*) from public.container_links l
       where l.container_id = p_container_id and l.revoked_at is null
         and (l.expires_at is null or l.expires_at > pg_catalog.now())) >= 10 then
    raise exception 'at most 10 open links' using errcode = 'MC007';
  end if;
  if not exists (select 1 from public.test_items i where i.container_id = p_container_id and i.keyed)
     and not exists (select 1 from public.container_subjects s where s.container_id = p_container_id and s.exam_id is not null) then
    raise exception 'nothing to share yet' using errcode = '22023';
  end if;
  select pg_catalog.count(*) into v_oral
    from public.container_subjects s
   where s.container_id = p_container_id and s.exam_id is not null
     and not exists (select 1 from public.exam_share_members m where m.member_exam_id = s.exam_id);
  if v_oral > 0 and (p_consent is null or pg_catalog.char_length(pg_catalog.btrim(p_consent)) not between 20 and 400) then
    raise exception 'the oral subjects need the consent' using errcode = 'MC008';
  end if;
  -- The later of 120 days from now and 30 days after the exam's last date.
  insert into public.container_links (container_id, owner_id, code_hash, oral_salt, consent, max_members, expires_at)
  values (p_container_id, v_user, meldy_private.code_hash(v_code),
          pg_catalog.md5(meldy_private.random_code() || pg_catalog.clock_timestamp()::text || pg_catalog.gen_random_uuid()::text),
          case when v_oral > 0 then pg_catalog.btrim(p_consent) end,
          least(greatest(coalesce(p_max_members, 60), 1), 200),
          greatest(pg_catalog.now() + interval '120 days', meldy_private.link_date_end(p_container_id)))
  returning id into v_link;
  v_shares := meldy_private.ensure_oral_shares(v_link);
  return pg_catalog.jsonb_build_object('link_id', v_link, 'code', v_code, 'path', '/g/' || v_code,
    'oral_subjects', pg_catalog.cardinality(v_shares),
    'expires_at', (select l.expires_at from public.container_links l where l.id = v_link));
end;
$fn$;

-- 3. The exam's dates changed: its open links (and their oral shares) live at least 30 days past the last date.
create or replace function meldy_private.links_follow_date()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_container uuid;
  v_end timestamptz;
begin
  if new.exam_date is null then
    return null;
  end if;
  if tg_op = 'UPDATE' then
    if new.exam_date is not distinct from old.exam_date then
      return null;
    end if;
  end if;
  if tg_table_name = 'containers' then
    v_container := new.id;
  else
    v_container := new.container_id;
  end if;
  v_end := meldy_private.link_date_end(v_container);
  if v_end is null then
    return null;
  end if;
  with grown as (
    update public.container_links l set expires_at = v_end
     where l.container_id = v_container and l.revoked_at is null
       and l.expires_at is not null and l.expires_at > pg_catalog.now() and l.expires_at < v_end
    returning l.owner_id, l.oral_share_ids, l.expires_at)
  update public.exam_shares sh set expires_at = g.expires_at
    from grown g
   where sh.id = any (g.oral_share_ids) and sh.owner_id = g.owner_id
     and sh.expires_at is not null and sh.expires_at < g.expires_at;
  return null;
end;
$fn$;
comment on function meldy_private.links_follow_date() is
  'AFTER a date of an exam (containers, container_subjects) changes: its open links and their oral shares end no earlier than link_date_end.';

create or replace trigger links_follow_date
  after update of exam_date on public.containers
  for each row execute function meldy_private.links_follow_date();
create or replace trigger links_follow_date
  after insert or update of exam_date on public.container_subjects
  for each row execute function meldy_private.links_follow_date();

-- 4. The author extends a link, or opens a closed or expired one again (the code in the group's chat works again).
create or replace function public.container_link_extend(p_link_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_link public.container_links%rowtype;
  v_open boolean;
  v_end timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  select l.* into v_link from public.container_links l where l.id = p_link_id and l.owner_id = v_user;
  if not found then
    raise exception 'no such link' using errcode = 'MC001';
  end if;
  -- The exam's row first (container_link_create counts the open links under the same lock), then the link.
  perform 1 from public.containers c where c.id = v_link.container_id and c.owner_id = v_user for update;
  if not found then
    raise exception 'no such link' using errcode = 'MC001';
  end if;
  select l.* into v_link from public.container_links l where l.id = p_link_id for update;
  v_open := v_link.revoked_at is null and (v_link.expires_at is null or v_link.expires_at > pg_catalog.now());
  if not v_open and (select pg_catalog.count(*) from public.container_links l
                      where l.container_id = v_link.container_id and l.revoked_at is null
                        and (l.expires_at is null or l.expires_at > pg_catalog.now())) >= 10 then
    raise exception 'at most 10 open links' using errcode = 'MC007';
  end if;
  v_end := greatest(pg_catalog.now() + interval '120 days', meldy_private.link_date_end(v_link.container_id));
  update public.container_links l
     set revoked_at = null,
         expires_at = case when v_open and l.expires_at is null then null
                           else greatest(coalesce(l.expires_at, v_end), v_end) end
   where l.id = p_link_id
  returning l.* into v_link;
  update public.exam_shares sh set expires_at = v_link.expires_at, revoked_at = null
   where sh.id = any (v_link.oral_share_ids) and sh.owner_id = v_user;
  return pg_catalog.jsonb_build_object('id', v_link.id, 'container_id', v_link.container_id,
    'expires_at', v_link.expires_at, 'revoked_at', null, 'reopened', not v_open);
end;
$fn$;

-- 5. container_link_preview (20261009093500_containers.sql): + link (the state of the author's own link).
create or replace function public.container_link_preview(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_link public.container_links%rowtype;
  v_c public.containers%rowtype;
  v_m public.container_members%rowtype;
  v_status text := 'active';
begin
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  select l.* into v_link from public.container_links l where l.code_hash = meldy_private.code_hash(p_code);
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  select c.* into v_c from public.containers c where c.id = v_link.container_id;
  if v_user is not null and v_user = v_c.owner_id then
    v_status := 'own';
  elsif v_user is not null then
    select m.* into v_m from public.container_members m where m.container_id = v_c.id and m.user_id = v_user;
    if found and v_m.removed_at is not null then
      return pg_catalog.jsonb_build_object('status', 'removed');
    elsif found and v_m.left_at is null then
      v_status := 'joined';
    end if;
  end if;
  if v_status = 'active' then
    if v_link.revoked_at is not null then
      return pg_catalog.jsonb_build_object('status', 'revoked');
    elsif v_link.expires_at is not null and v_link.expires_at <= pg_catalog.now() then
      return pg_catalog.jsonb_build_object('status', 'expired');
    elsif v_link.members >= v_link.max_members
          and not exists (select 1 from public.container_members m where m.container_id = v_c.id and m.user_id = v_user) then
      return pg_catalog.jsonb_build_object('status', 'full');
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'status', v_status, 'container_id', case when v_status in ('own', 'joined') then v_c.id end,
    'title', v_c.title, 'exam_date', v_c.exam_date,
    'subjects', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                  'title', s.title,
                  'items', (select pg_catalog.count(*) from public.test_items i where i.subject_id = s.id and i.keyed),
                  'oral', s.exam_id is not null) order by s.position, s.created_at)
                  from public.container_subjects s where s.container_id = v_c.id), '[]'::jsonb),
    'needs_consent_text', exists (select 1 from public.container_subjects s
                                   where s.container_id = v_c.id and s.exam_id is not null))
    || case when v_status = 'own' then pg_catalog.jsonb_build_object('link',
         case when v_link.revoked_at is not null then 'revoked'
              when v_link.expires_at is not null and v_link.expires_at <= pg_catalog.now() then 'expired'
              when v_link.members >= v_link.max_members then 'full'
              else 'active' end)
       else '{}'::jsonb end;
end;
$fn$;

-- 6. The author's oral exam of a subject got another date: the members' copies that still had the old one follow.
create or replace function meldy_private.copies_follow_date()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  if new.exam_date is not distinct from old.exam_date then
    return null;
  end if;
  update public.exams e set exam_date = new.exam_date
    from public.container_subjects s
    join public.container_member_exams me on me.subject_id = s.id
   where s.exam_id = new.id and s.owner_id = new.user_id
     and e.id = me.exam_id and e.user_id = me.user_id and e.id <> new.id
     and e.exam_date is not distinct from old.exam_date;
  return null;
end;
$fn$;
comment on function meldy_private.copies_follow_date() is
  'AFTER the author''s oral exam of a container subject gets another date: the members'' bound copies that still had the old date take the new one.';

create or replace trigger copies_follow_date
  after update of exam_date on public.exams
  for each row execute function meldy_private.copies_follow_date();

-- 7. Grants. PostgreSQL gives PUBLIC EXECUTE on a new function and Supabase's default privileges give anon and
--    authenticated more: taken back here. The new RPC runs for authenticated; the helper and the trigger functions for
--    their owner only. CREATE OR REPLACE kept the grants of container_link_create and container_link_preview.
revoke all on function meldy_private.link_date_end(uuid), meldy_private.links_follow_date(),
  meldy_private.copies_follow_date(), public.container_link_extend(uuid)
  from public;
do $do$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    revoke all on function meldy_private.link_date_end(uuid), meldy_private.links_follow_date(),
      meldy_private.copies_follow_date(), public.container_link_extend(uuid)
      from anon;
    revoke all on function meldy_private.link_date_end(uuid), meldy_private.links_follow_date(),
      meldy_private.copies_follow_date()
      from authenticated;
    grant execute on function public.container_link_extend(uuid) to authenticated;
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    revoke all on function meldy_private.link_date_end(uuid), meldy_private.links_follow_date(),
      meldy_private.copies_follow_date()
      from service_role;
  end if;
end;
$do$;
