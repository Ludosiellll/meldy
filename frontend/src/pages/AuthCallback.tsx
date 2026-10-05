import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { track } from '../lib/telemetry';
import { preloadAfterSignIn } from '../lib/prefetch';

export default function AuthCallback() {
  const navigate = useNavigate();
  const [error, setError] = useState('');

  // «Сегодня» opens next: its screen comes in while the sign-in completes.
  useEffect(preloadAfterSignIn, []);

  useEffect(() => {
    let cancelled = false;
    let tracked = false;
    let timeout: number | undefined;
    const finish = (message?: string) => {
      if (cancelled) return;
      if (message) {
        window.clearTimeout(timeout);
        setError(message);
        return;
      }
      window.clearTimeout(timeout);
      if (!tracked) track('login_done', { method: 'oauth' });
      tracked = true;
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

  // Meldy 2026-10-04: a white card on the canvas with the wordmark; styles .au-wait in styles/legacy.css.
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 bg-[var(--sf-canvas)] px-4 text-center text-[var(--sf-ink)]">
      {error ? (
        <div role="alert" className="au-wait">
          <span className="au-mark-bad" aria-hidden="true">
            <AlertTriangle />
          </span>
          <p className="au-wait-text text-rose-700 dark:text-rose-400">{error}</p>
          <button
            type="button"
            onClick={() => navigate('/login', { replace: true })}
            className="sf-primary"
          >
            Вернуться ко входу
          </button>
        </div>
      ) : (
        <div role="status" className="au-wait">
          <span className="au-logo" aria-hidden="true">Meldy</span>
          <span
            aria-hidden="true"
            className="au-wait-ring rounded-full border-[var(--sf-line)] border-t-[var(--sf-accent-fg)] animate-spin motion-reduce:animate-none"
          />
          <p className="au-wait-text text-[var(--sf-muted)]">Выполняем вход…</p>
        </div>
      )}
    </main>
  );
}
