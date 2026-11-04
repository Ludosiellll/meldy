#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261107090200_group_link_life.sql (a group
# link lives as long as its exam; a moved exam takes its links and its members' oral dates along) on a scratch
# PostgreSQL 16 cluster:
#   1. the base: the live order of every migration up to 20261107090100_group_link_restore.sql (question_kinds_base.sh
#      up to 20261031090000, then every later file in order) → the existing checks of what the migration touches pass
#      there → the contract and group_link_life_behaviour.sql fail there (they test something) → catalog fingerprint;
#   2. the migration twice, each in one transaction as supabase/migrate.py sends it (the second changes nothing in the
#      catalog; of the base only the two replaced functions change) → the contract (supabase/tests/group_link_life.sql)
#      → group_link_life_behaviour.sql;
#   3. the existing contracts and behaviours of what it touches, again: the containers, «Перенести экзамен» and the bot's
#      exams, the container kind, the deleted exam's orals, the oral shares, the bot (T1, the oral inputs), the tempo;
#   4. the rollback twice (the catalog equals the base, the replaced functions byte for byte) → the behaviour and the
#      contract fail → the existing checks pass;
#   5. the migration again (the same catalog as its first apply) → the contract and the behaviour again.
# Exit code 0 only when every step is green. The cluster it starts is stopped at the end and its data dir removed
# (GROUP_LINK_KEEP=1 keeps it).
# Env (optional): GROUP_LINK_PG_PORT (54399), GROUP_LINK_WORK (${TMPDIR:-/tmp}/meldy-group-link), PG_BIN
# (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
PORT=${GROUP_LINK_PG_PORT:-54399}
WORK=${GROUP_LINK_WORK:-${TMPDIR:-/tmp}/meldy-group-link}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
MIG=$SB/migrations/20261107090200_group_link_life.sql
DOWN=$SB/rollback/20261107090200_group_link_life_down.sql
CONTRACT=$SB/tests/group_link_life.sql
BEHAVIOUR=$HERE/group_link_life_behaviour.sql
FINGERPRINT=$HERE/containers_fingerprint.sql
DB=g_main
LAST_BASE=20261107090100_group_link_restore.sql
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
OUT=$WORK/out
mkdir -p "$OUT"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
FAILS=0
OKS=0
ok() { printf '  ok    %-70s %s\n' "$1" "${2:-}"; OKS=$((OKS + 1)); }
bad() { printf '  FAIL  %-70s %s\n' "$1" "${2:-}"; FAILS=$((FAILS + 1)); }
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
    [ "${GROUP_LINK_KEEP:-0}" = 1 ] || rm -rf "$WORK/pg"
  fi
}
trap stop_cluster EXIT
T0=$(date +%s)

run() { "${PSQL[@]}" -d $DB -f "$1" > "$OUT/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$OUT/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
# One transaction, as supabase/migrate.py sends a file (set local holds).
run1() { "${PSQL[@]}" -1 -d $DB -f "$1" > "$OUT/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$OUT/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
step() { if run "$2"; then ok "$1"; else bad "$1"; fi; }
step1() { if run1 "$2"; then ok "$1" "one transaction"; else bad "$1"; fi; }
fingerprint() { "${PSQL[@]}" -d $DB -f "$FINGERPRINT" > "$1"; }
# test_file <label> <file> <marker…>: green when psql exits 0 and prints every marker (as a row, an \echo or a notice).
test_file() {
  local label=$1 file=$2 log rc m missing=""; shift 2
  log=$OUT/$(basename "$file" .sql).log
  "${PSQL[@]}" -d $DB -f "$file" > "$log" 2>&1; rc=$?
  for m in "$@"; do grep -q "$m" "$log" || missing="$missing «$m»"; done
  if [ $rc = 0 ] && [ -z "$missing" ]; then ok "$label" "${*:-exit 0}"
  else bad "$label" "$(grep -m1 'ERROR\|FAILED' "$log" | sed 's/^psql:[^:]*:[0-9]*: //')${missing:+ (not printed:$missing)}"; fi
}
# A contract that returns one JSON object with contract_ok.
contract_ok() {  # <label> <file>
  local out; out=$("${PSQL[@]}" -d $DB -f "$2" 2>&1)
  if echo "$out" | grep -Eq '"contract_ok" ?: ?true'; then ok "$1" "contract_ok: true"
  else bad "$1" "$(echo "$out" | grep -o '"failed" *: *\[[^]]*\]' | head -1)$(echo "$out" | grep -m1 ERROR)"; fi
}
behaviour() { "${PSQL[@]}" -d $DB -f "$BEHAVIOUR" > "$OUT/behaviour.log" 2>&1 && grep -q 'GROUP LINK LIFE CHECKS PASSED' "$OUT/behaviour.log"; }
# The existing checks of what the migration touches.
existing() {  # <suffix>
  contract_ok "contract: containers.sql$1" "$SB/tests/containers.sql"
  contract_ok "contract: exam_shares.sql$1" "$SB/tests/exam_shares.sql"
  contract_ok "contract: telegram_bot.sql$1" "$SB/tests/telegram_bot.sql"
  step "contract: exam_move_bot_exams.sql$1" "$SB/tests/exam_move_bot_exams.sql"
  step "contract: container_kind.sql$1" "$SB/tests/container_kind.sql"
  step "contract: container_orals_go.sql$1" "$SB/tests/container_orals_go.sql"
  step "contract: containers_not_found.sql$1" "$SB/tests/containers_not_found.sql"
  test_file "containers_behaviour.sql$1" "$HERE/containers_behaviour.sql" 'CONTAINER CHECKS PASSED'
  test_file "exam_move_bot_exams_behaviour.sql$1" "$HERE/exam_move_bot_exams_behaviour.sql" 'EXAM MOVE BOT EXAMS CHECKS PASSED'
  test_file "container_kind_behaviour.sql$1" "$HERE/container_kind_behaviour.sql" 'CONTAINER KIND CHECKS PASSED'
  test_file "container_orals_go_behaviour.sql$1" "$HERE/container_orals_go_behaviour.sql" 'CONTAINER ORALS CHECKS PASSED'
  test_file "plan_tempo_behaviour.sql$1" "$HERE/plan_tempo_behaviour.sql" 'PLAN TEMPO CHECKS PASSED'
  test_file "telegram_bot_behaviour.sql (T1)$1" "$HERE/telegram_bot_behaviour.sql" 'TELEGRAM BOT CHECKS PASSED'
  test_file "oral_plan_inputs.sql (T11)$1" "$HERE/oral_plan_inputs.sql" 'ORAL PLAN INPUTS CHECKS PASSED'
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
if behaviour; then bad "the behaviour passes on the base (it tests nothing)"
else ok "the behaviour fails on the base" "$(grep -m1 'ERROR' "$OUT/behaviour.log" | sed 's/^psql:[^:]*:[0-9]*: //' | cut -c1-70)"; fi
if "${PSQL[@]}" -d $DB -f "$CONTRACT" >/dev/null 2>&1; then bad "the contract passes on the base (it checks nothing)"; else ok "the contract fails on the base"; fi
fingerprint "$OUT/fp_base.txt"

echo "2. the migration"
step1 "migration, first apply" "$MIG"
fingerprint "$OUT/fp_after.txt"
step1 "migration, second apply (re-runnable)" "$MIG"
fingerprint "$OUT/fp_again.txt"
if cmp -s "$OUT/fp_after.txt" "$OUT/fp_again.txt"; then ok "a second apply changes nothing in the catalog"
else bad "a second apply changed the catalog" "$(diff "$OUT/fp_after.txt" "$OUT/fp_again.txt" | head -3 | tr '\n' ' ')"; fi
GONE=$(comm -23 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt"))
REPLACED='^fn public\.(container_link_create|container_link_preview)\('
OTHER=$(echo "$GONE" | grep -v '^$' | grep -Ev "$REPLACED")
if [ -z "$OTHER" ] && [ "$(echo "$GONE" | grep -Ec "$REPLACED")" = 2 ]; then
  ok "base lines changed: exactly the 2 replaced functions" "$(comm -13 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt") | wc -l) new or changed lines"
else bad "base lines changed or gone beyond the replaced functions" "$(echo "$OTHER" | head -3 | tr '\n' ' ')"; fi
step "contract: supabase/tests/group_link_life.sql" "$CONTRACT"
if behaviour; then ok "behaviour: ends, moves, extend and reopen, joins, oral codes, copies' dates" "GROUP LINK LIFE CHECKS PASSED"
else bad "behaviour" "$(grep -m1 'ERROR\|FAILED' "$OUT/behaviour.log" | sed 's/^psql:[^:]*:[0-9]*: //')"; fi

echo "3. the existing checks after the migration"
existing ""

echo "4. the rollback"
step1 "rollback" "$DOWN"
step1 "rollback again" "$DOWN"
fingerprint "$OUT/fp_down.txt"
if cmp -s "$OUT/fp_base.txt" "$OUT/fp_down.txt"; then ok "the catalog equals the base" "$(wc -l < "$OUT/fp_base.txt") lines, functions byte for byte"
else bad "the rollback left another catalog" "$(diff "$OUT/fp_base.txt" "$OUT/fp_down.txt" | head -4 | tr '\n' ' ')"; fi
if behaviour; then bad "the behaviour passes after the rollback (it should not)"; else ok "after the rollback the behaviour fails, as it should"; fi
if "${PSQL[@]}" -d $DB -f "$CONTRACT" >/dev/null 2>&1; then bad "the contract passes after the rollback (it should not)"; else ok "after the rollback the contract fails, as it should"; fi
existing " (after the rollback)"

echo "5. the migration again"
step1 "migration after the rollback" "$MIG"
fingerprint "$OUT/fp_re.txt"
if cmp -s "$OUT/fp_after.txt" "$OUT/fp_re.txt"; then ok "the same catalog as the first apply"
else bad "another catalog than the first apply" "$(diff "$OUT/fp_after.txt" "$OUT/fp_re.txt" | head -3 | tr '\n' ' ')"; fi
step "contract again" "$CONTRACT"
if behaviour; then ok "behaviour again" "GROUP LINK LIFE CHECKS PASSED"
else bad "behaviour again" "$(grep -m1 'ERROR\|FAILED' "$OUT/behaviour.log" | sed 's/^psql:[^:]*:[0-9]*: //')"; fi
contract_ok "contract: containers.sql at the end" "$SB/tests/containers.sql"
test_file "containers_behaviour.sql at the end" "$HERE/containers_behaviour.sql" 'CONTAINER CHECKS PASSED'

echo
echo "elapsed $(( $(date +%s) - T0 )) s; outputs in $OUT"
if [ $FAILS = 0 ]; then echo "GROUP LINK LIFE REHEARSAL: ALL GREEN ($OKS ok, 0 FAIL)"; else echo "GROUP LINK LIFE REHEARSAL: $FAILS FAILED ($OKS ok)"; exit 1; fi
