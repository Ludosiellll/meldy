#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261107090800_avatars_owner.sql on a
# scratch PostgreSQL 16 cluster: the roles and auth.uid() (baseline.sql), the storage tables (storage_baseline.sql), the
# «avatars» bucket and its four dashboard policies as they are live, an avatar of A and of B → the contract
# (supabase/tests/avatars_owner.sql) fails and the old rules let A delete B's avatar → the migration twice → the contract
# and the behaviour (avatars_owner_behaviour.sql) → the rollback twice → the contract fails, A can delete B's avatar again
# → the migration again → the contract and the behaviour again. Last line AVATARS OWNER CHECKS PASSED, exit 0, only when
# every step is green. Env (optional): AVATARS_PG_PORT (54479), AVATARS_WORK (${TMPDIR:-/tmp}/meldy-avatars), PG_BIN.
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
PORT=${AVATARS_PG_PORT:-54479}
WORK=${AVATARS_WORK:-${TMPDIR:-/tmp}/meldy-avatars}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
DB=avatars
FAILS=0
ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
as_pg() { if [ "$(id -u)" = 0 ]; then unshare --user --map-user=1000 --map-group=1000 bash -c "$1"; else bash -c "$1"; fi; }
mkdir -p "$WORK"
chmod 777 "$WORK" 2>/dev/null || true
STARTED=0
if ! "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT"; then
  mkdir -p "$WORK/pg" && chmod 777 "$WORK/pg" 2>/dev/null
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
run() { "${PSQL[@]}" -d $DB -f "$1" > "$WORK/last.log" 2>&1 || { grep -v NOTICE "$WORK/last.log" | head -4 | sed 's/^/    /'; return 1; }; }
q() { "${PSQL[@]}" -d $DB -c "$1"; }
contract_holds() { run "$SB/tests/avatars_owner.sql"; }
behaves() { "${PSQL[@]}" -d $DB -f "$HERE/avatars_owner_behaviour.sql" 2>&1 | tee "$WORK/behaviour.log" | grep -q '^AVATARS OWNER PASSED$'; }
a_deletes_b() {
  local n; n=$("${PSQL[@]}" -d $DB -c "begin; select set_config('request.jwt.claim.sub','aaaaaaaa-0000-4000-8000-00000000000a',true);
    set local role authenticated; with d as (delete from storage.objects where bucket_id='avatars' and name like 'bbbbbbbb-%' returning 1)
    select count(*) from d; rollback;" 2>/dev/null | grep -E '^[0-9]+$' | tail -1)
  [ "$n" = 1 ]
}

psql -X -q -d postgres -c "drop database if exists $DB" >/dev/null && psql -X -q -d postgres -c "create database $DB" >/dev/null \
  || { echo "no database"; exit 2; }
run "$HERE/baseline.sql" && run "$HERE/storage_baseline.sql" || { echo "the base did not build"; exit 2; }
q "insert into storage.buckets (id, name, public) values ('avatars','avatars',true), ('test-item-images','test-item-images',false)" >/dev/null
q "insert into storage.objects (bucket_id, name) values
     ('avatars','aaaaaaaa-0000-4000-8000-00000000000a-1.jpg'), ('avatars','bbbbbbbb-0000-4000-8000-00000000000b-1.jpg'),
     ('test-item-images','c0ffee00-0000-4000-8000-000000000001/x.png')" >/dev/null
q "create policy \"Avatars Access 1oj01fe_0\" on storage.objects for select to authenticated using (bucket_id = 'avatars');
   create policy \"Avatars Access 1oj01fe_1\" on storage.objects for insert to authenticated with check (bucket_id = 'avatars');
   create policy \"Avatars Access 1oj01fe_2\" on storage.objects for update to authenticated using (bucket_id = 'avatars');
   create policy \"Avatars Access 1oj01fe_3\" on storage.objects for delete to authenticated using (bucket_id = 'avatars');" >/dev/null

echo "before the migration"
if contract_holds; then bad "the contract fails before"; else ok "the contract fails before"; fi
if a_deletes_b; then ok "the live rules let A delete B's avatar (the hole)"; else bad "the live rules let A delete B's avatar"; fi
echo "the migration, twice"
if run "$SB/migrations/20261107090800_avatars_owner.sql" && run "$SB/migrations/20261107090800_avatars_owner.sql"; then ok "applied twice"; else bad "applied twice"; fi
if contract_holds; then ok "the contract holds"; else bad "the contract holds"; fi
if behaves; then ok "the behaviour holds"; else bad "the behaviour holds"; tail -3 "$WORK/behaviour.log" | sed 's/^/    /'; fi
if a_deletes_b; then bad "A can no longer delete B's avatar"; else ok "A can no longer delete B's avatar"; fi
echo "the rollback, twice"
if run "$SB/rollback/20261107090800_avatars_owner_down.sql" && run "$SB/rollback/20261107090800_avatars_owner_down.sql"; then ok "rolled back twice"; else bad "rolled back twice"; fi
if contract_holds; then bad "the contract fails after the rollback"; else ok "the contract fails after the rollback"; fi
if a_deletes_b; then ok "the old rules are back"; else bad "the old rules are back"; fi
echo "the migration again"
if run "$SB/migrations/20261107090800_avatars_owner.sql"; then ok "applied again"; else bad "applied again"; fi
if contract_holds; then ok "the contract holds again"; else bad "the contract holds again"; fi
if behaves; then ok "the behaviour holds again"; else bad "the behaviour holds again"; fi
if [ $FAILS = 0 ]; then echo "AVATARS OWNER CHECKS PASSED"; exit 0; fi
echo "$FAILS step(s) failed"; exit 1
