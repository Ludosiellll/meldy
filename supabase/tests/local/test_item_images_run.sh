#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261014120000_test_item_images.sql on a
# scratch PostgreSQL 16 cluster: the containers base (as containers_run_all.sh builds it, + the containers migration, its
# revokes and follow-ups) + storage_baseline.sql → the migration twice → supabase/tests/test_item_images.sql and
# containers.sql → test_item_images_behaviour.sql → the rollback twice → the containers check → the migration again →
# the checks again. Exit code 0 only when every step is green.
# Env (optional): IMAGES_PG_PORT (54381), IMAGES_WORK (${TMPDIR:-/tmp}/meldy-images), PG_BIN (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
PORT=${IMAGES_PG_PORT:-54381}
WORK=${IMAGES_WORK:-${TMPDIR:-/tmp}/meldy-images}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
MIG=$SB/migrations/20261014120000_test_item_images.sql
DOWN=$SB/rollback/20261014120000_test_item_images_down.sql
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
run() { "${PSQL[@]}" -d imgs -f "$1" > "$WORK/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$WORK/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
step() { if run "$2"; then ok "$1"; else bad "$1"; fi; }

"${PSQL[@]}" -d postgres -c "drop database if exists imgs" -c "create database imgs encoding 'UTF8' template template0" >/dev/null
BASE_OK=1
for f in tests/local/baseline.sql migrations/20261003083154_hackathon_journal_exams_oral.sql migrations/20261005143420_cheat_sheet.sql \
         tests/local/exam_shares_baseline.sql migrations/20261007110403_exam_shares.sql migrations/20261007110457_exam_shares_revokes.sql; do
  run "$SB/$f" || BASE_OK=0
done
"${PSQL[@]}" -d imgs -c "alter table auth.users add column if not exists created_at timestamptz not null default now()" >/dev/null || BASE_OK=0
run "$SB/migrations/20261005042323_app_telemetry.sql" || BASE_OK=0
run "$SB/tests/local/ai_quota_baseline.sql" || BASE_OK=0
"${PSQL[@]}" -d imgs >/dev/null <<'SQL' || BASE_OK=0
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

step "migration, first apply" "$MIG"
step "migration, second apply (re-runnable)" "$MIG"
step "contract: test_item_images.sql" "$SB/tests/test_item_images.sql"
out=$("${PSQL[@]}" -d imgs -f "$SB/tests/containers.sql" 2>&1)
if [ $? = 0 ] && ! echo "$out" | grep -q '"contract_ok" *: *false'; then ok "contract: containers.sql"; else bad "contract: containers.sql"; echo "$out" | tail -5; fi
out=$("${PSQL[@]}" -d imgs -f "$HERE/test_item_images_behaviour.sql" 2>&1)
if echo "$out" | grep -q 'IMAGE CHECKS PASSED'; then ok "behaviour: owner, member, stranger"; else bad "behaviour"; echo "$out" | grep -v NOTICE | tail -5; fi
out=$("${PSQL[@]}" -d imgs -f "$SB/tests/local/containers_behaviour.sql" 2>&1)
if echo "$out" | grep -q 'CONTAINER CHECKS PASSED'; then ok "containers behaviour after the migration"; else bad "containers behaviour"; echo "$out" | grep -v NOTICE | tail -5; fi
step "rollback" "$DOWN"
step "rollback again" "$DOWN"
out=$("${PSQL[@]}" -d imgs -f "$SB/tests/containers.sql" 2>&1)
if [ $? = 0 ] && ! echo "$out" | grep -q '"contract_ok" *: *false'; then ok "contract after rollback: containers.sql"; else bad "contract after rollback"; echo "$out" | tail -5; fi
step "migration after the rollback" "$MIG"
step "contract again: test_item_images.sql" "$SB/tests/test_item_images.sql"
echo "failures: $FAILS"
[ $FAILS = 0 ]
