#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261021140000_learn_left.sql («Осталось
# выучить») on a scratch PostgreSQL 16 cluster:
#   1. the base as the newer rehearsals build it: telegram_bot_run.sh (every bot package and its checks; it leaves its
#      database t_main) → the later migrations it needs in the live order (up to the exam's move and the container's
#      kind) → the behaviour fails there (the test bites) → catalog fingerprint;
#   2. the migration twice (the second changes nothing; no line of the base changes or goes) → the contract
#      (supabase/tests/learn_left.sql) → the behaviour (learn_left_behaviour.sql) → the equivalence of
#      meldy_private.learn_left_facts with the site's line rule on every case of contracts/learn_left/vectors.json
#      (learn_left_vectors.py) → T11's oral inputs and the bot's contract still pass;
#   3. the rollback twice (the catalog equals the base) → the migration again (the same catalog as its first apply).
# Exit code 0 only when every step is green.
# Env (optional): LEARN_LEFT_PG_PORT (54412), LEARN_LEFT_WORK (${TMPDIR:-/tmp}/meldy-learn-left), PG_BIN
# (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
ROOT=$(cd "$SB/.." && pwd)
PORT=${LEARN_LEFT_PG_PORT:-54412}
WORK=${LEARN_LEFT_WORK:-${TMPDIR:-/tmp}/meldy-learn-left}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
MIG=$SB/migrations/20261021140000_learn_left.sql
DOWN=$SB/rollback/20261021140000_learn_left_down.sql
CONTRACT=$SB/tests/learn_left.sql
BEHAVIOUR=$HERE/learn_left_behaviour.sql
VECTORS=$ROOT/contracts/learn_left/vectors.json
FINGERPRINT=$HERE/containers_fingerprint.sql
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
OUT=$WORK/out
mkdir -p "$OUT"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
FAILS=0
OKS=0
ok() { printf '  ok    %-66s %s\n' "$1" "${2:-}"; OKS=$((OKS + 1)); }
bad() { printf '  FAIL  %-66s %s\n' "$1" "${2:-}"; FAILS=$((FAILS + 1)); }
as_pg() { if [ "$(id -u)" = 0 ]; then unshare --user --map-user=1000 --map-group=1000 bash -c "$1"; else bash -c "$1"; fi; }
mkdir -p "$WORK/pg"
if [ ! -f "$WORK/pg/data/PG_VERSION" ]; then
  as_pg "'$PG_BIN/initdb' -D '$WORK/pg/data' -U postgres -A trust -E UTF8 --locale=C.UTF-8 > '$WORK/pg/initdb.log' 2>&1" \
    || { echo "initdb failed: $WORK/pg/initdb.log"; exit 2; }
fi
STARTED=0
if ! "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT"; then
  as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -l '$WORK/pg/server.log' -o \"-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1\" -w start" >/dev/null \
    || { echo "the cluster did not start: $WORK/pg/server.log"; exit 2; }
  STARTED=1
fi
stop_cluster() { if [ $STARTED = 1 ]; then as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -m fast -w stop" >/dev/null; fi; }
trap stop_cluster EXIT
T0=$(date +%s)

run() { "${PSQL[@]}" -d t_main -f "$1" > "$OUT/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$OUT/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
step() { if run "$2"; then ok "$1"; else bad "$1"; fi; }
fingerprint() { "${PSQL[@]}" -d t_main -f "$FINGERPRINT" > "$1"; }
behaviour() { "${PSQL[@]}" -d t_main -f "$BEHAVIOUR" > "$OUT/behaviour.log" 2>&1 && grep -q 'LEARN LEFT CHECKS PASSED' "$OUT/behaviour.log"; }
contract() { "${PSQL[@]}" -d t_main -f "$CONTRACT" > "$OUT/contract.log" 2>&1; }

echo "1. the base"
if TELEGRAM_PG_PORT=$PORT TELEGRAM_WORK=$WORK/telegram "$HERE/telegram_bot_run.sh" > "$WORK/telegram.log" 2>&1; then
  ok "telegram_bot_run.sh: every bot package and its checks" "$(grep -c '^  ok' "$WORK/telegram.log") ok"
else
  bad "telegram_bot_run.sh (see $WORK/telegram.log)"; tail -20 "$WORK/telegram.log"; exit 1
fi
LATER=(migrations/20261010130000_containers_frozen_pace.sql migrations/20261011100000_containers_not_found_null.sql
       tests/local/storage_baseline.sql migrations/20261014120000_test_item_images.sql
       migrations/20261014150000_bot_skips_pictures.sql migrations/20261014170000_plan_tempo.sql
       migrations/20261016100000_item_update_images.sql migrations/20261016120000_quizzes.sql
       migrations/20261016140000_quiz_result_order.sql migrations/20261018100000_test_builder.sql
       migrations/20261018120000_exam_move_bot_exams.sql migrations/20261019090000_container_kind.sql)
BASE_OK=1
for f in "${LATER[@]}"; do run "$SB/$f" || BASE_OK=0; done
[ $BASE_OK = 1 ] && ok "the later migrations in the live order" "${#LATER[@]} files" || bad "the later migrations"
if behaviour; then bad "the behaviour passes before the migration (it tests nothing)"
else ok "the behaviour fails before the migration" "$(grep -m1 'ERROR' "$OUT/behaviour.log" | sed 's/^psql:[^:]*:[0-9]*: //' | cut -c1-60)"; fi
if contract; then bad "the contract passes before the migration"; else ok "the contract fails before the migration" "$(grep -m1 -o 'ERROR: *[a-z_]*' "$OUT/contract.log")"; fi
fingerprint "$OUT/fp_base.txt"

echo "2. the migration"
step "migration, first apply" "$MIG"
fingerprint "$OUT/fp_after.txt"
step "migration, second apply (re-runnable)" "$MIG"
fingerprint "$OUT/fp_again.txt"
if cmp -s "$OUT/fp_after.txt" "$OUT/fp_again.txt"; then ok "a second apply changes nothing in the catalog"
else bad "a second apply changed the catalog" "$(diff "$OUT/fp_after.txt" "$OUT/fp_again.txt" | head -3 | tr '\n' ' ')"; fi
GONE=$(comm -23 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt") | wc -l)
NEW=$(comm -13 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt") | wc -l)
if [ "$GONE" = 0 ]; then ok "no line of the base changed or gone" "$NEW new"
else bad "lines of the base changed or gone" "$(comm -23 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt") | head -3 | tr '\n' ' ')"; fi
if contract; then ok "contract (supabase/tests/learn_left.sql)"; else bad "contract" "$(grep -m1 ERROR "$OUT/contract.log")"; fi
if behaviour; then ok "behaviour (learn_left_behaviour.sql)" "LEARN LEFT CHECKS PASSED"
else bad "behaviour" "$(grep -m1 'ERROR\|FAILED' "$OUT/behaviour.log" | sed 's/^psql:[^:]*:[0-9]*: //')"; fi
if python3 -I "$HERE/learn_left_vectors.py" "$VECTORS" t_main > "$OUT/vectors.log" 2>&1; then ok "equivalence with the site's rule" "$(tail -1 "$OUT/vectors.log")"
else bad "equivalence with the site's rule" "$(tail -1 "$OUT/vectors.log")"; cat "$OUT/vectors.log" | head -20; fi
if "${PSQL[@]}" -d t_main -f "$HERE/oral_plan_inputs.sql" > "$OUT/t11.log" 2>&1 && grep -q 'ORAL PLAN INPUTS CHECKS PASSED' "$OUT/t11.log"; then
  ok "T11's oral_plan_inputs.sql still passes"
else bad "T11's oral_plan_inputs.sql" "$(grep -m1 'ERROR\|FAILED' "$OUT/t11.log")"; fi
TG=$("${PSQL[@]}" -d t_main -f "$SB/tests/telegram_bot.sql" 2>&1)
if echo "$TG" | grep -Eq '"contract_ok" ?: ?true'; then ok "the bot's contract still reads ok"; else bad "the bot's contract" "$(echo "$TG" | grep -o '"failed" *: *\[[^]]*\]' | head -1)"; fi

echo "3. the rollback"
step "rollback, first run" "$DOWN"
step "rollback, second run (re-runnable)" "$DOWN"
fingerprint "$OUT/fp_down.txt"
if cmp -s "$OUT/fp_base.txt" "$OUT/fp_down.txt"; then ok "after the rollback the catalog equals the base"
else bad "the rollback left differences" "$(diff "$OUT/fp_base.txt" "$OUT/fp_down.txt" | head -3 | tr '\n' ' ')"; fi
step "migration again" "$MIG"
fingerprint "$OUT/fp_re.txt"
if cmp -s "$OUT/fp_after.txt" "$OUT/fp_re.txt"; then ok "applied again: the same catalog as the first apply"; else bad "applied again: a different catalog"; fi
if behaviour; then ok "behaviour again"; else bad "behaviour again"; fi

echo "learn_left rehearsal: $OKS ok, $FAILS failed, $(( $(date +%s) - T0 )) s"
[ $FAILS = 0 ]
