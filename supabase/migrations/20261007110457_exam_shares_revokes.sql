-- Hardening of 20261007110403_exam_shares.sql, applied 2026-10-07 through apply_migration (version 20261007110457;
-- the connector did not hold it). Originally written for the owner to run by hand in the Supabase SQL Editor after
-- that migration (the Supabase connector holds REVOKE statements until a human confirms them, so the agent does not run
-- this). Safety does not depend on it: every function of the migration checks auth.uid(), the owner and the code
-- itself, RLS has no policy for anon, and PostgREST cannot TRUNCATE. It only takes back what Supabase's default
-- privileges gave to the new objects: anon's table rights; TRUNCATE, REFERENCES, TRIGGER (and the writes no policy
-- allows) of authenticated; EXECUTE of PUBLIC and anon on the functions that need a signed-in user. The preview stays
-- open to anon: it serves the signed-out invitation page /join/<code>.
-- Re-runnable. After it: supabase/tests/exam_shares.sql still reports contract_ok = true, and
-- supabase/tests/local/exam_shares_behaviour.sql still passes (a refused statement counts as «not touched»).
-- Once applied, record it as a migration (the way 20261007064401_pro_demo_anon_execute was).
revoke all on table public.exam_shares, public.exam_share_members, public.oral_rubric_failures from anon;
revoke truncate, references, trigger, update, delete on table public.exam_shares from authenticated;
revoke truncate, references, trigger, insert, update, delete on table public.exam_share_members from authenticated;
revoke truncate, references, trigger, update, delete on table public.oral_rubric_failures from authenticated;
revoke all on function public.exam_share_bundle(text) from public, anon;
revoke all on function public.exam_share_claim(text) from public, anon;
revoke all on function public.exam_share_bind(uuid, uuid) from public, anon;
revoke all on function public.exam_share_join(text, jsonb) from public, anon;
revoke all on function public.exam_share_revoke(uuid) from public, anon;
grant execute on function public.exam_share_bundle(text) to authenticated;
grant execute on function public.exam_share_claim(text) to authenticated;
grant execute on function public.exam_share_bind(uuid, uuid) to authenticated;
grant execute on function public.exam_share_join(text, jsonb) to authenticated;
grant execute on function public.exam_share_revoke(uuid) to authenticated;
grant execute on function public.exam_share_preview(text) to anon, authenticated;

-- Check: anon keeps only the preview.
select p.proname, pg_catalog.has_function_privilege('anon', p.oid, 'EXECUTE') as anon_runs
  from pg_catalog.pg_proc p
 where p.pronamespace = 'public'::regnamespace and p.proname like 'exam\_share\_%'
 order by p.proname;
