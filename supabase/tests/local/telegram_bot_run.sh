#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. The whole rehearsal of the Telegram bot's database on a scratch PostgreSQL
# 16 cluster: package T1 (supabase/migrations/20261010120000_telegram_bot.sql, _cron.sql, _revokes.sql and
# supabase/rollback/20261010120000_telegram_bot_down.sql), then the later packages in the live order, each on top of
# the ones before: T5 (20261010120003, the session in chat), T7 (20261010120004, the group chat), T9 (20261010120005,
# the files), T10 (20261010120006, voice behind a flag), the slot of T11 (20261010120007), applied only when its
# file is here, and WA (20261010150000, the Mini App's sign-in, step 9b).
#   1. the base (the repo's local baselines, the live migrations they rehearse, the exam container's migrations, stubs
#      of the schemas cron and net when pg_cron / pg_net are not installed here, dblink when available) → catalog
#      fingerprint → the contract on the base never raises;
#   2. T1's main and cron files twice → the contract: T1 fails exactly the three default-privilege gaps, every other
#      failure is a check of a package not applied yet → behaviour and claims under those grants;
#   3. the revokes twice → behaviour and claims again → T1's checks all hold → the main and cron files once more
#      (catalog unchanged) → no line of the base changed → the container's contract still ok;
#   4. concurrency on T1 (two claims at once, two ledger begins at once, one code claimed from two Telegrams at once);
#      then T7, T9 and T10 without T5 on that database: the contract reads such a partial apply too;
#   5–9. per package (T5, T7, T9, T10, slot T11) on the database of steps 2–3: its migration twice, no line of what
#      was there before changed or gone, the contract (T1 and every applied package ok, only the packages not applied
#      yet fail), its own local tests (T5: telegram_bot_sessions.sql, part 2 through dblink; T7:
#      telegram_bot_groups.sql and telegram_bot_groups_race.sql; T9: telegram_bot_files.sql and two redeems of one
#      token at once; T10: the switch off, telegram_bot_voice.sql and two takes of one ticket at once, on T11's
#      meldy_private.oral_sheet_for after T11's step when T11's migration is here, else on a local stub of it that
#      exists only while they run), T1's behaviour and claims with it;
#   10. everything applied: contract_ok with every check, the container's contract, T1's rollback refuses (and leaves
#      everything) while a later package's objects remain;
#   11. the rollbacks in reverse (T11 → T10 → T9 → T7 → T5 → T1), each twice: after each the catalog equals the one
#      before that package, the contract still reads; after T1's the base (pg_cron's grants to postgres stay), the tick
#      unscheduled, the container's contract ok;
#   12. everything applied again: after each package the catalog equals its first apply; contract_ok.
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
ok() { printf '  ok    %-64s %s\n' "$1" "${2:-}"; }
bad() { printf '  FAIL  %-64s %s\n' "$1" "${2:-}"; FAILS=$((FAILS + 1)); }
skip() { printf '  skip  %-64s %s\n' "$1" "${2:-}"; }

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
echo "telegram bot rehearsal: PostgreSQL $("${PSQL[@]}" -d postgres -c 'show server_version') on 127.0.0.1:$PORT, work dir $WORK"

run() { "${PSQL[@]}" -d "$1" -f "$2" > "$OUT/last.log" 2>&1 || { echo "    $2 failed on $1:"; grep -v NOTICE "$OUT/last.log" | head -5 | sed 's/^/    /'; return 1; }; }
fresh() { "${PSQL[@]}" -d postgres -c "drop database if exists $1" -c "create database $1 template t_base" >/dev/null 2>&1; }
fingerprint() { "${PSQL[@]}" -d "$1" -f "$FINGERPRINT" > "$2"; }
# Lines of $1 changed or gone in $2, and lines new in $2 (fingerprints, any order).
gone() { comm -23 <(sort "$1") <(sort "$2"); }
new_lines() { comm -13 <(sort "$1") <(sort "$2"); }
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
# judge <contract output> <T1's expected failures, a JSON list>: green when the output is the report (it never raises),
# T1 fails exactly those, every applied later package is ok, and every other failure is a check of a package not
# applied yet (the report's packages names each package's failures). Prints a summary.
judge() {
  python3 -c '
import json, sys
try:
    d = json.loads(sys.argv[1])
except ValueError:
    print("not the report: " + " ".join(sys.argv[1].split())[:240]); sys.exit(1)
exp = json.loads(sys.argv[2]); pk = d.get("packages") or {}; errs = []; allowed = set(exp); applied = []; waiting = []
if "T1" not in pk: errs.append("no packages.T1")
elif pk["T1"]["failed"] != exp: errs.append("T1 failed %s" % pk["T1"]["failed"])
for name, p in pk.items():
    if name == "T1": continue
    if p["applied"]:
        applied.append(name)
        if not p["ok"]: errs.append("%s failed %s" % (name, p["failed"]))
    else:
        allowed.update(p["failed"]); waiting.append("%s %d" % (name, len(p["failed"])))
extra = [c for c in d.get("failed", []) if c not in allowed]
if extra: errs.append("other failures %s" % extra)
if errs: print("; ".join(errs)); sys.exit(1)
print("%d checks; T1 %s; applied %s; not yet %s" % (len(d["checks"]), "ok" if not exp else "fails only the %d gaps" % len(exp),
      " ".join(applied) or "-", ", ".join(waiting) or "-"))
' "$1" "$2"
}
contract_check() {  # <label> <db> <T1's expected failures>
  local c msg; c=$(contract "$2")
  if msg=$(judge "$c" "$3"); then ok "$1" "$msg"; else bad "$1" "$msg"; fi
}
# The report with everything applied: contract_ok, every check true, every package applied and ok.
contract_full() {  # <label> <db>
  local c msg; c=$(contract "$2")
  if msg=$(python3 -c '
import json, sys
d = json.loads(sys.argv[1]); pk = d["packages"]
bad = [n for n, v in d["checks"].items() if v is not True] + [n for n, p in pk.items() if not (p["applied"] and p["ok"])]
if d["contract_ok"] is not True or d["failed"] or bad: print("failed %s %s" % (d["failed"], bad)); sys.exit(1)
print("contract_ok: true, all %d checks; packages %s" % (len(d["checks"]), " ".join(pk)))
' "$c" 2>&1); then ok "$1" "$msg"; else bad "$1" "$msg"; fi
}

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
# dblink (the later packages' two-session tests) lives in the base when this cluster has it, so no test creates or
# drops it between two fingerprints.
DBLINK=0
[ "$("${PSQL[@]}" -d postgres -c "select count(*) from pg_available_extensions where name = 'dblink'")" = 1 ] && DBLINK=1
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
  # the exam container and its two follow-ups, as applied live
  for f in migrations/20261004205613_ai_quota_server.sql migrations/20261005031722_ai_quota_lockdown.sql \
           migrations/20261007103621_oral_answer_texts.sql tests/local/containers_baseline.sql \
           migrations/20261009093500_containers.sql migrations/20261009093501_containers_revokes.sql \
           migrations/20261010074500_containers_fk_indexes.sql migrations/20261010110000_containers_oral_codes_closed.sql; do
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
  if [ $DBLINK = 1 ]; then "${PSQL[@]}" -d t_base -c "create extension if not exists dblink" >/dev/null || return 1; fi
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
t1_tests() {  # <label> <db>: T1's behaviour and claims
  if behaviour "$2"; then ok "$1: T1's behaviour" "TELEGRAM BOT CHECKS PASSED"
  else bad "$1: T1's behaviour" "$(first_error "$OUT/behaviour.log")"; fi
  if claims "$2"; then ok "$1: T1's claims" "TELEGRAM BOT CLAIMS PASSED"
  else bad "$1: T1's claims" "$(first_error "$OUT/claims.log")"; fi
}
# sql_test <label> <db> <file> [marker…]: a package's local test; green when psql exits 0 and prints every marker.
sql_test() {
  local label=$1 db=$2 file=$3 log rc m missing=""; shift 3
  log=$OUT/$(basename "$file" .sql).log
  "${PSQL[@]}" -d "$db" -f "$file" > "$log" 2>&1; rc=$?
  for m in "$@"; do grep -q "$m" "$log" || missing="$missing «$m»"; done
  if [ $rc = 0 ] && [ -z "$missing" ]; then ok "$label" "${*:-exit 0}"
  else bad "$label" "$(first_error "$log")${missing:+ (not printed:$missing)}"; fi
}

# ── the later packages on t_main: each one's files, fingerprints and the package before it ───────────────────────────
declare -a DONE=()                   # applied on t_main, in order
declare -A MIG_OF=() DOWN_OF=() PREV_OF=()
LAST=T1                              # fingerprints: $OUT/fp_<pkg>.txt after its first apply (fp_T1: with the revokes)
# stage <pkg> <version>: the package's migration twice on t_main, nothing before it changed or gone, the contract.
# Returns 1 when the migration is not in this tree (a slot not filled yet).
stage() {
  local pkg=$1 ver=$2 mig down prev
  mig=$(compgen -G "$SB/migrations/${ver}_*.sql" | head -1)
  down=$(compgen -G "$SB/rollback/${ver}_*_down.sql" | head -1)
  if [ -z "$mig" ]; then skip "$pkg: supabase/migrations/${ver}_*.sql" "not in this tree"; return 1; fi
  prev=$OUT/fp_$LAST.txt
  if run t_main "$mig" && run t_main "$mig"; then ok "$pkg: $(basename "$mig") applied twice"; else bad "$pkg: $(basename "$mig") applied twice"; fi
  fingerprint t_main "$OUT/fp_$pkg.txt"
  if [ "$(gone "$prev" "$OUT/fp_$pkg.txt" | wc -l)" = 0 ]; then
    ok "$pkg: objects before it changed or gone" "0 of $(wc -l < "$prev"); $(new_lines "$prev" "$OUT/fp_$pkg.txt" | wc -l) new"
  else bad "$pkg: objects before it changed or gone" "$(gone "$prev" "$OUT/fp_$pkg.txt" | head -3 | tr '\n' ' ')"; fi
  [ -n "$down" ] || bad "$pkg: its rollback supabase/rollback/${ver}_*_down.sql" "missing"
  MIG_OF[$pkg]=$mig; DOWN_OF[$pkg]=$down; PREV_OF[$pkg]=$LAST; DONE+=("$pkg"); LAST=$pkg
  contract_check "$pkg: supabase/tests/telegram_bot.sql" t_main '[]'
  return 0
}

# ── T10's tests (telegram_bot_voice.sql and its runner's ticket race) ─────────────────────────────────────────────────
# LOCAL STUB of package T11's meldy_private.oral_sheet_for (20261010120007_oral_plan_inputs.sql), the same as
# T10's former runner: the shape of GET /api/oral/sheet for the fields T10 reads; a question's NEWEST usable
# rubric of the user instead of the one under the rubric key (T11 ports the key byte-exactly). P0002 for another's exam.
cat > "$OUT/oral_sheet_stub.sql" <<'SQL'
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
# voice_tests <label>: T10's behaviour on t_main, then its ticket race on a throwaway copy (the race commits fixtures),
# with T11's oral_sheet_for when it is there, else with the stub above for exactly that long.
voice_tests() {
  local own=0 mode="T11's oral_sheet_for"
  if [ "$("${PSQL[@]}" -d t_main -c "select pg_catalog.to_regprocedure('meldy_private.oral_sheet_for(uuid,uuid)') is null")" = t ]; then
    if run t_main "$OUT/oral_sheet_stub.sql"; then own=1; mode="the local stub of T11's oral_sheet_for"
    else bad "$1: the local stub of oral_sheet_for"; fi
  fi
  sql_test "$1: telegram_bot_voice.sql ($mode)" t_main "$HERE/telegram_bot_voice.sql" 'TELEGRAM BOT VOICE CHECKS PASSED'
  voice_race "$1"
  if [ $own = 1 ]; then
    "${PSQL[@]}" -d t_main -c "drop function meldy_private.oral_sheet_for(uuid, uuid)" >/dev/null || bad "$1: the local stub dropped"
  fi
}
# Two takes of one ticket at once (T10's race, two anon sessions): one ok, the other used.
voice_race() {
  local ticket a b ra rb pa
  "${PSQL[@]}" -d postgres -c "drop database if exists t_voice" -c "create database t_voice template t_main" >/dev/null 2>&1 \
    || { bad "$1: two takes of one ticket at once" "no copy of t_main"; return; }
  ticket=$("${PSQL[@]}" -d t_voice 2>"$OUT/voice_race_fixture.log" <<'SQL' | grep -E '^[0-9a-f]{64}$'
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
-- With T11's oral_sheet_for, the sheet takes the rubric under the key the Space writes (meldy_private.oral_rubric_key).
do $$ begin
  if pg_catalog.to_regprocedure('meldy_private.oral_rubric_key(text,text[],jsonb,text)') is not null then
    execute $q$update public.oral_rubrics set source_key = (select meldy_private.oral_rubric_key(x.materials_fingerprint, '{}'::text[],
                 x.evidence, x.coverage_method) from public.exam_questions x where x.id = 'e0e00000-0000-4000-8000-000000000401')
               where source_key = 'race-key-0000'$q$;
  end if;
end $$;
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
  if [ -n "$ticket" ]; then
    { echo "set role anon;"; echo "begin;"; echo "select public.bridge_voice_take('$ticket') ->> 'status';"; echo "select pg_sleep(1.5); commit;"; } > "$OUT/take_a.sql"
    { echo "set role anon;"; echo "select public.bridge_voice_take('$ticket') ->> 'status';"; } > "$OUT/take_b.sql"
    "${PSQL[@]}" -d t_voice -f "$OUT/take_a.sql" > "$OUT/take_a.out" 2>&1 & pa=$!
    sleep 0.5
    "${PSQL[@]}" -d t_voice -f "$OUT/take_b.sql" > "$OUT/take_b.out" 2>&1; rb=$?
    wait $pa; ra=$?
    a=$(grep -E '^[a-z_]+$' "$OUT/take_a.out" | head -1); b=$(grep -E '^[a-z_]+$' "$OUT/take_b.out" | head -1)
    if [ $ra = 0 ] && [ $rb = 0 ] && [ "$a" = ok ] && [ "$b" = used ]; then ok "$1: one ticket taken twice at once (anon)" "A $a, B $b"
    else bad "$1: one ticket taken twice at once (anon)" "A=$a B=$b $(cat "$OUT/take_a.out" "$OUT/take_b.out" | grep -m1 ERROR)"; fi
  else bad "$1: one ticket taken twice at once (anon)" "no ticket: $(grep -m2 -v NOTICE "$OUT/voice_race_fixture.log" | tr '\n' ' ')"; fi
  "${PSQL[@]}" -d postgres -c "drop database if exists t_voice" >/dev/null 2>&1
}

T0=$(date +%s)
echo "1. base"
if load_base; then
  ok "base loaded (t_base)" "$([ $STUBS = 1 ] && echo 'cron and net stubbed' || echo 'pg_cron and pg_net installed'); dblink $([ $DBLINK = 1 ] && echo installed || echo 'not available')"
else bad "base loaded"; echo "cannot continue"; exit 1; fi
fingerprint t_base "$OUT/fp_base.txt"
BASE_LINES=$(wc -l < "$OUT/fp_base.txt")
C=$(contract t_base)
if [ "$(echo "$C" | field "['contract_ok']" 2>/dev/null)" = false ] && [ "$(echo "$C" | field "['packages']['T1']['applied']" 2>/dev/null)" = false ]; then
  ok "telegram_bot.sql on the base: reads, never raises" "contract_ok false, nothing applied"
else bad "telegram_bot.sql on the base" "$C"; fi

echo "2. T1: the migration (main + cron), before the revokes"
fresh t_main
if apply_t1 t_main && apply_t1 t_main; then ok "main and cron files applied twice"; else bad "main and cron files applied twice"; fi
contract_check "contract before the revokes" t_main \
  '["bot_functions_closed_to_clients", "site_functions_authenticated_only", "bot_helpers_closed_to_clients"]'
t1_tests "the migration's grants" t_main

echo "3. T1: the revokes"
if run t_main "$REV" && run t_main "$REV"; then ok "revokes applied twice"; else bad "revokes applied twice"; fi
t1_tests "after the revokes" t_main
contract_check "supabase/tests/telegram_bot.sql (T1's checks)" t_main '[]'
fingerprint t_main "$OUT/fp_T1.txt"
if apply_t1 t_main; then
  fingerprint t_main "$OUT/fp_again.txt"
  if cmp -s "$OUT/fp_T1.txt" "$OUT/fp_again.txt"; then ok "main and cron files re-applied after the revokes" "catalog unchanged"
  else bad "main and cron files re-applied after the revokes" "$(diff "$OUT/fp_T1.txt" "$OUT/fp_again.txt" | head -3 | tr '\n' ' ')"; fi
else bad "main and cron files re-applied after the revokes"; fi
CHANGED=$(gone <(no_cron_acl "$OUT/fp_base.txt") <(no_cron_acl "$OUT/fp_T1.txt") | wc -l)
if [ "$CHANGED" = 0 ]; then ok "objects of the base changed or gone" "0 of $BASE_LINES; $(new_lines <(no_cron_acl "$OUT/fp_base.txt") <(no_cron_acl "$OUT/fp_T1.txt") | wc -l) new"
else bad "objects of the base changed or gone" "$CHANGED of $BASE_LINES: $(gone <(no_cron_acl "$OUT/fp_base.txt") <(no_cron_acl "$OUT/fp_T1.txt") | head -3 | tr '\n' ' ')"; fi
if cron_grants "$OUT/fp_base.txt" "$OUT/fp_T1.txt"; then ok "schema cron: only the docs' grants to postgres" "$(diff <(grep -E '^(nsp cron |rel cron\.)' "$OUT/fp_base.txt") <(grep -E '^(nsp cron |rel cron\.)' "$OUT/fp_T1.txt") | grep -c '^>') ACL lines"
else bad "schema cron: only the docs' grants to postgres"; fi
if "${PSQL[@]}" -d t_main -f "$SB/tests/containers.sql" 2>&1 | grep -q '"contract_ok" : true'; then
  ok "the container's contract (supabase/tests/containers.sql)" "contract_ok: true"
else bad "the container's contract (supabase/tests/containers.sql)"; fi

echo "4. T1: concurrency (two sessions, service role), then a partial apply"
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
# d) a partial apply: T7, T9 and T10 on T1 without T5. The contract reads it: T5's checks fail, the rest hold.
for v in 20261010120004 20261010120005 20261010120006; do
  f=$(compgen -G "$SB/migrations/${v}_*.sql" | head -1)
  [ -z "$f" ] || run t_conc "$f" || bad "partial apply: $(basename "$f")"
done
contract_check "contract with T7, T9 and T10 but not T5 (t_conc)" t_conc '[]'

echo "5. T5: the session in chat"
if stage T5 20261010120003; then
  if [ $DBLINK = 1 ]; then
    sql_test "T5: telegram_bot_sessions.sql (part 2 through dblink)" t_main "$HERE/telegram_bot_sessions.sql" \
      'TELEGRAM BOT SESSIONS CHECKS PASSED' 'TELEGRAM BOT SESSIONS CONCURRENCY PASSED'
  else
    sql_test "T5: telegram_bot_sessions.sql" t_main "$HERE/telegram_bot_sessions.sql" 'TELEGRAM BOT SESSIONS CHECKS PASSED'
    skip "T5: telegram_bot_sessions.sql part 2 (two sessions)" "dblink is not available on this cluster"
  fi
  t1_tests "with T5" t_main
fi

echo "6. T7: the group chat"
if stage T7 20261010120004; then
  sql_test "T7: telegram_bot_groups.sql (spec §8.2 «Беседа»)" t_main "$HERE/telegram_bot_groups.sql" 'TELEGRAM BOT GROUP CHECKS PASSED'
  if [ $DBLINK = 1 ]; then
    sql_test "T7: telegram_bot_groups_race.sql (two sessions)" t_main "$HERE/telegram_bot_groups_race.sql" 'TELEGRAM BOT GROUP RACES PASSED'
  else skip "T7: telegram_bot_groups_race.sql (two sessions)" "dblink is not available on this cluster"; fi
  t1_tests "with T5 and T7" t_main
fi

echo "7. T9: the files"
if stage T9 20261010120005; then
  sql_test "T9: telegram_bot_files.sql (spec §8.2 «Файлы»)" t_main "$HERE/telegram_bot_files.sql" 'TELEGRAM BOT FILES CHECKS PASSED'
  # Two redeems of one token at once (telegram_bot_files.sql's header): A holds its row 1.5 s, B waits, then reads used.
  TOKEN=$("${PSQL[@]}" -d t_main <<'SQL' | tail -1
insert into auth.users (id) values ('f9000000-0000-4000-8000-0000000000aa') on conflict do nothing;
insert into bot.links (user_id, tg_user_id, chat_id) values ('f9000000-0000-4000-8000-0000000000aa', 709010, 709010);
set role service_role;
select set_config('request.jwt.claims', '{"role":"service_role"}', false) is null;
select set_config('t9.ticket', public.bot_file_offer(709010, 'BQACAgIAAxkBAAIBc2Zm_race', 'race.docx', 10, null) ->> 'ticket', false) is null;
reset role;
set role authenticated;
select set_config('request.jwt.claims', '{"role":"authenticated","sub":"f9000000-0000-4000-8000-0000000000aa"}', false) is null;
select set_config('request.jwt.claim.sub', 'f9000000-0000-4000-8000-0000000000aa', false) is null;
select public.telegram_file_take(current_setting('t9.ticket')) ->> 'token';
SQL
)
  { echo "$SVC"; echo "begin;"; echo "select public.bot_file_redeem('$TOKEN') ->> 'status';"; echo "select pg_sleep(1.5); commit;"; } > "$OUT/redeem_a.sql"
  { echo "$SVC"; echo "select public.bot_file_redeem('$TOKEN') ->> 'status';"; } > "$OUT/redeem_b.sql"
  "${PSQL[@]}" -d t_main -f "$OUT/redeem_a.sql" > "$OUT/redeem_a.out" 2>&1 & PA=$!
  sleep 0.5
  TB0=$(date +%s.%N); "${PSQL[@]}" -d t_main -f "$OUT/redeem_b.sql" > "$OUT/redeem_b.out" 2>&1; RB=$?; TB1=$(date +%s.%N)
  wait $PA; RA=$?
  SA=$(grep -E '^(ok|used|expired|invalid)$' "$OUT/redeem_a.out"); SBB=$(grep -E '^(ok|used|expired|invalid)$' "$OUT/redeem_b.out")
  WAIT=$(awk "BEGIN { printf \"%.1f\", $TB1 - $TB0 }")
  if [ $RA = 0 ] && [ $RB = 0 ] && [ "$SA" = ok ] && [ "$SBB" = used ] && awk "BEGIN { exit !($TB1 - $TB0 > 0.5) }"; then
    ok "T9: two redeems of one token at once" "A $SA, B $SBB (B waited ${WAIT} s on A's row)"
  else bad "T9: two redeems of one token at once" "A=$SA B=$SBB token=${#TOKEN} chars $(cat "$OUT/redeem_a.out" "$OUT/redeem_b.out" | grep -m1 ERROR)"; fi
  "${PSQL[@]}" -d t_main -c "delete from auth.users where id = 'f9000000-0000-4000-8000-0000000000aa'" >/dev/null || bad "T9: race fixture removed"
  t1_tests "with T5, T7 and T9" t_main
fi

# ── package T10 (20261010120006_telegram_bot_voice.sql, voice behind bot.config.flags.voice). Its behaviour test and its
#    ticket race read the oral questions through package T11's meldy_private.oral_sheet_for. With T11's migration in
#    this tree they run after T11's step, on the real function; without it, on the same LOCAL STUB as
#    T10's former runner, created only while they run and dropped right after (no fingerprint sees it).
echo "8. T10: voice"
VOICE_AFTER_T11=0
if stage T10 20261010120006; then
  FLAG=$("${PSQL[@]}" -d t_main -c "select flags -> 'voice' from bot.config where id = 1")
  if [ "$FLAG" = false ]; then ok "T10: the switch is off after the migration" "flags.voice = false"
  else bad "T10: the switch is off after the migration" "flags.voice = $FLAG"; fi
  if compgen -G "$SB/migrations/20261010120007_*.sql" >/dev/null; then
    VOICE_AFTER_T11=1; skip "T10: telegram_bot_voice.sql and the ticket race" "after T11's step, on its oral_sheet_for"
  else voice_tests T10; fi
  t1_tests "with T10" t_main
fi
# ── slot: package T11 (20261010120007_oral_plan_inputs.sql, bot_oral_inputs: the oral plan on the server). Applied only
#    when its migration is in this tree; its local test supabase/tests/local/oral_plan_inputs.sql when that is too
#    (green on exit 0: put its PASSED line here when it lands).
echo "9. slot T11: the oral plan on the server"
if stage T11 20261010120007; then
  [ -f "$HERE/oral_plan_inputs.sql" ] && sql_test "T11: oral_plan_inputs.sql" t_main "$HERE/oral_plan_inputs.sql"
  t1_tests "with T11" t_main
fi
[ $VOICE_AFTER_T11 = 0 ] || voice_tests "T10 after T11"

# ── package WA (20261010150000_telegram_webapp.sql, the Mini App's sign-in: bot_webapp_session, bot_webapp_link) ──────
echo "9b. WA: the Mini App's sign-in"
if stage WA 20261010150000; then
  sql_test "WA: telegram_webapp.sql" t_main "$HERE/telegram_webapp.sql" 'TELEGRAM WEBAPP CHECKS PASSED'
  t1_tests "with WA" t_main
fi

echo "10. everything applied (T1 ${DONE[*]})"
contract_full "supabase/tests/telegram_bot.sql" t_main
if "${PSQL[@]}" -d t_main -f "$SB/tests/containers.sql" 2>&1 | grep -q '"contract_ok" : true'; then
  ok "the container's contract (supabase/tests/containers.sql)" "contract_ok: true"
else bad "the container's contract (supabase/tests/containers.sql)"; fi
fingerprint t_main "$OUT/fp_all.txt"
if ! "${PSQL[@]}" -d t_main -f "$DOWN" > "$OUT/down_blocked.log" 2>&1; then
  fingerprint t_main "$OUT/fp_blocked.txt"
  if cmp -s "$OUT/fp_all.txt" "$OUT/fp_blocked.txt"; then ok "T1's rollback refuses while later packages' objects remain" "and leaves everything"
  else bad "T1's rollback with later packages" "half done: $(diff "$OUT/fp_all.txt" "$OUT/fp_blocked.txt" | wc -l) differing lines"; fi
else bad "T1's rollback with later packages" "it ran"; fi

echo "11. the rollbacks in reverse"
for ((i = ${#DONE[@]} - 1; i >= 0; i--)); do
  pkg=${DONE[$i]}; prev=${PREV_OF[$pkg]}
  if [ -n "${DOWN_OF[$pkg]}" ] && run t_main "${DOWN_OF[$pkg]}" && run t_main "${DOWN_OF[$pkg]}"; then
    fingerprint t_main "$OUT/fp_down_$pkg.txt"
    if cmp -s "$OUT/fp_$prev.txt" "$OUT/fp_down_$pkg.txt"; then ok "$pkg: rollback twice → catalog as before $pkg" "0 differing lines"
    else bad "$pkg: rollback twice → catalog as before $pkg" "$(diff "$OUT/fp_$prev.txt" "$OUT/fp_down_$pkg.txt" | head -3 | tr '\n' ' ')"; fi
    contract_check "$pkg: the contract after its rollback" t_main '[]'
  else bad "$pkg: rollback applied twice"; fi
done
if run t_main "$DOWN" && run t_main "$DOWN"; then ok "T1: rollback applied twice"; else bad "T1: rollback applied twice"; fi
fingerprint t_main "$OUT/fp_down_T1.txt"
D=$(diff <(no_cron_acl "$OUT/fp_base.txt") <(no_cron_acl "$OUT/fp_down_T1.txt") | wc -l)
if [ "$D" = 0 ] && cron_grants "$OUT/fp_base.txt" "$OUT/fp_down_T1.txt"; then
  ok "T1: rollback → catalog equals the base" "0 differing lines (pg_cron's grants to postgres stay)"
else bad "T1: rollback → catalog equals the base" "$D differing lines"; fi
if [ "$("${PSQL[@]}" -d t_main -c "select count(*) from cron.job where jobname = 'meldy-telegram-tick'")" = 0 ]; then ok "T1: rollback unschedules the tick"
else bad "T1: rollback unschedules the tick"; fi
C=$(contract t_main)
if [ "$(echo "$C" | field "['contract_ok']" 2>/dev/null)" = false ]; then ok "T1: the contract after the rollback: reads, never raises" "contract_ok false"
else bad "T1: the contract after the rollback" "$C"; fi
if "${PSQL[@]}" -d t_main -f "$SB/tests/containers.sql" 2>&1 | grep -q '"contract_ok" : true'; then ok "the container's contract after the rollbacks" "contract_ok: true"
else bad "the container's contract after the rollbacks"; fi

echo "12. everything applied again"
if apply_t1 t_main && run t_main "$REV"; then
  fingerprint t_main "$OUT/fp_re_T1.txt"
  if cmp -s "$OUT/fp_T1.txt" "$OUT/fp_re_T1.txt"; then ok "T1: applied again" "= its first apply"
  else bad "T1: applied again" "$(diff "$OUT/fp_T1.txt" "$OUT/fp_re_T1.txt" | head -3 | tr '\n' ' ')"; fi
else bad "T1: applied again"; fi
for pkg in "${DONE[@]}"; do
  if run t_main "${MIG_OF[$pkg]}"; then
    fingerprint t_main "$OUT/fp_re_$pkg.txt"
    if cmp -s "$OUT/fp_$pkg.txt" "$OUT/fp_re_$pkg.txt"; then ok "$pkg: applied again" "= its first apply"
    else bad "$pkg: applied again" "$(diff "$OUT/fp_$pkg.txt" "$OUT/fp_re_$pkg.txt" | head -3 | tr '\n' ' ')"; fi
  else bad "$pkg: applied again"; fi
done
contract_full "supabase/tests/telegram_bot.sql again" t_main

echo
echo "elapsed $(( $(date +%s) - T0 )) s; outputs in $OUT"
if [ $FAILS = 0 ]; then echo "ALL TELEGRAM BOT CHECKS GREEN"; exit 0; else echo "$FAILS CHECK(S) FAILED"; exit 1; fi
