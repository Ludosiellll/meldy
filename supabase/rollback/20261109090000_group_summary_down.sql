-- Rollback of supabase/migrations/20261109090000_group_summary.sql back to 20261107090800_avatars_owner.sql: the one
-- function it added is dropped. Re-runnable.
--
-- What is lost: nothing stored (the function only reads). The exam's author no longer gets the group's numbers: the
-- site of this release then shows no line «Группа: …» (its read fails quietly). The site's new words about who sees
-- what can stay: without the function the author sees less than they say, never more.

set local lock_timeout = '2s';

drop function if exists public.container_group_summary(uuid);
