#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Two devices of one member against the answer core of
# supabase/migrations/*_containers.sql:
#   1. the FIRST answer to a new item arrives from both devices at once — no lost update (the second waits on the state
#      row and applies on top of the first: seen 2, right 1, wrong 1, two log rows);
#   2. two batches touch the same two items in opposite order — no deadlock (items are locked in id order).
# Usage: containers_concurrency.sh <database with the migration applied>. Connection from PGHOST / PGPORT / PGUSER
# (containers_run_all.sh sets them). Optional CONTAINERS_PG_LOG = the server log, to count «deadlock detected».
# Prints one line per check and CONCURRENCY CHECKS PASSED, or FAILED: … with exit code 1.
set -u
DB=${1:?usage: containers_concurrency.sh <database>}
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
fail() { echo "FAILED: $*"; exit 1; }

# Committed fixture: A's container with three items, B a member.
"${PSQL[@]}" > "$TMP/setup.out" 2>&1 <<'SQL' || { cat "$TMP/setup.out"; fail "fixture"; }
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) is null;
create temp table r as select public.container_create('Гонка', null, '[{"title":"Предмет"}]') as j;
select public.container_items_add(((select j from r) -> 'subjects' -> 0 ->> 'id')::uuid, '[
  {"ref":"race:1","stem":"Первый","options":["а","б","в"],"correct":[0]},
  {"ref":"race:2","stem":"Второй","options":["а","б","в"],"correct":[1]},
  {"ref":"race:3","stem":"Третий","options":["а","б","в"],"correct":[2]}]') is null;
select (public.container_link_create(((select j from r) ->> 'container_id')::uuid) ->> 'code') as code \gset
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false) is null;
select public.container_join(:'code') ->> 'joined';
SQL
item() {
  "${PSQL[@]}" -c "select i.id from public.test_items i join public.containers c on c.id = i.container_id
                    where c.title = 'Гонка' and i.import_ref = '$1' order by c.created_at desc limit 1"
}
I1=$(item race:1); I2=$(item race:2); I3=$(item race:3)
[ -n "$I1" ] && [ -n "$I2" ] && [ -n "$I3" ] || fail "fixture items"

# One device's call as B; $3 = seconds the transaction stays open after the call (0 = none).
session() {
  {
    echo "set role authenticated;"
    echo "select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false) is null;"
    [ "$3" != 0 ] && echo "begin;"
    echo "select jsonb_path_query_array(public.record_test_answers('$2'::jsonb), '\$.results[*].status');"
    [ "$3" != 0 ] && echo "select pg_sleep($3); commit;"
  } > "$1"
}
session "$TMP/s1.sql" "[{\"client_event_id\":\"race-device-a\",\"item_id\":\"$I1\",\"chosen\":0}]" 3
session "$TMP/s2.sql" "[{\"client_event_id\":\"race-device-b\",\"item_id\":\"$I1\",\"chosen\":2}]" 0
session "$TMP/s3.sql" "[{\"client_event_id\":\"deadlock-x-1\",\"item_id\":\"$I2\",\"chosen\":1},{\"client_event_id\":\"deadlock-x-2\",\"item_id\":\"$I3\",\"chosen\":2}]" 2
session "$TMP/s4.sql" "[{\"client_event_id\":\"deadlock-y-1\",\"item_id\":\"$I3\",\"chosen\":0},{\"client_event_id\":\"deadlock-y-2\",\"item_id\":\"$I2\",\"chosen\":0}]" 0
deadlocks() { if [ -n "${CONTAINERS_PG_LOG:-}" ] && [ -r "$CONTAINERS_PG_LOG" ]; then grep -c 'deadlock detected' "$CONTAINERS_PG_LOG"; else echo 0; fi; }
before=$(deadlocks)
now_s() { date +%s.%N; }

# 1. The first answer from two devices at once.
"${PSQL[@]}" -f "$TMP/s1.sql" > "$TMP/c1.out" 2>&1 & P1=$!
sleep 0.7
T0=$(now_s); "${PSQL[@]}" -f "$TMP/s2.sql" > "$TMP/c2.out" 2>&1; R2=$?; T1=$(now_s)
wait $P1; R1=$?
[ $R1 = 0 ] && [ $R2 = 0 ] || { cat "$TMP/c1.out" "$TMP/c2.out"; fail "race: a session failed"; }
STATE=$("${PSQL[@]}" -c "select seen || ' ' || right_count || ' ' || wrong_count || ' ' || (select count(*) from public.test_answers where item_id = '$I1')
                          from public.test_item_states where item_id = '$I1' and user_id = 'bbbbbbbb-0000-0000-0000-000000000002'")
WAIT=$(awk "BEGIN { printf \"%.1f\", $T1 - $T0 }")
echo "first answer from two devices: device B waited ${WAIT} s; statuses $(grep '\[' "$TMP/c1.out" "$TMP/c2.out" | sed 's/.*://' | tr '\n' ' '); state seen right wrong / log rows = $STATE"
[ "$STATE" = "2 1 1 2" ] || fail "lost update: $STATE"
awk "BEGIN { exit !($T1 - $T0 > 1.0) }" || fail "device B did not wait on the state row (${WAIT} s)"

# 2. Opposite-order batches.
"${PSQL[@]}" -f "$TMP/s3.sql" > "$TMP/c3.out" 2>&1 & P3=$!
sleep 0.5
T0=$(now_s); "${PSQL[@]}" -f "$TMP/s4.sql" > "$TMP/c4.out" 2>&1; R4=$?; T1=$(now_s)
wait $P3; R3=$?
[ $R3 = 0 ] && [ $R4 = 0 ] || { cat "$TMP/c3.out" "$TMP/c4.out"; fail "opposite order: a session failed (deadlock?)"; }
STATES=$("${PSQL[@]}" -c "select string_agg(i.import_ref || ' seen=' || s.seen || ' right=' || s.right_count || ' wrong=' || s.wrong_count, '; ' order by i.import_ref)
                           from public.test_item_states s join public.test_items i on i.id = s.item_id
                          where i.id in ('$I2', '$I3') and s.user_id = 'bbbbbbbb-0000-0000-0000-000000000002'")
WAIT=$(awk "BEGIN { printf \"%.1f\", $T1 - $T0 }")
echo "opposite-order batches: batch Y waited ${WAIT} s; statuses $(grep '\[' "$TMP/c3.out" "$TMP/c4.out" | sed 's/.*://' | tr '\n' ' '); $STATES"
[ "$(grep -c '"saved", "saved"' "$TMP/c3.out" "$TMP/c4.out" | awk -F: '{ s += $2 } END { print s }')" = 2 ] || fail "both batches saved"
[ "$STATES" = "race:2 seen=2 right=1 wrong=1; race:3 seen=2 right=1 wrong=1" ] || fail "opposite-order states: $STATES"
after=$(deadlocks)
echo "new deadlocks in the server log: $((after - before))"
[ "$after" = "$before" ] || fail "deadlock detected"
echo "CONCURRENCY CHECKS PASSED"
