import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  GraduationCap, LayoutDashboard, Zap, BookOpen, Brain,
  Clock, MessageSquare, LogOut, Award, Gamepad2,
  BookMarked, BarChart2, ChevronRight, Network,
  Globe, User, Bell, Menu, X, Users, CreditCard, Briefcase
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getUserXP, calcLevel } from '../api/quests';
import { getProfile, UserProfile } from '../api/social';
import { getUnreadCount, subscribeToNotifications, subscribeToMessages, getNotifications, markAllRead, Notification, getUnreadDMsGrouped, deleteNotification } from '../api/chat';
import toast from 'react-hot-toast';
import { ErrorBoundary } from './ErrorBoundary';
import OnboardingManager from './OnboardingManager';
import ForgeyAssistant from './ForgeyAssistant';
import { useTheme } from '../contexts/ThemeProvider';
import { Moon, Sun } from 'lucide-react';
import { checkAILimit, FREE_DAILY_LIMIT } from '../api/limits';
import TokenInfoModal from './TokenInfoModal';
import { useInstallPWA } from '../hooks/useInstallPWA';
import { Download } from 'lucide-react';

const navGroups = [
  {
    title: 'Учёба',
    items: [
      { to: '/dashboard',     icon: LayoutDashboard, label: 'Дашборд',              className: '' },
      { to: '/analyze',       icon: Zap,             label: 'Добавить материал',    className: 'tour-step-desktop-upload' },
      { to: '/library',       icon: BookOpen,        label: 'Библиотека',           className: 'tour-step-desktop-library' },
      { to: '/knowledge-map', icon: Network,         label: 'Карта знаний',         className: '' },
    ]
  },
  {
    title: 'Практика',
    items: [
      { to: '/chat',          icon: MessageSquare,   label: 'Чат-наставник',        className: 'tour-step-desktop-chat' },
      { to: '/review',        icon: Brain,           label: 'Смарт-карточки',       className: '' },
      { to: '/exam',          icon: Award,           label: 'Устный экзамен',       className: 'tour-step-desktop-exam' },
      { to: '/quick-prep',    icon: Clock,           label: 'Быстрый повтор',       className: '' },
      { to: '/career',        icon: Briefcase,       label: 'Карьера и вакансии',   className: '' },
    ]
  },
  {
    title: 'Прогресс',
    items: [
      { to: '/messages',                icon: MessageSquare,   label: 'Диалоги и друзья',     className: '' },
      { to: '/analytics?tab=platform',  icon: BarChart2,       label: 'Аналитика обучения',   className: '' },
      { to: '/analytics?tab=gradebook', icon: GraduationCap,   label: 'Дневник оценок',       className: 'tour-step-desktop-gradebook' },
      { to: '/mistakes',                icon: BookMarked,      label: 'Дневник ошибок',       className: '' },
      { to: '/play',                    icon: Gamepad2,        label: 'Квесты',               className: '' },
    ]
  },
];

const teacherNavGroups = [
  {
    title: 'Управление',
    items: [
      { to: '/teacher',   icon: Network,   label: 'Мои группы' },
      { to: '/messages',  icon: MessageSquare, label: 'Диалоги и друзья' },
      { to: '/library',   icon: BookOpen,  label: 'Библиотека' },
      { to: '/analyze',   icon: Zap,       label: 'Добавить материал' },
    ]
  }
];



const mobileNavItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Главная' },
  { to: '/library',   icon: BookOpen,         label: 'Материалы', className: 'tour-step-mobile-library' },
  { to: '/chat',      icon: MessageSquare,    label: 'Чат', className: 'tour-step-mobile-chat' },
  { to: '/analytics?tab=gradebook', icon: GraduationCap, label: 'Оценки', className: 'tour-step-mobile-gradebook' },
  { to: '/profile',   icon: User,             label: 'Профиль' },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const email = user?.email ?? '';
  const name = user?.user_metadata?.full_name || email.split('@')[0] || '?';
  const initial = name ? name[0].toUpperCase() : '?';

  const [xp, setXp] = useState(0);
  const [levelInfo, setLevelInfo] = useState(calcLevel(0));
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [unreadDMs, setUnreadDMs] = useState(0);
  const [showNotifications, setShowNotifications] = useState(false);
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [usedTokens, setUsedTokens] = useState(0);
  const [isTokenModalOpen, setIsTokenModalOpen] = useState(false);
  
  const { theme, setTheme } = useTheme();
  const isDarkActive = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  // Mobile menu state
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // PWA Install
  const { handleInstallClick, showInstall } = useInstallPWA();

  // Close mobile menu on navigation
  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = 'unset';
    };
  }, []);

  const fetchUnreadDMs = () => {
    if (!user?.id) return;
    getUnreadDMsGrouped(user.id).then(counts => {
      const total = Object.values(counts).reduce((a, b) => a + b, 0);
      setUnreadDMs(total);
    });
  };

  useEffect(() => {
    if (!user?.id) return;

    const fetchXP = () => getUserXP(user.id).then(v => { setXp(v); setLevelInfo(calcLevel(v)); });
    fetchXP();
    window.addEventListener('xp_updated', fetchXP);

    const fetchProfile = () => getProfile(user.id).then(p => { if (p) setProfile(p); });
    fetchProfile();
    window.addEventListener('profile_updated', fetchProfile);

    getUnreadCount(user.id).then(setUnreadCount);
    fetchUnreadDMs();

    const handleNotificationRead = () => {
      fetchUnreadDMs();
      getUnreadCount(user.id).then(setUnreadCount);
    };
    window.addEventListener('notification_read', handleNotificationRead);

    const unsub = subscribeToNotifications(user.id, (payload) => {
      getUnreadCount(user.id).then(setUnreadCount);
      fetchUnreadDMs();
      
      const newNotif = payload?.new;
      if (newNotif) {
        // If it's a message and we are already on the messages page, let's not show a duplicate toast
        if (newNotif.type === 'message' && location.pathname.startsWith('/messages')) return;
        
        toast((t) => (
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-indigo-600 flex items-center justify-center text-white text-xs font-bold shrink-0">
              {newNotif.type === 'message' ? '💬' : '🔔'}
            </div>
            <div className="flex-1 min-w-0 text-left">
              <p className="text-xs font-black text-slate-900 dark:text-slate-100">{newNotif.title}</p>
              {newNotif.body && <p className="text-[10px] text-slate-500 dark:text-slate-400 mt-0.5 truncate">{newNotif.body}</p>}
            </div>
            <button 
              onClick={() => {
                toast.dismiss(t.id);
                if (newNotif.type === 'message') {
                  navigate(newNotif.related_id ? `/messages/${newNotif.related_id}` : '/messages');
                } else if (newNotif.type === 'friend_request') {
                  navigate('/profile');
                } else {
                  handleOpenNotifications();
                }
              }}
              className="px-2.5 py-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-[10px] font-bold shrink-0 transition"
            >
              Смотреть
            </button>
          </div>
        ), {
          duration: 4000,
          position: 'top-right',
          style: {
            background: isDarkActive ? '#1e293b' : '#ffffff',
            border: isDarkActive ? '1px solid #334155' : '1px solid #e2e8f0',
            borderRadius: '16px',
            color: isDarkActive ? '#f1f5f9' : '#0f172a',
            boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1)',
            padding: '12px'
          }
        });
      }
    });

    const fetchTokens = () => checkAILimit(user.id, 0).then(res => setUsedTokens(res.count));
    fetchTokens();
    // It's possible to add event listener for 'ai_usage_updated' but for now fetching on mount is fine.

    return () => {
      window.removeEventListener('xp_updated', fetchXP);
      window.removeEventListener('profile_updated', fetchProfile);
      window.removeEventListener('notification_read', handleNotificationRead);
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
        // Сразу обновим локальное состояние, чтобы у всех загруженных уведомлений проставить is_read = true
        setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
      }
    }
  };

  const handleToggleRole = async () => {
    if (!user || !profile) return;
    const newRole = profile.role === 'teacher' ? 'student' : 'teacher';
    const { supabase } = await import('../lib/supabase');
    const { error } = await supabase
      .from('profiles')
      .update({ role: newRole })
      .eq('id', user.id);
    if (!error) {
      setProfile({ ...profile, role: newRole });
      window.dispatchEvent(new Event('profile_updated'));
      if (newRole === 'teacher') navigate('/teacher');
      else navigate('/dashboard');
    }
  };

  const avatarUrl = profile?.avatar_url;
  const isTeacher = profile?.role === 'teacher';
  const currentNavGroups = isTeacher ? teacherNavGroups : navGroups;

  const notificationDropdown = showNotifications && (
    <>
      <div 
        className="fixed inset-0 z-50 cursor-default" 
        onClick={() => setShowNotifications(false)}
      />
      <div className="fixed inset-x-4 top-16 md:bottom-20 md:top-auto md:left-6 md:right-auto md:w-80 bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 z-[70] overflow-hidden flex flex-col max-h-[60vh]">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-slate-50 dark:bg-slate-800/50">
          <h3 className="font-bold text-slate-800 dark:text-slate-100">Уведомления</h3>
          {notifications.some(n => !n.is_read) && (
            <button 
              onClick={async () => {
                if (user) {
                  await markAllRead(user.id);
                  setNotifications(prev => prev.map(n => ({ ...n, is_read: true })));
                  setUnreadCount(0);
                  toast.success('Все уведомления отмечены как прочитанные');
                }
              }}
              className="text-xs text-indigo-600 dark:text-indigo-400 font-medium hover:text-indigo-700 dark:hover:text-indigo-300"
            >
              Отметить все
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-slate-500 dark:text-slate-400 text-sm">Нет новых уведомлений</div>
          ) : (
            notifications.map(n => (
              <div 
                key={n.id} 
                onClick={() => {
                  if (n.type === 'message') {
                    navigate(n.related_id ? `/messages/${n.related_id}` : '/messages');
                  } else if (n.type === 'friend_request') {
                    navigate('/profile');
                  }
                  setShowNotifications(false);
                }}
                className="p-3 rounded-xl hover:bg-slate-50 dark:hover:bg-slate-800 transition relative group cursor-pointer pr-10"
              >
                <button
                  onClick={async (e) => {
                    e.stopPropagation();
                    const ok = await deleteNotification(n.id);
                    if (ok) {
                      setNotifications(prev => prev.filter(item => item.id !== n.id));
                      toast.success('Уведомление удалено');
                    } else {
                      toast.error('Не удалось удалить уведомление');
                    }
                  }}
                  className="absolute right-2 top-2.5 p-1 text-slate-400 hover:text-rose-500 rounded-lg hover:bg-rose-50 dark:hover:bg-rose-950/30 transition opacity-100 md:opacity-0 md:group-hover:opacity-100 z-10"
                  title="Удалить уведомление"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
                <p className="text-sm text-slate-800 dark:text-slate-100 font-medium mb-1 line-clamp-2 break-words pr-2">{n.title}</p>
                <p className="text-xs text-slate-600 dark:text-slate-300 line-clamp-2 break-words">{n.body}</p>
                <p className="text-[10px] text-slate-400 dark:text-slate-500 mt-2">
                  {new Date(n.created_at).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' })}
                </p>
              </div>
            ))
          )}
        </div>
      </div>
    </>
  );

  return (
    <div className="fixed inset-0 flex bg-slate-50 dark:bg-slate-950 overflow-hidden">
      <OnboardingManager />
      
      {/* Token Modal */}
      <TokenInfoModal 
        isOpen={isTokenModalOpen} 
        onClose={() => setIsTokenModalOpen(false)} 
        usedTokens={usedTokens} 
        isPro={profile?.is_pro}
      />

      <ForgeyAssistant />
      {/* ═══ MOBILE OVERLAY ══════════════════════════════════════════════════ */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden" 
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* ═══ SIDEBAR ════════════════════════════════════════════════════════════ */}
      <aside className={`fixed inset-y-0 left-0 z-50 w-72 md:w-64 bg-slate-900/95 dark:bg-slate-950/95 backdrop-blur-xl flex flex-col shrink-0 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 ${isMobileMenuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}>
        {/* Logo */}
        <div className="p-4 md:p-5 flex items-center justify-between w-full border-b border-slate-800">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-3 hover:opacity-80 transition text-left">
            <div className="w-7 h-7 rounded bg-indigo-500 flex items-center justify-center shadow-sm">
              <GraduationCap className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold tracking-tight text-white text-lg">StudyForge</span>
          </button>
          
          <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden p-2 -mr-2 text-slate-400 hover:text-white transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* XP / Level блок */}
        {profile === null ? (
          <div className="mx-4 mt-4 mb-4 p-3 bg-slate-800/50 rounded-xl border border-slate-700/50 animate-pulse h-[116px] flex flex-col justify-between">
            <div>
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="h-3 bg-slate-700/50 rounded w-16 mb-1.5"></div>
                  <div className="h-4 bg-slate-700/50 rounded w-24"></div>
                </div>
                <div className="w-7 h-7 bg-slate-700/50 rounded-md"></div>
              </div>
              <div className="h-1.5 bg-slate-700/50 rounded-full w-full mb-4"></div>
            </div>
            <div className="h-8 bg-slate-700/50 rounded-xl w-full mt-auto"></div>
          </div>
        ) : (
          <div className="mx-4 mt-4 mb-4 p-3 bg-slate-800/50 rounded-xl border border-slate-700/50 tour-step-xp tour-step-desktop-xp">
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
            <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50 mb-1.5">
              <div
                className="h-full bg-indigo-500 rounded-full transition-all duration-700"
                style={{ width: `${levelInfo.progress}%` }}
              />
            </div>
            <div className="flex justify-between mb-4">
              <span className="text-[10px] font-medium text-slate-500">{xp} XP</span>
              <span className="text-[10px] font-medium text-slate-500">{levelInfo.currentXP}/{levelInfo.nextXP}</span>
            </div>

            {/* AI Tokens Bar */}
            <div 
              onClick={() => setIsTokenModalOpen(true)}
              className="group cursor-pointer p-1.5 -mx-1.5 rounded-xl hover:bg-slate-700/30 transition"
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <Zap className={`w-3.5 h-3.5 ${profile?.is_pro ? 'text-amber-400' : 'text-slate-400 group-hover:text-amber-400 transition'}`} />
                  <p className="text-[10px] font-bold text-slate-400 group-hover:text-slate-300 transition uppercase tracking-widest">Энергия ИИ</p>
                </div>
                {profile?.is_pro ? (
                  <span className="text-[10px] font-bold text-amber-400 uppercase tracking-widest border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 rounded shadow-[0_0_8px_rgba(251,191,36,0.3)]">PRO</span>
                ) : null}
              </div>
              {!profile?.is_pro && (
                <>
                  <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
                    <div
                      className={`h-full rounded-full transition-all duration-700 ${usedTokens >= FREE_DAILY_LIMIT ? 'bg-rose-500' : 'bg-amber-400'}`}
                      style={{ width: `${Math.max(0, ((FREE_DAILY_LIMIT - usedTokens) / FREE_DAILY_LIMIT) * 100)}%` }}
                    />
                  </div>
                  <div className="flex justify-between mt-1.5">
                    <span className="text-[10px] font-medium text-slate-500">Осталось</span>
                    <span className="text-[10px] font-medium text-slate-500">{FREE_DAILY_LIMIT - usedTokens} / {FREE_DAILY_LIMIT}</span>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {/* Navigation */}
        {showInstall && (
          <div className="px-3 mb-4">
            <button
              onClick={handleInstallClick}
              className="w-full flex items-center gap-2 justify-center px-4 py-2 bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/20 rounded-xl text-[13px] font-bold transition-colors"
            >
              <Download className="w-4 h-4" />
              Установить приложение
            </button>
          </div>
        )}
        <nav className="flex-1 px-3 pb-6 space-y-5 overflow-y-auto custom-scrollbar">
          {currentNavGroups.map((group: any, idx: number) => (
            <div key={idx}>
              <h3 className="px-3 text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                {group.title}
              </h3>
              <div className="space-y-0.5">
                {group.items.map((item: any) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    className={({ isActive }) =>
                      `flex items-center justify-between px-3 py-2 text-[13px] font-medium rounded-lg transition-colors ${(item as any).className || ''} ` +
                      (isActive
                        ? 'bg-slate-800 text-white shadow-sm ring-1 ring-white/5'
                        : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200')
                    }
                  >
                    <div className="flex items-center gap-3">
                      <item.icon className="w-4 h-4 opacity-80" />
                      {item.label}
                    </div>
                    {item.to === '/messages' && unreadDMs > 0 && (
                      <span className="bg-rose-500 text-white text-[10px] font-black px-2 py-0.5 rounded-full animate-pulse">
                        {unreadDMs}
                      </span>
                    )}
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

        {/* Разделитель + быстрые иконки: Сообщество и Профиль */}
        <div className="px-4 pb-3 border-t border-slate-800 pt-3 flex items-center gap-2">
          <NavLink
            to="/network"
            title="Study Network"
            className={({ isActive }) =>
              `flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition ${
                isActive ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-300'
              }`
            }
          >
            <Globe className="w-4 h-4" />
            <span>Сообщество</span>
          </NavLink>
          <NavLink
            to="/profile"
            title="Мой профиль"
            className={({ isActive }) =>
              `flex-1 flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium transition ${
                isActive ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-800/60 hover:text-slate-300'
              }`
            }
          >
            <User className="w-4 h-4" />
            <span>Профиль</span>
          </NavLink>
        </div>

        {/* User section */}
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/profile')} className="shrink-0 relative">
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className={`w-8 h-8 rounded-full object-cover ring-2 ${profile?.is_pro ? 'ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]' : 'ring-indigo-500/50'}`} />
              ) : (
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-bold ring-2 ${profile?.is_pro ? 'bg-gradient-to-br from-amber-400 to-amber-600 ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]' : 'bg-indigo-600 ring-indigo-500/50'}`}>
                  {initial}
                </div>
              )}
            </button>
            <div className="flex-1 min-w-0">
              <p className="text-slate-300 text-xs font-medium truncate flex items-center gap-1">
                {name} 
              </p>
              <p className="text-slate-500 text-[10px] truncate">{email}</p>
            </div>
            
            <div className="relative hidden md:flex items-center gap-1">
              <button onClick={() => setTheme(isDarkActive ? 'light' : 'dark')} className="text-slate-500 hover:text-indigo-400 transition relative p-1" title="Переключить тему">
                {isDarkActive ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
              </button>
              
              <button onClick={handleOpenNotifications} className="text-slate-500 hover:text-slate-200 transition relative p-1">
                <Bell className="w-4 h-4" />
                {unreadCount > 0 && (
                  <span className="absolute -top-0.5 -right-0.5 w-3.5 h-3.5 bg-rose-500 text-white text-[8px] font-black rounded-full flex items-center justify-center">
                    {unreadCount > 9 ? '9+' : unreadCount}
                  </span>
                )}
              </button>
            </div>

            <button onClick={signOut} className="text-slate-500 hover:text-rose-400 transition p-1">
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* ═══ MAIN CONTENT ══════════════════════════════════════════════════════ */}
      <div className="flex-1 flex flex-col min-w-0 h-full relative">
        {/* ═══ MOBILE HEADER ════════════════════════════════════════════════ */}
        <header className="md:hidden flex items-center justify-between px-4 py-3 bg-white/80 dark:bg-slate-900/80 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shrink-0 z-30">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 hover:opacity-80 transition text-left">
            <div className="w-6 h-6 rounded bg-indigo-500 flex items-center justify-center shadow-sm">
              <GraduationCap className="w-3.5 h-3.5 text-white" />
            </div>
            <span className="font-bold tracking-tight text-slate-800 dark:text-slate-100 text-base">StudyForge</span>
          </button>
          <div className="flex items-center gap-1">
            <button 
              onClick={() => setIsTokenModalOpen(true)}
              className="mr-1 flex items-center hover:scale-105 transition"
            >
              {profile?.is_pro ? (
                <div className="flex items-center gap-1 text-amber-500 bg-amber-50 dark:bg-amber-500/10 px-2 py-1 rounded-lg border border-amber-500/20 shadow-[0_0_8px_rgba(251,191,36,0.2)]">
                  <Zap className="w-4 h-4" />
                  <span className="text-[10px] font-black tracking-wider uppercase">PRO</span>
                </div>
              ) : (
                <div className="flex items-center gap-1 text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 hover:border-amber-300 dark:hover:border-amber-700 transition">
                  <Zap className={`w-4 h-4 ${usedTokens >= FREE_DAILY_LIMIT ? 'text-rose-500' : 'text-amber-500'}`} />
                  <span className={`text-[11px] font-bold ${usedTokens >= FREE_DAILY_LIMIT ? 'text-rose-500' : ''}`}>{FREE_DAILY_LIMIT - usedTokens}</span>
                </div>
              )}
            </button>
            <button onClick={() => setTheme(isDarkActive ? 'light' : 'dark')} className="p-2 text-slate-500 hover:text-indigo-600 transition" title="Переключить тему">
              {isDarkActive ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button onClick={handleOpenNotifications} className="p-2 text-slate-500 hover:text-indigo-600 transition relative">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 -mr-2 text-slate-500 hover:text-indigo-600 transition relative">
              <Menu className="w-6 h-6" />
              {unreadDMs > 0 && (
                <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border border-white dark:border-slate-900 animate-pulse" />
              )}
            </button>
          </div>
        </header>

        <main className={`flex-1 overflow-x-hidden ${location.pathname.startsWith('/messages') ? 'overflow-y-hidden pb-[56px] md:pb-0' : 'overflow-y-auto pb-[70px] md:pb-0'} custom-scrollbar relative scroll-smooth`}>
          <ErrorBoundary>
            <Outlet />
          </ErrorBoundary>
        </main>

        {/* ═══ MOBILE BOTTOM NAV ════════════════════════════════════════════════ */}
        <nav className="fixed bottom-0 left-0 right-0 z-30 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 flex md:hidden pb-safe">
          {mobileNavItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] gap-1 text-[10px] font-bold transition ${item.className || ''} ` +
                (isActive ? 'text-indigo-600' : 'text-slate-400')
              }
            >
              {({ isActive }) => (
                <div className="relative flex flex-col items-center justify-center">
                  <item.icon className={`w-5 h-5 mb-0.5 ${isActive ? 'text-indigo-600' : 'text-slate-400'}`} />
                  {item.label}
                  {item.to === '/chat' && unreadDMs > 0 && (
                    <span className="absolute -top-1 -right-2 min-w-[16px] h-4 bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center px-1 border border-white dark:border-slate-900 animate-pulse">
                      {unreadDMs}
                    </span>
                  )}
                </div>
              )}
            </NavLink>
          ))}
        </nav>
      </div>

      {/* Global Notification Dropdown */}
      {notificationDropdown}
    </div>
  );
}
