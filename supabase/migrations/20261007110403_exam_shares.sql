-- exam_shares
-- Repo file: supabase/migrations/20261007110403_exam_shares.sql. Applied 2026-10-07 through apply_migration (version
-- 20261007110403); the function bodies match this file (md5 of prosrc compared with a local apply). The seat binding
-- was tightened before the apply: a seat that has a copy cannot be pointed at another exam.
-- Rollback: supabase/rollback/20261007110403_exam_shares_down.sql. Contract check after the apply:
-- supabase/tests/exam_shares.sql. Local rehearsal: supabase/tests/local/exam_shares_behaviour.sql.
--
-- «Группа по ссылке» (notes: 10_Project/CodingFest_11_Improvement_Plan_2026-10-07, «Лента B — группа»): the author of
-- a ready exam makes a secret link; a classmate who opens it gets their OWN COPY of the exam — the department's
-- questions, the ticket layout, the mapping with its evidence, the text of the lectures (as «только текст») and the
-- answer points with their cheat-sheet lines. The copy costs the classmate no AI units and no model calls: the points
-- are already written and their keys are recomputed for the copied lecture ids (backend/exam_shares.py).
-- The owner decided on 2026-10-07 that lecture texts go into the copy; the author ticks a consent before the link is
-- made: «Делюсь с группой вопросами, текстом моих лекций и пунктами ответа. Мои ответы и прогресс никто не увидит».
-- The author's journal, answers and progress never leave: nothing here reads learning_events, exam_sessions,
-- mistake_diary or flashcard_progress.
--
-- A snapshot, not a shared exam: reading the author's rows through RLS would open five core tables and change
-- record_oral_attempt (q.user_id = v_user) and the rubric cache. The old groups / group_members tables are not used:
-- they carry the teachers' policies.
--
-- 1. exam_shares — one secret link of an exam. Only sha256(code) is stored (the 12-character code is shown to the
--    author once). max_members 80 by default; members counts the classmates who joined (written only by
--    exam_share_claim). RLS: the author reads and creates their own links (not for an exam that is itself a copy from a
--    link); there is no UPDATE or DELETE policy — a link is revoked through exam_share_revoke().
-- 2. exam_share_members — one row per (link, classmate): member_exam_id is the classmate's copy (SET NULL when they
--    delete it; joining again makes a new copy in the same seat). RLS: a classmate reads their own rows; rows are
--    written only by exam_share_claim / exam_share_bind.
-- 3. oral_rubric_failures — the answer points of (question_hash, source_key) did not pass the quote check twice
--    (POST /api/oral/rubric → 422 rubric_unverifiable; the backend writes the row with the user's token). Such a
--    question would hold the cheat sheet's to_write above 0 for ever, so a link may be made with it: it goes into the
--    copy without points, marked. RLS: own rows, read and insert.
-- 4. exam_share_preview(code) — DEFINER, for the signed-out invitation page /join/<code>: the status of the link and,
--    for a live one, the exam's title, kind, date and two counts. Nothing else.
-- 5. exam_share_bundle(code) — DEFINER, STABLE: the snapshot for backend/exam_shares.py, columns by a white list. It
--    checks auth.uid() itself (signed in, not the author, link not revoked or expired, a seat left). A classmate who
--    already has their copy gets only its id.
-- 6. exam_share_join(code, copy) — INVOKER: one transaction under the classmate's own token. It takes a seat
--    (exam_share_claim), inserts the copy prepared by the backend (every row is the classmate's own, so the existing
--    policies of materials, exams, exam_materials, exam_questions and oral_rubrics pass) and binds the seat to it
--    (exam_share_bind). Joining again returns the same copy.
-- 7. exam_share_claim / exam_share_bind / exam_share_revoke — DEFINER helpers with their own checks.
--
-- Every function protects itself (auth.uid(), the owner, the code) instead of relying on taken-back grants: the
-- Supabase connector holds REVOKE statements for a human. The optional hardening (REVOKE from anon, TRUNCATE) is in
-- supabase/migrations/20261007110457_exam_shares_revokes.sql for the owner. PostgREST cannot TRUNCATE, so the tables are safe
-- without it.
-- Errors (SQLSTATE → backend/exam_shares.py): 28000 not signed in; MS001 no such link; MS002 revoked; MS003 expired;
-- MS004 no seat left; MS005 the author's own link; MS006 a copy the database refuses (bad shape).
--
-- Additive and re-runnable: new tables (IF NOT EXISTS), policies created only when missing, CREATE OR REPLACE
-- functions, grants. Depends on 20261003083154_hackathon_journal_exams_oral.sql and 20261005143420_cheat_sheet.sql
-- (oral_rubrics.sheet), both live.

-- 1. Links.
create table if not exists public.exam_shares (
  id uuid primary key default gen_random_uuid(),
  exam_id uuid not null references public.exams(id) on delete cascade,
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  code_hash text not null,
  consent text not null,
  max_members integer not null default 80,
  members integer not null default 0,
  created_at timestamptz not null default now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  constraint exam_shares_code_hash_check check (code_hash ~ '^[0-9a-f]{64}$'),
  constraint exam_shares_code_hash_key unique (code_hash),
  constraint exam_shares_consent_check check (char_length(consent) between 20 and 400),
  constraint exam_shares_max_members_check check (max_members between 1 and 200),
  constraint exam_shares_members_check check (members >= 0),
  constraint exam_shares_expires_check check (expires_at is null or expires_at > created_at)
);
create index if not exists exam_shares_exam_idx on public.exam_shares (exam_id, created_at desc);
create index if not exists exam_shares_owner_idx on public.exam_shares (owner_id);

comment on table public.exam_shares is
  'Secret group links of an exam (only sha256 of the code). Read and created by the author; revoked by exam_share_revoke().';

-- 2. Classmates who joined.
create table if not exists public.exam_share_members (
  id uuid primary key default gen_random_uuid(),
  share_id uuid not null references public.exam_shares(id) on delete cascade,
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  member_exam_id uuid references public.exams(id) on delete set null,
  joined_at timestamptz not null default now(),
  constraint exam_share_members_unique unique (share_id, user_id)
);
create index if not exists exam_share_members_user_idx on public.exam_share_members (user_id);
create index if not exists exam_share_members_exam_idx on public.exam_share_members (member_exam_id);

comment on table public.exam_share_members is
  'One row per (link, classmate): member_exam_id is the classmate''s own copy. Written only by exam_share_claim/bind.';

-- 3. Answer points that did not pass the quote check.
create table if not exists public.oral_rubric_failures (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  question_hash text not null,
  source_key text not null,
  rubric_version smallint not null default 1,
  reason text not null default 'unverifiable',
  failed_at timestamptz not null default now(),
  constraint oral_rubric_failures_hash_check check (question_hash ~ '^[0-9a-f]{32}$'),
  constraint oral_rubric_failures_key_check check (char_length(source_key) between 8 and 128),
  constraint oral_rubric_failures_reason_check check (reason in ('unverifiable')),
  constraint oral_rubric_failures_unique unique (user_id, question_hash, source_key, rubric_version)
);

comment on table public.oral_rubric_failures is
  'Answer points of (question_hash, source_key) that failed the quote check twice (422 rubric_unverifiable).';

alter table public.exam_shares enable row level security;
alter table public.exam_share_members enable row level security;
alter table public.oral_rubric_failures enable row level security;
grant select, insert on table public.exam_shares to authenticated;
grant select on table public.exam_share_members to authenticated;
grant select, insert on table public.oral_rubric_failures to authenticated;

do $do$
begin
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'exam_shares' and policyname = 'Exam shares: read own') then
    create policy "Exam shares: read own" on public.exam_shares for select to authenticated
      using ((select auth.uid()) = owner_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'exam_shares' and policyname = 'Exam shares: create for own exam') then
    -- A fresh link of the author's own exam; not for an exam that is itself a copy from a group link (the
    -- classmate's subquery sees only their own member rows, which is exactly what is checked).
    create policy "Exam shares: create for own exam" on public.exam_shares for insert to authenticated
      with check (
        (select auth.uid()) = owner_id
        and revoked_at is null
        and members = 0
        and exists (select 1 from public.exams e where e.id = exam_id and e.user_id = (select auth.uid()))
        and not exists (select 1 from public.exam_share_members m where m.member_exam_id = exam_id)
      );
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'exam_share_members' and policyname = 'Exam share members: read own') then
    create policy "Exam share members: read own" on public.exam_share_members for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'oral_rubric_failures' and policyname = 'Oral rubric failures: read own') then
    create policy "Oral rubric failures: read own" on public.oral_rubric_failures for select to authenticated
      using ((select auth.uid()) = user_id);
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname = 'public'
                 and tablename = 'oral_rubric_failures' and policyname = 'Oral rubric failures: add own') then
    create policy "Oral rubric failures: add own" on public.oral_rubric_failures for insert to authenticated
      with check ((select auth.uid()) = user_id);
  end if;
end
$do$;

-- 4. The invitation page: what the link is, before signing in.
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

comment on function public.exam_share_preview(text) is
  'The invitation page of a group link: status (active|own|joined|revoked|expired|full|not_found) and, for a live link, the exam''s title, kind, date and counts.';

-- 5. The snapshot for the backend: columns by a white list, the author's journal and progress never.
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

comment on function public.exam_share_bundle(text) is
  'The snapshot of a group link for its classmate (white-listed columns; no journal, answers or progress), or the id of the copy they already have.';

-- 7a. A seat: one transaction holds the link row, so the seat count cannot be passed by two joins at once.
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

-- 7b. The seat points at the classmate's own copy.
create or replace function public.exam_share_bind(p_share_id uuid, p_exam_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if not exists (select 1 from public.exams e where e.id = p_exam_id and e.user_id = v_user) then
    raise exception 'not the caller''s exam' using errcode = 'MS006';
  end if;
  -- A seat is bound once: pointing it at another exam would let that exam pass for the copy, and the real copy
  -- (the author's lecture texts) could then be shared on. A seat whose copy was deleted is free again (SET NULL).
  update public.exam_share_members
     set member_exam_id = p_exam_id
   where share_id = p_share_id and user_id = v_user
     and (member_exam_id is null or member_exam_id = p_exam_id);
  if not found then
    if exists (select 1 from public.exam_share_members m where m.share_id = p_share_id and m.user_id = v_user) then
      raise exception 'the seat already has a copy' using errcode = 'MS006';
    end if;
    raise exception 'no such link' using errcode = 'MS001';
  end if;
end;
$fn$;

-- 6. Joining: the copy prepared by the backend, inserted under the classmate's own token in one transaction.
create or replace function public.exam_share_join(p_code text, p_copy jsonb)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_claim jsonb;
  v_share uuid;
  v_exam uuid;
  v_info jsonb;
  v_questions integer;
  v_materials integer;
  v_rubrics integer;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  v_claim := public.exam_share_claim(p_code);
  if v_claim ? 'exam_id' then
    -- Joined before (another tab, a second click): the same copy.
    return pg_catalog.jsonb_build_object('exam_id', v_claim ->> 'exam_id', 'joined', false);
  end if;
  v_share := (v_claim ->> 'share_id')::uuid;

  if p_copy is null or pg_catalog.jsonb_typeof(p_copy) is distinct from 'object' or (p_copy ->> 'v') is distinct from '1'
     or pg_catalog.jsonb_typeof(p_copy -> 'exam') is distinct from 'object'
     or pg_catalog.jsonb_typeof(p_copy -> 'materials') is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_copy -> 'links') is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_copy -> 'questions') is distinct from 'array'
     or pg_catalog.jsonb_typeof(p_copy -> 'rubrics') is distinct from 'array'
     or coalesce(p_copy -> 'exam' ->> 'id', '') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    raise exception 'invalid copy' using errcode = 'MS006';
  end if;
  v_questions := pg_catalog.jsonb_array_length(p_copy -> 'questions');
  v_materials := pg_catalog.jsonb_array_length(p_copy -> 'materials');
  v_rubrics := pg_catalog.jsonb_array_length(p_copy -> 'rubrics');
  if v_questions < 1 or v_questions > 300 or v_materials < 1 or v_materials > 300 or v_rubrics > 600
     or pg_catalog.jsonb_array_length(p_copy -> 'links') <> v_materials then
    raise exception 'invalid copy' using errcode = 'MS006';
  end if;
  v_info := p_copy -> 'exam';
  v_exam := (v_info ->> 'id')::uuid;

  -- Lectures as «только текст», like «Добавить лекции» (frontend api/exams.ts importTextOnlyMaterial).
  insert into public.materials (id, user_id, title, subject, original_text, summary_json, flashcards_json, quiz_json,
                                created_at)
  select x.id, v_user, coalesce(x.title, ''), coalesce(x.subject, ''), coalesce(x.original_text, ''),
         '{"text_only": true}'::jsonb, '{"flashcards": []}'::jsonb, '{"quiz": []}'::jsonb,
         pg_catalog.now() + x.ord * interval '1 millisecond'
    from rows from (pg_catalog.jsonb_to_recordset(p_copy -> 'materials')
                    as (id uuid, title text, subject text, original_text text)) with ordinality
         as x(id, title, subject, original_text, ord);

  insert into public.exams (id, user_id, title, kind, exam_date, source_kind, source_text, ticket_layout,
                            mapping_state, mapped_at, mapped_material_ids)
  values (v_exam, v_user, v_info ->> 'title', coalesce(v_info ->> 'kind', 'exam'), (v_info ->> 'exam_date')::date,
          coalesce(v_info ->> 'source_kind', 'paste'), coalesce(v_info ->> 'source_text', ''),
          coalesce(v_info -> 'ticket_layout', '{"mode": "random", "per_ticket": 2}'::jsonb),
          coalesce(v_info ->> 'mapping_state', 'none'), (v_info ->> 'mapped_at')::timestamptz,
          coalesce(array(select pg_catalog.jsonb_array_elements_text(
                           case when pg_catalog.jsonb_typeof(v_info -> 'mapped_material_ids') = 'array'
                                then v_info -> 'mapped_material_ids' else '[]'::jsonb end)::uuid), '{}'::uuid[]));

  -- Lectures in the author's order (added_at decides the order everywhere).
  insert into public.exam_materials (exam_id, material_id, user_id, added_at)
  select v_exam, x.material_id, v_user, pg_catalog.now() + x.ord * interval '1 millisecond'
    from rows from (pg_catalog.jsonb_to_recordset(p_copy -> 'links') as (material_id uuid)) with ordinality
         as x(material_id, ord);

  insert into public.exam_questions (id, exam_id, user_id, position, label, section, text, coverage, coverage_method,
                                     coverage_reason, missing_note, evidence, nearest, materials_fingerprint,
                                     mapping_version, mapped_at)
  select x.id, v_exam, v_user, x.position, coalesce(x.label, ''), x.section, x.text, x.coverage, x.coverage_method,
         coalesce(x.coverage_reason, ''), coalesce(x.missing_note, ''), coalesce(x.evidence, '[]'::jsonb),
         coalesce(x.nearest, '[]'::jsonb), x.materials_fingerprint, x.mapping_version, x.mapped_at
    from pg_catalog.jsonb_to_recordset(p_copy -> 'questions')
         as x(id uuid, position smallint, label text, section smallint, text text, coverage text,
              coverage_method text, coverage_reason text, missing_note text, evidence jsonb, nearest jsonb,
              materials_fingerprint text, mapping_version smallint, mapped_at timestamptz);

  -- Answer points with their own created_at and sheet: the sheet's "for" is that created_at. A question whose points
  -- did not pass the quote check comes as a stand-in without points and without a time of its own.
  insert into public.oral_rubrics (id, user_id, question_hash, source_key, material_id, material_ids, question, rubric,
                                   rubric_version, model, created_at, sheet)
  select x.id, v_user, x.question_hash, x.source_key, x.material_id, coalesce(x.material_ids, '{}'::uuid[]), x.question,
         x.rubric, coalesce(x.rubric_version, 1), '', coalesce(x.created_at, pg_catalog.now()), x.sheet
    from pg_catalog.jsonb_to_recordset(p_copy -> 'rubrics')
         as x(id uuid, question_hash text, source_key text, material_id uuid, material_ids uuid[], question text,
              rubric jsonb, rubric_version smallint, created_at timestamptz, sheet jsonb);

  perform public.exam_share_bind(v_share, v_exam);
  return pg_catalog.jsonb_build_object('exam_id', v_exam, 'joined', true, 'questions', v_questions,
                                       'lectures', v_materials, 'rubrics', v_rubrics);
end;
$fn$;

comment on function public.exam_share_join(text, jsonb) is
  'Joins a group link: a seat (exam_share_claim), the copy prepared by the backend inserted as the caller''s own rows, the seat bound to it. Joining again returns the same copy.';

-- 7c. The author closes a link. Copies already made stay with their classmates.
create or replace function public.exam_share_revoke(p_share_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_user uuid := auth.uid();
  v_revoked timestamptz;
begin
  if v_user is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  update public.exam_shares
     set revoked_at = coalesce(revoked_at, pg_catalog.now())
   where id = p_share_id and owner_id = v_user
  returning revoked_at into v_revoked;
  if not found then
    raise exception 'no such link' using errcode = 'MS001';
  end if;
  return pg_catalog.jsonb_build_object('id', p_share_id, 'revoked_at', v_revoked);
end;
$fn$;

grant execute on function public.exam_share_preview(text) to anon, authenticated;
grant execute on function public.exam_share_bundle(text) to authenticated;
grant execute on function public.exam_share_claim(text) to authenticated;
grant execute on function public.exam_share_bind(uuid, uuid) to authenticated;
grant execute on function public.exam_share_join(text, jsonb) to authenticated;
grant execute on function public.exam_share_revoke(uuid) to authenticated;
