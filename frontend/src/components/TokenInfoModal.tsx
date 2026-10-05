import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { formatLimitReset, nextLimitReset } from '../api/limits';
import { AI_COSTS, dailyUnits, EXAM_MAPPING_QUESTIONS_PER_CHARGE, OCR_PAGES_PER_CHARGE, PRO_DAILY_UNITS } from '../lib/plans';
import { unitsPerDay } from './pro/planCopy';

interface Props {
  isOpen: boolean;
  onClose: () => void;
  usedTokens: number;
  isPro?: boolean;
  /** The account's day as the server counts it; by default 100, or 1000 with PRO (lib/plans.ts). */
  limit?: number;
  /** «Что даёт PRO»: the PRO window (only offered to an account without PRO). */
  onOpenPro?: () => void;
}

/** What an action costs, with a note under it where the price depends on the size. Numbers: lib/plans.ts. */
export const LIMIT_COSTS: ReadonlyArray<{ what: string; units: number; note?: string }> = [
  {
    what: 'Анализ лекции',
    units: AI_COSTS.lecture,
    note: `скан PDF — ещё ${AI_COSTS.scanPages} за каждые ${OCR_PAGES_PER_CHARGE} страниц`,
  },
  { what: 'Проверка ответа на билет', units: AI_COSTS.answer },
  { what: '«Разговор» по лекции', units: AI_COSTS.conversation },
  { what: '«Поговорить о лекции»', units: AI_COSTS.tutorTurn, note: 'за каждый ответ репетитора' },
  { what: 'Выжимка лекции', units: AI_COSTS.cheatsheet },
  {
    what: 'Сверка списка вопросов',
    units: AI_COSTS.examMapping,
    note: `за каждые ${EXAM_MAPPING_QUESTIONS_PER_CHARGE} новых вопросов`,
  },
];

/**
 * Окно «Дневной лимит ИИ» (открывается счётчиком в верхней строке): сколько единиц осталось, когда
 * лимит обновится (00:00 UTC, показано в местном времени), сколько стоят главные действия и что даёт
 * PRO. Единицы списывает сервер перед обращением к ИИ; бесплатно — 100 в сутки, у PRO — до 1000
 * (lib/plans.ts). PRO включается в окне PRO — бесплатно, это демо: оплата не подключена. Вид (Meldy
 * 2026-10-04): белая карточка со скруглением 36, остаток — в голубой плашке с полосой-пилюлей, цены —
 * строками; на компьютере — две колонки (остаток и кнопки слева, цены справа); стили .ac-modal-*,
 * .ac-limit-* и .ac-costs в styles/legacy.css.
 */
export default function TokenInfoModal({ isOpen, onClose, usedTokens, isPro, limit: dayLimit, onOpenPro }: Props) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const limit = dayLimit && dayLimit > 0 ? dayLimit : dailyUnits(Boolean(isPro));
  const used = Math.max(0, Number(usedTokens) || 0);
  const remaining = Math.max(0, limit - used);
  const share = Math.min(100, Math.max(0, (remaining / limit) * 100));

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
        className="ac-modal-card ac-modal-card--scroll ac-limit-card"
      >
        <button type="button" onClick={onClose} aria-label="Закрыть" className="ac-modal-x">
          <X aria-hidden="true" />
        </button>

        <h2 id={titleId} className="ac-modal-h">Дневной лимит ИИ</h2>

        {/* На компьютере две колонки: слева остаток, когда обновится и кнопки, справа цены — окно широкое и
            низкое и помещается в экран ноутбука (владелец, 2026-10-05: «компактнее, в ширину больше»). */}
        <div className="ac-limit-cols">
          <div className="ac-limit-side">
            <div className="ac-limit">
              <p className="ac-limit-line">
                Осталось на сегодня: <span className="ac-limit-n">{remaining}</span> из {limit} единиц.
              </p>
              <div aria-hidden="true" className="ac-limit-track">
                <div data-testid="limit-bar" className="ac-limit-fill" style={{ width: `${share}%` }} />
              </div>
            </div>
            <p className="ac-modal-p">
              {remaining === 0 ? `На сегодня лимит исчерпан, он обновится в ${resetAt}.` : `Лимит обновится в ${resetAt}.`}
              {isPro ? ` У аккаунта PRO — до ${PRO_DAILY_UNITS} единиц в день.` : ''}
            </p>
            {isPro ? null : <p className="ac-limit-pro">С PRO — {unitsPerDay(PRO_DAILY_UNITS)}.</p>}
          </div>

          <div className="ac-limit-prices">
            <p className="ac-modal-p ac-costs-h">Единицы списываются, когда Meldy обращается к ИИ:</p>
            <dl className="ac-costs">
              {LIMIT_COSTS.map((row) => (
                <div key={row.what} className="ac-cost">
                  <dt>
                    {row.what}
                    {row.note ? <small>{row.note}</small> : null}
                  </dt>
                  <dd>{row.units}</dd>
                </div>
              ))}
            </dl>
            <p className="ac-modal-p ac-costs-back">Если ИИ не справился, единицы возвращаются.</p>
          </div>

          <div className="ac-modal-acts ac-limit-acts">
            {!isPro && onOpenPro ? (
              <button type="button" onClick={onOpenPro} className="ac-btn ac-modal-alt">
                Что даёт PRO
              </button>
            ) : null}
            <button type="button" onClick={onClose} className="ac-modal-ok">
              Понятно
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
