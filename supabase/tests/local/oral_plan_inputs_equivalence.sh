#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. The whole rehearsal of package T11 (the oral part of the day plan on the
# server: supabase/migrations/20261010120007_oral_plan_inputs.sql, supabase/rollback/20261010120007_oral_plan_inputs_down.sql)
# on a scratch PostgreSQL 16 cluster, and its proof that the Telegram bot plans the same oral questions as the site:
#   1. the base (the repo's local baselines, the live migrations they rehearse, the exam container's migrations, T1's bot
#      migrations with cron / net stubbed when pg_cron / pg_net are not installed) → catalog fingerprint;
#   2. the migration twice (the second changes nothing; no line of the base changes) → the behaviour test
#      (oral_plan_inputs.sql) → T1's behaviour and claims tests still pass → telegram_bot.sql with the T11 block spliced in
#      reports contract_ok (and as it is, too) → the container's contract still ok;
#   3. the equivalence (fails loudly on any difference):
#      a. meldy_private.oral_sheet_for = the Space's own _load_state + _sheet_response (backend venv, python -I, the
#         backend's SupabaseRest over a PostgREST stand-in: psql as role authenticated with the user's JWT sub) for every
#         exam of the fixture, field by field (the display-only `short` aside: equal unless the Space's short_problem
#         refuses it); P0002 where the Space answers 404; py_str / oral_rubric_key / oral_clean_points /
#         oral_clean_materials = the backend's str() / oral.rubric_key / _clean_points / _clean_materials on random JSON;
#      b. meldy_private.oral_events_for (through oral_events_json) and bot_oral_inputs' events = the site's real
#         fetchSheetEvents / fetchQuestionEvents (api/learning.ts, in Node, the same stand-in);
#      c. the site's real loadOralPlanItems (fed the Space's JSON) = the bot's oralPartsFromInputs (a flat copy of the
#         core, fed bot_oral_inputs' JSON, in UTC with the plan's day) for users × exams × 5 moments × 7 zones, and the day
#         plans (decodePlanInputs + the oral dates + planDay) equal;
#      d. the core in plain Node (oral_plan_core_node.test.mjs: imports, the flat copy, `today` across zones);
#   4. the rollback twice → catalog = the base; applied again = the first apply.
# Usage: supabase/tests/local/oral_plan_inputs_equivalence.sh
# Env (all optional): T11_PG_PORT (54391); T11_WORK (scratch dir, default ${TMPDIR:-/tmp}/meldy-t11); PG_BIN
#   (/usr/lib/postgresql/16/bin); T11_PYTHON (the backend's venv python, default backend/.venv/bin/python, else python3 —
#   it needs the backend's requirements); T11_FUZZ (random values, 3000). A cluster already listening on the port is used
#   as it is; otherwise one is created under T11_WORK, started, and stopped at the end. Exit 0 only when all is green.
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
ROOT=$(cd "$SB/.." && pwd)
PORT=${T11_PG_PORT:-54391}
WORK=${T11_WORK:-${TMPDIR:-/tmp}/meldy-t11}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
PY=${T11_PYTHON:-$([ -x "$ROOT/backend/.venv/bin/python" ] && echo "$ROOT/backend/.venv/bin/python" || echo python3)}
FUZZ=${T11_FUZZ:-3000}
MIG=$SB/migrations/20261010120007_oral_plan_inputs.sql
DOWN=$SB/rollback/20261010120007_oral_plan_inputs_down.sql
CONTRACT=$SB/tests/telegram_bot.sql
BLOCK=$HERE/telegram_bot_t11_block.sql
FINGERPRINT=$HERE/containers_fingerprint.sql
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
OUT=$WORK/out
mkdir -p "$OUT"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
FAILS=0
ok() { printf '  ok    %-66s %s\n' "$1" "${2:-}"; }
bad() { printf '  FAIL  %-66s %s\n' "$1" "${2:-}"; FAILS=$((FAILS + 1)); }

# ── the cluster (postgres refuses to run as root: a user namespace maps root to uid 1000) ─────────────────────────────
as_pg() { if [ "$(id -u)" = 0 ]; then unshare --user --map-user=1000 --map-group=1000 bash -c "$1"; else bash -c "$1"; fi; }
STARTED=0
if ! "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT"; then
  if [ ! -f "$WORK/pg/data/PG_VERSION" ]; then
    mkdir -p "$WORK/pg"
    as_pg "'$PG_BIN/initdb' -D '$WORK/pg/data' -U postgres -A trust -E UTF8 --locale=C.UTF-8 > '$WORK/pg/initdb.log' 2>&1" \
      || { echo "initdb failed: $WORK/pg/initdb.log"; exit 2; }
  fi
  as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -l '$WORK/pg/server.log' -o \"-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1\" -w start" >/dev/null \
    || { echo "the cluster did not start: $WORK/pg/server.log"; exit 2; }
  STARTED=1
fi
stop_cluster() { if [ $STARTED = 1 ]; then as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -m fast -w stop" >/dev/null && echo "cluster stopped"; fi; }
trap stop_cluster EXIT
echo "oral plan inputs (T11) rehearsal: PostgreSQL $("${PSQL[@]}" -d postgres -c 'show server_version') on 127.0.0.1:$PORT, work dir $WORK"

run() { "${PSQL[@]}" -d "$1" -f "$2" > "$OUT/last.log" 2>&1 || { echo "    $2 failed on $1:"; grep -v NOTICE "$OUT/last.log" | head -5 | sed 's/^/    /'; return 1; }; }
fresh() { "${PSQL[@]}" -d postgres -c "drop database if exists $1" -c "create database $1 template t11_base" >/dev/null 2>&1; }
fingerprint() { "${PSQL[@]}" -d "$1" -f "$FINGERPRINT" > "$2"; }
field() { python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(json.dumps(d$1))"; }
first_error() { grep -m1 'ERROR\|FAILED' "$1" | sed 's/^psql:[^:]*:[0-9]*: //'; }

# ── 1. the base: what the migration meets live ──────────────────────────────────────────────────────────────────────
STUBS=0
if [ "$("${PSQL[@]}" -d postgres -c "select count(*) from pg_available_extensions where name in ('pg_cron', 'pg_net')")" != 2 ]; then STUBS=1; fi
load_base() {
  "${PSQL[@]}" -d postgres -c "drop database if exists t11_base" -c "create database t11_base encoding 'UTF8' template template0" >/dev/null 2>&1 || return 1
  for f in tests/local/baseline.sql migrations/20261003083154_hackathon_journal_exams_oral.sql migrations/20261005143420_cheat_sheet.sql \
           tests/local/exam_shares_baseline.sql migrations/20261007110403_exam_shares.sql migrations/20261007110457_exam_shares_revokes.sql; do
    run t11_base "$SB/$f" || return 1
  done
  "${PSQL[@]}" -d t11_base -c "alter table auth.users add column if not exists created_at timestamptz not null default now()" >/dev/null || return 1
  run t11_base "$SB/migrations/20261005042323_app_telemetry.sql" || return 1
  run t11_base "$SB/tests/local/ai_quota_baseline.sql" || return 1
  # As containers_run_all.sh: live had no duplicate ai_usage day rows; merge the baseline's two before the quota files.
  "${PSQL[@]}" -d t11_base >/dev/null <<'SQL' || return 1
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
           migrations/20261010074500_containers_fk_indexes.sql migrations/20261010110000_containers_oral_codes_closed.sql; do
    run t11_base "$SB/$f" || return 1
  done
  if [ $STUBS = 1 ]; then
    # LOCAL STUBS, as telegram_bot_run.sh: pg_cron 1.6's cron.schedule / unschedule / job / job_run_details and pg_net
    # 0.20's net.http_post (recording its calls), so T1's cron file applies.
    "${PSQL[@]}" -d t11_base >/dev/null <<'SQL' || return 1
create schema if not exists cron;
create schema if not exists net;
create schema if not exists extensions;
create table if not exists cron.job (
  jobid bigserial primary key, schedule text not null, command text not null, nodename text not null default 'localhost',
  nodeport integer not null default 5432, database text not null default current_database(),
  username text not null default current_user, active boolean not null default true, jobname text unique);
create table if not exists cron.job_run_details (
  jobid bigint, runid bigserial primary key, job_pid integer, database text, username text, command text, status text,
  return_message text, start_time timestamptz, end_time timestamptz);
create or replace function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$
  insert into cron.job (jobname, schedule, command) values (job_name, schedule, command)
  on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command
  returning jobid $$;
create or replace function cron.unschedule(job_name text) returns boolean language plpgsql as $$
begin
  delete from cron.job where jobname = job_name;
  if not found then raise exception 'could not find valid entry for job ''%''', job_name; end if;
  return true;
end $$;
create table if not exists net.calls (
  id bigserial primary key, url text, body jsonb, params jsonb, headers jsonb, timeout_milliseconds integer,
  at timestamptz not null default clock_timestamp());
create or replace function net.http_post(url text, body jsonb default '{}'::jsonb, params jsonb default '{}'::jsonb,
  headers jsonb default '{"Content-Type": "application/json"}'::jsonb, timeout_milliseconds integer default 5000)
  returns bigint language sql as $$
  insert into net.calls (url, body, params, headers, timeout_milliseconds)
  values (url, body, params, headers, timeout_milliseconds) returning id $$;
SQL
    sed -E 's/^(create extension if not exists pg_(cron|net) .*)$/-- (local: stubbed) \1/' \
      "$SB/migrations/20261010120001_telegram_bot_cron.sql" > "$OUT/cron_local.sql"
    CRON_RUN=$OUT/cron_local.sql
  else
    CRON_RUN=$SB/migrations/20261010120001_telegram_bot_cron.sql
  fi
  run t11_base "$SB/migrations/20261010120000_telegram_bot.sql" && run t11_base "$CRON_RUN" \
    && run t11_base "$SB/migrations/20261010120002_telegram_bot_revokes.sql"
}
contract_t11() {  # the contract with T11's block spliced in (a scratch copy of T1's file)
  python3 - "$CONTRACT" "$BLOCK" "$OUT/telegram_bot_t11.sql" <<'PY'
import sys
contract = open(sys.argv[1], encoding="utf-8").read()
block = open(sys.argv[2], encoding="utf-8").read()
out = sys.argv[3]
def part(name):
    return block.split(f"-- >>> {name}\n", 1)[1].split(f"-- <<< {name}\n", 1)[0]
marks = {"bot_fns": "  -- T9: , ('T9', 'bot_file_offer(…)'), ('T9', 'bot_file_redeem(…)')\n", "checks": "  -- ── T9: 70–89 ──\n"}
for name, mark in marks.items():
    if contract.count(mark) != 1:
        raise SystemExit(f"the marker of [{name}] is not in telegram_bot.sql once")
    contract = contract.replace(mark, mark + part(name))
open(out, "w", encoding="utf-8").write(contract)
PY
  "${PSQL[@]}" -d "$1" -f "$OUT/telegram_bot_t11.sql" 2>&1
}

T0=$(date +%s)
echo "1. base"
if load_base; then ok "base loaded (t11_base)" "$([ $STUBS = 1 ] && echo 'cron and net stubbed' || echo 'pg_cron and pg_net installed')"
else bad "base loaded"; echo "cannot continue"; exit 1; fi
fingerprint t11_base "$OUT/fp_base.txt"
BASE_LINES=$(wc -l < "$OUT/fp_base.txt")

echo "2. the migration"
fresh t11_main
if run t11_main "$MIG"; then fingerprint t11_main "$OUT/fp_after.txt"; ok "applied"; else bad "applied"; echo "cannot continue"; exit 1; fi
if run t11_main "$MIG"; then
  fingerprint t11_main "$OUT/fp_again.txt"
  if cmp -s "$OUT/fp_after.txt" "$OUT/fp_again.txt"; then ok "applied again" "catalog unchanged"
  else bad "applied again" "$(diff "$OUT/fp_after.txt" "$OUT/fp_again.txt" | head -3 | tr '\n' ' ')"; fi
else bad "applied again"; fi
CHANGED=$(comm -23 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt") | wc -l)
NEW=$(comm -13 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt") | wc -l)
if [ "$CHANGED" = 0 ]; then ok "objects of the base changed or gone" "0 of $BASE_LINES; $NEW new"
else bad "objects of the base changed or gone" "$CHANGED: $(comm -23 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt") | head -3 | tr '\n' ' ')"; fi
if "${PSQL[@]}" -d t11_main -f "$HERE/oral_plan_inputs.sql" > "$OUT/behaviour.log" 2>&1 && grep -q 'ORAL PLAN INPUTS CHECKS PASSED' "$OUT/behaviour.log"; then
  ok "behaviour (oral_plan_inputs.sql)" "ORAL PLAN INPUTS CHECKS PASSED"
else bad "behaviour (oral_plan_inputs.sql)" "$(first_error "$OUT/behaviour.log")"; fi
for t in telegram_bot_behaviour telegram_bot_claims; do
  word=$([ $t = telegram_bot_behaviour ] && echo 'TELEGRAM BOT CHECKS PASSED' || echo 'TELEGRAM BOT CLAIMS PASSED')
  if "${PSQL[@]}" -d t11_main -f "$HERE/$t.sql" > "$OUT/$t.log" 2>&1 && grep -q "$word" "$OUT/$t.log"; then ok "T1's $t.sql with T11 applied" "$word"
  else bad "T1's $t.sql with T11 applied" "$(first_error "$OUT/$t.log")"; fi
done
C=$(contract_t11 t11_main)
if echo "$C" | grep -q '"contract_ok" : true' \
   && [ "$(echo "$C" | field "['checks']['oral_cores_private']")" = true ] \
   && [ "$(echo "$C" | field "['checks']['oral_inputs_read_only_through_the_link']")" = true ]; then
  ok "telegram_bot.sql + the T11 block" "contract_ok: true, $(echo "$C" | field "['checks']" | grep -o 'true' | wc -l) checks"
else bad "telegram_bot.sql + the T11 block" "$(echo "$C" | field "['failed']" 2>/dev/null || echo "$C" | head -3)"; fi
if "${PSQL[@]}" -d t11_main -f "$CONTRACT" 2>&1 | grep -q '"contract_ok" : true'; then ok "telegram_bot.sql as it is" "contract_ok: true"
else bad "telegram_bot.sql as it is"; fi
if contract_t11 t11_base | grep -q '"contract_ok" : false'; then ok "telegram_bot.sql + the T11 block before the migration" "reads, never raises: contract_ok false"
else bad "telegram_bot.sql + the T11 block before the migration"; fi
if "${PSQL[@]}" -d t11_main -f "$SB/tests/containers.sql" 2>&1 | grep -q '"contract_ok" : true'; then
  ok "the container's contract (supabase/tests/containers.sql)" "contract_ok: true"
else bad "the container's contract (supabase/tests/containers.sql)"; fi

echo "3. the equivalence (Space Python ↔ SQL ↔ site TS ↔ the bot's copy)"
fresh t11_eq
EQ_OK=1
run t11_eq "$MIG" || EQ_OK=0
EQPY=$HERE/oral_plan_inputs_equivalence.py
if [ $EQ_OK = 1 ] && (cd "$OUT" && "$PY" -I "$EQPY" fixture t11_eq); then :; else bad "the fixture" "($PY)"; EQ_OK=0; fi
if [ $EQ_OK = 1 ]; then
  (cd "$OUT" && "$PY" -I "$EQPY" sheets t11_eq "$OUT/sheets.json") || FAILS=$((FAILS + 1))
  (cd "$OUT" && "$PY" -I "$EQPY" fuzz t11_eq "$FUZZ") || FAILS=$((FAILS + 1))
  (cd "$OUT" && T11_DB=t11_eq node --experimental-strip-types --no-warnings "$HERE/oral_plan_inputs_equivalence.mjs" "$OUT") || FAILS=$((FAILS + 1))
fi
if node --experimental-strip-types --no-warnings --test "$HERE/oral_plan_core_node.test.mjs" > "$OUT/core_node.log" 2>&1; then
  ok "the core in plain Node (oral_plan_core_node.test.mjs)" "$(grep -E '^# (pass|fail)' "$OUT/core_node.log" | tr '\n' ' ')"
else bad "the core in plain Node (oral_plan_core_node.test.mjs)" "$(grep -m3 'not ok\|Error' "$OUT/core_node.log" | tr '\n' ' ')"; fi

echo "4. the rollback"
if run t11_main "$DOWN" && run t11_main "$DOWN"; then ok "rollback applied twice"; else bad "rollback applied twice"; fi
fingerprint t11_main "$OUT/fp_down.txt"
D=$(diff "$OUT/fp_base.txt" "$OUT/fp_down.txt" | wc -l)
if [ "$D" = 0 ]; then ok "rollback → catalog equals the base" "0 differing lines of $BASE_LINES"
else bad "rollback → catalog equals the base" "$D differing lines: $(diff "$OUT/fp_base.txt" "$OUT/fp_down.txt" | head -3 | tr '\n' ' ')"; fi
if run t11_main "$MIG"; then
  fingerprint t11_main "$OUT/fp_reup.txt"
  if cmp -s "$OUT/fp_after.txt" "$OUT/fp_reup.txt"; then ok "applied again after the rollback" "= the first apply"
  else bad "applied again after the rollback" "$(diff "$OUT/fp_after.txt" "$OUT/fp_reup.txt" | head -3 | tr '\n' ' ')"; fi
else bad "applied again after the rollback"; fi

echo
echo "elapsed $(( $(date +%s) - T0 )) s; outputs in $OUT"
if [ $FAILS = 0 ]; then echo "ALL ORAL PLAN INPUTS CHECKS GREEN"; exit 0; else echo "$FAILS CHECK(S) FAILED"; exit 1; fi
