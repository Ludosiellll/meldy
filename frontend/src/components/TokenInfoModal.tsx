import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { FREE_DAILY_LIMIT, formatLimitReset, nextLimitReset } from '../api/limits';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  usedTokens: number;
  isPro?: boolean;
}

/**
 * Окно «Дневной лимит ИИ»: сколько единиц осталось и когда лимит обновится
 * (00:00 UTC, показано в местном времени). Без тарифных предложений: оплаты в
 * Meldy нет, у аккаунта с PRO просто написано, что лимит к нему не применяется.
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
    <div className="fixed inset-0 z-[300] flex items-center justify-center px-4">
      <div aria-hidden="true" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full max-w-sm rounded-2xl border border-[var(--sf-line)] bg-[var(--sf-surface)] p-6 text-[var(--sf-ink)] shadow-xl focus:outline-none"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть"
          className="absolute right-2 top-2 flex h-11 w-11 items-center justify-center rounded-full text-[var(--sf-muted)] transition-colors hover:bg-[var(--sf-surface-soft)] hover:text-[var(--sf-ink)]"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>

        <h2 id={titleId} className="pr-10 text-lg font-semibold">Дневной лимит ИИ</h2>

        {isPro ? (
          <p className="mt-3 text-sm leading-relaxed text-[var(--sf-muted)]">
            У вашего аккаунта PRO: дневной лимит к нему не применяется.
          </p>
        ) : (
          <>
            <p className="mt-3 text-base">
              Осталось на сегодня: <span className="font-semibold">{remaining}</span> из {FREE_DAILY_LIMIT} единиц.
            </p>
            <div aria-hidden="true" className="mt-3 h-1.5 overflow-hidden rounded-full bg-[var(--sf-surface-soft)]">
              <div data-testid="limit-bar" className="h-full rounded-full bg-[var(--sf-accent-fg)]" style={{ width: `${share}%` }} />
            </div>
            <p className="mt-4 text-sm leading-relaxed text-[var(--sf-muted)]">
              {remaining === 0 ? `На сегодня лимит исчерпан, он обновится в ${resetAt}.` : `Лимит обновится в ${resetAt}.`}{' '}
              Единицы расходуются, когда Meldy обращается к ИИ, например: анализ материала, разметка экзамена
              по лекциям, ответ на билет, разговор, шпаргалка.
            </p>
          </>
        )}

        <button
          type="button"
          onClick={onClose}
          className="mt-6 min-h-[44px] w-full rounded-xl bg-[var(--sf-accent)] px-5 text-sm font-semibold text-white transition-colors hover:bg-[var(--sf-accent-hover)]"
        >
          Понятно
        </button>
      </div>
    </div>
  );
}
