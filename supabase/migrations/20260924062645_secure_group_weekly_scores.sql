CREATE OR REPLACE FUNCTION public.get_group_weekly_scores(p_group_id uuid)
RETURNS TABLE(student_id uuid, weekly_xp bigint)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $$
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
    GROUP BY exam.user_id
  )
  SELECT roster.student_id,
    COALESCE(study_points.xp, 0) + COALESCE(exam_points.xp, 0) AS weekly_xp
  FROM authorized_roster AS roster
  LEFT JOIN study_points ON study_points.student_id = roster.student_id
  LEFT JOIN exam_points ON exam_points.student_id = roster.student_id;
$$;

REVOKE ALL ON FUNCTION public.get_group_weekly_scores(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_group_weekly_scores(uuid) TO authenticated;
