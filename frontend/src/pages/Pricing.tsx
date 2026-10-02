import { useEffect, useState } from 'react';
import { Check, Loader2, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

export default function Pricing() {
  const { user } = useAuth();
  const userId = user?.id;
  const [isPro, setIsPro] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let isCurrent = true;

    if (!userId) {
      setIsPro(false);
      setLoadError(false);
      setLoading(false);
      return () => { isCurrent = false; };
    }

    setLoading(true);
    setLoadError(false);

    void (async () => {
      try {
        const { data, error } = await supabase
          .from('profiles')
          .select('is_pro')
          .eq('id', userId)
          .single();

        if (error) throw error;
        if (!data) throw new Error('Profile is missing');
        if (isCurrent) setIsPro(Boolean(data.is_pro));
      } catch (error) {
        console.error('Не удалось проверить тариф:', error);
        if (isCurrent) setLoadError(true);
      } finally {
        if (isCurrent) setLoading(false);
      }
    })();

    return () => { isCurrent = false; };
  }, [userId]);

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center" role="status" aria-label="Проверяем тариф">
        <Loader2 className="w-7 h-7 text-cyan-600 dark:text-cyan-300 animate-spin" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="max-w-3xl mx-auto px-4 py-12">
        <p className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-rose-800 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-200" role="alert">
          Не удалось проверить тариф. Обновите страницу и попробуйте снова.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 py-10 md:py-14">
      <header className="max-w-2xl mb-10 md:mb-12">
        <p className="text-sm font-semibold tracking-wide text-cyan-700 dark:text-cyan-300 mb-3">MELDY</p>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight text-slate-950 dark:text-white mb-3">
          Тарифы
        </h1>
        <p className="text-base md:text-lg text-slate-600 dark:text-slate-300">
          Основные функции доступны бесплатно. Оплата тарифа PRO пока не подключена.
        </p>
      </header>

      <div className="grid md:grid-cols-2 gap-5 md:gap-6">
        <section className="bg-white dark:bg-slate-900 rounded-xl p-6 md:p-7 border border-slate-200 dark:border-slate-700 flex flex-col">
          <div className="mb-7">
            <h2 className="text-xl font-semibold text-slate-950 dark:text-white mb-1">Студент</h2>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-5">Базовый набор для учёбы</p>
            <p className="text-3xl font-semibold text-slate-950 dark:text-white">0 ₽</p>
          </div>

          <ul className="space-y-4 mb-7 flex-1">
            <li className="flex items-center gap-3 text-slate-700 dark:text-slate-200">
              <Check className="w-5 h-5 text-cyan-700 dark:text-cyan-300 shrink-0" />
              <span>Анализ учебных материалов</span>
            </li>
            <li className="flex items-center gap-3 text-slate-700 dark:text-slate-200">
              <Check className="w-5 h-5 text-cyan-700 dark:text-cyan-300 shrink-0" />
              <span>Создание карточек и тестов</span>
            </li>
            <li className="flex items-center gap-3 text-slate-700 dark:text-slate-200">
              <Zap className="w-5 h-5 text-amber-600 dark:text-amber-300 shrink-0" />
              <span>До 100 единиц ИИ-лимита в день</span>
            </li>
          </ul>

          <button
            type="button"
            disabled
            className="w-full min-h-12 px-4 rounded-lg border border-slate-200 bg-slate-100 text-slate-600 font-medium cursor-not-allowed dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            {isPro ? 'Бесплатный тариф' : 'Текущий тариф'}
          </button>
        </section>

        <section className="bg-cyan-50/70 dark:bg-slate-900 rounded-xl p-6 md:p-7 border border-cyan-200 dark:border-cyan-900/70 flex flex-col">
          <div className="mb-7">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-xl font-semibold text-slate-950 dark:text-white">PRO Академик</h2>
              {isPro && (
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-2 py-1 text-xs font-semibold text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-200">
                  <Check className="w-3.5 h-3.5" /> Активен
                </span>
              )}
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-5">Для аккаунтов PRO дневной лимит ИИ не применяется</p>
            <p className="text-sm text-slate-600 dark:text-slate-300">Стоимость появится после подключения оплаты</p>
          </div>
          <div className="flex-1" />

          {isPro ? (
            <button
              type="button"
              disabled
              className="w-full min-h-12 px-4 rounded-lg bg-emerald-100 text-emerald-900 font-semibold cursor-default dark:bg-emerald-950/60 dark:text-emerald-200"
            >
              У вас есть PRO
            </button>
          ) : (
            <div>
              <button
                type="button"
                disabled
                className="w-full min-h-12 px-4 rounded-lg bg-slate-200 text-slate-600 font-semibold cursor-not-allowed dark:bg-slate-800 dark:text-slate-400"
              >
                Оплата пока недоступна
              </button>
              <p className="mt-3 text-sm text-slate-600 dark:text-slate-300" role="note">
                Подключение оплаты ещё не настроено.
              </p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
