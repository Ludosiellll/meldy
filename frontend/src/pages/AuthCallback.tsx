import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    let timeout: number | undefined;
    const finish = (message?: string) => {
      if (cancelled) return;
      if (message) {
        window.clearTimeout(timeout);
        setError(message);
        return;
      }
      window.clearTimeout(timeout);
      navigate('/dashboard', { replace: true });
    };

    const complete = async () => {
      try {
        // OAuth PKCE returns ?code=...; handle it explicitly before reading the session.
        const code = new URLSearchParams(window.location.search).get('code');
        if (code) {
          const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
          if (exchangeError) throw exchangeError;
        }
        const { data, error: sessionError } = await supabase.auth.getSession();
        if (sessionError) throw sessionError;
        if (data.session) finish();
      } catch (err) {
        console.error('Auth callback error:', err);
        finish('Не удалось завершить вход. Вернитесь на страницу входа и попробуйте ещё раз.');
      }
    };

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && session) finish();
    });

    // Email confirmation and OAuth can finish after a slow redirect. Give the SDK 15s.
    timeout = window.setTimeout(() => {
      if (!cancelled) finish('Вход не завершился вовремя. Проверьте настройки OAuth и попробуйте ещё раз.');
    }, 15000);
    complete();

    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
      subscription.unsubscribe();
    };
  }, [navigate]);

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
      <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      {error ? (
        <>
          <p className="text-rose-400 text-sm text-center max-w-sm">{error}</p>
          <button onClick={() => navigate('/login', { replace: true })} className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-semibold">Вернуться ко входу</button>
        </>
      ) : <p className="text-slate-400 text-sm">Выполняем вход...</p>}
    </div>
  );
}
