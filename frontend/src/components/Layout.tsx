import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  GraduationCap, LayoutDashboard, Zap, BookOpen, Brain,
  Calendar, MessageSquare, LogOut, Award, Gamepad2,
  BookMarked, Heart, BarChart2, Clock, ChevronRight, Network,
  Globe, Briefcase, MessageCircle, User, Bell
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getUserXP, calcLevel } from '../api/quests';
import { getProfile } from '../api/social';
import { getUnreadCount, subscribeToNotifications, getNotifications, markAllRead, Notification } from '../api/chat';

const navGroups = [
  {
    title: 'Платформа',
    items: [
      { to: '/dashboard',   icon: LayoutDashboard, label: 'Дашборд' },
      { to: '/network',     icon: Globe,           label: 'Study Network', isNew: true },
      { to: '/messages',    icon: MessageCircle,   label: 'Сообщения', isNew: true },
      { to: '/profile',     icon: User,            label: 'Мой профиль' },
      { to: '/career',      icon: Briefcase,       label: 'Карьерный трек' },
    ]
  },
  {
    title: 'Обучение',
    items: [
      { to: '/analyze',     icon: Zap,             label: 'Добавить материал' },
      { to: '/library',     icon: BookOpen,        label: 'Библиотека' },
      { to: '/knowledge-map', icon: Network,       label: 'Карта знаний' },
      { to: '/planner',     icon: Calendar,        label: 'План подготовки' },
    ]
  },
  {
    title: 'Практика',
    items: [
      { to: '/play',        icon: Gamepad2,        label: 'Сюжетные миссии' },
      { to: '/review',      icon: Brain,           label: 'Смарт-карточки' },
      { to: '/exam',        icon: Award,           label: 'Устный экзамен' },
      { to: '/quick-prep',  icon: Clock,           label: 'Повтор за 5 минут' },
    ]
  },
  {
    title: 'Аналитика',
    items: [
      { to: '/analytics',   icon: BarChart2,       label: 'Прогресс' },
      { to: '/mistakes',    icon: BookMarked,      label: 'Дневник ошибок' },
      { to: '/mood',        icon: Heart,           label: 'Эмоциональный фон' },
      { to: '/chat',        icon: MessageSquare,   label: 'Чат-наставник' },
    ]
  }
];

const mobileNavItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Главная' },
  { to: '/network',   icon: Globe,            label: 'Хаб' },
  { to: '/messages',  icon: MessageCircle,    label: 'Чат' },
  { to: '/profile',   icon: User,             label: 'Профиль' },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const email = user?.email ?? '';
  const name = user?.user_metadata?.full_name || email.split('@')[0] || '?';
  const initial = name ? name[0].toUpperCase() : '?';

  const [xp, setXp] = useState(0);
  const [levelInfo, setLevelInfo] = useState(calcLevel(0));
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (!user?.id) return;

    // XP
    const fetchXP = () => getUserXP(user.id).then(v => { setXp(v); setLevelInfo(calcLevel(v)); });
    fetchXP();
    window.addEventListener('xp_updated', fetchXP);

    // Аватарка из профиля
    getProfile(user.id).then(p => { if (p?.avatar_url) setAvatarUrl(p.avatar_url); });

    // Счётчик уведомлений
    getUnreadCount(user.id).then(setUnreadCount);

    // Realtime подписка на новые уведомления
    const unsub = subscribeToNotifications(user.id, () => {
      getUnreadCount(user.id).then(setUnreadCount);
    });

    return () => {
      window.removeEventListener('xp_updated', fetchXP);
      unsub();
    };
  }, [user?.id]);

  const handleOpenNotifications = async () => {
    if (!user) return;
    setShowNotifications(v => !v);
    if (!showNotifications) {
      const notifs = await getNotifications(user.id);
      setNotifications(notifs);
      if (unreadCount > 0) {
        await markAllRead(user.id);
        setUnreadCount(0);
      }
    }
  };

  return (
    <div className="flex h-screen bg-slate-50">
      {/* ═══ SIDEBAR ════════════════════════════════════════════════════════════ */}
      <aside className="w-64 bg-slate-900 flex flex-col shrink-0 hidden md:flex border-r border-slate-800">
        {/* Logo */}
        <button
          onClick={() => navigate('/dashboard')}
          className="p-5 flex items-center gap-3 hover:opacity-80 transition w-full text-left"
        >
          <div className="w-7 h-7 rounded bg-indigo-500 flex items-center justify-center shadow-sm">
            <GraduationCap className="w-4 h-4 text-white" />
          </div>
          <span className="font-semibold tracking-tight text-white text-lg">StudyForge</span>
        </button>

        {/* XP / Level блок */}
        <div className="mx-4 mt-2 mb-4 p-3 bg-slate-800/50 rounded-xl border border-slate-700/50">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mb-0.5">Level {levelInfo.level}</p>
              <p className="text-xs font-semibold text-slate-200">{levelInfo.name}</p>
            </div>
            <button
              onClick={() => navigate('/analytics')}
              className="text-slate-500 hover:text-slate-300 transition bg-slate-800 p-1.5 rounded-md"
              title="Аналитика"
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-700"
              style={{ width: `${levelInfo.progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-[10px] font-medium text-slate-500">{xp} XP</span>
            <span className="text-[10px] font-medium text-slate-500">{levelInfo.currentXP}/{levelInfo.nextXP}</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 pb-6 space-y-5 overflow-y-auto custom-scrollbar">
          {navGroups.map((group, idx) => (
            <div key={idx}>
              <h3 className="px-3 text-[11px] font-bold text-slate-500 uppercase tracking-wider mb-2">
                {group.title}
              </h3>
              <div className="space-y-0.5">
                {group.items.map(item => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      'flex items-center justify-between px-3 py-2 text-[13px] font-medium rounded-lg transition-colors ' +
                      (isActive
                        ? 'bg-slate-800 text-white shadow-sm ring-1 ring-white/5'
                        : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200')
                    }
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className="w-4 h-4 opacity-80" />
                      {item.label}
                    </div>
                    {(item as any).isNew && (
                      <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-md bg-indigo-500/20 text-indigo-400 border border-indigo-500/20 uppercase tracking-widest">
                        New
                      </span>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            {/* Аватарка из профиля */}
            <button onClick={() => navigate('/profile')} className="shrink-0">
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className="w-8 h-8 rounded-full object-cover ring-2 ring-indigo-500/50" />
              ) : (
                <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
                  {initial}
                </div>
              )}
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-slate-300 text-xs font-medium truncate">{name}</p>
              <p className="text-slate-500 text-[10px] truncate">{email}</p>
            </div>
            {/* Колокольчик уведомлений */}
            <div className="relative">
              <button
                onClick={handleOpenNotifications}
                className="text-slate-500 hover:text-slate-200 transition relative"
                title="Уведомления"
              >
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>

              {/* Дропдаун уведомлений */}
              {showNotifications && (
                <div className="absolute bottom-8 right-0 w-72 bg-white rounded-xl shadow-2xl border border-slate-200 z-50 overflow-hidden">
                  <div className="p-3 border-b border-slate-100 flex items-center justify-between">
                    <span className="font-bold text-slate-800 text-sm">Уведомления</span>
                    <button onClick={() => setShowNotifications(false)} className="text-slate-400 hover:text-slate-600 text-xs">✕</button>
                  </div>
                  <div className="max-h-64 overflow-y-auto divide-y divide-slate-50">
                    {notifications.length === 0 ? (
                      <p className="p-4 text-sm text-center text-slate-400">Нет уведомлений</p>
                    ) : notifications.map(n => (
                      <div key={n.id} className={`p-3 ${n.is_read ? '' : 'bg-indigo-50/50'}`}>
                        <p className="text-sm font-medium text-slate-800">{n.title}</p>
                        {n.body && <p className="text-xs text-slate-500 mt-0.5 truncate">{n.body}</p>}
                        <p className="text-[10px] text-slate-400 mt-1">{new Date(n.created_at).toLocaleString()}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <button
              onClick={signOut}
              className="text-slate-500 hover:text-rose-400 transition"
              title="Выйти"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ═══ MAIN CONTENT ══════════════════════════════════════════════════════ */}
      <main className="flex-1 overflow-auto pb-16 md:pb-0">
        <Outlet />
      </main>

      {/* ═══ MOBILE BOTTOM NAV ════════════════════════════════════════════════ */}
      <nav className="fixed bottom-0 left-0 right-0 z-40 bg-white border-t border-slate-200 flex md:hidden">
        {mobileNavItems.map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            className={({ isActive }) =>
              'flex-1 flex flex-col items-center justify-center py-2.5 gap-1 text-[10px] font-bold transition ' +
              (isActive ? 'text-indigo-600' : 'text-slate-400')
            }
          >
            {({ isActive }) => (
              <>
                <item.icon className={`w-5 h-5 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
