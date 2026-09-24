-- Keep notification dismissal available while restricting it to the signed-in owner.
CREATE POLICY notifications_delete_own
ON public.notifications
FOR DELETE
TO authenticated
USING ((SELECT auth.uid()) = user_id);
