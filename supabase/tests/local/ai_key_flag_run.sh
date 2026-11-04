#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261107090300_ai_key_flag.sql on a scratch
# PostgreSQL 16 cluster: the base in the live order (question_kinds_base.sh up to 20261031090000, then every later
# migration before this one) → which existing contracts (supabase/tests/*.sql) and behaviours (tests/local/*_behaviour.sql)
# hold on it, among them those of the three functions this file replaces (question_kinds, question_kinds_bot,
# test_builder, telegram_bot, bot_skips_pictures) → ai_key_flag.sql and its behaviour fail before → the migration twice
# (the second changes nothing in the catalog) → the contract and ai_key_flag_behaviour.sql (the patch adds and removes
# the flag, never over a key already there, the bot's review shows it, «Вопрос дня» skips it, nobody else can set it) →
# every existing contract and behaviour that held on the base still holds → the rollback twice (the catalog of the base
# again, the three definitions byte for byte) → the migration again (the same catalog as the first apply) → the
# contract and the behaviour again. The last line is AI KEY FLAG CHECKS PASSED and the
# exit code 0 only when every step is green.
# Env (optional): AIKEY_PG_PORT (54473), AIKEY_WORK (${TMPDIR:-/tmp}/meldy-aikey), PG_BIN (/usr/lib/postgresql/16/bin).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
ROOT=$(cd "$SB/.." && pwd)
PORT=${AIKEY_PG_PORT:-54473}
WORK=${AIKEY_WORK:-${TMPDIR:-/tmp}/meldy-aikey}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
DB=aikey
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

MIG=$SB/migrations/20261107090300_ai_key_flag.sql
DOWN=$SB/rollback/20261107090300_ai_key_flag_down.sql
CONTRACT=$SB/tests/ai_key_flag.sql
BEHAVIOUR=$HERE/ai_key_flag_behaviour.sql
defs() { q "select md5(pg_get_functiondef('public.container_item_update(uuid, jsonb)'::regprocedure)) || md5(pg_get_functiondef('bot.session_view_json(bot.sessions)'::regprocedure)) || md5(pg_get_functiondef('bot.group_item_ok(public.test_items)'::regprocedure))"; }

# The base: the live order up to the file before this one.
if bash "$HERE/question_kinds_base.sh" $DB "$WORK" > "$WORK/base.out" 2>&1; then ok "$(tail -1 "$WORK/base.out")"
else bad "base"; tail -8 "$WORK/base.out" | sed 's/^/    /'; echo "AI KEY FLAG CHECKS FAILED"; exit 1; fi
N=0
for f in $(cd "$SB/migrations" && ls 2026*.sql); do
  [[ "$f" > "20261031090000_live_wide_rounds.sql" ]] || continue
  [[ "$f" < "20261107090300" ]] || continue
  if run "$SB/migrations/$f"; then N=$((N + 1)); else bad "base: $f"; fi
done
ok "base: $N more migrations in the live order, up to the one before 20261107090300"
OLD_CONTRACTS=()
for f in "$SB"/tests/*.sql; do
  case "$(basename "$f")" in ai_key_flag*) continue ;; esac
  holds "$f" && OLD_CONTRACTS+=("$f")
done
OLD_BEHAVIOURS=()
for f in "$HERE"/*_behaviour.sql; do
  case "$(basename "$f")" in ai_key_flag*) continue ;; esac
  passes "$f" > /dev/null 2>&1 && OLD_BEHAVIOURS+=("$f")
done
ok "on the base: ${#OLD_CONTRACTS[@]} existing contracts and ${#OLD_BEHAVIOURS[@]} existing behaviours hold (each must still hold)"
for name in question_kinds question_kinds_bot test_builder; do
  printf '%s\n' "${OLD_CONTRACTS[@]}" | grep -q "/$name.sql$" && ok "among them the contract of the replaced bodies: $name.sql" \
    || bad "the contract $name.sql does not hold on the base"
  printf '%s\n' "${OLD_BEHAVIOURS[@]}" | grep -q "/${name}_behaviour.sql$" && ok "among them the behaviour: ${name}_behaviour.sql" \
    || bad "the behaviour ${name}_behaviour.sql does not hold on the base"
done
printf '%s\n' "${OLD_CONTRACTS[@]}" | grep -q "/telegram_bot.sql$" && ok "among them the contract of «Вопрос дня»: telegram_bot.sql" \
  || bad "the contract telegram_bot.sql does not hold on the base"
printf '%s\n' "${OLD_BEHAVIOURS[@]}" | grep -q "/bot_skips_pictures_behaviour.sql$" \
  && ok "among them the behaviour of «Вопрос дня»: bot_skips_pictures_behaviour.sql" \
  || bad "the behaviour bot_skips_pictures_behaviour.sql does not hold on the base"

FBEFORE=$(fingerprint)
DBEFORE=$(defs)
if holds "$CONTRACT" > /dev/null 2>&1; then bad "ai_key_flag.sql passes before the migration (it tests nothing)"; else ok "ai_key_flag.sql fails before the migration"; fi
if passes "$BEHAVIOUR" > /dev/null 2>&1; then bad "ai_key_flag_behaviour passes before the migration (it tests nothing)"
else ok "ai_key_flag_behaviour fails before the migration"; fi
step "migration, first apply" "$MIG"
FMIG=$(fingerprint)
[ "$FMIG" != "$FBEFORE" ] && ok "the migration changed the catalog" || bad "the migration changed nothing"
step "migration, second apply (re-runnable)" "$MIG"
[ "$(fingerprint)" = "$FMIG" ] && ok "a second apply changes nothing in the catalog" || bad "a second apply changed the catalog"
step "contract: ai_key_flag.sql" "$CONTRACT"
if passes "$BEHAVIOUR"; then ok "behaviour: ai_key_flag_behaviour.sql"; else bad "behaviour: ai_key_flag_behaviour.sql"; fi
n=0; for f in "${OLD_CONTRACTS[@]}"; do if holds "$f"; then n=$((n + 1)); else bad "existing contract no longer holds: $(basename "$f")"; fi; done
[ $n = ${#OLD_CONTRACTS[@]} ] && ok "every existing contract still holds ($n)"
n=0; for f in "${OLD_BEHAVIOURS[@]}"; do if passes "$f" > /dev/null; then n=$((n + 1)); else bad "existing behaviour no longer holds: $(basename "$f")"; passes "$f"; fi; done
[ $n = ${#OLD_BEHAVIOURS[@]} ] && ok "every existing behaviour still holds ($n)"
step "rollback, first run" "$DOWN"
step "rollback, second run (re-runnable)" "$DOWN"
[ "$(defs)" = "$DBEFORE" ] && ok "the rollback restores the three definitions byte for byte" || bad "the rollback left another definition"
[ "$(fingerprint)" = "$FBEFORE" ] && ok "the rollback restores the catalog before the migration" || bad "the rollback left the catalog changed"
if holds "$CONTRACT" > /dev/null 2>&1; then bad "ai_key_flag.sql passes after the rollback"; else ok "ai_key_flag.sql fails after the rollback"; fi
n=0; for f in "${OLD_BEHAVIOURS[@]}"; do if passes "$f" > /dev/null; then n=$((n + 1)); else bad "after the rollback: $(basename "$f")"; fi; done
[ $n = ${#OLD_BEHAVIOURS[@]} ] && ok "after the rollback every existing behaviour holds ($n)"
step "migration again" "$MIG"
[ "$(fingerprint)" = "$FMIG" ] && ok "applied again: the same catalog as the first apply" || bad "applied again: another catalog"
step "contract again" "$CONTRACT"
if passes "$BEHAVIOUR"; then ok "behaviour again"; else bad "behaviour again"; fi

echo
if [ $FAILS = 0 ]; then echo "$OKS checks green"; echo "AI KEY FLAG CHECKS PASSED"; exit 0; fi
echo "$FAILS failed, $OKS green"; echo "AI KEY FLAG CHECKS FAILED"; exit 1
