import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { GraduationCap, LayoutDashboard, Zap, BookOpen, Brain, Calendar, MessageSquare, LogOut } from 'lucide-react';
import { useAuth } from '../hooks/useAuth';

const navItems = [
  { to: '/dashboard', icon: LayoutDashboard, label: 'Дашборд' },
  { to: '/analyze', icon: Zap, label: 'Анализ материалов' },
  { to: '/library', icon: BookOpen, label: 'Библиотека' },
  { to: '/review', icon: Brain, label: 'Повторение' },
  { to: '/planner', icon: Calendar, label: 'Планировщик' },
  { to: '/chat', icon: MessageSquare, label: 'AI-чат' },
];

export default function Layout() {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const email = user?.email ?? '';
  const initial = email ? email[0].toUpperCase() : '?';

  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 flex flex-col shrink-0">
        {/* Logo */}
        <button
          onClick={() => navigate('/dashboard')}
          className="p-6 flex items-center gap-3 hover:opacity-80 transition w-full text-left"
        >
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center">
            <GraduationCap className="w-4 h-4 text-white" />
          </div>
          <span className="font-bold text-white text-lg">StudyForge</span>
        </button>

        {/* Navigation */}
        <nav className="flex-1 px-3 space-y-1">
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
              <item.icon className="w-4 h-4" />
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* User section */}
        <div className="p-4 border-t border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-indigo-600 rounded-full flex items-center justify-center text-white text-sm font-bold">
              {initial}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-slate-400 text-xs truncate">{email}</p>
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

      {/* Main content */}
      <main className="flex-1 overflow-auto">
        <Outlet />
      </main>
    </div>
  );
}
