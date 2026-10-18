#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261018100000_test_builder.sql (release 47:
# guests by token, explanations, reorder, cover and colour, practice) on a scratch PostgreSQL 16 cluster:
# the base as quizzes_run.sh builds it (containers + storage stand-in + the pictures migration + item_update_images) →
# release 46 / 46.1 (20261016120000 + 20261016140000) → the catalog fingerprint of 46.1 → test_builder_behaviour.sql fails
# (the test bites) and quizzes_behaviour.sql passes with the 46.1 shapes → the migration twice (the same fingerprint) →
# the contract (tests/test_builder.sql; quiz_result_order.sql, item_update_images.sql, test_item_images.sql, containers.sql
# still hold; quizzes.sql fails only on the replaced quiz_preview(text)) → test_builder_behaviour.sql →
# quizzes_behaviour.sql with the 47 shapes → the containers, pictures and item_update_images behaviour → two tabs of one
# guest press «Начать» together (one attempt) → the rollback twice (the fingerprint of 46.1 again; quizzes_behaviour with
# the 46.1 shapes, quizzes.sql and quiz_result_order.sql pass, test_builder.sql bites) → the migration again (the same
# fingerprint as the first apply) → the contract and the behaviour again.
# The last line is TEST BUILDER CHECKS PASSED and the exit code 0 only when every step is green.
# Env (optional): BUILDER_PG_PORT (54396), BUILDER_WORK (${TMPDIR:-/tmp}/meldy-test-builder), PG_BIN (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
PORT=${BUILDER_PG_PORT:-54396}
WORK=${BUILDER_WORK:-${TMPDIR:-/tmp}/meldy-test-builder}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
MIG=$SB/migrations/20261018100000_test_builder.sql
DOWN=$SB/rollback/20261018100000_test_builder_down.sql
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
run() { "${PSQL[@]}" -d builder -f "$1" > "$WORK/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$WORK/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
step() { if run "$2"; then ok "$1"; else bad "$1"; fi; }
q() { "${PSQL[@]}" -d builder -c "$1"; }
# A behaviour file passes when its own last line is printed.
passes() { local out; out=$("${PSQL[@]}" -d builder -f "$1" 2>&1); if echo "$out" | grep -q "$2"; then return 0; fi
           echo "$out" | grep -v NOTICE | tail -6 | sed 's/^/    /'; return 1; }
behave() { if passes "$2" "$3"; then ok "$1"; else bad "$1"; fi; }
containers_contract() { local out; out=$("${PSQL[@]}" -d builder -f "$SB/tests/containers.sql" 2>&1)
                        [ $? = 0 ] && ! echo "$out" | grep -q '"contract_ok" *: *false'; }

"${PSQL[@]}" -d postgres -c "drop database if exists builder" -c "create database builder encoding 'UTF8' template template0" >/dev/null
BASE_OK=1
for f in tests/local/baseline.sql migrations/20261003083154_hackathon_journal_exams_oral.sql migrations/20261005143420_cheat_sheet.sql \
         tests/local/exam_shares_baseline.sql migrations/20261007110403_exam_shares.sql migrations/20261007110457_exam_shares_revokes.sql; do
  run "$SB/$f" || BASE_OK=0
done
q "alter table auth.users add column if not exists created_at timestamptz not null default now()" >/dev/null || BASE_OK=0
run "$SB/migrations/20261005042323_app_telemetry.sql" || BASE_OK=0
run "$SB/tests/local/ai_quota_baseline.sql" || BASE_OK=0
"${PSQL[@]}" -d builder >/dev/null <<'SQL' || BASE_OK=0
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
# Live, the API roles may read storage.objects (RLS decides what they see); the stand-in grants anon nothing, so «anon
# reads no question picture» would pass on a missing grant instead of on the policies without this line.
q "grant select on storage.objects to anon" >/dev/null || BASE_OK=0
[ $BASE_OK = 1 ] && ok "base (containers + storage stand-in, anon may select storage.objects as live)" || bad "base"
for f in 20261014120000_test_item_images.sql 20261016100000_item_update_images.sql 20261016120000_quizzes.sql \
         20261016140000_quiz_result_order.sql; do
  step "base: $f" "$SB/migrations/$f"
done

# The catalog the migration and its rollback touch: every function of public and meldy_private (source and grants),
# those schemas' grants, their relations (RLS, grants), columns, constraints, indexes, the storage policies and the
# buckets.
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
F461=$(fingerprint)
[[ "$F461" =~ ^[0-9a-f]{32}$ ]] && ok "the catalog fingerprint of release 46.1 taken" || bad "fingerprint of 46.1"

if passes "$HERE/test_builder_behaviour.sql" 'BUILDER BEHAVIOUR PASSED' >/dev/null; then
  bad "test_builder_behaviour passes before the migration (it tests nothing)"
else
  ok "test_builder_behaviour fails before the migration"
fi
behave "quizzes_behaviour passes on 46.1 (the 46.1 shapes)" "$HERE/quizzes_behaviour.sql" 'QUIZ CHECKS PASSED'

step "migration, first apply" "$MIG"
F47=$(fingerprint)
[ "$F47" != "$F461" ] && ok "the migration changed the catalog" || bad "the migration changed nothing"
step "migration, second apply (re-runnable)" "$MIG"
[ "$(fingerprint)" = "$F47" ] && ok "a second apply changes nothing in the catalog" || bad "a second apply changed the catalog"

step "contract: test_builder.sql" "$SB/tests/test_builder.sql"
step "contract: quiz_result_order.sql still holds" "$SB/tests/quiz_result_order.sql"
step "contract: item_update_images.sql still holds" "$SB/tests/item_update_images.sql"
step "contract: test_item_images.sql still holds" "$SB/tests/test_item_images.sql"
if containers_contract; then ok "contract: containers.sql still holds"; else bad "contract: containers.sql"; fi
"${PSQL[@]}" -d builder -f "$SB/tests/quizzes.sql" > "$WORK/quizzes_contract.log" 2>&1
if grep -q 'ERROR:  function_quiz_preview(text)' "$WORK/quizzes_contract.log"; then
  ok "contract: quizzes.sql stops only at the replaced quiz_preview(text) (use test_builder.sql after 47)"
else
  bad "contract: quizzes.sql after 47"; grep -v NOTICE "$WORK/quizzes_contract.log" | head -4
fi

behave "behaviour: explanations, reorder, settings, guests, throttle, claim, practice, results, pictures, covers" \
  "$HERE/test_builder_behaviour.sql" 'BUILDER BEHAVIOUR PASSED'
behave "quizzes_behaviour with the 47 shapes (every release-46 flow still works)" "$HERE/quizzes_behaviour.sql" 'QUIZ CHECKS PASSED'
if containers_contract; then ok "contract: containers.sql after the behaviour"; else bad "contract: containers.sql after the behaviour"; fi
behave "containers behaviour after the migration" "$HERE/containers_behaviour.sql" 'CONTAINER CHECKS PASSED'
behave "item_update_images behaviour after the migration" "$HERE/item_update_images_behaviour.sql" 'ITEM IMAGES CHECKS PASSED'
behave "test_item_images behaviour after the migration" "$HERE/test_item_images_behaviour.sql" 'IMAGE CHECKS PASSED'

# Two tabs of one guest press «Начать» together: the first holds the quiz row for 2 s after its start; the second waits
# on that row, then finds the token's open attempt and resumes it. One attempt, the same id twice.
TABS=$WORK/tabs; mkdir -p "$TABS"
TOKEN=TabsTabsTabsTabsTabsTabsTabsTabsTabsTabs123
CODE=$("${PSQL[@]}" -d builder 2>"$TABS/setup.err" <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) is null \g /dev/null
create temp table r as select public.container_create('Две вкладки гостя', null, '[{"title":"Предмет"}]') as j;
select public.container_items_add(((select j from r) -> 'subjects' -> 0 ->> 'id')::uuid, '[
  {"ref":"tabs:1","stem":"Первый","options":["а","б"],"correct":[0]},
  {"ref":"tabs:2","stem":"Второй","options":["а","б"],"correct":[1]}]') is null \g /dev/null
select public.quiz_create(((select j from r) ->> 'container_id')::uuid, '{"title":"Две вкладки"}') ->> 'code';
SQL
)
tab() {
  cat > "$TABS/tab$1.sql" <<SQL
set role anon;
select set_config('request.jwt.claim.sub', '', false) is null \g /dev/null
begin;
select public.quiz_guest_start('$CODE', 'Гость, вкладка $1', '$TOKEN') ->> 'attempt_id';
select pg_sleep($2) is null \g /dev/null
commit;
SQL
}
if [[ "$CODE" =~ ^[0-9a-hjkmnp-tv-z]{12}$ ]]; then
  tab 1 2; tab 2 0
  "${PSQL[@]}" -d builder -f "$TABS/tab1.sql" > "$TABS/tab1.out" 2>&1 & P1=$!
  sleep 0.7
  T0=$(date +%s.%N); "${PSQL[@]}" -d builder -f "$TABS/tab2.sql" > "$TABS/tab2.out" 2>&1; R2=$?; T1=$(date +%s.%N)
  wait $P1; R1=$?
  A1=$(grep -E '^[0-9a-f-]{36}$' "$TABS/tab1.out"); A2=$(grep -E '^[0-9a-f-]{36}$' "$TABS/tab2.out")
  N=$(q "select count(*) from public.quiz_attempts a join public.quizzes z on z.id = a.quiz_id where z.code = '$CODE'")
  WAIT=$(awk "BEGIN { printf \"%.1f\", $T1 - $T0 }")
  if [ $R1 = 0 ] && [ $R2 = 0 ] && [ -n "$A1" ] && [ "$A1" = "$A2" ] && [ "$N" = 1 ] && awk "BEGIN { exit !($T1 - $T0 > 1.0) }"; then
    ok "two tabs of one guest press «Начать» together: one attempt (the second tab waited ${WAIT} s and resumed it)"
  else
    bad "two guest tabs: attempts=$N, ids '$A1' / '$A2', waited ${WAIT} s"; cat "$TABS/tab1.out" "$TABS/tab2.out" | head -6
  fi
else
  bad "two guest tabs: fixture"; head -5 "$TABS/setup.err"
fi
q "delete from public.containers where title = 'Две вкладки гостя'" >/dev/null || bad "two guest tabs: cleanup"
q "delete from meldy_private.quiz_guest_starts" >/dev/null || bad "two guest tabs: throttle cleanup"
[ "$(fingerprint)" = "$F47" ] && ok "the catalog unchanged by the behaviour runs" || bad "the behaviour runs changed the catalog"

step "rollback" "$DOWN"
[ "$(fingerprint)" = "$F461" ] && ok "after the rollback: the catalog of release 46.1 (fingerprint)" || bad "after the rollback: another catalog than 46.1"
step "rollback again (re-runnable)" "$DOWN"
[ "$(fingerprint)" = "$F461" ] && ok "after the second rollback: still the catalog of 46.1" || bad "after the second rollback: another catalog"
step "contract after the rollback: quizzes.sql (46)" "$SB/tests/quizzes.sql"
step "contract after the rollback: quiz_result_order.sql (46.1)" "$SB/tests/quiz_result_order.sql"
if run "$SB/tests/test_builder.sql"; then bad "test_builder.sql passes after the rollback (it tests nothing)"; else ok "test_builder.sql fails after the rollback"; fi
behave "quizzes_behaviour with the 46.1 shapes after the rollback" "$HERE/quizzes_behaviour.sql" 'QUIZ CHECKS PASSED'
if containers_contract; then ok "contract: containers.sql after the rollback"; else bad "contract: containers.sql after the rollback"; fi
behave "containers behaviour after the rollback" "$HERE/containers_behaviour.sql" 'CONTAINER CHECKS PASSED'
behave "item_update_images behaviour after the rollback" "$HERE/item_update_images_behaviour.sql" 'ITEM IMAGES CHECKS PASSED'

step "migration after the rollback" "$MIG"
[ "$(fingerprint)" = "$F47" ] && ok "the same catalog as the first apply" || bad "another catalog than the first apply"
step "contract again" "$SB/tests/test_builder.sql"
behave "behaviour again" "$HERE/test_builder_behaviour.sql" 'BUILDER BEHAVIOUR PASSED'
behave "quizzes_behaviour again with the 47 shapes" "$HERE/quizzes_behaviour.sql" 'QUIZ CHECKS PASSED'

echo "ok: $OKS, failures: $FAILS"
if [ $FAILS = 0 ]; then echo "TEST BUILDER CHECKS PASSED"; fi
[ $FAILS = 0 ]
