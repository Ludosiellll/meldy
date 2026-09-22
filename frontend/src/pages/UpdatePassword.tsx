import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { motion } from 'framer-motion';
import { GraduationCap, Lock, ArrowRight, ShieldCheck } from 'lucide-react';

export default function UpdatePassword() {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    // Listen for auth state changes to make sure we are handling the password recovery event
    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event == 'PASSWORD_RECOVERY') {
          // User is ready to update their password
        }
      }
    );
    return () => {
      authListener.subscription.unsubscribe();
    };
  }, []);

  const handleUpdate = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (password.length < 6) {
      setError('Пароль должен содержать минимум 6 символов');
      return;
    }
    
    if (password !== confirm) {
      setError('Пароли не совпадают');
      return;
    }
    
    setLoading(true);
    setError('');
    
    const { error } = await supabase.auth.updateUser({
      password: password
    });
    
    if (error) {
      setError('Произошла ошибка при обновлении пароля.');
    } else {
      setSuccess(true);
      setTimeout(() => {
        navigate('/dashboard');
      }, 2000);
    }
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] dark:bg-slate-950 flex text-slate-900 dark:text-slate-100">
      {/* Left Column: Form */}
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-24 xl:px-32 relative">
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
            <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight mb-2">Новый пароль</h1>
            <p className="text-slate-500 dark:text-slate-400">Используйте не менее шести символов.</p>
          </div>

          {error && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-600 px-4 py-3 rounded-xl text-sm font-medium mb-6">
              {error}
            </motion.div>
          )}

          {success ? (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-600 px-4 py-6 rounded-xl text-sm font-bold mb-6 flex flex-col items-center text-center gap-3 shadow-sm shadow-emerald-100 dark:shadow-none">
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mb-1">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <p>Пароль успешно изменён! Перенаправляем...</p>
            </motion.div>
          ) : (
            <form onSubmit={handleUpdate} className="space-y-5">
              <div>
                <label htmlFor="new-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Новый пароль</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    id="new-password"
                    name="new-password"
                    type="password"
                    autoComplete="new-password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="block w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 outline-none transition-colors"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>
              
              <div>
                <label htmlFor="confirm-new-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Подтвердите пароль</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    id="confirm-new-password"
                    name="confirm-new-password"
                    type="password"
                    autoComplete="new-password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    className="block w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 outline-none transition-colors"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group relative w-full flex justify-center py-3.5 px-4 border border-transparent rounded-lg text-sm font-semibold text-slate-950 bg-cyan-300 hover:bg-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-400 transition-colors disabled:opacity-70 mt-4"
              >
                {loading ? (
                  <span className="flex items-center gap-2">Сохраняем... <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /></span>
                ) : (
                  <span className="flex items-center gap-2">Сохранить <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></span>
                )}
              </button>
            </form>
          )}
        </motion.div>
      </div>

      {/* Right Column: Branded Visual (Hidden on mobile) */}
      <div className="hidden lg:flex flex-1 relative bg-[#07111f] overflow-hidden items-center justify-center p-12 border-l border-white/10">
        <div className="absolute inset-0 bg-[#07111f]" />
        <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-white/10 rounded-full blur-3xl" />
        
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

        <motion.div 
          initial={{ opacity: 0, scale: 0.9, rotateY: -15 }}
          animate={{ opacity: 1, scale: 1, rotateY: 0 }}
          transition={{ duration: 0.8, type: "spring" }}
          className="relative w-full max-w-md border-y border-white/10 py-8"
          style={{ transformStyle: "preserve-3d", perspective: 1000 }}
        >
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-6 border border-white/20 shadow-inner">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          
          <h2 className="text-3xl font-semibold text-white leading-tight mb-4 tracking-tight">
            Один шаг до продолжения
          </h2>
          
          <p className="text-slate-300 leading-relaxed text-sm mb-6">
            После сохранения вы вернётесь в StudyForge и продолжите работу с прежними материалами.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
