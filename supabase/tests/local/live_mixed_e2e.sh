#!/usr/bin/env bash
# LOCAL ONLY. The room end to end for the battle with movement rounds (stage of live_game_run.sh): the real WebSocket
# room (backend/live_move_api.py + live_move_mixed.py, its SupabaseVerifier and its live_host_state / live_stand_close
# calls) against the rehearsal's database through a real PostgREST 12, with 30 bots tapping the button questions
# (live_answer) and running to their zones over the socket on the movement rounds (backend/scripts/live_mixed_e2e.py),
# then the database's HP and points against the Python mirror. Arguments: the postgrest binary and the database (the
# cluster of live_game_run.sh: PGHOST / PGPORT / PGUSER from the environment). Exit 0 when the game went as the bots
# played it and the database equals the mirror.
# Env (optional): LIVE_MIXED_PGRST_PORT (54463), LIVE_WORK, LIVE_PY (a Python with the backend's packages).
set -u -o pipefail
PGRST=$1
DB=$2
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
WORK=${LIVE_WORK:-${TMPDIR:-/tmp}/meldy-live-game}
PORT=${LIVE_MIXED_PGRST_PORT:-54463}
PY=${LIVE_PY:-python3}
SECRET=live-mixed-e2e-local-jwt-secret-0123456789
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
mkdir -p "$WORK"

"${PSQL[@]}" >/dev/null <<'SQL' || { echo "mixed e2e: database setup failed"; exit 1; }
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$fn$;
SQL
SEED=$("${PSQL[@]}" 2>&1 <<'SQL'
select set_config('role', 'authenticated', false) is null \g /dev/null
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000002', false) is null \g /dev/null
select set_config('meldy.e2e', public.container_create('Битва с мини-игрой: сквозная', null, '[{"title":"SQL"}]')::text, false) is null \g /dev/null
select public.container_items_add((current_setting('meldy.e2e')::jsonb -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
  jsonb_build_object('ref', 'x:1', 'stem', 'Какая команда отменяет транзакцию?', 'options', jsonb_build_array('COMMIT', 'ROLLBACK', 'GRANT', 'SAVEPOINT'), 'correct', jsonb_build_array(1), 'keep_order', true),
  jsonb_build_object('ref', 'x:2', 'stem', 'Какая нормальная форма без транзитивных зависимостей?', 'options', jsonb_build_array('Первая', 'Вторая', 'Третья'), 'correct', jsonb_build_array(2), 'keep_order', true),
  jsonb_build_object('ref', 'x:3', 'stem', 'Что делает JOIN?', 'options', jsonb_build_array('Удаляет строки', 'Соединяет таблицы', 'Создаёт индекс', 'Блокирует таблицу'), 'correct', jsonb_build_array(1), 'keep_order', true),
  jsonb_build_object('ref', 'x:4', 'stem', 'Буква I в ACID?', 'options', jsonb_build_array('Изоляция', 'Целиком'), 'correct', jsonb_build_array(0), 'keep_order', true),
  jsonb_build_object('ref', 'x:5', 'stem', 'Ключ, который ссылается на другую таблицу?', 'options', jsonb_build_array('Внешний', 'Первичный', 'Составной'), 'correct', jsonb_build_array(0), 'keep_order', true),
  jsonb_build_object('ref', 'x:6', 'stem', 'Какой оператор группирует строки?', 'options', jsonb_build_array('ORDER BY', 'WHERE', 'HAVING', 'GROUP BY'), 'correct', jsonb_build_array(3), 'keep_order', true))) is null \g /dev/null
select (current_setting('meldy.e2e')::jsonb ->> 'container_id') || ' ' || (current_setting('meldy.e2e')::jsonb -> 'subjects' -> 0 ->> 'id');
SQL
)
CONTAINER=$(echo "$SEED" | tail -1 | cut -d' ' -f1)
SUBJECT=$(echo "$SEED" | tail -1 | cut -d' ' -f2)
[[ "$CONTAINER" =~ ^[0-9a-f-]{36}$ ]] || { echo "mixed e2e: seed failed: $SEED"; exit 1; }

cat > "$WORK/postgrest_mixed.conf" <<CONF
db-uri = "postgres://authenticator@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/$DB"
db-schemas = "public"
db-anon-role = "anon"
db-pool = 10
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = $PORT
log-level = "error"
CONF
"$PGRST" "$WORK/postgrest_mixed.conf" > "$WORK/postgrest_mixed.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; wait $PID 2>/dev/null' EXIT
for _ in $(seq 1 50); do
  curl --noproxy "*" -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break
  sleep 0.2
done
curl --noproxy "*" -fsS -o /dev/null "http://127.0.0.1:$PORT/" || { echo "mixed e2e: PostgREST did not start"; cat "$WORK/postgrest_mixed.log"; exit 1; }

cd "$ROOT/backend" || exit 1
NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
"$PY" scripts/live_mixed_e2e.py --rest "http://127.0.0.1:$PORT" --secret "$SECRET" --container "$CONTAINER" --subject "$SUBJECT" \
  --author bbbbbbbb-0000-0000-0000-000000000002 --db "$DB" --players 30
