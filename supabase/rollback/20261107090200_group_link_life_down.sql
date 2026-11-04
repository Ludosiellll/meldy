-- Rollback of supabase/migrations/20261107090200_group_link_life.sql: its triggers and their functions, the helpers,
-- container_link_extend and container_member_exams.follows_author go; container_link_create, container_link_preview,
-- container_subjects_guard, exam_date_move_for, exam_share_claim, exam_share_bundle, exam_share_preview and
-- take_container_orals get their bodies of 20261009093500_containers.sql, 20261018120000_exam_move_bot_exams.sql,
-- 20261007110403_exam_shares.sql and 20261107090000_container_orals_go.sql back (a new link then ends two days after the
-- exam's last date again; dates are not range-checked; a container's oral share takes anyone with its code; a deleted
-- exam leaves its links' shares as they are). CREATE OR REPLACE keeps their grants. Links extended or opened again,
-- shares closed by a reopen or a delete, and copies whose dates followed the author's keep what they got. Re-runnable.
set local lock_timeout = '2s';

drop trigger if exists links_follow_date on public.containers;
drop trigger if exists links_follow_date on public.container_subjects;
drop trigger if exists links_follow_date on public.exams;
drop trigger if exists copies_follow_date on public.exams;
drop trigger if exists exam_date_in_range on public.containers;
drop trigger if exists exam_date_in_range on public.container_subjects;
drop trigger if exists exam_date_in_range on public.exams;
drop function if exists meldy_private.links_follow_date();
drop function if exists meldy_private.copies_follow_date();
drop function if exists meldy_private.exam_date_in_range();
drop function if exists public.container_link_extend(uuid);
alter table public.container_member_exams drop column if exists follows_author;

-- container_link_create (20261009093500_containers.sql).
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
  v_last date;
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
  select pg_catalog.max(d) into v_last
    from (select v_c.exam_date as d union all
          select s.exam_date from public.container_subjects s where s.container_id = p_container_id) x;
  insert into public.container_links (container_id, owner_id, code_hash, oral_salt, consent, max_members, expires_at)
  values (p_container_id, v_user, meldy_private.code_hash(v_code),
          pg_catalog.md5(meldy_private.random_code() || pg_catalog.clock_timestamp()::text || pg_catalog.gen_random_uuid()::text),
          case when v_oral > 0 then pg_catalog.btrim(p_consent) end,
          least(greatest(coalesce(p_max_members, 60), 1), 200),
          case when v_last is not null and v_last + 2 > (pg_catalog.now() at time zone 'utc')::date
               then ((v_last + 2)::timestamp at time zone 'utc')
               else pg_catalog.now() + interval '120 days' end)
  returning id into v_link;
  v_shares := meldy_private.ensure_oral_shares(v_link);
  return pg_catalog.jsonb_build_object('link_id', v_link, 'code', v_code, 'path', '/g/' || v_code,
    'oral_subjects', pg_catalog.cardinality(v_shares),
    'expires_at', (select l.expires_at from public.container_links l where l.id = v_link));
end;
$fn$;

-- container_link_preview (20261009093500_containers.sql).
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
                                   where s.container_id = v_c.id and s.exam_id is not null));
end;
$fn$;

-- container_subjects_guard (20261009093500_containers.sql).
create or replace function public.container_subjects_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  v_owner uuid;
begin
  select c.owner_id into v_owner from public.containers c where c.id = new.container_id for update;
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

-- meldy_private.exam_date_move_for (20261018120000_exam_move_bot_exams.sql).
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
  -- One move of an exam at a time (two tabs, the site and the bot): the exam's row is the lock.
  select c.* into v_c from public.containers c where c.id = p_container_id for update;
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

-- exam_share_claim (20261007110403_exam_shares.sql).
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

-- exam_share_bundle (20261007110403_exam_shares.sql).
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

-- exam_share_preview (20261007110403_exam_shares.sql).
create or replace function public.exam_share_preview(p_code text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_share public.exam_shares%rowtype;
  v_exam public.exams%rowtype;
  v_member_exam uuid;
  v_member boolean := false;
  v_status text := 'active';
begin
  if p_code is null or p_code !~ '^[0-9a-hjkmnp-tv-z]{12}$' then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  select s.* into v_share
    from public.exam_shares s
   where s.code_hash = pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_code, 'UTF8')), 'hex');
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  select e.* into v_exam from public.exams e where e.id = v_share.exam_id and e.user_id = v_share.owner_id;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'not_found');
  end if;
  if v_user is not null and v_user = v_share.owner_id then
    v_status := 'own';
  else
    if v_user is not null then
      select m.member_exam_id into v_member_exam
        from public.exam_share_members m
       where m.share_id = v_share.id and m.user_id = v_user;
      v_member := found;
      if v_member_exam is not null
         and exists (select 1 from public.exams e where e.id = v_member_exam and e.user_id = v_user) then
        return pg_catalog.jsonb_build_object('status', 'joined', 'exam_id', v_member_exam, 'title', v_exam.title,
          'kind', v_exam.kind, 'exam_date', v_exam.exam_date);
      end if;
    end if;
    if v_share.revoked_at is not null then
      return pg_catalog.jsonb_build_object('status', 'revoked');
    end if;
    if v_share.expires_at is not null and v_share.expires_at <= pg_catalog.now() then
      return pg_catalog.jsonb_build_object('status', 'expired');
    end if;
    if not v_member
       and (select pg_catalog.count(*) from public.exam_share_members m where m.share_id = v_share.id) >= v_share.max_members then
      return pg_catalog.jsonb_build_object('status', 'full');
    end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'status', v_status,
    'exam_id', case when v_status = 'own' then v_exam.id end,
    'title', v_exam.title,
    'kind', v_exam.kind,
    'exam_date', v_exam.exam_date,
    'questions', (select pg_catalog.count(*) from public.exam_questions q where q.exam_id = v_exam.id),
    'lectures', (select pg_catalog.count(*)
                   from public.exam_materials l
                   join public.materials m on m.id = l.material_id and m.user_id = v_share.owner_id
                  where l.exam_id = v_exam.id and pg_catalog.btrim(m.original_text) <> ''));
end;
$fn$;

-- meldy_private.take_container_orals (20261107090000_container_orals_go.sql).
create or replace function meldy_private.take_container_orals()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  delete from public.exams e
   using public.container_subjects s
   where s.container_id = old.id
     and s.exam_id = e.id
     and e.user_id = old.owner_id;
  return old;
end;
$fn$;

drop function if exists meldy_private.link_date_end(uuid);
