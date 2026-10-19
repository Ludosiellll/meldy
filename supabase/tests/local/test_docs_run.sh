#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261019100000_test_docs.sql (release 47.1,
# «Студия теста»: the test document, quizzes «как в студии») on a scratch PostgreSQL 16 cluster:
# the base in the live order (containers + storage stand-in + pgcrypto in extensions, then every later migration up to
# 20261018130000_quiz_guards.sql: the bot's packages with pg_cron / pg_net stubbed when not installed, the frozen day, the
# Mini App, «not found», the monitor, pictures, the bot skips pictures, the tempo, item_update_images, release 46 / 46.1,
# release 47 = 20261018100000, 20261018120000_exam_move_bot_exams, 20261018130000_quiz_guards, 20261018140000_quiz_practice_grace,
# release 47.3 = 20261019090000_container_kind) → the catalog fingerprint
# of that base → test_docs_behaviour.sql fails (the test bites), the guards' and the exam move's contracts, the guards',
# test_builder and quizzes behaviour pass → the migration, then its follow-up 20261019110000_doc_video.sql (the video
# block in meldy_private.test_doc_ok; tests/doc_video.sql and doc_video_behaviour.sql fail in between), both twice (the
# same fingerprint) → the contracts (tests/test_docs.sql, tests/doc_video.sql; quiz_guards.sql, exam_move_bot_exams.sql,
# test_builder.sql, quizzes.sql, quiz_result_order.sql, item_update_images.sql, test_item_images.sql, containers.sql
# still hold) → test_docs_behaviour.sql, doc_video_behaviour.sql → test_docs_parity.sql (test_doc_ok gives each document
# of contracts/studio/test_doc_cases.json, the video cases among them, the first rule the client's docProblems gives it) →
# quiz_guards_behaviour, test_builder_behaviour, quizzes_behaviour, containers, pictures and item_update_images
# behaviour → two tabs save the first revision together (one revision, the other MC020 stale) → the video rollback twice
# (the fingerprint after 20261019100000 alone: its test_doc_ok byte for byte; the video contract and behaviour bite,
# test_docs.sql and its behaviour hold)
# → the rollback twice (the fingerprint of the base again: the guards' bodies byte for byte; the guards' and release-47
# contracts and behaviour pass, test_docs.sql bites) → both migrations again (the same fingerprint as the first apply) →
# the contracts and the behaviour again.
# The last line is TEST DOCS CHECKS PASSED and the exit code 0 only when every step is green.
# Env (optional): DOCS_PG_PORT (54400), DOCS_WORK (${TMPDIR:-/tmp}/meldy-test-docs), PG_BIN (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
PORT=${DOCS_PG_PORT:-54400}
WORK=${DOCS_WORK:-${TMPDIR:-/tmp}/meldy-test-docs}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
MIG=$SB/migrations/20261019100000_test_docs.sql
VID=$SB/migrations/20261019110000_doc_video.sql
VID_DOWN=$SB/rollback/20261019110000_doc_video_down.sql
CASES=$(cd "$SB/.." && pwd)/contracts/studio/test_doc_cases.json
DOWN=$SB/rollback/20261019100000_test_docs_down.sql
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
run() { "${PSQL[@]}" -d docs -f "$1" > "$WORK/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$WORK/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
step() { if run "$2"; then ok "$1"; else bad "$1"; fi; }
q() { "${PSQL[@]}" -d docs -c "$1"; }
# A behaviour file passes when its own last line is printed.
passes() { local out; out=$("${PSQL[@]}" -d docs -f "$1" 2>&1); if echo "$out" | grep -q "$2"; then return 0; fi
           echo "$out" | grep -v NOTICE | tail -6 | sed 's/^/    /'; return 1; }
behave() { if passes "$2" "$3"; then ok "$1"; else bad "$1"; fi; }
containers_contract() { local out; out=$("${PSQL[@]}" -d docs -f "$SB/tests/containers.sql" 2>&1)
                        [ $? = 0 ] && ! echo "$out" | grep -q '"contract_ok" *: *false'; }

"${PSQL[@]}" -d postgres -c "drop database if exists docs" -c "create database docs encoding 'UTF8' template template0" >/dev/null
BASE_OK=1
for f in tests/local/baseline.sql migrations/20261003083154_hackathon_journal_exams_oral.sql migrations/20261005143420_cheat_sheet.sql \
         tests/local/exam_shares_baseline.sql migrations/20261007110403_exam_shares.sql migrations/20261007110457_exam_shares_revokes.sql; do
  run "$SB/$f" || BASE_OK=0
done
q "alter table auth.users add column if not exists created_at timestamptz not null default now()" >/dev/null || BASE_OK=0
run "$SB/migrations/20261005042323_app_telemetry.sql" || BASE_OK=0
run "$SB/tests/local/ai_quota_baseline.sql" || BASE_OK=0
"${PSQL[@]}" -d docs >/dev/null <<'SQL' || BASE_OK=0
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
  "${PSQL[@]}" -d docs >/dev/null <<'SQL' || BASE_OK=0
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
         20261018140000_quiz_practice_grace.sql 20261019090000_container_kind.sql; do
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
[[ "$FBASE" =~ ^[0-9a-f]{32}$ ]] && ok "the catalog fingerprint of the live base (up to 20261019090000_container_kind) taken" \
  || bad "fingerprint of the live base"

if passes "$HERE/test_docs_behaviour.sql" 'TEST DOCS BEHAVIOUR PASSED' >/dev/null; then
  bad "test_docs_behaviour passes before the migration (it tests nothing)"
else
  ok "test_docs_behaviour fails before the migration"
fi
if run "$SB/tests/test_docs.sql"; then bad "test_docs.sql passes before the migration (it tests nothing)"; else ok "test_docs.sql fails before the migration"; fi
step "contract: quiz_guards.sql holds on the base" "$SB/tests/quiz_guards.sql"
step "contract: exam_move_bot_exams.sql holds on the base" "$SB/tests/exam_move_bot_exams.sql"
behave "quiz_guards_behaviour passes on the base" "$HERE/quiz_guards_behaviour.sql" 'QUIZ GUARDS BEHAVIOUR PASSED'
behave "test_builder_behaviour passes on the base (47 with the guards)" "$HERE/test_builder_behaviour.sql" 'BUILDER BEHAVIOUR PASSED'
behave "quizzes_behaviour passes on the base (the 47 shapes)" "$HERE/quizzes_behaviour.sql" 'QUIZ CHECKS PASSED'

step "migration, first apply" "$MIG"
FMIG=$(fingerprint)
[ "$FMIG" != "$FBASE" ] && ok "the migration changed the catalog" || bad "the migration changed nothing"
if run "$SB/tests/doc_video.sql"; then bad "doc_video.sql passes before its migration (it tests nothing)"; else ok "doc_video.sql fails before 20261019110000_doc_video.sql"; fi
if passes "$HERE/doc_video_behaviour.sql" 'DOC VIDEO BEHAVIOUR PASSED' >/dev/null; then
  bad "doc_video_behaviour passes before its migration (it tests nothing)"
else
  ok "doc_video_behaviour fails before 20261019110000_doc_video.sql"
fi
step "doc_video migration (the video block), first apply" "$VID"
F471=$(fingerprint)
[ "$F471" != "$FMIG" ] && ok "the video migration changed the catalog (test_doc_ok)" || bad "the video migration changed nothing"
step "migration, second apply (re-runnable)" "$MIG"
step "doc_video migration, second apply (re-runnable)" "$VID"
[ "$(fingerprint)" = "$F471" ] && ok "a second apply of both changes nothing in the catalog" || bad "a second apply changed the catalog"
step "doc_video migration, third apply on its own" "$VID"
[ "$(fingerprint)" = "$F471" ] && ok "the video migration again on its own changes nothing" || bad "the video migration again changed the catalog"

step "contract: test_docs.sql" "$SB/tests/test_docs.sql"
step "contract: doc_video.sql (the video block's rules)" "$SB/tests/doc_video.sql"
step "contract: quiz_guards.sql still holds (practice with ready, the HMAC throttle, its prune before the count)" \
  "$SB/tests/quiz_guards.sql"
step "contract: exam_move_bot_exams.sql still holds" "$SB/tests/exam_move_bot_exams.sql"
step "contract: test_builder.sql still holds" "$SB/tests/test_builder.sql"
step "contract: quizzes.sql still holds" "$SB/tests/quizzes.sql"
step "contract: quiz_result_order.sql still holds" "$SB/tests/quiz_result_order.sql"
step "contract: item_update_images.sql still holds" "$SB/tests/item_update_images.sql"
step "contract: test_item_images.sql still holds" "$SB/tests/test_item_images.sql"
if containers_contract; then ok "contract: containers.sql still holds"; else bad "contract: containers.sql"; fi

behave "behaviour: the rules, get / save, revisions, size, dangling blocks, design quizzes, guests, bands" \
  "$HERE/test_docs_behaviour.sql" 'TEST DOCS BEHAVIOUR PASSED'
behave "doc_video behaviour: a page with videos saved and read back, broken videos refused, the participant gets them" \
  "$HERE/doc_video_behaviour.sql" 'DOC VIDEO BEHAVIOUR PASSED'
# The client's docProblems (frontend/src/lib/studio/doc.ts) runs the same documents in doc.test.ts: the same first rule
# for each case of contracts/studio/test_doc_cases.json. psql reads the file through the \set line written here.
parity() {
  local out
  out=$({ printf '\\set cases `cat %q`\n' "$CASES"; cat "$HERE/test_docs_parity.sql"; } | "${PSQL[@]}" -d docs 2>&1)
  if echo "$out" | grep -q 'TEST DOC PARITY PASSED'; then ok "$1 ($(echo "$out" | grep '^PARITY [0-9]'))"
  else bad "$1"; echo "$out" | grep -v NOTICE | tail -15 | sed 's/^/    /'; fi
}
parity "parity: test_doc_ok and the client's docProblems give every case of test_doc_cases.json the same first rule"
behave "quiz_guards_behaviour after the migration (practice waits for the closing, the HMAC throttle, the prune)" \
  "$HERE/quiz_guards_behaviour.sql" 'QUIZ GUARDS BEHAVIOUR PASSED'
behave "test_builder_behaviour after the migration (every release-47 flow still works)" "$HERE/test_builder_behaviour.sql" 'BUILDER BEHAVIOUR PASSED'
behave "quizzes_behaviour after the migration (every release-46 flow still works)" "$HERE/quizzes_behaviour.sql" 'QUIZ CHECKS PASSED'
if containers_contract; then ok "contract: containers.sql after the behaviour"; else bad "contract: containers.sql after the behaviour"; fi
behave "containers behaviour after the migration" "$HERE/containers_behaviour.sql" 'CONTAINER CHECKS PASSED'
behave "item_update_images behaviour after the migration" "$HERE/item_update_images_behaviour.sql" 'ITEM IMAGES CHECKS PASSED'
behave "test_item_images behaviour after the migration" "$HERE/test_item_images_behaviour.sql" 'IMAGE CHECKS PASSED'

# Two tabs of the author save the first revision together: the first holds the exam row for 2 s after its save; the
# second waits on that row, then finds revision 1 and is refused (MC020 stale). One document, revision 1.
TABS=$WORK/tabs; mkdir -p "$TABS"
DOC='{"v":1,"title":"Две вкладки","theme":{"accent":"blue","background":{"kind":"plain"},"font":"onest","radius":"soft","density":"airy","answers":"list","buttons":"pill"},"layout":"one_by_one","blocks":[],"results":{"bands":[],"cta":null}}'
EXAM=$("${PSQL[@]}" -d docs 2>"$TABS/setup.err" <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) is null \g /dev/null
select public.container_create('Две вкладки студии', null, '[{"title":"Предмет"}]') ->> 'container_id';
SQL
)
tab() {
  cat > "$TABS/tab$1.sql" <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) is null \g /dev/null
begin;
select public.test_doc_save('$EXAM', '$DOC', 0) ->> 'rev';
select pg_sleep($2) is null \g /dev/null
commit;
SQL
}
if [[ "$EXAM" =~ ^[0-9a-f-]{36}$ ]]; then
  tab 1 2; tab 2 0
  "${PSQL[@]}" -d docs -f "$TABS/tab1.sql" > "$TABS/tab1.out" 2>&1 & P1=$!
  sleep 0.7
  T0=$(date +%s.%N); "${PSQL[@]}" -d docs -f "$TABS/tab2.sql" > "$TABS/tab2.out" 2>&1; R2=$?; T1=$(date +%s.%N)
  wait $P1; R1=$?
  N=$(q "select count(*) || ':' || max(rev) from public.test_docs where container_id = '$EXAM'")
  WAIT=$(awk "BEGIN { printf \"%.1f\", $T1 - $T0 }")
  if [ $R1 = 0 ] && grep -qx 1 "$TABS/tab1.out" && [ $R2 != 0 ] && grep -q 'stale' "$TABS/tab2.out" && [ "$N" = 1:1 ] \
     && awk "BEGIN { exit !($T1 - $T0 > 1.0) }"; then
    ok "two tabs save the first revision together: one revision, the second tab waited ${WAIT} s and got MC020 stale"
  else
    bad "two tabs: documents:rev=$N, waited ${WAIT} s"; cat "$TABS/tab1.out" "$TABS/tab2.out" | head -6
  fi
else
  bad "two tabs: fixture"; head -5 "$TABS/setup.err"
fi
q "delete from public.containers where title = 'Две вкладки студии'" >/dev/null || bad "two tabs: cleanup"
[ "$(fingerprint)" = "$F471" ] && ok "the catalog unchanged by the behaviour runs" || bad "the behaviour runs changed the catalog"

step "rollback of doc_video" "$VID_DOWN"
[ "$(fingerprint)" = "$FMIG" ] && ok "after the video rollback: the catalog of 20261019100000 alone (its test_doc_ok byte for byte)" \
  || bad "after the video rollback: another catalog than 20261019100000 alone"
step "rollback of doc_video again (re-runnable)" "$VID_DOWN"
[ "$(fingerprint)" = "$FMIG" ] && ok "after the second video rollback: still 20261019100000 alone" || bad "after the second video rollback: another catalog"
if run "$SB/tests/doc_video.sql"; then bad "doc_video.sql passes after its rollback (it tests nothing)"; else ok "doc_video.sql fails after the video rollback"; fi
if passes "$HERE/doc_video_behaviour.sql" 'DOC VIDEO BEHAVIOUR PASSED' >/dev/null; then
  bad "doc_video_behaviour passes after its rollback"
else
  ok "doc_video_behaviour fails after the video rollback"
fi
step "contract after the video rollback: test_docs.sql still holds" "$SB/tests/test_docs.sql"
behave "behaviour after the video rollback" "$HERE/test_docs_behaviour.sql" 'TEST DOCS BEHAVIOUR PASSED'

step "rollback" "$DOWN"
[ "$(fingerprint)" = "$FBASE" ] && ok "after the rollback: the catalog of the live base (fingerprint, the guards' bodies byte for byte)" \
  || bad "after the rollback: another catalog than the live base"
step "rollback again (re-runnable)" "$DOWN"
[ "$(fingerprint)" = "$FBASE" ] && ok "after the second rollback: still the catalog of the live base" || bad "after the second rollback: another catalog"
step "contract after the rollback: quiz_guards.sql" "$SB/tests/quiz_guards.sql"
step "contract after the rollback: test_builder.sql (47)" "$SB/tests/test_builder.sql"
step "contract after the rollback: quizzes.sql" "$SB/tests/quizzes.sql"
step "contract after the rollback: quiz_result_order.sql" "$SB/tests/quiz_result_order.sql"
if run "$SB/tests/test_docs.sql"; then bad "test_docs.sql passes after the rollback (it tests nothing)"; else ok "test_docs.sql fails after the rollback"; fi
behave "quiz_guards_behaviour after the rollback" "$HERE/quiz_guards_behaviour.sql" 'QUIZ GUARDS BEHAVIOUR PASSED'
behave "test_builder_behaviour after the rollback" "$HERE/test_builder_behaviour.sql" 'BUILDER BEHAVIOUR PASSED'
behave "quizzes_behaviour after the rollback (the 47 shapes)" "$HERE/quizzes_behaviour.sql" 'QUIZ CHECKS PASSED'
if containers_contract; then ok "contract: containers.sql after the rollback"; else bad "contract: containers.sql after the rollback"; fi
behave "containers behaviour after the rollback" "$HERE/containers_behaviour.sql" 'CONTAINER CHECKS PASSED'

step "migration after the rollback" "$MIG"
step "doc_video migration after the rollback" "$VID"
[ "$(fingerprint)" = "$F471" ] && ok "the same catalog as the first apply" || bad "another catalog than the first apply"
step "contract again" "$SB/tests/test_docs.sql"
step "contract: doc_video.sql again" "$SB/tests/doc_video.sql"
parity "parity again: test_doc_ok and docProblems agree on every case of test_doc_cases.json"
step "contract: quiz_guards.sql again" "$SB/tests/quiz_guards.sql"
behave "behaviour again" "$HERE/test_docs_behaviour.sql" 'TEST DOCS BEHAVIOUR PASSED'
behave "doc_video behaviour again" "$HERE/doc_video_behaviour.sql" 'DOC VIDEO BEHAVIOUR PASSED'
behave "quiz_guards_behaviour again" "$HERE/quiz_guards_behaviour.sql" 'QUIZ GUARDS BEHAVIOUR PASSED'
behave "test_builder_behaviour again" "$HERE/test_builder_behaviour.sql" 'BUILDER BEHAVIOUR PASSED'
behave "quizzes_behaviour again" "$HERE/quizzes_behaviour.sql" 'QUIZ CHECKS PASSED'

echo "ok: $OKS, failures: $FAILS"
if [ $FAILS = 0 ]; then echo "TEST DOCS CHECKS PASSED"; fi
[ $FAILS = 0 ]
