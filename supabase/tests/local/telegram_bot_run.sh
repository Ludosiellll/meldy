#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. The whole rehearsal of the Telegram bot's database core (package T1:
# supabase/migrations/20261010120000_telegram_bot.sql, _cron.sql, _revokes.sql and
# supabase/rollback/20261010120000_telegram_bot_down.sql) on a scratch PostgreSQL 16 cluster:
#   the base (the repo's local baselines, the live migrations they rehearse, the exam container's migrations, and stubs
#   of the schemas cron and net when pg_cron / pg_net are not installed here) → catalog fingerprint → the contract on
#   the base never raises → T1's main and cron files twice → the contract before the revokes (exactly the three
#   default-privilege gaps) → behaviour and claims under those grants → the revokes twice → behaviour and claims again →
#   contract_ok → the main and cron files once more (catalog unchanged, still contract_ok) → no line of the base changed
#   → the container's contract still ok → concurrency (two claims at once, two ledger begins at once, one code claimed
#   from two Telegrams at once) → the rollback twice (catalog = the base) → apply again (= the first apply).
# Usage: supabase/tests/local/telegram_bot_run.sh
# Env (all optional): TELEGRAM_PG_PORT (54381); TELEGRAM_WORK (scratch dir, default ${TMPDIR:-/tmp}/meldy-telegram);
#   PG_BIN (/usr/lib/postgresql/16/bin). A cluster already listening on the port is used as it is; otherwise one is
#   created under TELEGRAM_WORK, started, and stopped at the end. Exit code 0 only when every check is green.
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
PORT=${TELEGRAM_PG_PORT:-54381}
WORK=${TELEGRAM_WORK:-${TMPDIR:-/tmp}/meldy-telegram}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
MIG=$SB/migrations/20261010120000_telegram_bot.sql
CRON=$SB/migrations/20261010120001_telegram_bot_cron.sql
REV=$SB/migrations/20261010120002_telegram_bot_revokes.sql
DOWN=$SB/rollback/20261010120000_telegram_bot_down.sql
CONTRACT=$SB/tests/telegram_bot.sql
FINGERPRINT=$HERE/containers_fingerprint.sql
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
OUT=$WORK/out
mkdir -p "$OUT"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
FAILS=0
ok() { printf '  ok    %-62s %s\n' "$1" "${2:-}"; }
bad() { printf '  FAIL  %-62s %s\n' "$1" "${2:-}"; FAILS=$((FAILS + 1)); }

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
echo "telegram bot (T1) rehearsal: PostgreSQL $("${PSQL[@]}" -d postgres -c 'show server_version') on 127.0.0.1:$PORT, work dir $WORK"

run() { "${PSQL[@]}" -d "$1" -f "$2" > "$OUT/last.log" 2>&1 || { echo "    $2 failed on $1:"; grep -v NOTICE "$OUT/last.log" | head -5 | sed 's/^/    /'; return 1; }; }
fresh() { "${PSQL[@]}" -d postgres -c "drop database if exists $1" -c "create database $1 template t_base" >/dev/null 2>&1; }
fingerprint() { "${PSQL[@]}" -d "$1" -f "$FINGERPRINT" > "$2"; }
# The cron file grants postgres USAGE on schema cron and all on its tables (the Supabase docs' way of enabling pg_cron);
# they belong to the extension, which the rollback leaves installed. Comparisons with the base leave out the ACLs of the
# stub schema cron; cron_grants checks that those grants are its only change.
no_cron_acl() { sed -E 's/^(nsp cron owner=[^ ]*|rel cron\.[a-z_]+ kind=r) acl=[^ ]*/\1 acl=*/' "$1"; }
cron_grants() {  # $1 base fingerprint, $2 fingerprint after: every changed line of schema cron is postgres's grant
  local changed; changed=$(diff <(grep -E '^(nsp cron |rel cron\.)' "$1") <(grep -E '^(nsp cron |rel cron\.)' "$2") | grep '^>' || true)
  [ -z "$changed" ] || ! echo "$changed" | grep -vqE 'acl=\{postgres=(UC|arwdDxt)/postgres\}'
}
contract() { "${PSQL[@]}" -d "$1" -f "$CONTRACT" 2>&1; }
field() { python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(json.dumps(d$1))"; }

# The cron file as this cluster can take it: as it is when pg_cron and pg_net are installed here; otherwise without its
# two CREATE EXTENSION lines (the base then has the stubs below).
STUBS=0
if [ "$("${PSQL[@]}" -d postgres -c "select count(*) from pg_available_extensions where name in ('pg_cron', 'pg_net')")" != 2 ]; then
  STUBS=1
  sed -E 's/^(create extension if not exists pg_(cron|net) .*)$/-- (local: stubbed) \1/' "$CRON" > "$OUT/cron_local.sql"
  [ "$(grep -c '^-- (local: stubbed) create extension' "$OUT/cron_local.sql")" = 2 ] || { echo "the cron file's extension lines moved"; exit 2; }
  CRON_RUN=$OUT/cron_local.sql
else
  CRON_RUN=$CRON
fi
apply_t1() { run "$1" "$MIG" && run "$1" "$CRON_RUN"; }

# ── the base: what the bot's migrations meet live ───────────────────────────────────────────────────────────────────
load_base() {
  "${PSQL[@]}" -d postgres -c "drop database if exists t_base" -c "create database t_base encoding 'UTF8' template template0" >/dev/null 2>&1 || return 1
  for f in tests/local/baseline.sql migrations/20261003083154_hackathon_journal_exams_oral.sql migrations/20261005143420_cheat_sheet.sql \
           tests/local/exam_shares_baseline.sql migrations/20261007110403_exam_shares.sql migrations/20261007110457_exam_shares_revokes.sql; do
    run t_base "$SB/$f" || return 1
  done
  "${PSQL[@]}" -d t_base -c "alter table auth.users add column if not exists created_at timestamptz not null default now()" >/dev/null || return 1
  run t_base "$SB/migrations/20261005042323_app_telemetry.sql" || return 1
  run t_base "$SB/tests/local/ai_quota_baseline.sql" || return 1
  # As containers_run_all.sh: live had no duplicate ai_usage day rows; merge the baseline's two before the quota files.
  "${PSQL[@]}" -d t_base >/dev/null <<'SQL' || return 1
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
           migrations/20261010074500_containers_fk_indexes.sql; do
    run t_base "$SB/$f" || return 1
  done
  if [ $STUBS = 1 ]; then
    # LOCAL STUBS: the same names and signatures as pg_cron 1.6 (cron.schedule / cron.unschedule / cron.job /
    # cron.job_run_details) and pg_net 0.20 (net.http_post); net.http_post records its calls in net.calls.
    "${PSQL[@]}" -d t_base >/dev/null <<'SQL' || return 1
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
  fi
}
behaviour() {  # $1 db
  "${PSQL[@]}" -d "$1" -f "$HERE/telegram_bot_behaviour.sql" > "$OUT/behaviour.log" 2>&1
  grep -q 'TELEGRAM BOT CHECKS PASSED' "$OUT/behaviour.log"
}
claims() {  # $1 db
  "${PSQL[@]}" -d "$1" -f "$HERE/telegram_bot_claims.sql" > "$OUT/claims.log" 2>&1
  grep -q 'TELEGRAM BOT CLAIMS PASSED' "$OUT/claims.log"
}
first_error() { grep -m1 'ERROR\|FAILED' "$1" | sed 's/^psql:[^:]*:[0-9]*: //'; }

T0=$(date +%s)
echo "1. base"
if load_base; then ok "base loaded (t_base)" "$([ $STUBS = 1 ] && echo 'cron and net stubbed' || echo 'pg_cron and pg_net installed')"
else bad "base loaded"; echo "cannot continue"; exit 1; fi
fingerprint t_base "$OUT/fp_base.txt"
BASE_LINES=$(wc -l < "$OUT/fp_base.txt")
C=$(contract t_base)
if echo "$C" | grep -q '"contract_ok" : false'; then ok "telegram_bot.sql on the base: reads, never raises" "contract_ok false"
else bad "telegram_bot.sql on the base" "$C"; fi

echo "2. the migration (main + cron), before the revokes"
fresh t_main
if apply_t1 t_main && apply_t1 t_main; then ok "main and cron files applied twice"; else bad "main and cron files applied twice"; fi
FAILED=$(contract t_main | field "['failed']")
if [ "$FAILED" = '["bot_functions_closed_to_clients", "site_functions_authenticated_only", "bot_helpers_closed_to_clients"]' ]; then
  ok "contract before the revokes" "only the three default-privilege gaps"
else bad "contract before the revokes" "$FAILED"; fi
if behaviour t_main; then ok "behaviour (the migration's grants)" "TELEGRAM BOT CHECKS PASSED"
else bad "behaviour (the migration's grants)" "$(first_error "$OUT/behaviour.log")"; fi
if claims t_main; then ok "claims (the migration's grants)" "TELEGRAM BOT CLAIMS PASSED"
else bad "claims (the migration's grants)" "$(first_error "$OUT/claims.log")"; fi

echo "3. the revokes"
if run t_main "$REV" && run t_main "$REV"; then ok "revokes applied twice"; else bad "revokes applied twice"; fi
if behaviour t_main; then ok "behaviour (after the revokes)" "TELEGRAM BOT CHECKS PASSED"
else bad "behaviour (after the revokes)" "$(first_error "$OUT/behaviour.log")"; fi
if claims t_main; then ok "claims (after the revokes)" "TELEGRAM BOT CLAIMS PASSED"
else bad "claims (after the revokes)" "$(first_error "$OUT/claims.log")"; fi
C=$(contract t_main)
if echo "$C" | grep -q '"contract_ok" : true'; then ok "supabase/tests/telegram_bot.sql" "contract_ok: true, $(echo "$C" | field "['checks']" | grep -o 'true' | wc -l) checks"
else bad "supabase/tests/telegram_bot.sql" "$(echo "$C" | field "['failed']")"; fi
fingerprint t_main "$OUT/fp_after.txt"
if apply_t1 t_main; then
  fingerprint t_main "$OUT/fp_again.txt"
  if cmp -s "$OUT/fp_after.txt" "$OUT/fp_again.txt" && contract t_main | grep -q '"contract_ok" : true'; then
    ok "main and cron files re-applied after the revokes" "catalog unchanged, contract_ok true"
  else bad "main and cron files re-applied after the revokes" "$(diff "$OUT/fp_after.txt" "$OUT/fp_again.txt" | head -3 | tr '\n' ' ')"; fi
else bad "main and cron files re-applied after the revokes"; fi
CHANGED=$(comm -23 <(no_cron_acl "$OUT/fp_base.txt" | sort) <(no_cron_acl "$OUT/fp_after.txt" | sort) | wc -l)
NEW=$(comm -13 <(no_cron_acl "$OUT/fp_base.txt" | sort) <(no_cron_acl "$OUT/fp_after.txt" | sort) | wc -l)
if [ "$CHANGED" = 0 ]; then ok "objects of the base changed or gone" "0 of $BASE_LINES; $NEW new"
else bad "objects of the base changed or gone" "$CHANGED of $BASE_LINES: $(comm -23 <(no_cron_acl "$OUT/fp_base.txt" | sort) <(no_cron_acl "$OUT/fp_after.txt" | sort) | head -3 | tr '\n' ' ')"; fi
if cron_grants "$OUT/fp_base.txt" "$OUT/fp_after.txt"; then ok "schema cron: only the docs' grants to postgres" "$(diff <(grep -E '^(nsp cron |rel cron\.)' "$OUT/fp_base.txt") <(grep -E '^(nsp cron |rel cron\.)' "$OUT/fp_after.txt") | grep -c '^>') ACL lines"
else bad "schema cron: only the docs' grants to postgres"; fi
if "${PSQL[@]}" -d t_main -f "$SB/tests/containers.sql" 2>&1 | grep -q '"contract_ok" : true'; then
  ok "the container's contract (supabase/tests/containers.sql)" "contract_ok: true"
else bad "the container's contract (supabase/tests/containers.sql)"; fi

echo "4. concurrency (two sessions, service role)"
fresh t_conc
apply_t1 t_conc && run t_conc "$REV" || bad "concurrency database"
SVC="set role service_role; select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', false) is null;"
# a) two claims at once: 80 links due at 20:01 Minsk; claim A holds its transaction 2 s, claim B starts meanwhile.
"${PSQL[@]}" -d t_conc >/dev/null <<'SQL' || bad "race fixture"
insert into auth.users (id) select ('d0000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 80) g;
insert into bot.links (user_id, tg_user_id, chat_id, linked_at, last_seen_at)
select ('d0000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid, 20000 + g, 20000 + g, now() - interval '30 days', now() - interval '30 days'
  from generate_series(1, 80) g;
SQL
AT="((current_date + 3) + time '20:01') at time zone 'Europe/Minsk'"
{ echo "$SVC"; echo "begin;"; echo "select count(*) from public.bot_claim_reminders(50, $AT);"; echo "select pg_sleep(2); commit;"; } > "$OUT/race_a.sql"
{ echo "$SVC"; echo "select count(*) from public.bot_claim_reminders(50, $AT);"; } > "$OUT/race_b.sql"
"${PSQL[@]}" -d t_conc -f "$OUT/race_a.sql" > "$OUT/race_a.out" 2>&1 & PA=$!
sleep 0.7
TB0=$(date +%s.%N); "${PSQL[@]}" -d t_conc -f "$OUT/race_b.sql" > "$OUT/race_b.out" 2>&1; RB=$?; TB1=$(date +%s.%N)
wait $PA; RA=$?
NA=$(grep -E '^[0-9]+$' "$OUT/race_a.out" | head -1); NB=$(grep -E '^[0-9]+$' "$OUT/race_b.out" | head -1)
NC=$("${PSQL[@]}" -d t_conc -c "$SVC" -c "select count(*) from public.bot_claim_reminders(50, $AT)" | tail -1)
ROWS=$("${PSQL[@]}" -d t_conc -c "select count(*) || ' ' || count(distinct chat_id) from bot.deliveries where kind in ('reminder', 'ask')")
WAIT=$(awk "BEGIN { printf \"%.1f\", $TB1 - $TB0 }")
if [ $RA = 0 ] && [ $RB = 0 ] && [ "$NA" = 50 ] && [ "$NB" = 0 ] && [ "$NC" = 30 ] && [ "$ROWS" = "80 80" ] && awk "BEGIN { exit !($TB1 - $TB0 > 1.0) }"; then
  ok "two claims at once: no link twice" "A $NA, B $NB (waited ${WAIT} s on A's rows), next tick $NC; 80 rows, 80 chats"
else bad "two claims at once" "A=$NA B=$NB C=$NC rows=$ROWS waited=${WAIT}s $(cat "$OUT/race_a.out" "$OUT/race_b.out" | grep -m1 ERROR)"; fi
# b) two ledger begins of one update at once: new and busy.
{ echo "$SVC"; echo "begin;"; echo "select public.bot_update_begin(770001);"; echo "select pg_sleep(1.5); commit;"; } > "$OUT/ledger_a.sql"
{ echo "$SVC"; echo "select public.bot_update_begin(770001);"; } > "$OUT/ledger_b.sql"
"${PSQL[@]}" -d t_conc -f "$OUT/ledger_a.sql" > "$OUT/ledger_a.out" 2>&1 & PA=$!
sleep 0.5
"${PSQL[@]}" -d t_conc -f "$OUT/ledger_b.sql" > "$OUT/ledger_b.out" 2>&1; RB=$?
wait $PA; RA=$?
LA=$(grep -E '^(new|retry|done|busy)$' "$OUT/ledger_a.out"); LB=$(grep -E '^(new|retry|done|busy)$' "$OUT/ledger_b.out")
if [ $RA = 0 ] && [ $RB = 0 ] && [ "$LA" = new ] && [ "$LB" = busy ]; then ok "two begins of one update at once" "A $LA, B $LB"
else bad "two begins of one update at once" "A=$LA B=$LB"; fi
# c) one link code claimed from two Telegrams at once: one linked, one used.
CODE=$("${PSQL[@]}" -d t_conc -c "set role authenticated" -c "select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) is null" \
       -c "select public.telegram_link_start('Europe/Minsk') ->> 'code'" | tail -1)
{ echo "$SVC"; echo "begin;"; echo "select public.bot_link_claim('$CODE', 31001, 31001, 'ru', now()) ->> 'status';"; echo "select pg_sleep(1.5); commit;"; } > "$OUT/code_a.sql"
{ echo "$SVC"; echo "select public.bot_link_claim('$CODE', 31002, 31002, 'ru', now()) ->> 'status';"; } > "$OUT/code_b.sql"
"${PSQL[@]}" -d t_conc -f "$OUT/code_a.sql" > "$OUT/code_a.out" 2>&1 & PA=$!
sleep 0.5
"${PSQL[@]}" -d t_conc -f "$OUT/code_b.sql" > "$OUT/code_b.out" 2>&1; RB=$?
wait $PA; RA=$?
KA=$(grep -E '^(linked|used|expired|invalid|slow_down|private_only)$' "$OUT/code_a.out"); KB=$(grep -E '^(linked|used|expired|invalid|slow_down|private_only)$' "$OUT/code_b.out")
LINKS=$("${PSQL[@]}" -d t_conc -c "select count(*) from bot.links where user_id = 'aaaaaaaa-0000-0000-0000-000000000001' and unlinked_at is null")
if [ $RA = 0 ] && [ $RB = 0 ] && [ "$KA" = linked ] && [ "$KB" = used ] && [ "$LINKS" = 1 ]; then ok "one code from two Telegrams at once" "A $KA, B $KB, one active link"
else bad "one code from two Telegrams at once" "A=$KA B=$KB links=$LINKS"; fi

echo "5. the rollback"
if run t_main "$DOWN" && run t_main "$DOWN"; then ok "rollback applied twice"; else bad "rollback applied twice"; fi
fingerprint t_main "$OUT/fp_down.txt"
D=$(diff <(no_cron_acl "$OUT/fp_base.txt") <(no_cron_acl "$OUT/fp_down.txt") | wc -l)
if [ "$D" = 0 ] && cron_grants "$OUT/fp_base.txt" "$OUT/fp_down.txt"; then
  ok "rollback → catalog equals the base" "0 differing lines (pg_cron's grants to postgres stay)"
else bad "rollback → catalog equals the base" "$D differing lines"; fi
if [ "$("${PSQL[@]}" -d t_main -c "select count(*) from cron.job where jobname = 'meldy-telegram-tick'")" = 0 ]; then ok "rollback unschedules the tick"
else bad "rollback unschedules the tick"; fi
if "${PSQL[@]}" -d t_main -f "$SB/tests/containers.sql" 2>&1 | grep -q '"contract_ok" : true'; then ok "the container's contract after the rollback" "contract_ok: true"
else bad "the container's contract after the rollback"; fi
if apply_t1 t_main && run t_main "$REV"; then
  fingerprint t_main "$OUT/fp_reup.txt"
  if cmp -s "$OUT/fp_after.txt" "$OUT/fp_reup.txt"; then ok "applied again after the rollback" "= the first apply"
  else bad "applied again after the rollback" "$(diff "$OUT/fp_after.txt" "$OUT/fp_reup.txt" | head -3 | tr '\n' ' ')"; fi
else bad "applied again after the rollback"; fi
# A later package's object in schema bot stops the rollback (no CASCADE): T5's table stays, nothing is half-dropped.
"${PSQL[@]}" -d t_main -c "create table bot.sessions (sid text primary key)" >/dev/null
if ! "${PSQL[@]}" -d t_main -f "$DOWN" > "$OUT/down_blocked.log" 2>&1 \
   && [ "$("${PSQL[@]}" -d t_main -c "select count(*) from pg_proc where proname = 'bot_today'")" = 1 ]; then
  ok "rollback stops while a later package's table is in schema bot" "and rolls back whole"
else bad "rollback with a later package's table" "$(head -3 "$OUT/down_blocked.log" | tr '\n' ' ')"; fi

echo
echo "elapsed $(( $(date +%s) - T0 )) s; outputs in $OUT"
if [ $FAILS = 0 ]; then echo "ALL TELEGRAM BOT CHECKS GREEN"; exit 0; else echo "$FAILS CHECK(S) FAILED"; exit 1; fi
