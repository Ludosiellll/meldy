import { useEffect, useState } from 'react';
import { Check, Star, Zap } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../hooks/useAuth';

/**
 * Тарифы (Meldy 2026-10-04): две карточки с цветными панелями, как карточки «Как это работает» на
 * лендинге. Честность прежняя: оплаты нет, цены PRO нет, кнопки — состояния, а не покупка.
 * Стили — .ac-* в styles/legacy.css.
 */
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
      <div className="sf-page">
        <div className="ac-wait" role="status" aria-label="Проверяем тариф">
          <span className="ac-ring" aria-hidden="true" />
        </div>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="sf-page">
        <p className="ac-alert ac-alert--page" role="alert">
          Не удалось проверить тариф. Обновите страницу и попробуйте снова.
        </p>
      </div>
    );
  }

  return (
    <div className="sf-page">
      <header className="sf-head">
        <div>
          <h1 className="sf-h1">Тарифы</h1>
          <p className="sf-lede ac-lede">
            Основные функции доступны бесплатно. Оплата тарифа PRO пока не подключена.
          </p>
        </div>
      </header>

      <div className="ac-plans">
        <section className="ac-plan" aria-labelledby="plan-student">
          <div className="ac-art ac-art--sky" aria-hidden="true">
            <span className="ac-art-dots" />
            <span className="ac-fc ac-fc--1" />
            <span className="ac-fc ac-fc--2" />
            <span className="ac-fc ac-fc--3">?</span>
          </div>
          <div className="ac-plan-body">
            <h2 id="plan-student" className="ac-plan-h">Студент</h2>
            <p className="ac-plan-sub">Базовый набор для учёбы</p>
            <p className="ac-price">0 ₽</p>

            <ul className="ac-feats">
              <li>
                <span className="ac-feat-i ac-feat-i--ok" aria-hidden="true"><Check /></span>
                <span>Анализ учебных материалов</span>
              </li>
              <li>
                <span className="ac-feat-i ac-feat-i--ok" aria-hidden="true"><Check /></span>
                <span>Создание карточек и тестов</span>
              </li>
              <li>
                <span className="ac-feat-i ac-feat-i--limit" aria-hidden="true"><Zap /></span>
                <span>До 100 единиц ИИ-лимита в день</span>
              </li>
            </ul>

            <button type="button" disabled className="ac-state">
              {isPro ? 'Бесплатный тариф' : 'Текущий тариф'}
            </button>
          </div>
        </section>

        <section className="ac-plan" aria-labelledby="plan-pro">
          <div className="ac-art" aria-hidden="true">
            <span className="ac-art-dots" />
            <span className="ac-halo">
              <Star />
            </span>
          </div>
          <div className="ac-plan-body">
            <div className="ac-plan-top">
              <h2 id="plan-pro" className="ac-plan-h">PRO Академик</h2>
              {isPro && (
                <span className="ac-pill ac-pill--ok">
                  <Check aria-hidden="true" /> Активен
                </span>
              )}
            </div>
            <p className="ac-plan-sub">Для аккаунтов PRO дневной лимит ИИ не применяется</p>
            <p className="ac-plan-sub ac-plan-sub--gap">Стоимость появится после подключения оплаты</p>
            <div className="ac-grow" />

            {isPro ? (
              <button type="button" disabled className="ac-state ac-state--ok">
                У вас есть PRO
              </button>
            ) : (
              <div>
                <button type="button" disabled className="ac-state">
                  Оплата пока недоступна
                </button>
                <p className="ac-note" role="note">
                  Подключение оплаты ещё не настроено.
                </p>
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
