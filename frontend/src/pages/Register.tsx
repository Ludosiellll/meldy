import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';
import { motion } from 'framer-motion';
import { GraduationCap, Mail, Lock, User, ArrowRight, BookOpen, Eye, EyeOff, RefreshCw } from 'lucide-react';
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
  const [resendMessage, setResendMessage] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();
  
  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user?.id, navigate]);

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
    } else if (data?.user?.identities && data.user.identities.length === 0) {
      // Supabase "Prevent email enumeration" is ON, so it returns success but empty identities array
      // for users that already exist in the database.
      setError('Пользователь с таким email уже существует');
    } else {
      if (data.session) {
        navigate('/dashboard');
      } else {
        setSuccess('Успешно! Мы отправили письмо с подтверждением на вашу почту. Пожалуйста, перейдите по ссылке в письме.');
      }
    }
    
    setLoading(false);
  };

  const handleResend = async () => {
    setLoading(true);
    setError('');
    setResendMessage('');
    const { error } = await supabase.auth.resend({
      type: 'signup',
      email: email,
      options: {
        emailRedirectTo: window.location.origin + '/dashboard',
      }
    });
    setLoading(false);
    if (error) {
      setError('Ошибка при повторной отправке. Возможно, вы пытаетесь отправить письмо слишком часто.');
    } else {
      setResendMessage('Письмо отправлено повторно! Пожалуйста, проверьте папку "Спам".');
    }
  };

  const handleGoogleLogin = async () => {
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: window.location.origin + '/auth/callback',
      },
    });
  };

  return (
    <div className="auth-page min-h-screen flex text-slate-900 dark:text-slate-100">
      {/* Left Column: Form */}
      <div className="flex-1 flex flex-col justify-start sm:justify-center px-6 sm:px-12 lg:px-24 xl:px-32 relative pt-28 pb-12 sm:py-12">
        <button onClick={() => navigate('/')} className="absolute top-8 left-6 sm:left-12 flex items-center gap-2 group">
          <div className="app-logo-mark w-8 h-8 rounded-md flex items-center justify-center">
            <GraduationCap className="w-4 h-4" />
          </div>
          <span className="font-semibold text-slate-900 dark:text-slate-100 text-lg tracking-tight group-hover:text-[var(--sf-accent)] transition-colors">StudyForge</span>
        </button>

        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5 }}
          className="w-full max-w-sm mx-auto"
        >
          <div className="mb-8">
            <h1 className="text-3xl font-semibold text-slate-900 dark:text-slate-100 tracking-tight mb-2">Создать аккаунт</h1>
            <p className="text-slate-500 dark:text-slate-400">Сохраните материалы и продолжайте подготовку с любого устройства.</p>
          </div>

          {error && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-rose-50 border border-rose-200 text-rose-600 px-4 py-3 rounded-xl text-sm font-medium mb-6">
              {error}
            </motion.div>
          )}

          {success && (
            <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900 text-emerald-700 px-4 py-5 rounded-xl text-sm font-bold mb-6 flex flex-col items-center text-center shadow-sm shadow-emerald-100 dark:shadow-none">
              <Mail className="w-10 h-10 text-emerald-500 mb-3" />
              <span className="text-emerald-800 dark:text-emerald-300 text-base mb-1">Успешно! Мы отправили письмо на вашу почту:</span>
              <span className="bg-white dark:bg-slate-900 px-4 py-2 rounded-lg border border-emerald-100 dark:border-emerald-900 text-emerald-700 dark:text-emerald-400 font-black shadow-sm mb-3">
                {email}
              </span>
              <span className="font-medium text-emerald-600/80 dark:text-emerald-400/80 mb-4">Пожалуйста, перейдите по ссылке в письме.</span>
              
              <button 
                onClick={handleResend}
                disabled={loading}
                className="flex items-center gap-1.5 px-4 py-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 rounded-lg transition-colors text-xs font-bold disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Отправка...' : 'Отправить письмо еще раз'}
              </button>

              {resendMessage && (
                <span className="mt-3 text-emerald-700 font-bold text-xs bg-emerald-100 px-3 py-1.5 rounded-lg">
                  {resendMessage}
                </span>
              )}
            </motion.div>
          )}

          {!success && (
            <>
            <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label htmlFor="register-name" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Имя</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <User className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="register-name"
                  name="name"
                  type="text"
                  autoComplete="name"
                  value={name}
                  onChange={e => {
                    setName(e.target.value);
                    setNameError(validateName(e.target.value));
                  }}
                  aria-invalid={Boolean(nameError)}
                  aria-describedby={nameError ? 'register-name-error' : undefined}
                  className={`block w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-900 border ${nameError ? 'border-rose-300 ring-rose-100 focus:border-rose-500 focus:ring-rose-500' : 'border-slate-200 dark:border-slate-700 focus:ring-cyan-400 focus:border-cyan-400'} rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:ring-2 outline-none transition-colors`}
                  placeholder="Ваше имя"
                />
              </div>
              {nameError && <p id="register-name-error" role="alert" className="text-rose-500 text-xs font-medium mt-1.5">{nameError}</p>}
            </div>

            <div>
              <label htmlFor="register-email" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Email</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Mail className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="register-email"
                  name="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={e => {
                    setEmail(e.target.value);
                    setEmailError(validateEmail(e.target.value));
                  }}
                  aria-invalid={Boolean(emailError)}
                  aria-describedby={emailError ? 'register-email-error' : undefined}
                  className={`block w-full pl-11 pr-4 py-3 bg-white dark:bg-slate-900 border ${emailError ? 'border-rose-300 focus:border-rose-500 focus:ring-rose-500' : 'border-slate-200 dark:border-slate-700 focus:ring-cyan-400 focus:border-cyan-400'} rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:ring-2 outline-none transition-colors`}
                  placeholder="you@example.com"
                />
              </div>
              {emailError && <p id="register-email-error" role="alert" className="text-rose-500 text-xs font-medium mt-1.5">{emailError}</p>}
            </div>

            <div>
              <label htmlFor="register-password" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Пароль</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="register-password"
                  name="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  onChange={e => {
                    setPassword(e.target.value);
                    setPasswordError(validatePassword(e.target.value));
                  }}
                  aria-invalid={Boolean(passwordError)}
                  aria-describedby={passwordError ? 'register-password-error' : undefined}
                  className={`block w-full pl-11 pr-11 py-3 bg-white dark:bg-slate-900 border ${passwordError ? 'border-amber-300 focus:border-amber-500 focus:ring-amber-500' : 'border-slate-200 dark:border-slate-700 focus:ring-cyan-400 focus:border-cyan-400'} rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:ring-2 outline-none transition-colors`}
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 dark:text-slate-500 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors"
                  aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
              {passwordError && <p id="register-password-error" role="alert" className="text-amber-500 text-xs font-medium mt-1.5">{passwordError}</p>}
              
              {/* Strength Meter (Light Theme) */}
              <div className="mt-2.5 flex gap-1.5">
                {[1,2,3].map(level => {
                  let colorClass = 'bg-slate-100 dark:bg-slate-800'; // Default gray
                  if (password.length > 0) {
                    const strength = getPasswordStrength(password);
                    if (strength === 0) colorClass = level === 1 ? 'bg-rose-500' : 'bg-slate-100 dark:bg-slate-800';
                    else if (strength === 1) colorClass = level === 1 ? 'bg-rose-500' : 'bg-slate-100 dark:bg-slate-800';
                    else if (strength === 2) colorClass = level <= 2 ? 'bg-amber-400' : 'bg-slate-100 dark:bg-slate-800';
                    else if (strength >= 3) colorClass = 'bg-emerald-500';
                  }
                  return (
                    <div key={level} className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${colorClass}`} />
                  );
                })}
              </div>
            </div>

            <div>
              <label htmlFor="register-confirm" className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-1.5">Повтор пароля</label>
              <div className="relative">
                <div className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none">
                  <Lock className="h-5 w-5 text-slate-400" />
                </div>
                <input
                  id="register-confirm"
                  name="password-confirmation"
                  type={showConfirm ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  className="block w-full pl-11 pr-11 py-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 text-sm focus:ring-2 focus:ring-cyan-400 focus:border-cyan-400 outline-none transition-colors"
                  placeholder="••••••••"
                />
                <button
                  type="button"
                  onClick={() => setShowConfirm(!showConfirm)}
                  className="absolute inset-y-0 right-0 pr-3.5 flex items-center text-slate-400 dark:text-slate-500 hover:text-cyan-600 dark:hover:text-cyan-300 transition-colors"
                  aria-label={showConfirm ? 'Скрыть повтор пароля' : 'Показать повтор пароля'}
                >
                  {showConfirm ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-3.5 px-4 mt-2 border border-transparent rounded-lg text-sm font-semibold text-slate-950 bg-cyan-300 hover:bg-cyan-200 focus-visible:ring-2 focus-visible:ring-cyan-400 transition-colors disabled:opacity-70"
            >
              {loading ? (
                <span className="flex items-center gap-2">Регистрируем... <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /></span>
              ) : (
                <span className="flex items-center gap-2">Зарегистрироваться <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" /></span>
              )}
            </button>
          </form>

          <div className="relative my-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200 dark:border-slate-800" />
            </div>
            <div className="relative flex justify-center text-xs">
              <span className="auth-divider-label px-3 text-slate-400 dark:text-slate-500 font-medium">или войти через</span>
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
          </>)}

          <p className="mt-8 text-center text-sm text-slate-500 dark:text-slate-400 font-medium">
            Уже есть аккаунт?{' '}
            <button onClick={() => navigate('/login')} className="font-semibold text-[var(--sf-accent)] hover:underline transition-colors">
              Войти
            </button>
          </p>
        </motion.div>
      </div>

      {/* Right Column: Branded Visual (Hidden on mobile) */}
      <div className="auth-showcase hidden lg:flex flex-1 relative overflow-hidden items-center justify-center p-12 border-l">

        {/* Floating Abstract Element */}
        <motion.div 
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, type: "spring", delay: 0.1 }}
          className="relative z-10 w-full max-w-md"
        >
          <div className="border-y py-8 relative">
            <div className="w-12 h-12 bg-cyan-300/10 rounded-lg flex items-center justify-center mb-6 border border-cyan-200/20">
              <BookOpen className="w-6 h-6 text-cyan-300" />
            </div>

            <h2 className="text-3xl font-black text-white leading-tight mb-4 tracking-tight">
              Материал становится<br/>планом подготовки
            </h2>
            
            <ul className="space-y-4 text-slate-300 text-sm">
              <li className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">✓</div>
                Конспект с привязкой к источнику
              </li>
              <li className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">✓</div>
                Карточки для активного повторения
              </li>
              <li className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">✓</div>
                Тест для проверки понимания
              </li>
              <li className="flex items-center gap-3">
                <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center shrink-0">✓</div>
                История материалов и прогресса
              </li>
            </ul>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
