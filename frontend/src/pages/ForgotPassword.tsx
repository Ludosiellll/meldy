import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { motion } from 'framer-motion';
import { GraduationCap, Mail, ArrowRight, ShieldCheck, HelpCircle } from 'lucide-react';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + '/update-password',
    });
    
    if (error) {
      if (error.message.includes('not found') || error.message.includes('invalid')) {
        setError('Не удалось найти пользователя с таким email.');
      } else {
        setError('Произошла ошибка при отправке. Попробуйте позже.');
      }
    } else {
      setSuccess(true);
    }
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
            <h1 className="text-3xl font-black text-slate-900 dark:text-slate-100 tracking-tight mb-2">Восстановление</h1>
            <p className="text-slate-500 dark:text-slate-400 font-medium">Введите ваш email для сброса пароля</p>
          </div>

          {error && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-rose-50 dark:bg-rose-950/30 border border-rose-200 dark:border-rose-900/50 text-rose-600 px-4 py-3 rounded-xl text-sm font-medium mb-6">
              {error}
            </motion.div>
          )}

          {success ? (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-600 px-4 py-6 rounded-xl text-sm font-bold mb-6 flex flex-col items-center text-center gap-3 shadow-sm shadow-emerald-100 dark:shadow-none">
              <div className="w-12 h-12 bg-emerald-100 dark:bg-emerald-900/30 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mb-1">
                <Mail className="w-6 h-6" />
              </div>
              <p>Инструкции по восстановлению пароля отправлены на почту <b>{email}</b></p>
              <button
                onClick={() => navigate('/login')}
                className="mt-4 w-full py-2.5 px-4 border border-emerald-300 dark:border-emerald-800 rounded-xl text-emerald-700 dark:text-emerald-300 bg-emerald-100/50 dark:bg-emerald-900/20 hover:bg-emerald-100 dark:hover:bg-emerald-900/40 font-bold transition-all"
              >
                Вернуться ко входу
              </button>
            </motion.div>
          ) : (
            <form onSubmit={handleReset} className="space-y-5">
              <div>
                <label className="block text-sm font-bold text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
                <div className="relative">
                  <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                    <Mail className="h-5 w-5 text-slate-400" />
                  </div>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    className="block w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all shadow-sm"
                    placeholder="you@example.com"
                    required
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="group relative w-full flex justify-center py-3.5 px-4 border border-transparent rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all shadow-lg shadow-indigo-200 dark:shadow-none hover:shadow-indigo-300 dark:hover:shadow-none disabled:opacity-70"
              >
                {loading ? (
                  <span className="flex items-center gap-2">Отправляем... <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /></span>
                ) : (
                  <span className="flex items-center gap-2">Получить ссылку <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></span>
                )}
              </button>
            </form>
          )}

          <p className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400 font-medium">
            Вспомнили пароль?{' '}
            <button onClick={() => navigate('/login')} className="font-bold text-indigo-600 dark:text-indigo-400 hover:text-indigo-500 hover:underline transition-all">
              Войти в аккаунт
            </button>
          </p>
        </motion.div>
      </div>

      {/* Right Column: Branded Visual (Hidden on mobile) */}
      <div className="hidden lg:flex flex-1 relative bg-indigo-600 overflow-hidden items-center justify-center p-12">
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-indigo-800" />
        <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-white/10 rounded-full blur-3xl" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-indigo-400/20 rounded-full blur-3xl" />
        
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

        <motion.div 
          initial={{ opacity: 0, scale: 0.9, rotateY: 15 }}
          animate={{ opacity: 1, scale: 1, rotateY: 0 }}
          transition={{ duration: 0.8, type: "spring" }}
          className="relative w-full max-w-md bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 shadow-2xl"
          style={{ transformStyle: "preserve-3d", perspective: 1000 }}
        >
          <div className="w-12 h-12 bg-white/20 rounded-2xl flex items-center justify-center mb-6 border border-white/20 shadow-inner">
            <ShieldCheck className="w-6 h-6 text-white" />
          </div>
          
          <h2 className="text-3xl font-black text-white leading-tight mb-4 tracking-tight">
            Безопасность <br/>прежде всего
          </h2>
          
          <p className="text-indigo-100 leading-relaxed text-sm mb-6">
            Если вы потеряли доступ к аккаунту, мы поможем вам быстро и безопасно восстановить его.
          </p>
          
          <div className="bg-white/5 border border-white/10 rounded-xl p-4 flex gap-3">
            <HelpCircle className="w-5 h-5 text-indigo-200 shrink-0" />
            <p className="text-xs text-indigo-100">Убедитесь, что вы проверяете папку «Спам», если письмо долго не приходит.</p>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
