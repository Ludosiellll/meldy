-- Replace broad profile/group access with narrow projections and trusted RPCs.
DROP POLICY IF EXISTS "Public read profiles" ON public.profiles;
DROP POLICY IF EXISTS "Auth update own profile" ON public.profiles;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.profiles;
ALTER POLICY "Users can read own profile" ON public.profiles
  TO authenticated
  USING ((SELECT auth.uid()) = id);
ALTER POLICY "Users can update own profile" ON public.profiles
  TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);
REVOKE SELECT ON TABLE public.profiles FROM anon;
REVOKE SELECT (
  id, full_name, streak_days, last_active_date, total_reviews, total_materials,
  created_at, updated_at, avatar_url, bio, university, role,
  onboarding_status, is_pro, public_id
) ON TABLE public.profiles FROM anon;

CREATE OR REPLACE FUNCTION public.get_public_profiles(
  p_user_ids uuid[] DEFAULT NULL,
  p_query text DEFAULT NULL,
  p_exclude_user_id uuid DEFAULT NULL,
  p_limit integer DEFAULT 50
)
RETURNS TABLE (
  id uuid,
  full_name text,
  avatar_url text,
  bio text,
  university text,
  public_id text,
  streak_days integer,
  total_reviews integer,
  total_materials integer,
  role text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT p.id, p.full_name, p.avatar_url, p.bio, p.university, p.public_id,
         p.streak_days, p.total_reviews, p.total_materials, p.role
  FROM public.profiles AS p
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND (
      (COALESCE(cardinality(p_user_ids), 0) > 0 AND p.id = ANY (p_user_ids))
      OR (
        COALESCE(cardinality(p_user_ids), 0) = 0
        AND NULLIF(btrim(p_query), '') IS NOT NULL
        AND (p.id <> COALESCE(p_exclude_user_id, (SELECT auth.uid())))
        AND (
          p.full_name ILIKE '%' || btrim(p_query) || '%'
          OR p.public_id = upper(btrim(p_query))
        )
      )
    )
  ORDER BY
    CASE WHEN NULLIF(btrim(p_query), '') IS NOT NULL
      AND p.public_id = upper(btrim(p_query)) THEN 0 ELSE 1 END,
    p.full_name
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 50), 1), 200);
$function$;
REVOKE ALL ON FUNCTION public.get_public_profiles(uuid[], text, uuid, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_public_profiles(uuid[], text, uuid, integer) TO authenticated;

-- Teachers retain access to their own classes. Student class details are
-- returned without invite codes by the trusted function below.
DROP POLICY IF EXISTS "Anyone can read group by invite code" ON public.groups;
ALTER POLICY "Teachers can manage their groups" ON public.groups
  TO authenticated
  USING ((SELECT auth.uid()) = teacher_id)
  WITH CHECK ((SELECT auth.uid()) = teacher_id);
REVOKE ALL ON TABLE public.groups FROM anon;
REVOKE ALL ON TABLE public.group_members FROM anon;

CREATE OR REPLACE FUNCTION public.get_student_groups()
RETURNS TABLE (id uuid, name text, teacher_id uuid, created_at timestamptz)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $function$
  SELECT g.id, g.name, g.teacher_id, g.created_at
  FROM public.groups AS g
  JOIN public.group_members AS gm ON gm.group_id = g.id
  WHERE (SELECT auth.uid()) IS NOT NULL
    AND gm.student_id = (SELECT auth.uid())
  ORDER BY g.created_at DESC;
$function$;
REVOKE ALL ON FUNCTION public.get_student_groups() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_student_groups() TO authenticated;

DROP POLICY IF EXISTS "Students can join groups" ON public.group_members;
DROP POLICY IF EXISTS "Students can update their own group membership" ON public.group_members;
ALTER POLICY "Students can view their memberships" ON public.group_members
  TO authenticated
  USING ((SELECT auth.uid()) = student_id);
ALTER POLICY "Teachers can view their group members" ON public.group_members
  TO authenticated;
ALTER POLICY "Teachers can update group members" ON public.group_members
  TO authenticated;
ALTER POLICY "Teachers can delete group members" ON public.group_members
  TO authenticated;
CREATE POLICY "Students can update their own class nickname"
  ON public.group_members FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = student_id)
  WITH CHECK ((SELECT auth.uid()) = student_id);
REVOKE INSERT, UPDATE ON TABLE public.group_members FROM anon, authenticated;
REVOKE INSERT (
  id, group_id, student_id, joined_at, class_nickname
) ON TABLE public.group_members FROM anon, authenticated;
REVOKE UPDATE (
  id, group_id, student_id, joined_at, class_nickname
) ON TABLE public.group_members FROM anon, authenticated;
GRANT UPDATE (class_nickname) ON TABLE public.group_members TO authenticated;

CREATE OR REPLACE FUNCTION public.join_group_by_invite_code(
  p_invite_code text,
  p_class_nickname text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_group_id uuid;
BEGIN
  IF v_user_id IS NULL OR NULLIF(btrim(p_invite_code), '') IS NULL THEN
    RETURN false;
  END IF;

  SELECT g.id INTO v_group_id
  FROM public.groups AS g
  WHERE g.invite_code = upper(btrim(p_invite_code))
    AND g.teacher_id IS DISTINCT FROM v_user_id;

  IF v_group_id IS NULL THEN
    RETURN false;
  END IF;

  INSERT INTO public.group_members (group_id, student_id, class_nickname)
  VALUES (v_group_id, v_user_id, NULLIF(btrim(p_class_nickname), ''))
  ON CONFLICT (group_id, student_id) DO NOTHING;
  RETURN true;
END;
$function$;
REVOKE ALL ON FUNCTION public.join_group_by_invite_code(text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.join_group_by_invite_code(text, text) TO authenticated;

-- Notifications are generated only from a successfully authorized event.
DROP POLICY IF EXISTS "Auth insert notifications" ON public.notifications;
ALTER POLICY "Auth read own notifications" ON public.notifications
  TO authenticated
  USING ((SELECT auth.uid()) = user_id);
ALTER POLICY "Auth update own notifications" ON public.notifications
  TO authenticated
  USING ((SELECT auth.uid()) = user_id)
  WITH CHECK ((SELECT auth.uid()) = user_id);
REVOKE INSERT, UPDATE ON TABLE public.notifications FROM anon, authenticated;
REVOKE INSERT (
  id, user_id, type, title, body, related_id, is_read, created_at
) ON TABLE public.notifications FROM anon, authenticated;
REVOKE UPDATE (
  id, user_id, type, title, body, related_id, is_read, created_at
) ON TABLE public.notifications FROM anon, authenticated;
GRANT UPDATE (is_read) ON TABLE public.notifications TO authenticated;
REVOKE ALL ON TABLE public.notifications FROM anon;

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.notify_friend_request()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.status = 'pending' AND NEW.requester_id <> NEW.addressee_id THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (
      NEW.addressee_id,
      'friend_request',
      'Новая заявка в друзья',
      'Кто-то хочет добавить вас в друзья',
      NEW.requester_id
    );
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.notify_friend_request() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.notify_direct_message()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  IF NEW.sender_id <> NEW.receiver_id THEN
    INSERT INTO public.notifications (user_id, type, title, body, related_id)
    VALUES (
      NEW.receiver_id,
      'message',
      'Новое сообщение',
      left(NEW.content, 80),
      NEW.sender_id
    );
  END IF;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.notify_direct_message() FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.notify_group_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
  INSERT INTO public.notifications (user_id, type, title, body, related_id)
  SELECT gm.student_id,
         'assignment',
         'Новое задание',
         'Преподаватель добавил задание: ' || COALESCE(m.title, 'Новое задание'),
         NEW.id
  FROM public.group_members AS gm
  LEFT JOIN public.materials AS m ON m.id = NEW.material_id
  WHERE gm.group_id = NEW.group_id;
  RETURN NEW;
END;
$function$;
REVOKE ALL ON FUNCTION private.notify_group_assignment() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS friendship_notification_after_insert ON public.friendships;
CREATE TRIGGER friendship_notification_after_insert
  AFTER INSERT ON public.friendships
  FOR EACH ROW EXECUTE FUNCTION private.notify_friend_request();
DROP TRIGGER IF EXISTS direct_message_notification_after_insert ON public.direct_messages;
CREATE TRIGGER direct_message_notification_after_insert
  AFTER INSERT ON public.direct_messages
  FOR EACH ROW EXECUTE FUNCTION private.notify_direct_message();
DROP TRIGGER IF EXISTS assignment_notification_after_insert ON public.assignments;
CREATE TRIGGER assignment_notification_after_insert
  AFTER INSERT ON public.assignments
  FOR EACH ROW EXECUTE FUNCTION private.notify_group_assignment();

-- A like and its denormalized counter change together, once, under the caller's
-- identity. Clients cannot mutate either side of the relationship directly.
CREATE OR REPLACE FUNCTION public.toggle_material_like(
  p_material_id uuid,
  p_like boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL OR p_like IS NULL THEN
    RAISE EXCEPTION 'An authenticated user and a like state are required'
      USING ERRCODE = '28000';
  END IF;

  IF p_like THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.materials AS m
      WHERE m.id = p_material_id AND m.is_public IS TRUE
    ) THEN
      RAISE EXCEPTION 'Public material not found' USING ERRCODE = 'P0002';
    END IF;

    INSERT INTO public.material_likes (user_id, material_id)
    VALUES (v_user_id, p_material_id)
    ON CONFLICT (user_id, material_id) DO NOTHING;

    IF FOUND THEN
      UPDATE public.materials
      SET likes_count = GREATEST(COALESCE(likes_count, 0) + 1, 0)
      WHERE id = p_material_id;
    END IF;
  ELSE
    DELETE FROM public.material_likes
    WHERE user_id = v_user_id AND material_id = p_material_id;

    IF FOUND THEN
      UPDATE public.materials
      SET likes_count = GREATEST(COALESCE(likes_count, 0) - 1, 0)
      WHERE id = p_material_id;
    END IF;
  END IF;

  RETURN p_like;
END;
$function$;
REVOKE ALL ON FUNCTION public.toggle_material_like(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.toggle_material_like(uuid, boolean) TO authenticated;
REVOKE INSERT, DELETE ON TABLE public.material_likes FROM anon, authenticated;
REVOKE ALL ON TABLE public.material_likes FROM anon;
REVOKE EXECUTE ON FUNCTION public.increment_likes(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.decrement_likes(uuid) FROM PUBLIC, anon, authenticated;
