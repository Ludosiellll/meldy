-- Profiles are created by the trusted auth.users trigger. Client sessions may
-- edit only the profile fields exposed by the application, never PRO status,
-- counters, timestamps of creation, or row identity.
REVOKE INSERT, UPDATE ON TABLE public.profiles FROM anon, authenticated;

REVOKE INSERT (
  id,
  full_name,
  streak_days,
  last_active_date,
  total_reviews,
  total_materials,
  created_at,
  updated_at,
  avatar_url,
  bio,
  university,
  role,
  onboarding_status,
  is_pro,
  public_id
) ON TABLE public.profiles FROM anon, authenticated;

REVOKE UPDATE (
  id,
  full_name,
  streak_days,
  last_active_date,
  total_reviews,
  total_materials,
  created_at,
  updated_at,
  avatar_url,
  bio,
  university,
  role,
  onboarding_status,
  is_pro,
  public_id
) ON TABLE public.profiles FROM anon, authenticated;

GRANT UPDATE (
  full_name,
  avatar_url,
  bio,
  university,
  role,
  onboarding_status,
  public_id,
  updated_at
) ON TABLE public.profiles TO authenticated;
