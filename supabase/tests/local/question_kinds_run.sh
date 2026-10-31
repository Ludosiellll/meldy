#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of the question kinds (release 48, docs/kinds/CONTRACT.md) on a
# scratch PostgreSQL 16 cluster: the base in the live order up to 20261031090000 (question_kinds_base.sh) → which of the
# existing contracts (supabase/tests/*.sql) and behaviours (tests/local/*_behaviour.sql) hold on that base → then for
# each stage, in order (20261101090000_question_kinds.sql, 20261101090100_question_kinds_grading.sql,
# 20261101090200_question_kinds_quiz.sql, … whichever exist): its contract and behaviour fail before it → the migration
# twice (the second changes nothing in the catalog) → its contract and behaviour (with the shared cases of
# contracts/kinds) → every earlier stage's contract and behaviour, and every existing contract and behaviour that held on
# the base, still hold → the rollback twice (the catalog of the stage before, its contract fails again) → the migration
# again (the same catalog as the first apply) → its contract and behaviour again. The last line is QUESTION KINDS CHECKS
# PASSED and the exit code 0 only when every step is green.
# Env (optional): KINDS_PG_PORT (54470), KINDS_WORK (${TMPDIR:-/tmp}/meldy-kinds), PG_BIN (/usr/lib/postgresql/16/bin),
# KINDS_STAGES (how many stages to run; all by default).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
ROOT=$(cd "$SB/.." && pwd)
PORT=${KINDS_PG_PORT:-54470}
WORK=${KINDS_WORK:-${TMPDIR:-/tmp}/meldy-kinds}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
DB=kinds
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

# The base, and what holds on it.
if bash "$HERE/question_kinds_base.sh" $DB "$WORK" > "$WORK/base.out" 2>&1; then ok "$(tail -1 "$WORK/base.out")"
else bad "base"; tail -8 "$WORK/base.out" | sed 's/^/    /'; echo "QUESTION KINDS CHECKS FAILED"; exit 1; fi
OLD_CONTRACTS=()
for f in "$SB"/tests/*.sql; do
  case "$(basename "$f")" in question_kinds*) continue ;; esac
  holds "$f" && OLD_CONTRACTS+=("$f")
done
OLD_BEHAVIOURS=()
for f in "$HERE"/*_behaviour.sql; do
  case "$(basename "$f")" in question_kinds*) continue ;; esac
  passes "$f" > /dev/null 2>&1 && OLD_BEHAVIOURS+=("$f")
done
ok "on the base: ${#OLD_CONTRACTS[@]} existing contracts and ${#OLD_BEHAVIOURS[@]} existing behaviours hold (each must still hold after every stage)"

STAGES=()
for m in 20261101090000_question_kinds 20261101090100_question_kinds_grading 20261101090200_question_kinds_quiz \
         20261101090300_question_kinds_bot 20261101090400_question_kinds_essay; do
  [ -f "$SB/migrations/$m.sql" ] && STAGES+=("$m")
done
[ -n "${KINDS_STAGES:-}" ] && STAGES=("${STAGES[@]:0:$KINDS_STAGES}")
DONE_CONTRACTS=()
DONE_BEHAVIOURS=()
for m in "${STAGES[@]}"; do
  name=${m#*_}
  MIG=$SB/migrations/$m.sql
  DOWN=$SB/rollback/${m}_down.sql
  CONTRACT=$SB/tests/$name.sql
  BEHAVIOUR=$HERE/${name}_behaviour.sql
  echo "── $m"
  FBEFORE=$(fingerprint)
  if holds "$CONTRACT" > /dev/null 2>&1; then bad "$name.sql passes before the migration (it tests nothing)"; else ok "$name.sql fails before the migration"; fi
  if passes "$BEHAVIOUR" > /dev/null 2>&1; then bad "${name}_behaviour passes before the migration (it tests nothing)"
  else ok "${name}_behaviour fails before the migration"; fi
  step "migration, first apply" "$MIG"
  FMIG=$(fingerprint)
  [ "$FMIG" != "$FBEFORE" ] && ok "the migration changed the catalog" || bad "the migration changed nothing"
  step "migration, second apply (re-runnable)" "$MIG"
  [ "$(fingerprint)" = "$FMIG" ] && ok "a second apply changes nothing in the catalog" || bad "a second apply changed the catalog"
  step "contract: $name.sql" "$CONTRACT"
  if passes "$BEHAVIOUR"; then ok "behaviour: ${name}_behaviour.sql"; else bad "behaviour: ${name}_behaviour.sql"; fi
  for f in "${DONE_CONTRACTS[@]}"; do holds "$f" && ok "earlier stage still holds: $(basename "$f")" || bad "earlier stage: $(basename "$f")"; done
  for f in "${DONE_BEHAVIOURS[@]}"; do passes "$f" > /dev/null && ok "earlier stage still holds: $(basename "$f")" || bad "earlier stage: $(basename "$f")"; done
  n=0; for f in "${OLD_CONTRACTS[@]}"; do if holds "$f"; then n=$((n + 1)); else bad "existing contract no longer holds: $(basename "$f")"; fi; done
  [ $n = ${#OLD_CONTRACTS[@]} ] && ok "every existing contract still holds ($n)"
  n=0; for f in "${OLD_BEHAVIOURS[@]}"; do if passes "$f" > /dev/null; then n=$((n + 1)); else bad "existing behaviour no longer holds: $(basename "$f")"; passes "$f"; fi; done
  [ $n = ${#OLD_BEHAVIOURS[@]} ] && ok "every existing behaviour still holds ($n)"
  step "rollback, first run" "$DOWN"
  step "rollback, second run (re-runnable)" "$DOWN"
  [ "$(fingerprint)" = "$FBEFORE" ] && ok "the rollback restores the catalog before the migration" || bad "the rollback left the catalog changed"
  if holds "$CONTRACT" > /dev/null 2>&1; then bad "$name.sql passes after the rollback"; else ok "$name.sql fails after the rollback"; fi
  step "migration again" "$MIG"
  [ "$(fingerprint)" = "$FMIG" ] && ok "applied again: the same catalog as the first apply" || bad "applied again: another catalog"
  step "contract again" "$CONTRACT"
  if passes "$BEHAVIOUR"; then ok "behaviour again"; else bad "behaviour again"; fi
  DONE_CONTRACTS+=("$CONTRACT")
  DONE_BEHAVIOURS+=("$BEHAVIOUR")
done

echo
if [ $FAILS = 0 ]; then echo "$OKS checks green"; echo "QUESTION KINDS CHECKS PASSED"; exit 0; fi
echo "$FAILS failed, $OKS green"; echo "QUESTION KINDS CHECKS FAILED"; exit 1
