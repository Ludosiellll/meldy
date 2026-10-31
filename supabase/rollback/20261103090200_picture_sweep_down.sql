-- Rollback of supabase/migrations/20261103090200_picture_sweep.sql: the trigger, the two bot functions, the trigger
-- function and the queue go. Folders still queued are forgotten: their pictures stay in storage (as before the file).
-- Roll back the telegram function's step «sweep» first or with it: without the functions the step answers «missing» and
-- does nothing. Re-runnable.
drop trigger if exists containers_queue_picture_sweep on public.containers;
drop function if exists public.bot_picture_sweep(integer, timestamptz);
drop function if exists public.bot_picture_swept(uuid);
drop function if exists meldy_private.queue_picture_sweep();
drop table if exists meldy_private.picture_sweep;
