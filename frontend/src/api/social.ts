import { supabase } from '../lib/supabase';

export interface UserProfile {
  id: string;
  full_name: string;
  avatar_url?: string;
  bio?: string;
  university?: string;
  streak_days: number;
  total_reviews: number;
  total_materials: number;
  onboarding_status?: Record<string, boolean>;
  is_pro?: boolean;
  pro_until?: string;
}

/** The signed-in user's own profile row; null for any other id (the app shows no one else's profile). */
export async function getProfile(userId: string): Promise<UserProfile | null> {
  const { data: authData } = await supabase.auth.getUser();
  if (authData.user?.id !== userId) return null;
  const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).single();
  if (error) { console.error('getProfile error:', error); return null; }
  return data;
}

export async function updateProfile(userId: string, updates: Partial<UserProfile>) {
  const { error } = await supabase.from('profiles').update(updates).eq('id', userId);
  if (error) console.error('updateProfile error:', error);
  return !error;
}

export async function markOnboardingTourSeen(userId: string, tourKey: string) {
  // We need to merge the existing JSONB. Wait, supabase update with JSONB replaces it unless we use rpc.
  // Actually, we can fetch, merge, and update.
  const p = await getProfile(userId);
  if (!p) return;
  const current = p.onboarding_status || {};
  if (current[tourKey]) return; // already seen

  const next = { ...current, [tourKey]: true };
  await updateProfile(userId, { onboarding_status: next });
}

export async function uploadAvatar(userId: string, file: File): Promise<string | null> {
  const fileExt = file.name.split('.').pop() || 'png';
  const fileName = `${userId}-${Date.now()}.${fileExt}`;

  const { error: uploadError } = await supabase.storage
    .from('avatars')
    .upload(fileName, file, { cacheControl: '3600', upsert: true });

  if (uploadError) {
    console.error('Avatar upload error:', uploadError);
    return null;
  }

  const { data } = supabase.storage.from('avatars').getPublicUrl(fileName);
  return data.publicUrl;
}
