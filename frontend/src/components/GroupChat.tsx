import React, { useState, useEffect, useRef } from 'react';
import { Send, MessageSquare } from 'lucide-react';
import { getGroupMessages, sendGroupMessage, subscribeToGroupChat, GroupChatMessage } from '../api/chat';
import { GroupMember } from '../api/groups';
import { format } from 'date-fns';
import { ru } from 'date-fns/locale';

interface GroupChatProps {
  groupId: string;
  currentUserId: string;
  members: GroupMember[];
  onUserClick: (userId: string) => void;
}

export function GroupChat({ groupId, currentUserId, members, onUserClick }: GroupChatProps) {
  const [messages, setMessages] = useState<GroupChatMessage[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [loading, setLoading] = useState(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let unsubscribe: () => void;
    
    setLoading(true);
    getGroupMessages(groupId).then(data => {
      setMessages(data);
      setLoading(false);
      scrollToBottom();
      
      unsubscribe = subscribeToGroupChat(groupId, (msg) => {
        setMessages(prev => {
          if (prev.some(m => m.id === msg.id)) return prev;
          return [...prev, msg];
        });
        setTimeout(scrollToBottom, 100);
      });
    });

    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [groupId]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newMessage.trim()) return;
    
    const content = newMessage.trim();
    setNewMessage('');
    
    await sendGroupMessage(groupId, currentUserId, content);
  };

  const getMemberInfo = (userId: string) => {
    return members.find(m => m.student_id === userId);
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-10 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
        <div className="w-8 h-8 border-4 border-indigo-600 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm text-slate-500">Загрузка чата...</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[600px] max-h-[70vh] bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-sm">
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2 bg-slate-50 dark:bg-slate-950/40">
        <MessageSquare className="w-5 h-5 text-indigo-500" />
        <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">Чат класса</h3>
      </div>
      
      <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar bg-slate-50/50 dark:bg-slate-950/20">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-400 dark:text-slate-500">
            <MessageSquare className="w-12 h-12 mb-2 opacity-50" />
            <p>Здесь пока нет сообщений</p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isMe = msg.sender_id === currentUserId;
            const sender = getMemberInfo(msg.sender_id);
            const showAvatar = idx === 0 || messages[idx - 1].sender_id !== msg.sender_id;

            return (
              <div key={msg.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : ''}`}>
                <div className={`shrink-0 w-8 flex flex-col items-center ${isMe ? 'items-end' : 'items-start'}`}>
                  {showAvatar && (
                    <button onClick={() => onUserClick(msg.sender_id)} className="transition transform hover:scale-110 active:scale-95">
                      {sender?.student_avatar ? (
                        <img src={sender.student_avatar} alt="avatar" className="w-8 h-8 rounded-full border border-slate-200 dark:border-slate-700" />
                      ) : (
                        <div className="w-8 h-8 rounded-full bg-indigo-100 dark:bg-indigo-900/40 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-400 font-bold flex items-center justify-center text-xs">
                          {sender?.student_name?.[0] || '?'}
                        </div>
                      )}
                    </button>
                  )}
                </div>

                <div className={`flex flex-col max-w-[75%] ${isMe ? 'items-end' : 'items-start'}`}>
                  {showAvatar && !isMe && (
                    <span 
                      onClick={() => onUserClick(msg.sender_id)}
                      className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-1 ml-1 cursor-pointer hover:underline"
                    >
                      {sender?.student_name || 'Студент'}
                    </span>
                  )}
                  <div 
                    className={`px-4 py-2 rounded-2xl text-sm whitespace-pre-wrap break-words shadow-sm
                      ${isMe 
                        ? 'bg-indigo-600 text-white rounded-tr-sm' 
                        : 'bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-tl-sm'
                      }`}
                  >
                    {msg.content}
                  </div>
                  <span className="text-[10px] text-slate-400 mt-1 mx-1">
                    {format(new Date(msg.created_at), 'HH:mm', { locale: ru })}
                  </span>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSend} className="p-3 border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex gap-2">
        <input
          value={newMessage}
          onChange={(e) => setNewMessage(e.target.value)}
          placeholder="Написать сообщение..."
          className="flex-1 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-2 outline-none focus:ring-2 focus:ring-indigo-500 text-sm text-slate-900 dark:text-slate-100"
        />
        <button
          type="submit"
          disabled={!newMessage.trim()}
          className="p-2.5 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 disabled:opacity-50 transition"
        >
          <Send className="w-5 h-5" />
        </button>
      </form>
    </div>
  );
}
