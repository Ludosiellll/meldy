-- Rollback of supabase/migrations/20261107090200_group_link_life.sql: the three triggers and their functions, the
-- helper and container_link_extend go; container_link_create and container_link_preview get their
-- 20261009093500_containers.sql bodies back (a new link then ends two days after the exam's last date again, the
-- author's own preview says nothing of the link's state). CREATE OR REPLACE keeps their grants. Links extended or
-- opened again, and copies whose dates followed the author's, keep what they got. Re-runnable.
set local lock_timeout = '2s';

drop trigger if exists links_follow_date on public.containers;
drop trigger if exists links_follow_date on public.container_subjects;
drop trigger if exists copies_follow_date on public.exams;
drop function if exists meldy_private.links_follow_date();
drop function if exists meldy_private.copies_follow_date();
drop function if exists public.container_link_extend(uuid);

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

drop function if exists meldy_private.link_date_end(uuid);
