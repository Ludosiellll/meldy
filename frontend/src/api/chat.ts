import { supabase } from '../lib/supabase';

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  friend_id?: string;
  friend_name?: string;
  friend_avatar?: string;
}

export interface DirectMessage {
  id: string;
  sender_id: string;
  receiver_id: string;
  content: string;
  created_at: string;
}

export interface Notification {
  id: string;
  user_id: string;
  type: 'friend_request' | 'message' | 'like' | 'invite';
  title: string;
  body?: string;
  related_id?: string;
  is_read: boolean;
  created_at: string;
}

// ── Друзья ────────────────────────────────────────────────────────────────────

export async function getFriends(userId: string): Promise<Friendship[]> {
  const { data, error } = await supabase
    .from('friendships')
    .select('*')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .neq('status', 'declined');

  if (error || !data) return [];

  const friendIds = data.map(f => f.requester_id === userId ? f.addressee_id : f.requester_id);
  if (friendIds.length === 0) return [];

  const { data: profiles } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', friendIds);
  const profileMap = new Map((profiles || []).map(p => [p.id, p]));

  return data.map(f => {
    const friendId = f.requester_id === userId ? f.addressee_id : f.requester_id;
    const p = profileMap.get(friendId);
    return {
      ...f,
      friend_id: friendId,
      friend_name: p?.full_name || 'Неизвестный',
      friend_avatar: p?.avatar_url
    };
  });
}

export async function sendFriendRequest(requesterId: string, addresseeId: string) {
  const { error } = await supabase.from('friendships').insert({
    requester_id: requesterId,
    addressee_id: addresseeId,
    status: 'pending'
  });
  if (!error) {
    // Создаём уведомление адресату
    await supabase.from('notifications').insert({
      user_id: addresseeId,
      type: 'friend_request',
      title: 'Новая заявка в друзья',
      body: 'Кто-то хочет добавить вас в друзья',
      related_id: requesterId
    });
  }
  return !error;
}

export async function respondFriendRequest(friendshipId: string, status: 'accepted' | 'declined') {
  const { error } = await supabase.from('friendships').update({ status }).eq('id', friendshipId);
  return !error;
}

export async function searchUsers(query: string, currentUserId: string) {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, university')
    .ilike('full_name', `%${query}%`)
    .neq('id', currentUserId)
    .limit(20);
  if (error) return [];
  return data || [];
}

// ── Чат (Realtime) ───────────────────────────────────────────────────────────

export async function getMessages(user1: string, user2: string): Promise<DirectMessage[]> {
  const { data, error } = await supabase
    .from('direct_messages')
    .select('*')
    .or(`and(sender_id.eq.${user1},receiver_id.eq.${user2}),and(sender_id.eq.${user2},receiver_id.eq.${user1})`)
    .order('created_at', { ascending: true })
    .limit(100);
  if (error) console.error('getMessages error:', error);
  return data || [];
}

export async function sendMessage(senderId: string, receiverId: string, content: string) {
  const { data, error } = await supabase.from('direct_messages').insert({
    sender_id: senderId,
    receiver_id: receiverId,
    content
  }).select('*').single();

  if (!error) {
    // Уведомление получателю
    await supabase.from('notifications').insert({
      user_id: receiverId,
      type: 'message',
      title: 'Новое сообщение',
      body: content.slice(0, 80),
      related_id: senderId
    });
  }
  if (error) console.error('sendMessage error:', error);
  return data;
}

export function subscribeToMessages(userId: string, onMessage: (msg: DirectMessage) => void) {
  const channel = supabase
    .channel(`dm_${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `receiver_id=eq.${userId}` },
      (payload) => onMessage(payload.new as DirectMessage))
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'direct_messages', filter: `sender_id=eq.${userId}` },
      (payload) => onMessage(payload.new as DirectMessage))
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ── Уведомления ──────────────────────────────────────────────────────────────

export async function getNotifications(userId: string): Promise<Notification[]> {
  const { data } = await supabase
    .from('notifications')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(30);
  return data || [];
}

export async function getUnreadCount(userId: string): Promise<number> {
  const { count } = await supabase
    .from('notifications')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_read', false);
  return count || 0;
}

export async function markAllRead(userId: string) {
  await supabase.from('notifications').update({ is_read: true }).eq('user_id', userId).eq('is_read', false);
}

export function subscribeToNotifications(userId: string, onChange: () => void) {
  const channel = supabase
    .channel(`notif_${userId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications', filter: `user_id=eq.${userId}` },
      onChange)
    .subscribe();
  return () => supabase.removeChannel(channel);
}
