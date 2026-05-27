import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getProfile, updateProfile, uploadAvatar, UserProfile } from '../api/social';
import { getFriends, sendFriendRequest, respondFriendRequest, Friendship } from '../api/chat';
import { UserCircle2, GraduationCap, Trophy, BookOpen, Loader2, UserPlus, Check, Edit3, X, UserCheck, UserX, Bell, BellOff, Camera, Star } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { subscribeUserToPush, checkPushSubscription, requestNotificationPermission } from '../utils/push';
import UniversitySelect from '../components/UniversitySelect';
import { getUserXP, calcLevel } from '../api/quests';
import toast from 'react-hot-toast';
import ImageCropper from '../components/ImageCropper';

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
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);

  // XP / Level state
  const [xp, setXp] = useState(0);
  const [levelInfo, setLevelInfo] = useState({ level: 1, name: 'Новичок', currentXP: 0, nextXP: 100, progress: 0 });

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

    getUserXP(targetId).then(v => {
      setXp(v);
      setLevelInfo(calcLevel(v));
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
          toast.error('Доступ к уведомлениям запрещён в браузере.');
          setPushLoading(false);
          return;
        }
        await subscribeUserToPush(user.id);
        setPushEnabled(true);
      } else {
        toast('Для отключения уведомлений перейдите в настройки браузера.', { icon: 'ℹ️' });
      }
    } catch (err) {
      console.error(err);
      toast.error('Ошибка настройки уведомлений: ' + (err as Error).message);
    }
    setPushLoading(false);
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Считываем файл как URL, чтобы передать в кроппер
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      setCropImageSrc(reader.result?.toString() || null);
    });
    reader.readAsDataURL(file);
    e.target.value = ''; // Сбросить инпут
  };

  const handleCropComplete = async (croppedFile: File) => {
    setCropImageSrc(null);
    setUploadingAvatar(true);
    const url = await uploadAvatar(user!.id, croppedFile);
    setUploadingAvatar(false);

    if (url) {
      setEditForm({ ...editForm, avatar_url: url });
      // Если не в режиме редактирования, сохраним сразу
      if (!isEditing) {
        await updateProfile(user!.id, { avatar_url: url });
        setProfile(prev => prev ? { ...prev, avatar_url: url } : null);
      }
      toast.success('Фото успешно обновлено!');
    } else {
      toast.error('Ошибка при загрузке фото.');
    }
  };

  if (loading) return <div className="flex min-h-[85vh] items-center justify-center"><Loader2 className="w-8 h-8 text-indigo-500 animate-spin" /></div>;
  if (!profile) return <div className="p-8 text-center text-slate-500">Профиль не найден.</div>;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto min-h-[85vh]">
      <motion.div 
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-xl rounded-3xl p-6 md:p-8 border border-white/20 dark:border-slate-800 shadow-2xl relative mb-8"
      >
        <div className="absolute inset-0 bg-gradient-to-tr from-indigo-500/10 via-purple-500/5 to-rose-500/10 pointer-events-none rounded-3xl" />
        
        <div className="relative flex flex-col md:flex-row items-center md:items-start gap-8 mb-8">
          <div className="relative group shrink-0">
            {/* Анимированное кольцо прогресса уровня */}
            <svg className="absolute -inset-2 w-[calc(100%+16px)] h-[calc(100%+16px)] -rotate-90 pointer-events-none drop-shadow-[0_0_10px_rgba(99,102,241,0.5)]">
              <circle cx="50%" cy="50%" r="48%" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-slate-200/50 dark:text-slate-800/50" />
              <circle cx="50%" cy="50%" r="48%" stroke="currentColor" strokeWidth="4" fill="transparent" strokeDasharray={`${levelInfo.progress * 3.01} 301`} strokeLinecap="round" className="text-indigo-500 transition-all duration-1000 ease-out" />
            </svg>

            <div className="w-32 h-32 md:w-40 md:h-40 rounded-full border-[6px] border-white dark:border-slate-900 shadow-xl overflow-hidden bg-slate-100 dark:bg-slate-800 relative">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="avatar" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <UserCircle2 className="w-16 h-16 md:w-20 md:h-20 text-slate-400" />
                </div>
              )}
            </div>
            
            {isMyProfile && (
              <label className="absolute bottom-2 right-2 w-10 h-10 md:w-12 md:h-12 bg-indigo-600 hover:bg-indigo-500 text-white rounded-full flex items-center justify-center cursor-pointer shadow-[0_0_15px_rgba(79,70,229,0.6)] transition-all hover:scale-110 border-2 border-white dark:border-slate-900 z-10">
                {uploadingAvatar ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5 md:w-6 md:h-6" />}
                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploadingAvatar} />
              </label>
            )}

            <div className="absolute -bottom-3 left-1/2 -translate-x-1/2 bg-gradient-to-r from-indigo-600 to-purple-600 text-white px-3 py-1 rounded-full text-xs font-black tracking-widest shadow-lg border-2 border-white dark:border-slate-900 whitespace-nowrap">
              LVL {levelInfo.level}
            </div>
          </div>
          
          <div className="flex-1 text-center md:text-left pt-2">
            <h1 className="text-3xl md:text-4xl font-black text-slate-900 dark:text-white tracking-tight mb-2">{profile.full_name || 'Студент'}</h1>
            {profile.university && (
              <div className="flex items-center justify-center md:justify-start gap-2 text-indigo-600 dark:text-indigo-400 font-semibold mb-3">
                <GraduationCap className="w-5 h-5" />
                {profile.university}
              </div>
            )}
            {profile.role === 'teacher' && (
              <div className="inline-flex mb-4 items-center gap-1.5 px-3 py-1 bg-amber-500/10 text-amber-600 dark:text-amber-400 rounded-lg text-xs font-bold uppercase tracking-wider border border-amber-500/20">
                Преподаватель
              </div>
            )}

            {!isMyProfile ? (
              <div className="mt-4 flex justify-center md:justify-start gap-3">
                {friendStatus === 'none' && (
                  <button onClick={handleAddFriend} className="px-6 py-2.5 bg-indigo-600 text-white rounded-xl font-bold flex items-center gap-2 hover:bg-indigo-500 transition shadow-lg hover:shadow-indigo-500/25">
                    <UserPlus className="w-5 h-5" /> Добавить в друзья
                  </button>
                )}
                {friendStatus === 'pending' && (
                  <button disabled className="px-6 py-2.5 bg-white/50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 rounded-xl font-bold flex items-center gap-2 cursor-not-allowed border border-slate-200 dark:border-slate-700">
                    <Check className="w-5 h-5" /> Заявка отправлена
                  </button>
                )}
                {friendStatus === 'accepted' && (
                  <button className="px-6 py-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl font-bold flex items-center gap-2 border border-emerald-500/20">
                    <Check className="w-5 h-5" /> Уже в друзьях
                  </button>
                )}
              </div>
            ) : (
              <div className="mt-4 flex justify-center md:justify-start">
                <button onClick={() => setIsEditing(!isEditing)} className={`px-6 py-2.5 rounded-xl font-bold flex items-center gap-2 transition shadow-sm border ${isEditing ? 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20 hover:bg-rose-500/20' : 'bg-white/50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-white dark:hover:bg-slate-800'}`}>
                  {isEditing ? <X className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
                  {isEditing ? 'Отменить редактирование' : 'Редактировать профиль'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Форма редактирования (плавная) */}
        {isEditing && (
          <motion.div initial={{ opacity: 0, y: -20, height: 0 }} animate={{ opacity: 1, y: 0, height: 'auto' }} className="mb-8 p-6 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xl relative z-20">
            <h3 className="font-bold text-slate-900 dark:text-white mb-4">Редактирование профиля</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Имя и Фамилия</label>
                  <input type="text" value={editForm.full_name} onChange={e => setEditForm({...editForm, full_name: e.target.value})} className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition shadow-inner" placeholder="Иван Иванов" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Университет / Школа</label>
                  <UniversitySelect value={editForm.university} onChange={(val) => setEditForm({...editForm, university: val})} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">О себе (Био)</label>
                <textarea value={editForm.bio} onChange={e => setEditForm({...editForm, bio: e.target.value})} className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition shadow-inner min-h-[100px] resize-none" rows={3} placeholder="Расскажите немного о себе..." />
              </div>
              <div className="w-full md:w-1/2">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Роль в системе</label>
                <select value={editForm.role} onChange={e => setEditForm({...editForm, role: e.target.value})} className="w-full px-4 py-3 border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 rounded-xl focus:ring-2 focus:ring-indigo-500 outline-none transition shadow-inner appearance-none cursor-pointer">
                  <option value="student">Студент</option>
                  <option value="teacher">Преподаватель</option>
                </select>
              </div>
              <div className="flex justify-end pt-4">
                <button onClick={handleSaveProfile} className="px-8 py-3 bg-indigo-600 text-white rounded-xl font-bold hover:bg-indigo-500 transition shadow-lg shadow-indigo-500/30 hover:-translate-y-1">Сохранить изменения</button>
              </div>
            </div>
          </motion.div>
        )}

        {!isEditing && profile.bio && (
          <div className="mb-8 p-5 bg-white/40 dark:bg-slate-950/40 rounded-2xl border border-white/20 dark:border-slate-800/40 text-slate-700 dark:text-slate-300 leading-relaxed italic relative">
            <span className="absolute top-2 left-2 text-4xl text-indigo-500/20 font-serif leading-none">"</span>
            <div className="relative z-10 px-4">{profile.bio}</div>
          </div>
        )}

        {/* BENTO GRID STATISTICS */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="col-span-2 md:col-span-2 row-span-2 p-6 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-3xl text-white shadow-lg relative overflow-hidden flex flex-col justify-center">
            <div className="absolute -top-10 -right-10 w-40 h-40 bg-white/10 rounded-full blur-2xl pointer-events-none" />
            <div className="absolute -bottom-10 -left-10 w-40 h-40 bg-black/10 rounded-full blur-2xl pointer-events-none" />
            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-2">
                <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center backdrop-blur-sm">
                  <Star className="w-5 h-5 text-yellow-300 fill-yellow-300" />
                </div>
                <div className="text-sm font-bold uppercase tracking-widest text-indigo-100">Опыт</div>
              </div>
              <div className="text-5xl font-black mb-1">{xp} <span className="text-xl text-indigo-200">XP</span></div>
              <div className="text-sm font-medium text-indigo-100 mb-4">{levelInfo.name}</div>
              
              <div className="h-2 w-full bg-black/20 rounded-full overflow-hidden">
                <div className="h-full bg-white rounded-full transition-all duration-1000" style={{ width: `${levelInfo.progress}%` }} />
              </div>
              <div className="flex justify-between mt-2 text-[10px] font-bold text-indigo-100 uppercase tracking-wider">
                <span>Ур. {levelInfo.level}</span>
                <span>{levelInfo.currentXP} / {levelInfo.nextXP} XP</span>
              </div>
            </div>
          </div>
          
          <div className="p-5 bg-white dark:bg-slate-800/50 backdrop-blur-sm border border-slate-200 dark:border-slate-700/50 rounded-3xl flex flex-col items-center justify-center text-center shadow-sm hover:-translate-y-1 transition-transform cursor-default">
            <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center mb-3">
              <Trophy className="w-6 h-6 text-amber-500" />
            </div>
            <div className="text-3xl font-black text-slate-900 dark:text-white">{profile.streak_days || 0}</div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Огненный Стрик</div>
          </div>
          
          <div className="p-5 bg-white dark:bg-slate-800/50 backdrop-blur-sm border border-slate-200 dark:border-slate-700/50 rounded-3xl flex flex-col items-center justify-center text-center shadow-sm hover:-translate-y-1 transition-transform cursor-default">
            <div className="w-12 h-12 bg-emerald-500/10 rounded-2xl flex items-center justify-center mb-3">
              <BookOpen className="w-6 h-6 text-emerald-500" />
            </div>
            <div className="text-3xl font-black text-slate-900 dark:text-white">{profile.total_materials || 0}</div>
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">Конспектов</div>
          </div>

          <div className="col-span-2 p-5 bg-white dark:bg-slate-800/50 backdrop-blur-sm border border-slate-200 dark:border-slate-700/50 rounded-3xl flex items-center gap-4 shadow-sm hover:-translate-y-1 transition-transform cursor-default">
            <div className="w-14 h-14 bg-sky-500/10 rounded-2xl flex items-center justify-center shrink-0">
              <GraduationCap className="w-7 h-7 text-sky-500" />
            </div>
            <div>
              <div className="text-3xl font-black text-slate-900 dark:text-white leading-none mb-1">{profile.total_reviews || 0}</div>
              <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Пройдено повторений и экзаменов</div>
            </div>
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

      {cropImageSrc && (
        <ImageCropper 
          imageSrc={cropImageSrc} 
          onCropComplete={handleCropComplete} 
          onClose={() => setCropImageSrc(null)} 
        />
      )}
    </div>
  );
}
