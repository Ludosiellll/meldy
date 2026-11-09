#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261109090100_bot_support.sql (support
# through the bot, the owner's chat claimed by the username's hash, account deletion requests) on a scratch
# PostgreSQL 16 cluster:
#   1. the base: the live order of every migration up to 20261107090800_avatars_owner.sql (question_kinds_base.sh up to
#      20261031090000, then every later file in order) → the bot's existing checks pass there → the contract and
#      bot_support_behaviour.sql fail there (they test something) → catalog fingerprint;
#   2. the migration twice, each in one transaction as supabase/migrate.py sends it (the second changes nothing in the
#      catalog; no line of the base changes or goes: the migration only adds) → the hash the migration set, the two ids
#      null → the contract (supabase/tests/bot_support.sql) → bot_support_behaviour.sql → eight claims of the owner's chat
#      at once bind it once → four claims of the queue at once never hand a row twice;
#   3. the bot's existing checks again (the contract telegram_bot.sql, T1's behaviour, the monitor's);
#   4. the rollback twice (the catalog equals the base) → the contract and the behaviour fail → the existing checks pass;
#   5. the migration again (the same catalog as its first apply) → the contract and the behaviour again.
# Exit code 0 only when every step is green; the last line then reads BOT SUPPORT REHEARSAL: ALL GREEN. The cluster it
# starts is stopped at the end and its data dir removed (BOT_SUPPORT_KEEP=1 keeps it).
# Env (optional): BOT_SUPPORT_PG_PORT (54496), BOT_SUPPORT_WORK (${TMPDIR:-/tmp}/meldy-bot-support), PG_BIN
# (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
PORT=${BOT_SUPPORT_PG_PORT:-54496}
WORK=${BOT_SUPPORT_WORK:-${TMPDIR:-/tmp}/meldy-bot-support}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
MIG=$SB/migrations/20261109090100_bot_support.sql
DOWN=$SB/rollback/20261109090100_bot_support_down.sql
CONTRACT=$SB/tests/bot_support.sql
BEHAVIOUR=$HERE/bot_support_behaviour.sql
FINGERPRINT=$HERE/containers_fingerprint.sql
DB=bot_support
LAST_BASE=20261107090800_avatars_owner.sql
# What the migration sets (the sha256 of the owner's Telegram username; the username itself is nowhere in the repo).
HASH=86a3887707f4aaa3021731a3c4fb121bf76dddbe26d20dda9a81685748a60604
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
OUT=$WORK/out
mkdir -p "$OUT"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
FAILS=0
OKS=0
ok() { printf '  ok    %-74s %s\n' "$1" "${2:-}"; OKS=$((OKS + 1)); }
bad() { printf '  FAIL  %-74s %s\n' "$1" "${2:-}"; FAILS=$((FAILS + 1)); }
as_pg() { if [ "$(id -u)" = 0 ]; then unshare --user --map-user=1000 --map-group=1000 bash -c "$1"; else bash -c "$1"; fi; }
STARTED=0
if ! "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT"; then
  rm -rf "$WORK/pg"
  mkdir -p "$WORK/pg"
  as_pg "'$PG_BIN/initdb' -D '$WORK/pg/data' -U postgres -A trust -E UTF8 --locale=C.UTF-8 > '$WORK/pg/initdb.log' 2>&1" \
    || { echo "initdb failed: $WORK/pg/initdb.log"; exit 2; }
  as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -l '$WORK/pg/server.log' -o \"-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1\" -w start" >/dev/null \
    || { echo "the cluster did not start: $WORK/pg/server.log"; exit 2; }
  STARTED=1
fi
stop_cluster() {
  if [ $STARTED = 1 ]; then
    as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -m fast -w stop" >/dev/null
    [ "${BOT_SUPPORT_KEEP:-0}" = 1 ] || rm -rf "$WORK/pg"
  fi
}
trap stop_cluster EXIT
T0=$(date +%s)

run() { "${PSQL[@]}" -d $DB -f "$1" > "$OUT/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$OUT/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
# One transaction, as supabase/migrate.py sends a file (set local holds).
run1() { "${PSQL[@]}" -1 -d $DB -f "$1" > "$OUT/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$OUT/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
q() { "${PSQL[@]}" -d $DB -c "$1"; }
step1() { if run1 "$2"; then ok "$1" "one transaction"; else bad "$1"; fi; }
fingerprint() { "${PSQL[@]}" -d $DB -f "$FINGERPRINT" > "$1"; }
# test_file <label> <file> <marker>: green when psql exits 0 and prints the marker.
test_file() {
  local label=$1 file=$2 marker=$3 log rc
  log=$OUT/$(basename "$file" .sql).log
  "${PSQL[@]}" -d $DB -f "$file" > "$log" 2>&1; rc=$?
  if [ $rc = 0 ] && grep -q "$marker" "$log"; then ok "$label" "$marker"
  else bad "$label" "$(grep -m1 'ERROR\|FAILED' "$log" | sed 's/^psql:[^:]*:[0-9]*: //' | cut -c1-110)"; fi
}
# A contract that returns one JSON object with contract_ok.
contract_ok() {  # <label> <file>
  local out; out=$("${PSQL[@]}" -d $DB -f "$2" 2>&1)
  if echo "$out" | grep -Eq '"contract_ok" ?: ?true'; then ok "$1" "contract_ok: true"
  else bad "$1" "$(echo "$out" | grep -o '"failed" *: *\[[^]]*\]' | head -1)$(echo "$out" | grep -m1 ERROR)"; fi
}
contract() { "${PSQL[@]}" -d $DB -f "$CONTRACT" > "$OUT/contract.log" 2>&1; }
behaviour() { "${PSQL[@]}" -d $DB -f "$BEHAVIOUR" > "$OUT/behaviour.log" 2>&1 && grep -q '^BOT SUPPORT CHECKS PASSED$' "$OUT/behaviour.log"; }
why() { grep -m1 'ERROR\|FAILED' "$1" | sed 's/^psql:[^:]*:[0-9]*: //' | cut -c1-110; }
# The bot's existing checks: what the migration must not disturb (bot.config gained columns, schema bot a table).
existing() {  # <suffix>
  contract_ok "contract: telegram_bot.sql$1" "$SB/tests/telegram_bot.sql"
  test_file "telegram_bot_behaviour.sql (T1)$1" "$HERE/telegram_bot_behaviour.sql" 'TELEGRAM BOT CHECKS PASSED'
  test_file "telegram_bot_monitor.sql$1" "$HERE/telegram_bot_monitor.sql" 'TELEGRAM BOT MONITOR CHECKS PASSED'
}

echo "1. the base"
if "$HERE/question_kinds_base.sh" $DB "$OUT" > "$OUT/base_q.log" 2>&1; then
  ok "question_kinds_base.sh: the live order up to 20261031090000" "$(tail -1 "$OUT/base_q.log" | cut -c1-60)"
else
  bad "question_kinds_base.sh (see $OUT/base_q.log)"; tail -8 "$OUT/base_q.log"; exit 1
fi
LATER=0
BASE_OK=1
for f in $(cd "$SB/migrations" && ls 2026*.sql); do
  [[ "$f" > "20261031090000_live_wide_rounds.sql" ]] || continue
  [[ "$f" > "$LAST_BASE" ]] && continue
  if run "$SB/migrations/$f"; then LATER=$((LATER + 1)); else BASE_OK=0; echo "    base: $f"; fi
done
[ $BASE_OK = 1 ] && ok "the later migrations in the live order, up to $LAST_BASE" "$LATER files" || { bad "the later migrations"; exit 1; }
existing " (base)"
if behaviour; then bad "the behaviour passes on the base (it tests nothing)"; else ok "the behaviour fails on the base" "$(why "$OUT/behaviour.log")"; fi
if contract; then bad "the contract passes on the base (it checks nothing)"; else ok "the contract fails on the base" "$(why "$OUT/contract.log")"; fi
fingerprint "$OUT/fp_base.txt"

echo "2. the migration"
step1 "migration, first apply" "$MIG"
fingerprint "$OUT/fp_after.txt"
step1 "migration, second apply (re-runnable)" "$MIG"
fingerprint "$OUT/fp_again.txt"
if cmp -s "$OUT/fp_after.txt" "$OUT/fp_again.txt"; then ok "a second apply changes nothing in the catalog"
else bad "a second apply changed the catalog" "$(diff "$OUT/fp_after.txt" "$OUT/fp_again.txt" | head -3 | tr '\n' ' ')"; fi
GONE=$(comm -23 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt"))
if [ -z "$GONE" ]; then ok "no line of the base changed or went: the migration only adds" "$(comm -13 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt") | wc -l) new lines"
else bad "base lines changed or gone" "$(echo "$GONE" | head -3 | tr '\n' ' ')"; fi
if [ "$(q "select support_username_hash || '/' || coalesce(support_chat_id::text, 'null') || '/' || coalesce(support_tg_user_id::text, 'null') from bot.config where id = 1")" = "$HASH/null/null" ]; then
  ok "bot.config: the hash the migration sets, no chat bound yet"
else bad "bot.config: the hash and the two null ids"; fi
if contract; then ok "contract: supabase/tests/bot_support.sql"; else bad "contract: supabase/tests/bot_support.sql" "$(why "$OUT/contract.log")"; fi
if behaviour; then ok "behaviour: the claim, the queue, replies, deletion requests" "BOT SUPPORT CHECKS PASSED"
else bad "behaviour" "$(why "$OUT/behaviour.log")"; fi
# A hash changed by hand is kept by a re-run of the migration.
q "update bot.config set support_username_hash = encode(sha256(convert_to('meldy_owner_test', 'UTF8')), 'hex') where id = 1" >/dev/null
run1 "$MIG" >/dev/null
if [ "$(q "select support_username_hash = encode(sha256(convert_to('meldy_owner_test', 'UTF8')), 'hex') from bot.config where id = 1")" = t ]; then
  ok "a hash set by hand survives a re-run of the migration"
else bad "a hash set by hand survives a re-run of the migration"; fi
# Eight «Старт» of the handle at once (eight chats, as if eight devices): the chat is bound once.
for i in 1 2 3 4 5 6 7 8; do
  q "select public.bot_support_owner(90000$i, 90000$i, 'Meldy_Owner_Test') ->> 'status'" > "$OUT/claim.$i" 2>&1 &
done
wait
if [ "$(cat "$OUT"/claim.[1-8] | sort | uniq -c | tr -s ' ' | tr '\n' ';')" = " 1 claimed; 7 set;" ]; then
  ok "eight claims at once: one claimed, seven set" "bound to $(q "select count(*) from bot.config where support_chat_id = support_tg_user_id and support_chat_id between 900001 and 900008") chat"
else bad "eight claims at once" "$(cat "$OUT"/claim.[1-8] | sort | uniq -c | tr -s ' ' | tr '\n' ';')"; fi
# Four ticks at once over 40 waiting rows: every row is handed once.
q "insert into bot.support_messages (kind, chat_id, tg_message_id, text) select 'message', 910001, g, 'сообщение ' || g from generate_series(1, 40) g" >/dev/null
for i in 1 2 3 4; do
  q "select x ->> 'id' from jsonb_array_elements(public.bot_support_claim(10) -> 'rows') x" > "$OUT/rows.$i" 2>&1 &
done
wait
if [ "$(cat "$OUT"/rows.[1-4] | sort | uniq | wc -l)" = 40 ] && [ -z "$(cat "$OUT"/rows.[1-4] | sort | uniq -d)" ]; then
  ok "four claims of the queue at once: 40 rows, none handed twice"
else bad "four claims of the queue at once" "$(cat "$OUT"/rows.[1-4] | sort | uniq | wc -l) distinct, twice: $(cat "$OUT"/rows.[1-4] | sort | uniq -d | head -3 | tr '\n' ' ')"; fi
q "delete from bot.support_messages; update bot.config set support_chat_id = null, support_tg_user_id = null, support_username_hash = '$HASH' where id = 1" >/dev/null

echo "3. the bot's existing checks after the migration"
existing ""

echo "4. the rollback"
step1 "rollback" "$DOWN"
step1 "rollback again" "$DOWN"
fingerprint "$OUT/fp_down.txt"
if cmp -s "$OUT/fp_base.txt" "$OUT/fp_down.txt"; then ok "the catalog equals the base" "$(wc -l < "$OUT/fp_base.txt") lines"
else bad "the rollback left another catalog" "$(diff "$OUT/fp_base.txt" "$OUT/fp_down.txt" | head -4 | tr '\n' ' ')"; fi
if behaviour; then bad "the behaviour passes after the rollback (it should not)"; else ok "after the rollback the behaviour fails, as it should"; fi
if contract; then bad "the contract passes after the rollback (it should not)"; else ok "after the rollback the contract fails, as it should"; fi
existing " (after the rollback)"

echo "5. the migration again"
step1 "migration after the rollback" "$MIG"
fingerprint "$OUT/fp_re.txt"
if cmp -s "$OUT/fp_after.txt" "$OUT/fp_re.txt"; then ok "the same catalog as the first apply"
else bad "another catalog than the first apply" "$(diff "$OUT/fp_after.txt" "$OUT/fp_re.txt" | head -3 | tr '\n' ' ')"; fi
if contract; then ok "contract again"; else bad "contract again" "$(why "$OUT/contract.log")"; fi
if behaviour; then ok "behaviour again" "BOT SUPPORT CHECKS PASSED"; else bad "behaviour again" "$(why "$OUT/behaviour.log")"; fi
contract_ok "contract: telegram_bot.sql at the end" "$SB/tests/telegram_bot.sql"

echo
echo "elapsed $(( $(date +%s) - T0 )) s; outputs in $OUT"
if [ $FAILS = 0 ]; then echo "BOT SUPPORT REHEARSAL: ALL GREEN ($OKS ok, 0 FAIL)"; else echo "BOT SUPPORT REHEARSAL: $FAILS FAILED ($OKS ok)"; exit 1; fi
