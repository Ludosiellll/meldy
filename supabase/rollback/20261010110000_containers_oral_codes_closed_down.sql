-- Rollback of 20261010110000_containers_oral_codes_closed.sql: container_oral_codes as in 20261009093500_containers.sql
-- (a closed link lists no subjects).
create or replace function public.container_oral_codes(p_container_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_link public.container_links%rowtype;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if meldy_private.role_in(v_user, p_container_id) is distinct from 'member' then
    raise exception 'container not found' using errcode = 'P0002';
  end if;
  -- The member's own link while it is open, else the newest open link with the consent.
  select l.* into v_link from public.container_links l
    join public.container_members m on m.container_id = l.container_id and m.user_id = v_user
   where l.container_id = p_container_id and l.consent is not null and l.revoked_at is null
     and (l.expires_at is null or l.expires_at > pg_catalog.now())
   order by (l.id = m.link_id) desc, l.created_at desc
   limit 1;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'closed', 'subjects', '[]'::jsonb);
  end if;
  perform meldy_private.ensure_oral_shares(v_link.id);
  return pg_catalog.jsonb_build_object('status', 'open', 'subjects', coalesce((
    select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
             'subject_id', s.id, 'title', s.title,
             'code', meldy_private.oral_code(v_link.oral_salt, s.exam_id),
             'existing_exam_id', (select m.member_exam_id from public.exam_share_members m
                                    join public.exam_shares sh on sh.id = m.share_id
                                    join public.exams e on e.id = m.member_exam_id and e.user_id = v_user
                                   where sh.exam_id = s.exam_id and m.user_id = v_user
                                   order by m.joined_at desc limit 1))
             order by s.position, s.created_at)
      from public.container_subjects s
     where s.container_id = p_container_id and s.exam_id is not null
       and not exists (select 1 from public.container_member_exams me where me.subject_id = s.id and me.user_id = v_user)
       and exists (select 1 from public.exam_shares sh
                    where sh.code_hash = meldy_private.code_hash(meldy_private.oral_code(v_link.oral_salt, s.exam_id))
                      and sh.revoked_at is null)), '[]'::jsonb));
end;
$fn$;
