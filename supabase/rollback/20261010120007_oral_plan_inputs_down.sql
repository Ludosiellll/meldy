-- Rollback of supabase/migrations/20261010120007_oral_plan_inputs.sql (package T11 of the Telegram bot). Drops exactly the
-- functions it created, callers first; nothing else changes (the migration created no table, column, policy or grant on
-- an older object) and no data is touched. Run it before T1's rollback (20261010120000_telegram_bot_down.sql):
-- bot_oral_inputs reads bot.links. After it the catalog equals the base (supabase/tests/local/
-- oral_plan_inputs_equivalence.sh compares the fingerprints). Re-runnable (IF EXISTS); no CASCADE: an object of a later
-- package that depends on these functions stops the rollback whole instead of being dropped with them.
begin;
drop function if exists public.bot_oral_inputs(bigint);
drop function if exists meldy_private.oral_event_json(uuid, timestamptz, date, uuid, text, text, boolean, real, smallint, text[],
  uuid, jsonb);
drop function if exists meldy_private.oral_events_for(uuid, text[]);
drop function if exists meldy_private.oral_sheet_for(uuid, uuid);
drop function if exists meldy_private.oral_sheet_short(jsonb, timestamptz, text);
drop function if exists meldy_private.oral_clean_materials(jsonb);
drop function if exists meldy_private.oral_clean_points(jsonb);
drop function if exists meldy_private.oral_rubric_key(text, text[], jsonb, text);
drop function if exists meldy_private.py_str(jsonb);
drop function if exists meldy_private.py_repr(jsonb);
drop function if exists meldy_private.py_float_repr(text);
drop function if exists meldy_private.py_repr_text(text);
commit;
