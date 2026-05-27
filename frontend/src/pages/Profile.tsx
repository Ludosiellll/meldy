import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getProfile, updateProfile, uploadAvatar, UserProfile } from '../api/social';
import { getFriends, sendFriendRequest, respondFriendRequest, Friendship } from '../api/chat';
import { UserCircle2, GraduationCap, Trophy, BookOpen, Loader2, UserPlus, Check, Edit3, X, UserCheck, UserX, Bell, BellOff, Camera } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { subscribeUserToPush, checkPushSubscription, requestNotificationPermission } from '../utils/push';
import UniversitySelect from '../components/UniversitySelect';

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
  const [editForm, setEditForm] = useState({ full_name: '', university: '', bio: '', avatar_url: '', role: 'student' });

  // Push notifications state
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(true);

  // Avatar Upload state
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  useEffect(() => {
    if (!targetId) return;
    
    getProfile(targetId).then(p => {
      setProfile(p);
      if (p) {
        setEditForm({
          full_name: p.full_name || '',
          university: p.university || '',
          bio: p.bio || '',
          avatar_url: p.avatar_url || '',
          role: p.role || 'student'
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

    checkPushSubscription().then(enabled => {
      setPushEnabled(enabled);
      setPushLoading(false);
    });
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

  const handleTogglePush = async () => {
    if (!user) return;
    setPushLoading(true);
    try {
      if (!pushEnabled) {
        const granted = await requestNotificationPermission();
        if (!granted) {
          alert('Доступ к уведомлениям запрещён в браузере.');
          setPushLoading(false);
          return;
        }
        await subscribeUserToPush(user.id);
        setPushEnabled(true);
      } else {
        alert('Для отключения уведомлений перейдите в настройки браузера.');
      }
    } catch (err) {
      console.error(err);
      alert('Ошибка настройки уведомлений: ' + (err as Error).message);
    }
    setPushLoading(false);
  };

  const handleAvatarChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    
    setUploadingAvatar(true);
    const url = await uploadAvatar(user.id, file);
    setUploadingAvatar(false);

    if (url) {
      setEditForm({ ...editForm, avatar_url: url });
      // Если не в режиме редактирования, сохраним сразу
      if (!isEditing) {
        await updateProfile(user.id, { avatar_url: url });
        setProfile(prev => prev ? { ...prev, avatar_url: url } : null);
      }
    } else {
      alert('Ошибка при загрузке фото.');
    }
  };

  if (loading) return <div className="flex min-h-[85vh] items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>;
  if (!profile) return <div className="p-8 text-center text-slate-500">Профиль не найден.</div>;

  return (
    <div className="p-4 md:p-8 max-w-4xl mx-auto min-h-[85vh]">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white dark:bg-slate-900 rounded-3xl p-8 border border-slate-200 dark:border-slate-800 shadow-sm relative overflow-hidden mb-8"
      >
        <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-tr from-indigo-600 via-purple-600 to-rose-500" />
        
        <div className="relative pt-12 flex flex-col md:flex-row items-center md:items-end gap-6 mb-8">
          <div className="relative group">
            {profile.avatar_url ? (
              <img src={profile.avatar_url} alt="avatar" className="w-32 h-32 rounded-full border-4 border-white dark:border-slate-900 shadow-xl bg-white dark:bg-slate-900 object-cover" />
            ) : (
              <div className="w-32 h-32 rounded-full border-4 border-white dark:border-slate-900 shadow-xl bg-slate-100 dark:bg-slate-800 flex items-center justify-center">
                <UserCircle2 className="w-16 h-16 text-slate-400" />
              </div>
            )}
            
            {isMyProfile && (
              <label className="absolute bottom-0 right-0 w-10 h-10 bg-indigo-600 hover:bg-indigo-700 text-white rounded-full flex items-center justify-center cursor-pointer shadow-lg transition-transform hover:scale-105">
                {uploadingAvatar ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5" />}
                <input type="file" accept="image/*" className="hidden" onChange={handleAvatarChange} disabled={uploadingAvatar} />
              </label>
            )}
          </div>
          
          <div className="flex-1 text-center md:text-left mb-2">
            <h1 className="text-3xl font-extrabold text-slate-900 dark:text-slate-100">{profile.full_name || 'Студент'}</h1>
            {profile.university && (
              <div className="flex items-center justify-center md:justify-start gap-2 text-slate-500 dark:text-slate-400 mt-2 font-medium">
                <GraduationCap className="w-5 h-5" />
                {profile.university}
              </div>
            )}
            {profile.role === 'teacher' && (
              <div className="inline-flex mt-2 items-center gap-1.5 px-3 py-1 bg-amber-100 dark:bg-amber-950/40 text-amber-800 dark:text-amber-400 rounded-lg text-xs font-bold uppercase tracking-wider border border-amber-200 dark:border-amber-900/50">
                Преподаватель
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
                <button disabled className="px-6 py-2.5 bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded-xl font-bold flex items-center gap-2 cursor-not-allowed">
                  <Check className="w-5 h-5" /> Заявка отправлена
                </button>
              )}
              {friendStatus === 'accepted' && (
                <button className="px-6 py-2.5 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-450 rounded-xl font-bold flex items-center gap-2">
                  <Check className="w-5 h-5" /> Уже в друзьях
                </button>
              )}
            </div>
          ) : (
            <div className="mb-2">
              <button onClick={() => setIsEditing(!isEditing)} className="px-6 py-2.5 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl font-bold flex items-center gap-2 hover:bg-slate-50 dark:hover:bg-slate-70 transition shadow-sm">
                {isEditing ? <X className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
                {isEditing ? 'Отмена' : 'Редактировать'}
              </button>
            </div>
          )}
        </div>

        {/* Форма редактирования */}
        {isEditing && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} className="mb-8 p-6 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-slate-200 dark:border-slate-800">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 mb-4">Редактирование профиля</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Имя и Фамилия</label>
                <input type="text" value={editForm.full_name} onChange={e => setEditForm({...editForm, full_name: e.target.value})} className="w-full px-4 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition shadow-sm" placeholder="Иван Иванов" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Университет / Школа</label>
                <UniversitySelect value={editForm.university} onChange={(val) => setEditForm({...editForm, university: val})} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">О себе (Био)</label>
                <textarea value={editForm.bio} onChange={e => setEditForm({...editForm, bio: e.target.value})} className="w-full px-4 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition shadow-sm min-h-[100px]" rows={3} placeholder="Расскажите немного о себе..." />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Роль в системе</label>
                <select value={editForm.role} onChange={e => setEditForm({...editForm, role: e.target.value})} className="w-full px-4 py-2 border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition shadow-sm appearance-none cursor-pointer">
                  <option value="student">Студент</option>
                  <option value="teacher">Преподаватель</option>
                </select>
              </div>
              <div className="flex justify-end pt-2">
                <button onClick={handleSaveProfile} className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-700 transition shadow-lg hover:-translate-y-0.5">Сохранить изменения</button>
              </div>
            </div>
          </motion.div>
        )}

        {!isEditing && profile.bio && (
          <div className="mb-8 p-5 bg-slate-50 dark:bg-slate-950/40 rounded-2xl border border-slate-100 dark:border-slate-800/40 text-slate-700 dark:text-slate-300 leading-relaxed">
            {profile.bio}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col items-center justify-center text-center shadow-sm">
            <div className="w-10 h-10 bg-indigo-100 dark:bg-indigo-950/40 rounded-xl flex items-center justify-center mb-3">
              <Trophy className="w-5 h-5 text-indigo-600" />
            </div>
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100">{profile.streak_days || 0}</div>
            <div className="text-xs font-bold text-slate-550 dark:text-slate-450 uppercase tracking-widest mt-1">Дней подряд</div>
          </div>
          
          <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col items-center justify-center text-center shadow-sm">
            <div className="w-10 h-10 bg-emerald-100 dark:bg-emerald-950/40 rounded-xl flex items-center justify-center mb-3">
              <BookOpen className="w-5 h-5 text-emerald-600" />
            </div>
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100">{profile.total_materials || 0}</div>
            <div className="text-xs font-bold text-slate-550 dark:text-slate-450 uppercase tracking-widest mt-1">Конспектов</div>
          </div>

          <div className="p-5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl flex flex-col items-center justify-center text-center shadow-sm">
            <div className="w-10 h-10 bg-amber-100 dark:bg-amber-950/40 rounded-xl flex items-center justify-center mb-3">
              <GraduationCap className="w-5 h-5 text-amber-600" />
            </div>
            <div className="text-2xl font-black text-slate-900 dark:text-slate-100">{profile.total_reviews || 0}</div>
            <div className="text-xs font-bold text-slate-550 dark:text-slate-450 uppercase tracking-widest mt-1">Повторений</div>
          </div>
        </div>

        {isMyProfile && (
          <div className="mt-8 pt-8 border-t border-slate-100 dark:border-slate-800">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 mb-4">Настройки устройства</h3>
            <div className="p-4 bg-slate-50 dark:bg-slate-950/40 border border-slate-200 dark:border-slate-800 rounded-xl flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-start sm:items-center gap-3">
                <div className={`shrink-0 w-10 h-10 rounded-xl flex items-center justify-center ${pushEnabled ? 'bg-indigo-100 dark:bg-indigo-950/40' : 'bg-slate-200 dark:bg-slate-800'}`}>
                  {pushEnabled ? <Bell className="w-5 h-5 text-indigo-600" /> : <BellOff className="w-5 h-5 text-slate-500" />}
                </div>
                <div className="text-left">
                  <p className="font-bold text-slate-900 dark:text-slate-200 text-sm">Push-уведомления (PWA)</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-tight mt-0.5">Ежедневные напоминания о материалах, требующих повторения.</p>
                </div>
              </div>
              <button 
                onClick={handleTogglePush}
                disabled={pushLoading || pushEnabled}
                className={`w-full sm:w-auto shrink-0 px-4 py-2 rounded-lg text-sm font-bold transition ${
                  pushLoading ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed' :
                  pushEnabled ? 'bg-indigo-50 dark:bg-indigo-950/30 text-indigo-600 dark:text-indigo-400 cursor-default border border-indigo-100 dark:border-indigo-950' :
                  'bg-indigo-600 hover:bg-indigo-700 dark:bg-indigo-650 dark:hover:bg-indigo-600 text-white shadow-sm'
                }`}
              >
                {pushLoading ? 'Загрузка...' : pushEnabled ? 'Включено' : 'Включить'}
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Входящие заявки в друзья */}
      {isMyProfile && incomingRequests.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm">
          <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mb-4">Входящие заявки в друзья ({incomingRequests.length})</h2>
          <div className="space-y-3">
            {incomingRequests.map(req => (
              <div key={req.id} className="flex items-center justify-between p-4 bg-slate-50 dark:bg-slate-950/40 rounded-xl border border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-3">
                  {req.friend_avatar ? (
                    <img src={req.friend_avatar} className="w-10 h-10 rounded-full object-cover" alt="avatar" />
                  ) : (
                    <UserCircle2 className="w-10 h-10 text-slate-400" />
                  )}
                  <span className="font-bold text-slate-800 dark:text-slate-200">{req.friend_name}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button onClick={() => handleRespondRequest(req.id, 'accepted')} className="p-2 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-200 dark:hover:bg-emerald-900/50 rounded-lg transition" title="Принять">
                    <UserCheck className="w-5 h-5" />
                  </button>
                  <button onClick={() => handleRespondRequest(req.id, 'declined')} className="p-2 bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 hover:bg-rose-200 dark:hover:bg-rose-900/50 rounded-lg transition" title="Отклонить">
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
