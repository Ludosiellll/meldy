import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getProfile, updateProfile, UserProfile } from '../api/social';
import { getFriends, sendFriendRequest, respondFriendRequest, Friendship } from '../api/chat';
import { UserCircle2, GraduationCap, Trophy, BookOpen, Loader2, UserPlus, Check, Edit3, X, UserCheck, UserX } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function Profile() {
  const { user } = useAuth();
  const { id: profileId } = useParams();
  const targetId = profileId || user?.id;
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [friendStatus, setFriendStatus] = useState<'none' | 'pending' | 'accepted'>('none');
  const [incomingRequests, setIncomingRequests] = useState<Friendship[]>([]);
  
  const isMyProfile = user?.id === targetId;

  // Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ full_name: '', university: '', bio: '', avatar_url: '' });

  useEffect(() => {
    if (!targetId) return;
    
    getProfile(targetId).then(p => {
      setProfile(p);
      if (p) {
        setEditForm({
          full_name: p.full_name || '',
          university: p.university || '',
          bio: p.bio || '',
          avatar_url: p.avatar_url || ''
        });
      }
      setLoading(false);
    });

    if (user) {
      getFriends(user.id).then(friends => {
        if (!isMyProfile) {
          const friendship = friends.find(f => f.requester_id === targetId || f.addressee_id === targetId);
          if (friendship) setFriendStatus(friendship.status as 'pending' | 'accepted');
        } else {
          // Входящие заявки мне
          const incoming = friends.filter(f => f.addressee_id === user.id && f.status === 'pending');
          setIncomingRequests(incoming);
        }
      });
    }
  }, [targetId, user, isMyProfile]);

  const handleAddFriend = async () => {
    if (!user || !targetId) return;
    const ok = await sendFriendRequest(user.id, targetId);
    if (ok) setFriendStatus('pending');
  };

  const handleRespondRequest = async (id: string, status: 'accepted' | 'declined') => {
    await respondFriendRequest(id, status);
    setIncomingRequests(prev => prev.filter(req => req.id !== id));
  };

  const handleSaveProfile = async () => {
    if (!user) return;
    const ok = await updateProfile(user.id, editForm);
    if (ok) {
      setProfile(prev => prev ? { ...prev, ...editForm } : null);
      setIsEditing(false);
    }
  };

  if (loading) return <div className="flex min-h-[85vh] items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>;
  if (!profile) return <div className="p-8 text-center text-slate-500">Профиль не найден.</div>;

  return (
    <div className="p-8 max-w-4xl mx-auto min-h-[85vh]">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm relative overflow-hidden mb-8"
      >
        <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-r from-indigo-500 to-purple-600" />
        
        <div className="relative pt-12 flex flex-col md:flex-row items-center md:items-end gap-6 mb-8">
          {profile.avatar_url ? (
            <img src={profile.avatar_url} alt="avatar" className="w-32 h-32 rounded-full border-4 border-white shadow-lg bg-white object-cover" />
          ) : (
            <div className="w-32 h-32 rounded-full border-4 border-white shadow-lg bg-slate-100 flex items-center justify-center">
              <UserCircle2 className="w-16 h-16 text-slate-400" />
            </div>
          )}
          
          <div className="flex-1 text-center md:text-left mb-2">
            <h1 className="text-3xl font-extrabold text-slate-900">{profile.full_name || 'Студент'}</h1>
            {profile.university && (
              <div className="flex items-center justify-center md:justify-start gap-2 text-slate-500 mt-2 font-medium">
                <GraduationCap className="w-5 h-5" />
                {profile.university}
              </div>
            )}
          </div>

          {!isMyProfile ? (
            <div className="mb-2">
              {friendStatus === 'none' && (
                <button onClick={handleAddFriend} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition shadow-sm">
                  <UserPlus className="w-5 h-5" /> Добавить в друзья
                </button>
              )}
              {friendStatus === 'pending' && (
                <button disabled className="px-6 py-2.5 bg-slate-100 text-slate-500 rounded-xl font-bold flex items-center gap-2 cursor-not-allowed">
                  <Check className="w-5 h-5" /> Заявка отправлена
                </button>
              )}
              {friendStatus === 'accepted' && (
                <button className="px-6 py-2.5 bg-emerald-100 text-emerald-700 rounded-xl font-bold flex items-center gap-2">
                  <Check className="w-5 h-5" /> Уже в друзьях
                </button>
              )}
            </div>
          ) : (
            <div className="mb-2">
              <button onClick={() => setIsEditing(!isEditing)} className="px-6 py-2.5 bg-white text-slate-700 border border-slate-200 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-50 transition shadow-sm">
                {isEditing ? <X className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
                {isEditing ? 'Отмена' : 'Редактировать'}
              </button>
            </div>
          )}
        </div>

        {/* Форма редактирования */}
        {isEditing && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mb-8 p-6 bg-slate-50 rounded-2xl border border-slate-200">
            <h3 className="font-bold text-slate-900 mb-4">Редактирование профиля</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Имя и Фамилия</label>
                <input type="text" value={editForm.full_name} onChange={e => setEditForm({...editForm, full_name: e.target.value})} className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Университет / Школа</label>
                <input type="text" value={editForm.university} onChange={e => setEditForm({...editForm, university: e.target.value})} className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Ссылка на аватарку (URL)</label>
                <input type="text" value={editForm.avatar_url} onChange={e => setEditForm({...editForm, avatar_url: e.target.value})} className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" placeholder="https://example.com/avatar.jpg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">О себе (Био)</label>
                <textarea value={editForm.bio} onChange={e => setEditForm({...editForm, bio: e.target.value})} className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none" rows={3} />
              </div>
              <div className="flex justify-end pt-2">
                <button onClick={handleSaveProfile} className="px-6 py-2 bg-indigo-600 text-white rounded-lg font-bold hover:bg-indigo-700">Сохранить</button>
              </div>
            </div>
          </motion.div>
        )}

        {!isEditing && profile.bio && (
          <div className="mb-8 p-5 bg-slate-50 rounded-2xl border border-slate-100 text-slate-700 leading-relaxed">
            {profile.bio}
          </div>
        )}

        <div className="grid grid-cols-3 gap-4">
          <div className="p-5 bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center text-center shadow-sm">
            <div className="w-10 h-10 bg-indigo-100 rounded-xl flex items-center justify-center mb-3">
              <Trophy className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="text-2xl font-black text-slate-900">{profile.streak_days || 0}</div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Дней подряд</div>
          </div>
          
          <div className="p-5 bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center text-center shadow-sm">
            <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center mb-3">
              <BookOpen className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="text-2xl font-black text-slate-900">{profile.total_materials || 0}</div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Конспектов</div>
          </div>

          <div className="p-5 bg-white border border-slate-200 rounded-2xl flex flex-col items-center justify-center text-center shadow-sm">
            <div className="w-10 h-10 bg-amber-100 rounded-xl flex items-center justify-center mb-3">
              <GraduationCap className="w-5 h-5 text-amber-600" />
            </div>
            <div className="text-2xl font-black text-slate-900">{profile.total_reviews || 0}</div>
            <div className="text-xs font-bold text-slate-500 uppercase tracking-widest mt-1">Повторений</div>
          </div>
        </div>
      </motion.div>

      {/* Входящие заявки в друзья */}
      {isMyProfile && incomingRequests.length > 0 && (
        <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900 mb-4">Входящие заявки в друзья ({incomingRequests.length})</h2>
          <div className="space-y-3">
            {incomingRequests.map(req => (
              <div key={req.id} className="flex items-center justify-between p-4 bg-slate-50 rounded-xl border border-slate-100">
                <div className="flex items-center gap-3">
                  {req.friend_avatar ? (
                    <img src={req.friend_avatar} className="w-10 h-10 rounded-full object-cover" alt="avatar" />
                  ) : (
                    <UserCircle2 className="w-10 h-10 text-slate-400" />
                  )}
                  <span className="font-bold text-slate-800">{req.friend_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleRespondRequest(req.id, 'accepted')} className="p-2 bg-emerald-100 text-emerald-700 hover:bg-emerald-200 rounded-lg transition" title="Принять">
                    <UserCheck className="w-5 h-5" />
                  </button>
                  <button onClick={() => handleRespondRequest(req.id, 'declined')} className="p-2 bg-rose-100 text-rose-700 hover:bg-rose-200 rounded-lg transition" title="Отклонить">
                    <UserX className="w-5 h-5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
