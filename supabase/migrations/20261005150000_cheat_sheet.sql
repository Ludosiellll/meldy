-- cheat_sheet
-- Repo file: supabase/migrations/20261005150000_cheat_sheet.sql. Written on 2026-10-05; NOT applied yet (the owner or
-- the orchestrator applies it, then runs the contract check supabase/tests/cheat_sheet.sql).
--
-- «Шпаргалка, которая исчезает» (notes: 10_Project/Vanishing_Cheat_Sheet_Spec_2026-10-05, sections 3.2, 3.3 and 10):
--   1. oral_rubrics.sheet jsonb — the cheat-sheet lines of one rubric row, written by the backend (oral_sheet.py) with
--      the user's own token under the existing policy «Oral rubrics: update own»:
--        {"v": 1, "for": "<created_at of the row>", "short": {"p1": "…"}, "tried": {"p2": true}}
--      The backend patches only this column, filtered by id and created_at = "for", so a forced rebuild of the rubric
--      (which sets a new created_at) is never overwritten with lines of the old points; a reader ignores a sheet whose
--      "for" is not the row's created_at. The rubric column itself (answer check, grading, answer screen) never
--      changes. NULL = no lines yet; at most 8 KB.
--   2. learning_events kind 'sheet_peek' — the student peeked at a rubbed line (spec 2.2, 7.1). A peek never erases a
--      line; on the same local day it keeps an answer from erasing it. learning_events_kind_check is re-created with
--      the same five kinds plus 'sheet_peek'.
--
-- Additive: a new nullable column with its check, and one more allowed kind; no grant or policy changes. Re-runnable
-- (IF NOT EXISTS; both checks are dropped and re-created). The backend reads the column only after this is applied:
-- before that GET /api/oral/sheet works without short lines (it retries its read without the column).
-- Rollback: supabase/rollback/20261005150000_cheat_sheet_down.sql.

-- 1. Short lines of a rubric row.
alter table public.oral_rubrics add column if not exists sheet jsonb;

alter table public.oral_rubrics drop constraint if exists oral_rubrics_sheet_check;
alter table public.oral_rubrics add constraint oral_rubrics_sheet_check
  check (sheet is null or (jsonb_typeof(sheet) = 'object' and octet_length(sheet::text) <= 8192));

comment on column public.oral_rubrics.sheet is
  'Cheat-sheet lines of this rubric: {"v":1,"for":<created_at>,"short":{"p1":…},"tried":{"p2":true}}; ignored when "for" is not created_at.';

-- 2. The journal accepts peeks at a cheat-sheet line.
alter table public.learning_events drop constraint if exists learning_events_kind_check;
alter table public.learning_events add constraint learning_events_kind_check
  check (kind in ('quiz_answer', 'card_review', 'exam_answer', 'oral_point', 'self_rating', 'sheet_peek'));
