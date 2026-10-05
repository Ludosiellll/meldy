-- Rollback of 20261005150000_cheat_sheet.sql. NOT applied by any package or agent; the owner runs it by hand only if
-- the cheat sheet has to go entirely.
-- In one transaction it:
--   1. re-creates learning_events_kind_check without 'sheet_peek', NOT VALID: the peeks already in the journal stay
--      (nothing is deleted), new ones are refused;
--   2. drops oral_rubrics.sheet with its check: the short lines are gone, the rubrics themselves stay.
-- Deploy the backend without oral_sheet.py first (or accept that the sheet shows full point titles: GET
-- /api/oral/sheet retries its read without the column).
begin;
alter table public.learning_events drop constraint if exists learning_events_kind_check;
alter table public.learning_events add constraint learning_events_kind_check
  check (kind in ('quiz_answer', 'card_review', 'exam_answer', 'oral_point', 'self_rating')) not valid;
alter table public.oral_rubrics drop constraint if exists oral_rubrics_sheet_check;
alter table public.oral_rubrics drop column if exists sheet;
commit;
