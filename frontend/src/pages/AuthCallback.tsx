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
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--sf-canvas)] px-4 text-center">
      {error ? (
        <div role="alert" className="flex max-w-sm flex-col items-center gap-4">
          <p className="text-sm leading-relaxed text-rose-700 dark:text-rose-400">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="min-h-[44px] rounded-lg bg-[var(--sf-accent)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--sf-accent-hover)]"
          >
            Вернуться ко входу
          </button>
        </div>
      ) : (
        <div role="status" className="flex flex-col items-center gap-3">
          <span
            aria-hidden="true"
            className="h-8 w-8 rounded-full border-2 border-[var(--sf-line)] border-t-[var(--sf-accent-fg)] animate-spin motion-reduce:animate-none"
          />
          <p className="text-sm text-[var(--sf-muted)]">Выполняем вход…</p>
        </div>
      )}
    </main>
  );
}
