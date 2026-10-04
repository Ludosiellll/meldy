-- Rollback of 20261004204007_pro_interest.sql. NOT applied by any package or agent; the owner runs
-- it by hand only if the table has to go. It drops the table with its policies and grants, and with
-- it every recorded «Сообщить, когда появится» request (export them first if they are needed). The
-- client then shows «Не удалось записать…» on that button; nothing else depends on the table.
begin;
drop table if exists public.pro_interest;
commit;
