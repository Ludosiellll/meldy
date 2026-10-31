-- picture_sweep (a deleted exam's or test's pictures leave storage after it, done by the server)
-- Repo file: supabase/migrations/20261103090200_picture_sweep.sql. Base: 20261009093500_containers.sql (public.containers,
-- meldy_private.require_service_role) and the Telegram bot's T1 (20261010120000_telegram_bot.sql: the minute tick).
-- Why (found 19.10, live check of 47.4): «Удалить тест» left the test's pictures in the public bucket quiz-covers
-- («<container id>/<sha256>.<ext>»: the cover, the studio's page pictures) and its question pictures in test-item-images;
-- the public ones kept opening by their address. Since 47.4 the site removed the folders itself right before the delete,
-- through the author's session (frontend/src/api/containers.ts deleteContainer). That could be skipped (a failed listing,
-- a closed tab, a delete from anywhere but that page, an account deleted with its exams), and it ran before the delete:
-- when the database then refused it (someone joined meanwhile: MC009) or the network failed, the exam stayed without its
-- pictures. Now the database queues the folder of every deleted containers row in the same transaction as the delete,
-- and the Telegram bot's minute tick (step «sweep», supabase/functions/_shared/bot/sweep.ts) lists both folders through
-- the Storage API with the service key and removes what is there; a folder found empty in both buckets leaves the queue.
-- Objects are never deleted by SQL (Supabase: the Storage API removes the file and its row together; a row deleted in
-- SQL leaves the file behind).
-- What this file adds:
--   1. meldy_private.picture_sweep: one row per deleted container whose folders may still hold pictures (queued_at, tries,
--      tried_at). Row security on, no policy, no client grant.
--   2. The AFTER DELETE trigger containers_queue_picture_sweep on public.containers (meldy_private.queue_picture_sweep,
--      SECURITY DEFINER: the deleting user has no rights on meldy_private). Every delete counts: the owner's, a cascade
--      from auth.users, a service-role one.
--   3. public.bot_picture_sweep(p_limit) (service role): up to p_limit queued folders, oldest first, each taken at most
--      once a minute and at most 50 times (a folder storage keeps refusing stays for a look); and
--      public.bot_picture_swept(p_container) (service role): the folder is empty in both buckets, its row goes.
-- Release order: this file first (from then on every delete is queued), then the telegram function with sweep.ts (until
-- then the queue only fills; nothing is lost), then the site release whose deleteContainer no longer removes the folders
-- itself. A site without that removal on a database without this file would leave a deleted test's pictures for good.
-- Check after the apply: supabase/tests/picture_sweep.sql (catalog only; read-only). Local rehearsal (never live):
-- supabase/tests/local/oral_journal_sweep_run.sh. Rollback: supabase/rollback/20261103090200_picture_sweep_down.sql.
-- Re-runnable: IF NOT EXISTS, OR REPLACE.

do $do$
begin
  if pg_catalog.to_regclass('public.containers') is null
     or pg_catalog.to_regprocedure('meldy_private.require_service_role()') is null then
    raise exception 'the base is expected: 20261009093500_containers.sql';
  end if;
end;
$do$;

-- 1. The queue.
create table if not exists meldy_private.picture_sweep (
  container_id uuid primary key,
  queued_at timestamptz not null default pg_catalog.now(),
  tries integer not null default 0,
  tried_at timestamptz
);
alter table meldy_private.picture_sweep enable row level security;
comment on table meldy_private.picture_sweep is
  'Folders «<container id>/» of deleted containers whose pictures may still be in quiz-covers and test-item-images; the bot''s tick removes them through the Storage API (bot_picture_sweep, bot_picture_swept).';

-- 2. The trigger: the folder of every deleted container, in the delete's own transaction.
create or replace function meldy_private.queue_picture_sweep()
returns trigger
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
begin
  insert into meldy_private.picture_sweep (container_id) values (old.id)
  on conflict (container_id) do update set queued_at = pg_catalog.now(), tries = 0, tried_at = null;
  return null;
end;
$fn$;
comment on function meldy_private.queue_picture_sweep() is 'AFTER DELETE on public.containers: queues the container''s picture folders for the bot''s sweep.';

create or replace trigger containers_queue_picture_sweep
  after delete on public.containers
  for each row execute function meldy_private.queue_picture_sweep();

-- 3a. The bot takes up to p_limit folders (1–20), oldest first; a folder taken in the last minute or 50 times is left.
--     Answers {folders: [container id, …], queued: <rows in the queue>}. p_now is for tests; the bot passes nothing.
create or replace function public.bot_picture_sweep(p_limit integer default 5, p_now timestamptz default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_now timestamptz := coalesce(p_now, pg_catalog.now());
  v_limit integer := least(greatest(coalesce(p_limit, 5), 1), 20);
  v_folders jsonb;
begin
  perform meldy_private.require_service_role();
  with taken as (
    update meldy_private.picture_sweep s
       set tries = s.tries + 1, tried_at = v_now
     where s.container_id in (
             select q.container_id
               from meldy_private.picture_sweep q
              where q.tries < 50 and (q.tried_at is null or q.tried_at <= v_now - interval '1 minute')
              order by q.queued_at, q.container_id
              limit v_limit
                for update skip locked)
    returning s.container_id, s.queued_at)
  select coalesce(pg_catalog.jsonb_agg(t.container_id order by t.queued_at, t.container_id), '[]'::jsonb)
    into v_folders
    from taken t;
  return pg_catalog.jsonb_build_object(
    'folders', v_folders,
    'queued', (select pg_catalog.count(*) from meldy_private.picture_sweep));
end;
$fn$;
comment on function public.bot_picture_sweep(integer, timestamptz) is 'Picture sweep (service role): up to p_limit (1–20) queued folders of deleted containers, oldest first → {folders: [uuid], queued}.';

-- 3b. The folder held nothing in either bucket when the bot listed it: its row goes. {done: true} | {done: false}.
create or replace function public.bot_picture_swept(p_container uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $fn$
declare
  v_done boolean;
begin
  perform meldy_private.require_service_role();
  delete from meldy_private.picture_sweep s where s.container_id = p_container;
  v_done := found;
  return pg_catalog.jsonb_build_object('done', v_done);
end;
$fn$;
comment on function public.bot_picture_swept(uuid) is 'Picture sweep (service role): the folder is empty in quiz-covers and test-item-images → its queue row goes. {done}.';

-- 4. Grants (re-runnable). Supabase gives new public functions to anon and authenticated, PostgreSQL gives every new
--    function to PUBLIC: taken back. The trigger function needs no grant (EXECUTE is checked when a trigger is created).
revoke all on table meldy_private.picture_sweep from public, anon, authenticated, service_role;
revoke all on function meldy_private.queue_picture_sweep() from public, anon, authenticated, service_role;
revoke all on function public.bot_picture_sweep(integer, timestamptz), public.bot_picture_swept(uuid) from public, anon, authenticated;
grant execute on function public.bot_picture_sweep(integer, timestamptz), public.bot_picture_swept(uuid) to service_role;
