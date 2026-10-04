import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { FREE_DAILY_LIMIT, formatLimitReset, nextLimitReset } from '../api/limits';
import { FREE_DAILY_UNITS, PRO_DAILY_UNITS } from '../lib/plans';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  usedTokens: number;
  isPro?: boolean;
}

/**
 * Окно «Дневной лимит ИИ»: сколько единиц осталось и когда лимит обновится
 * (00:00 UTC, показано в местном времени). Без тарифных предложений: оплаты в
 * Meldy нет, у аккаунта с PRO написан его дневной лимит (lib/plans.ts, считает сервер).
 * Вид (Meldy 2026-10-04): белая карточка со скруглением 32, остаток — в голубой плашке
 * с полосой-пилюлей; стили .ac-modal-* в styles/legacy.css.
 */
export default function TokenInfoModal({ isOpen, onClose, usedTokens, isPro }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const used = Math.max(0, Number(usedTokens) || 0);
  const remaining = Math.max(0, FREE_DAILY_LIMIT - used);
  const share = Math.min(100, Math.max(0, (remaining / FREE_DAILY_LIMIT) * 100));

  useEffect(() => {
    if (!isOpen) return;
    dialogRef.current?.focus(); // фокус в окно, без рамки на кнопке закрытия
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const resetAt = formatLimitReset(nextLimitReset());

  return (
    <div className="ac-modal">
      <div aria-hidden="true" className="ac-modal-dim" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="ac-modal-card"
      >
        <button type="button" onClick={onClose} aria-label="Закрыть" className="ac-modal-x">
          <X aria-hidden="true" />
        </button>

        <h2 id={titleId} className="ac-modal-h">Дневной лимит ИИ</h2>

        {isPro ? (
          <p className="ac-modal-p">
            У вас PRO: до {PRO_DAILY_UNITS} единиц ИИ в день вместо {FREE_DAILY_UNITS}. Лимит обновится в {resetAt}.
          </p>
        ) : (
          <>
            <div className="ac-limit">
              <p className="ac-limit-line">
                Осталось на сегодня: <span className="ac-limit-n">{remaining}</span> из {FREE_DAILY_LIMIT} единиц.
              </p>
              <div aria-hidden="true" className="ac-limit-track">
                <div data-testid="limit-bar" className="ac-limit-fill" style={{ width: `${share}%` }} />
              </div>
            </div>
            <p className="ac-modal-p">
              {remaining === 0 ? `На сегодня лимит исчерпан, он обновится в ${resetAt}.` : `Лимит обновится в ${resetAt}.`}{' '}
              Единицы расходуются, когда Meldy обращается к ИИ, например: анализ материала, сверка вопросов
              экзамена с лекциями, ответ на билет, разговор, шпаргалка.
            </p>
          </>
        )}

        <button type="button" onClick={onClose} className="ac-modal-ok">
          Понятно
        </button>
      </div>
    </div>
  );
}
