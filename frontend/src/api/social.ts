import { supabase } from '../lib/supabase';

export interface UserProfile {
  id: string;
  public_id?: string;
  full_name: string;
  avatar_url?: string;
  bio?: string;
  university?: string;
  streak_days: number;
  total_reviews: number;
  total_materials: number;
  role?: string;
  onboarding_status?: Record<string, boolean>;
  is_pro?: boolean;
  pro_until?: string;
}

export interface PublicMaterial {
  id: string;
  title: string;
  subject: string;
  user_id: string;
  created_at: string;
  likes_count: number;
  author_name?: string;
  author_avatar?: string;
  is_liked_by_me?: boolean;
}

export interface LeaderboardEntry {
  id: string;
  full_name: string;
  avatar_url?: string;
  total_xp: number;
  level: number;
}

export interface PublicProfile {
  id: string;
  full_name: string;
  avatar_url: string | null;
  bio: string | null;
  university: string | null;
  public_id: string | null;
  streak_days: number;
  total_reviews: number;
  total_materials: number;
  role: string | null;
}

export async function getPublicProfiles(
  userIds: string[] | null = null,
  query: string | null = null,
  excludeUserId: string | null = null,
  limit = 50,
): Promise<PublicProfile[]> {
  const { data, error } = await supabase.rpc('get_public_profiles', {
    p_user_ids: userIds?.length ? userIds : null,
    p_query: query?.trim() || null,
    p_exclude_user_id: excludeUserId,
    p_limit: limit,
  });
  if (error) {
    console.error('getPublicProfiles error:', error);
    return [];
  }
  return data || [];
}

export async function ensurePublicId(userId: string): Promise<string> {
  let unique = false;
  let newId = '';
  while (!unique) {
    const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    newId = '';
    for (let i = 0; i < 6; i++) {
      newId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    const { error } = await supabase.from('profiles').update({ public_id: newId }).eq('id', userId);
    if (!error) {
      unique = true;
    } else if (error.code !== '23505') { // Not a unique constraint violation
      break;
    }
  }
  return newId;
}

export async function getProfile(userId: string): Promise<UserProfile | null> {
  const { data: authData } = await supabase.auth.getUser();
  const isOwnProfile = authData.user?.id === userId;
  const { data, error } = isOwnProfile
    ? await supabase.from('profiles').select('*').eq('id', userId).single()
    : { data: null, error: null };
  if (error) { console.error('getProfile error:', error); return null; }

  if (!isOwnProfile) {
    const [publicProfile] = await getPublicProfiles([userId], null, null, 1);
    if (!publicProfile) return null;
    return {
      id: publicProfile.id,
      public_id: publicProfile.public_id || undefined,
      full_name: publicProfile.full_name,
      avatar_url: publicProfile.avatar_url || undefined,
      bio: publicProfile.bio || undefined,
      university: publicProfile.university || undefined,
      role: publicProfile.role || undefined,
      streak_days: publicProfile.streak_days || 0,
      total_reviews: publicProfile.total_reviews || 0,
      total_materials: publicProfile.total_materials || 0,
    };
  }
  
  if (data && !data.public_id) {
    const newId = await ensurePublicId(userId);
    data.public_id = newId;
  }
  
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

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data: xpData, error: xpError } = await supabase
    .from('user_xp')
    .select('user_id, total_xp')
    .order('total_xp', { ascending: false })
    .limit(50);
  if (xpError || !xpData) return [];

  const userIds = xpData.map(x => x.user_id);
  const profiles = await getPublicProfiles(userIds);

  const profileMap = new Map((profiles || []).map(p => [p.id, p]));

  return xpData.map(xp => {
    const p = profileMap.get(xp.user_id);
    return {
      id: xp.user_id,
      full_name: p?.full_name || 'Студент',
      avatar_url: p?.avatar_url || undefined,
      total_xp: xp.total_xp,
      level: 1,
    };
  });
}

export async function getPublicMaterials(currentUserId: string): Promise<PublicMaterial[]> {
  const { data, error } = await supabase
    .from('materials')
    .select('id, title, subject, user_id, created_at, likes_count')
    .eq('is_public', true)
    .order('likes_count', { ascending: false })
    .limit(50);

  if (error || !data) return [];

  const { data: myLikes } = await supabase
    .from('material_likes')
    .select('material_id')
    .eq('user_id', currentUserId);
  const myLikedIds = new Set((myLikes || []).map(l => l.material_id));

  const authorIds = [...new Set(data.map(m => m.user_id))];
  const profiles = await getPublicProfiles(authorIds);
  const profileMap = new Map((profiles || []).map(p => [p.id, p]));

  return data.map(m => {
    const author = profileMap.get(m.user_id);
    return {
      ...m,
      author_name: author?.full_name || 'Студент',
      author_avatar: author?.avatar_url || undefined,
      is_liked_by_me: myLikedIds.has(m.id)
    };
  });
}

// Атомарный лайк через RPC — без race condition
export async function toggleLike(materialId: string, isCurrentlyLiked: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('toggle_material_like', {
    p_material_id: materialId,
    p_like: !isCurrentlyLiked,
  });
  if (error) {
    console.error('toggleLike error:', error);
    return false;
  }
  return data === !isCurrentlyLiked;
}

// Скопировать чужой публичный материал в свою библиотеку
export async function copyMaterialToLibrary(materialId: string, targetUserId: string): Promise<boolean> {
  const { data: src, error: srcErr } = await supabase
    .from('materials')
    .select('title, subject, original_text, summary_json, flashcards_json, quiz_json, missions_json')
    .eq('id', materialId)
    .single();
  if (srcErr || !src) return false;

  const { error } = await supabase.from('materials').insert({
    user_id: targetUserId,
    title: src.title + ' (копия)',
    subject: src.subject,
    original_text: src.original_text,
    summary_json: src.summary_json,
    flashcards_json: src.flashcards_json,
    quiz_json: src.quiz_json,
    missions_json: src.missions_json,
    is_public: false,
    likes_count: 0,
  });
  return !error;
}

export async function getPublicMaterialPreview(materialId: string) {
  const { data, error } = await supabase
    .from('materials')
    .select('summary_json, flashcards_json, quiz_json')
    .eq('id', materialId)
    .single();
    
  if (error) {
    console.error('getPublicMaterialPreview error:', error);
    return null;
  }
  return data;
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
