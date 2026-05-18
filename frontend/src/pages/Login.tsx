import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const { user } = useAuth();
  useEffect(() => {
    if (user) navigate('/dashboard');
  }, [user]);

  const handleLogin = async () => {
    setLoading(true);
    setError('');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) setError(error.message);
    else navigate('/dashboard');
    setLoading(false);
  };

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center px-4">
      <div className="bg-slate-800 rounded-2xl p-8 w-full max-w-md">
        <h1 className="text-2xl font-bold text-white mb-6">Вход в StudyForge</h1>

        {error && (
          <p className="text-rose-400 text-sm mb-4">{error}</p>
        )}

        <div className="space-y-4">
          <div>
            <label className="text-sm text-slate-400 mb-1 block">Email</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 transition"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label className="text-sm text-slate-400 mb-1 block">Пароль</label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="w-full bg-slate-700 text-white rounded-lg px-4 py-2.5 outline-none focus:ring-2 focus:ring-indigo-500 transition"
              placeholder="••••••••"
            />
          </div>
        </div>

        <button
          onClick={handleLogin}
          disabled={loading}
          className="w-full h-11 mt-6 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-semibold transition disabled:opacity-50"
        >
          {loading ? 'Входим...' : 'Войти'}
        </button>

        <p className="text-center text-sm text-slate-400 mt-4">
          Нет аккаунта?{' '}
          <button onClick={() => navigate('/register')} className="text-indigo-400 hover:text-indigo-300 transition">
            Зарегистрироваться
          </button>
        </p>
      </div>
    </div>
  );
}
