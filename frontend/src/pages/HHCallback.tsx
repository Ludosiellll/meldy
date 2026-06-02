import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { exchangeHHCode } from '../api/career';
import toast from 'react-hot-toast';
import { Loader2 } from 'lucide-react';

export default function HHCallback() {
  const navigate = useNavigate();
  const exchangeCalled = useRef(false);

  useEffect(() => {
    if (exchangeCalled.current) return;
    exchangeCalled.current = true;

    const code = new URLSearchParams(window.location.search).get('code');
    if (!code) {
      toast.error('Код авторизации не найден в URL.');
      navigate('/career', { replace: true });
      return;
    }

    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) {
        toast.error('Пользователь не авторизован.');
        navigate('/login', { replace: true });
        return;
      }

      try {
        const token = session.access_token;
        const res = await exchangeHHCode(code, token);
        if (res.success) {
          toast.success('Аккаунт HeadHunter успешно подключен!');
        } else {
          toast.error(res.message || 'Не удалось связать аккаунт HeadHunter.');
        }
      } catch (err: any) {
        console.error(err);
        toast.error(err.message || 'Ошибка при обмене токенов.');
      } finally {
        // Redirect to career with a tab parameter so we can select jobs
        navigate('/career?tab=jobs', { replace: true });
      }
    });
  }, [navigate]);

  return (
    <div className="min-h-screen bg-slate-950 flex flex-col items-center justify-center gap-4 text-center p-6">
      <div className="relative w-16 h-16 flex items-center justify-center">
        <div className="absolute inset-0 border-4 border-indigo-500/20 rounded-full" />
        <div className="absolute inset-0 border-4 border-t-indigo-500 rounded-full animate-spin" />
        <div className="w-8 h-8 rounded-full bg-indigo-500/10 flex items-center justify-center">
          <Loader2 className="w-5 h-5 text-indigo-400 animate-pulse" />
        </div>
      </div>
      <div className="space-y-1.5 mt-2">
        <h3 className="text-white font-extrabold text-lg">Авторизация HeadHunter</h3>
        <p className="text-slate-400 text-xs max-w-xs leading-relaxed">
          Безопасно сохраняем ваши токены доступа в StudyForge. Пожалуйста, не закрывайте вкладку...
        </p>
      </div>
    </div>
  );
}
