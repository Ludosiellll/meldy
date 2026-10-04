-- jury_trust_reads
-- Applied to daunnytubqbzafjnpfnw on 2026-10-04 as version 20261004054539 with the owner's explicit approval;
-- the read-only check supabase/tests/jury_trust_reads.sql returned contract_ok = true.
-- Jury memo 2026-10-03, item 13 (b), with the critic's amendments: ticket answers stay the
-- student's own. They stop adding group-visible XP, and neither the protocols (exam_sessions of
-- kind 'oral_ticket') nor the mistakes they produce (mistake_diary of origin 'oral_ticket', whose
-- student_answer quotes the answer) can be read through a teacher or any other permissive policy.
-- One additive, re-runnable migration: one guarded CREATE OR REPLACE of get_group_weekly_scores
-- (same signature, return type, flags and grants) and two RESTRICTIVE SELECT policies created only
-- when missing. No DROP, no DELETE, no change to rows or to other policies.
-- Compatibility: exam_sessions.kind and mistake_diary.origin are NOT NULL DEFAULT 'professor'
-- (20261003083154), so old rows and the previous client's rows are 'professor'. Owners pass both
-- policies on every own row, so record_oral_attempt (security invoker, INSERT ... RETURNING), the
-- old /exam and every own read keep working; the owner policies «Users can manage own exam
-- sessions» and «Users can manage own mistakes» are untouched; get_group_weekly_scores runs as
-- its owner. Rollback (never applied by agents): supabase/rollback/20261004054539_jury_trust_reads_down.sql.
-- Check: supabase/tests/jury_trust_reads.sql (one read-only query, one JSON report).

-- 1. Group XP counts only the old oral exam: ticket answers are practice and stay private.
--    The body below is the 20260924062645 body verbatim plus one condition in exam_points
--    (AND exam.kind = 'professor'). It replaces the live function only when the live body is the
--    one this repo knows (20260924062645) or already this one, compared by the md5 of the body with
--    every whitespace run collapsed to one space and the ends trimmed. Any other body is left as it
--    is, and so is a replacement that fails (for example, a function owned by another role): both
--    end with a NOTICE, not an abort, so the policies below still land with the single apply.
DO $guard$
DECLARE
  v_md5 text;
BEGIN
  SELECT pg_catalog.md5(pg_catalog.btrim(pg_catalog.regexp_replace(p.prosrc, '\s+', ' ', 'g')))
    INTO v_md5
    FROM pg_catalog.pg_proc p
   WHERE p.oid = pg_catalog.to_regprocedure('public.get_group_weekly_scores(uuid)');
  IF v_md5 IN ('028762d316d74dda911d80395b55a155',   -- 20260924062645_secure_group_weekly_scores
               'af42156e5f26e938b09ee99ed07e654a') THEN   -- this migration
    BEGIN
      EXECUTE $create$
CREATE OR REPLACE FUNCTION public.get_group_weekly_scores(p_group_id uuid)
RETURNS TABLE(student_id uuid, weekly_xp bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $body$
  WITH authorized_roster AS (
    SELECT member.student_id
    FROM public.group_members AS member
    JOIN public.groups AS study_group ON study_group.id = member.group_id
    WHERE member.group_id = p_group_id
      AND (
        study_group.teacher_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.group_members AS current_member
          WHERE current_member.group_id = study_group.id
            AND current_member.student_id = auth.uid()
        )
      )
  ),
  study_points AS (
    SELECT session.user_id AS student_id,
      COALESCE(SUM(
        COALESCE(session.cards_reviewed, 0)::bigint * 2
        + COALESCE(session.materials_added, 0)::bigint * 50
      ), 0)::bigint AS xp
    FROM public.study_sessions AS session
    JOIN authorized_roster AS roster ON roster.student_id = session.user_id
    WHERE session.date >= CURRENT_DATE - 6
    GROUP BY session.user_id
  ),
  exam_points AS (
    SELECT exam.user_id AS student_id,
      COUNT(*)::bigint * 100 AS xp
    FROM public.exam_sessions AS exam
    JOIN authorized_roster AS roster ON roster.student_id = exam.user_id
    WHERE exam.status = 'completed'
      AND exam.completed_at >= pg_catalog.now() - '7 days'::interval
      AND exam.kind = 'professor'
    GROUP BY exam.user_id
  )
  SELECT roster.student_id,
    COALESCE(study_points.xp, 0) + COALESCE(exam_points.xp, 0) AS weekly_xp
  FROM authorized_roster AS roster
  LEFT JOIN study_points ON study_points.student_id = roster.student_id
  LEFT JOIN exam_points ON exam_points.student_id = roster.student_id;
$body$
$create$;
      EXECUTE 'REVOKE ALL ON FUNCTION public.get_group_weekly_scores(uuid) FROM PUBLIC, anon';
      EXECUTE 'GRANT EXECUTE ON FUNCTION public.get_group_weekly_scores(uuid) TO authenticated';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'get_group_weekly_scores left unchanged: replacing it failed (% %)', SQLSTATE, SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'get_group_weekly_scores left unchanged: live body md5 % is not a known one',
      coalesce(v_md5, 'missing');
  END IF;
END
$guard$;

-- 2. Ticket protocols and the mistakes they produce are readable only by their owner, whatever
--    permissive SELECT policies allow (the live «Teachers can read exam sessions of their
--    students»). Restrictive, for every role, created only when missing.
DO $policies$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                  WHERE schemaname = 'public' AND tablename = 'exam_sessions'
                    AND policyname = 'Exam sessions: ticket answers only for the owner') THEN
    CREATE POLICY "Exam sessions: ticket answers only for the owner" ON public.exam_sessions
      AS RESTRICTIVE FOR SELECT TO public
      USING (kind = 'professor' OR (SELECT auth.uid()) = user_id);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_policies
                  WHERE schemaname = 'public' AND tablename = 'mistake_diary'
                    AND policyname = 'Mistake diary: ticket answers only for the owner') THEN
    CREATE POLICY "Mistake diary: ticket answers only for the owner" ON public.mistake_diary
      AS RESTRICTIVE FOR SELECT TO public
      USING (origin <> 'oral_ticket' OR (SELECT auth.uid()) = user_id);
  END IF;
END
$policies$;
