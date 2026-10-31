#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of the migrations of release 49, part B, on a scratch PostgreSQL 16
# cluster, on the live chain up to 20261103090200_picture_sweep.sql:
#   20261105090000_quiz_stats.sql     the author's analysis of a quiz, the mistakes into training, the canvas's percents;
#   20261105090100_quiz_telegram.sql  the author's Telegram notices of a quiz and its link sent to a bound group.
# Steps: the base (as oral_journal_sweep_run.sh builds it, then every later migration in the live order) → its
# fingerprint → the contracts and the behaviour files fail on the base → each migration twice (the second changes
# nothing) → the contracts (the new ones, telegram_bot.sql, containers.sql, question_kinds_quiz.sql) → the behaviour
# (quiz_stats_behaviour.sql, quiz_telegram_behaviour.sql, question_kinds_quiz_behaviour.sql, containers_behaviour.sql)
# → the rollbacks in reverse, each twice (the catalog as before that file, its contract fails) → the files again (the
# same catalog as their first apply) → the contracts and the behaviour again. Exit code 0 only when every step is green.
# Env (optional): R49_PG_PORT (54490), R49_WORK (${TMPDIR:-/tmp}/meldy-r49), PG_BIN (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
PORT=${R49_PG_PORT:-54490}
WORK=${R49_WORK:-${TMPDIR:-/tmp}/meldy-r49}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
VERS=(20261105090000_quiz_stats 20261105090100_quiz_telegram)
CONTRACTS=(quiz_stats quiz_telegram)
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
DB=r49
FAILS=0
OKS=0
ok() { printf '  ok    %s\n' "$1"; OKS=$((OKS + 1)); }
bad() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
as_pg() { if [ "$(id -u)" = 0 ]; then unshare --user --map-user=1000 --map-group=1000 bash -c "$1"; else bash -c "$1"; fi; }
mkdir -p "$WORK"
STARTED=0
if ! "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT"; then
  mkdir -p "$WORK/pg"
  if [ ! -f "$WORK/pg/data/PG_VERSION" ]; then
    as_pg "'$PG_BIN/initdb' -D '$WORK/pg/data' -U postgres -A trust -E UTF8 --locale=C.UTF-8 > '$WORK/pg/initdb.log' 2>&1" \
      || { echo "initdb failed: $WORK/pg/initdb.log"; exit 2; }
  fi
  as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -l '$WORK/pg/server.log' -o \"-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1\" -w start" >/dev/null \
    || { echo "the cluster did not start: $WORK/pg/server.log"; exit 2; }
  STARTED=1
fi
stop_all() { if [ $STARTED = 1 ]; then as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -m fast -w stop" >/dev/null; fi; }
trap stop_all EXIT
run() { "${PSQL[@]}" -d $DB -f "$1" > "$WORK/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$WORK/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
step() { if run "$2"; then ok "$1"; else bad "$1"; fi; }
q() { "${PSQL[@]}" -d $DB -c "$1"; }
# A behaviour file passes when it prints its marker.
passes() { local out; out=$("${PSQL[@]}" -d $DB -f "$1" 2>&1)
           if echo "$out" | grep -q "$2"; then return 0; fi
           echo "$out" | grep -v NOTICE | tail -6 | sed 's/^/    /'; return 1; }
behave() { if passes "$2" "$3"; then ok "$1"; else bad "$1"; fi; }
fails_before() { if "${PSQL[@]}" -d $DB -f "$2" >/dev/null 2>&1; then bad "$1 passes before (it tests nothing)"; else ok "$1 fails before"; fi; }
contract_ok() { local out; out=$("${PSQL[@]}" -d $DB -f "$2" 2>&1)
                if [ $? = 0 ] && echo "$out" | grep -Eq '"contract_ok" ?: ?true'; then ok "$1"
                else bad "$1"; echo "$out" | grep -o '"failed" *: *\[[^]]*\]' | head -1 | sed 's/^/    /'; echo "$out" | grep -m1 ERROR | sed 's/^/    /'; fi; }
containers_contract() { local out; out=$("${PSQL[@]}" -d $DB -f "$SB/tests/containers.sql" 2>&1)
                        if [ $? = 0 ] && ! echo "$out" | grep -q '"contract_ok" *: *false'; then ok "$1"; else bad "$1"; fi; }

# ── the base: the live chain up to 20261103090200 ────────────────────────────────────────────────────────────────────
"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB encoding 'UTF8' template template0" >/dev/null
BASE_OK=1
for f in tests/local/baseline.sql migrations/20261003083154_hackathon_journal_exams_oral.sql migrations/20261005143420_cheat_sheet.sql \
         tests/local/exam_shares_baseline.sql migrations/20261007110403_exam_shares.sql migrations/20261007110457_exam_shares_revokes.sql; do
  run "$SB/$f" || BASE_OK=0
done
q "alter table auth.users add column if not exists created_at timestamptz not null default now()" >/dev/null || BASE_OK=0
run "$SB/migrations/20261005042323_app_telemetry.sql" || BASE_OK=0
run "$SB/tests/local/ai_quota_baseline.sql" || BASE_OK=0
"${PSQL[@]}" -d $DB >/dev/null <<'SQL' || BASE_OK=0
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
  run "$SB/$f" || BASE_OK=0
done
q "create schema if not exists extensions" >/dev/null || BASE_OK=0
q "create extension if not exists pgcrypto with schema extensions" >/dev/null || BASE_OK=0
if [ "$(q "select count(*) from pg_available_extensions where name in ('pg_cron', 'pg_net')")" = 2 ]; then
  CRON_RUN=$SB/migrations/20261010120001_telegram_bot_cron.sql
else
  # LOCAL STUBS of pg_cron 1.6 and pg_net 0.20 (the names and signatures the migrations call), as live_game_run.sh.
  "${PSQL[@]}" -d $DB >/dev/null <<'SQL' || BASE_OK=0
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
  [ "$(grep -c '^-- (local: stubbed) create extension' "$WORK/cron_local.sql")" = 2 ] || BASE_OK=0
  CRON_RUN=$WORK/cron_local.sql
fi
# Supabase Realtime's realtime.send as a LOCAL STUB (live_game_run.sh): not in public or meldy_private.
"${PSQL[@]}" -d $DB >/dev/null <<'SQL' || BASE_OK=0
create schema if not exists realtime;
create table if not exists realtime.sent (
  id bigserial primary key, payload jsonb, event text, topic text, private boolean, at timestamptz not null default clock_timestamp());
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
  language sql as $$ insert into realtime.sent (payload, event, topic, private) values (payload, event, topic, private) $$;
SQL
run "$SB/tests/local/storage_baseline.sql" || BASE_OK=0
q "grant select on storage.objects to anon" >/dev/null || BASE_OK=0
run "$SB/migrations/20261010120000_telegram_bot.sql" || BASE_OK=0
run "$CRON_RUN" || BASE_OK=0
LATER=0
for f in $(cd "$SB/migrations" && ls 2026101012000[2-9]_*.sql 202610101[3-9]*.sql 20261011*.sql 2026101[2-9]*.sql 2026102*.sql 2026103*.sql 2026110[1-4]*.sql | sort); do
  if run "$SB/migrations/$f"; then LATER=$((LATER + 1)); else BASE_OK=0; echo "    base: $f"; fi
done
[ $BASE_OK = 1 ] && ok "base: the live chain up to 20261103090200_picture_sweep.sql ($LATER later migrations in order)" || bad "base"

# The catalog the three files and their rollbacks touch (live_game_run.sh's fingerprint, plus the policies of
# learning_events and the triggers of public.containers, which it covers already).
fingerprint() { local f; f=$(fingerprint_sql) && [ -n "$f" ] && echo "$f" || echo "fingerprint failed $RANDOM"; }
fingerprint_sql() {
  q "select md5(concat_ws('|',
     (select string_agg(p.oid::regprocedure::text || pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), '' order by p.oid::regprocedure::text)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'meldy_private', 'bot') and p.prokind in ('f', 'p')),
     (select string_agg(nspname || ':' || coalesce(nspacl::text, ''), ',' order by nspname) from pg_namespace
       where nspname in ('public', 'meldy_private', 'bot')),
     (select string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(c.relacl::text, ''), ','
                        order by n.nspname, c.relname)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'meldy_private', 'bot') and c.relkind in ('r', 'p', 'i', 'v', 'S')),
     (select string_agg(table_schema || '.' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' '
                        || coalesce(column_default, ''), ',' order by table_schema, table_name, ordinal_position)
        from information_schema.columns where table_schema in ('public', 'meldy_private', 'bot')),
     (select string_agg(conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname)
        from pg_constraint where connamespace in ('public'::regnamespace, 'meldy_private'::regnamespace, 'bot'::regnamespace)),
     (select string_agg(indexdef, ',' order by schemaname, tablename, indexname) from pg_indexes
       where schemaname in ('public', 'meldy_private', 'bot')),
     (select string_agg(t.tgrelid::regclass::text || '.' || t.tgname || ' ' || pg_get_triggerdef(t.oid), ',' order by t.tgrelid::regclass::text, t.tgname)
        from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'meldy_private', 'bot') and not t.tgisinternal),
     (select string_agg(schemaname || '.' || tablename || '.' || policyname || permissive || cmd || roles::text || coalesce(qual, '') || coalesce(with_check, ''), ','
                        order by schemaname, tablename, policyname)
        from pg_policies where schemaname in ('public', 'storage', 'bot', 'meldy_private'))))"
}
declare -A FP_BEFORE=() FP_AFTER=()
FBASE=$(fingerprint)
[[ "$FBASE" =~ ^[0-9a-f]{32}$ ]] && ok "the catalog fingerprint of the base taken" || bad "fingerprint of the base"

STATS=$HERE/quiz_stats_behaviour.sql
TG=$HERE/quiz_telegram_behaviour.sql
for c in "${CONTRACTS[@]}"; do fails_before "contract $c.sql" "$SB/tests/$c.sql"; done
if passes "$STATS" 'QUIZ STATS BEHAVIOUR PASSED' >/dev/null; then bad "quiz_stats_behaviour passes on the base (it tests nothing)"
else ok "quiz_stats_behaviour fails on the base"; fi
if passes "$TG" 'QUIZ TELEGRAM BEHAVIOUR PASSED' >/dev/null; then bad "quiz_telegram_behaviour passes on the base (it tests nothing)"
else ok "quiz_telegram_behaviour fails on the base"; fi
contract_ok "contract on the base: telegram_bot.sql" "$SB/tests/telegram_bot.sql"

checks() {  # <label>: every contract and behaviour after the files
  for c in "${CONTRACTS[@]}"; do step "$1: contract $c.sql" "$SB/tests/$c.sql"; done
  step "$1: contract question_kinds_quiz.sql" "$SB/tests/question_kinds_quiz.sql"
  contract_ok "$1: contract telegram_bot.sql" "$SB/tests/telegram_bot.sql"
  containers_contract "$1: contract containers.sql"
  behave "$1: quiz_stats_behaviour.sql (analysis, mistakes into training, the canvas's percents)" "$STATS" 'QUIZ STATS BEHAVIOUR PASSED'
  behave "$1: quiz_telegram_behaviour.sql (the author's notices, the digest, the close, the share)" "$TG" 'QUIZ TELEGRAM BEHAVIOUR PASSED'
  behave "$1: picture_sweep_behaviour.sql (the bot's other tick functions as before)" "$HERE/picture_sweep_behaviour.sql" 'PICTURE SWEEP PASSED'
  behave "$1: question_kinds_quiz_behaviour.sql (the quiz of release 48 as before)" "$HERE/question_kinds_quiz_behaviour.sql" 'QUESTION KINDS QUIZ BEHAVIOUR PASSED'
  behave "$1: containers_behaviour.sql" "$HERE/containers_behaviour.sql" 'CONTAINER CHECKS PASSED'
}

prev=$FBASE
for v in "${VERS[@]}"; do
  FP_BEFORE[$v]=$prev
  step "$v: first apply" "$SB/migrations/$v.sql"
  FP_AFTER[$v]=$(fingerprint)
  [ "${FP_AFTER[$v]}" != "$prev" ] && ok "$v: changed the catalog" || bad "$v: changed nothing"
  step "$v: second apply (re-runnable)" "$SB/migrations/$v.sql"
  [ "$(fingerprint)" = "${FP_AFTER[$v]}" ] && ok "$v: a second apply changes nothing in the catalog" || bad "$v: a second apply changed the catalog"
  prev=${FP_AFTER[$v]}
done
checks "applied"

for ((i = ${#VERS[@]} - 1; i >= 0; i--)); do
  v=${VERS[$i]}
  step "$v: rollback" "$SB/rollback/${v}_down.sql"
  step "$v: rollback again (re-runnable)" "$SB/rollback/${v}_down.sql"
  [ "$(fingerprint)" = "${FP_BEFORE[$v]}" ] && ok "$v: after its rollback the catalog is the one before it" || bad "$v: the rollback left the catalog changed"
  fails_before "$v: its contract after the rollback" "$SB/tests/${CONTRACTS[$i]}.sql"
done
[ "$(fingerprint)" = "$FBASE" ] && ok "after the rollbacks: the base's catalog" || bad "after the rollbacks: another catalog"
behave "rolled back: question_kinds_quiz_behaviour.sql" "$HERE/question_kinds_quiz_behaviour.sql" 'QUESTION KINDS QUIZ BEHAVIOUR PASSED'

for v in "${VERS[@]}"; do
  step "$v: applied again" "$SB/migrations/$v.sql"
  [ "$(fingerprint)" = "${FP_AFTER[$v]}" ] && ok "$v: the same catalog as its first apply" || bad "$v: another catalog than its first apply"
done
checks "again"
echo "release 49 part B rehearsal: $OKS ok, $FAILS failed"
[ $FAILS = 0 ]
