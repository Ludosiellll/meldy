-- Show a class roster only to its teacher and its enrolled students, without
-- granting general access to group_members or full profile rows.
CREATE OR REPLACE FUNCTION public.get_group_members(p_group_id uuid)
RETURNS TABLE (
  id uuid,
  group_id uuid,
  student_id uuid,
  joined_at timestamptz,
  class_nickname character varying,
  full_name text,
  avatar_url text,
  total_reviews integer,
  total_xp integer
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT gm.id, gm.group_id, gm.student_id, gm.joined_at, gm.class_nickname,
         p.full_name, p.avatar_url, p.total_reviews,
         COALESCE(x.total_xp, 0)
  FROM public.group_members AS gm
  JOIN public.groups AS g ON g.id = gm.group_id
  LEFT JOIN public.profiles AS p ON p.id = gm.student_id
  LEFT JOIN public.user_xp AS x ON x.user_id = gm.student_id
  WHERE gm.group_id = p_group_id
    AND (SELECT auth.uid()) IS NOT NULL
    AND (
      g.teacher_id = (SELECT auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.group_members AS self_membership
        WHERE self_membership.group_id = p_group_id
          AND self_membership.student_id = (SELECT auth.uid())
      )
    )
  ORDER BY COALESCE(gm.class_nickname, p.full_name), gm.joined_at;
$function$;
REVOKE ALL ON FUNCTION public.get_group_members(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_group_members(uuid) TO authenticated;
