import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getProfile, UserProfile } from '../api/social';
import { getFriends, sendFriendRequest } from '../api/chat';
import { UserCircle2, GraduationCap, Trophy, BookOpen, Loader2, UserPlus, Check } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';

export default function Profile() {
  const { user } = useAuth();
  const { id: profileId } = useParams(); // Если нет ID в URL, то показываем свой профиль
  const targetId = profileId || user?.id;
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  
  // Статус дружбы
  const [friendStatus, setFriendStatus] = useState<'none' | 'pending' | 'accepted'>('none');
  
  const isMyProfile = user?.id === targetId;

  useEffect(() => {
    if (!targetId) return;
    
    getProfile(targetId).then(p => {
      setProfile(p);
      setLoading(false);
    });

    if (!isMyProfile && user) {
      getFriends(user.id).then(friends => {
        const friendship = friends.find(f => f.requester_id === targetId || f.addressee_id === targetId);
        if (friendship) {
          setFriendStatus(friendship.status as 'pending' | 'accepted');
        }
      });
    }
  }, [targetId, user, isMyProfile]);

  const handleAddFriend = async () => {
    if (!user || !targetId) return;
    const ok = await sendFriendRequest(user.id, targetId);
    if (ok) {
      setFriendStatus('pending');
    }
  };

  if (loading) {
    return <div className="flex min-h-[85vh] items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>;
  }

  if (!profile) {
    return <div className="p-8 text-center text-slate-500">Профиль не найден.</div>;
  }

  return (
    <div className="p-8 max-w-4xl mx-auto min-h-[85vh]">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white rounded-3xl p-8 border border-slate-200 shadow-sm relative overflow-hidden"
      >
        {/* Декоративный фон сверху */}
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

          {!isMyProfile && (
            <div className="mb-2">
              {friendStatus === 'none' && (
                <button onClick={handleAddFriend} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-700 transition shadow-sm">
                  <UserPlus className="w-5 h-5" />
                  Добавить в друзья
                </button>
              )}
              {friendStatus === 'pending' && (
                <button disabled className="px-6 py-2.5 bg-slate-100 text-slate-500 rounded-xl font-bold flex items-center gap-2 cursor-not-allowed">
                  <Check className="w-5 h-5" />
                  Заявка отправлена
                </button>
              )}
              {friendStatus === 'accepted' && (
                <button className="px-6 py-2.5 bg-emerald-100 text-emerald-700 rounded-xl font-bold flex items-center gap-2">
                  <Check className="w-5 h-5" />
                  Уже в друзьях
                </button>
              )}
            </div>
          )}
        </div>

        {profile.bio && (
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
    </div>
  );
}
