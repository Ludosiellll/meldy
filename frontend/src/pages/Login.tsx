import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { motion } from 'framer-motion';
import { GraduationCap, Mail, Lock, ArrowRight, CheckCircle2, Eye, EyeOff } from 'lucide-react';
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
    <div className="min-h-screen bg-[#f8fafc] dark:bg-slate-950 flex text-slate-900 dark:text-slate-100">
      {/* Left Column: Form */}
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-24 xl:px-32 relative">
        <button onClick={() => navigate('/')} className="absolute top-8 left-6 sm:left-12 flex items-center gap-2 group">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-md">
            <GraduationCap className="w-4 h-4 text-white" />
          </div>
          <span className="font-extrabold text-slate-900 dark:text-slate-100 text-lg tracking-tight group-hover:text-indigo-600 transition-colors">StudyForge</span>
        </button>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-sm mx-auto"
        >
          <div className="mb-8">
            <h1 className="text-3xl font-black text-slate-900 dark:text-slate-100 tracking-tight mb-2">С возвращением!</h1>
            <p className="text-slate-500 dark:text-slate-400 font-medium">Войдите, чтобы продолжить изучение тем и прокачку hard-скиллов в интерактивной песочнице.</p>
          </div>

          {error && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-xl text-sm font-medium mb-6">
              {error}
            </motion.div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value);
                    setEmailError(validateEmail(e.target.value));
                  }}
                  className={`block w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-900 border ${emailError ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500' : 'border-slate-200 dark:border-slate-800 focus:ring-indigo-500 focus:border-indigo-500'} rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 outline-none transition-all shadow-sm`}
                  placeholder="you@example.com"
                  required
                />
              </div>
              {emailError && <p className="text-rose-500 text-xs font-bold mt-1.5">{emailError}</p>}
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5">Пароль</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="block w-full pl-11 pr-11 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all shadow-sm"
                  placeholder="••••••••"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 dark:text-slate-500 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              <div className="flex justify-end mt-2">
                <button 
                  type="button" 
                  onClick={() => navigate('/forgot-password')} 
                  className="text-xs font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 dark:hover:text-indigo-300 transition-colors"
                >
                  Забыли пароль?
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-3.5 px-4 border border-transparent rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all shadow-lg shadow-indigo-200 hover:shadow-indigo-300 disabled:opacity-70"
            >
              {loading ? (
                <span className="flex items-center gap-2">Входим... <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /></span>
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
              <span className="bg-[#f8fafc] dark:bg-slate-950 px-3 text-slate-400 dark:text-slate-500 font-medium">или войдите через</span>
            </div>
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            className="w-full flex items-center justify-center gap-3 px-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl text-sm font-bold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-300 dark:hover:border-slate-600 transition-all shadow-sm hover:shadow-md"
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
            <button onClick={() => navigate('/register')} className="font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 hover:underline transition-all">
              Создать профиль
            </button>
          </p>
        </motion.div>
      </div>

      {/* Right Column: Branded Visual (Hidden on mobile) */}
      <div className="hidden lg:flex flex-1 relative bg-indigo-600 overflow-hidden items-center justify-center p-12">
        {/* Animated background elements */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-indigo-800" />
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-indigo-400/20 rounded-full blur-3xl" />
        
        {/* Geometric pattern overlay */}
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

        {/* Floating Card UI */}
        <motion.div 
          initial={{ opacity: 0, scale: 0.9, rotateY: -15 }}
          animate={{ opacity: 1, scale: 1, rotateY: 0 }}
          transition={{ duration: 0.8, type: "spring" }}
          className="relative w-full max-w-lg bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 shadow-2xl"
          style={{ transformStyle: "preserve-3d", perspective: 1000 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/20 rounded-full text-white text-xs font-bold mb-6">
            <CheckCircle2 className="w-4 h-4" /> AI-Ассистент
          </div>
          
          <h2 className="text-3xl font-black text-white leading-tight mb-4 tracking-tight">
            Готовьтесь к экзаменам <br/>
            и прокачивайте <span className="whitespace-nowrap">hard-скиллы</span>
          </h2>
          
          <p className="text-indigo-100 leading-relaxed text-sm mb-8">
            StudyForge преобразует лекции в умные конспекты, генерирует масштабные силлабусы под рынок вакансий и проводит практические код-экзамены с ИИ.
          </p>

          <div className="space-y-3">
            {[
              { label: "Готовые ИИ-силлабусы", value: "до 35 тем" },
              { label: "Практика в SQL песочнице", value: "100% интерактив" },
              { label: "Рост навыков на карте", value: "в реальном времени" }
            ].map((stat, i) => (
              <div key={i} className="flex items-center justify-between bg-white/5 border border-white/10 rounded-xl p-3">
                <span className="text-indigo-100 text-sm font-medium">{stat.label}</span>
                <span className="text-white font-bold">{stat.value}</span>
              </div>
            ))}
          </div>
        </motion.div>
      </div>
    </div>
  );
}
