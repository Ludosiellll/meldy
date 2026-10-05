-- Rollback of 20261005092819_pro_demo_purchase.sql. NOT applied by any package or agent; the owner runs it by hand
-- only if the free PRO demo has to go entirely. To close the demo and keep the rest, use the kill switch described
-- in the migration's header instead.
-- In one transaction it:
--   1. takes PRO back from every account that took it through the demo (pro_since set): they are back to 100 units
--      of AI a day at once (consume_ai_units and ai_quota_status read profiles.is_pro);
--   2. drops start_pro_demo() and stop_pro_demo(): «Купить PRO» in the PRO window then shows «Не удалось включить
--      PRO…» (the client reads a missing function as a failed call);
--   3. drops the column profiles.pro_since, with the dates the demo was taken.
-- Not undone: the migration's data fix, which switched off the PRO flags left over from the old self-service toggle.
-- Nobody paid for them, and their ids were not kept.
begin;
update public.profiles set is_pro = false where pro_since is not null;
drop function if exists public.start_pro_demo();
drop function if exists public.stop_pro_demo();
alter table public.profiles drop column if exists pro_since;
commit;
