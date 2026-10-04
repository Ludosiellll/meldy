import { useEffect, useState } from 'react';
import type { TicketLayout } from '../../api/exams';
import type { Readiness } from '../../lib/learning/readiness';
import { READINESS_LABELS } from '../../lib/learning/readiness';
import { percent, type LayoutShares } from '../../lib/exams/ticketMath';
import { pluralRu } from '../conversation/visuals';
import { seedFrom, TextMark } from '../marks';
import HowCalculated from './HowCalculated';
import { READINESS_MARK } from './marks';
import { daysPhrase, type PeakGrowth } from './peak';
import {
  CONFIRMED_MEANING,
  NBSP,
  glue,
  NO_ANSWERS_SENTENCE,
  allQuestionsWord,
  caveatSentence,
  closePartialLine,
  confidenceSentence,
  confirmedSentence,
  noneFigureName,
  noneLabel,
  noneTicketsLine,
  pct,
  perTicketOf,
  questionShareText,
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

/** The short caveat of the compact column and of the low window; the full assumption is in «Как считается». */
export const SHORT_CAVEAT = 'Это доля билетов, а не вероятность сдать.';

interface CoverageSummaryProps {
  counts: CoverageCounts;
  /** A mapping run is going: the shares wait until it ends. */
  checking: { checked: number; total: number } | null;
  shares: LayoutShares;
  /** The same shares with every «частично» question closed: the action line under «Как считается». */
  closed?: LayoutShares | null;
  layout: TicketLayout;
  howOpen: boolean;
  onHow: () => void;
  howId: string;
  onRecheck: (() => void) | null;
  /** The sheet's filter: the figure of questions not in the lectures and «7 вопросов «частично»» set it. */
  filter?: SheetFilter;
  onFilter?: (filter: SheetFilter) => void;
  /** Draw the strike over the question share in (250 ms): only right after a mapping run on this page. */
  strikeLive?: boolean;
  /** Seeds the strike (the exam id), so it is the same stroke on every render. */
  seedKey?: string;
  /**
   * 'all' — the column beside the sheet (1024 px and wider): (a) the questions not in any lecture,
   * (b) the question share struck through beside the ticket share, (c) the tickets without «есть»,
   * the caveat, «Как считается» and the action line right under it.
   * 'head' — phones and tablets above the sheet: (a) and (b) side by side and one line «Это доля
   * билетов, а не вероятность сдать. Как считается», so the sheet starts on the first screen.
   * 'rest' — phones and tablets under the sheet: (c) and the action line.
   */
  part?: 'all' | 'head' | 'rest';
  /** @deprecated: part 'head'. */
  compact?: boolean;
}

/** «24 из 40 · частично — 7» (and the unknown questions): what the struck question share is made of. */
function questionsSub(counts: CoverageCounts, shares: LayoutShares): string {
  const parts = [`частично — ${counts.partial}`];
  if (counts.unverified > 0) parts.push(`только по словам — ${counts.unverified}`);
  const unmarked = counts.unmapped + counts.checking;
  if (unmarked > 0) parts.push(`не сверено — ${unmarked}`);
  const head = `${counts.full} из ${counts.total} · ${parts.join(', ')}`;
  const low = shares.low;
  // Known tickets are counted directly: say how many, next to the questions.
  if (low.ok && low.mode === 'fixed') return `${head} · ${low.allCount} из ${low.tickets} ${pluralRu(low.tickets, ['билета', 'билетов', 'билетов'])}`;
  return head;
}

/**
 * Peak 1 (Jury_Check item 10): it starts from the honest gap and ends with an action. Top to bottom:
 * (a) «9» at the size of the percentages, «вопросов нет ни в одной лекции» (the figure filters the
 * sheet); (b) «60 %» muted and struck through by pencil beside «35 %» in ink, «билетов, где оба
 * вопроса есть в лекциях», «24 из 40 · частично — 7»; (c) «в 15 % билетов нет ни одного вопроса с
 * отметкой «есть»»; the caveat; «Как считается» and right under it «Закройте 7 вопросов «частично» —
 * оба вопроса будут в лекциях в 60 % билетов.» Every number follows the exam's own ticket layout.
 */
export function CoverageSummary(props: CoverageSummaryProps) {
  const { counts, checking, shares, layout, howOpen, onHow, howId, onRecheck } = props;
  const part = props.part ?? (props.compact ? 'head' : 'all');
  const filter = props.filter ?? 'all';
  const onFilter = props.onFilter;
  const mapped = counts.full + counts.partial + counts.none + counts.unverified;
  if (counts.total === 0) return null;
  if (checking || counts.checking > 0) {
    if (part === 'rest') return null;
    return (
      <div className="ex-summary">
        <p className="ex-stmt">
          {checking ? glue(`Сверка с лекциями идёт: проверено ${checking.checked} из ${checking.total}.`) : 'Сверка с лекциями идёт.'}
        </p>
        <p className="ex-fine">Доли вопросов и билетов появятся, когда сверка закончится. Пометки встают на поле по мере проверки.</p>
      </div>
    );
  }
  if (mapped === 0) {
    if (part === 'rest') return null;
    // «Вопросы ещё не сверены с лекциями.» is already the note under the header (redesign critique 7).
    return (
      <div className="ex-summary">
        <p className="ex-stmt">Доля билетов появится после сверки с лекциями: Meldy отметит, какие вопросы есть в ваших лекциях.</p>
      </div>
    );
  }

  const low = shares.low;
  const questionShare = questionShareText(counts);
  const single = low.ok && (low.mode === 'random' || low.mode === 'sections') && low.q <= 1;
  const q = perTicketOf(low, layout.per_ticket);
  const ticketShare = low.ok && !single ? shareText(shares, 'all') : null;
  // The question share is struck out only when a ticket share replaces it and says something else.
  const strike = ticketShare !== null && ticketShare !== questionShare;
  const ranged = questionShare.includes('–') || (ticketShare ?? '').includes('–');
  const ticketLabel =
    low.ok && low.mode === 'fixed' ? 'билетов, где все вопросы есть в лекциях' : `билетов, где ${allQuestionsWord(q)} есть в лекциях`;
  const noneLine = noneTicketsLine(shares);
  const action = props.closed ? closePartialLine(counts.partial, shares, props.closed) : null;
  const toggle = (value: SheetFilter) => onFilter?.(filter === value ? 'all' : value);

  const actionLine = action ? (
    <p className="ex-act">
      Закройте{' '}
      <button type="button" className="sf-link ex-act-link" aria-pressed={filter === 'cov:partial'} onClick={() => toggle('cov:partial')}>
        {glue(action.link)}
      </button>{' '}
      {glue(action.rest)}
    </p>
  ) : null;

  if (part === 'rest') {
    if (!noneLine && !actionLine) return null;
    return (
      <div className="ex-summary" data-part="rest">
        {noneLine && <p className="ex-gapline">{glue(noneLine)}</p>}
        {actionLine}
      </div>
    );
  }

  const compact = part === 'head';
  // (a) the questions that are in no lecture: the figure filters the sheet to them.
  const gap =
    counts.none > 0 ? (
      <div className="ex-pair ex-gap">
        <button
          type="button"
          className="ex-big ex-gap-n"
          aria-pressed={filter === 'cov:none'}
          aria-label={noneFigureName(counts.none)}
          onClick={() => toggle('cov:none')}
        >
          {counts.none}
        </button>
        <p className="ex-lbl" aria-hidden="true">
          {noneLabel(counts.none)}
        </p>
      </div>
    ) : null;

  // (b) the question share, struck through beside the ticket share, or alone for one question per ticket.
  const share = ticketShare !== null ? (
    <div className="ex-pair ex-share" data-strike={strike ? '' : undefined}>
      <p className="ex-big ex-figs" data-range={ranged ? '' : undefined}>
        {strike && (
          <>
            {/* The struck figure says what it was: the share of questions, not an older share of tickets. */}
            <span className="ex-figs-wasbox">
              <span className="ex-figs-was" aria-hidden="true">
                <TextMark kind="strike" seed={seedFrom(props.seedKey ?? 'exam', 'strike')} animate={Boolean(props.strikeLive)}>
                  {questionShare}
                </TextMark>
              </span>
              <span className="ex-figs-was-l" aria-hidden="true">
                вопросов
              </span>
            </span>
            <span className="ex-sr">{`вместо ${questionShare} вопросов — `}</span>
          </>
        )}
        <span className="ex-figs-now">{ticketShare}</span>
      </p>
      <p className="ex-lbl">{ticketLabel}</p>
      <p className="ex-sub">{glue(questionsSub(counts, shares))}</p>
    </div>
  ) : (
    <div className="ex-pair ex-share">
      <p className="ex-big ex-figs" data-range={questionShare.includes('–') ? '' : undefined}>
        <span className="ex-figs-now">{questionShare}</span>
      </p>
      <p className="ex-lbl">вопросов есть в ваших лекциях</p>
      <p className="ex-sub">{glue(questionsSub(counts, shares))}</p>
    </div>
  );

  const caveat = glue(caveatSentence(shares, counts.total));
  const pairs = (gap ? 1 : 0) + 1;
  return (
    <div className="ex-summary" data-part={part}>
      <div className="ex-pairs" data-compact={compact ? '' : undefined} data-count={pairs}>
        {gap}
        {share}
      </div>
      {single && <p className="ex-fine">Билет — один вопрос, поэтому доля билетов та же.</p>}
      {!low.ok && <p className="ex-fine">{low.reason}</p>}
      {!compact && noneLine && <p className="ex-gapline">{glue(noneLine)}</p>}
      {!compact && (
        <>
          {/* The low window (1280×720) may show the short caveat; the whole assumption then opens the formula. */}
          <p className="ex-caveat" data-full="">
            {caveat}
          </p>
          <p className="ex-caveat" data-short="" aria-hidden="true">
            {SHORT_CAVEAT}
          </p>
        </>
      )}
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
      <HowCalculated
        shares={shares}
        open={howOpen}
        onToggle={onHow}
        id={howId}
        lead={compact ? SHORT_CAVEAT : undefined}
        after={compact ? undefined : actionLine}
        assumption={compact ? undefined : caveat}
        unknown={{ unverified: counts.unverified, unmapped: counts.unmapped + counts.checking }}
      />
    </div>
  );
}

interface ReadinessBlockProps {
  summary: AnswerSummary & { stale?: number };
  confirmedShares: LayoutShares;
  perTicket: number;
  confidence: Confidence;
  answers: AnswersState;
  answersError: string | null;
  filter: SheetFilter;
  onFilter: (filter: SheetFilter) => void;
  onRateMode: () => void;
  /** «С 1 октября: 0 → 7 за 3 дня.» when something is confirmed and the history spans more than a day. */
  growth?: string | null;
  /** «Пора проверить: 2 — подтверждены больше 14 дней назад.» */
  staleLine?: string | null;
  /** «Второй ответ после разбора: …» (15 px here). */
  secondAnswer?: string | null;
  /**
   * 'all' in the column next to the sheet. On phones the column is split: 'head' («Подтверждено
   * ответами — 6 из 40.») stays above the sheet, 'rest' (what it means, the readiness legend and
   * confidence vs answers) goes under it.
   */
  part?: 'all' | 'head' | 'rest';
}

const READINESS_ORDER: Readiness[] = ['confirmed', 'once', 'not_passed', 'untested'];

/** «12» in the number circle of the sheet, filled and marked as the sheet marks that readiness. */
function LegendNumber({ readiness }: { readiness: Readiness }) {
  const kind = READINESS_MARK[readiness];
  if (!kind)
    return (
      <span className="ex-k" data-readiness={readiness} aria-hidden="true">
        <span className="ex-k-n">12</span>
      </span>
    );
  return (
    <span className="ex-k" data-readiness={readiness} aria-hidden="true">
      <TextMark
        kind={kind}
        seed={311 + READINESS_ORDER.indexOf(readiness) * 2}
        className="ex-k-n"
        padX={kind === 'ring' ? 4 : undefined}
        padY={kind === 'ring' ? 4 : undefined}
        dy={kind === 'ring' ? undefined : 4}
        weight={kind === 'wave' ? 2.4 : undefined}
      >
        12
      </TextMark>
    </span>
  );
}

/**
 * «Подтверждено ответами — 6 из 40», the growth from history, what is «пора проверить», the four
 * readiness marks as filters, confidence vs answers. While the journal is being read it says only
 * that (after 300 ms): no counts, no «ответов ещё не было», no confidence sentence; when it cannot be
 * read, only why.
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

/** «Билетов, где подтверждены оба вопроса, — 3 %.» — a small line, never a big figure. */
export function confirmedTicketsLine(summary: Pick<AnswerSummary, 'confirmed'>, shares: LayoutShares, perTicket: number): string | null {
  if (summary.confirmed <= 0 || !shares.low.ok || shares.low.mode === 'fixed' || perTicket <= 1) return null;
  return `Билетов, где подтверждены ${perTicket === 2 ? 'оба вопроса' : 'все вопросы'}, — ${pct(percent(shares.low.all))}.`;
}

function ReadinessSummary({
  summary,
  confirmedShares,
  perTicket,
  confidence,
  filter,
  onFilter,
  onRateMode,
  growth,
  staleLine,
  secondAnswer,
  part = 'all',
}: ReadinessBlockProps) {
  const counts: Record<Readiness, number> = {
    confirmed: summary.confirmed,
    once: summary.once,
    not_passed: summary.notPassed,
    untested: summary.untested,
  };
  const sentence = confirmedSentence(summary);
  const confirmedTickets = confirmedTicketsLine(summary, confirmedShares, perTicket);
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
          {growth && <p className="ex-stmt ex-growth">{glue(growth)}</p>}
          {staleLine && <p className="ex-fine ex-stale">{glue(staleLine)}</p>}
          <p className="ex-fine">
            {CONFIRMED_MEANING}
            {confirmedTickets ? ` ${glue(confirmedTickets)}` : ''}
          </p>
          {secondAnswer && <p className="ex-fine ex-second">{glue(secondAnswer)}</p>}
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
                ? `Из ${confidence.ratedKnowAnswered} ${pluralRu(confidence.ratedKnowAnswered, ['вопроса', 'вопросов', 'вопросов'])} с отметкой «знаю», на которые вы ответили, засчитано ${confidence.ratedKnowPassed}.`
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
  /** «0 → 7 за 3 дня · +1 сегодня» when something is confirmed now; null keeps the count of the transition. */
  growth?: PeakGrowth | null;
  /** «Второй ответ после разбора: …» (18 px in the peak column). */
  second?: string | null;
}

/**
 * «Подтверждено ответами: 7 из 40, было 6.» — the sentence a screen reader hears, and the line under the
 * scrolled-to row on a phone, where the column above the sheet is out of view (redesign critique 10).
 */
export function peakCountLine(peak: PeakView): string {
  const now = `${peak.after}${peak.total !== null ? ` из ${peak.total}` : ''}`;
  const was = peak.before !== null && peak.before !== peak.after ? `, было ${peak.before}` : '';
  return `${peak.title}: ${now}${was}.`;
}

/** «Подтверждено ответами: от 0 до 7 из 40 за 3 дня, плюс 1 сегодня.» — the growth line in words. */
export function peakGrowthSpoken(growth: PeakGrowth): string {
  const days = growth.days > 0 ? ` ${daysPhrase(growth.days)}` : '';
  const today = growth.today > 0 ? `, плюс ${growth.today} сегодня` : '';
  return `Подтверждено ответами: от 0 до ${growth.to} из ${growth.total}${days}${today}.`;
}

/**
 * Peak 3. When something is confirmed now, the big line is the growth from history, «0 → 7», with
 * «за 3 дня» and the net change of the day «+1 сегодня» (only when positive) — also after a 3, so a
 * bad answer still shows the way so far; never «0 → 0»: with nothing confirmed the column keeps the
 * count of the transition, «3», and beside it «было 2» (a struck-out 0 read as «ø», redesign
 * critique 2). Then the statement about the answer just given and «Второй ответ после разбора» at
 * 18 px, and «Подтверждено — значит, засчитано дважды, в разные дни.» with the share of tickets.
 */
export function PeakSummary({ peak, confidence, onClose }: { peak: PeakView; confidence: string | null; onClose: () => void }) {
  const was = peak.before !== null && peak.before !== peak.after ? peak.before : null;
  const growth = peak.growth && peak.growth.to > 0 ? peak.growth : null;
  const confirmTitle = peak.title === 'Подтверждено ответами';
  return (
    <div className="ex-peak" aria-live="polite">
      <p className="ex-why-t">{peak.title}</p>
      {growth ? (
        <>
          <p className="ex-big ex-peak-big" style={{ marginTop: 4 }}>
            <span className="ex-sr">{`${peakCountLine(peak)} ${peakGrowthSpoken(growth)}`}</span>
            <span className="ex-now" aria-hidden="true">
              0{NBSP}→{NBSP}
              {growth.to} <span className="ex-of">из {growth.total}</span>
            </span>
          </p>
          <p className="ex-peak-growth" aria-hidden="true">
            {!confirmTitle && <span>подтверждено</span>}
            {growth.days > 0 && <span>{daysPhrase(growth.days)}</span>}
            {growth.today > 0 && <b>+{growth.today} сегодня</b>}
          </p>
        </>
      ) : (
        <p className="ex-big ex-peak-big" style={{ marginTop: 4 }}>
          <span className="ex-sr">{peakCountLine(peak)}</span>
          <span className="ex-now" aria-hidden="true">
            {peak.after}
            {peak.total !== null && (
              <>
                {' '}
                <span className="ex-of">из</span> {peak.total}
              </>
            )}
          </span>
          {was !== null && (
            <span className="ex-was" aria-hidden="true">
              было {was}
            </span>
          )}
        </p>
      )}
      <p className="ex-stmt ex-peak-stmt">{glue(peak.statement)}</p>
      {peak.second && <p className="ex-stmt ex-peak-stmt">{glue(peak.second)}</p>}
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
