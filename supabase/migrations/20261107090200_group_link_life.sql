-- group_link_life (a group link lives as long as its exam; a moved exam takes its links and its members' oral dates along)
-- Repo file: supabase/migrations/20261107090200_group_link_life.sql. Base: the live order up to
-- 20261107090100_group_link_restore.sql. The functions it replaces are their latest bodies: container_link_create,
-- container_link_preview and container_subjects_guard of 20261009093500_containers.sql, exam_date_move_for of
-- 20261018120000_exam_move_bot_exams.sql, exam_share_claim and exam_share_bundle of 20261007110403_exam_shares.sql.
-- Rollback: supabase/rollback/20261107090200_group_link_life_down.sql. Check after the apply (read-only, catalog only):
-- supabase/tests/group_link_life.sql. Local rehearsal (never live): supabase/tests/local/group_link_life_run.sh (with
-- group_link_life_behaviour.sql and the lock check group_link_life_locks.sh).
--
-- Why (owner, 2026-11-04: «ссылка истекает, хотя не должна, и потом люди не могут продлить / продолжить экзамен»):
--   * a link ended two days after the exam's last date and nothing ever moved that end: «Перенести экзамен» left the
--     link of a moved exam to die at the old date, and with it the oral shares made from it (no new member, no rejoin
--     after leaving, no oral copy for a member who had none yet);
--   * once a link was closed or had expired nothing could open it again, though its code was in the group's chat;
--   * the author's «Перенести экзамен» for everyone moved the author's oral exams but not the members' copies of them,
--     and an oral-only subject plans by its oral exam's date: for the members it stayed «Экзамен прошёл».
-- What this file does:
--   1. Dates. meldy_private.exam_date_in_range(): a trigger BEFORE INSERT OR UPDATE OF exam_date on public.containers
--      and public.container_subjects and BEFORE UPDATE OF exam_date on public.exams refuses a new date outside
--      2000-01-01..2100-12-31 (22023 «date»; infinity, a typo year, 300000-01-01 included). Only a date being written is
--      checked: a row that already holds one outside (written before this file) still takes every other write. Not a
--      CHECK constraint, even NOT VALID: PostgreSQL checks those on every update of the row, so such a row could no
--      longer be renamed or mapped. An exam's new row (a member's copy) is not checked: it carries its author's date.
--      meldy_private.link_date_end(container): the exam's last date + 30 days at 00:00 UTC, of the dates in that range
--      only (the exam's own, every subject's, every subject's oral exam's: an oral-only subject's date is its oral
--      exam's), at most now() + 760 days; null without a date.
--   2. public.container_link_create (replaced): a new link ends at the later of now + 120 days and link_date_end.
--   3. Moves. Trigger links_follow_date (meldy_private.links_follow_date) AFTER UPDATE OF exam_date on public.containers,
--      public.container_subjects and public.exams (an oral exam of the author's subject): whenever the exam's dates
--      change — «Перенести экзамен» for everyone (exam_date_move 'all', with or without a subject; the bot's too), the
--      dates of «Настройки», the oral exam's own page — every open link of the exam (not closed, not expired, with an
--      end) ends no earlier than link_date_end and never earlier than before; its open oral shares of the subjects there
--      are take the same end (a share the author closed on its own, or of an exam taken out of the exam, stays as it
--      is). A member's own date ('me') writes container_plans and moves no link. A subject added later moves no link
--      (container_subject_add holds the exam's row FOR UPDATE: see «Locks»); the next move or «Продлить» does.
--   4. public.container_link_extend(p_link_id) jsonb (new; authenticated; the link's author only). An open link ends
--      at the later of its end and the end of 2; its open shares of the subjects there are take it. A closed or expired
--      link opens again with that end, within the 10 open links of container_link_create (MC007), and its oral codes
--      change: its old shares are closed for good (members the author removed since kept their codes), it gets a new
--      oral_salt and new shares for the oral subjects there are (meldy_private.ensure_oral_shares), which reach the
--      current members only, through container_oral_codes. A member's copy stays theirs and bound. Returns {id,
--      container_id, expires_at, revoked_at: null, reopened}. Errors: 28000; MC001 not the caller's link; MC007.
--   5. public.container_link_preview (replaced): the author's own link says its state too (link: active | revoked |
--      expired | full), so /g/<code> does not promise the author that a closed link works. Nothing else changes.
--   6. public.exam_share_claim and public.exam_share_bundle (replaced): a share in a link's oral_share_ids takes the
--      members of that link's exam only (MS001 for anyone else, after the copy a caller already has); an ordinary
--      share of an oral exam (/join, in no link) is as before.
--   7. Copies. Trigger copies_follow_date (meldy_private.copies_follow_date) AFTER UPDATE OF exam_date on public.exams:
--      when the author's oral exam of a subject gets a new date from today to today + 730 days, the bound copy of each
--      member still in the exam (not left, not removed) follows it — when it still had the old date and its member never
--      set it themselves. public.container_member_exams.follows_author (new, default true) turns false for good when a
--      member writes the date of their own copy. A member's own date of the exam still wins in every read.
-- Locks. A first container_join holds its link row FOR UPDATE and then takes the exam's row FOR KEY SHARE (the foreign
-- key of its member row). Every writer here that holds the exam's row while it writes links takes it FOR NO KEY UPDATE,
-- which that does not block: container_link_extend, exam_date_move's core (meldy_private.exam_date_move_for) and
-- public.container_subjects_guard (a subject's date in «Настройки»), the last two replaced for that one word (they took
-- it FOR UPDATE, and a move for everyone beside a first join deadlocked; review of 04.11). Then the links, then their
-- shares, then the members' copies. container_link_create keeps FOR UPDATE: it writes no existing link.
-- Re-runnable: CREATE OR REPLACE (the replaced functions keep their grants), CREATE OR REPLACE TRIGGER, ADD COLUMN IF NOT
-- EXISTS; the grants of the new functions are explicit at the end.

set local lock_timeout = '2s';

do $do$
begin
  if pg_catalog.to_regprocedure('public.container_link_create(uuid, integer, text)') is null
     or pg_catalog.to_regprocedure('meldy_private.ensure_oral_shares(uuid)') is null
     or pg_catalog.to_regprocedure('meldy_private.exam_date_move_for(uuid, uuid, date, text, uuid, date)') is null
     or pg_catalog.to_regprocedure('public.exam_share_claim(text)') is null then
    raise exception 'the base is expected: 20261007110403_exam_shares.sql, 20261009093500_containers.sql and 20261018120000_exam_move_bot_exams.sql';
  end if;
end;
$do$;

-- 1. Dates: what may be written, and the end a link takes from them.
create or replace function meldy_private.exam_date_in_range()
returns trigger
language plpgsql
volatile
set search_path = ''
as $fn$
begin
  if new.exam_date is null then
    return new;
  end if;
  if tg_op = 'UPDATE' then
    if new.exam_date is not distinct from old.exam_date then
      return new;
    end if;
  end if;
  if not (new.exam_date between date '2000-01-01' and date '2100-12-31') then
    raise exception 'date' using errcode = '22023';
  end if;
  return new;
end;
$fn$;
comment on function meldy_private.exam_date_in_range() is
  'BEFORE a date of an exam is written: 2000-01-01..2100-12-31 or none (22023). A date already there is not checked.';

create or replace trigger exam_date_in_range
  before insert or update of exam_date on public.containers
  for each row execute function meldy_private.exam_date_in_range();
create or replace trigger exam_date_in_range
  before insert or update of exam_date on public.container_subjects
  for each row execute function meldy_private.exam_date_in_range();
create or replace trigger exam_date_in_range
  before update of exam_date on public.exams
  for each row execute function meldy_private.exam_date_in_range();

create or replace function meldy_private.link_date_end(p_container_id uuid)
returns timestamptz
language sql
stable
set search_path = ''
as $fn$
  select case when pg_catalog.max(x.d) is not null
              then least((pg_catalog.max(x.d) + 30)::timestamp at time zone 'utc', pg_catalog.now() + interval '760 days') end
    from (select c.exam_date as d from public.containers c where c.id = p_container_id
          union all
          select s.exam_date from public.container_subjects s where s.container_id = p_container_id
          union all
          select e.exam_date from public.container_subjects s
            join public.exams e on e.id = s.exam_id and e.user_id = s.owner_id
           where s.container_id = p_container_id) x
   where x.d between date '2000-01-01' and date '2100-12-31'
$fn$;
comment on function meldy_private.link_date_end(uuid) is
  'The exam''s last date (its own, every subject''s, every subject''s oral exam''s; 2000..2100 only) + 30 days at 00:00 UTC, at most now() + 760 days; null without a date. A group link lives at least that long.';

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

-- 3. The exam's dates changed: its open links (and their open oral shares) live at least 30 days past the last date.
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
  if new.exam_date is null or new.exam_date is not distinct from old.exam_date then
    return null;
  end if;
  if tg_table_name = 'containers' then
    v_container := new.id;
  elsif tg_table_name = 'container_subjects' then
    v_container := new.container_id;
  else
    -- An oral exam: the exam it is a subject of, when it is its author's (container_subjects.exam_id is unique).
    select s.container_id into v_container from public.container_subjects s
     where s.exam_id = new.id and s.owner_id = new.user_id;
  end if;
  if v_container is null then
    return null;
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
   where sh.id = any (g.oral_share_ids) and sh.owner_id = g.owner_id and sh.revoked_at is null
     and sh.expires_at is not null and sh.expires_at < g.expires_at
     and sh.exam_id in (select s.exam_id from public.container_subjects s
                         where s.container_id = v_container and s.exam_id is not null);
  return null;
end;
$fn$;
comment on function meldy_private.links_follow_date() is
  'AFTER a date of an exam (containers, container_subjects, a subject''s oral exam) changes: its open links and their open oral shares end no earlier than link_date_end.';

create or replace trigger links_follow_date
  after update of exam_date on public.containers
  for each row execute function meldy_private.links_follow_date();
create or replace trigger links_follow_date
  after update of exam_date on public.container_subjects
  for each row execute function meldy_private.links_follow_date();
create or replace trigger links_follow_date
  after update of exam_date on public.exams
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
  -- The exam's row first, FOR NO KEY UPDATE (see «Locks»; container_link_create counts the open links under its own
  -- FOR UPDATE, which this mode waits for), then the link.
  perform 1 from public.containers c where c.id = v_link.container_id and c.owner_id = v_user for no key update;
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
  if v_open then
    update public.container_links l
       set expires_at = case when l.expires_at is null then null else greatest(l.expires_at, v_end) end
     where l.id = p_link_id
    returning l.* into v_link;
    -- Its open shares of the subjects there are take its end; one the author closed on its own stays closed.
    update public.exam_shares sh set expires_at = v_link.expires_at
     where sh.id = any (v_link.oral_share_ids) and sh.owner_id = v_user and sh.revoked_at is null
       and sh.exam_id in (select s.exam_id from public.container_subjects s
                           where s.container_id = v_link.container_id and s.exam_id is not null);
  else
    -- Open again: the old oral codes are dead for good (members the author removed since kept them); new ones come
    -- from a new salt, for the oral subjects there are, to the current members through container_oral_codes.
    update public.exam_shares sh set revoked_at = coalesce(sh.revoked_at, pg_catalog.now())
     where sh.id = any (v_link.oral_share_ids) and sh.owner_id = v_user;
    update public.container_links l
       set revoked_at = null,
           expires_at = greatest(coalesce(l.expires_at, v_end), v_end),
           oral_salt = pg_catalog.md5(meldy_private.random_code() || pg_catalog.clock_timestamp()::text
                                      || pg_catalog.gen_random_uuid()::text),
           oral_share_ids = '{}'::uuid[]
     where l.id = p_link_id
    returning l.* into v_link;
    perform meldy_private.ensure_oral_shares(p_link_id);
  end if;
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

-- 6. A container's oral share takes that container's members only.
-- 6a. exam_share_claim (20261007110403_exam_shares.sql): + the members' check.
create or replace function public.exam_share_claim(p_code text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_share public.exam_shares%rowtype;
  v_member public.exam_share_members%rowtype;
  v_member_found boolean;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    raise exception 'no such link' using errcode = 'MS001';
  end if;
  select s.* into v_share
    from public.exam_shares s
   where s.code_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_code, 'UTF8')), 'hex')
     for update;
  if not found then
    raise exception 'no such link' using errcode = 'MS001';
  end if;
  if v_share.owner_id = v_user then
    raise exception 'the author''s own link' using errcode = 'MS005';
  end if;
  select m.* into v_member from public.exam_share_members m where m.share_id = v_share.id and m.user_id = v_user;
  v_member_found := found;
  if v_member_found and v_member.member_exam_id is not null
     and exists (select 1 from public.exams e where e.id = v_member.member_exam_id and e.user_id = v_user) then
    return pg_catalog.jsonb_build_object('share_id', v_share.id, 'exam_id', v_member.member_exam_id);
  end if;
  -- A share a group link made for its exam's oral subject (container_links.oral_share_ids) takes that exam's members
  -- only (20261107090200): its code reached them through container_oral_codes, and one the author removed keeps it.
  -- An ordinary share of an oral exam (/join) is in no link and takes anyone with its code, as before.
  if exists (select 1 from public.container_links l where v_share.id = any (l.oral_share_ids))
     and not exists (select 1 from public.container_links l
                      where v_share.id = any (l.oral_share_ids)
                        and meldy_private.role_in(v_user, l.container_id) = 'member') then
    raise exception 'no such link' using errcode = 'MS001';
  end if;
  if v_share.revoked_at is not null then
    raise exception 'the link is revoked' using errcode = 'MS002';
  end if;
  if v_share.expires_at is not null and v_share.expires_at <= pg_catalog.now() then
    raise exception 'the link has expired' using errcode = 'MS003';
  end if;
  if not v_member_found then
    if (select pg_catalog.count(*) from public.exam_share_members m where m.share_id = v_share.id) >= v_share.max_members then
      raise exception 'no seat left' using errcode = 'MS004';
    end if;
    insert into public.exam_share_members (share_id, user_id) values (v_share.id, v_user);
    update public.exam_shares set members = members + 1 where id = v_share.id;
  end if;
  return pg_catalog.jsonb_build_object('share_id', v_share.id);
end;
$fn$;

-- 6b. exam_share_bundle (20261007110403_exam_shares.sql): + the members' check.
create or replace function public.exam_share_bundle(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_share public.exam_shares%rowtype;
  v_member_exam uuid;
  v_member boolean := false;
  v_links uuid[];
  v_hashes text[];
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    raise exception 'no such link' using errcode = 'MS001';
  end if;
  select s.* into v_share
    from public.exam_shares s
   where s.code_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_code, 'UTF8')), 'hex');
  if not found then
    raise exception 'no such link' using errcode = 'MS001';
  end if;
  if v_share.owner_id = v_user then
    raise exception 'the author''s own link' using errcode = 'MS005';
  end if;
  select m.member_exam_id into v_member_exam
    from public.exam_share_members m
   where m.share_id = v_share.id and m.user_id = v_user;
  v_member := found;
  if v_member_exam is not null
     and exists (select 1 from public.exams e where e.id = v_member_exam and e.user_id = v_user) then
    -- The classmate's own copy, already made: its id only.
    return pg_catalog.jsonb_build_object('v', 1, 'joined', pg_catalog.jsonb_build_object('exam_id', v_member_exam));
  end if;
  -- A share a group link made for its exam's oral subject (container_links.oral_share_ids) takes that exam's members
  -- only (20261107090200): its code reached them through container_oral_codes, and one the author removed keeps it.
  -- An ordinary share of an oral exam (/join) is in no link and takes anyone with its code, as before.
  if exists (select 1 from public.container_links l where v_share.id = any (l.oral_share_ids))
     and not exists (select 1 from public.container_links l
                      where v_share.id = any (l.oral_share_ids)
                        and meldy_private.role_in(v_user, l.container_id) = 'member') then
    raise exception 'no such link' using errcode = 'MS001';
  end if;
  if v_share.revoked_at is not null then
    raise exception 'the link is revoked' using errcode = 'MS002';
  end if;
  if v_share.expires_at is not null and v_share.expires_at <= pg_catalog.now() then
    raise exception 'the link has expired' using errcode = 'MS003';
  end if;
  if not v_member
     and (select pg_catalog.count(*) from public.exam_share_members m where m.share_id = v_share.id) >= v_share.max_members then
    raise exception 'no seat left' using errcode = 'MS004';
  end if;
  if not exists (select 1 from public.exams e where e.id = v_share.exam_id and e.user_id = v_share.owner_id) then
    raise exception 'no such link' using errcode = 'MS001';
  end if;

  select coalesce(pg_catalog.array_agg(l.material_id order by l.added_at, l.material_id), '{}'::uuid[]) into v_links
    from public.exam_materials l
    join public.materials m on m.id = l.material_id and m.user_id = v_share.owner_id
   where l.exam_id = v_share.exam_id;
  select coalesce(pg_catalog.array_agg(distinct q.question_hash), '{}'::text[]) into v_hashes
    from public.exam_questions q
   where q.exam_id = v_share.exam_id and q.user_id = v_share.owner_id and q.question_hash is not null;

  return pg_catalog.jsonb_build_object(
    'v', 1,
    'exam', (
      select pg_catalog.jsonb_build_object(
               'title', e.title, 'kind', e.kind, 'exam_date', e.exam_date, 'source_kind', e.source_kind,
               'source_text', e.source_text, 'ticket_layout', e.ticket_layout, 'mapping_state', e.mapping_state,
               'mapping_started_at', e.mapping_started_at, 'mapped_at', e.mapped_at,
               'mapped_material_ids', pg_catalog.to_jsonb(e.mapped_material_ids))
        from public.exams e
       where e.id = v_share.exam_id),
    -- The lectures in the order they were added (the order of backend oral_api._exam_material_ids).
    'links', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('material_id', l.material_id)
                                           order by l.added_at, l.material_id), '[]'::jsonb)
        from public.exam_materials l
       where l.exam_id = v_share.exam_id and l.material_id = any (v_links)),
    'materials', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'id', m.id, 'title', m.title, 'subject', m.subject, 'original_text', m.original_text)
                      order by pg_catalog.array_position(v_links, m.id)), '[]'::jsonb)
        from public.materials m
       where m.id = any (v_links) and m.user_id = v_share.owner_id),
    'questions', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'id', q.id, 'position', q.position, 'label', q.label, 'section', q.section, 'text', q.text,
                        'question_hash', q.question_hash, 'coverage', q.coverage, 'coverage_method', q.coverage_method,
                        'coverage_reason', q.coverage_reason, 'missing_note', q.missing_note, 'evidence', q.evidence,
                        'nearest', q.nearest, 'materials_fingerprint', q.materials_fingerprint,
                        'mapping_version', q.mapping_version, 'mapped_at', q.mapped_at)
                      order by q.position, q.created_at, q.id), '[]'::jsonb)
        from public.exam_questions q
       where q.exam_id = v_share.exam_id and q.user_id = v_share.owner_id),
    -- Answer points of these questions built only from these lectures (an answer key of the same question in
    -- another exam, with other lectures, stays with the author). source_key is the author's: the backend picks the
    -- current one by oral.rubric_key and computes the copy's own.
    'rubrics', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'question_hash', r.question_hash, 'source_key', r.source_key,
                        'rubric_version', r.rubric_version, 'material_ids', pg_catalog.to_jsonb(r.material_ids),
                        'rubric', r.rubric, 'created_at', r.created_at, 'sheet', r.sheet)
                      order by r.question_hash, r.source_key, r.rubric_version), '[]'::jsonb)
        from public.oral_rubrics r
       where r.user_id = v_share.owner_id
         and r.question_hash = any (v_hashes)
         and r.material_id = any (v_links)
         and r.material_ids <@ v_links),
    'failures', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                        'question_hash', f.question_hash, 'source_key', f.source_key,
                        'rubric_version', f.rubric_version, 'failed_at', f.failed_at)
                      order by f.question_hash, f.source_key), '[]'::jsonb)
        from public.oral_rubric_failures f
       where f.user_id = v_share.owner_id and f.question_hash = any (v_hashes)));
end;
$fn$;

-- 7. The lock of the exam's row, FOR NO KEY UPDATE (see «Locks»).
-- 7a. container_subjects_guard (20261009093500_containers.sql).
create or replace function public.container_subjects_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_owner uuid;
begin
  -- FOR NO KEY UPDATE (20261107090200; it was FOR UPDATE): the subjects are counted under it as before, and a first
  -- container_join's foreign key check (FOR KEY SHARE of the exam's row) is not blocked by it.
  select c.owner_id into v_owner from public.containers c where c.id = new.container_id for no key update;
  if v_owner is null or v_owner is distinct from new.owner_id then
    raise exception 'not the container''s owner' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.container_id is distinct from old.container_id then
    raise exception 'a subject does not move to another container' using errcode = '22023';
  end if;
  if tg_op = 'INSERT' and (select pg_catalog.count(*) from public.container_subjects s
                            where s.container_id = new.container_id) >= 20 then
    raise exception 'at most 20 subjects' using errcode = 'MC007';
  end if;
  if new.exam_id is not null and (tg_op = 'INSERT' or new.exam_id is distinct from old.exam_id)
     and not exists (select 1 from public.exams e where e.id = new.exam_id and e.user_id = new.owner_id) then
    raise exception 'not the owner''s exam' using errcode = '42501';
  end if;
  return new;
end;
$fn$;

-- 7b. meldy_private.exam_date_move_for (20261018120000_exam_move_bot_exams.sql).
create or replace function meldy_private.exam_date_move_for(p_user uuid, p_container_id uuid, p_date date, p_for text,
                                                           p_subject_id uuid, p_today date)
returns jsonb
language plpgsql
volatile
set search_path = ''
as $fn$
declare
  v_c public.containers%rowtype;
  v_role text;
  v_oral uuid;
  v_own date;
begin
  if p_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_for is null or p_for not in ('all', 'me') then
    raise exception 'for' using errcode = '22023';
  end if;
  if p_today is null or (p_date is null and p_for <> 'me')
     or (p_date is not null and (p_date < p_today or p_date > p_today + 730)) then
    raise exception 'date' using errcode = '22023';
  end if;
  v_role := meldy_private.role_in(p_user, p_container_id);
  if v_role is null then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  -- One move of an exam at a time (two tabs, the site and the bot): the exam's row is the lock, FOR NO KEY UPDATE
  -- (20261107090200; it was FOR UPDATE): a move now extends the exam's links, and a first container_join holds its link
  -- and then takes this row FOR KEY SHARE through the foreign key, which this mode does not block.
  select c.* into v_c from public.containers c where c.id = p_container_id for no key update;
  if v_c.id is null then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  if p_subject_id is not null and not exists (select 1 from public.container_subjects s
                                               where s.id = p_subject_id and s.container_id = p_container_id) then
    raise exception 'subject not found' using errcode = 'P0002';
  end if;
  if p_for = 'all' then
    if v_role <> 'owner' then
      raise exception 'only the author moves the exam for everyone' using errcode = '42501';
    end if;
    if p_subject_id is not null then
      -- One subject: its date, and its oral exam's (the site's updateSubject writes both).
      update public.container_subjects s set exam_date = p_date where s.id = p_subject_id returning s.exam_id into v_oral;
      if v_oral is not null then
        update public.exams e set exam_date = p_date where e.id = v_oral;
      end if;
    else
      update public.containers c set exam_date = p_date where c.id = p_container_id;
      -- The oral exams of the subjects that follow the exam's date, when their own date has passed.
      update public.exams e set exam_date = p_date
       where e.id in (select s.exam_id from public.container_subjects s
                       where s.container_id = p_container_id and s.exam_id is not null and s.exam_date is null)
         and e.exam_date <= p_today;
      -- The subjects whose own date has passed (today included) move with the exam, and their oral exams too; a
      -- subject's date still ahead stays.
      update public.exams e set exam_date = p_date
       where e.id in (select s.exam_id from public.container_subjects s
                       where s.container_id = p_container_id and s.exam_id is not null and s.exam_date <= p_today);
      update public.container_subjects s set exam_date = p_date
       where s.container_id = p_container_id and s.exam_date <= p_today;
    end if;
  else
    -- Only for this user: their own row of the exam (as the plan settings are written: the defaults when missing).
    insert into public.container_plans (user_id, container_id, own_exam_date)
    values (p_user, p_container_id, p_date)
    on conflict (user_id, container_id) do update set own_exam_date = excluded.own_exam_date, updated_at = pg_catalog.now();
  end if;
  select c.* into v_c from public.containers c where c.id = p_container_id;
  select p.own_exam_date into v_own from public.container_plans p where p.user_id = p_user and p.container_id = p_container_id;
  return pg_catalog.jsonb_build_object(
    'for', p_for, 'container_id', v_c.id, 'exam_date', v_c.exam_date, 'own_exam_date', v_own,
    'subjects', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                            'id', s.id, 'exam_date', coalesce(v_own, s.exam_date, v_c.exam_date))
                            order by s.position, s.created_at, s.id)
                            from public.container_subjects s where s.container_id = p_container_id), '[]'::jsonb));
end;
$fn$;


-- 8. The author's oral exam of a subject got another date: the members' copies that still follow it take it.
alter table public.container_member_exams add column if not exists follows_author boolean not null default true;
comment on column public.container_member_exams.follows_author is
  'The copy''s date follows the author''s oral exam (copies_follow_date) until its member writes it themselves.';

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
  -- A member wrote the date of their own copy: it keeps it from now on (a copy the author's move writes is written as
  -- the author, never as its member).
  if auth.uid() is not distinct from new.user_id then
    update public.container_member_exams me set follows_author = false
     where me.exam_id = new.id and me.user_id = new.user_id and me.follows_author;
  end if;
  -- Only a date a move gives (today to two years ahead) goes on, and only to the members still in the exam.
  if new.exam_date is null or new.exam_date not between current_date and current_date + 730 then
    return null;
  end if;
  update public.exams e set exam_date = new.exam_date
    from public.container_subjects s
    join public.container_member_exams me on me.subject_id = s.id and me.follows_author
    join public.container_members m on m.container_id = s.container_id and m.user_id = me.user_id
                                   and m.left_at is null and m.removed_at is null
   where s.exam_id = new.id and s.owner_id = new.user_id
     and e.id = me.exam_id and e.user_id = me.user_id and e.id <> new.id
     and e.exam_date is not distinct from old.exam_date;
  return null;
end;
$fn$;
comment on function meldy_private.copies_follow_date() is
  'AFTER the author''s oral exam of a container subject gets a date from today to +730 days: the bound copies of the members still in the exam that follow it and still had the old date take the new one; a member''s own write of their copy''s date stops it following.';

create or replace trigger copies_follow_date
  after update of exam_date on public.exams
  for each row execute function meldy_private.copies_follow_date();

-- 9. Grants. PostgreSQL gives PUBLIC EXECUTE on a new function and Supabase's default privileges give anon and
--    authenticated more: taken back here. The new RPC runs for authenticated; the helper and the trigger functions for
--    their owner only. CREATE OR REPLACE kept the grants of the six replaced functions.
revoke all on function meldy_private.link_date_end(uuid), meldy_private.links_follow_date(),
  meldy_private.copies_follow_date(), meldy_private.exam_date_in_range(), public.container_link_extend(uuid)
  from public;
do $do$
begin
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'anon') then
    revoke all on function meldy_private.link_date_end(uuid), meldy_private.links_follow_date(),
      meldy_private.copies_follow_date(), meldy_private.exam_date_in_range(), public.container_link_extend(uuid)
      from anon;
    revoke all on function meldy_private.link_date_end(uuid), meldy_private.links_follow_date(),
      meldy_private.copies_follow_date(), meldy_private.exam_date_in_range()
      from authenticated;
    grant execute on function public.container_link_extend(uuid) to authenticated;
  end if;
  if exists (select 1 from pg_catalog.pg_roles where rolname = 'service_role') then
    revoke all on function meldy_private.link_date_end(uuid), meldy_private.links_follow_date(),
      meldy_private.copies_follow_date(), meldy_private.exam_date_in_range()
      from service_role;
  end if;
end;
$do$;
