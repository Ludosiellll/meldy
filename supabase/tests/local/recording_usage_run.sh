#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261026090000_recording_usage.sql on a
# scratch PostgreSQL 16 cluster: baseline.sql + ai_quota_baseline.sql (A free, B PRO) → the contract fails before the
# migration → the migration twice (the second changes nothing) → the contract and recording_usage_behaviour.sql → the
# rollback twice (the catalog as before) → the migration again → the behaviour again. Exit code 0 only when every step
# is green. Env (optional): RECUSE_PG_PORT (54395), RECUSE_WORK (${TMPDIR:-/tmp}/meldy-recuse), PG_BIN.
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
PORT=${RECUSE_PG_PORT:-54395}
WORK=${RECUSE_WORK:-${TMPDIR:-/tmp}/meldy-recuse}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
MIG=$SB/migrations/20261026090000_recording_usage.sql
DOWN=$SB/rollback/20261026090000_recording_usage_down.sql
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
run() { "${PSQL[@]}" -d recuse -f "$1" > "$WORK/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$WORK/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
step() { if run "$2"; then ok "$1"; else bad "$1"; fi; }
catalog() {
  "${PSQL[@]}" -d recuse -c "select md5(string_agg(x, '|' order by x)) from (
    select 'f:' || p.oid::regprocedure::text || ':' || md5(pg_get_functiondef(p.oid)) || ':' || coalesce(array_to_string(p.proacl, ','), '') as x
      from pg_proc p where p.pronamespace = 'public'::regnamespace
    union all select 't:' || c.relname || ':' || c.relkind::text || ':' || coalesce(array_to_string(c.relacl, ','), '') || ':' || c.relrowsecurity::text
      from pg_class c where c.relnamespace = 'public'::regnamespace) s"
}

"${PSQL[@]}" -d postgres -c "drop database if exists recuse" -c "create database recuse encoding 'UTF8' template template0" >/dev/null
BASE_OK=1
for f in tests/local/baseline.sql tests/local/ai_quota_baseline.sql; do run "$SB/$f" || BASE_OK=0; done
[ $BASE_OK = 1 ] && ok "base (roles, auth, A free and B PRO)" || bad "base"
if run "$SB/tests/recording_usage.sql" 2>/dev/null >/dev/null; then bad "the contract fails before the migration"; else ok "the contract fails before the migration"; fi
BEFORE=$(catalog)
[ -n "$BEFORE" ] && ok "the catalog reads (base)" || bad "the catalog query failed"
step "migration, first apply" "$MIG"
AFTER=$(catalog)
[ -n "$AFTER" ] && [ "$AFTER" != "$BEFORE" ] && ok "the migration changed the catalog" || bad "the catalog is the same as before the migration"
step "migration, second apply (re-runnable)" "$MIG"
[ "$(catalog)" = "$AFTER" ] && ok "a second apply changes nothing in the catalog" || bad "a second apply changed the catalog"
step "contract (supabase/tests/recording_usage.sql)" "$SB/tests/recording_usage.sql"
out=$("${PSQL[@]}" -d recuse -f "$HERE/recording_usage_behaviour.sql" 2>&1)
if echo "$out" | grep -q 'RECORDING USAGE CHECKS PASSED' && echo "$out" | grep -q 'ANON RECORDING USAGE CHECKS PASSED'; then
  ok "behaviour (recording_usage_behaviour.sql)"
else
  bad "behaviour"; echo "$out" | grep -v NOTICE | tail -5
fi
step "rollback, first run" "$DOWN"
step "rollback, second run (re-runnable)" "$DOWN"
[ "$(catalog)" = "$BEFORE" ] && ok "after the rollback the catalog equals the base" || bad "the rollback left the catalog changed"
step "migration again" "$MIG"
[ "$(catalog)" = "$AFTER" ] && ok "applied again: the same catalog as the first apply" || bad "the second apply differs"
out=$("${PSQL[@]}" -d recuse -f "$HERE/recording_usage_behaviour.sql" 2>&1)
echo "$out" | grep -q 'RECORDING USAGE CHECKS PASSED' && ok "behaviour again" || { bad "behaviour again"; echo "$out" | tail -3; }
echo "recording_usage rehearsal: $FAILS failed"
exit $((FAILS > 0))
