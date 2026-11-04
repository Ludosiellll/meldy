-- Rollback of supabase/migrations/20261107090000_container_orals_go.sql: the trigger and its function. A container's
-- oral exams stay again when it is deleted. The ten exams the clean-up deleted do not come back. Re-runnable.
set local lock_timeout = '2s';
drop trigger if exists containers_take_orals on public.containers;
drop function if exists meldy_private.take_container_orals();
