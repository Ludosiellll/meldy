#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Builds the base of the question kinds' rehearsals (release 48,
# docs/kinds/CONTRACT.md) into the database named by $1 on the cluster of PGHOST / PGPORT: the live order of every
# migration up to 20261031090000_live_wide_rounds.sql, set up as live_game_run.sh sets up its base (containers + storage
# stand-in + pgcrypto in extensions, pg_cron / pg_net stubbed when not installed, Supabase Realtime's realtime.send as a
# local stub). Sourced by question_kinds_run.sh; exit code 0 only when every file applied.
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
DB=$1
WORK=$2
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
run() { "${PSQL[@]}" -d "$DB" -f "$1" > "$WORK/base.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$WORK/base.log" | head -6 | sed 's/^/    /'; return 1; }; }
q() { "${PSQL[@]}" -d "$DB" -c "$1"; }
OK=1
"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB encoding 'UTF8' template template0" >/dev/null || exit 2
for f in tests/local/baseline.sql migrations/20261003083154_hackathon_journal_exams_oral.sql migrations/20261005143420_cheat_sheet.sql \
         tests/local/exam_shares_baseline.sql migrations/20261007110403_exam_shares.sql migrations/20261007110457_exam_shares_revokes.sql; do
  run "$SB/$f" || OK=0
done
q "alter table auth.users add column if not exists created_at timestamptz not null default now()" >/dev/null || OK=0
run "$SB/migrations/20261005042323_app_telemetry.sql" || OK=0
run "$SB/tests/local/ai_quota_baseline.sql" || OK=0
"${PSQL[@]}" -d "$DB" >/dev/null <<'SQL' || OK=0
update public.ai_usage u set requests_count = t.total
  from (select user_id, date, min(created_at) as first, sum(requests_count) as total from public.ai_usage
         where user_id is not null group by 1, 2 having count(*) > 1) t
 where u.user_id = t.user_id and u.date = t.date and u.created_at = t.first;
delete from public.ai_usage u
 using (select user_id, date, min(created_at) as first from public.ai_usage where user_id is not null group by 1, 2 having count(*) > 1) t
 where u.user_id = t.user_id and u.date = t.date and u.created_at > t.first;
SQL
for f in migrations/20261004205613_ai_quota_server.sql migrations/20261005031722_ai_quota_lockdown.sql \
         migrations/20261007103621_oral_answer_texts.sql tests/local/containers_baseline.sql \
         migrations/20261009093500_containers.sql migrations/20261009093501_containers_revokes.sql \
         migrations/20261010074500_containers_fk_indexes.sql migrations/20261010110000_containers_oral_codes_closed.sql; do
  run "$SB/$f" || OK=0
done
q "create schema if not exists extensions" >/dev/null || OK=0
q "create extension if not exists pgcrypto with schema extensions" >/dev/null || OK=0
if [ "$(q "select count(*) from pg_available_extensions where name in ('pg_cron', 'pg_net')")" = 2 ]; then
  CRON_RUN=$SB/migrations/20261010120001_telegram_bot_cron.sql
else
  "${PSQL[@]}" -d "$DB" >/dev/null <<'SQL' || OK=0
create schema if not exists cron;
create schema if not exists net;
create table if not exists cron.job (
  jobid bigserial primary key, schedule text not null, command text not null, nodename text not null default 'localhost',
  nodeport integer not null default 5432, database text not null default current_database(),
  username text not null default current_user, active boolean not null default true, jobname text unique);
create table if not exists cron.job_run_details (
  jobid bigint, runid bigserial primary key, job_pid integer, database text, username text, command text, status text,
  return_message text, start_time timestamptz, end_time timestamptz);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid $$;
create or replace function cron.unschedule(job_name text) returns boolean language plpgsql as $$
begin
  delete from cron.job where jobname = job_name;
  if not found then raise exception 'could not find valid entry for job ''%''', job_name; end if;
  return true;
end $$;
create table if not exists net.calls (
  id bigserial primary key, url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer,
  at timestamptz not null default clock_timestamp());
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer default 5000)
  returns bigint language sql as $$
  insert into net.calls (url, body, params, headers, timeout_milliseconds)
  values (url, body, params, headers, timeout_milliseconds) returning id $$;
SQL
  sed -E 's/^(create extension if not exists pg_(cron|net) .*)$/-- (local: stubbed) \1/' \
    "$SB/migrations/20261010120001_telegram_bot_cron.sql" > "$WORK/cron_local.sql"
  CRON_RUN=$WORK/cron_local.sql
fi
"${PSQL[@]}" -d "$DB" >/dev/null <<'SQL' || OK=0
create schema if not exists realtime;
create table if not exists realtime.sent (
  id bigserial primary key, payload jsonb, event text, topic text, private boolean, at timestamptz not null default clock_timestamp());
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
  language sql as $$ insert into realtime.sent (payload, event, topic, private) values (payload, event, topic, private) $$;
SQL
run "$SB/tests/local/storage_baseline.sql" || OK=0
q "grant select on storage.objects to anon" >/dev/null || OK=0
run "$SB/migrations/20261010120000_telegram_bot.sql" || OK=0
run "$CRON_RUN" || OK=0
N=0
for f in $(cd "$SB/migrations" && ls 2026*.sql); do
  [[ "$f" < "20261010120002" ]] && continue
  [[ "$f" > "20261031090000_live_wide_rounds.sql" ]] && continue
  if run "$SB/migrations/$f"; then N=$((N + 1)); else OK=0; fi
done
[ $OK = 1 ] && echo "base: $N later migrations in the live order up to 20261031090000_live_wide_rounds.sql" && exit 0
exit 1
