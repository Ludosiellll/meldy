import { useState, useEffect, useRef } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getFriends, Friendship, getMessages, sendMessage, subscribeToMessages, DirectMessage } from '../api/chat';
import { Send, UserCircle2, MessageSquare, Loader2, Check } from 'lucide-react';
import { motion } from 'framer-motion';

export default function Messages() {
  const { user } = useAuth();
  const [friends, setFriends] = useState<Friendship[]>([]);
  const [activeFriend, setActiveFriend] = useState<Friendship | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!user) return;
    getFriends(user.id).then(f => {
      // Показывать только тех, с кем дружба 'accepted', или можно всех
      setFriends(f.filter(x => x.status === 'accepted'));
      setLoading(false);
    });
  }, [user]);

  useEffect(() => {
    if (!user || !activeFriend) return;
    const friendId = activeFriend.friend_id!;
    
    // Загружаем историю
    getMessages(user.id, friendId).then(setMessages);

    // Подписываемся на обновления
    const unsubscribe = subscribeToMessages(user.id, (msg) => {
      // Добавляем сообщение, если оно относится к текущему диалогу
      if (
        (msg.sender_id === user.id && msg.receiver_id === friendId) ||
        (msg.sender_id === friendId && msg.receiver_id === user.id)
      ) {
        setMessages(prev => {
          if (prev.find(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [user, activeFriend]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !activeFriend || !newMessage.trim()) return;
    
    const content = newMessage.trim();
    setNewMessage('');
    
    // Оптимистичный UI можно добавить, но пока просто отправляем
    const msg = await sendMessage(user.id, activeFriend.friend_id!, content);
    if (msg) {
      setMessages(prev => [...prev, msg]);
    }
  };

  if (loading) {
    return <div className="flex h-[85vh] items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>;
  }

  return (
    <div className="flex h-[85vh] bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden m-6">
      
      {/* Левая панель - список диалогов */}
      <div className="w-80 border-r border-slate-200 flex flex-col bg-slate-50">
        <div className="p-4 border-b border-slate-200 bg-white">
          <h2 className="font-bold text-lg text-slate-800 flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-indigo-500" />
            Сообщения
          </h2>
        </div>
        <div className="flex-1 overflow-y-auto">
          {friends.length === 0 ? (
            <div className="p-6 text-center text-sm text-slate-500">
              У вас пока нет добавленных друзей. Найдите их в Хабе!
            </div>
          ) : (
            friends.map(f => (
              <button
                key={f.id}
                onClick={() => setActiveFriend(f)}
                className={`w-full p-4 flex items-center gap-3 text-left transition-colors border-b border-slate-100 ${
                  activeFriend?.id === f.id ? 'bg-indigo-50 hover:bg-indigo-50' : 'hover:bg-white'
                }`}
              >
                {f.friend_avatar ? (
                  <img src={f.friend_avatar} alt="avatar" className="w-10 h-10 rounded-full object-cover" />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-slate-200 flex items-center justify-center">
                    <UserCircle2 className="w-6 h-6 text-slate-500" />
                  </div>
                )}
                <div>
                  <div className="font-bold text-slate-800 text-sm">{f.friend_name}</div>
                  <div className="text-xs text-slate-500">Нажмите, чтобы открыть чат</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* Правая панель - чат */}
      <div className="flex-1 flex flex-col bg-white relative">
        {activeFriend ? (
          <>
            {/* Хедер чата */}
            <div className="p-4 border-b border-slate-200 flex items-center gap-3 bg-white shadow-sm z-10">
              {activeFriend.friend_avatar ? (
                <img src={activeFriend.friend_avatar} alt="avatar" className="w-10 h-10 rounded-full object-cover" />
              ) : (
                <div className="w-10 h-10 rounded-full bg-slate-100 flex items-center justify-center">
                  <UserCircle2 className="w-6 h-6 text-slate-400" />
                </div>
              )}
              <div className="font-bold text-slate-800">{activeFriend.friend_name}</div>
            </div>

            {/* Сообщения */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 bg-slate-50/50">
              {messages.length === 0 ? (
                <div className="h-full flex items-center justify-center text-slate-400 text-sm">
                  Напишите первое сообщение!
                </div>
              ) : (
                messages.map(msg => {
                  const isMe = msg.sender_id === user?.id;
                  return (
                    <motion.div
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      key={msg.id}
                      className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}
                    >
                      <div
                        className={`max-w-[70%] px-4 py-2 rounded-2xl text-sm ${
                          isMe
                            ? 'bg-indigo-600 text-white rounded-tr-sm'
                            : 'bg-white border border-slate-200 text-slate-800 rounded-tl-sm shadow-sm'
                        }`}
                      >
                        {msg.content}
                        <div className={`text-[10px] mt-1 text-right ${isMe ? 'text-indigo-200' : 'text-slate-400'}`}>
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
            <div className="p-4 bg-white border-t border-slate-200">
              <form onSubmit={handleSend} className="flex gap-2">
                <input
                  type="text"
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder="Написать сообщение..."
                  className="flex-1 px-4 py-2.5 bg-slate-100 rounded-xl focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all text-sm"
                />
                <button
                  type="submit"
                  disabled={!newMessage.trim()}
                  className="p-3 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-sm"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center text-slate-400">
            <MessageSquare className="w-16 h-16 mb-4 text-slate-200" />
            <p>Выберите диалог слева, чтобы начать общение</p>
          </div>
        )}
      </div>

    </div>
  );
}
