import { Material } from '../types';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getChats, ChatContact, getMessages, sendMessage, subscribeToMessages, DirectMessage, sendFriendRequest, getFriends, Friendship, respondFriendRequest, searchUsers } from '../api/chat';
import { Send, UserCircle2, MessageSquare, Loader2, BookOpen, Link2, ChevronLeft, UserPlus, Users, Check, X, Search } from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { getMaterials, updateMaterialVisibility } from '../api/materials';
import { getProfile } from '../api/social';
import toast from 'react-hot-toast';

export default function Messages() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id: urlId } = useParams();
  
  const [viewTab, setViewTab] = useState<'chats' | 'friends'>('chats');
  
  const [friends, setFriends] = useState<ChatContact[]>([]);
  const [friendships, setFriendships] = useState<Friendship[]>([]);
  
  const [activeFriend, setActiveFriend] = useState<ChatContact | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [myMaterials, setMyMaterials] = useState<any[]>([]);
  const [friendRequestSent, setFriendRequestSent] = useState(false);
  
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<any[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => { setFriendRequestSent(false); }, [activeFriend]);

  const loadData = async () => {
    if (!user) return;
    const chats = await getChats(user.id);
    const fs = await getFriends(user.id);
    
    if (urlId && !chats.some(c => c.friend_id === urlId)) {
      const p = await getProfile(urlId);
      if (p) {
        chats.unshift({ id: p.id, friend_id: p.id, friend_name: p.full_name, friend_avatar: p.avatar_url });
      }
    }
    
    setFriends(chats);
    setFriendships(fs);
    
    if (urlId) {
      setActiveFriend(chats.find(c => c.friend_id === urlId) || null);
    }
    setLoading(false);
  };

  useEffect(() => {
    loadData();
    if (user) {
      getMaterials(user.id).then(setMyMaterials);
    }
  }, [user?.id, urlId]);

  // Subscribe to ALL incoming messages globally on Messages page
  useEffect(() => {
    if (!user) return;

    const unsubscribe = subscribeToMessages(user.id, (msg) => {
      // Reload chats list so new conversations show up immediately
      getChats(user.id).then(setFriends);

      // If the message belongs to the currently active friend thread, append it
      setActiveFriend(current => {
        if (current && (msg.sender_id === current.friend_id || msg.receiver_id === current.friend_id)) {
          setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
        }
        return current;
      });
    });

    return () => { unsubscribe(); };
  }, [user?.id]);

  // Load message history when active friend changes
  useEffect(() => {
    if (!user || !activeFriend) {
      setMessages([]);
      return;
    }
    getMessages(user.id, activeFriend.friend_id!).then(setMessages);
  }, [user?.id, activeFriend?.friend_id]);

  useEffect(() => {
    if (!user || !searchQuery.trim()) {
      setSearchResults([]);
      return;
    }
    const timer = setTimeout(async () => {
      setIsSearching(true);
      const res = await searchUsers(searchQuery, user.id);
      setSearchResults(res);
      setIsSearching(false);
    }, 500);
    return () => clearTimeout(timer);
  }, [searchQuery, user?.id]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !activeFriend || !newMessage.trim()) return;
    const content = newMessage.trim();
    setNewMessage('');
    const msg = await sendMessage(user.id, activeFriend.friend_id!, content);
    if (msg) {
      setMessages(prev => [...prev, msg]);
    } else {
      toast.error('Не удалось отправить сообщение. Возможно, вы заблокированы.');
    }
  };

  const handleSendInvite = async (material: Material) => {
    if (!user || !activeFriend) return;
    
    // Сделаем материал публичным, чтобы получатель мог его открыть
    if (!material.is_public) {
      await updateMaterialVisibility(material.id, true);
    }
    
    const inviteText = `[MATERIAL_INVITE:${material.id}] 📚 Приглашаю изучить материал: «${material.title}» (${material.subject || 'Без предмета'})`;
    setShowInvite(false);
    const msg = await sendMessage(user.id, activeFriend.friend_id!, inviteText);
    if (msg) {
      setMessages(prev => [...prev, msg]);
      toast.success('Материал отправлен!');
    } else {
      toast.error('Не удалось отправить материал.');
    }
  };

  const handleRespondRequest = async (friendshipId: string, status: 'accepted' | 'declined') => {
    const success = await respondFriendRequest(friendshipId, status);
    if (success) {
      toast.success(status === 'accepted' ? 'Заявка принята!' : 'Заявка отклонена');
      loadData();
    } else {
      toast.error('Произошла ошибка при обработке заявки.');
    }
  };

  if (loading) {
    return <div className="flex h-[calc(100vh-48px)] items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>;
  }

  const incomingRequests = friendships.filter(f => f.addressee_id === user?.id && f.status === 'pending');
  const acceptedFriends = friendships.filter(f => f.status === 'accepted');

  return (
    <div className="flex h-[calc(100vh-80px)] md:h-[calc(100vh-48px)] bg-white dark:bg-slate-900 md:rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden md:m-6 m-0 relative">

      {/* Левая панель */}
      <div className={`w-full md:w-80 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 shrink-0 ${activeFriend ? 'hidden md:flex md:flex-col' : 'flex flex-col'}`}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <h2 className="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Users className="w-5 h-5 text-indigo-500" />
            Друзья и Диалоги
          </h2>
          <div className="flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl">
            <button
              onClick={() => setViewTab('chats')}
              className={`flex-1 text-xs font-bold py-2 px-3 rounded-lg transition-all ${viewTab === 'chats' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              Диалоги
            </button>
            <button
              onClick={() => setViewTab('friends')}
              className={`flex-1 flex justify-center items-center gap-1 text-xs font-bold py-2 px-3 rounded-lg transition-all ${viewTab === 'friends' ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-sm' : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'}`}
            >
              Друзья
              {incomingRequests.length > 0 && (
                <span className="bg-rose-500 text-white text-[10px] px-1.5 py-0.5 rounded-full">{incomingRequests.length}</span>
              )}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {viewTab === 'chats' ? (
            friends.length === 0 ? (
              <div className="p-6 text-center">
                <MessageSquare className="w-10 h-10 text-slate-200 dark:text-slate-800 mx-auto mb-3" />
                <p className="text-sm text-slate-500 dark:text-slate-400">У вас пока нет диалогов.</p>
                <button
                  onClick={() => setViewTab('friends')}
                  className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 font-bold hover:text-indigo-700 dark:hover:text-indigo-300"
                >
                  Перейти к друзьям →
                </button>
              </div>
            ) : (
              friends.map(f => (
                <button
                  key={f.id}
                  onClick={() => setActiveFriend(f)}
                  className={`w-full p-4 flex items-center gap-3 text-left transition-colors border-b border-slate-100 dark:border-slate-800/40 ${
                    activeFriend?.id === f.id ? 'bg-indigo-50 dark:bg-indigo-950/40' : 'hover:bg-white dark:hover:bg-slate-800/30'
                  }`}
                >
                  {f.friend_avatar ? (
                    <img src={f.friend_avatar} alt="avatar" className="w-10 h-10 rounded-full object-cover shrink-0" />
                  ) : (
                    <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-800 flex items-center justify-center shrink-0">
                      <UserCircle2 className="w-6 h-6 text-slate-500" />
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-bold text-slate-800 dark:text-slate-200 text-sm truncate">{f.friend_name}</div>
                    <div className="text-xs text-slate-400 dark:text-slate-500">Нажмите, чтобы открыть чат</div>
                  </div>
                </button>
              ))
            )
          ) : (
            <div className="p-4 space-y-6">
              {/* Поиск пользователей */}
              <div>
                <div className="relative mb-4">
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="Поиск по имени или ID..."
                    className="w-full bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl pl-10 pr-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 transition dark:text-white placeholder-slate-400"
                  />
                  <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
                  {isSearching && (
                    <Loader2 className="w-4 h-4 text-indigo-500 animate-spin absolute right-3.5 top-3" />
                  )}
                </div>

                {searchQuery.trim() && (
                  <div className="mb-6 space-y-2">
                    <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-2">Результаты поиска</h3>
                    {searchResults.length === 0 && !isSearching ? (
                      <p className="text-sm text-slate-500 dark:text-slate-400 text-center py-2">Ничего не найдено</p>
                    ) : (
                      searchResults.map(u => {
                        const isAlreadyFriend = friendships.some(f => (f.requester_id === u.id || f.addressee_id === u.id) && f.status === 'accepted');
                        return (
                          <div key={u.id} className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                            <div className="flex items-center gap-3 min-w-0">
                              {u.avatar_url ? (
                                <img src={u.avatar_url} alt="avatar" className="w-10 h-10 rounded-full object-cover shrink-0" />
                              ) : (
                                <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
                                  <UserCircle2 className="w-6 h-6 text-slate-400" />
                                </div>
                              )}
                              <div className="min-w-0 text-left">
                                <div className="font-bold text-slate-800 dark:text-slate-200 text-sm truncate">{u.full_name || 'Без имени'}</div>
                                <div className="text-xs text-slate-400 dark:text-slate-500">#{u.public_id}</div>
                              </div>
                            </div>
                            <button
                              onClick={() => {
                                const contact: ChatContact = {
                                  id: u.id,
                                  friend_id: u.id,
                                  friend_name: u.full_name || 'Неизвестный',
                                  friend_avatar: u.avatar_url
                                };
                                setActiveFriend(contact);
                              }}
                              className="p-2 text-indigo-600 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/20 rounded-lg transition shrink-0 ml-2"
                              title="Написать"
                            >
                              <MessageSquare className="w-4 h-4" />
                            </button>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>

              {!searchQuery.trim() && incomingRequests.length > 0 && (
                <div>
                  <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3">Заявки в друзья</h3>
                  <div className="space-y-2">
                    {incomingRequests.map(r => (
                      <div key={r.id} className="flex items-center justify-between p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                        <div className="flex items-center gap-2 min-w-0">
                          {r.friend_avatar ? (
                            <img src={r.friend_avatar} alt="avatar" className="w-8 h-8 rounded-full object-cover shrink-0" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
                              <UserCircle2 className="w-5 h-5 text-slate-400" />
                            </div>
                          )}
                          <div className="font-bold text-slate-800 dark:text-slate-200 text-sm truncate">{r.friend_name}</div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleRespondRequest(r.id, 'accepted')}
                            className="p-1.5 text-emerald-600 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-500/10 dark:hover:bg-emerald-500/20 rounded-lg transition"
                          >
                            <Check className="w-4 h-4" />
                          </button>
                          <button
                            onClick={() => handleRespondRequest(r.id, 'declined')}
                            className="p-1.5 text-rose-600 bg-rose-50 hover:bg-rose-100 dark:bg-rose-500/10 dark:hover:bg-rose-500/20 rounded-lg transition"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {!searchQuery.trim() && (
                <div>
                  <h3 className="text-xs font-bold text-slate-400 dark:text-slate-500 uppercase tracking-wider mb-3 flex items-center justify-between">
                    Мои друзья
                    <span className="bg-slate-200 dark:bg-slate-800 px-2 py-0.5 rounded-full text-[10px]">{acceptedFriends.length}</span>
                  </h3>
                {acceptedFriends.length === 0 ? (
                  <div className="text-center py-6">
                    <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">У вас пока нет друзей.</p>
                    <button
                      onClick={() => navigate('/network')}
                      className="text-sm text-indigo-600 dark:text-indigo-400 font-bold hover:underline"
                    >
                      Найти в Study Network
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {acceptedFriends.map(f => (
                      <button
                        key={f.id}
                        onClick={() => {
                          const contact: ChatContact = {
                            id: f.friend_id!,
                            friend_id: f.friend_id!,
                            friend_name: f.friend_name!,
                            friend_avatar: f.friend_avatar
                          };
                          setActiveFriend(contact);
                        }}
                        className="w-full flex items-center gap-3 p-3 bg-white dark:bg-slate-800/50 hover:bg-indigo-50 dark:hover:bg-slate-800 rounded-xl border border-slate-100 dark:border-slate-800 transition"
                      >
                        {f.friend_avatar ? (
                          <img src={f.friend_avatar} alt="avatar" className="w-10 h-10 rounded-full object-cover shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-slate-200 dark:bg-slate-700 flex items-center justify-center shrink-0">
                            <UserCircle2 className="w-6 h-6 text-slate-400" />
                          </div>
                        )}
                        <div className="text-left min-w-0">
                          <div className="font-bold text-slate-800 dark:text-slate-200 text-sm truncate">{f.friend_name}</div>
                          <div className="text-xs text-slate-400 dark:text-slate-500 truncate">Написать сообщение</div>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Правая панель — чат */}
      <div className={`w-full md:flex-1 bg-white dark:bg-slate-900 relative min-w-0 ${!activeFriend ? 'hidden md:flex md:flex-col' : 'flex flex-col'}`}>
        {activeFriend ? (
          <>
            {/* Хедер */}
            <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center gap-3 bg-white dark:bg-slate-900 shadow-sm z-10">
              <button onClick={() => setActiveFriend(null)} className="md:hidden p-2 -ml-2 text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 transition">
                <ChevronLeft className="w-6 h-6" />
              </button>
              {activeFriend.friend_avatar ? (
                <img src={activeFriend.friend_avatar} alt="avatar" className="w-9 h-9 rounded-full object-cover shrink-0" />
              ) : (
                <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0">
                  <UserCircle2 className="w-5 h-5 text-slate-400" />
                </div>
              )}
              <div className="flex-1">
                <div className="font-bold text-slate-800 dark:text-slate-200">{activeFriend.friend_name}</div>
              </div>
              {/* Кнопки */}
              <div className="flex items-center gap-2 relative">
                {!friendRequestSent && !friendships.some(f => f.friend_id === activeFriend.friend_id && (f.status === 'accepted' || f.status === 'pending')) && (
                  <button
                    onClick={async () => {
                      if (!user || !activeFriend) return;
                      await sendFriendRequest(user.id, activeFriend.friend_id!);
                      setFriendRequestSent(true);
                      toast.success('Заявка в друзья отправлена!');
                      loadData();
                    }}
                    className="flex items-center justify-center w-8 h-8 md:w-auto md:px-3 md:py-1.5 text-sm font-bold text-slate-500 hover:text-indigo-600 bg-slate-50 hover:bg-indigo-50 dark:bg-slate-800 dark:hover:bg-indigo-950/40 rounded-lg transition"
                    title="Добавить в друзья"
                  >
                    <UserPlus className="w-4 h-4" />
                    <span className="hidden md:inline md:ml-2">Добавить</span>
                  </button>
                )}

                <button
                  onClick={() => setShowInvite(v => !v)}
                  className="flex items-center justify-center w-8 h-8 md:w-auto md:px-3 md:py-1.5 text-sm font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition rounded-lg"
                  title="Поделиться материалом"
                >
                  <BookOpen className="w-4 h-4" />
                  <span className="hidden md:inline md:ml-2">Поделиться</span>
                </button>

                {showInvite && (
                  <div className="absolute right-0 top-10 w-72 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 z-20 overflow-hidden">
                    <div className="p-3 border-b border-slate-100 dark:border-slate-700">
                      <p className="font-bold text-sm text-slate-800 dark:text-slate-200">Отправить материал в чат</p>
                    </div>
                    <div className="max-h-56 overflow-y-auto divide-y divide-slate-50 dark:divide-slate-700">
                      {myMaterials.length === 0 ? (
                        <p className="p-4 text-sm text-slate-400 dark:text-slate-500 text-center">У вас нет материалов</p>
                      ) : myMaterials.map(m => (
                        <button
                          key={m.id}
                          onClick={() => handleSendInvite(m)}
                          className="w-full p-3 text-left hover:bg-indigo-50 dark:hover:bg-slate-700/50 transition"
                        >
                          <div className="font-medium text-slate-800 dark:text-slate-200 text-sm truncate">{m.title}</div>
                          <div className="text-xs text-slate-400 dark:text-slate-500">{m.subject || 'Без предмета'}</div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Сообщения */}
            <div className="flex-1 overflow-y-auto p-6 space-y-3 bg-slate-50/50 dark:bg-slate-950/20" onClick={() => setShowInvite(false)}>
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-400 dark:text-slate-500 text-sm">
                  Напишите первое сообщение!
                </div>
              ) : (
                messages.map(msg => {
                  const isMe = msg.sender_id === user?.id;
                  const isLegacyInvite = msg.content.startsWith('📚');
                  const isNewInvite = msg.content.startsWith('[MATERIAL_INVITE:');
                  const isInvite = isNewInvite || isLegacyInvite;
                  return (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={msg.id}
                      className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                    >
                      <div className={`max-w-[72%] px-4 py-2.5 rounded-2xl text-sm ${
                        isMe
                          ? 'bg-indigo-600 text-white rounded-tr-sm dark:bg-indigo-650'
                          : isInvite
                            ? 'bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/50 text-slate-800 dark:text-slate-100 rounded-tl-sm shadow-sm'
                            : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 rounded-tl-sm shadow-sm'
                      }`}>
                        {(() => {
                          if (isNewInvite) {
                            const match = msg.content.match(/^\[MATERIAL_INVITE:([a-zA-Z0-9-]+)\]\s*(.*)$/);
                            if (match) {
                              const materialId = match[1];
                              const text = match[2];
                              return (
                                <div>
                                  {(!isMe || true) && (
                                    <div className={`flex items-center gap-1 font-bold text-xs mb-1.5 ${isMe ? 'text-indigo-200' : 'text-amber-600 dark:text-amber-400'}`}>
                                      <Link2 className="w-3 h-3" /> Приглашение к материалу
                                    </div>
                                  )}
                                  <div className="mb-2">{text}</div>
                                  <button
                                    onClick={() => navigate(`/shared/${materialId}`)}
                                    className={`block w-full text-center px-4 py-2 mt-2 rounded-lg font-bold text-sm transition ${
                                      isMe 
                                        ? 'bg-white/20 hover:bg-white/30 text-white' 
                                        : 'bg-indigo-600 hover:bg-indigo-500 text-white shadow-sm'
                                    }`}
                                  >
                                    Открыть материал
                                  </button>
                                </div>
                              );
                            }
                          }
                          return (
                            <>
                              {isLegacyInvite && !isMe && (
                                <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-bold text-xs mb-1">
                                  <Link2 className="w-3 h-3" /> Приглашение к материалу
                                </div>
                              )}
                              {msg.content}
                            </>
                          );
                        })()}
                        <div className={`text-[10px] mt-1 text-right ${isMe ? 'text-indigo-200 dark:text-indigo-300' : 'text-slate-400 dark:text-slate-500'}`}>
                          {new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </motion.div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Ввод сообщения */}
            <div className="p-4 bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800">
              <form onSubmit={handleSend} className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={e => setNewMessage(e.target.value)}
                  placeholder="Напишите сообщение..."
                  className="flex-1 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl px-4 py-2.5 focus:outline-none focus:ring-2 focus:ring-indigo-500 text-sm dark:text-white"
                />
                <button
                  type="submit"
                  disabled={!newMessage.trim()}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white p-2.5 rounded-xl transition disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500 p-6 hidden md:flex">
            <MessageSquare className="w-16 h-16 text-slate-200 dark:text-slate-800 mb-4" />
            <p className="text-lg font-medium text-slate-600 dark:text-slate-300">Выберите друга или диалог слева</p>
            <p className="text-sm mt-1">чтобы начать общение</p>
          </div>
        )}
      </div>
    </div>
  );
}
