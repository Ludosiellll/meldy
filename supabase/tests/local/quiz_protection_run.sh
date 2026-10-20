#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261020120000_quiz_protection.sql
# («Защита от списывания» of «Контрольная») on a scratch PostgreSQL 16 cluster:
# the base in the live order (as test_docs_run.sh builds it, then 20261019100000_test_docs.sql and
# 20261019110000_doc_video.sql: release 47.4) → the catalog fingerprint of that base → quiz_protection_behaviour.sql and
# tests/quiz_protection.sql fail (they bite); the quiz contracts and behaviour pass on the base → the migration twice
# (the same fingerprint) → its contract and every quiz contract before it (quizzes, quiz_result_order, test_builder,
# quiz_guards, quiz_practice_grace, test_docs, doc_video, containers) → its behaviour, and the behaviour of releases 46,
# 47, the guards, the grace, the studio and the video (their «not found» now come as HTTP 404 from the functions this
# file rewrote; the behaviour files take P0002 in either form) → two connections end the same strict attempt together
# (one end, one count) → the rollback twice (the fingerprint of the base again: every function byte for byte; the old
# contracts and behaviour pass, quiz_protection.sql bites) → the migration again (the same fingerprint as the first
# apply) → its contract and behaviour again.
# The last line is QUIZ PROTECTION CHECKS PASSED and the exit code 0 only when every step is green.
# Env (optional): PROT_PG_PORT (54410), PROT_WORK (${TMPDIR:-/tmp}/meldy-quiz-protection), PG_BIN (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
PORT=${PROT_PG_PORT:-54410}
WORK=${PROT_WORK:-${TMPDIR:-/tmp}/meldy-quiz-protection}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
MIG=$SB/migrations/20261020120000_quiz_protection.sql
DOWN=$SB/rollback/20261020120000_quiz_protection_down.sql
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
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
stop_cluster() { if [ $STARTED = 1 ]; then as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -m fast -w stop" >/dev/null; fi; }
trap stop_cluster EXIT
run() { "${PSQL[@]}" -d prot -f "$1" > "$WORK/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$WORK/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
step() { if run "$2"; then ok "$1"; else bad "$1"; fi; }
q() { "${PSQL[@]}" -d prot -c "$1"; }
# A behaviour file passes when its own last line is printed.
passes() { local out; out=$("${PSQL[@]}" -d prot -f "$1" 2>&1); if echo "$out" | grep -q "$2"; then return 0; fi
           echo "$out" | grep -v NOTICE | tail -6 | sed 's/^/    /'; return 1; }
behave() { if passes "$2" "$3"; then ok "$1"; else bad "$1"; fi; }
containers_contract() { local out; out=$("${PSQL[@]}" -d prot -f "$SB/tests/containers.sql" 2>&1)
                        [ $? = 0 ] && ! echo "$out" | grep -q '"contract_ok" *: *false'; }

"${PSQL[@]}" -d postgres -c "drop database if exists prot" -c "create database prot encoding 'UTF8' template template0" >/dev/null
BASE_OK=1
for f in tests/local/baseline.sql migrations/20261003083154_hackathon_journal_exams_oral.sql migrations/20261005143420_cheat_sheet.sql \
         tests/local/exam_shares_baseline.sql migrations/20261007110403_exam_shares.sql migrations/20261007110457_exam_shares_revokes.sql; do
  run "$SB/$f" || BASE_OK=0
done
q "alter table auth.users add column if not exists created_at timestamptz not null default now()" >/dev/null || BASE_OK=0
run "$SB/migrations/20261005042323_app_telemetry.sql" || BASE_OK=0
run "$SB/tests/local/ai_quota_baseline.sql" || BASE_OK=0
"${PSQL[@]}" -d prot >/dev/null <<'SQL' || BASE_OK=0
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
# pgcrypto lives in schema extensions on every Supabase project (20261018130000_quiz_guards.sql calls it there).
q "create schema if not exists extensions" >/dev/null || BASE_OK=0
q "create extension if not exists pgcrypto with schema extensions" >/dev/null || BASE_OK=0
# The bot's cron file as this cluster can take it: as it is when pg_cron and pg_net are installed here; otherwise
# without its two CREATE EXTENSION lines, on LOCAL STUBS of the same names and signatures as pg_cron 1.6 and pg_net 0.20
# (as telegram_bot_run.sh; none of them is in public or meldy_private, so no fingerprint below sees them).
if [ "$(q "select count(*) from pg_available_extensions where name in ('pg_cron', 'pg_net')")" = 2 ]; then
  CRON_RUN=$SB/migrations/20261010120001_telegram_bot_cron.sql
else
  "${PSQL[@]}" -d prot >/dev/null <<'SQL' || BASE_OK=0
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
# Live, the API roles may read storage.objects (RLS decides what they see); as test_builder_run.sh does.
run "$SB/tests/local/storage_baseline.sql" || BASE_OK=0
q "grant select on storage.objects to anon" >/dev/null || BASE_OK=0
[ $BASE_OK = 1 ] && ok "base (containers + storage stand-in, anon may select storage.objects as live, pgcrypto in extensions)" || bad "base"
# Then every later migration in the live order (deploy/supabase-migrate.md): the bot's packages (T1 = the main file, its
# cron file and its revokes; T5, T7, T9, T10, T11), the frozen day, the Mini App, the page's «not found», the outage
# monitor, pictures, the bot skips pictures, the tempo, item_update_images, release 46 / 46.1, release 47 and its three
# live follow-ups (the exam move with the bot's exams, the quiz guards, the practice grace), and release 47.3 (a test is
# its own kind: 20261019090000_container_kind, which sorts before this file).
step "base: 20261010120000_telegram_bot.sql" "$SB/migrations/20261010120000_telegram_bot.sql"
step "base: 20261010120001_telegram_bot_cron.sql$([ "$CRON_RUN" = "$WORK/cron_local.sql" ] && echo ' (pg_cron and pg_net stubbed)')" "$CRON_RUN"
for f in 20261010120002_telegram_bot_revokes.sql 20261010120003_telegram_bot_sessions.sql \
         20261010120004_telegram_bot_groups.sql 20261010120005_telegram_bot_files.sql 20261010120006_telegram_bot_voice.sql \
         20261010120007_oral_plan_inputs.sql 20261010130000_containers_frozen_pace.sql 20261010150000_telegram_webapp.sql \
         20261011100000_containers_not_found_null.sql 20261012100000_telegram_bot_monitor.sql \
         20261014120000_test_item_images.sql 20261014150000_bot_skips_pictures.sql 20261014170000_plan_tempo.sql \
         20261016100000_item_update_images.sql 20261016120000_quizzes.sql 20261016140000_quiz_result_order.sql \
         20261018100000_test_builder.sql 20261018120000_exam_move_bot_exams.sql 20261018130000_quiz_guards.sql \
         20261018140000_quiz_practice_grace.sql 20261019090000_container_kind.sql \
         20261019100000_test_docs.sql 20261019110000_doc_video.sql; do
  step "base: $f" "$SB/migrations/$f"
done

# The catalog the migration and its rollback touch (the same fingerprint as test_builder_run.sh): every function of
# public and meldy_private (source and grants), those schemas' grants, their relations (RLS, grants), columns,
# constraints, indexes, the storage policies and the buckets.
fingerprint() { local f; f=$(fingerprint_sql) && [ -n "$f" ] && echo "$f" || echo "fingerprint failed $RANDOM"; }
fingerprint_sql() {
  q "select md5(concat_ws('|',
     (select string_agg(p.oid::regprocedure::text || pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), '' order by p.oid::regprocedure::text)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'meldy_private') and p.prokind in ('f', 'p')),
     (select string_agg(nspname || ':' || coalesce(nspacl::text, ''), ',' order by nspname) from pg_namespace
       where nspname in ('public', 'meldy_private')),
     (select string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(c.relacl::text, ''), ','
                        order by n.nspname, c.relname)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'meldy_private') and c.relkind in ('r', 'p', 'i', 'v', 'S')),
     (select string_agg(table_schema || '.' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' '
                        || coalesce(column_default, ''), ',' order by table_schema, table_name, ordinal_position)
        from information_schema.columns where table_schema in ('public', 'meldy_private')),
     (select string_agg(conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname)
        from pg_constraint where connamespace in ('public'::regnamespace, 'meldy_private'::regnamespace)),
     (select string_agg(indexdef, ',' order by schemaname, tablename, indexname) from pg_indexes
       where schemaname in ('public', 'meldy_private')),
     (select string_agg(policyname || cmd || roles::text || coalesce(qual, '') || coalesce(with_check, ''), ',' order by policyname)
        from pg_policies where schemaname = 'storage'),
     (select string_agg(id || ':' || public || ':' || coalesce(file_size_limit::text, '') || ':' || coalesce(allowed_mime_types::text, ''), ','
                        order by id) from storage.buckets)))"
}
FBASE=$(fingerprint)
[[ "$FBASE" =~ ^[0-9a-f]{32}$ ]] && ok "the catalog fingerprint of the live base (up to 20261019110000_doc_video) taken" \
  || bad "fingerprint of the live base"

# The quiz contracts and behaviour of the base: what must still hold after the migration and after its rollback.
old_contracts() {
  step "contract: quizzes.sql $1" "$SB/tests/quizzes.sql"
  step "contract: quiz_result_order.sql $1" "$SB/tests/quiz_result_order.sql"
  step "contract: test_builder.sql $1" "$SB/tests/test_builder.sql"
  step "contract: quiz_guards.sql $1" "$SB/tests/quiz_guards.sql"
  step "contract: quiz_practice_grace.sql $1" "$SB/tests/quiz_practice_grace.sql"
  step "contract: test_docs.sql $1" "$SB/tests/test_docs.sql"
  step "contract: doc_video.sql $1" "$SB/tests/doc_video.sql"
  if containers_contract; then ok "contract: containers.sql $1"; else bad "contract: containers.sql $1"; fi
}
old_behaviour() {
  behave "quizzes_behaviour $1 (release 46)" "$HERE/quizzes_behaviour.sql" 'QUIZ CHECKS PASSED'
  behave "test_builder_behaviour $1 (release 47)" "$HERE/test_builder_behaviour.sql" 'BUILDER BEHAVIOUR PASSED'
  behave "quiz_guards_behaviour $1" "$HERE/quiz_guards_behaviour.sql" 'QUIZ GUARDS BEHAVIOUR PASSED'
  behave "quiz_practice_grace_behaviour $1" "$HERE/quiz_practice_grace_behaviour.sql" 'QUIZ PRACTICE GRACE BEHAVIOUR PASSED'
  behave "test_docs_behaviour $1 (the studio)" "$HERE/test_docs_behaviour.sql" 'TEST DOCS BEHAVIOUR PASSED'
  behave "doc_video_behaviour $1" "$HERE/doc_video_behaviour.sql" 'DOC VIDEO BEHAVIOUR PASSED'
}

if passes "$HERE/quiz_protection_behaviour.sql" 'QUIZ PROTECTION BEHAVIOUR PASSED' >/dev/null; then
  bad "quiz_protection_behaviour passes before the migration (it tests nothing)"
else
  ok "quiz_protection_behaviour fails before the migration"
fi
if run "$SB/tests/quiz_protection.sql"; then bad "quiz_protection.sql passes before the migration (it tests nothing)"; else ok "quiz_protection.sql fails before the migration"; fi
old_contracts "holds on the base"
old_behaviour "passes on the base"

step "migration, first apply" "$MIG"
FMIG=$(fingerprint)
[ "$FMIG" != "$FBASE" ] && ok "the migration changed the catalog" || bad "the migration changed nothing"
step "migration, second apply (re-runnable)" "$MIG"
[ "$(fingerprint)" = "$FMIG" ] && ok "a second apply changes nothing in the catalog" || bad "a second apply changed the catalog"

step "contract: quiz_protection.sql" "$SB/tests/quiz_protection.sql"
old_contracts "still holds"
behave "behaviour: settings, events, the limit, the server's check, guests, the author's timeline, 404" \
  "$HERE/quiz_protection_behaviour.sql" 'QUIZ PROTECTION BEHAVIOUR PASSED'
old_behaviour "after the migration"
behave "containers behaviour after the migration" "$HERE/containers_behaviour.sql" 'CONTAINER CHECKS PASSED'

# Two connections end the same strict attempt (limit 1) together: the first holds the attempt's row for 2 s after its
# event; the second waits on that row, then finds the attempt ended and only adds its row. One end, two counted rows.
TWO=$WORK/two; mkdir -p "$TWO"
SETUP=$("${PSQL[@]}" -d prot 2>"$TWO/setup.err" <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) is null \g /dev/null
select set_config('meldy.x', public.container_create('Две вкладки защиты', null, '[{"title":"Предмет"}]') ->> 'container_id', false) is null \g /dev/null
select public.container_items_add((select s.id from public.container_subjects s where s.container_id = current_setting('meldy.x')::uuid),
  '[{"ref":"t:1","stem":"Вопрос","options":["а","б"],"correct":[0]}]') is null \g /dev/null
select set_config('meldy.code', public.quiz_create(current_setting('meldy.x')::uuid, '{"protection":"strict","protection_limit":1}') ->> 'code', false) is null \g /dev/null
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false) is null \g /dev/null
select public.quiz_start(current_setting('meldy.code'), 'Две вкладки') ->> 'attempt_id';
SQL
)
tab_two() {
  cat > "$TWO/tab$1.sql" <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false) is null \g /dev/null
begin;
select public.quiz_events_add('$SETUP', '[{"id":"tab$1","kind":"blur","at":"2026-10-20T10:00:00Z","q":1,"ms":null}]') ->> 'finished';
select pg_sleep($2) is null \g /dev/null
commit;
SQL
}
if [[ "$SETUP" =~ ^[0-9a-f-]{36}$ ]]; then
  tab_two 1 2; tab_two 2 0
  "${PSQL[@]}" -d prot -f "$TWO/tab1.sql" > "$TWO/tab1.out" 2>&1 & P1=$!
  sleep 0.7
  T0=$(date +%s.%N); "${PSQL[@]}" -d prot -f "$TWO/tab2.sql" > "$TWO/tab2.out" 2>&1; R2=$?; T1=$(date +%s.%N)
  wait $P1; R1=$?
  N=$(q "select a.finish_reason || ':' || a.guard_count || ':' || (select count(*) from public.quiz_events e where e.attempt_id = a.id)
           from public.quiz_attempts a where a.id = '$SETUP'")
  WAIT=$(awk "BEGIN { printf \"%.1f\", $T1 - $T0 }")
  if [ $R1 = 0 ] && [ $R2 = 0 ] && grep -qx true "$TWO/tab1.out" && grep -qx true "$TWO/tab2.out" && [ "$N" = protection:2:2 ] \
     && awk "BEGIN { exit !($T1 - $T0 > 1.0) }"; then
    ok "two connections at the limit together: one end (protection), both rows counted, the second waited ${WAIT} s"
  else
    bad "two connections: $N, waited ${WAIT} s"; cat "$TWO/tab1.out" "$TWO/tab2.out" | head -6
  fi
else
  bad "two connections: fixture"; head -5 "$TWO/setup.err"
fi
q "delete from public.containers where title = 'Две вкладки защиты'" >/dev/null || bad "two connections: cleanup"
[ "$(fingerprint)" = "$FMIG" ] && ok "the catalog unchanged by the behaviour runs" || bad "the behaviour runs changed the catalog"

step "rollback" "$DOWN"
[ "$(fingerprint)" = "$FBASE" ] && ok "after the rollback: the catalog of the live base (fingerprint, every function byte for byte)" \
  || bad "after the rollback: another catalog than the live base"
step "rollback again (re-runnable)" "$DOWN"
[ "$(fingerprint)" = "$FBASE" ] && ok "after the second rollback: still the catalog of the live base" || bad "after the second rollback: another catalog"
if run "$SB/tests/quiz_protection.sql"; then bad "quiz_protection.sql passes after the rollback (it tests nothing)"; else ok "quiz_protection.sql fails after the rollback"; fi
old_contracts "after the rollback"
old_behaviour "after the rollback"

step "migration after the rollback" "$MIG"
[ "$(fingerprint)" = "$FMIG" ] && ok "the same catalog as the first apply" || bad "another catalog than the first apply"
step "contract again" "$SB/tests/quiz_protection.sql"
behave "behaviour again" "$HERE/quiz_protection_behaviour.sql" 'QUIZ PROTECTION BEHAVIOUR PASSED'
behave "test_builder_behaviour again" "$HERE/test_builder_behaviour.sql" 'BUILDER BEHAVIOUR PASSED'

echo "ok: $OKS, failures: $FAILS"
if [ $FAILS = 0 ]; then echo "QUIZ PROTECTION CHECKS PASSED"; fi
[ $FAILS = 0 ]
