import { Material } from '../types';
import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getChats, ChatContact, getMessages, sendMessage, subscribeToMessages, DirectMessage } from '../api/chat';
import { Send, UserCircle2, MessageSquare, Loader2, BookOpen, Link2, ChevronLeft } from 'lucide-react';
import { motion } from 'framer-motion';
import { useNavigate, useParams } from 'react-router-dom';
import { getMaterials } from '../api/materials';
import { getProfile } from '../api/social';
import toast from 'react-hot-toast';

export default function Messages() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { id: urlId } = useParams();
  
  const [friends, setFriends] = useState<ChatContact[]>([]);
  const [activeFriend, setActiveFriend] = useState<ChatContact | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const [showInvite, setShowInvite] = useState(false);
  const [myMaterials, setMyMaterials] = useState<any[]>([]);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    
    const loadChats = async () => {
      const chats = await getChats(user.id);
      
      if (urlId && !chats.some(c => c.friend_id === urlId)) {
        const p = await getProfile(urlId);
        if (p) {
          chats.unshift({ id: p.id, friend_id: p.id, friend_name: p.full_name, friend_avatar: p.avatar_url });
        }
      }
      
      setFriends(chats);
      
      if (urlId) {
        setActiveFriend(chats.find(c => c.friend_id === urlId) || null);
      } else if (chats.length > 0 && !activeFriend) {
        // Optionally select first chat, or leave null
      }
      
      setLoading(false);
    };
    
    loadChats();
    getMaterials(user.id).then(setMyMaterials);
  }, [user?.id, urlId]);

  useEffect(() => {
    if (!user || !activeFriend) return;
    const friendId = activeFriend.friend_id!;
    getMessages(user.id, friendId).then(setMessages);

    const unsubscribe = subscribeToMessages(user.id, (msg) => {
      if (
        (msg.sender_id === user.id && msg.receiver_id === friendId) ||
        (msg.sender_id === friendId && msg.receiver_id === user.id)
      ) {
        setMessages(prev => prev.find(m => m.id === msg.id) ? prev : [...prev, msg]);
      }
    });
    return () => { unsubscribe(); };
  }, [user?.id, activeFriend]);

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
    const inviteText = `📚 Приглашаю изучить материал: «${material.title}» (${material.subject || 'Без предмета'}) — открой в своей библиотеке или найди в Study Network!`;
    setShowInvite(false);
    const msg = await sendMessage(user.id, activeFriend.friend_id!, inviteText);
    if (msg) {
      setMessages(prev => [...prev, msg]);
      toast.success('Материал отправлен!');
    } else {
      toast.error('Не удалось отправить материал.');
    }
  };

  if (loading) {
    return <div className="flex h-[85vh] items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>;
  }

  return (
    <div className="flex h-[calc(100vh-80px)] md:h-[85vh] bg-white dark:bg-slate-900 md:rounded-2xl shadow-sm border border-slate-200 dark:border-slate-800 overflow-hidden md:m-6 m-0 relative">

      {/* Левая панель — список диалогов */}
      <div className={`w-full md:w-80 border-r border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/40 shrink-0 ${activeFriend ? 'hidden md:flex md:flex-col' : 'flex flex-col'}`}>
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
          <h2 className="font-bold text-lg text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-indigo-500" />
            Сообщения
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {friends.length === 0 ? (
            <div className="p-6 text-center">
              <UserCircle2 className="w-10 h-10 text-slate-200 dark:text-slate-800 mx-auto mb-3" />
              <p className="text-sm text-slate-500 dark:text-slate-400">У вас пока нет диалогов.</p>
              <button
                onClick={() => navigate('/network')}
                className="mt-3 text-sm text-indigo-600 dark:text-indigo-400 font-bold hover:text-indigo-700 dark:hover:text-indigo-300"
              >
                Найти людей в Хабе →
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
              {/* Кнопка "Пригласить к материалу" */}
              <div className="relative">
                <button
                  onClick={() => setShowInvite(v => !v)}
                  className="flex items-center gap-2 text-sm font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/40 hover:bg-indigo-100 dark:hover:bg-indigo-900/50 transition px-3 py-1.5 rounded-lg"
                  title="Поделиться материалом"
                >
                  <BookOpen className="w-4 h-4" />
                  Поделиться материалом
                </button>

                {showInvite && (
                  <div className="absolute right-0 top-10 w-72 bg-white dark:bg-slate-800 rounded-2xl shadow-xl border border-slate-200 dark:border-slate-700 z-20 overflow-hidden">
                    <div className="p-3 border-b border-slate-100 dark:border-slate-700">
                      <p className="font-bold text-sm text-slate-800 dark:text-slate-250">Отправить материал в чат</p>
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
                  const isInvite = msg.content.startsWith('📚');
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
                        {isInvite && !isMe && (
                          <div className="flex items-center gap-1 text-amber-600 dark:text-amber-400 font-bold text-xs mb-1">
                            <Link2 className="w-3 h-3" /> Приглашение к материалу
                          </div>
                        )}
                        {msg.content}
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
                  placeholder="Написать сообщение..."
                  className="flex-1 px-4 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-sm border border-transparent dark:border-slate-700"
                />
                <button
                  type="submit"
                  disabled={!newMessage.trim()}
                  className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
            <MessageSquare className="w-16 h-16 mb-4 text-slate-200 dark:text-slate-800" />
            <p className="font-medium">Выберите диалог слева</p>
            <p className="text-sm mt-1">чтобы начать общение</p>
          </div>
        )}
      </div>
    </div>
  );
}
