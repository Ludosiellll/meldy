-- Rollback of 20261010074500_containers_fk_indexes.sql: drops the five covering indexes (no data changes).
drop index if exists public.test_item_states_container_only_idx;
drop index if exists public.container_member_exams_container_idx;
drop index if exists public.container_members_link_idx;
drop index if exists public.container_links_owner_idx;
drop index if exists public.test_key_doubts_user_idx;
