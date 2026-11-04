#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Lock order of 20261107090200_group_link_life.sql against a first-time
# container_join (review L1, 04.11). A join locks its link row FOR UPDATE, then inserts the member: the foreign key takes
# the exam's row FOR KEY SHARE. A writer that held the exam's row FOR UPDATE and then wrote the link deadlocked with it.
# For each writer, T2 takes the link row first as the join does and holds it; T1 then runs the real writer, which waits
# for the link; T2 then finishes its join. Green when both commit (no «deadlock detected»).
# Writers: «Продлить» (container_link_extend), «Перенести экзамен» for everyone (exam_date_move 'all', whole exam and one
# subject: its core locks the exam's row, the triggers then extend the links), the exam's date in «Настройки», a
# subject's date in «Настройки».
# Usage: group_link_life_locks.sh <database> <work dir>   (PGHOST / PGPORT / PGUSER from the environment)
set -u -o pipefail
DB=$1
WORK=$2
mkdir -p "$WORK"
PSQL=(psql -X -q -At -d "$DB")
A=91170000-0000-4000-8000-0000000000aa
FAILS=0

"${PSQL[@]}" -v ON_ERROR_STOP=1 >/dev/null <<SQL || { echo "  FAIL  locks: setup"; exit 1; }
insert into auth.users (id) values ('$A') on conflict do nothing;
create table if not exists public.gll_locks (variant text primary key, c uuid, s uuid, l uuid, code text, joiner uuid);
SQL

setup() {  # <variant> <joiner>
  "${PSQL[@]}" -v ON_ERROR_STOP=1 >/dev/null <<SQL
insert into auth.users (id) values ('$2') on conflict do nothing;
begin;
select set_config('request.jwt.claim.sub', '$A', true);
set local role authenticated;
do \$d\$
declare r jsonb; v_c uuid; v_s uuid; k jsonb;
begin
  r := public.container_create('Замки $1', current_date + 10, jsonb_build_array(jsonb_build_object('title', 'Тест')));
  v_c := (r ->> 'container_id')::uuid;
  v_s := (r -> 'subjects' -> 0 ->> 'id')::uuid;
  perform public.container_items_add(v_s, '[{"ref":"g:1","stem":"2+2?","options":["3","4"],"correct":[1]}]');
  -- An end the moves and «Продлить» will move on.
  k := public.container_link_create(v_c, 60, null);
  execute 'reset role';
  update public.container_links set expires_at = now() + interval '3 days' where id = (k ->> 'link_id')::uuid;
  insert into public.gll_locks values ('$1', v_c, v_s, (k ->> 'link_id')::uuid, k ->> 'code', '$2')
    on conflict (variant) do update set c = excluded.c, s = excluded.s, l = excluded.l, code = excluded.code, joiner = excluded.joiner;
end
\$d\$;
commit;
SQL
}

variant() {  # <variant> <joiner> <T1's statement, with :'c' :'s' :'l'>
  setup "$1" "$2" || { echo "  FAIL  locks: setup of $1"; FAILS=$((FAILS + 1)); return; }
  ( "${PSQL[@]}" <<SQL > "$WORK/$1.t2" 2>&1
select l, code from public.gll_locks where variant = '$1' \gset
begin;
-- As container_join begins: the link row, held while T1 starts its writer (taken here as the table's owner; the lock
-- belongs to the transaction, which then joins as the member).
select 1 from public.container_links where id = :'l' for update;
select pg_sleep(1.2);
select set_config('request.jwt.claim.sub', '$2', true);
set local role authenticated;
select 'T2 joined ' || (public.container_join(:'code') ->> 'joined');
commit;
SQL
  ) &
  local t2=$!
  sleep 0.4
  "${PSQL[@]}" <<SQL > "$WORK/$1.t1" 2>&1
select c, s, l from public.gll_locks where variant = '$1' \gset
begin;
select set_config('request.jwt.claim.sub', '$A', true);
set local role authenticated;
$3;
commit;
SQL
  wait $t2
  if grep -q 'deadlock detected' "$WORK/$1.t1" "$WORK/$1.t2"; then
    printf '  FAIL  %-70s %s\n' "locks: a first join beside $1" "deadlock detected"; FAILS=$((FAILS + 1))
  elif grep -q 'ERROR' "$WORK/$1.t1" "$WORK/$1.t2"; then
    printf '  FAIL  %-70s %s\n' "locks: a first join beside $1" "$(grep -h -m1 ERROR "$WORK/$1.t1" "$WORK/$1.t2" | head -1)"; FAILS=$((FAILS + 1))
  elif grep -q 'T2 joined true' "$WORK/$1.t2"; then
    printf '  ok    %-70s %s\n' "locks: a first join beside $1" "both committed"
  else
    printf '  FAIL  %-70s %s\n' "locks: a first join beside $1" "the join did not finish"; FAILS=$((FAILS + 1))
  fi
}

variant extend      91170000-0000-4000-8000-0000000000b1 "select 'T1 ' || (public.container_link_extend(:'l') ->> 'reopened')"
variant move_all    91170000-0000-4000-8000-0000000000b2 "select 'T1 ' || (public.exam_date_move(:'c', current_date + 200, 'all') ->> 'for')"
variant move_subj   91170000-0000-4000-8000-0000000000b3 "select 'T1 ' || (public.exam_date_move(:'c', current_date + 200, 'all', :'s') ->> 'for')"
variant settings    91170000-0000-4000-8000-0000000000b4 "update public.containers set exam_date = current_date + 200 where id = :'c'"
variant settings_s  91170000-0000-4000-8000-0000000000b5 "update public.container_subjects set exam_date = current_date + 200 where id = :'s'"

"${PSQL[@]}" -c "drop table if exists public.gll_locks" >/dev/null
[ $FAILS = 0 ]
