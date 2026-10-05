-- Rollback of 20261005042323_app_telemetry.sql. NOT applied by any package or agent; the owner runs it by hand
-- only if the statistics have to go. It drops the four analytics views, the schema analytics when nothing else is
-- left in it, the function log_app_events and the table app_events with every recorded event and error report
-- (export them first if they are needed). The site keeps working: POST /api/telemetry answers 204 and the backend
-- writes one line to its log that the function is missing; nothing else depends on these objects.
begin;
drop view if exists analytics.top_errors;
drop view if exists analytics.retention;
drop view if exists analytics.daily_funnel;
drop view if exists analytics.events_daily;
drop schema if exists analytics restrict;
drop function if exists public.log_app_events(jsonb);
drop table if exists public.app_events;
commit;
