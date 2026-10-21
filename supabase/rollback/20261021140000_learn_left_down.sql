-- Rollback of 20261021140000_learn_left.sql: its five functions and its index. Nothing else was touched (no table,
-- column, policy or existing function), and nothing is stored by them: the journal and the rubrics stay as they are.
-- Re-runnable.
drop function if exists public.bot_learn_left(bigint);
drop function if exists public.learn_left(uuid[], text);
drop function if exists meldy_private.learn_left_for(uuid, uuid[], text, timestamptz);
drop function if exists meldy_private.learn_left_facts(jsonb, jsonb, timestamptz, text);
drop function if exists meldy_private.norm_point_title(text);
drop index if exists public.learning_events_user_qhash_idx;
