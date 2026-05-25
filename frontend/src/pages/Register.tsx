import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { motion } from 'framer-motion';
import { GraduationCap, Mail, Lock, User, ArrowRight, Sparkles, BookOpen, Eye, EyeOff } from 'lucide-react';
import { validateName, validateEmail, validatePassword, getPasswordStrength } from '../utils/validators';

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [loading, setLoading] = useState(false);
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  
  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user, navigate]);

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    
    const ne = validateName(name);
    const ee = validateEmail(email);
    const pe = validatePassword(password);
    
    if (ne || ee || pe) {
      setNameError(ne); setEmailError(ee); setPasswordError(pe);
      setLoading(false);
      return;
    }
    
    if (password !== confirm) {
      setError('Пароли не совпадают');
      setLoading(false);
      return;
    }
    
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: window.location.origin + '/dashboard',
      },
    });
    
    if (error) {
      if (error.message.includes('already registered')) {
        setError('Пользователь с таким email уже существует');
      } else {
        setError('Произошла ошибка при регистрации. Проверьте данные.');
      }
    } else {
      if (data.session) {
        navigate('/dashboard');
      } else {
        setSuccess('Успешно! Мы отправили письмо с подтверждением на вашу почту. Пожалуйста, перейдите по ссылке в письме.');
      }
    }
    
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-[#f8fafc] flex">
      {/* Left Column: Form */}
      <div className="flex-1 flex flex-col justify-center px-6 sm:px-12 lg:px-24 xl:px-32 relative py-12">
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
            <h1 className="text-3xl font-black text-slate-900 tracking-tight mb-2">Создать аккаунт</h1>
            <p className="text-slate-500 font-medium">Ваш умный помощник в учебе ждет</p>
          </div>

          {error && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-xl text-sm font-medium mb-6">
              {error}
            </motion.div>
          )}

          {success && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-emerald-50 border border-emerald-200 text-emerald-600 px-4 py-4 rounded-xl text-sm font-bold mb-6 flex flex-col items-center text-center gap-2 shadow-sm shadow-emerald-100">
              <Mail className="w-8 h-8 text-emerald-500 mb-1" />
              {success}
            </motion.div>
          )}

          {!success && (
            <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">Имя</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="text"
                  value={name}
                  onChange={e => {
                    setName(e.target.value);
                    setNameError(validateName(e.target.value));
                  }}
                  className={`block w-full pl-11 pr-4 py-3 bg-white border ${nameError ? 'border-rose-300 ring-rose-100 focus:border-rose-500 focus:ring-rose-500' : 'border-slate-200 focus:ring-indigo-500 focus:border-indigo-500'} rounded-xl text-slate-900 text-sm focus:ring-2 outline-none transition-all shadow-sm`}
                  placeholder="Ваше имя"
                />
              </div>
              {nameError && <p className="text-rose-500 text-xs font-bold mt-1.5">{nameError}</p>}
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">Email</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type="email"
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value);
                    setEmailError(validateEmail(e.target.value));
                  }}
                  className={`block w-full pl-11 pr-4 py-3 bg-white border ${emailError ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500' : 'border-slate-200 focus:ring-indigo-500 focus:border-indigo-500'} rounded-xl text-slate-900 text-sm focus:ring-2 outline-none transition-all shadow-sm`}
                  placeholder="you@example.com"
                />
              </div>
              {emailError && <p className="text-rose-500 text-xs font-bold mt-1.5">{emailError}</p>}
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">Пароль</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => {
                    setPassword(e.target.value);
                    setPasswordError(validatePassword(e.target.value));
                  }}
                  className={`block w-full pl-11 pr-11 py-3 bg-white border ${passwordError ? 'border-amber-300 focus:border-amber-500 focus:ring-amber-500' : 'border-slate-200 focus:ring-indigo-500 focus:border-indigo-500'} rounded-xl text-slate-900 text-sm focus:ring-2 outline-none transition-all shadow-sm`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-indigo-600 transition"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {passwordError && <p className="text-amber-500 text-xs font-bold mt-1.5">{passwordError}</p>}
              
              {/* Strength Meter (Light Theme) */}
              <div className="mt-2.5 flex gap-1.5">
                {[1,2,3].map(level => {
                  let colorClass = 'bg-slate-100'; // Default gray
                  if (password.length > 0) {
                    const strength = getPasswordStrength(password);
                    if (strength === 0) colorClass = level === 1 ? 'bg-rose-500' : 'bg-slate-100';
                    else if (strength === 1) colorClass = level === 1 ? 'bg-rose-500' : 'bg-slate-100';
                    else if (strength === 2) colorClass = level <= 2 ? 'bg-amber-400' : 'bg-slate-100';
                    else if (strength >= 3) colorClass = 'bg-emerald-500';
                  }
                  return (
                    <div key={level} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${colorClass}`} />
                  );
                })}
              </div>
            </div>

            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">Повтор пароля</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  type={showConfirm ? 'text' : 'password'}
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  className="block w-full pl-11 pr-11 py-3 bg-white border border-slate-200 rounded-xl text-slate-900 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500 outline-none transition-all shadow-sm"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 hover:text-indigo-600 transition"
                  tabIndex={-1}
                >
                  {showConfirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-3.5 px-4 mt-2 border border-transparent rounded-xl text-sm font-bold text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 transition-all shadow-lg shadow-indigo-200 hover:shadow-indigo-300 disabled:opacity-70"
            >
              {loading ? (
                <span className="flex items-center gap-2">Регистрируем... <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /></span>
              ) : (
                <span className="flex items-center gap-2">Зарегистрироваться <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></span>
              )}
            </button>
          </form>
          )}

          <p className="mt-8 text-center text-sm text-slate-500 font-medium">
            Уже есть аккаунт?{' '}
            <button onClick={() => navigate('/login')} className="font-bold text-indigo-600 hover:text-indigo-500 hover:underline transition-all">
              Войти
            </button>
          </p>
        </motion.div>
      </div>

      {/* Right Column: Branded Visual (Hidden on mobile) */}
      <div className="hidden lg:flex flex-1 relative bg-indigo-600 overflow-hidden items-center justify-center p-12">
        {/* Animated background elements */}
        <div className="absolute inset-0 bg-gradient-to-br from-indigo-500 to-indigo-800" />
        <div className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] bg-white/10 rounded-full blur-3xl" />
        
        {/* Geometric pattern overlay */}
        <div className="absolute inset-0 opacity-10" style={{ backgroundImage: 'radial-gradient(white 1px, transparent 1px)', backgroundSize: '24px 24px' }} />

        {/* Floating Abstract Element */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, type: "spring", delay: 0.1 }}
          className="relative z-10 w-full max-w-md"
        >
          <div className="bg-white/10 backdrop-blur-xl border border-white/20 rounded-3xl p-8 shadow-2xl relative">
            <div className="absolute -top-6 -right-6 w-16 h-16 bg-emerald-400 rounded-2xl rotate-12 flex items-center justify-center shadow-lg border border-white/20">
              <Sparkles className="w-8 h-8 text-white" />
            </div>
            
            <div className="w-12 h-12 bg-indigo-500/50 rounded-xl flex items-center justify-center mb-6 border border-white/20">
              <BookOpen className="w-6 h-6 text-white" />
            </div>

            <h2 className="text-3xl font-black text-white leading-tight mb-4 tracking-tight">
              Ваш персональный <br/>учебный центр
            </h2>
            
            <ul className="space-y-4 text-indigo-100 text-sm font-medium">
              <li className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">✓</div>
                Бесконечная загрузка конспектов
              </li>
              <li className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">✓</div>
                Интервальное повторение
              </li>
              <li className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">✓</div>
                Календарь экзаменов
              </li>
              <li className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">✓</div>
                Интерактивная визуализация знаний
              </li>
            </ul>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
