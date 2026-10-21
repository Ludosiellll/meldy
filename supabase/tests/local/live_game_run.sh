#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. Rehearsal of supabase/migrations/20261021090000_live_game.sql (the live
# class game «Битва с монстром», docs/live/CONTRACT.md) on a scratch PostgreSQL 16 cluster:
# the base in the live order (as test_docs_run.sh: containers + storage stand-in + pgcrypto in extensions, the bot's
# packages with pg_cron / pg_net stubbed when not installed, every later migration up to 20261019110000_doc_video.sql)
# plus a LOCAL STUB of Supabase's realtime.send (it records the hints in realtime.sent) → the catalog fingerprint of
# that base → the contract (tests/live_game.sql) and the behaviour fail before the migration → the migration twice (the
# same fingerprint) → the contract → live_game_behaviour.sql (a whole game: create, joins, the state machine by a time
# machine, scoring, freeze, phases, heal, podium, the key's secrecy, limits, tokens, Realtime hints, the bot's calls)
# with the shared cases of contracts/live (names, default looks) → the damage of every millisecond of 10/20/30 s and
# streaks 1–5, with and without speed, against rules.ts (node) → 30 players answering at once (one close, every answer
# counted) → the other contracts still hold (quiz_guards, test_builder, quizzes, test_docs, doc_video, telegram_bot) →
# real.ts end to end through PostgREST (when a postgrest binary is found: create → join ×3 → next → answer → reveal →
# … → podium → review; LIVE_PGRST or `postgrest` on PATH) → the rollback twice (the fingerprint of the base again; the
# contract bites) → the migration again (the same fingerprint as the first apply) → the contract and behaviour again →
# the stand stage: 20261022090000_live_stand.sql (mode «Встань на ответ», docs/live/MODE_STAND.md) the same way (its
# contract tests/live_stand.sql, live_stand_behaviour.sql, the battle still green, the points against
# backend/live_move_stand.py, the room end to end by live_stand_e2e.sh, its rollback back to the live game's catalog) →
# the mixed stage: 20261024090000_live_mixed.sql (the battle with movement rounds, docs/live/MODE_MIXED.md) the same way
# (its contract tests/live_mixed.sql, live_mixed_behaviour.sql, the stand and the battle still green, the damage and the
# rule against backend/live_move_mixed.py, the room end to end by live_mixed_e2e.sh with the database against the
# mirror, its rollback back to the stand's catalog).
# The last line is LIVE GAME CHECKS PASSED and the exit code 0 only when every step is green.
# Env (optional): LIVE_PG_PORT (54460), LIVE_WORK (${TMPDIR:-/tmp}/meldy-live-game), PG_BIN (/usr/lib/postgresql/16/bin),
# LIVE_PGRST (a PostgREST 12 binary), LIVE_PGRST_PORT (54461), LIVE_E2E=0 skips the end-to-end stages, LIVE_STAND=0 the
# stand stage, LIVE_MIXED=0 the mixed stage, LIVE_PHONE_MIG (20261023090000_live_stand_phone.sql by default, applied
# before the mixed stage; none skips it), LIVE_PY (python3: a Python with the backend's packages for the room's end to end).
set -u -o pipefail
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
SB=$(cd "$HERE/../.." && pwd)
ROOT=$(cd "$SB/.." && pwd)
PORT=${LIVE_PG_PORT:-54460}
WORK=${LIVE_WORK:-${TMPDIR:-/tmp}/meldy-live-game}
PG_BIN=${PG_BIN:-/usr/lib/postgresql/16/bin}
MIG=$SB/migrations/20261021090000_live_game.sql
DOWN=$SB/rollback/20261021090000_live_game_down.sql
CONTRACT=$SB/tests/live_game.sql
BEHAVIOUR=$HERE/live_game_behaviour.sql
export PGHOST=127.0.0.1 PGPORT=$PORT PGUSER=postgres
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1)
DB=live
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
PGRST_PID=
stop_all() {
  if [ -n "$PGRST_PID" ]; then kill "$PGRST_PID" 2>/dev/null; wait "$PGRST_PID" 2>/dev/null; fi
  if [ $STARTED = 1 ]; then as_pg "'$PG_BIN/pg_ctl' -D '$WORK/pg/data' -m fast -w stop" >/dev/null; fi
}
trap stop_all EXIT
run() { "${PSQL[@]}" -d $DB -f "$1" > "$WORK/last.log" 2>&1 || { echo "    $1 failed:"; grep -v NOTICE "$WORK/last.log" | head -6 | sed 's/^/    /'; return 1; }; }
step() { if run "$2"; then ok "$1"; else bad "$1"; fi; }
q() { "${PSQL[@]}" -d $DB -c "$1"; }
# A behaviour file passes when its own last line is printed. The shared cases of contracts/live are read by psql through
# the \set lines written here.
passes() { local out; out=$({ printf '\\set names `cat %q`\n\\set looks `cat %q`\n' "$ROOT/contracts/live/name_cases.json" \
                                "$ROOT/contracts/live/default_looks.json"; cat "$1"; } | "${PSQL[@]}" -d $DB 2>&1)
           if echo "$out" | grep -q "$2"; then return 0; fi
           echo "$out" | grep -v NOTICE | tail -8 | sed 's/^/    /'; return 1; }
behave() { if passes "$2" "$3"; then ok "$1"; else bad "$1"; fi; }
contract_ok() {
  local out; out=$("${PSQL[@]}" -d $DB -f "$2" 2>&1)
  if echo "$out" | grep -Eq '"contract_ok" ?: ?true'; then ok "$1"
  else bad "$1"; echo "$out" | grep -o '"failed" *: *\[[^]]*\]' | head -1 | sed 's/^/    /'; echo "$out" | grep -m1 ERROR | sed 's/^/    /'; fi
}
containers_contract() { local out; out=$("${PSQL[@]}" -d $DB -f "$SB/tests/containers.sql" 2>&1)
                        [ $? = 0 ] && ! echo "$out" | grep -q '"contract_ok" *: *false'; }

"${PSQL[@]}" -d postgres -c "drop database if exists $DB" -c "create database $DB encoding 'UTF8' template template0" >/dev/null
BASE_OK=1
for f in tests/local/baseline.sql migrations/20261003083154_hackathon_journal_exams_oral.sql migrations/20261005143420_cheat_sheet.sql \
         tests/local/exam_shares_baseline.sql migrations/20261007110403_exam_shares.sql migrations/20261007110457_exam_shares_revokes.sql; do
  run "$SB/$f" || BASE_OK=0
done
q "alter table auth.users add column if not exists created_at timestamptz not null default now()" >/dev/null || BASE_OK=0
run "$SB/migrations/20261005042323_app_telemetry.sql" || BASE_OK=0
run "$SB/tests/local/ai_quota_baseline.sql" || BASE_OK=0
"${PSQL[@]}" -d $DB >/dev/null <<'SQL' || BASE_OK=0
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
         migrations/20261010074500_containers_fk_indexes.sql migrations/20261010110000_containers_oral_codes_closed.sql; do
  run "$SB/$f" || BASE_OK=0
done
q "create schema if not exists extensions" >/dev/null || BASE_OK=0
q "create extension if not exists pgcrypto with schema extensions" >/dev/null || BASE_OK=0
# pg_cron and pg_net as test_docs_run.sh: the real ones when installed, else LOCAL STUBS of the same names and signatures.
if [ "$(q "select count(*) from pg_available_extensions where name in ('pg_cron', 'pg_net')")" = 2 ]; then
  CRON_RUN=$SB/migrations/20261010120001_telegram_bot_cron.sql
else
  "${PSQL[@]}" -d $DB >/dev/null <<'SQL' || BASE_OK=0
create schema if not exists cron;
create schema if not exists net;
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
  sed -E 's/^(create extension if not exists pg_(cron|net) .*)$/-- (local: stubbed) \1/' \
    "$SB/migrations/20261010120001_telegram_bot_cron.sql" > "$WORK/cron_local.sql"
  [ "$(grep -c '^-- (local: stubbed) create extension' "$WORK/cron_local.sql")" = 2 ] || BASE_OK=0
  CRON_RUN=$WORK/cron_local.sql
fi
# Supabase Realtime's realtime.send(payload, event, topic, private) as a LOCAL STUB that records each message (the live
# one inserts into realtime.messages, delivered after commit). Not in public or meldy_private: no fingerprint sees it.
"${PSQL[@]}" -d $DB >/dev/null <<'SQL' || BASE_OK=0
create schema if not exists realtime;
create table if not exists realtime.sent (
  id bigserial primary key, payload jsonb, event text, topic text, private boolean, at timestamptz not null default clock_timestamp());
create or replace function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
  language sql as $$ insert into realtime.sent (payload, event, topic, private) values (payload, event, topic, private) $$;
SQL
run "$SB/tests/local/storage_baseline.sql" || BASE_OK=0
q "grant select on storage.objects to anon" >/dev/null || BASE_OK=0
[ $BASE_OK = 1 ] && ok "base (containers + storage stand-in, pgcrypto in extensions, realtime.send stubbed)" || bad "base"
step "base: 20261010120000_telegram_bot.sql" "$SB/migrations/20261010120000_telegram_bot.sql"
step "base: 20261010120001_telegram_bot_cron.sql$([ "$CRON_RUN" = "$WORK/cron_local.sql" ] && echo ' (pg_cron and pg_net stubbed)')" "$CRON_RUN"
BASE_FILES=0
for f in 20261010120002_telegram_bot_revokes.sql 20261010120003_telegram_bot_sessions.sql \
         20261010120004_telegram_bot_groups.sql 20261010120005_telegram_bot_files.sql 20261010120006_telegram_bot_voice.sql \
         20261010120007_oral_plan_inputs.sql 20261010130000_containers_frozen_pace.sql 20261010150000_telegram_webapp.sql \
         20261011100000_containers_not_found_null.sql 20261012100000_telegram_bot_monitor.sql \
         20261014120000_test_item_images.sql 20261014150000_bot_skips_pictures.sql 20261014170000_plan_tempo.sql \
         20261016100000_item_update_images.sql 20261016120000_quizzes.sql 20261016140000_quiz_result_order.sql \
         20261018100000_test_builder.sql 20261018120000_exam_move_bot_exams.sql 20261018130000_quiz_guards.sql \
         20261018140000_quiz_practice_grace.sql 20261019090000_container_kind.sql 20261019100000_test_docs.sql \
         20261019110000_doc_video.sql; do
  if run "$SB/migrations/$f"; then BASE_FILES=$((BASE_FILES + 1)); else bad "base: $f"; fi
done
[ $BASE_FILES = 23 ] && ok "base: the 23 later migrations up to 20261019110000_doc_video.sql in the live order"

# The catalog the migration and its rollback touch: every function of public, meldy_private and bot (source and
# grants), those schemas' relations (RLS, grants), columns, constraints, indexes and triggers, and their policies.
fingerprint() { local f; f=$(fingerprint_sql) && [ -n "$f" ] && echo "$f" || echo "fingerprint failed $RANDOM"; }
fingerprint_sql() {
  q "select md5(concat_ws('|',
     (select string_agg(p.oid::regprocedure::text || pg_get_functiondef(p.oid) || coalesce(p.proacl::text, ''), '' order by p.oid::regprocedure::text)
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname in ('public', 'meldy_private', 'bot') and p.prokind in ('f', 'p')),
     (select string_agg(nspname || ':' || coalesce(nspacl::text, ''), ',' order by nspname) from pg_namespace
       where nspname in ('public', 'meldy_private', 'bot')),
     (select string_agg(n.nspname || '.' || c.relname || ':' || c.relkind::text || ':' || c.relrowsecurity::text || ':' || coalesce(c.relacl::text, ''), ','
                        order by n.nspname, c.relname)
        from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname in ('public', 'meldy_private', 'bot') and c.relkind in ('r', 'p', 'i', 'v', 'S')),
     (select string_agg(table_schema || '.' || table_name || '.' || column_name || ' ' || data_type || ' ' || is_nullable || ' '
                        || coalesce(column_default, ''), ',' order by table_schema, table_name, ordinal_position)
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
FBASE=$(fingerprint)
[[ "$FBASE" =~ ^[0-9a-f]{32}$ ]] && ok "the catalog fingerprint of the live base (up to 20261019110000_doc_video) taken" \
  || bad "fingerprint of the live base"

if run "$CONTRACT"; then bad "live_game.sql passes before the migration (it tests nothing)"; else ok "live_game.sql fails before the migration"; fi
if passes "$BEHAVIOUR" 'LIVE GAME BEHAVIOUR PASSED' >/dev/null; then
  bad "live_game_behaviour passes before the migration (it tests nothing)"
else
  ok "live_game_behaviour fails before the migration"
fi
contract_ok "contract: telegram_bot.sql holds on the base" "$SB/tests/telegram_bot.sql"

step "migration, first apply" "$MIG"
FMIG=$(fingerprint)
[ "$FMIG" != "$FBASE" ] && ok "the migration changed the catalog" || bad "the migration changed nothing"
step "migration, second apply (re-runnable)" "$MIG"
[ "$(fingerprint)" = "$FMIG" ] && ok "a second apply changes nothing in the catalog" || bad "a second apply changed the catalog"

step "contract: live_game.sql (catalog, grants, the numbers of rules.test.ts)" "$CONTRACT"
behave "behaviour: a whole game, the key's secrecy, limits, tokens, hints, the bot's calls, the shared cases" \
  "$BEHAVIOUR" 'LIVE GAME BEHAVIOUR PASSED'

# Damage of every millisecond of 10, 20 and 30 s, streaks 1–5, with and without speed: rules.ts (node) and
# meldy_private.live_damage give the same list (md5 of «d,d,…» in the same order).
DMG_JS=$(cd "$ROOT" && node --experimental-strip-types --no-warnings --input-type=module -e "
  const { damage } = await import('./frontend/src/lib/live/rules.ts');
  const { createHash } = await import('node:crypto');
  const out = [];
  for (const t of [10, 20, 30]) for (const sp of [true, false]) for (let s = 1; s <= 5; s++) for (let e = 0; e <= t * 1000; e++) out.push(damage(e, t, s, sp));
  console.log(out.length + ':' + createHash('md5').update(out.join(',')).digest('hex'));" 2>&1)
DMG_SQL=$(q "select count(*) || ':' || md5(string_agg(d::text, ',' order by t, sp desc, s, e))
               from (select t, sp, s, e, meldy_private.live_damage(e, t, s, sp) as d
                       from unnest(array[10, 20, 30]) t, unnest(array[true, false]) sp, generate_series(1, 5) s,
                            lateral generate_series(0, t * 1000) e) x" 2>&1)
if [ -n "$DMG_JS" ] && [ "$DMG_JS" = "$DMG_SQL" ]; then ok "damage: rules.ts and the SQL agree on all ${DMG_JS%%:*} cases"
else bad "damage: rules.ts $DMG_JS, SQL $DMG_SQL"; fi

# 30 players answer at once (30 connections, the same moment): every answer counted, one close, one reveal.
CONC=$WORK/conc; rm -rf "$CONC"; mkdir -p "$CONC"
SETUP=$("${PSQL[@]}" -d $DB 2>"$CONC/setup.err" <<'SQL'
set role authenticated;
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) is null \g /dev/null
select set_config('meldy.c', (public.container_create('Тридцать сразу', null, '[{"title":"Т"}]') -> 'subjects' -> 0 ->> 'id'), false) is null \g /dev/null
select public.container_items_add(current_setting('meldy.c')::uuid, jsonb_build_array(
  jsonb_build_object('ref', 'c:1', 'stem', 'Два плюс два', 'options', jsonb_build_array('3', '4', '5'), 'correct', jsonb_build_array(1)),
  jsonb_build_object('ref', 'c:2', 'stem', 'Три плюс три', 'options', jsonb_build_array('6', '7'), 'correct', jsonb_build_array(0)),
  jsonb_build_object('ref', 'c:3', 'stem', 'Пять минус два', 'options', jsonb_build_array('3', '2'), 'correct', jsonb_build_array(0)))) is null \g /dev/null
select x ->> 'game_id', x ->> 'host_token', x ->> 'pin'
  from (select public.live_create(jsonb_build_object('container_id', (select container_id from public.container_subjects where id = current_setting('meldy.c')::uuid),
                                                      'subject_ids', jsonb_build_array(current_setting('meldy.c')), 'count', 3),
                                  '{"time_s": 30}') x) y;
SQL
)
GAME=$(echo "$SETUP" | tail -1 | cut -d'|' -f1); HOST=$(echo "$SETUP" | tail -1 | cut -d'|' -f2); PIN=$(echo "$SETUP" | tail -1 | cut -d'|' -f3)
if [[ "$GAME" =~ ^[0-9a-f-]{36}$ ]]; then
  for i in $(seq 1 30); do
    T=$(printf 'conc%039d' "$i")
    q "set role anon; select (public.live_join('$PIN', 'Игрок $i', '$T', null)) ->> 'player_id'" > /dev/null 2>>"$CONC/join.err"
  done
  q "set role anon; select public.live_next('$GAME', '$HOST', 'lobby') is null" >/dev/null 2>>"$CONC/next.err"
  # The time machine: the countdown is over (every time of the game 4 s earlier).
  q "update public.live_games set q_ready_at = q_ready_at - interval '4 s', q_opens_at = q_opens_at - interval '4 s',
            q_closes_at = q_closes_at - interval '4 s', state_at = state_at - interval '4 s', created_at = created_at - interval '4 s'
      where id = '$GAME'; update public.live_questions set opens_at = opens_at - interval '4 s', closes_at = closes_at - interval '4 s'
      where game_id = '$GAME'; update public.live_players set joined_at = joined_at - interval '4 s' where game_id = '$GAME'" >/dev/null
  # A gate: one session holds an advisory lock for 2 s; the 30 answering sessions wait on it and go together.
  ( "${PSQL[@]}" -d $DB -c "select pg_advisory_lock(424242), pg_sleep(2), pg_advisory_unlock(424242)" > /dev/null 2>&1 ) &
  sleep 0.5
  for i in $(seq 1 30); do
    T=$(printf 'conc%039d' "$i")
    ( printf '%s\n' "select pg_advisory_lock_shared(424242) is null \g /dev/null" "select pg_advisory_unlock_shared(424242) is null \g /dev/null" \
        "set role anon;" "select (public.live_answer('$GAME', '$T', 0, $((i % 3)))) ->> 'accepted';" \
        | "${PSQL[@]}" -d $DB > "$CONC/a$i.out" 2>&1 ) &
  done
  wait
  ACC=$(cat "$CONC"/a*.out | grep -c '^true$')
  N=$(q "select (select count(*) from public.live_answers where game_id = '$GAME' and qi = 0) || ':' || g.state || ':' ||
             (select array_to_string(counts, ',') from public.live_questions where game_id = '$GAME' and qi = 0) || ':' ||
             (select count(*) from realtime.sent where topic = 'live:' || g.topic and payload ->> 'state' = 'reveal')
        from public.live_games g where g.id = '$GAME'")
  if [ "$ACC" = 30 ] && [ "${N%%:*}" = 30 ] && echo "$N" | grep -Eq '^30:reveal:[0-9]+,[0-9]+,[0-9]+:1$'; then
    ok "30 answers at once: all accepted, one close (reveal, counts $(echo "$N" | cut -d: -f3), one reveal hint)"
  else
    bad "30 answers at once: accepted $ACC, answers:state:counts:reveal hints = $N"; grep -hv '^true$' "$CONC"/a*.out | head -3 | sed 's/^/    /'
  fi
else
  bad "30 answers at once: fixture"; head -5 "$CONC/setup.err" | sed 's/^/    /'
fi
q "delete from public.containers where title = 'Тридцать сразу'" >/dev/null || bad "30 answers: cleanup"

step "contract: quiz_guards.sql still holds" "$SB/tests/quiz_guards.sql"
step "contract: test_builder.sql still holds" "$SB/tests/test_builder.sql"
step "contract: quizzes.sql still holds" "$SB/tests/quizzes.sql"
step "contract: test_docs.sql still holds" "$SB/tests/test_docs.sql"
step "contract: doc_video.sql still holds" "$SB/tests/doc_video.sql"
contract_ok "contract: telegram_bot.sql still holds (webapp_uses takes 'game')" "$SB/tests/telegram_bot.sql"
if containers_contract; then ok "contract: containers.sql still holds"; else bad "contract: containers.sql"; fi
behave "quiz_guards_behaviour after the migration" "$HERE/quiz_guards_behaviour.sql" 'QUIZ GUARDS BEHAVIOUR PASSED'
behave "test_builder_behaviour after the migration" "$HERE/test_builder_behaviour.sql" 'BUILDER BEHAVIOUR PASSED'

# real.ts end to end: PostgREST 12 on this database (anon / authenticated by JWT, the PGRST status override), a small
# proxy at /rest/v1, and frontend/src/lib/live/real.e2e.test.ts driving the real client.
PGRST=${LIVE_PGRST:-$(command -v postgrest || true)}
if [ "${LIVE_E2E:-1}" = 0 ]; then
  echo "  skip  end to end (LIVE_E2E=0)"
elif [ -z "$PGRST" ] || [ ! -x "$PGRST" ]; then
  echo "  skip  end to end: no PostgREST binary (LIVE_PGRST=…/postgrest, v12: github.com/PostgREST/postgrest/releases)"
else
  if bash "$HERE/live_game_e2e.sh" "$PGRST" "$DB" > "$WORK/e2e.log" 2>&1; then
    ok "end to end: real.ts through PostgREST ($(grep -E 'Tests +[0-9]+ passed' "$WORK/e2e.log" | head -1 | sed 's/^ *//'))"
  else
    bad "end to end: real.ts through PostgREST (log: $WORK/e2e.log)"; grep -E 'FAIL|Error|×|expected' "$WORK/e2e.log" | head -8 | sed 's/^/    /'
  fi
fi
[ "$(fingerprint)" = "$FMIG" ] && ok "the catalog unchanged by the behaviour runs" || bad "the behaviour runs changed the catalog"

step "rollback" "$DOWN"
[ "$(fingerprint)" = "$FBASE" ] && ok "after the rollback: the catalog of the live base (fingerprint)" \
  || bad "after the rollback: another catalog than the live base"
step "rollback again (re-runnable)" "$DOWN"
[ "$(fingerprint)" = "$FBASE" ] && ok "after the second rollback: still the catalog of the live base" || bad "after the second rollback: another catalog"
if run "$CONTRACT"; then bad "live_game.sql passes after the rollback (it tests nothing)"; else ok "live_game.sql fails after the rollback"; fi
contract_ok "contract after the rollback: telegram_bot.sql" "$SB/tests/telegram_bot.sql"
step "contract after the rollback: quiz_guards.sql" "$SB/tests/quiz_guards.sql"
step "contract after the rollback: test_docs.sql" "$SB/tests/test_docs.sql"
behave "quiz_guards_behaviour after the rollback" "$HERE/quiz_guards_behaviour.sql" 'QUIZ GUARDS BEHAVIOUR PASSED'

step "migration after the rollback" "$MIG"
[ "$(fingerprint)" = "$FMIG" ] && ok "the same catalog as the first apply" || bad "another catalog than the first apply"
step "contract again" "$CONTRACT"
behave "behaviour again" "$BEHAVIOUR" 'LIVE GAME BEHAVIOUR PASSED'


# ─── Mode «Встань на ответ» (20261022090000_live_stand.sql, docs/live/MODE_STAND.md) on top of the live game ───
# Its contract fails before it; applied twice (the same catalog); its contract, live_game.sql and the battle's behaviour
# still hold; live_stand_behaviour.sql (a whole stand game); the points of every millisecond of 15/20/30 s, streaks 1–5,
# alive and ghost, with and without speed, against backend/live_move_stand.py (the room's tests use that mirror); the
# room end to end (backend/scripts/live_stand_e2e.py: the real WebSocket room, 30 bots, PostgREST, this database) when
# a PostgREST binary and the backend's Python are found; its rollback twice (the live game's catalog again); applied again.
# LIVE_STAND=0 skips the stage; LIVE_PY: a Python with the backend's packages (for the end-to-end run).
if [ "${LIVE_STAND:-1}" = 0 ]; then
  echo "  skip  the stand stage (LIVE_STAND=0)"
else
  SMIG=$SB/migrations/20261022090000_live_stand.sql
  SDOWN=$SB/rollback/20261022090000_live_stand_down.sql
  SCONTRACT=$SB/tests/live_stand.sql
  SBEHAVIOUR=$HERE/live_stand_behaviour.sql
  FGAME=$(fingerprint)
  if run "$SCONTRACT"; then bad "live_stand.sql passes before its migration (it tests nothing)"; else ok "live_stand.sql fails before its migration"; fi
  if passes "$SBEHAVIOUR" 'LIVE STAND BEHAVIOUR PASSED' >/dev/null; then
    bad "live_stand_behaviour passes before its migration (it tests nothing)"
  else
    ok "live_stand_behaviour fails before its migration"
  fi
  step "stand migration, first apply" "$SMIG"
  FSTAND=$(fingerprint)
  [ "$FSTAND" != "$FGAME" ] && ok "the stand migration changed the catalog" || bad "the stand migration changed nothing"
  step "stand migration, second apply (re-runnable)" "$SMIG"
  [ "$(fingerprint)" = "$FSTAND" ] && ok "a second stand apply changes nothing in the catalog" || bad "a second stand apply changed the catalog"
  step "contract: live_stand.sql (catalog, grants, the worked numbers)" "$SCONTRACT"
  step "contract: live_game.sql still holds" "$CONTRACT"
  behave "stand behaviour: settings, the room's write, ghosts, revives, late joiners, the close by time, podium, review" \
    "$SBEHAVIOUR" 'LIVE STAND BEHAVIOUR PASSED'
  behave "the battle's behaviour unchanged after the stand migration" "$BEHAVIOUR" 'LIVE GAME BEHAVIOUR PASSED'
  PY=${LIVE_PY:-python3}
  PTS_PY=$(cd "$ROOT/backend" && "$PY" -c "
import hashlib, live_move_stand as s
out = [s.stand_points(e, t, k, sp, g) for t in (15, 20, 30) for sp in (True, False) for g in (False, True) for k in range(1, 6) for e in range(t * 1000 + 1)]
print(str(len(out)) + ':' + hashlib.md5(','.join(map(str, out)).encode()).hexdigest())" 2>&1)
  PTS_SQL=$(q "select count(*) || ':' || md5(string_agg(d::text, ',' order by t, sp desc, g, k, e))
                 from (select t, sp, g, k, e, meldy_private.live_stand_points(e, t, k, sp, g) as d
                         from unnest(array[15, 20, 30]) t, unnest(array[true, false]) sp, unnest(array[false, true]) g,
                              generate_series(1, 5) k, lateral generate_series(0, t * 1000) e) x" 2>&1)
  if [ -n "$PTS_PY" ] && [ "$PTS_PY" = "$PTS_SQL" ]; then ok "stand points: live_move_stand.py and the SQL agree on all ${PTS_PY%%:*} cases"
  else bad "stand points: Python $PTS_PY, SQL $PTS_SQL"; fi
  if [ "${LIVE_E2E:-1}" = 0 ]; then
    echo "  skip  the room end to end (LIVE_E2E=0)"
  elif [ -z "$PGRST" ] || [ ! -x "$PGRST" ] || ! "$PY" -c "import fastapi, uvicorn, websockets, httpx" 2>/dev/null; then
    echo "  skip  the room end to end: needs a PostgREST binary (LIVE_PGRST) and the backend's Python (LIVE_PY)"
  else
    if LIVE_PY="$PY" bash "$HERE/live_stand_e2e.sh" "$PGRST" "$DB" > "$WORK/stand_e2e.log" 2>&1; then
      ok "the room end to end: $(grep -E '^STAND E2E' "$WORK/stand_e2e.log" | tail -1)"
    else
      bad "the room end to end (log: $WORK/stand_e2e.log)"; grep -Ev '^\s*$' "$WORK/stand_e2e.log" | tail -8 | sed 's/^/    /'
    fi
  fi
  [ "$(fingerprint)" = "$FSTAND" ] && ok "the catalog unchanged by the stand runs" || bad "the stand runs changed the catalog"
  step "stand rollback" "$SDOWN"
  [ "$(fingerprint)" = "$FGAME" ] && ok "after the stand rollback: the live game's catalog (fingerprint)" \
    || bad "after the stand rollback: another catalog than the live game's"
  step "stand rollback again (re-runnable)" "$SDOWN"
  [ "$(fingerprint)" = "$FGAME" ] && ok "after the second stand rollback: still the live game's catalog" || bad "after the second stand rollback: another catalog"
  if run "$SCONTRACT"; then bad "live_stand.sql passes after its rollback"; else ok "live_stand.sql fails after its rollback"; fi
  step "contract: live_game.sql after the stand rollback" "$CONTRACT"
  behave "the battle's behaviour after the stand rollback" "$BEHAVIOUR" 'LIVE GAME BEHAVIOUR PASSED'
  step "stand migration after its rollback" "$SMIG"
  [ "$(fingerprint)" = "$FSTAND" ] && ok "the same catalog as the first stand apply" || bad "another catalog than the first stand apply"
  step "contract: live_stand.sql again" "$SCONTRACT"
  behave "stand behaviour again" "$SBEHAVIOUR" 'LIVE STAND BEHAVIOUR PASSED'
fi

# ─── The battle with movement rounds (20261024090000_live_mixed.sql, docs/live/MODE_MIXED.md) on top of the stand ───
# First 20261023090000_live_stand_phone.sql (the kit's hats, the mode in the bot's facts), as live has it, with its
# contract (LIVE_PHONE_MIG: another path; LIVE_PHONE_MIG=none skips it — the two touch different functions, so the mixed
# migration works on either). Then the mixed one: its contract fails before it; applied twice
# (the same catalog); its contract, live_stand.sql and live_game.sql hold; live_mixed_behaviour.sql (three games), the
# stand's and the battle's behaviours still pass; the rule and the damage of every millisecond against
# backend/live_move_mixed.py (the mirror the room's tests and the end to end use); the room end to end
# (backend/scripts/live_mixed_e2e.py: 30 bots, 6 questions, every 3rd a movement round, the database against the mirror)
# and the stand's end to end again; the rollback twice (the stand's catalog again, the stand still green); applied again.
# LIVE_MIXED=0 skips the stage (it needs the stand stage).
if [ "${LIVE_MIXED:-1}" = 0 ] || [ "${LIVE_STAND:-1}" = 0 ]; then
  echo "  skip  the mixed stage (LIVE_MIXED=0 or LIVE_STAND=0)"
else
  MMIG=$SB/migrations/20261024090000_live_mixed.sql
  MDOWN=$SB/rollback/20261024090000_live_mixed_down.sql
  MCONTRACT=$SB/tests/live_mixed.sql
  MBEHAVIOUR=$HERE/live_mixed_behaviour.sql
  PHONE_MIG=${LIVE_PHONE_MIG:-$SB/migrations/20261023090000_live_stand_phone.sql}
  if [ "$PHONE_MIG" != none ] && [ -f "$PHONE_MIG" ]; then
    step "the phone's migration first: $(basename "$PHONE_MIG")" "$PHONE_MIG"
    [ -f "$SB/tests/live_stand_phone.sql" ] && step "contract: live_stand_phone.sql" "$SB/tests/live_stand_phone.sql"
  else
    echo "  skip  the phone's migration (LIVE_PHONE_MIG=none or not found)"
  fi
  FPRE=$(fingerprint)
  if run "$MCONTRACT"; then bad "live_mixed.sql passes before its migration (it tests nothing)"; else ok "live_mixed.sql fails before its migration"; fi
  if passes "$MBEHAVIOUR" 'LIVE MIXED BEHAVIOUR PASSED' >/dev/null; then
    bad "live_mixed_behaviour passes before its migration (it tests nothing)"
  else
    ok "live_mixed_behaviour fails before its migration"
  fi
  step "mixed migration, first apply" "$MMIG"
  FMIXED=$(fingerprint)
  [ "$FMIXED" != "$FPRE" ] && ok "the mixed migration changed the catalog" || bad "the mixed migration changed nothing"
  step "mixed migration, second apply (re-runnable)" "$MMIG"
  [ "$(fingerprint)" = "$FMIXED" ] && ok "a second mixed apply changes nothing in the catalog" || bad "a second mixed apply changed the catalog"
  step "contract: live_mixed.sql (catalog, grants, the rule, the worked example)" "$MCONTRACT"
  step "contract: live_stand.sql still holds" "$SCONTRACT"
  step "contract: live_game.sql still holds" "$CONTRACT"
  behave "mixed behaviour: settings, taps, two movement rounds (worked examples A and B), a void round, the boss falling in one" \
    "$MBEHAVIOUR" 'LIVE MIXED BEHAVIOUR PASSED'
  behave "the stand's behaviour unchanged after the mixed migration" "$SBEHAVIOUR" 'LIVE STAND BEHAVIOUR PASSED'
  behave "the battle's behaviour unchanged after the mixed migration" "$BEHAVIOUR" 'LIVE GAME BEHAVIOUR PASSED'
  PY=${LIVE_PY:-python3}
  MIR_PY=$(cd "$ROOT/backend" && "$PY" -c "
import hashlib, live_move_mixed as m
d = [m.damage(e, t, s, sp) for t in (10, 20, 30) for sp in (True, False) for s in range(1, 6) for e in range(t * 1000 + 1)]
r = [m.stand_round(n, q, i) for n in (0, 3, 5, 10) for q in range(1, 31) for i in range(-1, 31)]
print(str(len(d)) + ':' + hashlib.md5(','.join(map(str, d)).encode()).hexdigest() + '/' + str(len(r)) + ':'
      + hashlib.md5(','.join('t' if x else 'f' for x in r).encode()).hexdigest())" 2>&1)
  MIR_SQL=$(q "select (select count(*) || ':' || md5(string_agg(d::text, ',' order by t, sp desc, s, e))
                         from (select t, sp, s, e, meldy_private.live_damage(e, t, s, sp) as d
                                 from unnest(array[10, 20, 30]) t, unnest(array[true, false]) sp, generate_series(1, 5) s,
                                      lateral generate_series(0, t * 1000) e) x) || '/' ||
                      (select count(*) || ':' || md5(string_agg(case when r then 't' else 'f' end, ',' order by o))
                         from (select row_number() over (order by n.o, qc, i) as o, meldy_private.live_stand_round(n.v, qc, i) as r
                                 from unnest(array[0, 3, 5, 10]) with ordinality n(v, o), generate_series(1, 30) qc,
                                      generate_series(-1, 30) i) y)" 2>&1)
  if [ -n "$MIR_PY" ] && [ "$MIR_PY" = "$MIR_SQL" ]; then
    ok "the mirror: live_move_mixed.py and the SQL agree on the damage (${MIR_PY%%:*} cases) and the rule ($(echo "$MIR_PY" | cut -d/ -f2 | cut -d: -f1) cases)"
  else
    bad "the mirror: Python $MIR_PY, SQL $MIR_SQL"
  fi
  if [ "${LIVE_E2E:-1}" = 0 ]; then
    echo "  skip  the mixed room end to end (LIVE_E2E=0)"
  elif [ -z "$PGRST" ] || [ ! -x "$PGRST" ] || ! "$PY" -c "import fastapi, uvicorn, websockets, httpx" 2>/dev/null; then
    echo "  skip  the mixed room end to end: needs a PostgREST binary (LIVE_PGRST) and the backend's Python (LIVE_PY)"
  else
    if LIVE_PY="$PY" bash "$HERE/live_mixed_e2e.sh" "$PGRST" "$DB" > "$WORK/mixed_e2e.log" 2>&1; then
      ok "the mixed room end to end: $(grep -E '^MIXED E2E' "$WORK/mixed_e2e.log" | tail -1)"
    else
      bad "the mixed room end to end (log: $WORK/mixed_e2e.log)"; grep -Ev '^\s*$' "$WORK/mixed_e2e.log" | tail -8 | sed 's/^/    /'
    fi
    if LIVE_PY="$PY" bash "$HERE/live_stand_e2e.sh" "$PGRST" "$DB" > "$WORK/stand_e2e_mixed.log" 2>&1; then
      ok "the stand room end to end after the mixed migration: $(grep -E '^STAND E2E' "$WORK/stand_e2e_mixed.log" | tail -1)"
    else
      bad "the stand room end to end after the mixed migration (log: $WORK/stand_e2e_mixed.log)"
      grep -Ev '^\s*$' "$WORK/stand_e2e_mixed.log" | tail -8 | sed 's/^/    /'
    fi
  fi
  [ "$(fingerprint)" = "$FMIXED" ] && ok "the catalog unchanged by the mixed runs" || bad "the mixed runs changed the catalog"
  step "mixed rollback" "$MDOWN"
  [ "$(fingerprint)" = "$FPRE" ] && ok "after the mixed rollback: the catalog before it (fingerprint)" \
    || bad "after the mixed rollback: another catalog than before it"
  step "mixed rollback again (re-runnable)" "$MDOWN"
  [ "$(fingerprint)" = "$FPRE" ] && ok "after the second mixed rollback: still the catalog before it" || bad "after the second mixed rollback: another catalog"
  if run "$MCONTRACT"; then bad "live_mixed.sql passes after its rollback"; else ok "live_mixed.sql fails after its rollback"; fi
  step "contract: live_stand.sql after the mixed rollback" "$SCONTRACT"
  step "contract: live_game.sql after the mixed rollback" "$CONTRACT"
  behave "the stand's behaviour after the mixed rollback" "$SBEHAVIOUR" 'LIVE STAND BEHAVIOUR PASSED'
  behave "the battle's behaviour after the mixed rollback" "$BEHAVIOUR" 'LIVE GAME BEHAVIOUR PASSED'
  step "mixed migration after its rollback" "$MMIG"
  [ "$(fingerprint)" = "$FMIXED" ] && ok "the same catalog as the first mixed apply" || bad "another catalog than the first mixed apply"
  step "contract: live_mixed.sql again" "$MCONTRACT"
  behave "mixed behaviour again" "$MBEHAVIOUR" 'LIVE MIXED BEHAVIOUR PASSED'
fi

echo "ok: $OKS, failures: $FAILS"
if [ $FAILS = 0 ]; then echo "LIVE GAME CHECKS PASSED"; fi
[ $FAILS = 0 ]
