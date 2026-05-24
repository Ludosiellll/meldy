import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useState, useEffect } from 'react';
import {
  GraduationCap, LayoutDashboard, Zap, BookOpen, Brain,
  Calendar, MessageSquare, LogOut, Award, Gamepad2,
  BookMarked, Heart, BarChart2, Clock, ChevronRight,
} from 'lucide-react';
import { useAuth } from '../hooks/useAuth';
import { getUserXP, calcLevel } from '../api/quests';

const navItems = [
  { to: '/dashboard',   icon: LayoutDashboard, label: 'Дашборд' },
  { to: '/analyze',     icon: Zap,             label: 'Анализ материалов' },
  { to: '/library',     icon: BookOpen,         label: 'Библиотека' },
  { to: '/review',      icon: Brain,            label: 'Повторение' },
  { to: '/play',        icon: Gamepad2,         label: 'Микро-миссии' },
  { to: '/exam',        icon: Award,            label: 'AI-Экзаменатор' },
  { to: '/quick-prep',  icon: Clock,            label: 'Повтор за 5 минут' },
  { to: '/mistakes',    icon: BookMarked,       label: 'Дневник ошибок' },
  { to: '/mood',        icon: Heart,            label: 'Трекер состояния' },
  { to: '/analytics',   icon: BarChart2,        label: 'Аналитика' },
  { to: '/planner',     icon: Calendar,         label: 'Планировщик' },
  { to: '/chat',        icon: MessageSquare,    label: 'AI-чат' },
];

// Мобильный bottom nav — только главные разделы
const mobileNavItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Главная' },
  { to: '/review',    icon: Brain,            label: 'Карточки' },
  { to: '/exam',      icon: Award,            label: 'Экзамен' },
  { to: '/analytics', icon: BarChart2,        label: 'Прогресс' },
  { to: '/chat',      icon: MessageSquare,    label: 'Чат' },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const email = user?.email ?? '';
  const name = user?.user_metadata?.full_name || email.split('@')[0] || '?';
  const initial = name ? name[0].toUpperCase() : '?';

  const [xp, setXp] = useState(0);
  const [levelInfo, setLevelInfo] = useState(calcLevel(0));

  useEffect(() => {
    if (!user?.id) return;
    getUserXP(user.id).then(v => {
      setXp(v);
      setLevelInfo(calcLevel(v));
    });
  }, [user?.id]);

  return (
    <div className="flex h-screen bg-slate-50">
      {/* ═══ SIDEBAR ════════════════════════════════════════════════════════════ */}
      <aside className="w-64 bg-slate-900 flex flex-col shrink-0 hidden md:flex">
        {/* Logo */}
        <button
          onClick={() => navigate('/dashboard')}
          className="p-5 flex items-center gap-3 hover:opacity-80 transition w-full text-left border-b border-slate-800"
        >
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <GraduationCap className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white text-lg">StudyForge</span>
        </button>

        {/* XP / Level блок (сверху) */}
        <div className="mx-3 mt-4 p-3 bg-slate-800 rounded-xl border border-slate-700">
          <div className="flex items-center justify-between mb-2">
            <div>
              <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-widest">Уровень {levelInfo.level}</p>
              <p className="text-xs font-bold text-white">{levelInfo.name}</p>
            </div>
            <button
              onClick={() => navigate('/analytics')}
              className="text-slate-500 hover:text-slate-300 transition"
              title="Аналитика"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
          <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-indigo-500 rounded-full transition-all duration-700"
              style={{ width: `${levelInfo.progress}%` }}
            />
          </div>
          <div className="flex justify-between mt-1">
            <span className="text-[10px] text-slate-500">{xp} XP</span>
            <span className="text-[10px] text-slate-500">{levelInfo.currentXP}/{levelInfo.nextXP}</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-3 space-y-0.5 overflow-y-auto">
          {navItems.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                'flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-xl transition ' +
                (isActive
                  ? 'bg-indigo-600 text-white'
                  : 'text-slate-400 hover:bg-slate-800 hover:text-white')
              }
            >
              <item.icon className="w-4 h-4 shrink-0" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white text-sm font-bold shrink-0">
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-slate-300 text-xs font-medium truncate">{name}</p>
              <p className="text-slate-500 text-[10px] truncate">{email}</p>
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
