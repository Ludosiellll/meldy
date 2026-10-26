-- Rollback of supabase/migrations/20261026090000_recording_usage.sql: the two functions and the table go; nothing
-- else was touched. Re-runnable. The backend treats a missing function as «the check is unavailable» and lets the
-- recording through (quota.py, fail-open), so a rollback does not stop lectures.
drop function if exists public.refund_recording_seconds(uuid);
drop function if exists public.consume_recording_seconds(integer);
drop table if exists public.recording_charges;
