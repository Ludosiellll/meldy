import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { motion } from 'framer-motion';
import { GraduationCap, Mail, Lock, ArrowRight, Eye, EyeOff } from 'lucide-react';
import { validateEmail } from '../utils/validators';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  
  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user?.id, navigate]);

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/auth/callback',
      },
    });
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    const ee = validateEmail(email);
    if (ee) {
      setEmailError(ee);
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      if (error.message.includes('Invalid login credentials')) {
        setError('Неверный email или пароль');
      } else {
        setError('Произошла ошибка при входе. Проверьте данные.');
      }
    } else navigate('/dashboard');
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#f6f8fa] dark:bg-[#07111f] flex text-slate-900 dark:text-slate-100">
      {/* Left Column: Form */}
      <div className="flex-1 flex flex-col justify-start sm:justify-center px-6 sm:px-12 lg:px-24 xl:px-32 relative pt-28 pb-12 sm:py-12">
        <button onClick={() => navigate('/')} className="absolute top-8 left-6 sm:left-12 flex items-center gap-2 group">
          <div className="w-8 h-8 bg-cyan-300 rounded-md flex items-center justify-center">
            <GraduationCap className="w-4 h-4 text-slate-950" />
          </div>
          <span className="font-semibold text-slate-900 dark:text-slate-100 text-lg tracking-tight group-hover:text-cyan-600 transition-colors">StudyForge</span>
        </button>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-sm mx-auto"
        >
          <div className="mb-8">
            <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight mb-2">Продолжить подготовку</h1>
            <p className="text-slate-500 dark:text-slate-400">Ваши материалы, карточки и результаты сохранены в одном месте.</p>
          </div>

          {error && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-xl text-sm font-medium mb-6">
              {error}
            </motion.div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label htmlFor="login-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="login-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value);
                    setEmailError(validateEmail(e.target.value));
                  }}
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? 'login-email-error' : undefined}
                  className={`block w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-900 border ${emailError ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500' : 'border-slate-200 dark:border-slate-700 focus:ring-cyan-400 focus:border-cyan-400'} rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:ring-2 outline-none transition-colors`}
                  placeholder="you@example.com"
                  required
                />
              </div>
              {emailError && <p id="login-email-error" role="alert" className="text-rose-500 text-xs font-medium mt-1.5">{emailError}</p>}
            </div>

            <div>
              <label htmlFor="login-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Пароль</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="login-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="block w-full pl-11 pr-11 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 outline-none transition-colors"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 px-3.5 flex items-center text-slate-400 dark:text-slate-500 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors"
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              <div className="flex justify-end mt-2">
                <button 
                  type="button" 
                  onClick={() => navigate('/forgot-password')} 
                  className="text-xs font-medium text-cyan-700 dark:text-cyan-300 hover:text-cyan-600 transition-colors"
                >
                  Забыли пароль?
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-3.5 px-4 border border-transparent rounded-lg text-sm font-semibold text-slate-950 bg-cyan-300 hover:bg-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-400 transition-colors disabled:opacity-70"
            >
              {loading ? (
                <span className="flex items-center gap-2">Входим… <div className="w-4 h-4 border-2 border-slate-950/20 border-t-slate-950 rounded-full animate-spin" /></span>
              ) : (
                <span className="flex items-center gap-2">Войти <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></span>
              )}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-800" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="bg-[#f6f8fa] dark:bg-[#07111f] px-3 text-slate-400 dark:text-slate-500">или</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-sm font-medium text-slate-700 dark:text-slate-200 hover:border-cyan-300 dark:hover:border-cyan-700 transition-colors"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M17.64 9.20455C17.64 8.56636 17.5827 7.95273 17.4764 7.36364H9V10.845H13.8436C13.635 11.97 13.0009 12.9232 12.0477 13.5614V15.8195H14.9564C16.6582 14.2527 17.64 11.9455 17.64 9.20455Z" fill="#4285F4"/>
              <path d="M9 18C11.43 18 13.4673 17.1941 14.9564 15.8195L12.0477 13.5614C11.2418 14.1014 10.2109 14.4205 9 14.4205C6.65591 14.4205 4.67182 12.8373 3.96409 10.71H0.957275V13.0418C2.43818 15.9832 5.48182 18 9 18Z" fill="#34A853"/>
              <path d="M3.96409 10.71C3.78409 10.17 3.68182 9.59318 3.68182 9C3.68182 8.40682 3.78409 7.83 3.96409 7.29V4.95818H0.957275C0.347727 6.17318 0 7.54773 0 9C0 10.4523 0.347727 11.8268 0.957275 13.0418L3.96409 10.71Z" fill="#FBBC05"/>
              <path d="M9 3.57955C10.3214 3.57955 11.5077 4.03364 12.4405 4.92545L15.0218 2.34409C13.4632 0.891818 11.4259 0 9 0C5.48182 0 2.43818 2.01682 0.957275 4.95818L3.96409 7.29C4.67182 5.16273 6.65591 3.57955 9 3.57955Z" fill="#EA4335"/>
            </svg>
            Войти через Google
          </button>

          <p className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400 font-medium">
            Нет аккаунта?{' '}
            <button onClick={() => navigate('/register')} className="font-semibold text-cyan-700 dark:text-cyan-300 hover:text-cyan-600 hover:underline transition-colors">
              Зарегистрироваться
            </button>
          </p>
        </motion.div>
      </div>

      {/* Right Column: Branded Visual (Hidden on mobile) */}
      <div className="hidden lg:flex flex-1 relative bg-[#07111f] overflow-hidden items-center justify-center p-12 border-l border-white/10">
        <div className="absolute inset-0 opacity-30" style={{ backgroundImage: 'linear-gradient(rgba(148,163,184,.08) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,.08) 1px, transparent 1px)', backgroundSize: '44px 44px' }} />
        <motion.div 
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="relative w-full max-w-lg"
        >
          <p className="text-xs font-medium tracking-[0.16em] uppercase text-cyan-300 mb-5">Как работает StudyForge</p>
          <h2 className="text-4xl font-semibold text-white leading-[1.08] tracking-tight mb-8">От источника до уверенного ответа.</h2>
          <div className="border-y border-white/10 divide-y divide-white/10">
            {[
              ['01', 'Загрузите материал', 'PDF, DOCX, текст, изображение или запись лекции.'],
              ['02', 'Разберите главное', 'Получите конспект со ссылками на исходные фрагменты.'],
              ['03', 'Проверьте себя', 'Закрепите тему карточками и коротким тестом.'],
            ].map(([number, title, description]) => (
              <div key={number} className="grid grid-cols-[44px_1fr] gap-4 py-5">
                <span className="text-xs font-medium text-cyan-300 tabular-nums">{number}</span>
                <div>
                  <h3 className="text-base font-semibold text-white mb-1">{title}</h3>
                  <p className="text-sm leading-relaxed text-slate-400">{description}</p>
                </div>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
