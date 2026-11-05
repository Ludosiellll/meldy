#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261107090700_item_points.sql (a
# question's own points, test_items.points, weighing a quiz of the exam's subjects) on a scratch PostgreSQL 16 cluster:
# the base in the live order (question_kinds_base.sh up to 20261031090000, then every later migration before this one)
# → which existing contracts (supabase/tests/*.sql) and behaviours (tests/local/*_behaviour.sql) hold on it, among them
# those of the quizzes, their scores and statistics and the author's writes of a question → the contract item_points.sql
# and item_points_behaviour.sql fail before → the migration twice (the second changes nothing in the catalog; test_items
# is not rewritten; the check is validated) → the contract and the behaviour (points written by container_items_add and
# container_item_update and refused out of 1..100, an attempt of a quiz of subjects keeping its questions' points and
# every score weighing them, a later edit changing no finished attempt, an attempt without points and a quiz of
# weight 1 as before, a design quiz weighing its blocks) → every existing contract and behaviour that held on the base
# still holds → the rollback twice (each of the three functions byte for byte as its file wrote it, the catalog of the
# base) → the contract and the behaviour fail → the migration again with a question of 5 points and an attempt that
# weighs it, the rollback over them (the attempt keeps its points and its score, the column goes), the rollback again
# (the base's catalog) → the migration again (the same catalog as the first apply) → the contract and the behaviour
# again. The last line is ITEM POINTS CHECKS PASSED and the exit code 0 only when every step is green.
# Env (optional): POINTS_PG_PORT (54477), POINTS_WORK (${TMPDIR:-/tmp}/meldy-points), PG_BIN (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
ROOT=$(cd "$SB/.." && pwd)
PORT=${POINTS_PG_PORT:-54477}
WORK=${POINTS_WORK:-${TMPDIR:-/tmp}/meldy-points}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
DB=points
FAILS=0
OKS=0
ok() { printf '  ok    %s\n' "$1"; OKS=$((OKS + 1)); }
bad() { printf '  FAIL  %s\n' "$1"; FAILS=$((FAILS + 1)); }
as_pg() { if [ "$(id -u)" = 0 ]; then unshare --user --map-user=1000 --map-group=1000 bash -c "$1"; else bash -c "$1"; fi; }
mkdir -p "$WORK"
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
stop_all() { if [ $STARTED = 1 ]; then as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -m fast -w stop" >/dev/null; fi; }
trap stop_all EXIT
run() { "${PSQL[@]}" -d $DB -f "$1" > "$WORK/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$WORK/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
step() { if run "$2"; then ok "$1"; else bad "$1"; fi; }
q() { "${PSQL[@]}" -d $DB -c "$1"; }
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
fingerprint() {
  q "select md5(concat_ws('|',
     (select string_agg(p.oid::regprocedure::text || pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), '' order by p.oid::regprocedure::text)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'meldy_private', 'bot') and p.prokind in ('f', 'p')),
     (select string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(c.relacl::text, ''), ','
                        order by n.nspname, c.relname)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'meldy_private', 'bot') and c.relkind in ('r', 'p', 'i', 'v', 'S')),
     (select string_agg(table_schema || '.' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' '
                        || coalesce(column_default, ''), ',' order by table_schema, table_name, column_name)
        from information_schema.columns where table_schema in ('public', 'meldy_private', 'bot')),
     (select string_agg(conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid) || ' ' || convalidated::text, ',' order by conrelid::regclass::text, conname)
        from pg_constraint where connamespace in ('public'::regnamespace, 'meldy_private'::regnamespace, 'bot'::regnamespace)),
     (select string_agg(indexdef, ',' order by schemaname, tablename, indexname) from pg_indexes
       where schemaname in ('public', 'meldy_private', 'bot')),
     (select string_agg(t.tgrelid::regclass::text || '.' || t.tgname || ' ' || pg_get_triggerdef(t.oid), ',' order by t.tgrelid::regclass::text, t.tgname)
        from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'meldy_private', 'bot') and not t.tgisinternal),
     (select string_agg(schemaname || '.' || tablename || '.' || policyname || cmd || roles::text || coalesce(qual, '') || coalesce(with_check, ''), ','
                        order by schemaname, tablename, policyname)
        from pg_policies where schemaname in ('public', 'storage', 'bot'))))"
}

MIG=$SB/migrations/20261107090700_item_points.sql
DOWN=$SB/rollback/20261107090700_item_points_down.sql
CONTRACT=$SB/tests/item_points.sql
BEHAVIOUR=$HERE/item_points_behaviour.sql
# The three functions this file replaces, and the file each comes back from (its newest body before this one).
FUNCS=("meldy_private.quiz_start_for(text, text, uuid, text)|migrations/20261020120000_quiz_protection.sql"
       "public.container_items_add(uuid, jsonb)|migrations/20261101090000_question_kinds.sql"
       "public.container_item_update(uuid, jsonb)|migrations/20261107090300_ai_key_flag.sql")
defs() { local f out=''; for f in "${FUNCS[@]}"; do out="$out$(q "select md5(pg_get_functiondef('${f%%|*}'::regprocedure)) || coalesce((select proacl::text from pg_proc where oid = '${f%%|*}'::regprocedure), 'none')")"; done; echo "$out"; }
acl() { local f out=''; for f in "${FUNCS[@]}"; do out="$out $(q "select coalesce(proacl::text, 'none') from pg_proc where oid = '${f%%|*}'::regprocedure")"; done; echo "$out"; }
# The body of `name`'s CREATE OR REPLACE in `file`, character for character (between «as $fn$» and «$fn$;»).
file_body() { awk -v head="create or replace function $1(" 'index($0, head) == 1 { on = 1; next } on && /^as \$fn\$$/ { body = 1; next } body && /^\$fn\$;$/ { exit } body { print }' "$2"; }
db_body() { q "select prosrc from pg_proc where oid = '$1'::regprocedure" | sed '/./,$!d'; }
bodies_are() {
  local f name file sig ok=1
  for f in "${FUNCS[@]}"; do
    sig=${f%%|*}; file=${f##*|}; name=${sig%%(*}
    [ "$(db_body "$sig")" = "$(file_body "$name" "$SB/$file")" ] || { echo "    $sig differs from $file"; ok=0; }
  done
  [ $ok = 1 ]
}
filenode() { q "select pg_relation_filenode('public.test_items')"; }
# A question of 5 points and a finished attempt that weighs it, written past the functions (as rows saved before a
# rollback would be): the exam, its question, a quiz of its subject and one attempt with item_points {5}, answered right.
store_points() {
  "${PSQL[@]}" -d $DB >/dev/null <<'SQL'
insert into auth.users (id) values ('dddddddd-0000-4000-8000-000000000004') on conflict do nothing;
insert into public.containers (id, owner_id, title) values ('dddddddd-0000-4000-8000-0000000000e1', 'dddddddd-0000-4000-8000-000000000004', 'Баллы до отката');
insert into public.container_subjects (id, container_id, owner_id, title)
values ('dddddddd-0000-4000-8000-0000000000e2', 'dddddddd-0000-4000-8000-0000000000e1', 'dddddddd-0000-4000-8000-000000000004', 'Вопросы');
insert into public.test_items (id, container_id, subject_id, position, stem, options, correct, key_source, points)
values ('dddddddd-0000-4000-8000-0000000000e3', 'dddddddd-0000-4000-8000-0000000000e1', 'dddddddd-0000-4000-8000-0000000000e2', 1,
        'Пять баллов', '["а", "б"]', '{0}', 'manual', 5);
insert into auth.users (id) values ('dddddddd-0000-4000-8000-000000000005') on conflict do nothing;
select set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000004', false);
set role authenticated;
select set_config('points.code', public.quiz_create('dddddddd-0000-4000-8000-0000000000e1',
  '{"title": "До отката", "subject_ids": ["dddddddd-0000-4000-8000-0000000000e2"], "item_count": 1, "same_set": true}') ->> 'code', false);
select set_config('request.jwt.claim.sub', 'dddddddd-0000-4000-8000-000000000005', false);
select set_config('points.attempt', public.quiz_start(current_setting('points.code'), 'Перед откатом') ->> 'attempt_id', false);
select public.quiz_answer(current_setting('points.attempt')::uuid, '[{"item_id": "dddddddd-0000-4000-8000-0000000000e3", "chosen": [0]}]');
select public.quiz_finish(current_setting('points.attempt')::uuid);
reset role;
SQL
}
stored_attempt() { q "select coalesce(a.item_points::text, 'null') || ' ' || (r ->> 'score') || '/' || (r ->> 'max_score') || ' ' || (r ->> 'percent')
                         from public.quiz_attempts a join public.quizzes q on q.id = a.quiz_id
                        cross join lateral meldy_private.quiz_result_json(a.id) r
                        where q.container_id = 'dddddddd-0000-4000-8000-0000000000e1'"; }

# The base: the live order up to the file before this one.
if bash "$HERE/question_kinds_base.sh" $DB "$WORK" > "$WORK/base.out" 2>&1; then ok "$(tail -1 "$WORK/base.out")"
else bad "base"; tail -8 "$WORK/base.out" | sed 's/^/    /'; echo "ITEM POINTS CHECKS FAILED"; exit 1; fi
N=0
for f in $(cd "$SB/migrations" && ls 2026*.sql); do
  [[ "$f" > "20261031090000_live_wide_rounds.sql" ]] || continue
  [[ "$f" < "20261107090700" ]] || continue
  if run "$SB/migrations/$f"; then N=$((N + 1)); else bad "base: $f"; fi
done
ok "base: $N more migrations in the live order, up to the one before 20261107090700"
OLD_CONTRACTS=()
for f in "$SB"/tests/*.sql; do
  case "$(basename "$f")" in item_points*) continue ;; esac
  holds "$f" && OLD_CONTRACTS+=("$f")
done
OLD_BEHAVIOURS=()
for f in "$HERE"/*_behaviour.sql; do
  case "$(basename "$f")" in item_points*) continue ;; esac
  passes "$f" > /dev/null 2>&1 && OLD_BEHAVIOURS+=("$f")
done
ok "on the base: ${#OLD_CONTRACTS[@]} existing contracts and ${#OLD_BEHAVIOURS[@]} existing behaviours hold (each must still hold)"
for name in quizzes test_builder test_docs quiz_protection question_kinds question_kinds_quiz quiz_stats quiz_telegram ai_key_flag studio_pages; do
  printf '%s\n' "${OLD_CONTRACTS[@]}" | grep -q "/$name.sql$" && ok "among them the contract: $name.sql" \
    || bad "the contract $name.sql does not hold on the base"
done
for name in containers quizzes test_builder test_docs quiz_protection question_kinds question_kinds_quiz quiz_stats quiz_telegram ai_key_flag studio_pages; do
  printf '%s\n' "${OLD_BEHAVIOURS[@]}" | grep -q "/${name}_behaviour.sql$" && ok "among them the behaviour: ${name}_behaviour.sql" \
    || bad "the behaviour ${name}_behaviour.sql does not hold on the base"
done

FBEFORE=$(fingerprint)
DBEFORE=$(defs)
ABEFORE=$(acl)
NODE=$(filenode)
bodies_are && ok "on the base each of the three functions is its file's body" || bad "the base's functions are not the files' bodies"
if holds "$CONTRACT" > /dev/null 2>&1; then bad "item_points.sql passes before the migration (it tests nothing)"; else ok "item_points.sql fails before the migration"; fi
if passes "$BEHAVIOUR" > /dev/null 2>&1; then bad "item_points_behaviour passes before the migration (it tests nothing)"
else ok "item_points_behaviour fails before the migration"; fi
step "migration, first apply" "$MIG"
FMIG=$(fingerprint)
[ "$FMIG" != "$FBEFORE" ] && ok "the migration changed the catalog" || bad "the migration changed nothing"
step "migration, second apply (re-runnable)" "$MIG"
[ "$(fingerprint)" = "$FMIG" ] && ok "a second apply changes nothing in the catalog" || bad "a second apply changed the catalog"
[ "$(acl)" = "$ABEFORE" ] && ok "the three functions keep their grants ($ABEFORE )" || bad "a function's grants changed"
PACL=$(q "select coalesce(proacl::text, 'none') from pg_proc where oid = 'meldy_private.quiz_item_points(uuid[])'::regprocedure")
[ "$PACL" = "$(q "select coalesce(proacl::text, 'none') from pg_proc where oid = 'meldy_private.quiz_doc_points(uuid, uuid[])'::regprocedure")" ] \
  && ok "quiz_item_points has the grants of quiz_doc_points ($PACL)" || bad "quiz_item_points' grants: $PACL"
[ "$(filenode)" = "$NODE" ] && ok "test_items is not rewritten (the default is read, not written)" || bad "test_items was rewritten"
[ "$(q "select convalidated::text || ' ' || pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.test_items'::regclass and conname = 'test_items_points_check'")" \
  = 'true CHECK (((points >= 1) AND (points <= 100)))' ] && ok "test_items_points_check: 1..100, validated as every check of test_items" || bad "test_items_points_check"
step "contract: item_points.sql" "$CONTRACT"
if passes "$BEHAVIOUR"; then ok "behaviour: item_points_behaviour.sql"; else bad "behaviour: item_points_behaviour.sql"; fi
n=0; for f in "${OLD_CONTRACTS[@]}"; do if holds "$f"; then n=$((n + 1)); else bad "existing contract no longer holds: $(basename "$f")"; fi; done
[ $n = ${#OLD_CONTRACTS[@]} ] && ok "every existing contract still holds ($n)"
n=0; for f in "${OLD_BEHAVIOURS[@]}"; do if passes "$f" > /dev/null; then n=$((n + 1)); else bad "existing behaviour no longer holds: $(basename "$f")"; passes "$f"; fi; done
[ $n = ${#OLD_BEHAVIOURS[@]} ] && ok "every existing behaviour still holds ($n)"
step "rollback, first run" "$DOWN"
step "rollback, second run (re-runnable)" "$DOWN"
[ "$(defs)" = "$DBEFORE" ] && [ "$(acl)" = "$ABEFORE" ] && ok "the rollback restores the three functions byte for byte, with their grants" \
  || bad "the rollback left another definition"
bodies_are && ok "after the rollback each body is its file's, character for character" || bad "after the rollback a body differs from its file"
[ "$(fingerprint)" = "$FBEFORE" ] && ok "the rollback restores the catalog before the migration" || bad "the rollback left the catalog changed"
if holds "$CONTRACT" > /dev/null 2>&1; then bad "item_points.sql passes after the rollback"; else ok "item_points.sql fails after the rollback"; fi
if passes "$BEHAVIOUR" > /dev/null 2>&1; then bad "item_points_behaviour passes after the rollback"; else ok "item_points_behaviour fails after the rollback"; fi
n=0; for f in "${OLD_CONTRACTS[@]}"; do if holds "$f"; then n=$((n + 1)); else bad "after the rollback: $(basename "$f")"; fi; done
[ $n = ${#OLD_CONTRACTS[@]} ] && ok "after the rollback every existing contract holds ($n)"
n=0; for f in "${OLD_BEHAVIOURS[@]}"; do if passes "$f" > /dev/null; then n=$((n + 1)); else bad "after the rollback: $(basename "$f")"; fi; done
[ $n = ${#OLD_BEHAVIOURS[@]} ] && ok "after the rollback every existing behaviour holds ($n)"

# A rollback over points in use: the attempt keeps its points and its score, the question's points go.
step "migration again (before a question of 5 points)" "$MIG"
store_points && ok "a question of 5 points and a finished attempt of it stored" || bad "storing the points"
BEFORE_DOWN=$(stored_attempt)
[ "$BEFORE_DOWN" = '{5} 5/5 100' ] && ok "the attempt weighs them: $BEFORE_DOWN" || bad "the attempt before the rollback: $BEFORE_DOWN"
step "the rollback over them" "$DOWN"
[ "$(stored_attempt)" = "$BEFORE_DOWN" ] && ok "after the rollback the attempt keeps its points and its score ($(stored_attempt))" \
  || bad "the attempt after the rollback: $(stored_attempt)"
[ "$(q "select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'test_items' and column_name = 'points'")" = 0 ] \
  && ok "the column is gone" || bad "the column stayed"
bodies_are && ok "the three bodies are the files' again" || bad "the bodies after a rollback over points"
q "delete from public.containers where id = 'dddddddd-0000-4000-8000-0000000000e1'; delete from auth.users where id in ('dddddddd-0000-4000-8000-000000000004', 'dddddddd-0000-4000-8000-000000000005')" > /dev/null
step "rollback once the rows are gone" "$DOWN"
[ "$(fingerprint)" = "$FBEFORE" ] && ok "then the catalog is the base's again" || bad "the catalog after the second rollback"

step "migration again" "$MIG"
[ "$(fingerprint)" = "$FMIG" ] && ok "applied again: the same catalog as the first apply" || bad "applied again: another catalog"
step "contract again" "$CONTRACT"
if passes "$BEHAVIOUR"; then ok "behaviour again"; else bad "behaviour again"; fi

echo
if [ $FAILS = 0 ]; then echo "$OKS checks green"; echo "ITEM POINTS CHECKS PASSED"; exit 0; fi
echo "$FAILS failed, $OKS green"; echo "ITEM POINTS CHECKS FAILED"; exit 1
