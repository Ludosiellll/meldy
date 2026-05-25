import { supabase } from '../lib/supabase';

export interface Friendship {
  id: string;
  requester_id: string;
  addressee_id: string;
  status: 'pending' | 'accepted' | 'declined';
  created_at: string;
  // Поля, которые мы подтянем (имя друга)
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

// ── Друзья ────────────────────────────────────────────────────────────────────

export async function getFriends(userId: string): Promise<Friendship[]> {
  const { data, error } = await supabase
    .from('friendships')
    .select('*')
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`)
    .neq('status', 'declined');

  if (error || !data) return [];

  // Достаем профили друзей
  const friendIds = data.map(f => f.requester_id === userId ? f.addressee_id : f.requester_id);
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
  return !error;
}

export async function respondFriendRequest(friendshipId: string, status: 'accepted' | 'declined') {
  const { error } = await supabase.from('friendships').update({ status }).eq('id', friendshipId);
  return !error;
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
  
  if (error) console.error('sendMessage error:', error);
  return data;
}

// Подписка на новые сообщения
export function subscribeToMessages(userId: string, onMessage: (msg: DirectMessage) => void) {
  const channel = supabase
    .channel('direct_messages_channel')
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'direct_messages',
        filter: `receiver_id=eq.${userId}`
      },
      (payload) => {
        onMessage(payload.new as DirectMessage);
      }
    )
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'direct_messages',
        filter: `sender_id=eq.${userId}`
      },
      (payload) => {
        // Чтобы получать свои же отправленные сообщения на других устройствах
        onMessage(payload.new as DirectMessage);
      }
    )
    .subscribe();

  return () => {
    supabase.removeChannel(channel);
  };
}
