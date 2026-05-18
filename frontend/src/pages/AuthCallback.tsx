import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';

export default function AuthCallback() {
  const navigate = useNavigate();

  useEffect(() => {
    // Обрабатываем токены из URL (email confirmation, magic link)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate('/dashboard', { replace: true });
      } else {
        // Слушаем событие входа после обработки токена
        const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_IN' && session) {
            navigate('/dashboard', { replace: true });
            subscription.unsubscribe();
          } else if (event === 'TOKEN_REFRESHED') {
            navigate('/dashboard', { replace: true });
            subscription.unsubscribe();
          }
        });
        // Если через 3 секунды ничего — на логин
        setTimeout(() => {
          navigate('/login', { replace: true });
          subscription.unsubscribe();
        }, 3000);
      }
    });
  }, []);

  return (
    <div className="min-h-screen bg-slate-900 flex flex-col items-center justify-center gap-4">
      <div className="w-10 h-10 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      <p className="text-slate-400 text-sm">Выполняем вход...</p>
    </div>
  );
}
