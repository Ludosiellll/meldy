#!/usr/bin/env bash
# LOCAL ONLY. The end-to-end stage of live_game_run.sh: frontend/src/lib/live/real.ts (the client the screens use) against
# the rehearsal's database through a real PostgREST 12 (the status override of refusals, anon / authenticated by JWT,
# request.headers for the address throttle). Arguments: the postgrest binary and the database (the cluster of
# live_game_run.sh: PGHOST / PGPORT / PGUSER from the environment). Seeds an exam of author A with 4 playable questions,
# then runs frontend/src/lib/live/real.e2e.test.ts (vitest, node) with LIVE_E2E_* set. Exit 0 when the tests pass.
# Env (optional): LIVE_PGRST_PORT (54461), LIVE_WORK.
set -u -o pipefail
PGRST=$1
DB=$2
HERE=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
ROOT=$(cd "$HERE/../../.." && pwd)
WORK=${LIVE_WORK:-${TMPDIR:-/tmp}/meldy-live-game}
PORT=${LIVE_PGRST_PORT:-54461}
SECRET=live-e2e-local-jwt-secret-0123456789abcdef
PSQL=(psql -X -q -At -v ON_ERROR_STOP=1 -d "$DB")
mkdir -p "$WORK"

# PostgREST's login role and Supabase's auth.uid() (it reads request.jwt.claims as PostgREST 12 sets it).
"${PSQL[@]}" >/dev/null <<'SQL' || { echo "e2e: database setup failed"; exit 1; }
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
select set_config('request.jwt.claim.sub', 'aaaaaaaa-0000-0000-0000-000000000001', false) is null \g /dev/null
select set_config('meldy.e2e', public.container_create('Сквозная игра', null, '[{"title":"SQL"}]')::text, false) is null \g /dev/null
select public.container_items_add((current_setting('meldy.e2e')::jsonb -> 'subjects' -> 0 ->> 'id')::uuid, jsonb_build_array(
  jsonb_build_object('ref', 'e:1', 'stem', 'Какая команда отменяет транзакцию?', 'options', jsonb_build_array('ROLLBACK', 'COMMIT', 'SAVEPOINT', 'GRANT'), 'correct', jsonb_build_array(0)),
  jsonb_build_object('ref', 'e:2', 'stem', 'Какая команда относится к DDL?', 'options', jsonb_build_array('SELECT', 'ALTER', 'INSERT'), 'correct', jsonb_build_array(1)),
  jsonb_build_object('ref', 'e:3', 'stem', 'Что объединяет строки по условию?', 'options', jsonb_build_array('UNION', 'JOIN'), 'correct', jsonb_build_array(1)),
  jsonb_build_object('ref', 'e:4', 'stem', 'Буква I в ACID?', 'options', jsonb_build_array('Целиком', 'Изоляция', 'Сохранность'), 'correct', jsonb_build_array(1)))) is null \g /dev/null
select (current_setting('meldy.e2e')::jsonb ->> 'container_id') || ' ' || (current_setting('meldy.e2e')::jsonb -> 'subjects' -> 0 ->> 'id');
SQL
)
CONTAINER=$(echo "$SEED" | tail -1 | cut -d' ' -f1)
SUBJECT=$(echo "$SEED" | tail -1 | cut -d' ' -f2)
[[ "$CONTAINER" =~ ^[0-9a-f-]{36}$ ]] || { echo "e2e: seed failed: $SEED"; exit 1; }

cat > "$WORK/postgrest.conf" <<CONF
db-uri = "postgres://authenticator@${PGHOST:-127.0.0.1}:${PGPORT:-5432}/$DB"
db-schemas = "public"
db-anon-role = "anon"
db-pool = 10
jwt-secret = "$SECRET"
server-host = "127.0.0.1"
server-port = $PORT
log-level = "error"
CONF
"$PGRST" "$WORK/postgrest.conf" > "$WORK/postgrest.log" 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null; wait $PID 2>/dev/null' EXIT
for _ in $(seq 1 50); do
  curl --noproxy "*" -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break
  sleep 0.2
done
curl --noproxy "*" -fsS -o /dev/null "http://127.0.0.1:$PORT/" || { echo "e2e: PostgREST did not start"; cat "$WORK/postgrest.log"; exit 1; }

cd "$ROOT/frontend" || exit 1
LIVE_E2E_URL="http://127.0.0.1:$PORT" LIVE_E2E_SECRET="$SECRET" LIVE_E2E_CONTAINER="$CONTAINER" LIVE_E2E_SUBJECT="$SUBJECT" \
LIVE_E2E_AUTHOR=aaaaaaaa-0000-0000-0000-000000000001 \
  node_modules/.bin/vitest run src/lib/live/real.e2e.test.ts 2>&1
