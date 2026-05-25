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
            <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-2">Новый пароль</h1>
            <p className="text-slate-500 font-medium">Придумайте надежный пароль для вашего аккаунта</p>
          </div>

          {error && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-xl text-sm font-medium mb-6">
              {error}
            </motion.div>
          )}

          {success ? (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-emerald-50 border border-emerald-200 text-emerald-600 px-4 py-6 rounded-xl text-sm font-bold mb-6 flex flex-col items-center text-center gap-3 shadow-sm shadow-emerald-100">
              <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mb-1">
                <ShieldCheck className="w-6 h-6" />
              </div>
              <p>Пароль успешно изменён! Перенаправляем...</p>
            </motion.div>
          ) : (
            <form onSubmit={handleUpdate} className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Новый пароль</label>
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
              </div>
              
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">Подтвердите пароль</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Lock className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    type="password"
                    value={confirm}
                    onChange={e => setConfirm(e.target.value)}
                    className="block w-full pl-11 pr-4 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all shadow-sm"
                    placeholder="••••••••"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group relative w-full flex justify-center py-3.5 px-4 border border-transparent rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all shadow-lg shadow-indigo-200 hover:shadow-indigo-300 disabled:opacity-70 mt-4"
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
      <div className="hidden lg:flex flex-1 relative bg-indigo-600 overflow-hidden items-center justify-center p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-indigo-800" />
        <div className="absolute top-[-10%] right-[-10%] w-96 h-96 bg-white/10 rounded-full blur-3xl" />
        
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

        <motion.div 
          initial={{ opacity: 0, scale: 0.9, rotateY: -15 }}
          animate={{ opacity: 1, scale: 1, rotateY: 0 }}
          transition={{ duration: 0.8, type: "spring" }}
          className="relative w-full max-w-md bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 shadow-2xl"
          style={{ transformStyle: "preserve-3d", perspective: 1000 }}
        >
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-6 border border-white/20 shadow-inner">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          
          <h2 className="text-3xl font-black text-white leading-tight mb-4 tracking-tight">
            Финальный шаг
          </h2>
          
          <p className="text-indigo-100 leading-relaxed text-sm mb-6">
            Ваши данные будут надежно зашифрованы. Для большей безопасности используйте разные пароли на разных сервисах.
          </p>
        </motion.div>
      </div>
    </div>
  );
}
