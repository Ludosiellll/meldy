import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getProfile, updateProfile, uploadAvatar, UserProfile } from '../api/social';
import { getFriends, sendFriendRequest, respondFriendRequest, Friendship, blockUser, unblockUser, getBlockedUserIds } from '../api/chat';
import { UserCircle2, GraduationCap, Trophy, BookOpen, Loader2, UserPlus, Check, Edit3, X, UserCheck, UserX, Bell, BellOff, Camera, Star, MessageSquare, Ban } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { subscribeUserToPush, checkPushSubscription, requestNotificationPermission } from '../utils/push';
import UniversitySelect from '../components/UniversitySelect';
import { getUserXP, calcLevel } from '../api/quests';
import toast from 'react-hot-toast';
import ImageCropper from '../components/ImageCropper';
import { CustomSelect } from '../components/CustomSelect';

export default function Profile() {
  const { user } = useAuth();
  const { id: profileId } = useParams();
  const navigate = useNavigate();
  const targetId = profileId || user?.id;
  
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  
  const [friendStatus, setFriendStatus] = useState<'none' | 'pending' | 'accepted'>('none');
  const [incomingRequests, setIncomingRequests] = useState<Friendship[]>([]);
  
  const [isBlocked, setIsBlocked] = useState(false);
  const [blockLoading, setBlockLoading] = useState(false);

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
      
      if (!isMyProfile && targetId) {
        getBlockedUserIds(user.id).then(blockedIds => {
          setIsBlocked(blockedIds.includes(targetId));
        });
      }
    }

    checkPushSubscription().then(enabled => {
      setPushEnabled(enabled);
      setPushLoading(false);
    });
  }, [targetId, user?.id, isMyProfile]);

  const handleAddFriend = async () => {
    if (!user || !targetId) return;
    const ok = await sendFriendRequest(user.id, targetId);
    if (ok) setFriendStatus('pending');
  };

  const handleRespondRequest = async (id: string, status: 'accepted' | 'declined') => {
    await respondFriendRequest(id, status);
    setIncomingRequests(prev => prev.filter(req => req.id !== id));
  };

  const handleToggleBlock = async () => {
    if (!user || !targetId) return;
    setBlockLoading(true);
    if (isBlocked) {
      await unblockUser(user.id, targetId);
      setIsBlocked(false);
      toast.success('Пользователь разблокирован');
    } else {
      await blockUser(user.id, targetId);
      setIsBlocked(true);
      toast.success('Пользователь заблокирован');
    }
    setBlockLoading(false);
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
        toast('Отключить уведомления можно в настройках браузера.');
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
      toast.success('Фото обновлено');
    } else {
      toast.error('Не удалось загрузить фото');
    }
  };

  if (loading) return <div className="flex min-h-[85vh] items-center justify-center"><Loader2 className="w-8 h-8 text-cyan-400 animate-spin" /></div>;
  if (!profile) return <div className="p-8 text-center text-slate-500">Профиль не найден.</div>;

  return (
    <main className="mx-auto min-h-[85vh] max-w-5xl px-4 py-8 md:px-8 md:py-12">
      <motion.div 
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8 border-y border-slate-200 py-7 dark:border-slate-800"
      >
        <div className="hidden" />
        
        <div className="relative flex flex-col md:flex-row items-center md:items-start gap-8 mb-8">
          <div className="relative group shrink-0 mb-4 md:mb-0 z-10">
            <svg viewBox="0 0 100 100" className="hidden">
              <circle cx="50" cy="50" r="48" stroke="currentColor" strokeWidth="4" fill="transparent" className="text-slate-200/50 dark:text-slate-800/50" />
              <circle cx="50" cy="50" r="48" stroke="currentColor" strokeWidth="4" fill="transparent" strokeDasharray={`${levelInfo.progress * 3.01} 301`} strokeLinecap="round" className="text-cyan-500" />
            </svg>

            <div className="relative z-10 h-28 w-28 overflow-hidden rounded-full border border-slate-200 bg-slate-100 dark:border-slate-700 dark:bg-slate-800 md:h-32 md:w-32">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="Фото профиля" className="w-full h-full object-cover" />
              ) : (
                <div className="w-full h-full flex items-center justify-center">
                  <UserCircle2 className="w-16 h-16 md:w-20 md:h-20 text-slate-400" />
                </div>
              )}
            </div>
            
            {isMyProfile && (
              <label className="absolute bottom-2 right-2 z-20 flex h-10 w-10 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-cyan-400 text-slate-950 transition hover:bg-cyan-300 dark:border-slate-950">
                {uploadingAvatar ? <Loader2 className="w-5 h-5 animate-spin" /> : <Camera className="w-5 h-5 md:w-6 md:h-6" />}
                <input type="file" accept="image/*" className="hidden" onChange={handleFileChange} disabled={uploadingAvatar} />
              </label>
            )}

            <div className="absolute -bottom-2 left-1/2 z-30 -translate-x-1/2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
              Уровень {levelInfo.level}
            </div>
          </div>
          
          <div className="flex-1 text-center md:text-left pt-2">
            <div className="flex flex-col md:flex-row items-center md:justify-start gap-3 mb-2">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-950 dark:text-white md:text-4xl">{profile.full_name || 'Студент'}</h1>
              {profile.is_pro && (
                <div className="flex flex-col items-center md:items-start">
                  <div className="flex items-center gap-1.5 rounded-md border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-amber-600 dark:text-amber-300">
                    <Star className="w-4 h-4 fill-current" />
                    <span className="text-xs font-semibold">PRO</span>
                  </div>
                  {profile.pro_until && (
                    <span className="text-[10px] text-slate-500 mt-1 uppercase tracking-widest font-bold">
                      до {new Date(profile.pro_until).toLocaleDateString('ru-RU')}
                    </span>
                  )}
                </div>
              )}
            </div>
            
            <div className="flex items-center justify-center md:justify-start gap-2 mb-4">
              <span className="px-3 py-1 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono text-sm font-bold rounded-lg cursor-pointer hover:bg-slate-200 dark:hover:bg-slate-700 transition" onClick={() => {
                if (profile.public_id) {
                  navigator.clipboard.writeText(profile.public_id);
                  toast.success('ID скопирован!');
                }
              }} title="Нажмите, чтобы скопировать ID">
                ID: #{profile.public_id || 'загрузка...'}
              </span>
            </div>

            {profile.university && (
              <div className="mb-3 flex items-center justify-center gap-2 text-slate-600 dark:text-slate-300 md:justify-start">
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
              <div className="mt-4 flex flex-wrap justify-center md:justify-start gap-3">
                {friendStatus === 'none' && (
                  <button onClick={handleAddFriend} className="flex items-center gap-2 rounded-lg bg-cyan-400 px-5 py-2.5 font-semibold text-slate-950 transition hover:bg-cyan-300">
                    <UserPlus className="w-5 h-5" /> Добавить в друзья
                  </button>
                )}
                {friendStatus === 'pending' && (
                  <button disabled className="px-5 py-2.5 bg-white/50 dark:bg-slate-800/50 text-slate-500 dark:text-slate-400 rounded-xl font-bold flex items-center gap-2 cursor-not-allowed border border-slate-200 dark:border-slate-700">
                    <Check className="w-5 h-5" /> Заявка отправлена
                  </button>
                )}
                {friendStatus === 'accepted' && (
                  <button className="px-5 py-2.5 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-xl font-bold flex items-center gap-2 border border-emerald-500/20">
                    <Check className="w-5 h-5" /> В друзьях
                  </button>
                )}
                
                <button 
                  onClick={() => navigate(`/messages/${targetId}`)}
                  className="px-5 py-2.5 bg-sky-50 dark:bg-sky-900/30 text-sky-600 dark:text-sky-400 border border-sky-200 dark:border-sky-800 rounded-xl font-bold flex items-center gap-2 hover:bg-sky-100 dark:hover:bg-sky-900/50 transition"
                >
                  <MessageSquare className="w-5 h-5" /> Написать
                </button>

                <button 
                  onClick={handleToggleBlock}
                  disabled={blockLoading}
                  className={`px-5 py-2.5 rounded-xl font-bold flex items-center gap-2 transition border ${
                    isBlocked 
                      ? 'bg-slate-800 text-white border-slate-700 hover:bg-slate-700' 
                      : 'bg-rose-50 dark:bg-rose-900/20 text-rose-600 dark:text-rose-400 border-rose-200 dark:border-rose-900/50 hover:bg-rose-100 dark:hover:bg-rose-900/40'
                  }`}
                >
                  <Ban className="w-5 h-5" /> {isBlocked ? 'Разблокировать' : 'Заблокировать'}
                </button>
              </div>
            ) : (
              <div className="mt-4 flex justify-center md:justify-start">
                <button onClick={() => setIsEditing(!isEditing)} className={`flex items-center gap-2 rounded-lg border px-5 py-2.5 font-semibold transition ${isEditing ? 'border-rose-500/30 text-rose-600 dark:text-rose-400' : 'border-slate-200 text-slate-700 hover:border-cyan-400 dark:border-slate-700 dark:text-slate-200'}`}>
                  {isEditing ? <X className="w-4 h-4" /> : <Edit3 className="w-4 h-4" />}
                  {isEditing ? 'Отменить редактирование' : 'Редактировать профиль'}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Форма редактирования (плавная) */}
        {isEditing && (
          <motion.div initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} className="relative z-20 mb-8 border-y border-slate-200 py-6 dark:border-slate-800">
            <h3 className="mb-4 font-semibold text-slate-900 dark:text-white">Редактирование профиля</h3>
            <div className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Имя и Фамилия</label>
                  <input type="text" value={editForm.full_name} onChange={e => setEditForm({...editForm, full_name: e.target.value})} className="w-full rounded-lg border border-slate-200 bg-transparent px-4 py-3 text-slate-900 outline-none transition focus:border-cyan-400 dark:border-slate-700 dark:text-slate-100" placeholder="Иван Иванов" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Университет / Школа</label>
                  <UniversitySelect value={editForm.university} onChange={(val) => setEditForm({...editForm, university: val})} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">О себе</label>
                <textarea value={editForm.bio} onChange={e => setEditForm({...editForm, bio: e.target.value})} className="min-h-[100px] w-full resize-none rounded-lg border border-slate-200 bg-transparent px-4 py-3 text-slate-900 outline-none transition focus:border-cyan-400 dark:border-slate-700 dark:text-slate-100" rows={3} placeholder="Факультет, направление и учебные интересы" />
              </div>
              <div className="w-full md:w-1/2 relative z-20">
                <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1">Роль в системе</label>
                <CustomSelect 
                  value={editForm.role} 
                  onChange={val => setEditForm({...editForm, role: val})} 
                  className="rounded-lg border border-slate-200 bg-transparent px-4 py-3 text-slate-900 focus:ring-2 focus:ring-cyan-400 dark:border-slate-700 dark:text-slate-100"
                  options={[
                    { value: 'student', label: 'Студент' },
                    { value: 'teacher', label: 'Преподаватель' }
                  ]}
                />
              </div>
              <div className="flex justify-end pt-4">
                <button onClick={handleSaveProfile} className="rounded-lg bg-cyan-400 px-6 py-2.5 font-semibold text-slate-950 transition hover:bg-cyan-300">Сохранить</button>
              </div>
            </div>
          </motion.div>
        )}

        {!isEditing && profile.bio && (
          <div className="mb-8 border-y border-slate-200 py-5 text-slate-700 dark:border-slate-800 dark:text-slate-300">
            <div className="max-w-3xl leading-7">{profile.bio}</div>
          </div>
        )}

        <div className="grid grid-cols-2 border-y border-slate-200 dark:border-slate-800 md:grid-cols-4">
          {[
            { label: 'Опыт', value: `${xp} XP`, icon: Star },
            { label: 'Дней подряд', value: profile.streak_days || 0, icon: Trophy },
            { label: 'Материалов', value: profile.total_materials || 0, icon: BookOpen },
            { label: 'Повторений', value: profile.total_reviews || 0, icon: GraduationCap },
          ].map(({ label, value, icon: Icon }, index) => (
            <div key={label} className={`py-5 ${index % 2 ? 'pl-5' : 'pr-5'} ${index > 1 ? 'border-t border-slate-200 dark:border-slate-800' : ''} md:border-l md:border-t-0 md:px-5 md:first:border-l-0 md:first:pl-0`}>
              <Icon className="mb-3 h-4 w-4 text-cyan-500" />
              <div className="text-2xl font-semibold text-slate-950 dark:text-white">{value}</div>
              <div className="mt-1 text-xs text-slate-500">{label}</div>
            </div>
          ))}
        </div>

        <p className="py-4 text-sm text-slate-500">
          Уровень {levelInfo.level}: {levelInfo.name}. До следующего уровня — {Math.max(0, levelInfo.nextXP - levelInfo.currentXP)} XP.
        </p>

        {isMyProfile && (
          <div className="mt-8 pt-8 border-t border-slate-100 dark:border-slate-800">
            <h3 className="font-semibold text-slate-900 dark:text-slate-100 mb-4">Уведомления</h3>
            <div className="flex flex-col justify-between gap-4 border-y border-slate-200 py-4 dark:border-slate-800 sm:flex-row sm:items-center">
              <div className="flex items-start sm:items-center gap-3">
                {pushEnabled ? <Bell className="w-5 h-5 text-cyan-500" /> : <BellOff className="w-5 h-5 text-slate-500" />}
                <div className="text-left">
                  <p className="font-semibold text-slate-900 dark:text-slate-200 text-sm">Напоминания о повторении</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-tight mt-0.5">Meldy сообщит, когда карточки будут готовы к повторению.</p>
                </div>
              </div>
              <button 
                onClick={handleTogglePush}
                disabled={pushLoading || pushEnabled}
                className={`w-full sm:w-auto shrink-0 px-4 py-2 rounded-lg text-sm font-bold transition ${
                  pushLoading ? 'bg-slate-200 dark:bg-slate-800 text-slate-400 dark:text-slate-600 cursor-not-allowed' :
                  pushEnabled ? 'text-cyan-600 dark:text-cyan-300 cursor-default border border-cyan-400/30' :
                  'bg-cyan-400 hover:bg-cyan-300 text-slate-950'
                }`}
              >
                {pushLoading ? 'Загрузка...' : pushEnabled ? 'Включено' : 'Включить'}
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {isMyProfile && incomingRequests.length > 0 && (
        <section className="border-y border-slate-200 py-6 dark:border-slate-800">
          <h2 className="mb-4 text-xl font-semibold text-slate-900 dark:text-slate-100">Заявки в друзья · {incomingRequests.length}</h2>
          <div className="space-y-3">
            {incomingRequests.map(req => (
              <div key={req.id} className="flex items-center justify-between border-b border-slate-200 py-4 last:border-b-0 dark:border-slate-800">
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
        </section>
      )}

      {cropImageSrc && (
        <ImageCropper 
          imageSrc={cropImageSrc} 
          onCropComplete={handleCropComplete} 
          onClose={() => setCropImageSrc(null)} 
        />
      )}
    </main>
  );
}
