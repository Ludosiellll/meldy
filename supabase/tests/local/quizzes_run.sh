#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261016120000_quizzes.sql («Контрольная»,
# release 46) on a scratch PostgreSQL 16 cluster: the containers base (as item_update_images_run.sh builds it) + the
# pictures migration (20261014120000) + 20261016100000_item_update_images.sql → the behaviour before the migration (it
# must fail: the test bites) → the migration twice (the second changes nothing in the catalog) → the contract
# (tests/quizzes.sql) → quizzes_behaviour.sql → the containers and item_update_images contracts and behaviour → two tabs
# press «Начать» together (one attempt) → the rollback twice (tables, functions, the storage policy gone) → the migration
# again (the same catalog) → the behaviour again. Exit code 0 only when every step is green.
# Env (optional): QUIZ_PG_PORT (54394), QUIZ_WORK (${TMPDIR:-/tmp}/meldy-quizzes), PG_BIN (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
PORT=${QUIZ_PG_PORT:-54394}
WORK=${QUIZ_WORK:-${TMPDIR:-/tmp}/meldy-quizzes}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
MIG=$SB/migrations/20261016120000_quizzes.sql
DOWN=$SB/rollback/20261016120000_quizzes_down.sql
# release 46.1: the review orders the options as the attempt did (quiz_result_json gives shuffle_options, keep_order)
MIG2=$SB/migrations/20261016140000_quiz_result_order.sql
DOWN2=$SB/rollback/20261016140000_quiz_result_order_down.sql
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
FAILS=0
ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
as_pg() { if [ "$(id -u)" = 0 ]; then unshare --user --map-user=1000 --map-group=1000 bash -c "$1"; else bash -c "$1"; fi; }
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
run() { "${PSQL[@]}" -d quizzes -f "$1" > "$WORK/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$WORK/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
step() { if run "$2"; then ok "$1"; else bad "$1"; fi; }
q() { "${PSQL[@]}" -d quizzes -c "$1"; }

"${PSQL[@]}" -d postgres -c "drop database if exists quizzes" -c "create database quizzes encoding 'UTF8' template template0" >/dev/null
BASE_OK=1
for f in tests/local/baseline.sql migrations/20261003083154_hackathon_journal_exams_oral.sql migrations/20261005143420_cheat_sheet.sql \
         tests/local/exam_shares_baseline.sql migrations/20261007110403_exam_shares.sql migrations/20261007110457_exam_shares_revokes.sql; do
  run "$SB/$f" || BASE_OK=0
done
q "alter table auth.users add column if not exists created_at timestamptz not null default now()" >/dev/null || BASE_OK=0
run "$SB/migrations/20261005042323_app_telemetry.sql" || BASE_OK=0
run "$SB/tests/local/ai_quota_baseline.sql" || BASE_OK=0
"${PSQL[@]}" -d quizzes >/dev/null <<'SQL' || BASE_OK=0
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
         migrations/20261010074500_containers_fk_indexes.sql migrations/20261010110000_containers_oral_codes_closed.sql \
         migrations/20261010130000_containers_frozen_pace.sql migrations/20261011100000_containers_not_found_null.sql \
         tests/local/storage_baseline.sql; do
  run "$SB/$f" || BASE_OK=0
done
[ $BASE_OK = 1 ] && ok "base (containers + storage stand-in)" || bad "base"
run "$SB/migrations/20261014120000_test_item_images.sql" && ok "base: the pictures migration" || bad "base: the pictures migration"
run "$SB/migrations/20261016100000_item_update_images.sql" && ok "base: item_update_images" || bad "base: item_update_images"

behaviour() { "${PSQL[@]}" -d quizzes -f "$HERE/quizzes_behaviour.sql" 2>&1; }
out=$(behaviour)
if echo "$out" | grep -q 'QUIZ CHECKS PASSED'; then bad "the behaviour passes before the migration (it tests nothing)"; else ok "the behaviour fails before the migration"; fi

# The catalog of the migration: function sources, columns, constraints, indexes, grants, RLS, the storage policy.
fingerprint() {
  q "select md5(concat_ws('|',
     (select string_agg(p.oid::regprocedure::text || pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), '' order by p.oid::regprocedure::text)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where (n.nspname in ('public', 'meldy_private') and p.proname like 'quiz\_%') or p.proname = 'my_quiz_container_ids'),
     (select string_agg(c.relname || ':' || c.relrowsecurity || ':' || coalesce(c.relacl::text, ''), ',' order by c.relname)
        from pg_class c where c.relnamespace = 'public'::regnamespace and c.relname in ('quizzes', 'quiz_attempts', 'quiz_answers')),
     (select string_agg(table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' ' || coalesce(column_default, ''), ','
                        order by table_name, ordinal_position)
        from information_schema.columns where table_schema = 'public' and table_name in ('quizzes', 'quiz_attempts', 'quiz_answers')),
     (select string_agg(conname || pg_get_constraintdef(oid), ',' order by conname) from pg_constraint
       where conrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace and relname in ('quizzes', 'quiz_attempts', 'quiz_answers'))),
     (select string_agg(indexdef, ',' order by indexname) from pg_indexes
       where schemaname = 'public' and tablename in ('quizzes', 'quiz_attempts', 'quiz_answers')),
     (select string_agg(policyname || cmd || roles::text || coalesce(qual, ''), ',' order by policyname) from pg_policies
       where schemaname = 'storage' and policyname = 'Test item images: quiz takers read')))"
}
step "migration, first apply" "$MIG"
step "follow-up quiz_result_order, first apply" "$MIG2"
AFTER=$(fingerprint)
step "migration, second apply (re-runnable)" "$MIG"
step "follow-up quiz_result_order, second apply" "$MIG2"
[ "$(fingerprint)" = "$AFTER" ] && ok "a second apply changes nothing in the catalog" || bad "a second apply changed the catalog"
step "contract: quizzes.sql" "$SB/tests/quizzes.sql"
step "contract: quiz_result_order.sql" "$SB/tests/quiz_result_order.sql"
# the follow-up's own rollback: back to the release-46 body (the contract bites), then forward again (same catalog)
step "follow-up rollback" "$DOWN2"
if run "$SB/tests/quiz_result_order.sql"; then bad "quiz_result_order.sql passes after its rollback (it tests nothing)"; else ok "quiz_result_order.sql fails after its rollback"; fi
step "follow-up again" "$MIG2"
[ "$(fingerprint)" = "$AFTER" ] && ok "follow-up after its rollback: the same catalog" || bad "follow-up after its rollback: another catalog"
out=$(behaviour)
if echo "$out" | grep -q 'QUIZ CHECKS PASSED'; then ok "behaviour: create, preview, start, answer, finish, review, limits, results, key change, storage"
else bad "behaviour"; echo "$out" | grep -v NOTICE | tail -6 | sed 's/^/    /'; fi
step "contract: item_update_images.sql" "$SB/tests/item_update_images.sql"
out=$("${PSQL[@]}" -d quizzes -f "$HERE/item_update_images_behaviour.sql" 2>&1)
if echo "$out" | grep -q 'ITEM IMAGES CHECKS PASSED'; then ok "item_update_images behaviour after the migration"; else bad "item_update_images behaviour"; echo "$out" | grep -v NOTICE | tail -5; fi
out=$("${PSQL[@]}" -d quizzes -f "$SB/tests/containers.sql" 2>&1)
if [ $? = 0 ] && ! echo "$out" | grep -q '"contract_ok" *: *false'; then ok "contract: containers.sql"; else bad "contract: containers.sql"; echo "$out" | tail -5; fi
out=$("${PSQL[@]}" -d quizzes -f "$HERE/containers_behaviour.sql" 2>&1)
if echo "$out" | grep -q 'CONTAINER CHECKS PASSED'; then ok "containers behaviour after the migration"; else bad "containers behaviour"; echo "$out" | grep -v NOTICE | tail -5; fi

# Two tabs of one participant press «Начать» together (Review Focus 4): the first holds the quiz row for 2 s after its
# start; the second waits on that row, then finds the open attempt and resumes it. One attempt, the same id twice.
TABS=$WORK/tabs; mkdir -p "$TABS"
CODE=$("${PSQL[@]}" -d quizzes 2>"$TABS/setup.err" <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) is null \g /dev/null
create temp table r as select public.container_create('Две вкладки', null, '[{"title":"Предмет"}]') as j;
select public.container_items_add(((select j from r) -> 'subjects' -> 0 ->> 'id')::uuid, '[
  {"ref":"tabs:1","stem":"Первый","options":["а","б"],"correct":[0]},
  {"ref":"tabs:2","stem":"Второй","options":["а","б"],"correct":[1]}]') is null \g /dev/null
select public.quiz_create(((select j from r) ->> 'container_id')::uuid, '{"title":"Две вкладки"}') ->> 'code';
SQL
)
tab() {
  cat > "$TABS/tab$1.sql" <<SQL
set role authenticated;
select set_config('request.jwt.claim.sub', 'cccccccc-0000-0000-0000-000000000003', false) is null \g /dev/null
begin;
select public.quiz_start('$CODE', 'Вера, вкладка $1') ->> 'attempt_id';
select pg_sleep($2) is null \g /dev/null
commit;
SQL
}
if [[ "$CODE" =~ ^[0-9a-hjkmnp-tv-z]{12}$ ]]; then
  tab 1 2; tab 2 0
  "${PSQL[@]}" -d quizzes -f "$TABS/tab1.sql" > "$TABS/tab1.out" 2>&1 & P1=$!
  sleep 0.7
  T0=$(date +%s.%N); "${PSQL[@]}" -d quizzes -f "$TABS/tab2.sql" > "$TABS/tab2.out" 2>&1; R2=$?; T1=$(date +%s.%N)
  wait $P1; R1=$?
  A1=$(grep -E '^[0-9a-f-]{36}$' "$TABS/tab1.out"); A2=$(grep -E '^[0-9a-f-]{36}$' "$TABS/tab2.out")
  N=$(q "select count(*) from public.quiz_attempts a join public.quizzes z on z.id = a.quiz_id
          where z.code = '$CODE' and a.user_id = 'cccccccc-0000-0000-0000-000000000003'")
  WAIT=$(awk "BEGIN { printf \"%.1f\", $T1 - $T0 }")
  if [ $R1 = 0 ] && [ $R2 = 0 ] && [ -n "$A1" ] && [ "$A1" = "$A2" ] && [ "$N" = 1 ] && awk "BEGIN { exit !($T1 - $T0 > 1.0) }"; then
    ok "two tabs press «Начать» together: one attempt (the second tab waited ${WAIT} s and resumed it)"
  else
    bad "two tabs: attempts=$N, ids '$A1' / '$A2', waited ${WAIT} s"; cat "$TABS/tab1.out" "$TABS/tab2.out" | head -6
  fi
else
  bad "two tabs: fixture"; head -5 "$TABS/setup.err"
fi
q "delete from public.containers where title = 'Две вкладки'" >/dev/null || bad "two tabs: cleanup"

step "rollback" "$DOWN"
step "rollback again" "$DOWN"
GONE=$(q "select (select count(*) from pg_class where relnamespace = 'public'::regnamespace and relname in ('quizzes', 'quiz_attempts', 'quiz_answers'))
           || ' ' || (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                       where (n.nspname in ('public', 'meldy_private') and p.proname like 'quiz\_%') or p.proname = 'my_quiz_container_ids')
           || ' ' || (select count(*) from pg_policies where schemaname = 'storage' and policyname = 'Test item images: quiz takers read')")
[ "$GONE" = "0 0 0" ] && ok "the rollback leaves no table, function or policy (tables functions policy: $GONE)" || bad "the rollback left: $GONE"
out=$("${PSQL[@]}" -d quizzes -f "$SB/tests/containers.sql" 2>&1)
if [ $? = 0 ] && ! echo "$out" | grep -q '"contract_ok" *: *false'; then ok "contract: containers.sql after the rollback"; else bad "containers after the rollback"; fi
step "migration after the rollback" "$MIG"
step "follow-up after the rollback" "$MIG2"
[ "$(fingerprint)" = "$AFTER" ] && ok "the same catalog as the first apply" || bad "another catalog than the first apply"
step "contract again" "$SB/tests/quizzes.sql"
step "contract again: quiz_result_order.sql" "$SB/tests/quiz_result_order.sql"
out=$(behaviour)
if echo "$out" | grep -q 'QUIZ CHECKS PASSED'; then ok "behaviour again"; else bad "behaviour again"; echo "$out" | grep -v NOTICE | tail -6 | sed 's/^/    /'; fi
echo "failures: $FAILS"
[ $FAILS = 0 ]
