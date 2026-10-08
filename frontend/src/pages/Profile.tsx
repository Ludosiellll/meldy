import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { getProfile, updateProfile, uploadAvatar, UserProfile } from '../api/social';
import { UserCircle2, GraduationCap, Trophy, BookOpen, Loader2, Edit3, X, Bell, BellOff, Camera, Star, Ticket } from 'lucide-react';
import { subscribeUserToPush, checkPushSubscription, requestNotificationPermission } from '../utils/push';
import UniversitySelect from '../components/UniversitySelect';
import toast from 'react-hot-toast';
import ImageCropper from '../components/ImageCropper';
import AnswerTextsSetting from '../components/oral/AnswerTextsSetting';
import DailyReminder from '../components/reminders/DailyReminder';
import { TELEMETRY_NOTE } from '../lib/telemetry';
import { supabase } from '../lib/supabase';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { pluralRu } from '../components/conversation/visuals';
import { studyStreak, windowStart, type JournalDay, type SessionDay } from '../lib/learning/studyDays';
import './Profile.css';

/** How far back the streak looks: a longer streak still counts these days. */
const STREAK_DAYS = 60;

/**
 * The three figures of the profile, counted live from the student's own rows (LIB-13). The old
 * profiles.streak_days / total_materials / total_reviews columns are no longer written by anyone
 * since the browser lost write access to them (migration 20260924055024), so they read 0 for every
 * account. Each figure is null when it could not be counted: the page then shows «—», never a 0.
 */
export interface ProfileStats {
  /** Days of study in a row: cards, ticket answers or tests (lib/learning/studyDays). */
  streak: number | null;
  /** The student's lectures (materials), as «Лекции» lists them. */
  lectures: number | null;
  /** Answers to exam tickets, spoken or typed (exam_answer in the learning journal). */
  answers: number | null;
}

export async function loadProfileStats(userId: string, now: Date = new Date()): Promise<ProfileStats> {
  // HEAD requests with count=exact: no rows are transferred.
  const counted = async (run: () => PromiseLike<{ count: number | null; error: unknown }>): Promise<number | null> => {
    try {
      const { count, error } = await run();
      return error || typeof count !== 'number' ? null : Math.max(0, count);
    } catch {
      return null;
    }
  };
  const streak = async (): Promise<number | null> => {
    try {
      const since = windowStart(STREAK_DAYS, now);
      const [sessions, events] = await Promise.all([
        supabase.from('study_sessions').select('date, cards_reviewed').eq('user_id', userId).gte('date', since),
        supabase
          .from('learning_events')
          .select('kind, local_date')
          .eq('user_id', userId)
          .in('kind', ['exam_answer', 'quiz_answer'])
          .gte('local_date', since)
          .order('local_date', { ascending: false })
          .limit(5000),
      ]);
      if (sessions.error || events.error) return null;
      return studyStreak({ sessions: (sessions.data ?? []) as SessionDay[], events: (events.data ?? []) as JournalDay[] }, now);
    } catch {
      return null;
    }
  };
  const [days, lectures, answers] = await Promise.all([
    streak(),
    counted(() => supabase.from('materials').select('id', { count: 'exact', head: true }).eq('user_id', userId)),
    counted(() => supabase.from('learning_events').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('kind', 'exam_answer')),
  ]);
  return { streak: days, lectures, answers };
}

/**
 * Профиль (Meldy 2026-10-04): белая карточка с цветной обложкой и аватаром, действия — пилюли,
 * цифры — в отдельных карточках. Стили — .ac-* в styles/legacy.css и Profile.css. Только свой профиль.
 */
export default function Profile() {
  useDocumentTitle('Профиль');
  const { user } = useAuth();
  const userId = user?.id;

  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ProfileStats | null>(null);

  // Edit State
  const [isEditing, setIsEditing] = useState(false);
  const [editForm, setEditForm] = useState({ full_name: '', university: '', bio: '', avatar_url: '' });

  // Push notifications state
  const [pushEnabled, setPushEnabled] = useState(false);
  const [pushLoading, setPushLoading] = useState(true);

  // Avatar Upload state
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [cropImageSrc, setCropImageSrc] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    void loadProfileStats(userId).then((value) => {
      if (!cancelled) setStats(value);
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  useEffect(() => {
    if (!userId) return;

    getProfile(userId).then(p => {
      setProfile(p);
      if (p) {
        setEditForm({
          full_name: p.full_name || '',
          university: p.university || '',
          bio: p.bio || '',
          avatar_url: p.avatar_url || '',
        });
      }
      setLoading(false);
    });

    checkPushSubscription().then(enabled => {
      setPushEnabled(enabled);
      setPushLoading(false);
    });
  }, [userId]);

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

  // Counted live (LIB-13); «—» while counting or when a figure could not be read, never an invented 0.
  const figures = [
    { key: 'streak', value: stats?.streak ?? null, forms: ['день подряд', 'дня подряд', 'дней подряд'] as const, icon: Trophy, tone: 'p' },
    { key: 'lectures', value: stats?.lectures ?? null, forms: ['лекция', 'лекции', 'лекций'] as const, icon: BookOpen, tone: 'b' },
    { key: 'answers', value: stats?.answers ?? null, forms: ['ответ на билет', 'ответа на билеты', 'ответов на билеты'] as const, icon: Ticket, tone: 'g' },
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

            {profile.university && (
              <p className="ac-uni">
                <GraduationCap aria-hidden="true" />
                {profile.university}
              </p>
            )}

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

      <div className="ac-stats ac-rise" aria-busy={stats === null}>
        {figures.map(({ key, value, forms, icon: Icon, tone }) => (
          <div key={key} className="ac-stat" data-stat={key}>
            <span className={`ac-stat-i ac-stat-i--${tone}`} aria-hidden="true">
              <Icon />
            </span>
            <span className="ac-stat-v">
              {value === null ? (
                <>
                  <span aria-hidden="true">—</span>
                  <span className="sr-only">{stats === null ? 'считаем' : 'не удалось посчитать'}</span>
                </>
              ) : (
                value
              )}
            </span>
            {/* The word agrees with the number: «1 день подряд», «3 лекции», «14 ответов на билеты». */}
            <span className="ac-stat-l">{pluralRu(value ?? 0, forms)}</span>
          </div>
        ))}
      </div>

      <section className="ac-card ac-rise" aria-labelledby="profile-push-title">
        <h2 id="profile-push-title" className="ac-card-h">Уведомления</h2>
        {/* First: a calendar event on the student's own device (push subscriptions do not survive a release). */}
        <DailyReminder variant="profile" />
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

      <AnswerTextsSetting />

      <p className="ac-levelline">{TELEMETRY_NOTE}</p>

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
