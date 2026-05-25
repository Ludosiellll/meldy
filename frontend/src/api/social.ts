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
  if (error) {
    console.error('getProfile error:', error);
    return null;
  }
  return data;
}

export async function updateProfile(userId: string, updates: Partial<UserProfile>) {
  const { error } = await supabase.from('profiles').update(updates).eq('id', userId);
  if (error) console.error('updateProfile error:', error);
  return !error;
}

export async function getLeaderboard(): Promise<LeaderboardEntry[]> {
  // Получаем топ юзеров по XP
  const { data: xpData, error: xpError } = await supabase
    .from('user_xp')
    .select('user_id, total_xp')
    .order('total_xp', { ascending: false })
    .limit(50);
    
  if (xpError || !xpData) return [];

  // Получаем их профили
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
      full_name: p?.full_name || 'Неизвестный',
      avatar_url: p?.avatar_url,
      total_xp: xp.total_xp,
      level: 1, // На фронте рассчитаем уровень через calcLevel
    };
  });
}

export async function getPublicMaterials(currentUserId: string): Promise<PublicMaterial[]> {
  const { data, error } = await supabase
    .from('materials')
    .select('id, title, subject, user_id, created_at, likes_count')
    .eq('is_public', true)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !data) return [];

  // Получаем лайки текущего пользователя
  const { data: myLikes } = await supabase
    .from('material_likes')
    .select('material_id')
    .eq('user_id', currentUserId);
  const myLikedIds = new Set((myLikes || []).map(l => l.material_id));

  // Получаем профили авторов
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

export async function toggleLike(userId: string, materialId: string, isCurrentlyLiked: boolean) {
  if (isCurrentlyLiked) {
    await supabase.from('material_likes').delete().match({ user_id: userId, material_id: materialId });
    // Декремент в RPC или руками (упрощенно)
    const { data: m } = await supabase.from('materials').select('likes_count').eq('id', materialId).single();
    if (m) await supabase.from('materials').update({ likes_count: Math.max(0, m.likes_count - 1) }).eq('id', materialId);
  } else {
    await supabase.from('material_likes').insert({ user_id: userId, material_id: materialId });
    // Инкремент (упрощенно)
    const { data: m } = await supabase.from('materials').select('likes_count').eq('id', materialId).single();
    if (m) await supabase.from('materials').update({ likes_count: m.likes_count + 1 }).eq('id', materialId);
  }
}
