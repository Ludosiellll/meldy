-- Exam container: covering indexes for the five foreign keys the performance advisor named after the live apply
-- (lint 0001_unindexed_foreign_keys, 2026-10-10). Deleting a container, a group link or an account then finds the
-- dependent rows by index instead of scanning the table; test_item_states is the one that grows (members × items).
-- Additive and re-runnable; no table is locked for long (the tables are new and small).
create index if not exists test_item_states_container_only_idx on public.test_item_states (container_id);
create index if not exists container_member_exams_container_idx on public.container_member_exams (container_id);
create index if not exists container_members_link_idx on public.container_members (link_id);
create index if not exists container_links_owner_idx on public.container_links (owner_id);
create index if not exists test_key_doubts_user_idx on public.test_key_doubts (user_id);
