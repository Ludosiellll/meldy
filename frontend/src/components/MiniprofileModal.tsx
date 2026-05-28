import React, { useEffect, useState } from 'react';
import { Award, BookOpen, Star, X, UserPlus, UserCheck, Clock } from 'lucide-react';
import { GroupMember } from '../api/groups';
import { getFriends, sendFriendRequest, Friendship } from '../api/chat';
import toast from 'react-hot-toast';

interface MiniprofileModalProps {
  member: GroupMember;
  currentUserId: string;
  onClose: () => void;
}

export function MiniprofileModal({ member, currentUserId, onClose }: MiniprofileModalProps) {
  const [friendship, setFriendship] = useState<Friendship | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (member.student_id === currentUserId) {
      setLoading(false);
      return;
    }
    
    getFriends(currentUserId).then(friends => {
      const existing = friends.find(f => f.friend_id === member.student_id);
      if (existing) {
        setFriendship(existing);
      }
      setLoading(false);
    });
  }, [currentUserId, member.student_id]);

  const handleAddFriend = async () => {
    if (loading || friendship || member.student_id === currentUserId) return;
    setLoading(true);
    const ok = await sendFriendRequest(currentUserId, member.student_id);
    if (ok) {
      toast.success('Заявка отправлена!');
      setFriendship({
        id: 'new',
        requester_id: currentUserId,
        addressee_id: member.student_id,
        status: 'pending',
        created_at: new Date().toISOString()
      });
    } else {
      toast.error('Ошибка при отправке заявки');
    }
    setLoading(false);
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm" onClick={onClose}>
      <div 
        className="bg-white dark:bg-slate-900 rounded-3xl p-6 w-full max-w-sm shadow-2xl border border-slate-200 dark:border-slate-800 relative"
        onClick={e => e.stopPropagation()}
      >
        <button 
          onClick={onClose}
          className="absolute top-4 right-4 p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 rounded-full transition"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex flex-col items-center mt-4">
          <div className="relative mb-4">
            {member.student_avatar ? (
              <img src={member.student_avatar} alt="avatar" className="w-24 h-24 rounded-full border-4 border-indigo-100 dark:border-indigo-900 shadow-md" />
            ) : (
              <div className="w-24 h-24 rounded-full bg-indigo-50 dark:bg-indigo-900/40 border-4 border-indigo-100 dark:border-indigo-800 flex items-center justify-center text-indigo-500 font-bold text-3xl shadow-md">
                {member.student_name?.[0] || '?'}
              </div>
            )}
            <div className="absolute -bottom-2 -right-2 bg-amber-400 text-amber-950 p-1.5 rounded-full shadow-lg border-2 border-white dark:border-slate-900">
              <Star className="w-5 h-5 fill-amber-300" />
            </div>
          </div>

          <h3 className="font-extrabold text-2xl text-slate-900 dark:text-slate-100 mb-1 text-center">
            {member.student_name}
          </h3>
          <p className="text-slate-500 dark:text-slate-400 text-sm font-medium mb-6">
            Студент класса
          </p>

          <div className="grid grid-cols-2 gap-3 w-full">
            <div className="bg-slate-50 dark:bg-slate-950/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center text-center">
              <Award className="w-6 h-6 text-indigo-500 mb-2" />
              <span className="text-2xl font-black text-slate-800 dark:text-slate-200">{member.total_xp || 0}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mt-1">Опыт (XP)</span>
            </div>
            <div className="bg-slate-50 dark:bg-slate-950/50 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col items-center justify-center text-center">
              <BookOpen className="w-6 h-6 text-emerald-500 mb-2" />
              <span className="text-2xl font-black text-slate-800 dark:text-slate-200">{member.total_reviews || 0}</span>
              <span className="text-xs text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider mt-1">Повторений</span>
            </div>
          </div>

          {member.student_id !== currentUserId && (
            <div className="w-full mt-4">
              {!friendship ? (
                <button 
                  onClick={handleAddFriend}
                  disabled={loading}
                  className="w-full py-3 bg-indigo-600 text-white font-bold rounded-xl hover:bg-indigo-700 transition flex items-center justify-center gap-2 disabled:opacity-50"
                >
                  <UserPlus className="w-5 h-5" /> Добавить в друзья
                </button>
              ) : friendship.status === 'pending' ? (
                <button 
                  disabled
                  className="w-full py-3 bg-amber-100 dark:bg-amber-950/40 text-amber-700 dark:text-amber-400 font-bold rounded-xl flex items-center justify-center gap-2"
                >
                  <Clock className="w-5 h-5" /> Заявка отправлена
                </button>
              ) : (
                <button 
                  disabled
                  className="w-full py-3 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 font-bold rounded-xl flex items-center justify-center gap-2"
                >
                  <UserCheck className="w-5 h-5" /> Уже друзья
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
