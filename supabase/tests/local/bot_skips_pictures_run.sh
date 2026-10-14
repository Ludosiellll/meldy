#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261014150000_bot_skips_pictures.sql on a
# scratch PostgreSQL 16 cluster: telegram_bot_run.sh builds the base with every bot package and leaves its database
# t_main → storage_baseline.sql and the pictures migration (20261014120000) → this migration twice →
# bot_skips_pictures_behaviour.sql → the rollback twice (the two functions as before, byte for byte) → the migration
# again → the behaviour again → the bot's contract (supabase/tests/telegram_bot.sql) still ok. Exit code 0 only when
# every step is green.
# Env (optional): SKIPS_PG_PORT (54391), SKIPS_WORK (${TMPDIR:-/tmp}/meldy-skips), PG_BIN (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
PORT=${SKIPS_PG_PORT:-54391}
WORK=${SKIPS_WORK:-${TMPDIR:-/tmp}/meldy-skips}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
MIG=$SB/migrations/20261014150000_bot_skips_pictures.sql
DOWN=$SB/rollback/20261014150000_bot_skips_pictures_down.sql
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
FAILS=0
ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
as_pg() { if [ "$(id -u)" = 0 ]; then unshare --user --map-user=1000 --map-group=1000 bash -c "$1"; else bash -c "$1"; fi; }
mkdir -p "$WORK/pg"
if [ ! -f "$WORK/pg/data/PG_VERSION" ]; then
  as_pg "'$PG_BIN/initdb' -D '$WORK/pg/data' -U postgres -A trust -E UTF8 --locale=C.UTF-8 > '$WORK/pg/initdb.log' 2>&1" \
    || { echo "initdb failed: $WORK/pg/initdb.log"; exit 2; }
fi
as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -l '$WORK/pg/server.log' -o \"-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1\" -w start" >/dev/null \
  || { echo "the cluster did not start: $WORK/pg/server.log"; exit 2; }
stop_cluster() { as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -m fast -w stop" >/dev/null; }
trap stop_cluster EXIT

# 1. The bot's whole rehearsal on this cluster (it keeps the cluster running and leaves t_main).
if TELEGRAM_PG_PORT=$PORT TELEGRAM_WORK=$WORK/telegram "$HERE/telegram_bot_run.sh" > "$WORK/telegram.log" 2>&1; then
  ok "telegram_bot_run.sh: every bot package and its checks"
else
  bad "telegram_bot_run.sh (see $WORK/telegram.log)"; tail -20 "$WORK/telegram.log"; exit 1
fi
run() { "${PSQL[@]}" -d t_main -f "$1" > "$WORK/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$WORK/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
step() { if run "$2"; then ok "$1"; else bad "$1"; fi; }
defs() { "${PSQL[@]}" -d t_main -c "select md5(string_agg(pg_get_functiondef(p.oid), '' order by p.oid::regprocedure::text)) from pg_proc p
  where p.oid in ('public.bot_session_items(bigint,uuid,uuid[])'::regprocedure, 'bot.group_item_ok(public.test_items)'::regprocedure)"; }

# 2. Storage and the pictures of questions.
if [ "$("${PSQL[@]}" -d t_main -c "select count(*) from pg_namespace where nspname = 'storage'")" = 0 ]; then
  step "storage_baseline.sql" "$HERE/storage_baseline.sql"
fi
step "20261014120000_test_item_images.sql" "$SB/migrations/20261014120000_test_item_images.sql"
BEFORE=$(defs)

# 3. This migration twice, its behaviour.
step "20261014150000_bot_skips_pictures.sql" "$MIG"
AFTER=$(defs)
step "20261014150000_bot_skips_pictures.sql again" "$MIG"
[ "$(defs)" = "$AFTER" ] && ok "a second apply changes nothing" || bad "a second apply changed the functions"
[ "$AFTER" != "$BEFORE" ] && ok "the functions changed" || bad "the functions did not change"
if run "$HERE/bot_skips_pictures_behaviour.sql" && grep -q 'BOT SKIPS PICTURES CHECKS PASSED' "$WORK/last.log"; then
  ok "bot_skips_pictures_behaviour.sql"
else bad "bot_skips_pictures_behaviour.sql"; grep -v NOTICE "$WORK/last.log" | head -6; fi

# 4. The rollback twice: the functions as they were.
step "rollback" "$DOWN"
step "rollback again" "$DOWN"
[ "$(defs)" = "$BEFORE" ] && ok "the rollback restores both functions byte for byte" || bad "the rollback left other functions"
if run "$HERE/bot_skips_pictures_behaviour.sql"; then bad "the behaviour passes without the migration (it should not)"; else ok "without the migration the behaviour fails, as it should"; fi

# 5. Again, and the contract.
step "20261014150000_bot_skips_pictures.sql after the rollback" "$MIG"
[ "$(defs)" = "$AFTER" ] && ok "the same functions as the first apply" || bad "another result than the first apply"
if run "$HERE/bot_skips_pictures_behaviour.sql" && grep -q 'BOT SKIPS PICTURES CHECKS PASSED' "$WORK/last.log"; then ok "the behaviour again"; else bad "the behaviour again"; fi
if "${PSQL[@]}" -d t_main -f "$SB/tests/telegram_bot.sql" 2>&1 | grep -Eq '"contract_ok" ?: ?true'; then
  ok "the bot's contract (supabase/tests/telegram_bot.sql)"
else bad "the bot's contract (supabase/tests/telegram_bot.sql)"; fi
step "the pictures contract (supabase/tests/test_item_images.sql)" "$SB/tests/test_item_images.sql"

echo
if [ $FAILS = 0 ]; then echo "BOT SKIPS PICTURES REHEARSAL: ALL GREEN"; else echo "BOT SKIPS PICTURES REHEARSAL: $FAILS FAILED"; exit 1; fi
