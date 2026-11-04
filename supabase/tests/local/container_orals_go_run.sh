#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261107090000_container_orals_go.sql on a
# scratch PostgreSQL 16 cluster: the containers base (as plan_tempo_run.sh builds it) → leftovers like those of 2026-11-04
# and look-alikes that must stay → the migration twice (the second changes nothing) → the clean-up's result → the contract
# check → container_orals_go_behaviour.sql → the containers contract and behaviour → the rollback twice (the trigger gone,
# a delete keeps oral exams again) → the migration again → the behaviour again. Exit code 0 only when every step is green.
# Env (optional): ORALS_PG_PORT (54397), ORALS_WORK (${TMPDIR:-/tmp}/meldy-orals), PG_BIN (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
PORT=${ORALS_PG_PORT:-54397}
WORK=${ORALS_WORK:-${TMPDIR:-/tmp}/meldy-orals}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
MIG=$SB/migrations/20261107090000_container_orals_go.sql
DOWN=$SB/rollback/20261107090000_container_orals_go_down.sql
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
FAILS=0
ok() { printf '  ok    %s\n' "$1"; }
bad() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
as_pg() { if [ "$(id -u)" = 0 ]; then unshare --user --map-user=1000 --map-group=1000 bash -c "$1"; else bash -c "$1"; fi; }
STARTED=0
if ! "$PG_BIN/pg_isready" -q -h 127.0.0.1 -p "$PORT"; then
  mkdir -p "$WORK/pg"
  if [ ! -f "$WORK/pg/data/PG_VERSION" ]; then
    as_pg "'$PG_BIN/initdb' -D '$WORK/pg/data' -U postgres -A trust -E UTF8 --locale=C.UTF-8 > '$WORK/pg/initdb.log' 2>&1" \
      || { echo "initdb failed: $WORK/pg/initdb.log"; exit 2; }
  fi
  as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -l '$WORK/pg/server.log' -o \"-p $PORT -c unix_socket_directories='' -c listen_addresses=127.0.0.1\" -w start" >/dev/null \
    || { echo "the cluster did not start: $WORK/pg/server.log"; exit 2; }
  STARTED=1
fi
stop_cluster() { if [ $STARTED = 1 ]; then as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -m fast -w stop" >/dev/null; fi; }
trap stop_cluster EXIT
run() { "${PSQL[@]}" -d imgs -f "$1" > "$WORK/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$WORK/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
step() { if run "$2"; then ok "$1"; else bad "$1"; fi; }

"${PSQL[@]}" -d postgres -c "drop database if exists imgs" -c "create database imgs encoding 'UTF8' template template0" >/dev/null
BASE_OK=1
for f in tests/local/baseline.sql migrations/20261003083154_hackathon_journal_exams_oral.sql migrations/20261005143420_cheat_sheet.sql \
         tests/local/exam_shares_baseline.sql migrations/20261007110403_exam_shares.sql migrations/20261007110457_exam_shares_revokes.sql; do
  run "$SB/$f" || BASE_OK=0
done
"${PSQL[@]}" -d imgs -c "alter table auth.users add column if not exists created_at timestamptz not null default now()" >/dev/null || BASE_OK=0
run "$SB/migrations/20261005042323_app_telemetry.sql" || BASE_OK=0
run "$SB/tests/local/ai_quota_baseline.sql" || BASE_OK=0
"${PSQL[@]}" -d imgs >/dev/null <<'SQL' || BASE_OK=0
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
         migrations/20261010074500_containers_fk_indexes.sql migrations/20261010110000_containers_oral_codes_closed.sql \
         migrations/20261010130000_containers_frozen_pace.sql migrations/20261011100000_containers_not_found_null.sql \
         tests/local/storage_baseline.sql; do
  run "$SB/$f" || BASE_OK=0
done
[ $BASE_OK = 1 ] && ok "base (containers + storage stand-in)" || bad "base"

# Leftovers of 2026-11-04 (three to go) and look-alikes that stay: another minute, two questions, attached to a container.
"${PSQL[@]}" -d imgs >/dev/null <<'SQL' || bad "leftovers"
insert into auth.users (id) values ('99999999-0000-4000-8000-000000000099') on conflict do nothing;
with e as (
  insert into public.exams (user_id, title, source_kind, created_at)
  select '99999999-0000-4000-8000-000000000099', t, 'file', at from (values
    ('Предмет 1', '2026-11-04 05:50:34+00'::timestamptz), ('Предмет 2', '2026-11-04 05:50:35+00'), ('Предмет 10', '2026-11-04 05:50:36+00'),
    ('Предмет 3', '2026-11-04 06:10:00+00'), ('Предмет 4', '2026-11-04 05:50:40+00'), ('Предмет 5', '2026-11-04 05:50:41+00')) v(t, at)
  returning id, title)
insert into public.exam_questions (exam_id, user_id, position, text)
select id, '99999999-0000-4000-8000-000000000099', 1, 'Задание на выполнение контрольной работы (комплексной контрольной работы)' from e;
insert into public.exam_questions (exam_id, user_id, position, text)
select id, user_id, 2, 'Второй вопрос' from public.exams where title = 'Предмет 4';
insert into public.containers (id, owner_id, title) values ('dddddddd-0000-4000-8000-000000000004', '99999999-0000-4000-8000-000000000099', 'Живой');
insert into public.container_subjects (container_id, owner_id, position, title, exam_id)
select 'dddddddd-0000-4000-8000-000000000004', user_id, 1, title, id from public.exams where title = 'Предмет 5';
SQL
trig() { "${PSQL[@]}" -d imgs -c "select count(*) from pg_trigger where tgname = 'containers_take_orals'"; }
step "migration, first apply" "$MIG"
step "migration, second apply (re-runnable)" "$MIG"
[ "$(trig)" = 1 ] && ok "one trigger" || bad "trigger count"
left=$("${PSQL[@]}" -d imgs -c "select string_agg(title, ',' order by title) from public.exams where user_id = '99999999-0000-4000-8000-000000000099'")
[ "$left" = "Предмет 3,Предмет 4,Предмет 5" ] && ok "the clean-up took the three leftovers, kept the look-alikes" || bad "clean-up left: $left"
step "contract: container_orals_go.sql" "$SB/tests/container_orals_go.sql"
out=$("${PSQL[@]}" -d imgs -f "$HERE/container_orals_go_behaviour.sql" 2>&1)
if echo "$out" | grep -q 'CONTAINER ORALS CHECKS PASSED'; then ok "behaviour"; else bad "behaviour"; echo "$out" | grep -v NOTICE | tail -5; fi
out=$("${PSQL[@]}" -d imgs -f "$SB/tests/containers.sql" 2>&1)
if [ $? = 0 ] && ! echo "$out" | grep -q '"contract_ok" *: *false'; then ok "contract: containers.sql"; else bad "contract: containers.sql"; echo "$out" | tail -5; fi
out=$("${PSQL[@]}" -d imgs -f "$SB/tests/local/containers_behaviour.sql" 2>&1)
if echo "$out" | grep -q 'CONTAINER CHECKS PASSED'; then ok "containers behaviour after the migration"; else bad "containers behaviour"; echo "$out" | grep -v NOTICE | tail -8; fi
step "rollback" "$DOWN"
step "rollback again" "$DOWN"
[ "$(trig)" = 0 ] && ok "the rollback drops the trigger" || bad "the trigger is still there"
"${PSQL[@]}" -d imgs >/dev/null <<'SQL' && ok "after the rollback a delete keeps the oral exam" || bad "rollback behaviour"
do $t$
declare e uuid; c uuid;
begin
  insert into public.exams (user_id, title) values ('aaaaaaaa-0000-0000-0000-000000000001', 'После отката') returning id into e;
  insert into public.containers (owner_id, title) values ('aaaaaaaa-0000-0000-0000-000000000001', 'Откат') returning id into c;
  insert into public.container_subjects (container_id, owner_id, position, title, exam_id) values (c, 'aaaaaaaa-0000-0000-0000-000000000001', 1, 'x', e);
  delete from public.containers where id = c;
  if not exists (select 1 from public.exams where id = e) then raise exception 'FAILED'; end if;
  delete from public.exams where id = e;
end;
$t$;
SQL
step "migration after the rollback" "$MIG"
[ "$(trig)" = 1 ] && ok "the trigger is back" || bad "trigger after re-apply"
out=$("${PSQL[@]}" -d imgs -f "$HERE/container_orals_go_behaviour.sql" 2>&1)
if echo "$out" | grep -q 'CONTAINER ORALS CHECKS PASSED'; then ok "behaviour again"; else bad "behaviour again"; echo "$out" | grep -v NOTICE | tail -5; fi
echo "failures: $FAILS"
[ $FAILS = 0 ]
