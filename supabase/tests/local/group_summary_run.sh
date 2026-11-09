#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261109090000_group_summary.sql (the
# author of an exam reads the group's numbers without names: public.container_group_summary) on a scratch
# PostgreSQL 16 cluster:
#   1. the base: the live order of every migration up to 20261107090800_avatars_owner.sql (question_kinds_base.sh up to
#      20261031090000, then every later file in order) → which existing contracts (supabase/tests/*.sql) and behaviours
#      (tests/local/*_behaviour.sql) hold there → the contract and group_summary_behaviour.sql fail there (they test
#      something) → the catalog's fingerprint;
#   2. the migration twice, each in one transaction as supabase/migrate.py sends it: the second changes nothing; no line
#      of the base's catalog changes or goes; exactly one line is new, the function, SECURITY DEFINER, STABLE, with an
#      empty search_path, run by authenticated and by no other API role → the contract (supabase/tests/group_summary.sql)
#      → group_summary_behaviour.sql (who may read; 4 members no numbers, 5 the numbers counted by hand; a topic of 4
#      members never shown; left and removed members; the pause of 7 days after the author removes a member, ended by
#      restoring them; no id and no name in the answer);
#   3. the time: an exam of 960 questions with 20 members and 10 000 answers of theirs beside 40 000 answers of another
#      group, seeded in a transaction that is rolled back; the function is run five times (the median is printed and
#      must stay under GROUP_SUMMARY_MAX_MS, 250) and its plan must read the answers through the exam's index and the
#      states through theirs, never a whole table;
#   4. every existing contract and behaviour that held on the base still holds;
#   5. the rollback twice (the catalog equals the base) → the contract and the behaviour fail;
#   6. the migration again (the same catalog as its first apply) → the contract and the behaviour again.
# Exit code 0 and the last line GROUP SUMMARY REHEARSAL: ALL GREEN only when every step is green. The cluster it starts
# is stopped at the end and its data dir removed (GROUP_SUMMARY_KEEP=1 keeps it).
# Env (optional): GROUP_SUMMARY_PG_PORT (54493), GROUP_SUMMARY_WORK (${TMPDIR:-/tmp}/meldy-group-summary), PG_BIN
# (/usr/lib/postgresql/16/bin), GROUP_SUMMARY_MAX_MS (250).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
ROOT=$(cd "$SB/.." && pwd)
PORT=${GROUP_SUMMARY_PG_PORT:-54493}
WORK=${GROUP_SUMMARY_WORK:-${TMPDIR:-/tmp}/meldy-group-summary}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
MAX_MS=${GROUP_SUMMARY_MAX_MS:-250}
MIG=$SB/migrations/20261109090000_group_summary.sql
DOWN=$SB/rollback/20261109090000_group_summary_down.sql
CONTRACT=$SB/tests/group_summary.sql
BEHAVIOUR=$HERE/group_summary_behaviour.sql
FINGERPRINT=$HERE/containers_fingerprint.sql
DB=group_summary
LAST_BASE=20261107090800_avatars_owner.sql
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
    [ "${GROUP_SUMMARY_KEEP:-0}" = 1 ] || rm -rf "$WORK/pg"
  fi
}
trap stop_cluster EXIT
T0=$(date +%s)

run() { "${PSQL[@]}" -d $DB -f "$1" > "$OUT/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$OUT/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
# One transaction, as supabase/migrate.py sends a file (set local holds).
run1() { "${PSQL[@]}" -1 -d $DB -f "$1" > "$OUT/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$OUT/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
step() { if run "$2"; then ok "$1"; else bad "$1"; fi; }
step1() { if run1 "$2"; then ok "$1" "one transaction"; else bad "$1"; fi; }
q() { "${PSQL[@]}" -d $DB -c "$1"; }
fingerprint() { "${PSQL[@]}" -d $DB -f "$FINGERPRINT" > "$1"; }
# A behaviour file passes when its own last line is printed. The shared cases are read by psql through \set lines.
VARS=$(printf '\\set names `cat %q`\n\\set looks `cat %q`\n\\set numbers `cat %q`\n\\set pages `cat %q`\n' \
  "$ROOT/contracts/live/name_cases.json" "$ROOT/contracts/live/default_looks.json" "$ROOT/contracts/kinds/number_vectors.json" \
  "$ROOT/contracts/studio/test_doc_pages_cases.json")
[ -f "$ROOT/contracts/kinds/grade_vectors.json" ] && VARS="$VARS
$(printf '\\set grades `cat %q`' "$ROOT/contracts/kinds/grade_vectors.json")"
# The marker is the last 'X PASSED' the file selects, or the line a file \echo-es (containers_behaviour.sql and others).
marker() { { grep -o "'[A-Z][A-Z0-9 _-]* PASSED'" "$1" | tr -d "'"; grep -o '^\\echo [A-Z][A-Z0-9 _-]* PASSED$' "$1" | sed 's/^\\echo //'; } | tail -1; }
passes() { local out m; m=$(marker "$1"); out=$({ echo "$VARS"; cat "$1"; } | "${PSQL[@]}" -d $DB 2>&1)
           if [ -n "$m" ] && echo "$out" | grep -q "$m"; then return 0; fi
           echo "$out" | grep -v NOTICE | grep -i -m3 'error\|failed' | sed 's/^/    /'; return 1; }
holds() { local out; out=$("${PSQL[@]}" -d $DB -f "$1" 2>&1) && ! echo "$out" | grep -Eq '"contract_ok" ?: ?false'; }
behaviour() { "${PSQL[@]}" -d $DB -f "$BEHAVIOUR" > "$OUT/behaviour.log" 2>&1 && grep -q 'GROUP SUMMARY CHECKS PASSED' "$OUT/behaviour.log"; }
why() { grep -m1 'ERROR\|FAILED' "$OUT/behaviour.log" | sed 's/^psql:[^:]*:[0-9]*: //' | cut -c1-110; }

# The seeded exam of step 3: 4 subjects × 240 questions in 12 topics each, 20 members who answered 500 times each over
# six weeks (the later a member's number, the earlier they stopped; 35 % wrong), a third of the answered questions
# learned; and another group's exam of 240 questions with 39 members and 40 014 answers, so the exam read is a fifth of
# the answers, and with the states of 300 more accounts that once studied it, so the exam read is a tenth of the
# states (on the live base it is a far smaller share of both). The author is 5eed…0000. Everything is invented and
# rolled back with the transaction.
SEED=$(cat <<'SQL'
insert into auth.users (id) select ('5eed0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(0, 60) n on conflict do nothing;
insert into auth.users (id) select ('5eed0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid from generate_series(100, 399) n on conflict do nothing;
insert into public.containers (id, owner_id, title, exam_date) values
  ('5eed0000-0000-4000-8000-0000000c0001', '5eed0000-0000-4000-8000-000000000000', 'Большая группа', current_date + 20),
  ('5eed0000-0000-4000-8000-0000000c0002', '5eed0000-0000-4000-8000-000000000060', 'Другая группа', current_date + 20);
insert into public.container_subjects (id, container_id, owner_id, position, title, topics)
select ('5eed0000-0000-4000-8000-0000000d' || lpad(n::text, 4, '0'))::uuid,
       case when n <= 4 then '5eed0000-0000-4000-8000-0000000c0001' else '5eed0000-0000-4000-8000-0000000c0002' end::uuid,
       case when n <= 4 then '5eed0000-0000-4000-8000-000000000000' else '5eed0000-0000-4000-8000-000000000060' end::uuid,
       case when n <= 4 then n else 1 end, 'Предмет ' || n,
       (select jsonb_agg('Раздел ' || n || '.' || t) from generate_series(1, 12) t)
  from generate_series(1, 5) n;
insert into public.test_items (id, container_id, subject_id, position, topic, stem, options, correct, key_source)
select ('5eed0000-0000-4000-8000-00000001' || lpad(((s - 1) * 240 + q)::text, 4, '0'))::uuid,
       case when s <= 4 then '5eed0000-0000-4000-8000-0000000c0001' else '5eed0000-0000-4000-8000-0000000c0002' end::uuid,
       ('5eed0000-0000-4000-8000-0000000d' || lpad(s::text, 4, '0'))::uuid, case when s <= 4 then (s - 1) * 240 + q else q end,
       (q - 1) / 20 + 1, 'Вопрос ' || s || '.' || q, '["а", "б", "в", "г"]', '{0}', 'manual'
  from generate_series(1, 5) s, generate_series(1, 240) q;
insert into public.container_members (container_id, user_id, joined_at)
select '5eed0000-0000-4000-8000-0000000c0001', ('5eed0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, now() - interval '42 days'
  from generate_series(1, 20) n;
insert into public.container_members (container_id, user_id, joined_at)
select '5eed0000-0000-4000-8000-0000000c0002', ('5eed0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid, now() - interval '42 days'
  from generate_series(21, 59) n;
insert into public.test_answers (user_id, client_event_id, created_at, local_date, container_id, subject_id, item_id, item_rev, kind, correct, step)
select u.id, 'seed-' || u.n || '-' || k, t.at, (t.at at time zone 'utc')::date, i.container_id, i.subject_id, i.id, i.rev, i.kind,
       (k * 7 + u.n) % 20 >= 7, case when (k * 7 + u.n) % 20 >= 7 then 'start' else 'miss' end
  from (select n, ('5eed0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid as id from generate_series(1, 20) n) u
 cross join generate_series(1, 500) k
 cross join lateral (select now() - make_interval(hours => (least(u.n, 15) - 1) * 36 + (k % 400) * 2) as at) t
  join public.test_items i on i.id = ('5eed0000-0000-4000-8000-00000001' || lpad((((k * 13 + u.n * 31) % 960) + 1)::text, 4, '0'))::uuid;
insert into public.test_answers (user_id, client_event_id, created_at, local_date, container_id, subject_id, item_id, item_rev, kind, correct, step)
select u.id, 'seed-' || u.n || '-' || k, t.at, (t.at at time zone 'utc')::date, i.container_id, i.subject_id, i.id, i.rev, i.kind,
       k % 3 > 0, case when k % 3 > 0 then 'start' else 'miss' end
  from (select n, ('5eed0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid as id from generate_series(21, 59) n) u
 cross join generate_series(1, 1026) k
 cross join lateral (select now() - make_interval(hours => k % 900) as at) t
  join public.test_items i on i.id = ('5eed0000-0000-4000-8000-00000001' || lpad((960 + (k % 240) + 1)::text, 4, '0'))::uuid;
insert into public.test_item_states (user_id, item_id, container_id, subject_id, item_rev, seen, right_count, first_seen_at, first_seen_day,
                                     last_answer_at, last_answer_day, last_result, streak_at, streak_day, two_days_at, two_days_day, named_at)
select a.user_id, a.item_id, a.container_id, a.subject_id, 1, count(*), count(*), min(a.created_at), min(a.local_date), max(a.created_at),
       max(a.local_date), 'right', min(a.created_at), min(a.local_date),
       case when hashtext(a.item_id::text || a.user_id::text) % 3 = 0 then max(a.created_at) end,
       case when hashtext(a.item_id::text || a.user_id::text) % 3 = 0 then max(a.local_date) end, max(a.created_at)
  from public.test_answers a
 where a.container_id in ('5eed0000-0000-4000-8000-0000000c0001', '5eed0000-0000-4000-8000-0000000c0002')
 group by a.user_id, a.item_id, a.container_id, a.subject_id;
insert into public.test_item_states (user_id, item_id, container_id, subject_id, item_rev, seen, right_count, first_seen_at, first_seen_day,
                                     last_answer_at, last_answer_day, last_result)
select u.id, i.id, i.container_id, i.subject_id, 1, 1, 1, now() - interval '50 days', current_date - 50, now() - interval '50 days',
       current_date - 50, 'right'
  from (select ('5eed0000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid as id from generate_series(100, 399) n) u
 cross join public.test_items i
 where i.container_id = '5eed0000-0000-4000-8000-0000000c0002';
analyze public.test_answers; analyze public.test_item_states; analyze public.test_items; analyze public.container_members;
analyze public.test_key_doubts; analyze public.container_subjects; analyze public.containers;
SQL
)
CALL="select public.container_group_summary('5eed0000-0000-4000-8000-0000000c0001')"
# The seed, the call five times under EXPLAIN ANALYZE, once more with the plans of its own statements (auto_explain),
# all as the author; then everything is rolled back.
measure() {
  "${PSQL[@]}" -d $DB > "$OUT/measure.log" 2>&1 <<SQL
begin;
$SEED
select 'seeded ' || (select count(*) from public.test_items where container_id = '5eed0000-0000-4000-8000-0000000c0001') || ' questions, '
       || (select count(*) from public.container_members where container_id = '5eed0000-0000-4000-8000-0000000c0001') || ' members, '
       || count(*) filter (where container_id = '5eed0000-0000-4000-8000-0000000c0001') || ' answers of ' || count(*) || ', '
       || (select count(*) filter (where container_id = '5eed0000-0000-4000-8000-0000000c0001') || ' states of ' || count(*) from public.test_item_states)
  from public.test_answers;
load 'auto_explain';
select set_config('request.jwt.claim.sub', '5eed0000-0000-4000-8000-000000000000', true);
set local role authenticated;
select 'answer ' || ($CALL)::text;
explain (analyze, costs off) $CALL;
explain (analyze, costs off) $CALL;
explain (analyze, costs off) $CALL;
explain (analyze, costs off) $CALL;
explain (analyze, costs off) $CALL;
reset role;
set local auto_explain.log_min_duration = 0;
set local auto_explain.log_analyze = on;
set local auto_explain.log_timing = off;
set local auto_explain.log_nested_statements = on;
set local client_min_messages = log;
set local role authenticated;
$CALL;
rollback;
SQL
}

echo "1. the base"
if "$HERE/question_kinds_base.sh" $DB "$OUT" > "$OUT/base_q.log" 2>&1; then
  ok "question_kinds_base.sh: the live order up to 20261031090000" "$(tail -1 "$OUT/base_q.log" | cut -c1-60)"
else
  bad "question_kinds_base.sh (see $OUT/base_q.log)"; tail -8 "$OUT/base_q.log"; echo "GROUP SUMMARY REHEARSAL: FAILED"; exit 1
fi
LATER=0
BASE_OK=1
for f in $(cd "$SB/migrations" && ls 2026*.sql); do
  [[ "$f" > "20261031090000_live_wide_rounds.sql" ]] || continue
  [[ "$f" > "$LAST_BASE" ]] && continue
  if run "$SB/migrations/$f"; then LATER=$((LATER + 1)); else BASE_OK=0; echo "    base: $f"; fi
done
[ $BASE_OK = 1 ] && ok "the later migrations in the live order, up to $LAST_BASE" "$LATER files" \
  || { bad "the later migrations"; echo "GROUP SUMMARY REHEARSAL: FAILED"; exit 1; }
OLD_CONTRACTS=()
for f in "$SB"/tests/*.sql; do
  case "$(basename "$f")" in group_summary*) continue ;; esac
  holds "$f" && OLD_CONTRACTS+=("$f")
done
OLD_BEHAVIOURS=()
for f in "$HERE"/*_behaviour.sql; do
  case "$(basename "$f")" in group_summary*) continue ;; esac
  passes "$f" > /dev/null 2>&1 && OLD_BEHAVIOURS+=("$f")
done
ok "on the base: existing contracts and behaviours that hold (each must still hold)" "${#OLD_CONTRACTS[@]} and ${#OLD_BEHAVIOURS[@]}"
for name in containers container_kind group_link_life quiz_stats item_points; do
  printf '%s\n' "${OLD_CONTRACTS[@]}" | grep -q "/$name.sql$" && ok "among them the contract: $name.sql" \
    || bad "the contract $name.sql does not hold on the base"
done
for name in containers container_kind group_link_life quiz_stats; do
  printf '%s\n' "${OLD_BEHAVIOURS[@]}" | grep -q "/${name}_behaviour.sql$" && ok "among them the behaviour: ${name}_behaviour.sql" \
    || bad "the behaviour ${name}_behaviour.sql does not hold on the base"
done
if behaviour; then bad "the behaviour passes on the base (it tests nothing)"; else ok "the behaviour fails on the base" "$(why)"; fi
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
NEW=$(comm -13 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt"))
[ -z "$GONE" ] && ok "no line of the base's catalog changed or went" "$(wc -l < "$OUT/fp_base.txt") lines" \
  || bad "the migration changed the base" "$(echo "$GONE" | head -3 | tr '\n' ' ')"
if [ "$(echo "$NEW" | grep -c .)" = 1 ] \
   && echo "$NEW" | grep -q '^fn public\.container_group_summary(p_container_id uuid) [0-9a-f]\{32\} ret=jsonb def=true vol=s strict=false cfg=search_path="" acl='; then
  ok "exactly one new line: the function, definer, stable, empty search_path"
else bad "the new lines" "$(echo "$NEW" | head -3 | cut -c1-160 | tr '\n' ' ')"; fi
ACL=$(q "select coalesce(proacl::text, 'default') from pg_proc where oid = 'public.container_group_summary(uuid)'::regprocedure")
if echo "$ACL" | grep -q 'authenticated=X/' && ! echo "$ACL" | grep -Eq '(^\{|,)=X/|anon=|service_role='; then ok "it runs for authenticated and no other API role" "$ACL"
else bad "the function's grants" "$ACL"; fi
step "contract: supabase/tests/group_summary.sql" "$CONTRACT"
if behaviour; then ok "behaviour: who may read, 4 and 5 members, the numbers by hand, the pause, no names" "GROUP SUMMARY CHECKS PASSED"
else bad "behaviour" "$(why)"; fi

echo "3. the time"
if measure; then
  ok "seeded and rolled back" "$(grep -m1 '^seeded ' "$OUT/measure.log")"
  grep -q '^answer {"members": 20, ' "$OUT/measure.log" && ok "the author reads the numbers of the seeded group" \
    "$(grep -m1 '^answer ' "$OUT/measure.log" | grep -o '"studied_7d": [0-9]*\|"studied_prev_7d": [0-9]*\|"studied_ever": [0-9]*\|"learned_pct": [0-9]*' | tr '\n' ' ')" \
    || bad "the answer on the seeded group" "$(grep -m1 '^answer ' "$OUT/measure.log" | cut -c1-120)"
  TIMES=$(grep -o 'Execution Time: [0-9.]*' "$OUT/measure.log" | awk '{ print $3 }' | sort -n)
  MEDIAN=$(echo "$TIMES" | sed -n '3p')
  if [ "$(echo "$TIMES" | grep -c .)" = 5 ] && awk -v m="$MEDIAN" -v max="$MAX_MS" 'BEGIN { exit !(m + 0 < max + 0) }'; then
    ok "container_group_summary on the seeded exam: median of 5 runs" "$MEDIAN ms (all: $(echo $TIMES); limit $MAX_MS ms)"
  else bad "the time of container_group_summary" "median «$MEDIAN» ms of: $(echo $TIMES)"; fi
  if grep -q 'test_answers_container_day_idx' "$OUT/measure.log" && ! grep -q 'Seq Scan on test_answers' "$OUT/measure.log"; then
    ok "its plan reads the answers through test_answers_container_day_idx, never the whole table"
  else bad "the plan of the answers" "$(grep -m2 'on test_answers' "$OUT/measure.log" | tr '\n' ' ' | cut -c1-140)"; fi
  if grep -q 'Seq Scan on test_item_states' "$OUT/measure.log"; then bad "the plan reads every state of every exam"; else ok "its plan reads the states by an index"; fi
else
  bad "the seed or the call failed" "$(grep -m1 'ERROR' "$OUT/measure.log" | cut -c1-140)"
fi
[ "$(q "select count(*) from public.containers where id::text like '5eed0000-%'")" = 0 ] && ok "nothing of the seed is left" || bad "the seed stayed in the database"

echo "4. the existing checks after the migration"
n=0; for f in "${OLD_CONTRACTS[@]}"; do if holds "$f"; then n=$((n + 1)); else bad "existing contract no longer holds: $(basename "$f")"; fi; done
[ $n = ${#OLD_CONTRACTS[@]} ] && ok "every existing contract still holds" "$n"
n=0; for f in "${OLD_BEHAVIOURS[@]}"; do if passes "$f" > /dev/null; then n=$((n + 1)); else bad "existing behaviour no longer holds: $(basename "$f")"; passes "$f"; fi; done
[ $n = ${#OLD_BEHAVIOURS[@]} ] && ok "every existing behaviour still holds" "$n"

echo "5. the rollback"
step1 "rollback" "$DOWN"
step1 "rollback again (re-runnable)" "$DOWN"
fingerprint "$OUT/fp_down.txt"
if cmp -s "$OUT/fp_base.txt" "$OUT/fp_down.txt"; then ok "the catalog equals the base" "$(wc -l < "$OUT/fp_base.txt") lines"
else bad "the rollback left another catalog" "$(diff "$OUT/fp_base.txt" "$OUT/fp_down.txt" | head -4 | tr '\n' ' ')"; fi
if behaviour; then bad "the behaviour passes after the rollback (it should not)"; else ok "after the rollback the behaviour fails, as it should"; fi
if "${PSQL[@]}" -d $DB -f "$CONTRACT" >/dev/null 2>&1; then bad "the contract passes after the rollback (it should not)"; else ok "after the rollback the contract fails, as it should"; fi

echo "6. the migration again"
step1 "migration after the rollback" "$MIG"
fingerprint "$OUT/fp_re.txt"
if cmp -s "$OUT/fp_after.txt" "$OUT/fp_re.txt"; then ok "the same catalog as the first apply"
else bad "another catalog than the first apply" "$(diff "$OUT/fp_after.txt" "$OUT/fp_re.txt" | head -3 | tr '\n' ' ')"; fi
step "contract again" "$CONTRACT"
if behaviour; then ok "behaviour again" "GROUP SUMMARY CHECKS PASSED"; else bad "behaviour again" "$(why)"; fi

echo
echo "elapsed $(( $(date +%s) - T0 )) s; outputs in $OUT"
if [ $FAILS = 0 ]; then echo "GROUP SUMMARY REHEARSAL: ALL GREEN ($OKS ok, 0 FAIL)"; exit 0; fi
echo "GROUP SUMMARY REHEARSAL: $FAILS FAILED ($OKS ok)"; exit 1
