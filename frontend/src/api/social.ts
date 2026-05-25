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
  role?: string;
  onboarding_status?: Record<string, boolean>;
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

export async function getProfile(userId: string): Promise<UserProfile | null> {
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

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  const { data: xpData, error: xpError } = await supabase
    .from('user_xp')
    .select('user_id, total_xp')
    .order('total_xp', { ascending: false })
    .limit(50);
  if (xpError || !xpData) return [];

  const userIds = xpData.map(x => x.user_id);
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url')
    .in('id', userIds);

  const profileMap = new Map((profiles || []).map(p => [p.id, p]));

  return xpData.map(xp => {
    const p = profileMap.get(xp.user_id);
    return {
      id: xp.user_id,
      full_name: p?.full_name || 'Студент',
      avatar_url: p?.avatar_url,
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
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url')
    .in('id', authorIds);
  const profileMap = new Map((profiles || []).map(p => [p.id, p]));

  return data.map(m => {
    const author = profileMap.get(m.user_id);
    return {
      ...m,
      author_name: author?.full_name || 'Студент',
      author_avatar: author?.avatar_url,
      is_liked_by_me: myLikedIds.has(m.id)
    };
  });
}

// Атомарный лайк через RPC — без race condition
export async function toggleLike(userId: string, materialId: string, isCurrentlyLiked: boolean) {
  if (isCurrentlyLiked) {
    await supabase.from('material_likes').delete().match({ user_id: userId, material_id: materialId });
    await supabase.rpc('decrement_likes', { material_id: materialId });
  } else {
    const { error } = await supabase.from('material_likes').insert({ user_id: userId, material_id: materialId });
    if (!error) await supabase.rpc('increment_likes', { material_id: materialId });
  }
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
