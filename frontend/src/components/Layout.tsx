import { NavLink, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  GraduationCap, LayoutDashboard, Zap, BookOpen, Brain,
  MessageSquare, LogOut, BarChart2, Network,
  User, Bell, Menu, X
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getProfile, UserProfile } from '../api/social';
import { getUnreadCount, subscribeToNotifications, subscribeToMessages, getNotifications, markAllRead, Notification, getUnreadDMsGrouped, deleteNotification } from '../api/chat';
import toast from 'react-hot-toast';
import { ErrorBoundary } from './ErrorBoundary';
import OnboardingManager from './OnboardingManager';
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
      { to: '/dashboard',     icon: LayoutDashboard, label: 'Сегодня',              className: '' },
      { to: '/analyze',       icon: Zap,             label: 'Добавить материал',    className: 'tour-step-desktop-upload' },
      { to: '/library',       icon: BookOpen,        label: 'Библиотека',           className: 'tour-step-desktop-library' },
    ]
  },
  {
    title: 'Практика',
    items: [
      { to: '/review',        icon: Brain,           label: 'Повторение',           className: 'tour-step-desktop-review' },
    ]
  },
  {
    title: 'Прогресс',
    items: [
      { to: '/analytics?tab=platform',  icon: BarChart2,       label: 'Прогресс',             className: '' },
      { to: '/knowledge-map', icon: Network, label: 'Карта знаний', className: '' },
    ]
  },
];

const teacherNavGroup = {
  title: 'Управление',
  items: [
    { to: '/teacher',   icon: Network,       label: 'Мои группы' },
    { to: '/messages',  icon: MessageSquare, label: 'Диалоги и друзья' },
  ]
};



const mobileNavItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Сегодня' },
  { to: '/analyze',   icon: Zap,             label: 'Добавить' },
  { to: '/library',   icon: BookOpen,         label: 'Материалы', className: 'tour-step-mobile-library' },
  { to: '/review',    icon: Brain,           label: 'Практика', className: 'tour-step-mobile-review' },
  { to: '/profile',   icon: User,             label: 'Профиль' },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const email = user?.email ?? '';
  const name = user?.user_metadata?.full_name || email.split('@')[0] || '?';
  const initial = name ? name[0].toUpperCase() : '?';

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
            background: 'var(--toast-bg)',
            border: '1px solid var(--toast-border)',
            borderRadius: '16px',
            color: 'var(--toast-color)',
            boxShadow: 'var(--toast-shadow)',
            padding: '12px'
          }
        });
      }
    });

    const fetchTokens = () => checkAILimit(user.id, 0).then(res => setUsedTokens(res.count));
    fetchTokens();
    // It's possible to add event listener for 'ai_usage_updated' but for now fetching on mount is fine.

    return () => {
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

  const avatarUrl = profile?.avatar_url;
  const isTeacher = profile?.role === 'teacher';
  const currentNavGroups = isTeacher ? [...navGroups, teacherNavGroup] : navGroups;

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
    <div className="app-shell fixed inset-0 flex overflow-hidden">
      <OnboardingManager />
      
      {/* Token Modal */}
      <TokenInfoModal 
        isOpen={isTokenModalOpen} 
        onClose={() => setIsTokenModalOpen(false)} 
        usedTokens={usedTokens} 
        isPro={profile?.is_pro}
      />

      {/* ═══ MOBILE OVERLAY ══════════════════════════════════════════════════ */}
      {isMobileMenuOpen && (
        <div 
          className="fixed inset-0 bg-slate-900/60 backdrop-blur-sm z-40 md:hidden" 
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}

      {/* ═══ SIDEBAR ════════════════════════════════════════════════════════════ */}
      <aside className={`app-sidebar fixed inset-y-0 left-0 z-50 w-72 md:w-64 flex flex-col shrink-0 transform transition-transform duration-300 ease-in-out md:relative md:translate-x-0 border-r ${isMobileMenuOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'}`}>
        {/* Logo */}
        <div className="p-4 md:p-5 flex items-center justify-between w-full border-b">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-3 hover:opacity-80 transition text-left">
            <div className="app-logo-mark w-7 h-7 rounded-md flex items-center justify-center">
              <GraduationCap className="w-4 h-4" />
            </div>
            <span className="font-semibold tracking-tight text-lg">Meldy</span>
          </button>
          
              <button onClick={() => setIsMobileMenuOpen(false)} className="md:hidden p-2 -mr-2 text-slate-400 hover:text-slate-900 transition">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Navigation */}
        {showInstall && (
          <div className="px-3 mb-4">
            <button
              onClick={handleInstallClick}
              className="w-full flex items-center gap-2 justify-center px-4 py-2 bg-cyan-300/10 hover:bg-cyan-300/15 text-cyan-200 border border-cyan-200/20 rounded-lg text-[13px] font-semibold transition-colors"
            >
              <Download className="w-4 h-4" />
              Установить приложение
            </button>
          </div>
        )}
        <nav className="flex-1 px-3 pb-6 space-y-5 overflow-y-auto custom-scrollbar">
          {currentNavGroups.map((group: any, idx: number) => (
            <div key={idx}>
              <h3 className="app-nav-group-title px-3 text-[11px] font-semibold uppercase tracking-wider mb-2 flex items-center gap-1.5">
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
                        ? 'app-nav-active'
                        : 'app-nav-idle')
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

        {/* User section */}
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate('/profile')} className="shrink-0 relative">
              {avatarUrl ? (
                <img src={avatarUrl} alt="avatar" className={`w-8 h-8 rounded-full object-cover ring-2 ${profile?.is_pro ? 'ring-amber-400 shadow-[0_0_12px_rgba(251,191,36,0.6)]' : 'ring-indigo-500/50'}`} />
              ) : (
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-semibold ring-1 ${profile?.is_pro ? 'bg-amber-400 text-slate-950 ring-amber-300' : 'bg-cyan-300 text-slate-950 ring-cyan-200/50'}`}>
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
              <button onClick={() => setTheme(isDarkActive ? 'light' : 'dark')} className="text-slate-500 hover:text-[var(--sf-accent)] transition-colors relative p-1" title="Переключить тему">
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
        <header className="app-mobile-header md:hidden flex items-center justify-between px-4 py-3 backdrop-blur-md border-b shrink-0 z-30">
          <button onClick={() => navigate('/dashboard')} className="flex items-center gap-2 hover:opacity-80 transition text-left">
            <div className="app-logo-mark w-6 h-6 rounded flex items-center justify-center">
              <GraduationCap className="w-3.5 h-3.5" />
            </div>
            <span className="font-bold tracking-tight text-slate-800 dark:text-slate-100 text-base">Meldy</span>
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
            <button onClick={() => setTheme(isDarkActive ? 'light' : 'dark')} className="p-2 text-slate-500 hover:text-[var(--sf-accent)] transition" title="Переключить тему">
              {isDarkActive ? <Sun className="w-5 h-5" /> : <Moon className="w-5 h-5" />}
            </button>
            <button onClick={handleOpenNotifications} className="p-2 text-slate-500 hover:text-[var(--sf-accent)] transition relative">
              <Bell className="w-5 h-5" />
              {unreadCount > 0 && (
                <span className="absolute top-1 right-1 w-3.5 h-3.5 bg-rose-500 text-white text-[9px] font-black rounded-full flex items-center justify-center">
                  {unreadCount > 9 ? '9+' : unreadCount}
                </span>
              )}
            </button>
            <button onClick={() => setIsMobileMenuOpen(true)} className="p-2 -mr-2 text-slate-500 hover:text-[var(--sf-accent)] transition relative">
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
        <nav className="app-mobile-nav fixed bottom-0 left-0 right-0 z-30 backdrop-blur-md border-t flex md:hidden pb-safe">
          {mobileNavItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                `flex-1 flex flex-col items-center justify-center py-2 min-h-[56px] gap-1 text-[10px] font-bold transition ${item.className || ''} ` +
                (isActive ? 'app-nav-active' : 'app-nav-idle')
              }
            >
              {({ isActive }) => (
                <div className="relative flex flex-col items-center justify-center">
                  <item.icon className={`w-5 h-5 mb-0.5 ${isActive ? 'text-[var(--sf-accent)]' : 'text-slate-400'}`} />
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
