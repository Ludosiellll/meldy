#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. The rehearsal of the Telegram bot's voice stage (package T10:
# supabase/migrations/20261010120006_telegram_bot_voice.sql and supabase/rollback/20261010120006_telegram_bot_voice_down.sql)
# on a scratch PostgreSQL 16 cluster:
#   the base of T1's rehearsal (the repo's local baselines, the live migrations they rehearse, the exam container, stubs of
#   the schemas cron and net) → T1's three files → T11's oral reads (its migration when the repo has it, else the LOCAL
#   STUB below) → catalog fingerprint → the voice file twice → telegram_bot_voice.sql (behaviour) → the contract with the
#   T10 block (telegram_bot_voice_contract.sql pasted into a scratch copy of telegram_bot.sql) → the file once more
#   (catalog unchanged) → two takes of one ticket at once (one wins) → the rollback twice (catalog = before) → apply again.
# Usage: supabase/tests/local/telegram_bot_voice_run.sh
# Env (all optional): VOICE_PG_PORT (54392); VOICE_WORK (scratch dir, default ${TMPDIR:-/tmp}/meldy-voice);
#   PG_BIN (/usr/lib/postgresql/16/bin). Exit code 0 only when every check is green.
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
PORT=${VOICE_PG_PORT:-54392}
WORK=${VOICE_WORK:-${TMPDIR:-/tmp}/meldy-voice}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
T1=$SB/migrations/20261010120000_telegram_bot.sql
T1_CRON=$SB/migrations/20261010120001_telegram_bot_cron.sql
T1_REV=$SB/migrations/20261010120002_telegram_bot_revokes.sql
T11=$SB/migrations/20261010120007_oral_plan_inputs.sql
MIG=$SB/migrations/20261010120006_telegram_bot_voice.sql
DOWN=$SB/rollback/20261010120006_telegram_bot_voice_down.sql
CONTRACT=$SB/tests/telegram_bot.sql
BLOCK=$HERE/telegram_bot_voice_contract.sql
FINGERPRINT=$HERE/containers_fingerprint.sql
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
OUT=$WORK/out
mkdir -p "$OUT"
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
FAILS=0
ok() { printf '  ok    %-62s %s\n' "$1" "${2:-}"; }
bad() { printf '  FAIL  %-62s %s\n' "$1" "${2:-}"; FAILS=$((FAILS + 1)); }

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
echo "telegram bot voice (T10) rehearsal: PostgreSQL $("${PSQL[@]}" -d postgres -c 'show server_version') on 127.0.0.1:$PORT, work dir $WORK"

run() { "${PSQL[@]}" -d "$1" -f "$2" > "$OUT/last.log" 2>&1 || { echo "    $2 failed on $1:"; grep -v NOTICE "$OUT/last.log" | head -5 | sed 's/^/    /'; return 1; }; }
fingerprint() { "${PSQL[@]}" -d "$1" -f "$FINGERPRINT" > "$2"; }
field() { python3 -c "import json,sys; d=json.loads(sys.stdin.read()); print(json.dumps(d$1))"; }

# The cron file without its two CREATE EXTENSION lines when pg_cron / pg_net are not installed here (T1's way).
STUBS=0
if [ "$("${PSQL[@]}" -d postgres -c "select count(*) from pg_available_extensions where name in ('pg_cron', 'pg_net')")" != 2 ]; then
  STUBS=1
  sed -E 's/^(create extension if not exists pg_(cron|net) .*)$/-- (local: stubbed) \1/' "$T1_CRON" > "$OUT/cron_local.sql"
  T1_CRON=$OUT/cron_local.sql
fi

# ── the base (as supabase/tests/local/telegram_bot_run.sh builds it) + T1 ─────────────────────────────────────────────
load_base() {
  "${PSQL[@]}" -d postgres -c "drop database if exists v_base" -c "create database v_base encoding 'UTF8' template template0" >/dev/null 2>&1 || return 1
  for f in tests/local/baseline.sql migrations/20261003083154_hackathon_journal_exams_oral.sql migrations/20261005143420_cheat_sheet.sql \
           tests/local/exam_shares_baseline.sql migrations/20261007110403_exam_shares.sql migrations/20261007110457_exam_shares_revokes.sql; do
    run v_base "$SB/$f" || return 1
  done
  "${PSQL[@]}" -d v_base -c "alter table auth.users add column if not exists created_at timestamptz not null default now()" >/dev/null || return 1
  run v_base "$SB/migrations/20261005042323_app_telemetry.sql" || return 1
  run v_base "$SB/tests/local/ai_quota_baseline.sql" || return 1
  "${PSQL[@]}" -d v_base >/dev/null <<'SQL' || return 1
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
    run v_base "$SB/$f" || return 1
  done
  if [ $STUBS = 1 ]; then
    "${PSQL[@]}" -d v_base >/dev/null <<'SQL' || return 1
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
  run v_base "$T1" && run v_base "$T1_CRON" && run v_base "$T1_REV" || return 1
  if [ -f "$T11" ]; then
    run v_base "$T11" || return 1
    T11_MODE="T11's migration"
  else
    # LOCAL STUB of package T11's meldy_private.oral_sheet_for (20261010120007_oral_plan_inputs.sql, not in this branch):
    # the shape of GET /api/oral/sheet for the fields voice.sql reads. It takes a question's NEWEST usable rubric of
    # the user instead of the one under the rubric key (T11 ports the key byte-exactly). P0002 for another's exam.
    "${PSQL[@]}" -d v_base >/dev/null <<'SQL' || return 1
create or replace function meldy_private.oral_sheet_for(p_user uuid, p_exam_id uuid)
returns jsonb language plpgsql stable set search_path = '' as $$
begin
  if not exists (select 1 from public.exams e where e.id = p_exam_id and e.user_id = p_user) then
    raise exception 'exam not found' using errcode = 'P0002';
  end if;
  return jsonb_build_object('exam_id', p_exam_id, 'mapping_state', 'done', 'to_write', 0, 'units', 0, 'unwritable', 0, 'job', null,
    'questions', coalesce((select jsonb_agg(jsonb_build_object(
        'question_id', q.id, 'position', q.position, 'label', q.label, 'section', q.section, 'text', q.text,
        'question_hash', q.question_hash, 'coverage', q.coverage, 'coverage_method', q.coverage_method,
        'coverage_reason', q.coverage_reason, 'missing_note', q.missing_note, 'rebuilt', false, 'unwritable', false,
        'rubric', (select jsonb_build_object('rubric_id', r.id, 'built_at', r.created_at, 'coverage', r.rubric ->> 'coverage',
                            'coverage_note', coalesce(r.rubric ->> 'coverage_note', ''),
                            'materials', coalesce(r.rubric -> 'materials', '[]'::jsonb),
                            'points', coalesce((select jsonb_agg(jsonb_build_object('id', p ->> 'id', 'title', p ->> 'title', 'short', '',
                                                  'essential', coalesce((p ->> 'essential')::boolean, false),
                                                  'source_quote', coalesce(p ->> 'source_quote', ''), 'source_ids', coalesce(p -> 'source_ids', '[]'::jsonb)) order by o)
                                                 from jsonb_array_elements(r.rubric -> 'points') with ordinality x(p, o)), '[]'::jsonb))
                     from public.oral_rubrics r
                    where r.user_id = p_user and r.question_hash = q.question_hash and r.rubric_version = 1
                      and jsonb_typeof(r.rubric -> 'points') = 'array' and jsonb_array_length(r.rubric -> 'points') > 0
                    order by r.created_at desc limit 1))
        order by q.position, q.created_at, q.id)
        from public.exam_questions q where q.exam_id = p_exam_id), '[]'::jsonb));
end $$;
revoke all on function meldy_private.oral_sheet_for(uuid, uuid) from public, anon, authenticated;
SQL
    T11_MODE="LOCAL STUB of T11's oral_sheet_for"
  fi
}

T0=$(date +%s)
echo "1. base (T1's) + T1 + T11"
if load_base; then ok "base loaded (v_base)" "$T11_MODE; $([ $STUBS = 1 ] && echo 'cron and net stubbed' || echo 'pg_cron and pg_net installed')"
else bad "base loaded"; echo "cannot continue"; exit 1; fi
fingerprint v_base "$OUT/fp_base.txt"

echo "2. the voice file"
"${PSQL[@]}" -d postgres -c "drop database if exists v_main" -c "create database v_main template v_base" >/dev/null 2>&1
if run v_main "$MIG" && run v_main "$MIG"; then ok "applied twice"; else bad "applied twice"; echo "cannot continue"; exit 1; fi
FLAG=$("${PSQL[@]}" -d v_main -c "select flags -> 'voice' from bot.config")
if [ "$FLAG" = false ]; then ok "the switch is off after the migration" "flags.voice = false"; else bad "the switch is off after the migration" "$FLAG"; fi
"${PSQL[@]}" -d v_main -f "$HERE/telegram_bot_voice.sql" > "$OUT/behaviour.log" 2>&1
if grep -q 'TELEGRAM BOT VOICE CHECKS PASSED' "$OUT/behaviour.log"; then ok "behaviour (telegram_bot_voice.sql)" "$(grep -c '^ok ' "$OUT/behaviour.log") checks"
else bad "behaviour (telegram_bot_voice.sql)" "$(grep -m3 'ERROR\|FAIL' "$OUT/behaviour.log" | tr '\n' ' ')"; fi

echo "3. the contract with the T10 block"
python3 - "$CONTRACT" "$BLOCK" "$OUT/telegram_bot_with_t10.sql" <<'PY' || bad "contract block pasted"
import re, sys
contract, block, out = sys.argv[1:4]
text = open(contract, encoding="utf-8").read()
parts = dict(re.findall(r"(?ms)^-- >>> (\w+)\n(.*?)^-- <<< \1\n", open(block, encoding="utf-8").read()))
anchors = {
    "tables": "  -- T9: , ('T9', 'files')\n",
    "functions": "  -- T9: , ('T9', 'bot_file_offer(…)'), ('T9', 'bot_file_redeem(…)')\n",
    "helpers": "  -- T5 / T7 / T9: their helpers of schema bot\n",
    "checks": "  -- ── T9: 70–89 ──\n",
}
for name, anchor in anchors.items():
    assert text.count(anchor) == 1, name
    text = text.replace(anchor, anchor + parts[name])
open(out, "w", encoding="utf-8").write(text)
PY
C=$("${PSQL[@]}" -d v_main -f "$OUT/telegram_bot_with_t10.sql" 2>&1)
if echo "$C" | grep -q '"contract_ok" : true'; then ok "telegram_bot.sql + T10 block" "contract_ok: true, $(echo "$C" | field "['checks']" | grep -o 'true' | wc -l) checks"
else bad "telegram_bot.sql + T10 block" "$(echo "$C" | field "['failed']" 2>/dev/null || echo "$C" | head -3)"; fi
C=$("${PSQL[@]}" -d v_base -f "$OUT/telegram_bot_with_t10.sql" 2>&1)
if echo "$C" | grep -q '"contract_ok" : false'; then ok "the same on the base (no voice file): reads, never raises" "$(echo "$C" | field "['failed']" | tr -d '\n' | cut -c1-80)"
else bad "the same on the base" "$(echo "$C" | head -3)"; fi
fingerprint v_main "$OUT/fp_after.txt"
if run v_main "$MIG"; then
  fingerprint v_main "$OUT/fp_again.txt"
  if cmp -s "$OUT/fp_after.txt" "$OUT/fp_again.txt"; then ok "re-applied after the behaviour test" "catalog unchanged"
  else bad "re-applied after the behaviour test" "$(diff "$OUT/fp_after.txt" "$OUT/fp_again.txt" | head -3 | tr '\n' ' ')"; fi
else bad "re-applied after the behaviour test"; fi
CHANGED=$(comm -23 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt") | wc -l)
if [ "$CHANGED" = 0 ]; then ok "objects of the base changed or gone" "0 of $(wc -l < "$OUT/fp_base.txt"); $(comm -13 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt") | wc -l) new"
else bad "objects of the base changed or gone" "$(comm -23 <(sort "$OUT/fp_base.txt") <(sort "$OUT/fp_after.txt") | head -3 | tr '\n' ' ')"; fi

echo "4. two takes of one ticket at once (two sessions, anon)"
# A committed fixture (the behaviour test rolls back): D's oral exam with one question and its rubric, the subject of
# D's container, the switch on, an open question and one transcribe ticket.
TICKET=$("${PSQL[@]}" -d v_main 2>"$OUT/race_fixture.log" <<'SQL' | grep -E '^[0-9a-f]{64}$'
update bot.config set flags = flags || '{"voice": true}'::jsonb;
insert into bot.links (user_id, tg_user_id, chat_id) values ('dddddddd-0000-0000-0000-000000000004', 830004, 830004);
insert into public.materials (id, user_id, title) values ('44444444-4444-4444-4444-444444444444', 'dddddddd-0000-0000-0000-000000000004', 'Лекция');
insert into public.exams (id, user_id, title) values ('e0e00000-0000-4000-8000-000000000004', 'dddddddd-0000-0000-0000-000000000004', 'Устный');
insert into public.exam_questions (id, exam_id, user_id, position, text, coverage)
values ('e0e00000-0000-4000-8000-000000000401', 'e0e00000-0000-4000-8000-000000000004', 'dddddddd-0000-0000-0000-000000000004', 1,
        'Взаимоблокировка: условия возникновения и способы предотвращения.', 'full');
insert into public.oral_rubrics (user_id, question_hash, source_key, material_id, question, rubric)
values ('dddddddd-0000-0000-0000-000000000004', public.meldy_question_hash('Взаимоблокировка: условия возникновения и способы предотвращения.'),
        'race-key-0000', '44444444-4444-4444-4444-444444444444', 'Взаимоблокировка: условия возникновения и способы предотвращения.',
        '{"coverage": "full", "materials": [], "points": [{"id": "p1", "title": "Пункт", "essential": true, "source_quote": "", "source_ids": [],
          "followup": {"question": "Вопрос?", "expected": ""}}]}');
select set_config('request.jwt.claim.sub', 'dddddddd-0000-0000-0000-000000000004', false);
set role authenticated;
create temp table race_c as select public.container_create('Осенняя сессия', null,
  '[{"title": "Операционные системы", "exam_id": "e0e00000-0000-4000-8000-000000000004"}]') as r;
grant select on race_c to service_role;
reset role;
select set_config('request.jwt.claims', '{"role": "service_role"}', false);
set role service_role;
create temp table race_s as select public.bot_voice_start(830004, (r ->> 'container_id')::uuid, (r -> 'subjects' -> 0 ->> 'id')::uuid,
  'e0e00000-0000-4000-8000-000000000004', 'Операционные системы', array['e0e00000-0000-4000-8000-000000000401']::uuid[], 0) as s from race_c;
select public.bot_voice_ticket(830004, s -> 'attempt' ->> 'aid', 'transcribe', 30) ->> 'ticket' from race_s;
SQL
)
if [ -n "$TICKET" ]; then
  { echo "set role anon;"; echo "begin;"; echo "select public.bridge_voice_take('$TICKET') ->> 'status';"; echo "select pg_sleep(1.5); commit;"; } > "$OUT/take_a.sql"
  { echo "set role anon;"; echo "select public.bridge_voice_take('$TICKET') ->> 'status';"; } > "$OUT/take_b.sql"
  "${PSQL[@]}" -d v_main -f "$OUT/take_a.sql" > "$OUT/take_a.out" 2>&1 & PA=$!
  sleep 0.5
  "${PSQL[@]}" -d v_main -f "$OUT/take_b.sql" > "$OUT/take_b.out" 2>&1; RB=$?
  wait $PA; RA=$?
  A=$(grep -E '^[a-z_]+$' "$OUT/take_a.out" | head -1); B=$(grep -E '^[a-z_]+$' "$OUT/take_b.out" | head -1)
  if [ $RA = 0 ] && [ $RB = 0 ] && [ "$A" = ok ] && [ "$B" = used ]; then ok "one ticket taken twice at once" "A $A, B $B"
  else bad "one ticket taken twice at once" "A=$A B=$B $(cat "$OUT/take_a.out" "$OUT/take_b.out" | grep -m1 ERROR)"; fi
else bad "one ticket taken twice at once" "no race ticket: $(head -2 "$OUT/race_fixture.log" | tr '\n' ' ')"; fi

echo "5. the rollback"
if run v_main "$DOWN" && run v_main "$DOWN"; then ok "rollback applied twice"; else bad "rollback applied twice"; fi
fingerprint v_main "$OUT/fp_down.txt"
D=$(diff "$OUT/fp_base.txt" "$OUT/fp_down.txt" | wc -l)
if [ "$D" = 0 ]; then ok "rollback → catalog equals the base" "0 differing lines"
else bad "rollback → catalog equals the base" "$(diff "$OUT/fp_base.txt" "$OUT/fp_down.txt" | head -4 | tr '\n' ' ')"; fi
if "${PSQL[@]}" -d v_main -f "$CONTRACT" 2>&1 | grep -q '"contract_ok" : true'; then ok "T1's contract after the rollback" "contract_ok: true"
else bad "T1's contract after the rollback"; fi
if run v_main "$MIG"; then
  fingerprint v_main "$OUT/fp_reup.txt"
  if cmp -s "$OUT/fp_after.txt" "$OUT/fp_reup.txt"; then ok "applied again after the rollback" "= the first apply"
  else bad "applied again after the rollback" "$(diff "$OUT/fp_after.txt" "$OUT/fp_reup.txt" | head -3 | tr '\n' ' ')"; fi
else bad "applied again after the rollback"; fi

echo
echo "elapsed $(( $(date +%s) - T0 )) s; outputs in $OUT"
if [ $FAILS = 0 ]; then echo "ALL TELEGRAM BOT VOICE CHECKS GREEN"; exit 0; else echo "$FAILS CHECK(S) FAILED"; exit 1; fi
