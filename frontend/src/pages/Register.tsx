import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

const validateEmail = (email: string) => {
  if (!email) return '';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return 'Некорректный email адрес';
  return '';
};

const validatePassword = (pwd: string) => {
  if (!pwd) return '';
  if (pwd.length < 6) return `Слишком короткий — ещё ${6 - pwd.length} символов`;
  if (pwd.length < 8) return 'Слабый пароль — добавь ещё символы';
  return '';
};

const validateName = (name: string) => {
  if (!name) return '';
  if (name.trim().length < 2) return 'Имя слишком короткое';
  return '';
};

export default function Register() {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [nameError, setNameError] = useState('');
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();
  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user]);

  const handleRegister = async () => {
    setLoading(true);
    setError('');
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
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { full_name: name },
        emailRedirectTo: window.location.origin + '/dashboard',
      },
    });
    if (error) setError(error.message);
    else navigate('/dashboard');
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-slate-800 rounded-2xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-white mb-6">Регистрация в StudyForge</h1>

        {error && (
          <p className="text-rose-400 text-sm mb-4">{error}</p>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-sm text-slate-400 mb-1 block">Имя</label>
            <input
              type="text"
              value={name}
              onChange={e => {
                setName(e.target.value);
                setNameError(validateName(e.target.value));
              }}
              className={`w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 border ${nameError ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-700 focus:ring-indigo-500'} transition`}
              placeholder="Ваше имя"
            />
            {nameError && <p className="text-rose-400 text-xs mt-1">{nameError}</p>}
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-1 block">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => {
                setEmail(e.target.value);
                setEmailError(validateEmail(e.target.value));
              }}
              className={`w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 border ${emailError ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-700 focus:ring-indigo-500'} transition`}
              placeholder="you@example.com"
            />
            {emailError && <p className="text-rose-400 text-xs mt-1">{emailError}</p>}
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-1 block">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={e => {
                setPassword(e.target.value);
                setPasswordError(validatePassword(e.target.value));
              }}
              className={`w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 border ${passwordError ? 'border-rose-500 focus:ring-rose-500' : 'border-slate-700 focus:ring-indigo-500'} transition`}
              placeholder="••••••••"
            />
            {passwordError && <p className="text-amber-400 text-xs mt-1">{passwordError}</p>}
            <div className="mt-1.5 flex gap-1">
              {[1,2,3].map(level => (
                <div key={level}
                  className={`h-1 flex-1 rounded-full transition-all ${
                    password.length === 0 ? 'bg-slate-700' :
                    password.length < 6 ? (level === 1 ? 'bg-rose-500' : 'bg-slate-700') :
                    password.length < 10 ? (level <= 2 ? 'bg-amber-400' : 'bg-slate-700') :
                    'bg-emerald-400'
                  }`}
                />
              ))}
            </div>
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-1 block">Повтор пароля</label>
            <input
              type="password"
              value={confirm}
              onChange={e => setConfirm(e.target.value)}
              className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 transition"
              placeholder="••••••••"
            />
          </div>
        </div>

        <button
          onClick={handleRegister}
          disabled={loading}
          className="w-full h-11 mt-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition disabled:opacity-50"
        >
          {loading ? 'Регистрируем...' : 'Зарегистрироваться'}
        </button>

        <p className="text-center text-sm text-slate-400 mt-4">
          Уже есть аккаунт?{' '}
          <button onClick={() => navigate('/login')} className="text-indigo-400 hover:text-indigo-300 transition">
            Войти
          </button>
        </p>
      </div>
    </div>
  );
}
