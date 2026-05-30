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
  type: 'friend_request' | 'message' | 'like' | 'invite' | 'assignment';
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
  const q = query.replace('#', '').trim();
  const { data, error } = await supabase
    .from('profiles')
    .select('id, full_name, avatar_url, university, public_id')
    .neq('id', currentUserId)
    .or(`full_name.ilike.%${query}%,public_id.eq.${q}`)
    .limit(20);
  if (error) return [];
  return data || [];
}

// ── Блокировки ────────────────────────────────────────────────────────────────

export async function blockUser(blockerId: string, blockedId: string) {
  const { error } = await supabase.from('user_blocks').insert({
    blocker_id: blockerId,
    blocked_id: blockedId
  });
  return !error;
}

export async function unblockUser(blockerId: string, blockedId: string) {
  const { error } = await supabase.from('user_blocks').delete().match({
    blocker_id: blockerId,
    blocked_id: blockedId
  });
  return !error;
}

export async function getBlockedUserIds(userId: string): Promise<string[]> {
  const { data } = await supabase
    .from('user_blocks')
    .select('blocked_id')
    .eq('blocker_id', userId);
  return (data || []).map(b => b.blocked_id);
}

// ── Чат (Realtime) ───────────────────────────────────────────────────────────

export interface ChatContact {
  id: string;
  friend_id: string; // To match the old API structure for Messages
  friend_name: string;
  friend_avatar?: string;
}

export async function getChats(userId: string): Promise<ChatContact[]> {
  const { data: sent } = await supabase.from('direct_messages').select('receiver_id').eq('sender_id', userId);
  const { data: received } = await supabase.from('direct_messages').select('sender_id').eq('receiver_id', userId);
  
  const ids = new Set([
    ...(sent || []).map(d => d.receiver_id),
    ...(received || []).map(d => d.sender_id)
  ]);
  
  if (ids.size === 0) return [];
  
  const { data: profiles } = await supabase.from('profiles').select('id, full_name, avatar_url').in('id', Array.from(ids));
  
  return (profiles || []).map(p => ({
    id: p.id,
    friend_id: p.id,
    friend_name: p.full_name || 'Неизвестный',
    friend_avatar: p.avatar_url
  }));
}

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
    .on('postgres_changes', 
      { event: 'INSERT', schema: 'public', table: 'direct_messages' },
      (payload) => {
        const msg = payload.new as DirectMessage;
        if (msg && (msg.sender_id === userId || msg.receiver_id === userId)) {
          onMessage(msg);
        }
      }
    )
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

export async function getUnreadDMsGrouped(userId: string): Promise<Record<string, number>> {
  const { data } = await supabase
    .from('notifications')
    .select('related_id')
    .eq('user_id', userId)
    .eq('type', 'message')
    .eq('is_read', false);
  
  const counts: Record<string, number> = {};
  if (data) {
    data.forEach(n => {
      if (n.related_id) {
        counts[n.related_id] = (counts[n.related_id] || 0) + 1;
      }
    });
  }
  return counts;
}

export async function markNotificationsAsReadForSender(userId: string, senderId: string) {
  await supabase
    .from('notifications')
    .update({ is_read: true })
    .eq('user_id', userId)
    .eq('related_id', senderId)
    .eq('type', 'message')
    .eq('is_read', false);
}

export function subscribeToNotifications(userId: string, onChange: (payload: any) => void) {
  const channel = supabase
    .channel(`notif_${userId}`)
    .on('postgres_changes', 
      { event: 'INSERT', schema: 'public', table: 'notifications' },
      (payload) => {
        const notif = payload.new as Notification;
        if (notif && notif.user_id === userId) {
          onChange(payload);
        }
      }
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

export function subscribeToFriendships(userId: string, onChange: () => void) {
  const channel = supabase
    .channel(`friendships_${userId}`)
    .on('postgres_changes', 
      { event: '*', schema: 'public', table: 'friendships' },
      (payload) => {
        const f = (payload.new || payload.old) as Friendship;
        if (f && (f.requester_id === userId || f.addressee_id === userId)) {
          onChange();
        }
      }
    )
    .subscribe();
  return () => supabase.removeChannel(channel);
}

// ── Групповой чат (Realtime) ─────────────────────────────────────────────────

export interface GroupChatMessage {
  id: string;
  group_id: string;
  sender_id: string;
  content: string;
  created_at: string;
}

export async function getGroupMessages(groupId: string): Promise<GroupChatMessage[]> {
  const { data, error } = await supabase
    .from('group_chat_messages')
    .select('*')
    .eq('group_id', groupId)
    .order('created_at', { ascending: true })
    .limit(200);
  if (error) console.error('getGroupMessages error:', error);
  return data || [];
}

export async function sendGroupMessage(groupId: string, senderId: string, content: string) {
  const { data, error } = await supabase.from('group_chat_messages').insert({
    group_id: groupId,
    sender_id: senderId,
    content
  }).select('*').single();
  if (error) console.error('sendGroupMessage error:', error);
  return data;
}

export function subscribeToGroupChat(groupId: string, onMessage: (msg: GroupChatMessage) => void) {
  const channel = supabase
    .channel(`group_chat_${groupId}`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'group_chat_messages', filter: `group_id=eq.${groupId}` },
      (payload) => onMessage(payload.new as GroupChatMessage))
    .subscribe();
  return () => supabase.removeChannel(channel);
}
