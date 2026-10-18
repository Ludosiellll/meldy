-- LOCAL ONLY. Deletes the fixtures of container_kind_backfill.sql (their exams, the oral exam, the account).
\set ON_ERROR_STOP 1
begin;
delete from public.containers where owner_id = 'c4d00000-0000-4000-8000-0000000000bf';
delete from public.exams where user_id = 'c4d00000-0000-4000-8000-0000000000bf';
delete from auth.users where id = 'c4d00000-0000-4000-8000-0000000000bf';
select 'BACKFILL FIXTURES LEFT ' || pg_catalog.count(*) from public.containers where owner_id = 'c4d00000-0000-4000-8000-0000000000bf';
commit;
