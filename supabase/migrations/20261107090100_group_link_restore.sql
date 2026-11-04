-- group_link_restore (a data fix: the owner's group link that 19 members joined by works again)
-- Repo file: supabase/migrations/20261107090100_group_link_restore.sql. Base: 20261009093500_containers.sql.
-- Why (owner, 2026-11-04: «обнови эту ссылку чтобы она работала (та которая была первая и истекла)»): on 2026-11-03
-- 14:21 UTC «Пригласить группу» on a device without the link's code made a new link, and the new link closed the open
-- one (InviteExam: «the new link replaces the open ones»). The closed link was the one 19 members had joined by,
-- open until 2027-02-11; the new one was set to end two days after the exam's date (2026-11-11). This file opens the
-- first link again (it keeps its own end, 2027-02-11) and gives the second the same end, so both codes in circulation
-- work. It has no oral subjects shared through it (oral_share_ids empty), so nothing else was closed with it.
-- Only these two rows, only in the state found on 2026-11-04: a second apply changes nothing.
-- Check after the apply: supabase/tests/group_link_restore.sql (read-only). No rollback file: the old state was the
-- mistake (to close a link again, the author presses «Закрыть ссылку»).

set local lock_timeout = '2s';

update public.container_links
   set revoked_at = null
 where id = '37640753-1169-4c01-af85-0c148d029ae4'
   and container_id = '72d117bb-778c-491e-9b5e-7a786456de75'
   and revoked_at = '2026-11-03 14:21:08.161034+00';

update public.container_links
   set expires_at = '2027-02-11 17:03:59.467883+00'
 where id = '721adbc2-d350-4be3-8bdb-4acf4717e281'
   and container_id = '72d117bb-778c-491e-9b5e-7a786456de75'
   and revoked_at is null
   and expires_at = '2026-11-11 00:00:00+00';
