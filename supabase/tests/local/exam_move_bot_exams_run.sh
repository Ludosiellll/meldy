#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261018120000_exam_move_bot_exams.sql
# («Перенести экзамен» and the plan in Telegram per exam, release 47) on a scratch PostgreSQL 16 cluster:
#   1. the base as the containers and the Telegram bot's rehearsals build it: telegram_bot_run.sh (every bot package and
#      its checks; it leaves its database t_main) → the later migrations in the live order (the frozen day, the page's
#      «not found», storage, pictures, the bot skips pictures, the tempo, item_update_images, quizzes, the quiz review
#      order) → the behaviour fails there (the test bites) → catalog fingerprint;
#   2. the migration twice (the second changes nothing in the catalog; no line of the base gone but the replaced
#      functions) → the contract (supabase/tests/exam_move_bot_exams.sql) → exam_move_bot_exams_behaviour.sql;
#   3. the existing checks on that database: the container's and the bot's contracts, the containers' and the tempo's
#      behaviour, the bot's T1 behaviour and claims, its sessions, groups, files, voice, oral inputs, Mini App and
#      monitor tests, the bot-skips-pictures, item_update_images, pictures and quizzes behaviour and contracts;
#   4. the rollback twice (the catalog equals the base, byte for byte) → the behaviour fails → the contracts still read;
#   5. the migration again (the same catalog as its first apply) → the contract and the behaviour again.
# Exit code 0 only when every step is green.
# Env (optional): EXAM_MOVE_PG_PORT (54398), EXAM_MOVE_WORK (${TMPDIR:-/tmp}/meldy-exam-move), PG_BIN
# (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
PORT=${EXAM_MOVE_PG_PORT:-54398}
WORK=${EXAM_MOVE_WORK:-${TMPDIR:-/tmp}/meldy-exam-move}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
MIG=$SB/migrations/20261018120000_exam_move_bot_exams.sql
DOWN=$SB/rollback/20261018120000_exam_move_bot_exams_down.sql
CONTRACT=$SB/tests/exam_move_bot_exams.sql
BEHAVIOUR=$HERE/exam_move_bot_exams_behaviour.sql
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
# test <label> <file> <marker…>: green when psql exits 0 and prints every marker (as a row, an \echo or a notice).
test_file() {
  local label=$1 file=$2 log rc m missing=""; shift 2
  log=$OUT/$(basename "$file" .sql).log
  "${PSQL[@]}" -d t_main -f "$file" > "$log" 2>&1; rc=$?
  for m in "$@"; do grep -q "$m" "$log" || missing="$missing «$m»"; done
  if [ $rc = 0 ] && [ -z "$missing" ]; then ok "$label" "${*:-exit 0}"
  else bad "$label" "$(grep -m1 'ERROR\|FAILED' "$log" | sed 's/^psql:[^:]*:[0-9]*: //')${missing:+ (not printed:$missing)}"; fi
}
# A contract that returns one JSON object with contract_ok.
contract_ok() {  # <label> <file>
  local out; out=$("${PSQL[@]}" -d t_main -f "$2" 2>&1)
  if echo "$out" | grep -Eq '"contract_ok" ?: ?true'; then ok "$1" "contract_ok: true"
  else bad "$1" "$(echo "$out" | grep -o '"failed" *: *\[[^]]*\]' | head -1)$(echo "$out" | grep -m1 ERROR)"; fi
}
behaviour() { "${PSQL[@]}" -d t_main -f "$BEHAVIOUR" > "$OUT/behaviour.log" 2>&1 && grep -q 'EXAM MOVE BOT EXAMS CHECKS PASSED' "$OUT/behaviour.log"; }

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
       migrations/20261016140000_quiz_result_order.sql)
BASE_OK=1
for f in "${LATER[@]}"; do run "$SB/$f" || BASE_OK=0; done
[ $BASE_OK = 1 ] && ok "the later migrations in the live order" "${#LATER[@]} files" || bad "the later migrations"
if behaviour; then bad "the behaviour passes before the migration (it tests nothing)"
else ok "the behaviour fails before the migration" "$(grep -m1 'ERROR' "$OUT/behaviour.log" | sed 's/^psql:[^:]*:[0-9]*: //' | cut -c1-60)"; fi
fingerprint "$OUT/fp_base.txt"

echo "2. the migration"
step "migration, first apply" "$MIG"
fingerprint "$OUT/fp_after.txt"
step "migration, second apply (re-runnable)" "$MIG"
fingerprint "$OUT/fp_again.txt"
if cmp -s "$OUT/fp_after.txt" "$OUT/fp_again.txt"; then ok "a second apply changes nothing in the catalog"
else bad "a second apply changed the catalog" "$(diff "$OUT/fp_after.txt" "$OUT/fp_again.txt" | head -3 | tr '\n' ' ')"; fi
# What changed: the replaced functions (by name), and lines new; nothing else of the base gone.
GONE=$(comm -23 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt"))
REPLACED='^fn (meldy_private\.(plan_inputs_for|container_summary_for|containers_overview_for|record_test_answers_for)|bot\.(exams_json|after_date_json|tick_due)|public\.(bot_claim_reminders|bot_reminder_context|bot_today|bot_claim_after_date|bot_oral_inputs))\('
OTHER=$(echo "$GONE" | grep -v '^$' | grep -Ev "$REPLACED")
if [ -z "$OTHER" ] && [ "$(echo "$GONE" | grep -Ec "$REPLACED")" = 12 ]; then
  ok "base lines changed: exactly the 12 replaced functions" "$(comm -13 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt") | wc -l) new or changed lines"
else bad "base lines changed or gone beyond the replaced functions" "$(echo "$OTHER" | head -3 | tr '\n' ' ')"; fi
step "contract: supabase/tests/exam_move_bot_exams.sql" "$CONTRACT"
if behaviour; then ok "behaviour: own dates, moves, rules, switches, the bot, reminders, K3" "EXAM MOVE BOT EXAMS CHECKS PASSED"
else bad "behaviour" "$(grep -m1 'ERROR\|FAILED' "$OUT/behaviour.log" | sed 's/^psql:[^:]*:[0-9]*: //')"; fi

echo "3. the existing checks after the migration"
existing() {  # <suffix>
  contract_ok "contract: containers.sql$1" "$SB/tests/containers.sql"
  contract_ok "contract: telegram_bot.sql$1" "$SB/tests/telegram_bot.sql"
  step "contract: containers_not_found.sql$1" "$SB/tests/containers_not_found.sql"
  step "contract: test_item_images.sql$1" "$SB/tests/test_item_images.sql"
  step "contract: item_update_images.sql$1" "$SB/tests/item_update_images.sql"
  step "contract: quizzes.sql$1" "$SB/tests/quizzes.sql"
  step "contract: quiz_result_order.sql$1" "$SB/tests/quiz_result_order.sql"
  test_file "containers_behaviour.sql$1" "$HERE/containers_behaviour.sql" 'CONTAINER CHECKS PASSED'
  test_file "plan_tempo_behaviour.sql$1" "$HERE/plan_tempo_behaviour.sql" 'PLAN TEMPO CHECKS PASSED'
  test_file "telegram_bot_behaviour.sql (T1)$1" "$HERE/telegram_bot_behaviour.sql" 'TELEGRAM BOT CHECKS PASSED'
  test_file "telegram_bot_claims.sql (T1)$1" "$HERE/telegram_bot_claims.sql" 'TELEGRAM BOT CLAIMS PASSED'
  test_file "telegram_bot_sessions.sql (T5)$1" "$HERE/telegram_bot_sessions.sql" 'TELEGRAM BOT SESSIONS CHECKS PASSED'
  test_file "telegram_bot_groups.sql (T7)$1" "$HERE/telegram_bot_groups.sql" 'TELEGRAM BOT GROUP CHECKS PASSED'
  test_file "telegram_bot_files.sql (T9)$1" "$HERE/telegram_bot_files.sql" 'TELEGRAM BOT FILES CHECKS PASSED'
  test_file "telegram_bot_voice.sql (T10)$1" "$HERE/telegram_bot_voice.sql" 'TELEGRAM BOT VOICE CHECKS PASSED'
  test_file "oral_plan_inputs.sql (T11)$1" "$HERE/oral_plan_inputs.sql" 'ORAL PLAN INPUTS CHECKS PASSED'
  test_file "telegram_webapp.sql (WA)$1" "$HERE/telegram_webapp.sql" 'TELEGRAM WEBAPP CHECKS PASSED'
  test_file "telegram_bot_monitor.sql (MON)$1" "$HERE/telegram_bot_monitor.sql" 'TELEGRAM BOT MONITOR CHECKS PASSED'
  test_file "bot_skips_pictures_behaviour.sql$1" "$HERE/bot_skips_pictures_behaviour.sql" 'BOT SKIPS PICTURES CHECKS PASSED'
  test_file "test_item_images_behaviour.sql$1" "$HERE/test_item_images_behaviour.sql" 'IMAGE CHECKS PASSED'
  test_file "item_update_images_behaviour.sql$1" "$HERE/item_update_images_behaviour.sql" 'ITEM IMAGES CHECKS PASSED'
  test_file "quizzes_behaviour.sql$1" "$HERE/quizzes_behaviour.sql" 'QUIZ CHECKS PASSED'
}
existing ""

echo "4. the rollback"
step "rollback" "$DOWN"
step "rollback again" "$DOWN"
fingerprint "$OUT/fp_down.txt"
if cmp -s "$OUT/fp_base.txt" "$OUT/fp_down.txt"; then ok "the catalog equals the base" "$(wc -l < "$OUT/fp_base.txt") lines, functions byte for byte"
else bad "the rollback left another catalog" "$(diff "$OUT/fp_base.txt" "$OUT/fp_down.txt" | head -4 | tr '\n' ' ')"; fi
if behaviour; then bad "the behaviour passes after the rollback (it should not)"; else ok "after the rollback the behaviour fails, as it should"; fi
if run "$CONTRACT"; then bad "the contract passes after the rollback (it should not)"; else ok "after the rollback the contract fails, as it should"; fi
contract_ok "contract: containers.sql after the rollback" "$SB/tests/containers.sql"
contract_ok "contract: telegram_bot.sql after the rollback" "$SB/tests/telegram_bot.sql"
test_file "telegram_bot_claims.sql after the rollback" "$HERE/telegram_bot_claims.sql" 'TELEGRAM BOT CLAIMS PASSED'

echo "5. the migration again"
step "migration after the rollback" "$MIG"
fingerprint "$OUT/fp_re.txt"
if cmp -s "$OUT/fp_after.txt" "$OUT/fp_re.txt"; then ok "the same catalog as the first apply"
else bad "another catalog than the first apply" "$(diff "$OUT/fp_after.txt" "$OUT/fp_re.txt" | head -3 | tr '\n' ' ')"; fi
step "contract again" "$CONTRACT"
if behaviour; then ok "behaviour again" "EXAM MOVE BOT EXAMS CHECKS PASSED"
else bad "behaviour again" "$(grep -m1 'ERROR\|FAILED' "$OUT/behaviour.log" | sed 's/^psql:[^:]*:[0-9]*: //')"; fi
contract_ok "contract: telegram_bot.sql at the end" "$SB/tests/telegram_bot.sql"
contract_ok "contract: containers.sql at the end" "$SB/tests/containers.sql"

echo
echo "elapsed $(( $(date +%s) - T0 )) s; outputs in $OUT"
if [ $FAILS = 0 ]; then echo "EXAM MOVE BOT EXAMS REHEARSAL: ALL GREEN ($OKS ok, 0 FAIL)"; else echo "EXAM MOVE BOT EXAMS REHEARSAL: $FAILS FAILED ($OKS ok)"; exit 1; fi
