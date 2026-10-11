#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. The whole rehearsal of supabase/migrations/20261009093500_containers.sql
# (+ 20261009093501_containers_revokes.sql, supabase/rollback/20261009093500_containers_down.sql) on a scratch
# PostgreSQL 16 cluster:
#   the base (the repo's local baselines + the live migrations they rehearse) → catalog fingerprint and the repo's six
#   oral checks (+ three more contract checks) → the migration twice → the contract before the revokes (exactly the
#   four default-privilege gaps) → behaviour (writes the real RPC outputs and the rule vectors) → rule vectors equal
#   contracts/container/rule_vectors.json → tsc --strict of the outputs against frontend/src/types/container.ts → oral
#   checks → the revokes twice → behaviour again → contract_ok → the live check of the page's «not found» → the
#   migration once more (keeps the revokes) → fingerprint (no line of the base changed or gone) → oral checks → the
#   follow-ups' rollback (FK indexes, the oral-codes fix, the frozen day's start and pace, the page's «not found»:
#   exactly their lines go) and again → the rollback twice (catalog = the base) → oral checks → apply again in the live
#   order (= the first apply) → concurrency → 2000 items × 30 members (reads, 1000-row cap) →
#   docs/container-numbers.sql. The follow-ups (FOLLOW, applied live after the two) ride every apply of the migration.
# Usage: supabase/tests/local/containers_run_all.sh
# Env (all optional): CONTAINERS_PG_PORT (54371); CONTAINERS_WORK (scratch dir, default ${TMPDIR:-/tmp}/meldy-containers);
#   PG_BIN (/usr/lib/postgresql/16/bin); CONTRACT_TS (frontend/src/types/container.ts); TSC (frontend's tsc);
#   UPDATE_VECTORS=1 rewrites contracts/container/rule_vectors.json from this run. A cluster already listening on the
#   port is used as it is (CONTAINERS_PG_LOG may name its log); otherwise one is created under CONTAINERS_WORK,
#   started, and stopped at the end. Exit code 0 only when every check is green.
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
REPO=$(cd "$SB/.." && pwd)
PORT=${CONTAINERS_PG_PORT:-54371}
WORK=${CONTAINERS_WORK:-${TMPDIR:-/tmp}/meldy-containers}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
CONTRACT_TS=${CONTRACT_TS:-$REPO/frontend/src/types/container.ts}
TSC=${TSC:-$REPO/frontend/node_modules/typescript/bin/tsc}
MIG=$SB/migrations/20261009093500_containers.sql
REV=$SB/migrations/20261009093501_containers_revokes.sql
DOWN=$SB/rollback/20261009093500_containers_down.sql
FOLLOW=("$SB/migrations/20261010074500_containers_fk_indexes.sql" "$SB/migrations/20261010110000_containers_oral_codes_closed.sql"
        "$SB/migrations/20261010130000_containers_frozen_pace.sql" "$SB/migrations/20261011100000_containers_not_found_null.sql")
FOLLOW_DOWN=("$SB/rollback/20261011100000_containers_not_found_null_down.sql" "$SB/rollback/20261010130000_containers_frozen_pace_down.sql"
             "$SB/rollback/20261010110000_containers_oral_codes_closed_down.sql" "$SB/rollback/20261010074500_containers_fk_indexes_down.sql")
VECTORS=$REPO/contracts/container/rule_vectors.json
NUMBERS=$REPO/docs/container-numbers.sql
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
OUT=$WORK/out
mkdir -p "$OUT"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
FAILS=0
ok() { printf '  ok    %-58s %s\n' "$1" "${2:-}"; }
bad() { printf '  FAIL  %-58s %s\n' "$1" "${2:-}"; FAILS=$((FAILS + 1)); }

# ── the cluster ───────────────────────────────────────────────────────────────────────────────────────────────────────
as_pg() { if [ "$(id -u)" = 0 ]; then unshare --user --map-user=1000 --map-group=1000 bash -c "$1"; else bash -c "$1"; fi; }
STARTED=0
PG_LOG=${CONTAINERS_PG_LOG:-}
if ! "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT"; then
  if [ ! -f "$WORK/pg/data/PG_VERSION" ]; then
    mkdir -p "$WORK/pg"
    as_pg "'$PG_BIN/initdb' -D '$WORK/pg/data' -U postgres -A trust -E UTF8 --locale=C.UTF-8 > '$WORK/pg/initdb.log' 2>&1" \
      || { echo "initdb failed: $WORK/pg/initdb.log"; exit 2; }
  fi
  as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -l '$WORK/pg/server.log' -o \"-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1\" -w start" >/dev/null \
    || { echo "the cluster did not start: $WORK/pg/server.log"; exit 2; }
  STARTED=1
  PG_LOG=$WORK/pg/server.log
fi
stop_cluster() { if [ $STARTED = 1 ]; then as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -m fast -w stop" >/dev/null && echo "cluster stopped"; fi; }
trap stop_cluster EXIT
echo "containers rehearsal: PostgreSQL $("${PSQL[@]}" -d postgres -c 'show server_version') on 127.0.0.1:$PORT, work dir $WORK"

run() { "${PSQL[@]}" -d "$1" -f "$2" > "$OUT/last.log" 2>&1 || { echo "    $2 failed on $1:"; grep -v NOTICE "$OUT/last.log" | head -5 | sed 's/^/    /'; return 1; }; }
fresh() { "${PSQL[@]}" -d postgres -c "drop database if exists $1" -c "create database $1 template c_base" >/dev/null 2>&1; }
follow() { local f; for f in "${FOLLOW[@]}"; do run "$1" "$f" || return 1; done; }
follow_down() { local f; for f in "${FOLLOW_DOWN[@]}"; do run "$1" "$f" || return 1; done; }

# ── the base: what the containers migration meets live (the repo's local baselines + the live migrations they rehearse)
load_base() {
  "${PSQL[@]}" -d postgres -c "drop database if exists c_base" -c "create database c_base encoding 'UTF8' template template0" >/dev/null 2>&1 || return 1
  for f in tests/local/baseline.sql migrations/20261003083154_hackathon_journal_exams_oral.sql migrations/20261005143420_cheat_sheet.sql \
           tests/local/exam_shares_baseline.sql migrations/20261007110403_exam_shares.sql migrations/20261007110457_exam_shares_revokes.sql; do
    run c_base "$SB/$f" || return 1
  done
  "${PSQL[@]}" -d c_base -c "alter table auth.users add column if not exists created_at timestamptz not null default now()" >/dev/null || return 1
  run c_base "$SB/migrations/20261005042323_app_telemetry.sql" || return 1
  run c_base "$SB/tests/local/ai_quota_baseline.sql" || return 1
  # Live had no duplicate ai_usage day rows (20261004205613's header); the quota baseline keeps two on purpose for
  # 20261005031722's merge, which part 1 refuses: merge them first, the way part 2 does.
  "${PSQL[@]}" -d c_base >/dev/null <<'SQL' || return 1
update public.ai_usage u set requests_count = t.total
  from (select user_id, date, min(created_at) as first, sum(requests_count) as total from public.ai_usage
         where user_id is not null group by 1, 2 having count(*) > 1) t
 where u.user_id = t.user_id and u.date = t.date and u.created_at = t.first;
delete from public.ai_usage u
 using (select user_id, date, min(created_at) as first from public.ai_usage where user_id is not null group by 1, 2 having count(*) > 1) t
 where u.user_id = t.user_id and u.date = t.date and u.created_at > t.first;
SQL
  for f in migrations/20261004205613_ai_quota_server.sql migrations/20261005031722_ai_quota_lockdown.sql \
           migrations/20261007103621_oral_answer_texts.sql tests/local/containers_baseline.sql; do
    run c_base "$SB/$f" || return 1
  done
}

# The repo's six oral checks (behaviour files: exit code 0; contract reports: contract_ok true), plus three more
# contract reports of the base (AI quota, telemetry, oral answer texts). Prints "<six>/6 · <three>/3".
oral_checks() {
  local six=0 three=0 o
  for f in journal_rpc_behaviour cheat_sheet_behaviour exam_shares_behaviour; do
    o=$("${PSQL[@]}" -d "$1" -f "$SB/tests/local/$f.sql" 2>&1) && six=$((six + 1)) || echo "$1 $f: $o" >> "$OUT/oral_failures.txt"
  done
  for f in cheat_sheet journal_exams_rls exam_shares; do
    o=$("${PSQL[@]}" -d "$1" -f "$SB/tests/$f.sql" 2>&1)
    if [ $? = 0 ] && ! echo "$o" | grep -q '"contract_ok" *: *false'; then six=$((six + 1)); else echo "$1 $f: $o" >> "$OUT/oral_failures.txt"; fi
  done
  for f in ai_quota_server app_telemetry oral_answer_texts; do
    o=$("${PSQL[@]}" -d "$1" -f "$SB/tests/$f.sql" 2>&1)
    if [ $? = 0 ] && echo "$o" | grep -q '"contract_ok" *: *true'; then three=$((three + 1)); else echo "$1 $f: $o" >> "$OUT/oral_failures.txt"; fi
  done
  echo "$six/6 · $three/3"
}
expect_oral() { local r; r=$(oral_checks "$1"); if [ "$r" = "6/6 · 3/3" ]; then ok "$2" "$r"; else bad "$2" "$r (see $OUT/oral_failures.txt)"; fi; }
contract() { "${PSQL[@]}" -d "$1" -f "$SB/tests/containers.sql" 2>&1; }
fingerprint() { "${PSQL[@]}" -d "$1" -f "$HERE/containers_fingerprint.sql" > "$2"; }
behaviour() {  # $1 db, then psql -v options
  local db=$1; shift
  "${PSQL[@]}" -d "$db" "$@" -f "$HERE/containers_behaviour.sql" > "$OUT/behaviour.log" 2>&1
  grep -q 'CONTAINER CHECKS PASSED' "$OUT/behaviour.log"
}
rm -f "$OUT/oral_failures.txt"

T0=$(date +%s)
echo "1. base"
if load_base; then ok "base loaded (c_base)"; else bad "base loaded"; echo "cannot continue"; exit 1; fi
fingerprint c_base "$OUT/fp_base.txt"
BASE_LINES=$(wc -l < "$OUT/fp_base.txt")
expect_oral c_base "oral checks on the base"
C=$(contract c_base)
if echo "$C" | grep -q '"contract_ok" : false'; then ok "containers.sql on the base: reads, never raises" "contract_ok false"; else bad "containers.sql on the base" "$C"; fi

echo "2. the migration"
fresh c_main
if run c_main "$MIG" && run c_main "$MIG" && follow c_main && follow c_main; then ok "migration applied twice, the follow-ups twice"
else bad "migration applied twice, the follow-ups twice"; fi
C=$(contract c_main)
FAILED=$(echo "$C" | grep -o '"failed" : \[[^]]*\]')
if [ "$FAILED" = '"failed" : ["anon_runs_only_the_preview", "anon_reads_no_table", "clients_never_write_log_states_items", "link_salt_hidden"]' ]; then
  ok "contract before the revokes" "only the four default-privilege gaps"
else bad "contract before the revokes" "$FAILED"; fi
if behaviour c_main -v vectors_out="$OUT/rule_vectors.json" -v samples_out="$OUT/samples.tsv"; then
  ok "behaviour (the migration's grants)" "CONTAINER CHECKS PASSED"
else bad "behaviour (the migration's grants)" "$(grep -m1 'ERROR\|FAILED' "$OUT/behaviour.log")"; fi
if [ -s "$OUT/rule_vectors.json" ]; then
  CASES=$(node -e 'const d=require(process.argv[1]); let e=0; for (const c of d.cases) e+=c.events.length; console.log(d.cases.length + " cases, " + e + " events")' "$OUT/rule_vectors.json" 2>/dev/null || echo "?")
  if [ "${UPDATE_VECTORS:-0}" = 1 ]; then
    mkdir -p "$(dirname "$VECTORS")" && cp "$OUT/rule_vectors.json" "$VECTORS" && ok "rule vectors written to contracts/container/rule_vectors.json" "$CASES"
  elif cmp -s "$OUT/rule_vectors.json" "$VECTORS"; then ok "rule vectors = contracts/container/rule_vectors.json" "$CASES"
  else bad "rule vectors = contracts/container/rule_vectors.json" "they differ (UPDATE_VECTORS=1 rewrites the file)"; fi
else bad "rule vectors generated"; fi
if [ -f "$CONTRACT_TS" ] && [ -x "$TSC" ] && [ -s "$OUT/samples.tsv" ]; then
  mkdir -p "$OUT/ts" && cp "$CONTRACT_TS" "$OUT/ts/container.ts"
  node -e '
const fs = require("fs");
const lines = fs.readFileSync(process.argv[1], "utf8").split("\n").filter(Boolean);
let out = "// Real outputs of the containers RPCs (containers_behaviour.sql), typed against the contract.\n";
out += "import type { ContainerRpc, TestItem } from \"./container\";\n";
const rpcs = new Set();
for (const l of lines) {
  const [name, rpc, json] = l.split("\t");
  const type = rpc === "TestItem[]" ? "TestItem[]" : `ContainerRpc[${JSON.stringify(rpc)}]["returns"]`;
  if (rpc !== "TestItem[]") rpcs.add(rpc);
  out += `export const s_${name}: ${type} = ${json};\n`;
}
out += `export const covered = ${JSON.stringify([...rpcs].sort())} as const;\n`;
out += "type Missing = Exclude<keyof ContainerRpc, typeof covered[number]>;\n";
out += "export const allCovered: [Missing] extends [never] ? true : Missing = true;\n";
fs.writeFileSync(process.argv[2], out);' "$OUT/samples.tsv" "$OUT/ts/samples.ts"
  if (cd "$OUT/ts" && "$TSC" --strict --noEmit --target es2022 --module esnext --moduleResolution bundler samples.ts > "$OUT/tsc.log" 2>&1); then
    ok "tsc --strict: every RPC output = the contract" "$(wc -l < "$OUT/samples.tsv") outputs, every ContainerRpc entry"
  else bad "tsc --strict of the RPC outputs" "$(head -3 "$OUT/tsc.log" | tr '\n' ' ')"; fi
else
  echo "  skip  tsc check (CONTRACT_TS=$CONTRACT_TS or TSC=$TSC missing)"
fi
expect_oral c_main "oral checks after the migration"

echo "3. the revokes"
if run c_main "$REV" && run c_main "$REV"; then ok "revokes applied twice"; else bad "revokes applied twice"; fi
if behaviour c_main; then ok "behaviour (after the revokes)" "CONTAINER CHECKS PASSED"
else bad "behaviour (after the revokes)" "$(grep -m1 'ERROR\|FAILED' "$OUT/behaviour.log")"; fi
C=$(contract c_main)
if echo "$C" | grep -q '"contract_ok" : true'; then ok "supabase/tests/containers.sql" "contract_ok: true"; else bad "supabase/tests/containers.sql" "$(echo "$C" | grep -o '"failed" : \[[^]]*\]')"; fi
if run c_main "$SB/tests/containers_not_found.sql"; then ok "supabase/tests/containers_not_found.sql" "raises nothing"
else bad "supabase/tests/containers_not_found.sql" "$(grep -m1 ERROR "$OUT/last.log")"; fi
fingerprint c_main "$OUT/fp_after.txt"
if run c_main "$MIG" && follow c_main; then
  fingerprint c_main "$OUT/fp_again.txt"
  if cmp -s "$OUT/fp_after.txt" "$OUT/fp_again.txt" && contract c_main | grep -q '"contract_ok" : true'; then
    ok "migration re-applied after the revokes" "catalog unchanged, contract_ok true"
  else bad "migration re-applied after the revokes" "$(diff "$OUT/fp_after.txt" "$OUT/fp_again.txt" | head -3 | tr '\n' ' ')"; fi
else bad "migration re-applied after the revokes"; fi
CHANGED=$(comm -23 "$OUT/fp_base.txt" "$OUT/fp_after.txt" | wc -l)
NEW=$(comm -13 "$OUT/fp_base.txt" "$OUT/fp_after.txt" | wc -l)
if [ "$CHANGED" = 0 ]; then ok "pre-existing objects changed or gone" "0 of $BASE_LINES; $NEW new"
else bad "pre-existing objects changed or gone" "$CHANGED of $BASE_LINES: $(comm -23 "$OUT/fp_base.txt" "$OUT/fp_after.txt" | head -3 | tr '\n' ' ')"; fi
expect_oral c_main "oral checks after the revokes"

echo "4. the rollback"
fresh c_nofollow
if run c_nofollow "$MIG" && run c_nofollow "$REV" && follow_down c_main && follow_down c_main; then
  fingerprint c_nofollow "$OUT/fp_nofollow.txt"
  fingerprint c_main "$OUT/fp_follow_down.txt"
  GONE=$(comm -23 "$OUT/fp_after.txt" "$OUT/fp_nofollow.txt" | cut -d' ' -f1-2 | tr '\n' ' ')
  # The follow-ups change four functions of the two files (container_oral_codes, plan_inputs_for, container_summary,
  # plan_inputs); the rest is new.
  if cmp -s "$OUT/fp_nofollow.txt" "$OUT/fp_follow_down.txt" && [ "$(comm -13 "$OUT/fp_after.txt" "$OUT/fp_nofollow.txt" | wc -l)" = 4 ]; then
    ok "follow-ups rolled back twice → the two-file catalog" "their lines: $GONE"
  else bad "follow-ups rolled back twice" "$(diff "$OUT/fp_nofollow.txt" "$OUT/fp_follow_down.txt" | head -3 | tr '\n' ' ')"; fi
  if follow c_main; then fingerprint c_main "$OUT/fp_follow_up.txt"; fi
  if cmp -s "$OUT/fp_after.txt" "$OUT/fp_follow_up.txt"; then ok "follow-ups applied again" "= the first apply"
  else bad "follow-ups applied again" "$(diff "$OUT/fp_after.txt" "$OUT/fp_follow_up.txt" | head -3 | tr '\n' ' ')"; fi
else bad "follow-ups rolled back twice" "a file failed"; fi
if run c_main "$DOWN" && run c_main "$DOWN"; then ok "rollback applied twice"; else bad "rollback applied twice"; fi
fingerprint c_main "$OUT/fp_down.txt"
D=$(diff "$OUT/fp_base.txt" "$OUT/fp_down.txt" | wc -l)
if [ "$D" = 0 ]; then ok "rollback → catalog equals the base" "0 differing lines"; else bad "rollback → catalog equals the base" "$D differing lines"; fi
expect_oral c_main "oral checks after the rollback"
if run c_main "$MIG" && run c_main "$REV" && follow c_main; then
  fingerprint c_main "$OUT/fp_reup.txt"
  if cmp -s "$OUT/fp_after.txt" "$OUT/fp_reup.txt"; then ok "applied again after the rollback" "= the first apply"
  else bad "applied again after the rollback" "$(diff "$OUT/fp_after.txt" "$OUT/fp_reup.txt" | head -3 | tr '\n' ' ')"; fi
else bad "applied again after the rollback"; fi

echo "5. concurrency"
fresh c_conc
if run c_conc "$MIG" && run c_conc "$REV" && follow c_conc && CONTAINERS_PG_LOG=$PG_LOG "$HERE/containers_concurrency.sh" c_conc > "$OUT/concurrency.log" 2>&1; then
  ok "first answer from two devices; opposite-order batches" "$(grep -o 'waited [0-9.]* s' "$OUT/concurrency.log" | tr '\n' ' ')no lost update, no deadlock"
else bad "concurrency" "$(grep -m1 FAILED "$OUT/concurrency.log")"; fi

echo "6. scale: 4 subjects × 500 items, 30 members (states ≈ 70 % of the items each, two log rows a state)"
fresh c_scale
run c_scale "$MIG" && run c_scale "$REV" && follow c_scale || bad "scale database"
"${PSQL[@]}" -d c_scale > "$OUT/scale_build.log" 2>&1 <<'SQL'
\set ON_ERROR_STOP 1
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) is null;
create temp table r as select public.container_create('Аккредитация (синтетика)', current_date + 19, '[
  {"title":"C# и .NET"},{"title":"Базы данных"},{"title":"Сети"},{"title":"Веб-разработка"}]') as j;
create temp table batch as
select s.n as subject_no, b as batch_no, (r.j -> 'subjects' -> (s.n - 1) ->> 'id')::uuid as subject_id,
       (select jsonb_agg(case when g % 25 = 0 then jsonb_build_object(
          'ref', 's' || s.n || ':' || ((b - 1) * 250 + g), 'file_no', ((b - 1) * 250 + g)::text,
          'topic', 1 + ((b - 1) * 250 + g - 1) / 40, 'kind', 'short',
          'stem', 'Вопрос ' || ((b - 1) * 250 + g) || ': впишите ключевое слово. ' || repeat('Какой результат даст выражение в C#? ', 4),
          'answers', jsonb_build_array('слово ' || g, 'ответ ' || g), 'key_source', 'answer_line')
        else jsonb_build_object(
          'ref', 's' || s.n || ':' || ((b - 1) * 250 + g), 'file_no', ((b - 1) * 250 + g)::text,
          'topic', 1 + ((b - 1) * 250 + g - 1) / 40,
          'stem', 'Вопрос ' || ((b - 1) * 250 + g) || ': ' || repeat('Какой результат даст выражение в C#? ', 6),
          'options', (select jsonb_agg(repeat('вариант ответа ' || o || ' ', 5)) from generate_series(1, 5) o),
          'correct', case when g % 10 = 0 then jsonb_build_array(g % 5, (g + 1) % 5) else jsonb_build_array(g % 5) end,
          'code', g % 3 = 0, 'key_source', 'bold') end order by g)
          from generate_series(1, 250) g) as items
  from r, generate_series(1, 4) s(n), generate_series(1, 2) b;
select extract(epoch from clock_timestamp())::numeric(16,3) as build_start \gset
select string_agg((public.container_items_add(subject_id, items) ->> 'in_container'), ',' order by subject_no, batch_no) as in_container from batch;
select 'add 2000 items in 8 calls', round((extract(epoch from clock_timestamp()) - :'build_start'::numeric) * 1000) || ' ms';
do $$ begin
  perform public.container_items_add((select subject_id from batch limit 1), '[{"ref":"extra:1","stem":"x","options":["a","b"],"correct":[0]}]');
  raise exception 'FAILED: 2001st accepted';
exception when sqlstate 'MC007' then raise notice '2001st refused: MC007'; end $$;
select '2001st refused: MC007';
select (public.container_link_create((select (j ->> 'container_id')::uuid from r), 60) ->> 'code') as code \gset
reset role;
insert into auth.users (id) select ('f0000000-0000-4000-8000-' || lpad(g::text, 12, '0'))::uuid from generate_series(1, 30) g;
set role authenticated;
select 'joined', count(*) from (
  select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-' || lpad(g::text, 12, '0'), false),
         public.container_join(:'code') ->> 'joined' as j
    from generate_series(1, 30) g) x where j = 'true';
reset role;
-- States and log of the 30 members (direct, as postgres: the fixture, not the path). Positions mod 4: 0 wrong now,
-- 1 started yesterday, 2 counted since yesterday, 3 right without a series. Two log rows per state.
insert into public.test_item_states (user_id, item_id, container_id, subject_id, item_rev, seen, right_count, wrong_count,
  first_seen_at, first_seen_day, last_answer_at, last_answer_day, last_result, streak_at, streak_day, two_days_at, two_days_day,
  named_at, checks, peek_day, was_two_days, clean_ok_at)
select u.id, i.id, i.container_id, i.subject_id, 1, 2, 1, 1, now() - interval '5 days', current_date - 5,
       now() - interval '1 day', current_date - 1,
       case when i.position % 4 = 0 then 'wrong' else 'right' end,
       case when i.position % 4 in (1, 2) then now() - interval '2 days' end,
       case when i.position % 4 in (1, 2) then current_date - 2 end,
       case when i.position % 4 = 2 then now() - interval '1 day' end,
       case when i.position % 4 = 2 then current_date - 1 end,
       case when i.position % 4 in (1, 2) then now() - interval '1 day' end, 0,
       case when i.position % 4 = 0 then current_date - 1 end, false,
       case when i.position % 4 in (1, 2, 3) then now() - interval '1 day' end
  from public.test_items i
  cross join (select id from auth.users where id::text like 'f0000000%') u
 where i.import_ref like 's%' and (hashtext(u.id::text || i.id::text) % 10 + 10) % 10 < 7;
insert into public.test_answers (user_id, client_event_id, created_at, local_date, container_id, subject_id, item_id, item_rev,
  kind, chosen, correct, step, two_days_before, cls, ms)
select s.user_id, 'seed-' || s.item_id || '-' || k, now() - make_interval(days => 5 - k), current_date - 5 + k,
       s.container_id, s.subject_id, s.item_id, 1, 'single', array[(k % 5)::smallint], k = 1,
       case when k = 1 then 'start' else 'miss' end, false, case when k = 0 then 'new_floor' else 'relearn' end, 9000 + 1000 * k
  from public.test_item_states s, generate_series(0, 1) k;
-- One member is a team account: the numbers leave it out.
insert into analytics.excluded_accounts (user_id, reason) values ('f0000000-0000-4000-8000-000000000030', 'team');
analyze;
select 'rows', (select count(*) from public.test_items) as items, (select count(*) from public.test_item_states) as states,
       (select count(*) from public.test_answers) as log_rows;
SQL
grep -q 'FAILED\|ERROR' "$OUT/scale_build.log" && bad "scale build" "$(grep -m1 'FAILED\|ERROR' "$OUT/scale_build.log")"
IN=$(grep -m1 '^[0-9][0-9,]*$' "$OUT/scale_build.log")
ROWS=$(grep '^rows|' "$OUT/scale_build.log" | cut -d'|' -f2-)
if [ "$IN" = "250,500,750,1000,1250,1500,1750,2000" ] && grep -q '^joined|30$' "$OUT/scale_build.log" && grep -q '2001st refused: MC007' "$OUT/scale_build.log"; then
  ok "2000 items in 8 calls of 250; the 2001st refused; 30 joined" "$(grep -m1 'add 2000 items' "$OUT/scale_build.log" | cut -d'|' -f2); items|states|log = $ROWS"
else bad "scale build" "$IN / $(grep 'joined\|2001st' "$OUT/scale_build.log" | tr '\n' ' ')"; fi
"${PSQL[@]}" -d c_scale > "$OUT/scale_reads.log" 2>&1 <<'SQL'
\set ON_ERROR_STOP 1
set role authenticated;
select set_config('request.jwt.claim.sub', 'f0000000-0000-4000-8000-000000000007', false) is null;
create temp table t (read text, rows integer, items integer, bytes bigint, ms numeric);
grant all on t to authenticated;
-- rows = rows of the request (an RPC answers one row, a table read its page); items = what is inside.
do $$
declare t0 timestamptz; j jsonb; n integer; b bigint; c uuid := (select id from public.containers limit 1);
        s uuid := (select id from public.container_subjects order by position limit 1);
begin
  t0 := clock_timestamp(); j := public.containers_overview(to_char(current_date, 'YYYY-MM-DD'));
  insert into t values ('containers_overview', 1, jsonb_array_length(j -> 'containers'), length(j::text), extract(epoch from clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp(); j := public.container_summary(c, null);
  insert into t values ('container_summary', 1, jsonb_array_length(j -> 'subjects'), length(j::text), extract(epoch from clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp(); j := public.plan_inputs(null);
  insert into t values ('plan_inputs (all containers; items)', 1, jsonb_array_length(j -> 'items'), length(j::text), extract(epoch from clock_timestamp() - t0) * 1000);
  if jsonb_array_length(j -> 'items') <> 2000 or jsonb_array_length(j -> 'states') < 1000 or jsonb_array_length(j -> 'pace') = 0 then
    raise exception 'FAILED: plan inputs at scale: % items, % states, % pace', jsonb_array_length(j -> 'items'),
      jsonb_array_length(j -> 'states'), jsonb_array_length(j -> 'pace');
  end if;
  t0 := clock_timestamp();
  select count(*), sum(length(row_to_json(x)::text)) into n, b from (
    select id, container_id, subject_id, position, file_no, topic, kind, stem, options, correct, answers, key_source, code,
           keep_order, flags, rev, updated_at
      from public.test_items where subject_id = s and position > 0 order by position limit 500) x;
  insert into t values ('test_items page (keyset, limit 500)', n, n, b, extract(epoch from clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp();
  select count(*) into n from (select * from public.test_item_states where container_id = c order by item_id limit 1000) x;
  insert into t values ('own states page (limit 1000)', n, n, null, extract(epoch from clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp();
  j := public.record_test_answers((select jsonb_agg(jsonb_build_object('client_event_id', 'perf-' || i.id, 'item_id', i.id,
         'chosen', i.position % 5, 'local_date', to_char(current_date, 'YYYY-MM-DD'), 'ms', 9000, 'cls', 'check'))
         from (select id, position from public.test_items where kind = 'single' order by subject_id, position limit 50) i));
  if (select count(*) from jsonb_array_elements(j -> 'results') e where e ->> 'status' = 'saved') <> 50 then
    raise exception 'FAILED: 50 answers %', j; end if;
  insert into t values ('record_test_answers (50 in one call)', 1, 50, length(j::text), extract(epoch from clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp(); select count(*) into n from public.test_answer_days(current_date - 60);
  insert into t values ('test_answer_days (60 days)', n, n, null, extract(epoch from clock_timestamp() - t0) * 1000);
end $$;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) is null;
do $$
declare t0 timestamptz; j jsonb; c uuid := (select id from public.containers limit 1);
begin
  t0 := clock_timestamp(); j := public.container_doubts(c);
  insert into t values ('owner: container_doubts (flagged items)', 1, jsonb_array_length(j), length(j::text), extract(epoch from clock_timestamp() - t0) * 1000);
  t0 := clock_timestamp(); j := public.container_summary(c, null);
  if (j -> 'owner' ->> 'members')::int <> 30 then raise exception 'FAILED: owner sees % members', j -> 'owner' ->> 'members'; end if;
  insert into t values ('owner: container_summary', 1, jsonb_array_length(j -> 'subjects'), length(j::text), extract(epoch from clock_timestamp() - t0) * 1000);
end $$;
select read || '|' || rows || '|' || items || '|' || coalesce(pg_size_pretty(bytes), '') || '|' || round(ms, 1) || ' ms' from t;
SQL
if grep -q 'FAILED\|ERROR' "$OUT/scale_reads.log"; then bad "scale reads" "$(grep -m1 'FAILED\|ERROR' "$OUT/scale_reads.log")"
else
  MAXROWS=$(grep '|' "$OUT/scale_reads.log" | cut -d'|' -f2 | sort -n | tail -1)
  if [ "${MAXROWS:-9999}" -le 1000 ]; then ok "reads as member #7 under RLS, the owner's" "every request ≤ 1000 rows (max $MAXROWS)"; else bad "1000-row cap" "$MAXROWS"; fi
  grep '|' "$OUT/scale_reads.log" | sed 's/^/          /'
fi
T1=$(date +%s.%N)
if "${PSQL[@]}" -d c_scale -f "$NUMBERS" > "$OUT/numbers.log" 2>&1 && [ "$(wc -l < "$OUT/numbers.log")" = 7 ]; then
  T2=$(date +%s.%N)
  FUNNEL=$(grep '^funnel|' "$OUT/numbers.log" | cut -d'|' -f2)
  if echo "$FUNNEL" | grep -q '"excluded_accounts": 1' && echo "$FUNNEL" | grep -q '"in_containers": 30'; then
    ok "docs/container-numbers.sql on the scale data" "$(awk "BEGIN { printf \"%.2f\", $T2 - $T1 }") s; 7 figures; the team account left out"
  else bad "docs/container-numbers.sql funnel" "$FUNNEL"; fi
else bad "docs/container-numbers.sql" "$(head -3 "$OUT/numbers.log" | tr '\n' ' ')"; fi

echo
echo "elapsed $(( $(date +%s) - T0 )) s; outputs in $OUT"
if [ $FAILS = 0 ]; then echo "ALL CONTAINER CHECKS GREEN"; exit 0; else echo "$FAILS CHECK(S) FAILED"; exit 1; fi
