import { useEffect, useId, useRef } from 'react';
import { X } from 'lucide-react';
import { formatLimitReset, nextLimitReset } from '../api/limits';
import { AI_COSTS, dailyUnits, EXAM_MAPPING_QUESTIONS_PER_CHARGE, IMPORT_AI_QUESTIONS_PER_CHARGE, OCR_PAGES_PER_CHARGE, PRO_DAILY_UNITS } from '../lib/plans';
import { unitsPerDay, WITHOUT_UNITS } from './pro/planCopy';

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

/**
 * What an action costs, with a note under it where the price depends on the size. Numbers: lib/plans.ts.
 * Every action that spends units is here; the rarer ones (`more`) sit under «Ещё», so the window stays
 * as low as the laptop's screen.
 */
export const LIMIT_COSTS: ReadonlyArray<{ what: string; units: number; note?: string; more?: true }> = [
  {
    what: 'Анализ лекции',
    units: AI_COSTS.lecture,
    note: `скан PDF — ещё ${AI_COSTS.scanPages} за каждые ${OCR_PAGES_PER_CHARGE} страниц`,
  },
  { what: 'Проверка ответа на билет', units: AI_COSTS.answer },
  { what: 'Пункты ответа к новому вопросу', units: AI_COSTS.answerPoints, note: 'один раз на вопрос' },
  {
    what: 'Сверка списка вопросов',
    units: AI_COSTS.examMapping,
    note: `за каждые ${EXAM_MAPPING_QUESTIONS_PER_CHARGE} новых вопросов`,
  },
  { what: 'Подкаст по лекции', units: AI_COSTS.conversation, note: 'два ведущих обсуждают лекцию' },
  { what: '«Поговорить о лекции»', units: AI_COSTS.tutorTurn, note: 'за каждый ответ репетитора' },
  { what: 'Выжимка лекции', units: AI_COSTS.cheatsheet, more: true },
  { what: 'Схемы к подкасту', units: AI_COSTS.visuals, more: true },
  { what: 'Работа над ошибками', units: AI_COSTS.mistakesPractice, more: true },
  { what: 'Оценки по фото', units: AI_COSTS.gradebookScan, more: true },
  {
    what: 'Раздел анализа заново',
    units: AI_COSTS.analysisSection,
    note: 'раздел, который не получился при анализе, — бесплатно',
    more: true,
  },
  {
    what: 'Разбор сложных мест файла с вопросами',
    units: AI_COSTS.importAI,
    note: `за каждые ${IMPORT_AI_QUESTIONS_PER_CHARGE} вопросов, отправленных модели`,
    more: true,
  },
];

function CostRows({ rows }: { rows: ReadonlyArray<(typeof LIMIT_COSTS)[number]> }) {
  return (
    <dl className="ac-costs">
      {rows.map((row) => (
        <div key={row.what} className="ac-cost">
          <dt>
            {row.what}
            {row.note ? <small>{row.note}</small> : null}
          </dt>
          <dd>{row.units}</dd>
        </div>
      ))}
    </dl>
  );
}

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
            <p className="ac-modal-p ac-limit-free">{WITHOUT_UNITS}</p>
            {isPro ? null : <p className="ac-limit-pro">С PRO — {unitsPerDay(PRO_DAILY_UNITS)}.</p>}
          </div>

          <div className="ac-limit-prices">
            <p className="ac-modal-p ac-costs-h">Единицы списываются, когда Meldy обращается к ИИ:</p>
            <CostRows rows={LIMIT_COSTS.filter((row) => !row.more)} />
            <details className="ac-costs-more">
              <summary>Ещё: выжимка, схемы, работа над ошибками, оценки по фото</summary>
              <CostRows rows={LIMIT_COSTS.filter((row) => row.more)} />
            </details>
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
