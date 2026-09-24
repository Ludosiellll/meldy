-- The application screens for these features require an authenticated session.
-- Keep their current authenticated behavior, but prevent the anon API role from
-- enumerating profiles, groups, memberships, social data, or assignment status.
ALTER POLICY "Completions are viewable by everyone"
ON public.assignment_completions
TO authenticated
USING (
  (SELECT auth.uid()) = student_id
  OR EXISTS (
    SELECT 1
    FROM public.assignments AS a
    JOIN public.groups AS g ON g.id = a.group_id
    WHERE a.id = assignment_completions.assignment_id
      AND g.teacher_id = (SELECT auth.uid())
  )
);

ALTER POLICY "Users can read co-study messages"
ON public.co_study_messages
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.materials AS m
    WHERE m.id = co_study_messages.material_id
  )
);

ALTER POLICY "Users can insert own co-study messages"
ON public.co_study_messages
TO authenticated
WITH CHECK (
  (SELECT auth.uid()) = sender_id
  AND EXISTS (
    SELECT 1
    FROM public.materials AS m
    WHERE m.id = co_study_messages.material_id
  )
);

ALTER POLICY "Anyone can read group by invite code"
ON public.groups
TO authenticated
USING ((SELECT auth.uid()) IS NOT NULL);

ALTER POLICY "Public read material_likes"
ON public.material_likes
TO authenticated
USING ((SELECT auth.uid()) = user_id);

ALTER POLICY "Auth insert notifications"
ON public.notifications
TO authenticated
WITH CHECK ((SELECT auth.uid()) IS NOT NULL);

ALTER POLICY "Public read profiles"
ON public.profiles
TO authenticated
USING ((SELECT auth.uid()) IS NOT NULL);

ALTER POLICY "public_read_user_xp"
ON public.user_xp
TO authenticated
USING ((SELECT auth.uid()) IS NOT NULL);
