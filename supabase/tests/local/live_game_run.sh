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
# mirror, its rollback back to the stand's catalog) → the PIN stage: 20261025090000_live_pin.sql (the phone's PIN step:
# live_join with the empty name, answered as data) the same way (its contract tests/live_pin.sql, live_pin_behaviour.sql,
# every live contract and behaviour above still green, real.ts with live_pin end to end, its rollback back to the
# catalog before it, applied again) → the pictures stage: 20261030090000_live_pictures.sql (the battle takes 5–6 options and
# pictures; quiz_live_media_paths) the same way (tests/live_pictures.sql, live_pictures_behaviour.sql, every live contract and
# behaviour above still green, its rollback back to the PIN stage's catalog, applied again) → the wide rounds stage
# (20261031090000_live_wide_rounds.sql) → the kinds and teams stage: 20261102090000_live_kinds_teams.sql (several right
# answers, text answers, teams, the review's explanations, live_practice) the same way (tests/live_kinds_teams.sql,
# live_kinds_teams_behaviour.sql, every live contract and behaviour above still green, the share against the Python
# mirror, the mixed room end to end, its rollback back to the wide rounds stage's catalog, applied again) → the numbers
# stage: the rest of the live order before it (release 47's and 48's other migrations, the question kinds among them),
# then 20261102090100_live_numbers.sql (number questions in a battle) the same way (tests/live_numbers.sql,
# live_numbers_behaviour.sql, every live contract and behaviour above still green, the reading of a typed number against
# public.meldy_number_right on contracts/kinds/number_vectors.json, its rollback back to the step before, applied again)
# → the ranges stage: 20261102090200_live_ranges.sql (a number on a movement round's place played as ranges) the same
# way (tests/live_ranges.sql, live_ranges_behaviour.sql, every live contract and behaviour above still green — the two
# numbers checks it changes on purpose adapted —, the mixed and the stand rooms end to end, its rollback, applied again).
# The last line is LIVE GAME CHECKS PASSED and the exit code 0 only when every step is green.
# Env (optional): LIVE_PG_PORT (54460), LIVE_WORK (${TMPDIR:-/tmp}/meldy-live-game), PG_BIN (/usr/lib/postgresql/16/bin),
# LIVE_PGRST (a PostgREST 12 binary), LIVE_PGRST_PORT (54461), LIVE_E2E=0 skips the end-to-end stages, LIVE_STAND=0 the
# stand stage, LIVE_MIXED=0 the mixed stage, LIVE_PIN=0 the PIN stage, LIVE_PICTURES=0 the pictures stage, LIVE_WIDE=0 the wide rounds stage, LIVE_KINDS=0 the kinds and teams stage, LIVE_NUMBERS=0 the numbers stage, LIVE_RANGES=0 the ranges stage, LIVE_PHONE_MIG (20261023090000_live_stand_phone.sql by default, applied
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

# ─── The phone's PIN step (20261025090000_live_pin.sql) on top of whatever the stages above left applied ───
# live_pin is live_join with the empty name, its refusal returned as data (200). Its contract fails before it; applied
# twice (the same catalog); its contract and every live contract applied so far still hold (live_game.sql, and
# live_stand.sql, live_stand_phone.sql, live_mixed.sql when applied; telegram_bot.sql); live_pin_behaviour.sql (each
# answer against the old check, nothing written but a take-back); the behaviours above unchanged; real.ts end to end
# with LIVE_E2E_PIN=1 (rpc/live_pin answers 200, the client never calls live_join for the check); the rollback twice
# (the catalog before it); applied again, so the database is left with it (frontend/scripts/mixed-local.mjs uses it).
# LIVE_PIN=0 skips the stage.
if [ "${LIVE_PIN:-1}" = 0 ]; then
  echo "  skip  the PIN stage (LIVE_PIN=0)"
else
  PMIG=$SB/migrations/20261025090000_live_pin.sql
  PDOWN=$SB/rollback/20261025090000_live_pin_down.sql
  PCONTRACT=$SB/tests/live_pin.sql
  PBEHAVIOUR=$HERE/live_pin_behaviour.sql
  has() { [ "$(q "select pg_catalog.to_regprocedure('$1') is not null")" = t ]; }
  # The live contracts that apply to this database (each stage's own, as far as it was applied).
  live_contracts() {
    step "contract: live_game.sql $1" "$CONTRACT"
    if has 'public.live_stand_close(uuid,text,integer,jsonb)'; then step "contract: live_stand.sql $1" "$SB/tests/live_stand.sql"; fi
    if [ "$(q "select pg_catalog.strpos(p.prosrc, 'tophat') > 0 from pg_catalog.pg_proc p
                where p.oid = 'meldy_private.live_look_check(jsonb,text[])'::regprocedure")" = t ]; then
      step "contract: live_stand_phone.sql $1" "$SB/tests/live_stand_phone.sql"
    fi
    if has 'meldy_private.live_stand_round(integer,integer,integer)'; then step "contract: live_mixed.sql $1" "$SB/tests/live_mixed.sql"; fi
    contract_ok "contract: telegram_bot.sql $1" "$SB/tests/telegram_bot.sql"
  }
  live_behaviours() {
    behave "the battle's behaviour $1" "$BEHAVIOUR" 'LIVE GAME BEHAVIOUR PASSED'
    if has 'public.live_stand_close(uuid,text,integer,jsonb)'; then
      behave "the stand's behaviour $1" "$HERE/live_stand_behaviour.sql" 'LIVE STAND BEHAVIOUR PASSED'
    fi
    if has 'meldy_private.live_stand_round(integer,integer,integer)'; then
      behave "the mixed behaviour $1" "$HERE/live_mixed_behaviour.sql" 'LIVE MIXED BEHAVIOUR PASSED'
    fi
  }
  FNOPIN=$(fingerprint)
  if run "$PCONTRACT"; then bad "live_pin.sql passes before its migration (it tests nothing)"; else ok "live_pin.sql fails before its migration"; fi
  if passes "$PBEHAVIOUR" 'LIVE PIN BEHAVIOUR PASSED' >/dev/null; then
    bad "live_pin_behaviour passes before its migration (it tests nothing)"
  else
    ok "live_pin_behaviour fails before its migration"
  fi
  step "PIN migration, first apply" "$PMIG"
  FPIN=$(fingerprint)
  [ "$FPIN" != "$FNOPIN" ] && ok "the PIN migration changed the catalog" || bad "the PIN migration changed nothing"
  step "PIN migration, second apply (re-runnable)" "$PMIG"
  [ "$(fingerprint)" = "$FPIN" ] && ok "a second PIN apply changes nothing in the catalog" || bad "a second PIN apply changed the catalog"
  step "contract: live_pin.sql (catalog, grants, what it relies on in live_join, pure calls)" "$PCONTRACT"
  live_contracts "still holds"
  behave "PIN behaviour: open, wrong PIN, taken back by token and account, kicked, members only, finished, due moves, limits" \
    "$PBEHAVIOUR" 'LIVE PIN BEHAVIOUR PASSED'
  live_behaviours "unchanged after the PIN migration"
  if [ "${LIVE_E2E:-1}" = 0 ]; then
    echo "  skip  end to end with live_pin (LIVE_E2E=0)"
  elif [ -z "$PGRST" ] || [ ! -x "$PGRST" ]; then
    echo "  skip  end to end with live_pin: no PostgREST binary (LIVE_PGRST)"
  elif LIVE_E2E_PIN=1 bash "$HERE/live_game_e2e.sh" "$PGRST" "$DB" > "$WORK/e2e_pin.log" 2>&1; then
    ok "end to end: real.ts with live_pin through PostgREST ($(grep -E 'Tests +[0-9]+ passed' "$WORK/e2e_pin.log" | head -1 | sed 's/^ *//'))"
  else
    bad "end to end: real.ts with live_pin through PostgREST (log: $WORK/e2e_pin.log)"; grep -E 'FAIL|Error|×|expected' "$WORK/e2e_pin.log" | head -8 | sed 's/^/    /'
  fi
  [ "$(fingerprint)" = "$FPIN" ] && ok "the catalog unchanged by the PIN runs" || bad "the PIN runs changed the catalog"
  step "PIN rollback" "$PDOWN"
  [ "$(fingerprint)" = "$FNOPIN" ] && ok "after the PIN rollback: the catalog before it (fingerprint)" \
    || bad "after the PIN rollback: another catalog than before it"
  step "PIN rollback again (re-runnable)" "$PDOWN"
  [ "$(fingerprint)" = "$FNOPIN" ] && ok "after the second PIN rollback: still the catalog before it" || bad "after the second PIN rollback: another catalog"
  if run "$PCONTRACT"; then bad "live_pin.sql passes after its rollback"; else ok "live_pin.sql fails after its rollback"; fi
  live_contracts "after the PIN rollback"
  step "PIN migration after its rollback" "$PMIG"
  [ "$(fingerprint)" = "$FPIN" ] && ok "the same catalog as the first PIN apply" || bad "another catalog than the first PIN apply"
  step "contract: live_pin.sql again" "$PCONTRACT"
  behave "PIN behaviour again" "$PBEHAVIOUR" 'LIVE PIN BEHAVIOUR PASSED'
fi


# ─── Real tests in the battle: 5–6 options and pictures (20261030090000_live_pictures.sql) on top of the PIN step ───
# A battle without movement rounds takes one right option of 2–6 and pictures (question.pictures, the review's pictures,
# quiz_live_media_paths for the quiz-media function); a stand game and a mixed game keep the old rule. Its contract and
# behaviour fail before it; applied twice (the same catalog); its contract and every live contract still hold;
# live_pictures_behaviour.sql; the stand, mixed and PIN behaviours unchanged; the battle's behaviour unchanged once its
# two questions that played no part before (five options; a picture) are made unplayable under the new rule too (seven
# options; two right ones) — every one of its assertions holds; the rollback twice (the catalog before it); applied again.
# LIVE_PICTURES=0 skips the stage.
if [ "${LIVE_PICTURES:-1}" = 0 ]; then
  echo "  skip  the pictures stage (LIVE_PICTURES=0)"
else
  XMIG=$SB/migrations/20261030090000_live_pictures.sql
  XDOWN=$SB/rollback/20261030090000_live_pictures_down.sql
  XCONTRACT=$SB/tests/live_pictures.sql
  XBEHAVIOUR=$HERE/live_pictures_behaviour.sql
  OLD_BATTLE=$WORK/live_game_behaviour_wide.sql
  sed -e "s/'Пять вариантов', 'options', jsonb_build_array('1', '2', '3', '4', '5')/'Пять вариантов', 'options', jsonb_build_array('1', '2', '3', '4', '5', '6', '7')/" \
      -e "s/'С картинкой', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0),/'С картинкой', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0, 1),/" \
      "$BEHAVIOUR" > "$OLD_BATTLE"
  [ "$(grep -c "jsonb_build_array('1', '2', '3', '4', '5', '6', '7')\|'correct', jsonb_build_array(0, 1),$" "$OLD_BATTLE")" -ge 2 ] \
    && ok "the battle's behaviour for the wide rule: its two idle questions made unplayable" \
    || bad "the battle's behaviour for the wide rule: the two questions were not found"
  has() { [ "$(q "select pg_catalog.to_regprocedure('$1') is not null")" = t ]; }
  pic_contracts() {
    step "contract: live_game.sql $1" "$CONTRACT"
    if has 'public.live_stand_close(uuid,text,integer,jsonb)'; then step "contract: live_stand.sql $1" "$SB/tests/live_stand.sql"; fi
    if [ "$(q "select pg_catalog.strpos(p.prosrc, 'tophat') > 0 from pg_catalog.pg_proc p
                where p.oid = 'meldy_private.live_look_check(jsonb,text[])'::regprocedure")" = t ]; then
      step "contract: live_stand_phone.sql $1" "$SB/tests/live_stand_phone.sql"
    fi
    if has 'meldy_private.live_stand_round(integer,integer,integer)'; then step "contract: live_mixed.sql $1" "$SB/tests/live_mixed.sql"; fi
    if has 'public.live_pin(text,text)'; then step "contract: live_pin.sql $1" "$SB/tests/live_pin.sql"; fi
    contract_ok "contract: telegram_bot.sql $1" "$SB/tests/telegram_bot.sql"
  }
  pic_behaviours() {
    # the end-to-end runs above commit real joins; the battle's behaviour counts exactly its own 121 throttle rows
    q "delete from meldy_private.live_join_hits" >/dev/null
    behave "the battle's behaviour $1" "$OLD_BATTLE" 'LIVE GAME BEHAVIOUR PASSED'
    behave "the stand's behaviour $1" "$HERE/live_stand_behaviour.sql" 'LIVE STAND BEHAVIOUR PASSED'
    behave "the mixed behaviour $1" "$HERE/live_mixed_behaviour.sql" 'LIVE MIXED BEHAVIOUR PASSED'
    if has 'public.live_pin(text,text)'; then behave "the PIN behaviour $1" "$HERE/live_pin_behaviour.sql" 'LIVE PIN BEHAVIOUR PASSED'; fi
  }
  FNOPIC=$(fingerprint)
  if run "$XCONTRACT"; then bad "live_pictures.sql passes before its migration (it tests nothing)"; else ok "live_pictures.sql fails before its migration"; fi
  if passes "$XBEHAVIOUR" 'LIVE PICTURES BEHAVIOUR PASSED' >/dev/null; then
    bad "live_pictures_behaviour passes before its migration (it tests nothing)"
  else
    ok "live_pictures_behaviour fails before its migration"
  fi
  pic_behaviours "before the pictures migration"
  step "pictures migration, first apply" "$XMIG"
  FPIC=$(fingerprint)
  [ "$FPIC" != "$FNOPIC" ] && ok "the pictures migration changed the catalog" || bad "the pictures migration changed nothing"
  step "pictures migration, second apply (re-runnable)" "$XMIG"
  [ "$(fingerprint)" = "$FPIC" ] && ok "a second pictures apply changes nothing in the catalog" || bad "a second pictures apply changed the catalog"
  step "contract: live_pictures.sql (checks, column, trigger, rule, screens, quiz_live_media_paths)" "$XCONTRACT"
  pic_contracts "still holds"
  behave "pictures behaviour: 5–6 options, pictures in shown order, who may read them and when, stand and mixed unchanged" \
    "$XBEHAVIOUR" 'LIVE PICTURES BEHAVIOUR PASSED'
  pic_behaviours "unchanged after the pictures migration"
  [ "$(fingerprint)" = "$FPIC" ] && ok "the catalog unchanged by the pictures runs" || bad "the pictures runs changed the catalog"
  step "pictures rollback" "$XDOWN"
  [ "$(fingerprint)" = "$FNOPIC" ] && ok "after the pictures rollback: the catalog before it (fingerprint)" \
    || bad "after the pictures rollback: another catalog than before it"
  step "pictures rollback again (re-runnable)" "$XDOWN"
  [ "$(fingerprint)" = "$FNOPIC" ] && ok "after the second pictures rollback: still the catalog before it" || bad "after the second pictures rollback: another catalog"
  if run "$XCONTRACT"; then bad "live_pictures.sql passes after its rollback"; else ok "live_pictures.sql fails after its rollback"; fi
  pic_contracts "after the pictures rollback"
  step "pictures migration after its rollback" "$XMIG"
  [ "$(fingerprint)" = "$FPIC" ] && ok "the same catalog as the first pictures apply" || bad "another catalog than the first pictures apply"
  step "contract: live_pictures.sql again" "$XCONTRACT"
  behave "pictures behaviour again" "$XBEHAVIOUR" 'LIVE PICTURES BEHAVIOUR PASSED'
fi

# ─── Real tests in every game: the wide rule for the movement rounds and «Встань на ответ» ───
# 20261031090000_live_wide_rounds.sql on top of the pictures step: live_create draws one right option of 2–6 with pictures
# for every game (the arena has six zones). Checked the same way: its contract (tests/live_wide_rounds.sql) fails before
# and after its rollback; applied twice to one catalog; the pictures behaviour with the stand and mixed draws taking the
# wide questions too (live_wide_rounds_behaviour.sql, made from live_pictures_behaviour.sql); every live contract, the
# battle's, the stand's, the mixed and the PIN behaviours unchanged; rolled back to the pictures step's catalog, applied
# again. LIVE_WIDE=0 skips the stage.
if [ "${LIVE_WIDE:-1}" = 0 ] || [ "${LIVE_PICTURES:-1}" = 0 ]; then
  echo "  skip  the wide rounds stage (LIVE_WIDE=0 or LIVE_PICTURES=0)"
else
  WMIG=$SB/migrations/20261031090000_live_wide_rounds.sql
  WDOWN=$SB/rollback/20261031090000_live_wide_rounds_down.sql
  WCONTRACT=$SB/tests/live_wide_rounds.sql
  WBEHAVIOUR=$WORK/live_wide_rounds_behaviour.sql
  WCLOSE=$HERE/live_wide_close_behaviour.sql
  sed -e "s/perform pg_temp.eq('stand: the four-option question only', (r ->> 'q_count') || '\/' || (r ->> 'skipped'), '1\/4');/perform pg_temp.eq('stand: five, six and four options play', (r ->> 'q_count') || '\/' || (r ->> 'skipped'), '3\/2');/" \
      -e "s/perform pg_temp.eq('mixed: the four-option question only', (r ->> 'q_count') || '\/' || (r ->> 'skipped'), '1\/4');/perform pg_temp.eq('mixed: five, six and four options play', (r ->> 'q_count') || '\/' || (r ->> 'skipped'), '3\/2');/" \
      -e "s/LIVE PICTURES BEHAVIOUR PASSED/LIVE WIDE ROUNDS BEHAVIOUR PASSED/" \
      "$XBEHAVIOUR" > "$WBEHAVIOUR"
  [ "$(grep -c "options play', (r ->> 'q_count')" "$WBEHAVIOUR")" = 3 ] \
    && ok "the wide rounds behaviour: the stand and mixed draws expect the wide questions" \
    || bad "the wide rounds behaviour: the stand and mixed draws were not found"
  if run "$WCONTRACT"; then bad "live_wide_rounds.sql passes before its migration (it tests nothing)"; else ok "live_wide_rounds.sql fails before its migration"; fi
  if passes "$WBEHAVIOUR" 'LIVE WIDE ROUNDS BEHAVIOUR PASSED' >/dev/null; then
    bad "live_wide_rounds_behaviour passes before its migration (it tests nothing)"
  else
    ok "live_wide_rounds_behaviour fails before its migration"
  fi
  if passes "$WCLOSE" 'LIVE WIDE CLOSE BEHAVIOUR PASSED' >/dev/null; then
    bad "live_wide_close_behaviour passes before its migration (it tests nothing)"
  else
    ok "live_wide_close_behaviour fails before its migration"
  fi
  FNOWIDE=$(fingerprint)
  step "wide rounds migration, first apply" "$WMIG"
  FWIDE=$(fingerprint)
  [ "$FWIDE" != "$FNOWIDE" ] && ok "the wide rounds migration changed the catalog" || bad "the wide rounds migration changed nothing"
  step "wide rounds migration, second apply (re-runnable)" "$WMIG"
  [ "$(fingerprint)" = "$FWIDE" ] && ok "a second wide rounds apply changes nothing in the catalog" || bad "a second wide rounds apply changed the catalog"
  step "contract: live_wide_rounds.sql (every game draws with the wide rule)" "$WCONTRACT"
  step "contract: live_pictures.sql still holds" "$XCONTRACT"
  pic_contracts "still holds after the wide rounds migration"
  behave "wide rounds behaviour: the stand and mixed games take five and six options, the pictures as in the battle" \
    "$WBEHAVIOUR" 'LIVE WIDE ROUNDS BEHAVIOUR PASSED'
  behave "wide rounds behaviour: a round's write takes the zones Д and Е, never past the options" \
    "$WCLOSE" 'LIVE WIDE CLOSE BEHAVIOUR PASSED'
  pic_behaviours "unchanged after the wide rounds migration"
  [ "$(fingerprint)" = "$FWIDE" ] && ok "the catalog unchanged by the wide rounds runs" || bad "the wide rounds runs changed the catalog"
  step "wide rounds rollback" "$WDOWN"
  [ "$(fingerprint)" = "$FNOWIDE" ] && ok "after the wide rounds rollback: the pictures step's catalog (fingerprint)" \
    || bad "after the wide rounds rollback: another catalog than the pictures step's"
  step "wide rounds rollback again (re-runnable)" "$WDOWN"
  [ "$(fingerprint)" = "$FNOWIDE" ] && ok "after the second wide rounds rollback: still the pictures step's catalog" || bad "after the second wide rounds rollback: another catalog"
  if run "$WCONTRACT"; then bad "live_wide_rounds.sql passes after its rollback"; else ok "live_wide_rounds.sql fails after its rollback"; fi
  step "contract: live_pictures.sql after the wide rounds rollback" "$XCONTRACT"
  step "wide rounds migration after its rollback" "$WMIG"
  [ "$(fingerprint)" = "$FWIDE" ] && ok "the same catalog as the first wide rounds apply" || bad "another catalog than the first wide rounds apply"
  step "contract: live_wide_rounds.sql again" "$WCONTRACT"
  behave "wide rounds behaviour again" "$WBEHAVIOUR" 'LIVE WIDE ROUNDS BEHAVIOUR PASSED'
fi

# ─── Several right answers, text answers, teams, the review, «Тренировать ошибки» (20261102090000_live_kinds_teams.sql) ───
# On top of the wide rounds step. Its contract (tests/live_kinds_teams.sql) and behaviour (live_kinds_teams_behaviour.sql:
# a battle of every kind in two teams, the review with explanations, live_practice, a battle with movement rounds and
# «Встань на ответ») fail before it; applied twice (one catalog); every live contract still holds; the older behaviours
# hold before and after it once their questions that played no part before (two right options or more, a text answer)
# are made unplayable under the new rule too (seven options) — every one of their assertions; the share against
# backend/live_move_mixed.py; the mixed room end to end; the rollback twice (the wide rounds step's catalog); applied
# again. LIVE_KINDS=0 skips the stage.
if [ "${LIVE_KINDS:-1}" = 0 ] || [ "${LIVE_WIDE:-1}" = 0 ] || [ "${LIVE_PICTURES:-1}" = 0 ]; then
  echo "  skip  the kinds and teams stage (LIVE_KINDS=0, LIVE_WIDE=0 or LIVE_PICTURES=0)"
else
  KMIG=$SB/migrations/20261102090000_live_kinds_teams.sql
  KDOWN=$SB/rollback/20261102090000_live_kinds_teams_down.sql
  KCONTRACT=$SB/tests/live_kinds_teams.sql
  KBEHAVIOUR=$HERE/live_kinds_teams_behaviour.sql
  KBATTLE=$WORK/live_game_behaviour_kinds.sql
  KWIDE=$WORK/live_wide_rounds_behaviour_kinds.sql
  KCLOSE=$WORK/live_wide_close_behaviour_kinds.sql
  sed -e "s/'Несколько верных', 'options', jsonb_build_array('a', 'b', 'c'), 'correct'/'Несколько верных', 'options', jsonb_build_array('a', 'b', 'c', 'd', 'e', 'f', 'g'), 'correct'/" \
      -e "s/'Столица Франции', 'answers', jsonb_build_array('Париж')/'Столица Франции', 'options', jsonb_build_array('1', '2', '3', '4', '5', '6', '7'), 'correct', jsonb_build_array(0)/" \
      -e "s/'С картинкой', 'options', jsonb_build_array('да', 'нет'), 'correct', jsonb_build_array(0, 1),/'С картинкой', 'options', jsonb_build_array('да', 'нет', '3', '4', '5', '6', '7'), 'correct', jsonb_build_array(0, 1),/" \
      -e "s/'Только несколько', 'options', jsonb_build_array('a', 'b'), 'correct'/'Только несколько', 'options', jsonb_build_array('a', 'b', 'c', 'd', 'e', 'f', 'g'), 'correct'/" \
      "$OLD_BATTLE" > "$KBATTLE"
  for pair in "$WBEHAVIOUR:$KWIDE" "$WCLOSE:$KCLOSE"; do
    sed -e "s/'Два верных', 'options', jsonb_build_array('a', 'b', 'c', 'd', 'e'), 'correct'/'Два верных', 'options', jsonb_build_array('a', 'b', 'c', 'd', 'e', 'f', 'g'), 'correct'/" \
      "${pair%%:*}" > "${pair##*:}"
  done
  KFOUND=0
  for k in "'Несколько верных', 'options', jsonb_build_array('a', 'b', 'c', 'd', 'e', 'f', 'g')" \
           "'Столица Франции', 'options', jsonb_build_array('1', '2', '3', '4', '5', '6', '7')" \
           "'С картинкой', 'options', jsonb_build_array('да', 'нет', '3', '4', '5', '6', '7')" \
           "'Только несколько', 'options', jsonb_build_array('a', 'b', 'c', 'd', 'e', 'f', 'g')"; do
    [ "$(grep -cF "$k" "$KBATTLE")" = 1 ] && KFOUND=$((KFOUND + 1))
  done
  [ $KFOUND = 4 ] \
    && [ "$(grep -cF "'Два верных', 'options', jsonb_build_array('a', 'b', 'c', 'd', 'e', 'f', 'g')" "$KWIDE" "$KCLOSE" | grep -c ':1$')" = 2 ] \
    && ok "the older behaviours for the new rule: their questions of several right answers and text answers made unplayable" \
    || bad "the older behaviours for the new rule: the questions were not found"
  kind_contracts() {
    pic_contracts "$1"
    step "contract: live_pictures.sql $1" "$XCONTRACT"
    step "contract: live_wide_rounds.sql $1" "$WCONTRACT"
  }
  kind_behaviours() {
    q "delete from meldy_private.live_join_hits" >/dev/null
    behave "the battle's behaviour $1" "$KBATTLE" 'LIVE GAME BEHAVIOUR PASSED'
    behave "the stand's behaviour $1" "$HERE/live_stand_behaviour.sql" 'LIVE STAND BEHAVIOUR PASSED'
    behave "the mixed behaviour $1" "$HERE/live_mixed_behaviour.sql" 'LIVE MIXED BEHAVIOUR PASSED'
    behave "the PIN behaviour $1" "$HERE/live_pin_behaviour.sql" 'LIVE PIN BEHAVIOUR PASSED'
    behave "the wide rounds behaviour $1" "$KWIDE" 'LIVE WIDE ROUNDS BEHAVIOUR PASSED'
    behave "the wide close behaviour $1" "$KCLOSE" 'LIVE WIDE CLOSE BEHAVIOUR PASSED'
  }
  FNOKIND=$(fingerprint)
  if run "$KCONTRACT"; then bad "live_kinds_teams.sql passes before its migration (it tests nothing)"; else ok "live_kinds_teams.sql fails before its migration"; fi
  if passes "$KBEHAVIOUR" 'LIVE KINDS TEAMS BEHAVIOUR PASSED' >/dev/null; then
    bad "live_kinds_teams_behaviour passes before its migration (it tests nothing)"
  else
    ok "live_kinds_teams_behaviour fails before its migration"
  fi
  kind_behaviours "before the kinds and teams migration"
  step "kinds and teams migration, first apply" "$KMIG"
  FKIND=$(fingerprint)
  [ "$FKIND" != "$FNOKIND" ] && ok "the kinds and teams migration changed the catalog" || bad "the kinds and teams migration changed nothing"
  step "kinds and teams migration, second apply (re-runnable)" "$KMIG"
  [ "$(fingerprint)" = "$FKIND" ] && ok "a second kinds and teams apply changes nothing in the catalog" || bad "a second kinds and teams apply changed the catalog"
  step "contract: live_kinds_teams.sql (columns, checks, the team trigger, create, the close, the new functions, the numbers)" "$KCONTRACT"
  kind_contracts "still holds after the kinds and teams migration"
  behave "kinds and teams behaviour: every kind in two teams, the review, practice, a mixed and a stand game" \
    "$KBEHAVIOUR" 'LIVE KINDS TEAMS BEHAVIOUR PASSED'
  kind_behaviours "unchanged after the kinds and teams migration"
  PY=${LIVE_PY:-python3}
  SH_PY=$(cd "$ROOT/backend" && "$PY" -c "
import hashlib, itertools, live_move_mixed as m
sets = [list(c) for n in range(1, 7) for c in itertools.combinations(range(6), n)]
v = [repr(m.share(p, k)) for k in sets if len(k) >= 2 for p in sets]
print(str(len(v)) + ':' + hashlib.md5(','.join(v).encode()).hexdigest())" 2>&1)
  SH_SQL=$(q "with s as (select array_agg(x order by x)::smallint[] as a, min(m) as o from (select m, x from generate_series(1, 63) m,
                         generate_series(0, 5) x where m & (1 << x) > 0) y group by m),
                   o as (select a, row_number() over (order by cardinality(a), a::text) as n from s)
              select count(*) || ':' || md5(string_agg(case when sh = floor(sh) then (sh::numeric)::text || '.0' else sh::text end, ',' order by k.n, p.n))
                from o k, o p, lateral (select meldy_private.live_share(p.a, k.a) as sh) z where cardinality(k.a) >= 2" 2>&1)
  if [ -n "$SH_PY" ] && [ "$SH_PY" = "$SH_SQL" ]; then
    ok "the mirror: live_move_mixed.py share and the SQL agree on every tick of six options ($(echo "$SH_PY" | cut -d: -f1) cases)"
  else
    bad "the mirror of the share: Python $SH_PY, SQL $SH_SQL"
  fi
  if [ "${LIVE_E2E:-1}" = 0 ]; then
    echo "  skip  the mixed room end to end after the kinds and teams migration (LIVE_E2E=0)"
  elif [ -z "$PGRST" ] || [ ! -x "$PGRST" ] || ! "$PY" -c "import fastapi, uvicorn, websockets, httpx" 2>/dev/null; then
    echo "  skip  the mixed room end to end after the kinds and teams migration: needs LIVE_PGRST and LIVE_PY"
  elif LIVE_PY="$PY" bash "$HERE/live_mixed_e2e.sh" "$PGRST" "$DB" > "$WORK/mixed_e2e_kinds.log" 2>&1; then
    ok "the mixed room end to end after the kinds and teams migration: $(grep -E '^MIXED E2E' "$WORK/mixed_e2e_kinds.log" | tail -1)"
  else
    bad "the mixed room end to end after the kinds and teams migration (log: $WORK/mixed_e2e_kinds.log)"
    grep -Ev '^\s*$' "$WORK/mixed_e2e_kinds.log" | tail -8 | sed 's/^/    /'
  fi
  [ "$(fingerprint)" = "$FKIND" ] && ok "the catalog unchanged by the kinds and teams runs" || bad "the kinds and teams runs changed the catalog"
  step "kinds and teams rollback" "$KDOWN"
  [ "$(fingerprint)" = "$FNOKIND" ] && ok "after the kinds and teams rollback: the wide rounds step's catalog (fingerprint)" \
    || bad "after the kinds and teams rollback: another catalog than the wide rounds step's"
  step "kinds and teams rollback again (re-runnable)" "$KDOWN"
  [ "$(fingerprint)" = "$FNOKIND" ] && ok "after the second kinds and teams rollback: still the wide rounds step's catalog" \
    || bad "after the second kinds and teams rollback: another catalog"
  if run "$KCONTRACT"; then bad "live_kinds_teams.sql passes after its rollback"; else ok "live_kinds_teams.sql fails after its rollback"; fi
  kind_contracts "after the kinds and teams rollback"
  kind_behaviours "after the kinds and teams rollback"
  step "kinds and teams migration after its rollback" "$KMIG"
  [ "$(fingerprint)" = "$FKIND" ] && ok "the same catalog as the first kinds and teams apply" || bad "another catalog than the first kinds and teams apply"
  step "contract: live_kinds_teams.sql again" "$KCONTRACT"
  behave "kinds and teams behaviour again" "$KBEHAVIOUR" 'LIVE KINDS TEAMS BEHAVIOUR PASSED'
fi

# ─── Number questions (20261102090100_live_numbers.sql) on top of the kinds and teams step ───
# First the rest of the live order before it, as live has it: release 47's and 48's migrations that are not the live
# game's (the quiz protection, «learn left», the recordings' usage, the question kinds 20261101090000–090300 with
# public.meldy_number_right, the debts 20261103090000–090200); every live contract and behaviour still hold on them.
# Then its contract (tests/live_numbers.sql) and behaviour (live_numbers_behaviour.sql: a battle of number questions,
# the review, practice, a mixed and a stand game, a one-answer game's messages) fail before it; applied twice (one
# catalog); every live contract still holds; the older behaviours hold before and after it; live_number_value read
# against public.meldy_number_right on every case of contracts/kinds/number_vectors.json; the rollback twice (the
# catalog before it); applied again. LIVE_NUMBERS=0 skips the stage (it needs the kinds and teams stage).
if [ "${LIVE_NUMBERS:-1}" = 0 ] || [ "${LIVE_KINDS:-1}" = 0 ] || [ "${LIVE_WIDE:-1}" = 0 ] || [ "${LIVE_PICTURES:-1}" = 0 ]; then
  echo "  skip  the numbers stage (LIVE_NUMBERS=0, or a stage it needs skipped)"
else
  NMIG=$SB/migrations/20261102090100_live_numbers.sql
  NDOWN=$SB/rollback/20261102090100_live_numbers_down.sql
  NCONTRACT=$SB/tests/live_numbers.sql
  NBEHAVIOUR=$HERE/live_numbers_behaviour.sql
  NBASE=0
  for f in 20261020120000_quiz_protection.sql 20261021140000_learn_left.sql 20261026090000_recording_usage.sql \
           20261101090000_question_kinds.sql 20261101090100_question_kinds_grading.sql 20261101090200_question_kinds_quiz.sql \
           20261101090300_question_kinds_bot.sql 20261103090000_oral_formula_v2.sql 20261103090100_journal_direct_writes.sql \
           20261103090200_picture_sweep.sql; do
    if run "$SB/migrations/$f"; then NBASE=$((NBASE + 1)); else bad "the live order before the numbers: $f"; fi
  done
  [ $NBASE = 10 ] && ok "the live order before the numbers: the 10 other migrations of releases 47 and 48 (the question kinds among them)"
  number_contracts() {
    kind_contracts "$1"
    step "contract: live_kinds_teams.sql $1" "$KCONTRACT"
  }
  number_behaviours() {
    kind_behaviours "$1"
    behave "kinds and teams behaviour $1" "$KBEHAVIOUR" 'LIVE KINDS TEAMS BEHAVIOUR PASSED'
  }
  number_contracts "on the live order before the numbers"
  number_behaviours "on the live order before the numbers"
  FNONUM=$(fingerprint)
  if run "$NCONTRACT"; then bad "live_numbers.sql passes before its migration (it tests nothing)"; else ok "live_numbers.sql fails before its migration"; fi
  if passes "$NBEHAVIOUR" 'LIVE NUMBERS BEHAVIOUR PASSED' >/dev/null; then
    bad "live_numbers_behaviour passes before its migration (it tests nothing)"
  else
    ok "live_numbers_behaviour fails before its migration"
  fi
  step "numbers migration, first apply" "$NMIG"
  FNUM=$(fingerprint)
  [ "$FNUM" != "$FNONUM" ] && ok "the numbers migration changed the catalog" || bad "the numbers migration changed nothing"
  step "numbers migration, second apply (re-runnable)" "$NMIG"
  [ "$(fingerprint)" = "$FNUM" ] && ok "a second numbers apply changes nothing in the catalog" || bad "a second numbers apply changed the catalog"
  step "contract: live_numbers.sql (columns, checks, the reading, create, the close, what leaves and when)" "$NCONTRACT"
  number_contracts "still holds after the numbers migration"
  behave "numbers behaviour: a battle of number questions, the review, practice, a mixed and a stand game, a one-answer game" \
    "$NBEHAVIOUR" 'LIVE NUMBERS BEHAVIOUR PASSED'
  number_behaviours "unchanged after the numbers migration"
  # the game's reading of a typed number is the number rule's: on every shared case, right ⇔ the value read is within
  # the tolerance of a canonical accepted number, and both give the case's answer
  NVEC=$({ printf '\\set v `cat %q`\n' "$ROOT/contracts/kinds/number_vectors.json"
           cat <<'SQL'
select count(*) || ':' || count(*) filter (where x.ok)
  from (select (meldy_private.live_number_value(c ->> 'text', c ->> 'unit') is not null
                and exists (select 1 from jsonb_array_elements_text(c -> 'answers') a
                             where a ~ '^-?[0-9]+(\.[0-9]+)?$' and char_length(a) <= 40
                               and abs(meldy_private.live_number_value(c ->> 'text', c ->> 'unit') - a::numeric)
                                   <= coalesce((c ->> 'tolerance')::numeric, 0))) = (c ->> 'right')::boolean
               and public.meldy_number_right(c ->> 'text', array(select jsonb_array_elements_text(c -> 'answers')),
                                             (c ->> 'tolerance')::numeric, c ->> 'unit') = (c ->> 'right')::boolean as ok
          from jsonb_array_elements((:'v')::jsonb -> 'cases') c) x;
SQL
         } | "${PSQL[@]}" -d $DB 2>&1)
  if [ -n "$NVEC" ] && [ "${NVEC%%:*}" = "${NVEC##*:}" ] && [ "${NVEC%%:*}" -gt 40 ] 2>/dev/null; then
    ok "the reading of a typed number is the number rule's on every case of number_vectors.json (${NVEC%%:*} cases)"
  else
    bad "the reading of a typed number against number_vectors.json: $NVEC"
  fi
  [ "$(fingerprint)" = "$FNUM" ] && ok "the catalog unchanged by the numbers runs" || bad "the numbers runs changed the catalog"
  step "numbers rollback" "$NDOWN"
  [ "$(fingerprint)" = "$FNONUM" ] && ok "after the numbers rollback: the catalog before it (fingerprint)" \
    || bad "after the numbers rollback: another catalog than before it"
  step "numbers rollback again (re-runnable)" "$NDOWN"
  [ "$(fingerprint)" = "$FNONUM" ] && ok "after the second numbers rollback: still the catalog before it" || bad "after the second numbers rollback: another catalog"
  if run "$NCONTRACT"; then bad "live_numbers.sql passes after its rollback"; else ok "live_numbers.sql fails after its rollback"; fi
  number_contracts "after the numbers rollback"
  number_behaviours "after the numbers rollback"
  step "numbers migration after its rollback" "$NMIG"
  [ "$(fingerprint)" = "$FNUM" ] && ok "the same catalog as the first numbers apply" || bad "another catalog than the first numbers apply"
  step "contract: live_numbers.sql again" "$NCONTRACT"
  behave "numbers behaviour again" "$NBEHAVIOUR" 'LIVE NUMBERS BEHAVIOUR PASSED'
fi

# ─── A number on a movement round's place, played as ranges (20261102090200_live_ranges.sql) on top of the numbers step ───
# Its contract (tests/live_ranges.sql) and behaviour (live_ranges_behaviour.sql: the ranges at their boundaries and a
# sweep, a battle whose round draws a number as ranges, «Встань на ответ» of numbers, practice, a battle without rounds)
# fail before it; applied twice (one catalog); every live contract and behaviour still holds — the numbers step's own
# two checks of «a number only where a text answer may» (live_more in «Встань на ответ», live_arrange keeping numbers
# off the rounds) and its section 6 (the games those checks played) are what this migration changes on purpose: they
# run adapted (the ranges behaviour plays those games under the new rule); the mixed and the stand rooms end to end;
# the rollback twice (the numbers step's catalog); applied again. LIVE_RANGES=0 skips the stage.
if [ "${LIVE_RANGES:-1}" = 0 ] || [ "${LIVE_NUMBERS:-1}" = 0 ] || [ "${LIVE_KINDS:-1}" = 0 ] || [ "${LIVE_WIDE:-1}" = 0 ] || [ "${LIVE_PICTURES:-1}" = 0 ]; then
  echo "  skip  the ranges stage (LIVE_RANGES=0, or a stage it needs skipped)"
else
  RMIG=$SB/migrations/20261102090200_live_ranges.sql
  RDOWN=$SB/rollback/20261102090200_live_ranges_down.sql
  RCONTRACT=$SB/tests/live_ranges.sql
  RBEHAVIOUR=$HERE/live_ranges_behaviour.sql
  NCONTRACT_R=$WORK/live_numbers_ranges.sql
  NBEHAVIOUR_R=$WORK/live_numbers_behaviour_ranges.sql
  sed -e "s/ OR meldy_private.live_more(v_item, false) IS NOT NULL THEN/ THEN/" \
      -e "/OR pg_catalog.strpos(v_src, 'pg_catalog.array_agg(i.kind in (''short'', ''number'') order by x.ord)') = 0 THEN/{s/^     OR /     OR /;s/ OR pg_catalog.strpos(v_src, 'pg_catalog.array_agg(i.kind in (''short'', ''number'') order by x.ord)') = 0 THEN/ THEN/}" \
      "$NCONTRACT" > "$NCONTRACT_R"
  sed -e "/live_more: no number in «Встань на ответ»/d" -e "/^-- ─── 6\. A battle with movement rounds: a number never stands on a round/,/^-- ─── 7\./{/^-- ─── 7\./!d}" \
      "$NBEHAVIOUR" > "$NBEHAVIOUR_R"
  if [ "$(grep -c "live_more(v_item, false) IS NOT NULL\|array_agg(i.kind in (''short'', ''number'')" "$NCONTRACT_R")" = 0 ] \
     && [ "$(grep -c "live_more(v_item, false) IS NOT NULL\|array_agg(i.kind in (''short'', ''number'')" "$NCONTRACT")" = 2 ] \
     && [ "$(grep -c "no number in «Встань на ответ»\|^-- ─── 6\." "$NBEHAVIOUR_R")" = 0 ] \
     && [ "$(wc -l < "$NBEHAVIOUR")" -gt "$(wc -l < "$NBEHAVIOUR_R")" ] && [ "$(grep -c '^-- ─── 7\.' "$NBEHAVIOUR_R")" = 1 ]; then
    ok "the numbers step's checks of «a number only where a text answer may» adapted for the ranges (two in its contract, two in its behaviour)"
  else
    bad "the numbers step's superseded checks were not found"
  fi
  range_contracts() {
    number_contracts "$1"
    step "contract: live_numbers.sql (its two superseded checks left out) $1" "$NCONTRACT_R"
  }
  range_behaviours() {
    number_behaviours "$1"
    behave "numbers behaviour (its section 6 left out) $1" "$NBEHAVIOUR_R" 'LIVE NUMBERS BEHAVIOUR PASSED'
  }
  FNORANGE=$(fingerprint)
  if run "$RCONTRACT"; then bad "live_ranges.sql passes before its migration (it tests nothing)"; else ok "live_ranges.sql fails before its migration"; fi
  if passes "$RBEHAVIOUR" 'LIVE RANGES BEHAVIOUR PASSED' >/dev/null; then
    bad "live_ranges_behaviour passes before its migration (it tests nothing)"
  else
    ok "live_ranges_behaviour fails before its migration"
  fi
  step "contract: live_numbers.sql in full before the ranges migration" "$NCONTRACT"
  step "ranges migration, first apply" "$RMIG"
  FRANGE=$(fingerprint)
  [ "$FRANGE" != "$FNORANGE" ] && ok "the ranges migration changed the catalog" || bad "the ranges migration changed nothing"
  step "ranges migration, second apply (re-runnable)" "$RMIG"
  [ "$(fingerprint)" = "$FRANGE" ] && ok "a second ranges apply changes nothing in the catalog" || bad "a second ranges apply changed the catalog"
  step "contract: live_ranges.sql (the column, the checks, the ranges, create, the close, what leaves)" "$RCONTRACT"
  range_contracts "still holds after the ranges migration"
  for i in 1 2 3; do
    behave "ranges behaviour (run $i: the right range's place is drawn at random)" "$RBEHAVIOUR" 'LIVE RANGES BEHAVIOUR PASSED'
  done
  range_behaviours "unchanged after the ranges migration"
  if [ "${LIVE_E2E:-1}" = 0 ]; then
    echo "  skip  the rooms end to end after the ranges migration (LIVE_E2E=0)"
  elif [ -z "$PGRST" ] || [ ! -x "$PGRST" ] || ! "$PY" -c "import fastapi, uvicorn, websockets, httpx" 2>/dev/null; then
    echo "  skip  the rooms end to end after the ranges migration: needs LIVE_PGRST and LIVE_PY"
  else
    if LIVE_PY="$PY" bash "$HERE/live_mixed_e2e.sh" "$PGRST" "$DB" > "$WORK/mixed_e2e_ranges.log" 2>&1; then
      ok "the mixed room end to end after the ranges migration: $(grep -E '^MIXED E2E' "$WORK/mixed_e2e_ranges.log" | tail -1)"
    else
      bad "the mixed room end to end after the ranges migration (log: $WORK/mixed_e2e_ranges.log)"
      grep -Ev '^\s*$' "$WORK/mixed_e2e_ranges.log" | tail -8 | sed 's/^/    /'
    fi
  fi
  [ "$(fingerprint)" = "$FRANGE" ] && ok "the catalog unchanged by the ranges runs" || bad "the ranges runs changed the catalog"
  step "ranges rollback" "$RDOWN"
  [ "$(fingerprint)" = "$FNORANGE" ] && ok "after the ranges rollback: the numbers step's catalog (fingerprint)" \
    || bad "after the ranges rollback: another catalog than the numbers step's"
  step "ranges rollback again (re-runnable)" "$RDOWN"
  [ "$(fingerprint)" = "$FNORANGE" ] && ok "after the second ranges rollback: still the numbers step's catalog" || bad "after the second ranges rollback: another catalog"
  if run "$RCONTRACT"; then bad "live_ranges.sql passes after its rollback"; else ok "live_ranges.sql fails after its rollback"; fi
  step "contract: live_numbers.sql in full after the ranges rollback" "$NCONTRACT"
  behave "numbers behaviour in full after the ranges rollback" "$NBEHAVIOUR" 'LIVE NUMBERS BEHAVIOUR PASSED'
  step "ranges migration after its rollback" "$RMIG"
  [ "$(fingerprint)" = "$FRANGE" ] && ok "the same catalog as the first ranges apply" || bad "another catalog than the first ranges apply"
  step "contract: live_ranges.sql again" "$RCONTRACT"
  behave "ranges behaviour again" "$RBEHAVIOUR" 'LIVE RANGES BEHAVIOUR PASSED'
fi

echo "ok: $OKS, failures: $FAILS"
if [ $FAILS = 0 ]; then echo "LIVE GAME CHECKS PASSED"; fi
[ $FAILS = 0 ]
