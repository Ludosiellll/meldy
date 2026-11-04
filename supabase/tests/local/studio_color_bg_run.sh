#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261107090400_studio_color_bg.sql (the
# studio's own background colour in meldy_private.test_doc_ok) on a scratch PostgreSQL 16 cluster: the base in the live
# order (question_kinds_base.sh up to 20261031090000, then every later migration before this one) → which existing
# contracts (supabase/tests/*.sql) and behaviours (tests/local/*_behaviour.sql) hold on it, among them those of the
# studio's document and its quizzes (test_docs.sql, doc_video.sql, test_docs_behaviour.sql, doc_video_behaviour.sql,
# quiz_protection_behaviour.sql, question_kinds_quiz_behaviour.sql) → the parity of test_doc_ok with the client on
# contracts/studio/test_doc_cases.json holds, and the colour's cases (test_doc_color_cases.json) do not → the contract
# studio_color_bg.sql and studio_color_bg_behaviour.sql fail before → the migration twice (the second changes nothing in
# the catalog) → the contract, the behaviour (a page saved on its colour and read back, broken colours refused, a quiz
# «как в студии» carries the colour and a later one at once) and the parity of both case files → every existing contract
# and behaviour that held on the base still holds → the rollback twice (test_doc_ok byte for byte as 20261019110000 wrote
# it, the catalog of the base) → the contract and the behaviour fail, the old parity holds → the migration again (the
# same catalog as the first apply) → the contract, the behaviour and the parity again. The last line is
# COLOR BG CHECKS PASSED and the exit code 0 only when every step is green.
# Env (optional): COLORBG_PG_PORT (54474), COLORBG_WORK (${TMPDIR:-/tmp}/meldy-colorbg), PG_BIN (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
ROOT=$(cd "$SB/.." && pwd)
PORT=${COLORBG_PG_PORT:-54474}
WORK=${COLORBG_WORK:-${TMPDIR:-/tmp}/meldy-colorbg}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
DB=colorbg
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
VARS=$(printf '\\set names `cat %q`\n\\set looks `cat %q`\n\\set numbers `cat %q`\n' \
  "$ROOT/contracts/live/name_cases.json" "$ROOT/contracts/live/default_looks.json" "$ROOT/contracts/kinds/number_vectors.json")
[ -f "$ROOT/contracts/kinds/grade_vectors.json" ] && VARS="$VARS
$(printf '\\set grades `cat %q`' "$ROOT/contracts/kinds/grade_vectors.json")"
marker() { grep -o "'[A-Z][A-Z0-9 _-]* PASSED'" "$1" | tail -1 | tr -d "'"; }
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
     (select string_agg(conrelid::regclass::text || '.' || conname || ' ' || pg_get_constraintdef(oid), ',' order by conrelid::regclass::text, conname)
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

MIG=$SB/migrations/20261107090400_studio_color_bg.sql
DOWN=$SB/rollback/20261107090400_studio_color_bg_down.sql
CONTRACT=$SB/tests/studio_color_bg.sql
BEHAVIOUR=$HERE/studio_color_bg_behaviour.sql
OLD_CASES=$ROOT/contracts/studio/test_doc_cases.json
COLOR_CASES=$ROOT/contracts/studio/test_doc_color_cases.json
VIDEO_BODY=$SB/migrations/20261019110000_doc_video.sql
defs() { q "select md5(pg_get_functiondef('meldy_private.test_doc_ok(jsonb, uuid)'::regprocedure))"; }
acl() { q "select coalesce(proacl::text, 'none') from pg_proc where oid = 'meldy_private.test_doc_ok(jsonb, uuid)'::regprocedure"; }
# The parity of test_doc_ok and the client's docProblems (test_docs_parity.sql) on a case file; both files at once are
# put together here (the colour's cases use the exam and the items of test_doc_cases.json).
jq -s '.[0] + {cases: (.[0].cases + .[1].cases)}' "$OLD_CASES" "$COLOR_CASES" > "$WORK/all_cases.json" || { echo "jq failed"; exit 2; }
jq -s '.[0] + {cases: (.[0].cases[0:60] + .[1].cases)}' "$OLD_CASES" "$COLOR_CASES" > "$WORK/color_cases.json" || { echo "jq failed"; exit 2; }
parity_out() { { printf '\\set cases `cat %q`\n' "$1"; cat "$HERE/test_docs_parity.sql"; } | "${PSQL[@]}" -d $DB 2>&1; }
parity() {
  local out; out=$(parity_out "$2")
  if echo "$out" | grep -q 'TEST DOC PARITY PASSED'; then ok "$1 ($(echo "$out" | grep '^PARITY [0-9]'))"
  else bad "$1"; echo "$out" | grep -v NOTICE | tail -8 | sed 's/^/    /'; fi
}

# The base: the live order up to the file before this one.
if bash "$HERE/question_kinds_base.sh" $DB "$WORK" > "$WORK/base.out" 2>&1; then ok "$(tail -1 "$WORK/base.out")"
else bad "base"; tail -8 "$WORK/base.out" | sed 's/^/    /'; echo "COLOR BG CHECKS FAILED"; exit 1; fi
N=0
for f in $(cd "$SB/migrations" && ls 2026*.sql); do
  [[ "$f" > "20261031090000_live_wide_rounds.sql" ]] || continue
  [[ "$f" < "20261107090400" ]] || continue
  if run "$SB/migrations/$f"; then N=$((N + 1)); else bad "base: $f"; fi
done
ok "base: $N more migrations in the live order, up to the one before 20261107090400"
OLD_CONTRACTS=()
for f in "$SB"/tests/*.sql; do
  case "$(basename "$f")" in studio_color_bg*) continue ;; esac
  holds "$f" && OLD_CONTRACTS+=("$f")
done
OLD_BEHAVIOURS=()
for f in "$HERE"/*_behaviour.sql; do
  case "$(basename "$f")" in studio_color_bg*) continue ;; esac
  passes "$f" > /dev/null 2>&1 && OLD_BEHAVIOURS+=("$f")
done
ok "on the base: ${#OLD_CONTRACTS[@]} existing contracts and ${#OLD_BEHAVIOURS[@]} existing behaviours hold (each must still hold)"
for name in test_docs doc_video; do
  printf '%s\n' "${OLD_CONTRACTS[@]}" | grep -q "/$name.sql$" && ok "among them the contract of the studio's document: $name.sql" \
    || bad "the contract $name.sql does not hold on the base"
done
for name in test_docs doc_video quiz_protection question_kinds_quiz; do
  printf '%s\n' "${OLD_BEHAVIOURS[@]}" | grep -q "/${name}_behaviour.sql$" && ok "among them the behaviour: ${name}_behaviour.sql" \
    || bad "the behaviour ${name}_behaviour.sql does not hold on the base"
done
parity "parity on the base: test_doc_ok and docProblems agree on test_doc_cases.json" "$OLD_CASES"
if parity_out "$WORK/color_cases.json" | grep -q 'TEST DOC PARITY PASSED'; then bad "the colour's cases pass before the migration (they test nothing)"
else ok "the colour's cases fail before the migration ($(parity_out "$WORK/color_cases.json" | grep -c '^PARITY FAIL') differ)"; fi

FBEFORE=$(fingerprint)
DBEFORE=$(defs)
ABEFORE=$(acl)
if holds "$CONTRACT" > /dev/null 2>&1; then bad "studio_color_bg.sql passes before the migration (it tests nothing)"; else ok "studio_color_bg.sql fails before the migration"; fi
if passes "$BEHAVIOUR" > /dev/null 2>&1; then bad "studio_color_bg_behaviour passes before the migration (it tests nothing)"
else ok "studio_color_bg_behaviour fails before the migration"; fi
step "migration, first apply" "$MIG"
FMIG=$(fingerprint)
[ "$FMIG" != "$FBEFORE" ] && ok "the migration changed the catalog" || bad "the migration changed nothing"
step "migration, second apply (re-runnable)" "$MIG"
[ "$(fingerprint)" = "$FMIG" ] && ok "a second apply changes nothing in the catalog" || bad "a second apply changed the catalog"
[ "$(acl)" = "$ABEFORE" ] && ok "test_doc_ok keeps its grants ($ABEFORE)" || bad "test_doc_ok's grants changed"
step "contract: studio_color_bg.sql" "$CONTRACT"
if passes "$BEHAVIOUR"; then ok "behaviour: studio_color_bg_behaviour.sql"; else bad "behaviour: studio_color_bg_behaviour.sql"; fi
parity "parity: test_doc_ok and docProblems agree on both case files" "$WORK/all_cases.json"
n=0; for f in "${OLD_CONTRACTS[@]}"; do if holds "$f"; then n=$((n + 1)); else bad "existing contract no longer holds: $(basename "$f")"; fi; done
[ $n = ${#OLD_CONTRACTS[@]} ] && ok "every existing contract still holds ($n)"
n=0; for f in "${OLD_BEHAVIOURS[@]}"; do if passes "$f" > /dev/null; then n=$((n + 1)); else bad "existing behaviour no longer holds: $(basename "$f")"; passes "$f"; fi; done
[ $n = ${#OLD_BEHAVIOURS[@]} ] && ok "every existing behaviour still holds ($n)"
step "rollback, first run" "$DOWN"
step "rollback, second run (re-runnable)" "$DOWN"
[ "$(defs)" = "$DBEFORE" ] && [ "$(acl)" = "$ABEFORE" ] && ok "the rollback restores test_doc_ok byte for byte, with its grants" \
  || bad "the rollback left another definition"
# The function as 20261019110000 wrote it: the body of its CREATE OR REPLACE, character for character.
BODY_FILE=$(sed -n '/^as \$fn\$$/,/^\$fn\$;$/p' "$VIDEO_BODY" | sed '1d;$d')
[ "$(q "select prosrc from pg_proc where oid = 'meldy_private.test_doc_ok(jsonb, uuid)'::regprocedure" | sed '/./,$!d')" = "$BODY_FILE" ] \
  && ok "after the rollback the body is 20261019110000_doc_video.sql's, character for character" || bad "after the rollback the body differs from 20261019110000's"
[ "$(fingerprint)" = "$FBEFORE" ] && ok "the rollback restores the catalog before the migration" || bad "the rollback left the catalog changed"
if holds "$CONTRACT" > /dev/null 2>&1; then bad "studio_color_bg.sql passes after the rollback"; else ok "studio_color_bg.sql fails after the rollback"; fi
if passes "$BEHAVIOUR" > /dev/null 2>&1; then bad "studio_color_bg_behaviour passes after the rollback"; else ok "studio_color_bg_behaviour fails after the rollback"; fi
parity "parity after the rollback: test_doc_cases.json as before" "$OLD_CASES"
n=0; for f in "${OLD_CONTRACTS[@]}"; do if holds "$f"; then n=$((n + 1)); else bad "after the rollback: $(basename "$f")"; fi; done
[ $n = ${#OLD_CONTRACTS[@]} ] && ok "after the rollback every existing contract holds ($n)"
n=0; for f in "${OLD_BEHAVIOURS[@]}"; do if passes "$f" > /dev/null; then n=$((n + 1)); else bad "after the rollback: $(basename "$f")"; fi; done
[ $n = ${#OLD_BEHAVIOURS[@]} ] && ok "after the rollback every existing behaviour holds ($n)"
step "migration again" "$MIG"
[ "$(fingerprint)" = "$FMIG" ] && ok "applied again: the same catalog as the first apply" || bad "applied again: another catalog"
step "contract again" "$CONTRACT"
if passes "$BEHAVIOUR"; then ok "behaviour again"; else bad "behaviour again"; fi
parity "parity again: both case files" "$WORK/all_cases.json"

echo
if [ $FAILS = 0 ]; then echo "$OKS checks green"; echo "COLOR BG CHECKS PASSED"; exit 0; fi
echo "$FAILS failed, $OKS green"; echo "COLOR BG CHECKS FAILED"; exit 1
