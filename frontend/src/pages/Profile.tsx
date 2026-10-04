import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getProfile, updateProfile, uploadAvatar, UserProfile } from '../api/social';
import { getFriends, sendFriendRequest, respondFriendRequest, Friendship, blockUser, unblockUser, getBlockedUserIds } from '../api/chat';
import { UserCircle2, GraduationCap, Trophy, BookOpen, Loader2, UserPlus, Check, Edit3, X, UserCheck, UserX, Bell, BellOff, Camera, Star, MessageSquare, Ban } from 'lucide-react';
import { useParams, useNavigate } from 'react-router-dom';
import { subscribeUserToPush, checkPushSubscription, requestNotificationPermission } from '../utils/push';
import UniversitySelect from '../components/UniversitySelect';
import { getUserXP, calcLevel } from '../api/quests';
import toast from 'react-hot-toast';
import ImageCropper from '../components/ImageCropper';
import { CustomSelect } from '../components/CustomSelect';

/**
 * Профиль (Meldy 2026-10-04): белая карточка с цветной обложкой и аватаром, действия — пилюли,
 * цифры — в отдельных карточках. Стили — .ac-* в styles/legacy.css.
 */
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

  if (loading) {
    return (
      <div className="sf-page">
        <div className="ac-wait">
          <span className="ac-ring" aria-hidden="true" />
        </div>
      </div>
    );
  }
  if (!profile) {
    return (
      <div className="sf-page">
        <p className="ac-empty">Профиль не найден.</p>
      </div>
    );
  }

  const stats = [
    { label: 'Опыт', value: `${xp} XP`, icon: Star, tone: 'y' },
    { label: 'Дней подряд', value: profile.streak_days || 0, icon: Trophy, tone: 'p' },
    { label: 'Материалов', value: profile.total_materials || 0, icon: BookOpen, tone: 'b' },
    { label: 'Повторений', value: profile.total_reviews || 0, icon: GraduationCap, tone: 'g' },
  ];

  return (
    <div className="sf-page ac-profile">
      <section className="ac-hero ac-rise" aria-labelledby="profile-name">
        <div className="ac-cover" aria-hidden="true">
          <span className="ac-art-dots" />
        </div>

        <div className="ac-hero-body">
          <div className="ac-avatar-wrap">
            <div className="ac-avatar">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="Фото профиля" />
              ) : (
                <UserCircle2 aria-hidden="true" />
              )}
            </div>

            {isMyProfile && (
              <label className="ac-avatar-edit">
                {uploadingAvatar ? <Loader2 className="ac-spin" aria-hidden="true" /> : <Camera aria-hidden="true" />}
                <input
                  type="file"
                  accept="image/*"
                  className="sr-only"
                  onChange={handleFileChange}
                  disabled={uploadingAvatar}
                  aria-label="Загрузить фото профиля"
                />
              </label>
            )}

            <span className="ac-level-pill">Уровень {levelInfo.level}</span>
          </div>

          <div className="ac-who">
            <div className="ac-name-row">
              <h1 id="profile-name" className="ac-name">{profile.full_name || 'Студент'}</h1>
              {profile.is_pro && (
                <span className="ac-pro">
                  <span className="ac-flag ac-flag--y">
                    <Star aria-hidden="true" />
                    PRO
                  </span>
                  {profile.pro_until && (
                    <span className="ac-pro-until">до {new Date(profile.pro_until).toLocaleDateString('ru-RU')}</span>
                  )}
                </span>
              )}
            </div>

            <div className="ac-chips">
              <button
                type="button"
                className="ac-chip ac-chip--id"
                onClick={() => {
                  if (profile.public_id) {
                    navigator.clipboard.writeText(profile.public_id);
                    toast.success('ID скопирован!');
                  }
                }}
                title="Нажмите, чтобы скопировать ID"
              >
                ID: #{profile.public_id || 'загрузка...'}
              </button>
              {profile.role === 'teacher' && <span className="ac-chip ac-chip--teacher">Преподаватель</span>}
            </div>

            {profile.university && (
              <p className="ac-uni">
                <GraduationCap aria-hidden="true" />
                {profile.university}
              </p>
            )}

            {!isMyProfile ? (
              <div className="ac-actions">
                {friendStatus === 'none' && (
                  <button type="button" onClick={handleAddFriend} className="ac-btn ac-btn--blue">
                    <UserPlus aria-hidden="true" /> Добавить в друзья
                  </button>
                )}
                {friendStatus === 'pending' && (
                  <button type="button" disabled className="ac-btn ac-btn--quiet">
                    <Check aria-hidden="true" /> Заявка отправлена
                  </button>
                )}
                {friendStatus === 'accepted' && (
                  <button type="button" className="ac-btn ac-btn--ok">
                    <Check aria-hidden="true" /> В друзьях
                  </button>
                )}

                <button type="button" onClick={() => navigate(`/messages/${targetId}`)} className="ac-btn">
                  <MessageSquare aria-hidden="true" /> Написать
                </button>

                <button
                  type="button"
                  onClick={handleToggleBlock}
                  disabled={blockLoading}
                  className={`ac-btn ${isBlocked ? 'ac-btn--ink' : 'ac-btn--danger'}`}
                >
                  <Ban aria-hidden="true" /> {isBlocked ? 'Разблокировать' : 'Заблокировать'}
                </button>
              </div>
            ) : (
              <div className="ac-actions">
                <button
                  type="button"
                  onClick={() => setIsEditing(!isEditing)}
                  className={`ac-btn ${isEditing ? 'ac-btn--danger' : ''}`}
                  aria-expanded={isEditing}
                >
                  {isEditing ? <X aria-hidden="true" /> : <Edit3 aria-hidden="true" />}
                  {isEditing ? 'Отменить редактирование' : 'Редактировать профиль'}
                </button>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Форма редактирования */}
      {isEditing && (
        <section className="ac-card ac-edit ac-rise" aria-labelledby="profile-edit-title">
          <h2 id="profile-edit-title" className="ac-card-h">Редактирование профиля</h2>
          <div className="ac-form">
            <div className="ac-form-row">
              <div className="ac-field">
                <label htmlFor="profile-name-input" className="ac-label">Имя и Фамилия</label>
                <input
                  id="profile-name-input"
                  type="text"
                  value={editForm.full_name}
                  onChange={e => setEditForm({...editForm, full_name: e.target.value})}
                  className="ac-input"
                  placeholder="Иван Иванов"
                />
              </div>
              <div className="ac-field">
                <label htmlFor="profile-university-input" className="ac-label">Университет / Школа</label>
                <UniversitySelect id="profile-university-input" value={editForm.university} onChange={(val) => setEditForm({...editForm, university: val})} />
              </div>
            </div>
            <div className="ac-field">
              <label htmlFor="profile-bio-input" className="ac-label">О себе</label>
              <textarea
                id="profile-bio-input"
                value={editForm.bio}
                onChange={e => setEditForm({...editForm, bio: e.target.value})}
                className="ac-input ac-textarea"
                rows={3}
                placeholder="Факультет, направление и учебные интересы"
              />
            </div>
            <div className="ac-field ac-field--half">
              <span className="ac-label">Роль в системе</span>
              <CustomSelect
                value={editForm.role}
                onChange={val => setEditForm({...editForm, role: val})}
                className="ac-input ac-select"
                options={[
                  { value: 'student', label: 'Студент' },
                  { value: 'teacher', label: 'Преподаватель' }
                ]}
              />
            </div>
            <div className="ac-form-end">
              <button type="button" onClick={handleSaveProfile} className="sf-primary">Сохранить</button>
            </div>
          </div>
        </section>
      )}

      {!isEditing && profile.bio && (
        <section className="ac-card ac-bio ac-rise">
          <p>{profile.bio}</p>
        </section>
      )}

      <div className="ac-stats ac-rise">
        {stats.map(({ label, value, icon: Icon, tone }) => (
          <div key={label} className="ac-stat">
            <span className={`ac-stat-i ac-stat-i--${tone}`} aria-hidden="true">
              <Icon />
            </span>
            <span className="ac-stat-v">{value}</span>
            <span className="ac-stat-l">{label}</span>
          </div>
        ))}
      </div>

      <p className="ac-levelline">
        Уровень {levelInfo.level}: {levelInfo.name}. До следующего уровня — {Math.max(0, levelInfo.nextXP - levelInfo.currentXP)} XP.
      </p>

      {isMyProfile && (
        <section className="ac-card ac-rise" aria-labelledby="profile-push-title">
          <h2 id="profile-push-title" className="ac-card-h">Уведомления</h2>
          <div className="ac-row">
            <span className={`ac-row-i ${pushEnabled ? 'ac-row-i--on' : ''}`} aria-hidden="true">
              {pushEnabled ? <Bell /> : <BellOff />}
            </span>
            <div className="ac-row-text">
              <p className="ac-row-t">Напоминания о повторении</p>
              <p className="ac-row-d">Meldy сообщит, когда карточки будут готовы к повторению.</p>
            </div>
            <button
              type="button"
              onClick={handleTogglePush}
              disabled={pushLoading || pushEnabled}
              className={`ac-btn ac-row-btn ${pushLoading ? 'ac-btn--quiet' : pushEnabled ? 'ac-btn--ok' : 'ac-btn--blue'}`}
            >
              {pushLoading ? 'Загрузка...' : pushEnabled ? 'Включено' : 'Включить'}
            </button>
          </div>
        </section>
      )}

      {isMyProfile && incomingRequests.length > 0 && (
        <section className="ac-card ac-rise" aria-labelledby="profile-requests-title">
          <h2 id="profile-requests-title" className="ac-card-h">Заявки в друзья · {incomingRequests.length}</h2>
          <ul className="ac-requests">
            {incomingRequests.map(req => (
              <li key={req.id} className="ac-request">
                <div className="ac-request-who">
                  {req.friend_avatar ? (
                    <img src={req.friend_avatar} className="ac-request-ava" alt="avatar" />
                  ) : (
                    <UserCircle2 className="ac-request-ava ac-request-ava--none" aria-hidden="true" />
                  )}
                  <span className="ac-request-name">{req.friend_name}</span>
                </div>
                <div className="ac-request-acts">
                  <button type="button" onClick={() => handleRespondRequest(req.id, 'accepted')} className="ac-round ac-round--ok" title="Принять" aria-label="Принять">
                    <UserCheck aria-hidden="true" />
                  </button>
                  <button type="button" onClick={() => handleRespondRequest(req.id, 'declined')} className="ac-round ac-round--no" title="Отклонить" aria-label="Отклонить">
                    <UserX aria-hidden="true" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </section>
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
