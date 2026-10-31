-- Run once after migration 20261106090000_live_calm.sql: the read-only check of that apply (run the other live_*.sql
-- too). A DO block that raises nothing when every check holds (supabase/migrate.py); it raises the name of the first
-- one that does not. Catalog only.
-- Checks: live_games.calm (not null, default false) and its check (a battle without points for speed); live_create
-- takes settings.calm (22023 calm) and keeps no points for speed then; the close deals 100 and freezes nobody in a calm
-- game; the state and the host's settings say calm only for a calm game. The behaviour is rehearsed locally:
-- supabase/tests/local/live_game_run.sh (live_calm_behaviour.sql).
DO $check$
DECLARE
  v_src text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns c
                  WHERE c.table_schema = 'public' AND c.table_name = 'live_games' AND c.column_name = 'calm'
                    AND c.data_type = 'boolean' AND c.is_nullable = 'NO' AND c.column_default = 'false') THEN
    RAISE EXCEPTION 'calm_column';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint k
                  WHERE k.conrelid = 'public.live_games'::regclass AND k.conname = 'live_games_calm_check'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%NOT calm%' AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%NOT speed%'
                    AND pg_catalog.pg_get_constraintdef(k.oid) LIKE '%''boss''%') THEN
    RAISE EXCEPTION 'calm_check';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'public.live_create(jsonb,jsonb)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'perform meldy_private.live_fail(''22023'', ''calm'');') = 0
     OR pg_catalog.strpos(v_src, 'v_calm := coalesce((v_settings ->> ''calm'')::boolean, false);') = 0
     OR pg_catalog.strpos(v_src, '  if v_calm then
    v_speed := false;') = 0
     OR pg_catalog.strpos(v_src, 'v_every, v_teams, v_calm)') = 0 THEN
    RAISE EXCEPTION 'create_takes_calm';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_close(uuid)'::regprocedure;
  IF pg_catalog.strpos(v_src, '        if v_g.calm then
          v_dmg := 100;') = 0
     OR pg_catalog.strpos(v_src, 'pg_catalog.floor((case when v_g.calm then 100') = 0
     OR pg_catalog.strpos(v_src, 'frozen = p.frozen or not v_g.calm where p.id = v_p.id') = 0
     OR pg_catalog.strpos(v_src, '  if not v_void and v_g.calm then
    -- «Без спешки»: no answer breaks the streak and freezes nobody') = 0
     OR pg_catalog.strpos(v_src, '  elsif not v_void then') = 0 THEN
    RAISE EXCEPTION 'close_calm';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_base_json(public.live_games)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'case when p_g.calm then ''{"calm": true}''::jsonb else ''{}''::jsonb end') = 0 THEN
    RAISE EXCEPTION 'state_says_calm';
  END IF;
  SELECT p.prosrc INTO v_src FROM pg_catalog.pg_proc p WHERE p.oid = 'meldy_private.live_host_json(public.live_games)'::regprocedure;
  IF pg_catalog.strpos(v_src, 'case when p_g.calm then ''{"calm": true}''::jsonb else ''{}''::jsonb end') = 0 THEN
    RAISE EXCEPTION 'settings_say_calm';
  END IF;
END
$check$;
