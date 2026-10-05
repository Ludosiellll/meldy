-- APPROXIMATION OF THE LIVE SCHEMA FOR LOCAL TESTS ONLY; NEVER RUN AGAINST THE LIVE PROJECT.
-- Run after supabase/tests/local/baseline.sql and supabase/migrations/20261003083154_hackathon_journal_exams_oral.sql
-- (learning_events, exams). Adds what *_app_telemetry.sql reads that the baseline leaves out: auth.users.created_at
-- (live auth.users has it), and fixtures for the views: A signed up 8 days ago (Moscow days) with a lecture, an
-- exam and an answered ticket the next day, and came back on day 7; B signed up yesterday with nothing.
-- Order: baseline.sql, 20261003083154_hackathon_journal_exams_oral.sql, this file, 20261005120000_app_telemetry.sql
-- (twice), app_telemetry_behaviour.sql, then supabase/tests/app_telemetry.sql (contract_ok must be true).
alter table auth.users add column if not exists created_at timestamptz not null default now();

-- Noon Moscow time of the day N days ago, so the Moscow calendar day is unambiguous.
create or replace function pg_temp.msk_noon(p_days_ago integer) returns timestamptz language sql as $$
  select (((now() at time zone 'Europe/Moscow')::date - p_days_ago)::timestamp + interval '12 hours') at time zone 'Europe/Moscow'
$$;

update auth.users set created_at = pg_temp.msk_noon(8) where id = 'aaaaaaaa-0000-0000-0000-000000000001';
update auth.users set created_at = pg_temp.msk_noon(1) where id = 'bbbbbbbb-0000-0000-0000-000000000002';

-- A's lecture (from baseline.sql) was made the day after sign-up; B's «lecture» is only copied text-free.
update public.materials set created_at = pg_temp.msk_noon(7) where id = '11111111-1111-1111-1111-111111111111';
update public.materials set original_text = '' where id = '22222222-2222-2222-2222-222222222222';

insert into public.exams (id, user_id, title, created_at)
values ('e0000000-0000-0000-0000-000000000001', 'aaaaaaaa-0000-0000-0000-000000000001', 'Макроэкономика', pg_temp.msk_noon(7));

-- The journal trigger sets created_at to now(): insert as the owner, then age the rows.
insert into public.learning_events (user_id, kind, item_key, client_event_id, material_id)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'exam_answer', 'q-hash-1', 'local-telemetry-1', null),
       ('aaaaaaaa-0000-0000-0000-000000000001', 'card_review', 'card-1', 'local-telemetry-2', null);
update public.learning_events set created_at = pg_temp.msk_noon(7) where client_event_id = 'local-telemetry-1';
update public.learning_events set created_at = pg_temp.msk_noon(1) where client_event_id = 'local-telemetry-2';
