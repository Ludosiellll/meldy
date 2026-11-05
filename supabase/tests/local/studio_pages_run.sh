#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261107090500_studio_pages.sql (the
# studio's page holds every question of the exam: 2100 blocks, 512 KB, a design quiz's pool is the whole page) on a
# scratch PostgreSQL 16 cluster: the base in the live order (question_kinds_base.sh up to 20261031090000, then every later
# migration before this one) → which existing contracts (supabase/tests/*.sql) and behaviours (tests/local/*_behaviour.sql)
# hold on it, among them those of the studio's document and its quizzes → the parity of test_doc_ok with the client on
# contracts/studio/test_doc_cases.json and test_doc_color_cases.json holds, and the pages' cases
# (test_doc_pages_cases.json) do not → the contract studio_pages.sql and studio_pages_behaviour.sql fail before → the
# migration twice (the second changes nothing in the catalog) → the contract, the behaviour (2100 blocks saved and read
# back, 2101 refused, the sizes of the case file to the byte, the table's check, a design quiz drawing 200 of 2000 in the
# page's order) and the parity of all three case files → every existing contract and behaviour that held on the base
# still holds → the rollback twice (each of the five functions byte for byte as its file wrote it, the catalog of the
# base) → the contract and the behaviour fail, the old parity holds → the migration again, a page of 2100 blocks stored,
# the rollback over it (it does not fail: the check stays NOT VALID, a NOTICE says so, the page stays and its next save
# is refused), the page gone, the rollback again (the base's catalog) → the migration again (the same catalog as the
# first apply) → the contract, the behaviour and the parity again. Timings of test_doc_ok and test_doc_save on the
# biggest page are printed. The last line is STUDIO PAGES CHECKS PASSED and the exit code 0 only when every step is green.
# Env (optional): PAGES_PG_PORT (54475), PAGES_WORK (${TMPDIR:-/tmp}/meldy-pages), PG_BIN (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
ROOT=$(cd "$SB/.." && pwd)
PORT=${PAGES_PG_PORT:-54475}
WORK=${PAGES_WORK:-${TMPDIR:-/tmp}/meldy-pages}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
DB=pages
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
marker() { grep -o "'[A-Z][A-Z0-9 _-]* PASSED'" "$1" | tail -1 | tr -d "'"; }
passes() { local out m; m=$(marker "$1"); out=$({ echo "$VARS"; cat "$1"; } | "${PSQL[@]}" -d $DB 2>&1)
           if [ -n "$m" ] && echo "$out" | grep -q "$m"; then echo "$out" | grep -o 'PAGES TIMING.*' | sed 's/^/    /'; return 0; fi
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

MIG=$SB/migrations/20261107090500_studio_pages.sql
DOWN=$SB/rollback/20261107090500_studio_pages_down.sql
CONTRACT=$SB/tests/studio_pages.sql
BEHAVIOUR=$HERE/studio_pages_behaviour.sql
OLD_CASES=$ROOT/contracts/studio/test_doc_cases.json
COLOR_CASES=$ROOT/contracts/studio/test_doc_color_cases.json
PAGES_CASES=$ROOT/contracts/studio/test_doc_pages_cases.json
# The five functions this file replaces, and the file each comes back from (its newest body before this one).
FUNCS=("meldy_private.test_doc_ok(jsonb, uuid)|migrations/20261107090400_studio_color_bg.sql"
       "public.test_doc_save(uuid, jsonb, integer)|migrations/20261019100000_test_docs.sql"
       "meldy_private.quiz_doc_items(uuid)|migrations/20261101090200_question_kinds_quiz.sql"
       "meldy_private.quiz_draw(public.quizzes)|migrations/20261019100000_test_docs.sql"
       "meldy_private.quiz_draw_count(public.quizzes)|migrations/20261019100000_test_docs.sql")
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
# The parity of test_doc_ok and the client's docProblems (test_docs_parity.sql) on case files put together: the first
# file's exam and other exam, the items of all of them.
jq -s '.[0] + {cases: (.[0].cases + .[1].cases)}' "$OLD_CASES" "$COLOR_CASES" > "$WORK/old_cases.json" || { echo "jq failed"; exit 2; }
jq -s '.[0] + {items: (.[0].items + .[2].items), cases: (.[0].cases + .[1].cases + .[2].cases)}' "$OLD_CASES" "$COLOR_CASES" "$PAGES_CASES" > "$WORK/all_cases.json" || { echo "jq failed"; exit 2; }
jq -s '.[0] + {items: (.[0].items + .[1].items), cases: (.[0].cases[0:60] + .[1].cases)}' "$OLD_CASES" "$PAGES_CASES" > "$WORK/pages_cases.json" || { echo "jq failed"; exit 2; }
parity_out() { { printf '\\set cases `cat %q`\n' "$1"; cat "$HERE/test_docs_parity.sql"; } | "${PSQL[@]}" -d $DB 2>&1; }
parity() {
  local out; out=$(parity_out "$2")
  if echo "$out" | grep -q 'TEST DOC PARITY PASSED'; then ok "$1 ($(echo "$out" | grep '^PARITY [0-9]'))"
  else bad "$1"; echo "$out" | grep -v NOTICE | tail -8 | sed 's/^/    /'; fi
}
# A page of 2100 blocks for a made-up exam, stored past test_doc_save (as a page saved before a rollback would be).
store_big() {
  "${PSQL[@]}" -d $DB >/dev/null <<'SQL'
insert into auth.users (id) values ('dddddddd-0000-4000-8000-000000000004') on conflict do nothing;
insert into public.containers (id, owner_id, title) values ('dddddddd-0000-4000-8000-0000000000e1', 'dddddddd-0000-4000-8000-000000000004', 'Большая страница');
insert into public.test_docs (container_id, doc)
select 'dddddddd-0000-4000-8000-0000000000e1', jsonb_build_object('v', 1, 'title', 'Большая страница',
  'theme', '{"accent": "blue", "background": {"kind": "plain"}, "font": "onest", "radius": "soft", "density": "airy", "answers": "list", "buttons": "pill"}'::jsonb,
  'layout', 'pages', 'results', '{"bands": [], "cta": null}'::jsonb,
  'blocks', (select jsonb_agg(jsonb_build_object('type', 'text', 'id', 'big' || lpad(i::text, 7, '0'), 'text', 'Абзац ' || i || repeat(' слово', 10), 'align', 'left') order by i)
               from generate_series(1, 2100) i));
SQL
}

# The base: the live order up to the file before this one.
if bash "$HERE/question_kinds_base.sh" $DB "$WORK" > "$WORK/base.out" 2>&1; then ok "$(tail -1 "$WORK/base.out")"
else bad "base"; tail -8 "$WORK/base.out" | sed 's/^/    /'; echo "STUDIO PAGES CHECKS FAILED"; exit 1; fi
N=0
for f in $(cd "$SB/migrations" && ls 2026*.sql); do
  [[ "$f" > "20261031090000_live_wide_rounds.sql" ]] || continue
  [[ "$f" < "20261107090500" ]] || continue
  if run "$SB/migrations/$f"; then N=$((N + 1)); else bad "base: $f"; fi
done
ok "base: $N more migrations in the live order, up to 20261107090400_studio_color_bg.sql"
OLD_CONTRACTS=()
for f in "$SB"/tests/*.sql; do
  case "$(basename "$f")" in studio_pages*) continue ;; esac
  holds "$f" && OLD_CONTRACTS+=("$f")
done
OLD_BEHAVIOURS=()
for f in "$HERE"/*_behaviour.sql; do
  case "$(basename "$f")" in studio_pages*) continue ;; esac
  passes "$f" > /dev/null 2>&1 && OLD_BEHAVIOURS+=("$f")
done
ok "on the base: ${#OLD_CONTRACTS[@]} existing contracts and ${#OLD_BEHAVIOURS[@]} existing behaviours hold (each must still hold)"
for name in test_docs doc_video studio_color_bg question_kinds_quiz; do
  printf '%s\n' "${OLD_CONTRACTS[@]}" | grep -q "/$name.sql$" && ok "among them the contract: $name.sql" \
    || bad "the contract $name.sql does not hold on the base"
done
for name in test_docs doc_video studio_color_bg quiz_protection question_kinds_quiz quizzes; do
  printf '%s\n' "${OLD_BEHAVIOURS[@]}" | grep -q "/${name}_behaviour.sql$" && ok "among them the behaviour: ${name}_behaviour.sql" \
    || bad "the behaviour ${name}_behaviour.sql does not hold on the base"
done
parity "parity on the base: test_doc_cases.json and test_doc_color_cases.json" "$WORK/old_cases.json"
if parity_out "$WORK/pages_cases.json" | grep -q 'TEST DOC PARITY PASSED'; then bad "the pages' cases pass before the migration (they test nothing)"
else ok "the pages' cases fail before the migration ($(parity_out "$WORK/pages_cases.json" | grep -c '^PARITY FAIL') differ)"; fi

FBEFORE=$(fingerprint)
DBEFORE=$(defs)
ABEFORE=$(acl)
bodies_are && ok "on the base each of the five functions is its file's body" || bad "the base's functions are not the files' bodies"
if holds "$CONTRACT" > /dev/null 2>&1; then bad "studio_pages.sql passes before the migration (it tests nothing)"; else ok "studio_pages.sql fails before the migration"; fi
if passes "$BEHAVIOUR" > /dev/null 2>&1; then bad "studio_pages_behaviour passes before the migration (it tests nothing)"
else ok "studio_pages_behaviour fails before the migration"; fi
step "migration, first apply" "$MIG"
FMIG=$(fingerprint)
[ "$FMIG" != "$FBEFORE" ] && ok "the migration changed the catalog" || bad "the migration changed nothing"
step "migration, second apply (re-runnable)" "$MIG"
[ "$(fingerprint)" = "$FMIG" ] && ok "a second apply changes nothing in the catalog" || bad "a second apply changed the catalog"
[ "$(acl)" = "$ABEFORE" ] && ok "the five functions keep their grants ($ABEFORE )" || bad "a function's grants changed"
[ "$(q "select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.test_docs'::regclass and conname = 'test_docs_doc_check'")" \
  = 'CHECK ((octet_length((doc)::text) <= 524288)) NOT VALID' ] && ok "test_docs_doc_check: 524288, NOT VALID (no scan under the lock)" || bad "test_docs_doc_check"
step "contract: studio_pages.sql" "$CONTRACT"
if passes "$BEHAVIOUR"; then ok "behaviour: studio_pages_behaviour.sql"; else bad "behaviour: studio_pages_behaviour.sql"; fi
parity "parity: test_doc_ok and docProblems agree on the three case files" "$WORK/all_cases.json"
# test_doc_ok on the biggest page of the case file (2000 questions, 2100 blocks), its items in place: how long it takes.
T=$({ printf '\\set cases `cat %q`\n' "$WORK/all_cases.json"; cat <<'SQL'
begin;
create temp table t_in (c jsonb);
insert into t_in values (:'cases'::jsonb);
do $t$
declare v jsonb := (select c from pg_temp.t_in); v_doc jsonb; v_at timestamptz; v_ms numeric; s uuid := gen_random_uuid(); i integer;
begin
  insert into auth.users (id) values ((v ->> 'owner_id')::uuid) on conflict do nothing;
  insert into public.containers (id, owner_id, title) values ((v ->> 'container_id')::uuid, (v ->> 'owner_id')::uuid, 'Время');
  insert into public.container_subjects (id, container_id, owner_id, title) values (s, (v ->> 'container_id')::uuid, (v ->> 'owner_id')::uuid, 'Вопросы');
  insert into public.test_items (id, container_id, subject_id, position, stem, options, correct, key_source)
  select x::uuid, (v ->> 'container_id')::uuid, s, o::integer, 'Вопрос ' || o, '["а", "б"]'::jsonb, '{0}'::smallint[], 'manual'
    from jsonb_array_elements_text(v -> 'items') with ordinality t(x, o);
  select e -> 'doc' into v_doc from jsonb_array_elements(v -> 'cases') e where e ->> 'name' like 'pages: the exam''s 2000 questions%';
  v_at := clock_timestamp();
  for i in 1..5 loop perform meldy_private.test_doc_ok(v_doc, (v ->> 'container_id')::uuid); end loop;
  v_ms := round(extract(epoch from clock_timestamp() - v_at) * 1000 / 5);
  raise notice 'PAGES TIMING test_doc_ok of 2100 blocks (2000 questions): % ms', v_ms;
end
$t$;
rollback;
SQL
} | "${PSQL[@]}" -d $DB 2>&1 | grep -o 'PAGES TIMING.*')
[ -n "$T" ] && ok "$T" || bad "timing of test_doc_ok"
n=0; for f in "${OLD_CONTRACTS[@]}"; do if holds "$f"; then n=$((n + 1)); else bad "existing contract no longer holds: $(basename "$f")"; fi; done
[ $n = ${#OLD_CONTRACTS[@]} ] && ok "every existing contract still holds ($n)"
n=0; for f in "${OLD_BEHAVIOURS[@]}"; do if passes "$f" > /dev/null; then n=$((n + 1)); else bad "existing behaviour no longer holds: $(basename "$f")"; passes "$f"; fi; done
[ $n = ${#OLD_BEHAVIOURS[@]} ] && ok "every existing behaviour still holds ($n)"
step "rollback, first run" "$DOWN"
step "rollback, second run (re-runnable)" "$DOWN"
[ "$(defs)" = "$DBEFORE" ] && [ "$(acl)" = "$ABEFORE" ] && ok "the rollback restores the five functions byte for byte, with their grants" \
  || bad "the rollback left another definition"
bodies_are && ok "after the rollback each body is its file's, character for character" || bad "after the rollback a body differs from its file"
[ "$(fingerprint)" = "$FBEFORE" ] && ok "the rollback restores the catalog before the migration (the check validated)" || bad "the rollback left the catalog changed"
if holds "$CONTRACT" > /dev/null 2>&1; then bad "studio_pages.sql passes after the rollback"; else ok "studio_pages.sql fails after the rollback"; fi
if passes "$BEHAVIOUR" > /dev/null 2>&1; then bad "studio_pages_behaviour passes after the rollback"; else ok "studio_pages_behaviour fails after the rollback"; fi
parity "parity after the rollback: the old case files as before" "$WORK/old_cases.json"
n=0; for f in "${OLD_CONTRACTS[@]}"; do if holds "$f"; then n=$((n + 1)); else bad "after the rollback: $(basename "$f")"; fi; done
[ $n = ${#OLD_CONTRACTS[@]} ] && ok "after the rollback every existing contract holds ($n)"
n=0; for f in "${OLD_BEHAVIOURS[@]}"; do if passes "$f" > /dev/null; then n=$((n + 1)); else bad "after the rollback: $(basename "$f")"; fi; done
[ $n = ${#OLD_BEHAVIOURS[@]} ] && ok "after the rollback every existing behaviour holds ($n)"

# A rollback over a page it no longer allows: it does not fail, and says so.
step "migration again (before a big page)" "$MIG"
store_big && ok "a page of 2100 blocks and $(q "select octet_length(doc::text) from public.test_docs where container_id = 'dddddddd-0000-4000-8000-0000000000e1'") bytes stored" || bad "the big page"
OUT=$("${PSQL[@]}" -d $DB -f "$DOWN" 2>&1) && ok "the rollback over it runs" || { bad "the rollback over a big page failed"; echo "$OUT" | head -5 | sed 's/^/    /'; }
echo "$OUT" | grep -q 'stays NOT VALID: 1 stored page' && ok "it says so: $(echo "$OUT" | grep -o 'test_docs_doc_check stays.*')" || bad "no NOTICE about the big page"
[ "$(q "select convalidated::text || ' ' || pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.test_docs'::regclass and conname = 'test_docs_doc_check'")" \
  = 'false CHECK ((octet_length((doc)::text) <= 204800)) NOT VALID' ] && ok "the check is 200 KB again, NOT VALID while the page is there" || bad "the check after a rollback over a big page"
[ "$(q "select jsonb_array_length(doc -> 'blocks') from public.test_docs where container_id = 'dddddddd-0000-4000-8000-0000000000e1'")" = 2100 ] \
  && ok "the big page is kept as it was" || bad "the big page changed"
if q "update public.test_docs set rev = rev where container_id = 'dddddddd-0000-4000-8000-0000000000e1'" > /dev/null 2>&1; then bad "the big page could be written again"
else ok "the big page cannot be written again until it is smaller (the check of new rows)"; fi
[ "$(q "select meldy_private.test_doc_ok(doc, container_id) from public.test_docs where container_id = 'dddddddd-0000-4000-8000-0000000000e1'")" = blocks ] \
  && ok "the old rules call it «blocks»" || bad "the old rules on the big page"
bodies_are && ok "the five bodies are the files' again" || bad "the bodies after a rollback over a big page"
q "delete from public.containers where id = 'dddddddd-0000-4000-8000-0000000000e1'; delete from auth.users where id = 'dddddddd-0000-4000-8000-000000000004'" > /dev/null
step "rollback once the page is gone" "$DOWN"
[ "$(fingerprint)" = "$FBEFORE" ] && ok "then the catalog is the base's again (the check validated)" || bad "the catalog after the second rollback"

step "migration again" "$MIG"
[ "$(fingerprint)" = "$FMIG" ] && ok "applied again: the same catalog as the first apply" || bad "applied again: another catalog"
step "contract again" "$CONTRACT"
if passes "$BEHAVIOUR"; then ok "behaviour again"; else bad "behaviour again"; fi
parity "parity again: the three case files" "$WORK/all_cases.json"

echo
if [ $FAILS = 0 ]; then echo "$OKS checks green"; echo "STUDIO PAGES CHECKS PASSED"; exit 0; fi
echo "$FAILS failed, $OKS green"; echo "STUDIO PAGES CHECKS FAILED"; exit 1
