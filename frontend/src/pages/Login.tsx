import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { motion } from 'framer-motion';
import { GraduationCap, Mail, Lock, ArrowRight, CheckCircle2 } from 'lucide-react';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  
  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user, navigate]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
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
    <div className="min-h-screen bg-[#f8fafc] flex">
      {/* Left Column: Form */}
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-24 xl:px-32 relative">
        <button onClick={() => navigate('/')} className="absolute top-8 left-6 sm:left-12 flex items-center gap-2 group">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center shadow-md">
            <GraduationCap className="w-4 h-4 text-white" />
          </div>
          <span className="font-extrabold text-slate-900 text-lg tracking-tight group-hover:text-indigo-600 transition-colors">StudyForge</span>
        </button>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-sm mx-auto"
        >
          <div className="mb-8">
            <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-2">С возвращением!</h1>
            <p className="text-slate-500 font-medium">Войдите, чтобы продолжить обучение</p>
          </div>

          {error && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-xl text-sm font-medium mb-6">
              {error}
            </motion.div>
          )}

          <form onSubmit={handleLogin} className="space-y-5">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">Email</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all shadow-sm"
                  placeholder="you@example.com"
                  required
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">Пароль</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  className="block w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all shadow-sm"
                  placeholder="••••••••"
                  required
                />
              </div>
              <div className="flex justify-end mt-2">
                <button 
                  type="button" 
                  onClick={() => navigate('/forgot-password')} 
                  className="text-xs font-bold text-indigo-600 hover:text-indigo-500 transition-colors"
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

          <p className="mt-8 text-center text-sm text-slate-500 font-medium">
            Нет аккаунта?{' '}
            <button onClick={() => navigate('/register')} className="font-bold text-indigo-600 hover:text-indigo-500 hover:underline transition-all">
              Зарегистрироваться
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
          className="relative w-full max-w-md bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 shadow-2xl"
          style={{ transformStyle: "preserve-3d", perspective: 1000 }}
        >
          <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-white/20 rounded-full text-white text-xs font-bold mb-6">
            <CheckCircle2 className="w-4 h-4" /> AI-Ассистент
          </div>
          
          <h2 className="text-3xl font-black text-white leading-tight mb-4 tracking-tight">
            Готовьтесь к экзаменам <br/>
            с максимальной отдачей
          </h2>
          
          <p className="text-indigo-100 leading-relaxed text-sm mb-8">
            StudyForge преобразует ваши лекции в умные конспекты, карточки Лейтнера и тесты за 15 секунд.
          </p>

          <div className="space-y-3">
            {[
              { label: "Точность алгоритма", value: "99.8%" },
              { label: "Экономия времени", value: "до 80%" },
              { label: "Запоминание", value: "x4 раза выше" }
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
