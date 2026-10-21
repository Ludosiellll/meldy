#!/usr/bin/env bash
# LOCAL ONLY; NEVER AGAINST THE LIVE PROJECT. A battle with movement rounds to play by hand or record on this machine
# (docs/live/MODE_MIXED.md): on the rehearsal's database (the cluster of live_game_run.sh, which leaves the database
# with the mixed migration applied) it seeds a test of six questions, starts a real PostgREST and then
# backend/scripts/live_mixed_local.py (the real room with bots). Arguments: the postgrest binary and the database;
# more arguments go to the Python runner (--bots, --every, --time, --boss, --port). PGHOST / PGPORT / PGUSER from the
# environment. Env (optional): LIVE_MIXED_LOCAL_PGRST_PORT (54473), LIVE_WORK, LIVE_PY (a Python with the backend's
# packages). frontend/scripts/mixed-local.mjs runs this, the site and Chromium together.
set -u -o pipefail
PGRST=$1
DB=$2
shift 2
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
WORK=${LIVE_WORK:-${TMPDIR:-/tmp}/meldy-live-game}
PORT=${LIVE_MIXED_LOCAL_PGRST_PORT:-54473}
PY=${LIVE_PY:-python3}
SECRET=live-mixed-local-jwt-secret-0123456789abcdef
AUTHOR=bbbbbbbb-0000-0000-0000-000000000003
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
mkdir -p "$WORK"

"${PSQL[@]}" >/dev/null <<'SQL' || { echo "mixed local: database setup failed" >&2; exit 1; }
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then create role authenticator login noinherit; end if;
end $$;
grant anon, authenticated, service_role to authenticator;
create or replace function auth.uid() returns uuid language sql stable as $fn$
  select coalesce(nullif(current_setting('request.jwt.claim.sub', true), ''),
                  (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'))::uuid
$fn$;
insert into auth.users (id) values ('bbbbbbbb-0000-0000-0000-000000000003') on conflict do nothing;
-- earlier local games of this author left open (3 open games per author): ended
update public.live_games set state = 'ended', ended_at = now() where state not in ('ended', 'expired')
   and owner_id = 'bbbbbbbb-0000-0000-0000-000000000003';
SQL
SEED=$("${PSQL[@]}" 2>&1 <<'SQL'
select set_config('role', 'authenticated', false) is null \g /dev/null
select set_config('request.jwt.claim.sub', 'bbbbbbbb-0000-0000-0000-000000000003', false) is null \g /dev/null
select set_config('meldy.local', public.container_create('Базы данных', null, '[{"title":"SQL"}]')::text, false) is null \g /dev/null
select public.container_items_add((current_setting('meldy.local')::jsonb -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
  jsonb_build_object('ref', 'x:1', 'stem', 'Какая команда отменяет транзакцию?', 'options', jsonb_build_array('COMMIT', 'ROLLBACK', 'GRANT', 'SAVEPOINT'), 'correct', jsonb_build_array(1), 'keep_order', true),
  jsonb_build_object('ref', 'x:2', 'stem', 'Какая нормальная форма убирает транзитивные зависимости?', 'options', jsonb_build_array('Первая', 'Вторая', 'Третья'), 'correct', jsonb_build_array(2), 'keep_order', true),
  jsonb_build_object('ref', 'x:3', 'stem', 'Что делает JOIN?', 'options', jsonb_build_array('Удаляет строки', 'Соединяет таблицы', 'Создаёт индекс', 'Блокирует таблицу'), 'correct', jsonb_build_array(1), 'keep_order', true),
  jsonb_build_object('ref', 'x:4', 'stem', 'Что значит буква I в ACID?', 'options', jsonb_build_array('Изоляция', 'Индекс'), 'correct', jsonb_build_array(0), 'keep_order', true),
  jsonb_build_object('ref', 'x:5', 'stem', 'Как называют ключ, который ссылается на другую таблицу?', 'options', jsonb_build_array('Внешний', 'Первичный', 'Составной'), 'correct', jsonb_build_array(0), 'keep_order', true),
  jsonb_build_object('ref', 'x:6', 'stem', 'Какой оператор группирует строки?', 'options', jsonb_build_array('ORDER BY', 'WHERE', 'HAVING', 'GROUP BY'), 'correct', jsonb_build_array(3), 'keep_order', true))) is null \g /dev/null
select (current_setting('meldy.local')::jsonb ->> 'container_id') || ' ' || (current_setting('meldy.local')::jsonb -> 'subjects' -> 0 ->> 'id');
SQL
)
CONTAINER=$(echo "$SEED" | tail -1 | cut -d' ' -f1)
SUBJECT=$(echo "$SEED" | tail -1 | cut -d' ' -f2)
[[ "$CONTAINER" =~ ^[0-9a-f-]{36}$ ]] || { echo "mixed local: seed failed: $SEED" >&2; exit 1; }

cat > "$WORK/postgrest_mixed_local.conf" <<CONF
db-uri = "postgres://authenticator@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/$DB"
db-schemas = "public"
db-anon-role = "anon"
db-pool = 10
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = $PORT
log-level = "error"
CONF
"$PGRST" "$WORK/postgrest_mixed_local.conf" > "$WORK/postgrest_mixed_local.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; wait $PID 2>/dev/null' EXIT
for _ in $(seq 1 50); do
  curl --noproxy "*" -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break
  sleep 0.2
done
curl --noproxy "*" -fsS -o /dev/null "http://127.0.0.1:$PORT/" || { echo "mixed local: PostgREST did not start" >&2; cat "$WORK/postgrest_mixed_local.log" >&2; exit 1; }

cd "$ROOT/backend" || exit 1
NO_PROXY="127.0.0.1,localhost" no_proxy="127.0.0.1,localhost" \
"$PY" scripts/live_mixed_local.py --local --rest "http://127.0.0.1:$PORT" --secret "$SECRET" --container "$CONTAINER" \
  --subject "$SUBJECT" --author "$AUTHOR" "$@"
