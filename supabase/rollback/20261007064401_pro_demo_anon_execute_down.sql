-- Rollback of 20261007064401_pro_demo_anon_execute.sql: Supabase's defaults back (PUBLIC and anon may execute the two
-- functions; their auth.uid() guard still refuses a caller who is not signed in). NOT applied by any package or agent.
grant execute on function public.start_pro_demo() to public, anon;
grant execute on function public.stop_pro_demo() to public, anon;
