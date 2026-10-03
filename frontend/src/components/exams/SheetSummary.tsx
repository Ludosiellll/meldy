import { useEffect, useState } from 'react';
import type { TicketLayout } from '../../api/exams';
import type { Readiness } from '../../lib/learning/readiness';
import { READINESS_LABELS } from '../../lib/learning/readiness';
import { percent, type LayoutShares } from '../../lib/exams/ticketMath';
import { pluralRu } from '../conversation/visuals';
import { TextMark } from '../marks';
import HowCalculated from './HowCalculated';
import { READINESS_MARK } from './marks';
import {
  CONFIRMED_MEANING,
  NBSP,
  glue,
  NO_ANSWERS_SENTENCE,
  allQuestionsWord,
  caveatSentence,
  confidenceSentence,
  confirmedSentence,
  pct,
  perTicketOf,
  shareText,
  unmappedSentence,
  unverifiedSentence,
  type AnswerSummary,
  type CoverageCounts,
  type RatingCounts,
  type SheetFilter,
} from './sheetModel';

export interface Confidence {
  ratedKnow: number;
  ratedKnowAnswered: number;
  ratedKnowPassed: number;
  enoughData: boolean;
}

/** Where the answer history (the journal) is: nothing about answers is stated until it is read. */
export type AnswersState = 'loading' | 'ready' | 'error';

export const ANSWERS_LOADING = 'Загружаем историю ответов…';
const LOADING_DELAY_MS = 300;

/** True once `active` has lasted `ms` (redesign spec 4.6: the first 300 ms show nothing). */
export function useShownAfter(active: boolean, ms: number = LOADING_DELAY_MS): boolean {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    if (!active) {
      setShown(false);
      return;
    }
    const timer = window.setTimeout(() => setShown(true), ms);
    return () => window.clearTimeout(timer);
  }, [active, ms]);
  return active && shown;
}

interface CoverageSummaryProps {
  counts: CoverageCounts;
  /** A mapping run is going: the shares wait until it ends. */
  checking: { checked: number; total: number } | null;
  shares: LayoutShares;
  layout: TicketLayout;
  howOpen: boolean;
  onHow: () => void;
  howId: string;
  onRecheck: (() => void) | null;
  /**
   * Phones and tablets: only the pair, one line «Это доля билетов, а не вероятность сдать. Как
   * считается» and nothing else above the sheet, so the paper starts on the first screen.
   */
  compact?: boolean;
}

/** The short caveat of the compact column; the full assumption is in «Как считается». */
export const SHORT_CAVEAT = 'Это доля билетов, а не вероятность сдать.';

function questionsSub(counts: CoverageCounts): string {
  const parts = [`частично — ${counts.partial}`, `нет ни в одной — ${counts.none}`];
  if (counts.unverified > 0) parts.push(`только по словам — ${counts.unverified}`);
  const unmarked = counts.unmapped + counts.checking;
  if (unmarked > 0) parts.push(`не сверено — ${unmarked}`);
  return `${counts.full} из ${counts.total} · ${parts.join(', ')}`;
}

/** The pair «60 % вопросов → 35 % билетов», the caveat, «Как считается» and the unverified range. */
export function CoverageSummary({ counts, checking, shares, layout, howOpen, onHow, howId, onRecheck, compact = false }: CoverageSummaryProps) {
  const mapped = counts.full + counts.partial + counts.none + counts.unverified;
  if (counts.total === 0) return null;
  if (checking || counts.checking > 0) {
    return (
      <div className="ex-summary">
        <p className="ex-stmt">
          {checking ? glue(`Разметка идёт: проверено ${checking.checked} из ${checking.total}.`) : 'Разметка идёт.'}
        </p>
        <p className="ex-fine">Доли вопросов и билетов появятся, когда разметка закончится. Пометки встают на поле по мере проверки.</p>
      </div>
    );
  }
  if (mapped === 0) {
    return (
      <div className="ex-summary">
        <p className="ex-stmt">Вопросы ещё не сверены с лекциями.</p>
        <p className="ex-fine">Доля билетов появится после разметки: Meldy отметит, какие вопросы есть в ваших лекциях.</p>
      </div>
    );
  }
  const low = shares.low;
  const questionShare = pct(counts.total > 0 ? Math.round((counts.full / counts.total) * 100) : 0);
  const single = low.ok && low.mode === 'random' && low.q <= 1;
  const q = perTicketOf(low, layout.per_ticket);
  const all = shareText(shares, 'all');
  const any = shareText(shares, 'atLeastOne');
  // A range («35–41 %») does not fit beside its label: then both pairs stack the same way.
  const stacked = (all ?? '').length > 5 ? '' : undefined;
  return (
    <div className="ex-summary">
      <div className="ex-pair" data-first="" data-wide={stacked}>
        <p className="ex-big">{questionShare}</p>
        <p className="ex-lbl">вопросов есть в ваших лекциях</p>
        <p className="ex-sub">{glue(questionsSub(counts))}</p>
      </div>
      {low.ok && !single && (
        <div className="ex-pair" data-wide={stacked}>
          <p className="ex-big">{all}</p>
          {low.mode === 'fixed' ? (
            <>
              <p className="ex-lbl">билетов, где все вопросы есть в лекциях</p>
              <p className="ex-sub">{glue(`${low.allCount} из ${low.tickets} · хотя бы один — ${low.anyCount} из ${low.tickets}`)}</p>
            </>
          ) : (
            <>
              <p className="ex-lbl">билетов, где {allQuestionsWord(q)} есть в лекциях</p>
              <p className="ex-sub">{glue(`хотя бы один — ${any}`)}</p>
            </>
          )}
        </div>
      )}
      {single && <p className="ex-fine">Билет — один вопрос, поэтому доля билетов та же.</p>}
      {!low.ok && <p className="ex-fine">{low.reason}</p>}
      {!compact && <p className="ex-caveat">{glue(caveatSentence(shares, counts.total))}</p>}
      {counts.unmapped > 0 && <p className="ex-fine">{glue(unmappedSentence(counts.unmapped, shares))}</p>}
      {counts.unverified > 0 && (
        <p className="ex-fine">
          {glue(unverifiedSentence(counts.unverified, shares))}
          {onRecheck && (
            <>
              {' '}
              <button type="button" className="sf-link" onClick={onRecheck}>
                Проверить снова
              </button>
            </>
          )}
        </p>
      )}
      <HowCalculated shares={shares} open={howOpen} onToggle={onHow} id={howId} lead={compact ? SHORT_CAVEAT : undefined} />
    </div>
  );
}

interface ReadinessBlockProps {
  summary: AnswerSummary;
  confirmedShares: LayoutShares;
  perTicket: number;
  confidence: Confidence;
  answers: AnswersState;
  answersError: string | null;
  filter: SheetFilter;
  onFilter: (filter: SheetFilter) => void;
  onRateMode: () => void;
  /**
   * 'all' in the column next to the sheet. On phones the column is split: 'head' («Подтверждено
   * ответами — 6 из 40.») stays above the sheet, 'rest' (what it means, the readiness legend and
   * confidence vs answers) goes under it.
   */
  part?: 'all' | 'head' | 'rest';
}

const READINESS_ORDER: Readiness[] = ['confirmed', 'once', 'not_passed', 'untested'];

function LegendNumber({ readiness }: { readiness: Readiness }) {
  const kind = READINESS_MARK[readiness];
  if (!kind)
    return (
      <span className="ex-k" aria-hidden="true">
        12
      </span>
    );
  return (
    <span className="ex-k" aria-hidden="true">
      <TextMark kind={kind} seed={311 + READINESS_ORDER.indexOf(readiness) * 2} padX={6} padY={3} weight={kind === 'wave' ? 2.4 : undefined}>
        12
      </TextMark>
    </span>
  );
}

/**
 * «Подтверждено ответами — 6 из 40», the four readiness marks as filters, confidence vs answers.
 * While the journal is being read it says only that (after 300 ms): no counts, no «ответов ещё не
 * было», no confidence sentence; when it cannot be read, only why.
 */
export function ReadinessBlock(props: ReadinessBlockProps) {
  const part = props.part ?? 'all';
  const showLoading = useShownAfter(props.answers === 'loading');
  if (props.answers === 'loading') {
    if (part === 'rest') return null;
    return showLoading ? (
      <div className="ex-blk">
        <p className="ex-fine" role="status">
          {ANSWERS_LOADING}
        </p>
      </div>
    ) : null;
  }
  if (props.answers === 'error') {
    if (part === 'rest') return null;
    return (
      <div className="ex-blk">
        <p className="ex-fine">{props.answersError ?? 'Не удалось загрузить историю ответов.'}</p>
      </div>
    );
  }
  return <ReadinessSummary {...props} part={part} />;
}

function ReadinessSummary({ summary, confirmedShares, perTicket, confidence, filter, onFilter, onRateMode, part = 'all' }: ReadinessBlockProps) {
  const counts: Record<Readiness, number> = {
    confirmed: summary.confirmed,
    once: summary.once,
    not_passed: summary.notPassed,
    untested: summary.untested,
  };
  const sentence = confirmedSentence(summary);
  const confirmedTickets =
    summary.confirmed > 0 && confirmedShares.low.ok && confirmedShares.low.mode !== 'fixed' && perTicket > 1
      ? `Билетов, где подтверждены ${perTicket === 2 ? 'оба вопроса' : 'все вопросы'}, — ${pct(percent(confirmedShares.low.all))}.`
      : null;
  const head = part !== 'rest';
  const rest = part !== 'head';
  // «Подтверждено ответами — 6 из 40.» (17/25, the figure at 600): no date after the number.
  const statement = sentence ? (
    <p className="ex-stmt">
      Подтверждено ответами{NBSP}—{' '}
      <b>
        {summary.confirmed}
        {NBSP}из{NBSP}
        {summary.total}
      </b>
      .
    </p>
  ) : (
    <p className="ex-fine">{NO_ANSWERS_SENTENCE}</p>
  );
  return (
    <div className="ex-blk" data-part={part === 'all' ? undefined : part}>
      {head && statement}
      {rest && sentence ? (
        <>
          <p className="ex-fine">
            {CONFIRMED_MEANING}
            {confirmedTickets ? ` ${confirmedTickets}` : ''}
          </p>
          <ul className="ex-rl" aria-label="Показать вопросы по ответам">
            {READINESS_ORDER.map((readiness) => {
              const value: SheetFilter = `rd:${readiness}` as SheetFilter;
              const active = filter === value;
              return (
                <li key={readiness}>
                  <button type="button" aria-pressed={active} onClick={() => onFilter(active ? 'all' : value)}>
                    <LegendNumber readiness={readiness} />
                    <span className="ex-rl-word">{READINESS_LABELS[readiness]}</span>{' '}
                    <span className="ex-count">{counts[readiness]}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
      {rest && (
        <p className="ex-fine" style={{ marginTop: part === 'rest' && !sentence ? 0 : 12 }}>
          {glue(confidenceSentence(confidence))}{' '}
          <button type="button" className="sf-link" data-stage-hide="" onClick={onRateMode}>
            Самооценка
          </button>
        </p>
      )}
    </div>
  );
}

interface RateSummaryProps {
  counts: RatingCounts;
  confidence: Confidence;
  answers: AnswersState;
  answersError: string | null;
  filter: SheetFilter;
  onFilter: (filter: SheetFilter) => void;
  onDone: () => void;
}

/**
 * The column in self-rating mode: how the student rated the list; the numbers filter the sheet.
 * The earlier ratings live in the journal, so until it is read there are no counts to give.
 */
export function RateSummary({ counts, confidence, answers, answersError, filter, onFilter, onDone }: RateSummaryProps) {
  const showLoading = useShownAfter(answers === 'loading');
  const item = (value: SheetFilter, word: string, count: number) => {
    const active = filter === value;
    return (
      <>
        {glue(word)}
        {NBSP}—{NBSP}
        <button
          type="button"
          className="sf-link"
          aria-pressed={active}
          aria-label={`${word}: ${count}. Показать эти вопросы`}
          style={{ minHeight: 0, fontSize: 'inherit', fontWeight: 600, textDecorationThickness: active ? 2 : 1 }}
          onClick={() => onFilter(active ? 'all' : value)}
        >
          {count}
        </button>
      </>
    );
  };
  return (
    <div className="ex-ratecol" aria-live="polite">
      <p className="ex-why-t">Самооценка</p>
      {answers === 'ready' ? (
        <>
          <p className="ex-stmt" style={{ marginTop: 6 }}>
            {item('sr:know', 'Знаю', counts.know)}, {item('sr:unsure', 'плаваю', counts.unsure)}, {item('sr:dont_know', 'не знаю', counts.dont_know)}.{' '}
            {item('sr:none', 'Не отмечено', counts.none)}.
          </p>
          <p className="ex-fine">Отметка ставится одним касанием и на пометки по лекциям и ответам не влияет.</p>
          <p className="ex-stmt" style={{ marginTop: 14 }}>
            {glue(
              confidence.enoughData
                ? `Из ${confidence.ratedKnowAnswered} ${pluralRu(confidence.ratedKnowAnswered, ['вопроса', 'вопросов', 'вопросов'])} с отметкой «знаю», на которые вы ответили вслух, зачтено ${confidence.ratedKnowPassed}.`
                : confidenceSentence(confidence),
            )}
          </p>
        </>
      ) : answers === 'error' ? (
        <p className="ex-fine" style={{ marginTop: 6 }}>
          {answersError ?? 'Не удалось загрузить историю ответов.'}
        </p>
      ) : (
        showLoading && (
          <p className="ex-fine" role="status" style={{ marginTop: 6 }}>
            {ANSWERS_LOADING}
          </p>
        )
      )}
      <button type="button" className="sf-link" data-muted="" onClick={onDone}>
        Готово
      </button>
    </div>
  );
}

export interface PeakView {
  title: string;
  before: number | null;
  after: number;
  total: number | null;
  statement: string;
  fine: string[];
}

/** Peak 3: the number that changed after the answer just given, the old value struck out. */
export function PeakSummary({ peak, confidence, onClose }: { peak: PeakView; confidence: string | null; onClose: () => void }) {
  return (
    <div className="ex-peak" aria-live="polite">
      <p className="ex-why-t">{peak.title}</p>
      <p className="ex-big ex-peak-big" style={{ marginTop: 4 }}>
        {peak.before !== null && peak.before !== peak.after && (
          <>
            <s className="ex-was" aria-label={`было ${peak.before}`}>
              {peak.before}
            </s>{' '}
          </>
        )}
        {peak.after}
        {peak.total !== null && (
          <>
            {' '}
            <span className="ex-of">из</span> {peak.total}
          </>
        )}
      </p>
      <p className="ex-stmt" style={{ marginTop: 12 }}>
        {glue(peak.statement)}
      </p>
      {peak.fine.map((line) => (
        <p key={line} className="ex-fine" style={{ marginTop: 6 }}>
          {glue(line)}
        </p>
      ))}
      {confidence && (
        <p className="ex-fine" style={{ marginTop: 6 }}>
          {glue(confidence)}
        </p>
      )}
      <button type="button" className="sf-link" data-muted="" onClick={onClose}>
        Вся сводка
      </button>
    </div>
  );
}
