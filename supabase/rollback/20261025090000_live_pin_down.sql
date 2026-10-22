-- Rollback of supabase/migrations/20261025090000_live_pin.sql: the catalog before it again (the rehearsal
-- supabase/tests/local/live_game_run.sh compares the fingerprint). Only the function goes: live_join was never changed
-- and nothing was stored by live_pin. A phone page that asks for rpc/live_pin then gets PostgREST's 404 (PGRST202) and
-- real.ts falls back to the old check through live_join. Re-runnable (IF EXISTS).

drop function if exists public.live_pin(text, text);
