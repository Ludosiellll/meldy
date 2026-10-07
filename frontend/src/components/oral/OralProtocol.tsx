import { useId, useRef, useState, type ReactNode } from 'react';
import { Mark, seedFrom, type MarkKind } from '../marks';
import { ZAVTRA } from '../landing/zavtraPath';
import { UnderlinedText, quoteText } from './RubricSlots';
import { STATUS_WORDS, countsSentence, type FollowupStatus, type PointStatus } from '../../lib/oral/oralGrade';
import { answerSummary, summaryLine } from '../../lib/oral/answerSummary';
import { fragmentsLabel, pointSource } from '../../lib/oral/oralPersistence';
import type { Evaluation, Rubric } from '../../lib/oral/oralApi';
import type { StoredProtocol } from '../../lib/oral/ticketData';
import { glue } from '../../lib/oral/format';
import { sharedGroups } from '../../lib/oral/rubricMatch';

/**
 * The one small line of the result (Ф1, 2026-10-07): the department reads a «5 · отлично» as a foreign
 * 5-point scale (Belarus grades on 10), so the screen shows no grade and says who grades.
 *
 * A word joiner (U+2060) after the hyphen keeps «10-балльной» on one line (on a 360–414 px phone it broke
 * as «10-» / «балльной»): it draws nothing and allows no break beside it. Onest has no non-breaking
 * hyphen (U+2011), which would come from another font.
 */
export const SCALE_NOTE = 'Отметку ставит преподаватель по 10-\u2060балльной шкале. Meldy проверяет только, назвали ли вы пункты из своих лекций.';

/** The start of an essential point's status line: the weight-2 points are marked on the sheet. */
export const MAIN_POINT = 'главный пункт';

/** The «Пункт 4 не назван…» line scrolls to the point this long (instantly under reduced motion). */
export const ASKED_SCROLL_MS = 400;

/** One point of a protocol, the same for a fresh answer and for a saved one. */
export interface ProtocolPoint {
  id: string;
  number: number;
  title: string;
  essential: boolean;
  status: PointStatus;
  studentQuote: string;
  comment: string;
  corrections: string[];
  sourceQuote: string;
  /** «Нейронные сети», фрагмент 12 */
  sourceLabel: string;
  /** фрагмент 12 */
  fragments: string;
  anchors: string[][];
  /** Named by key words during the answer (saved as points[].live): the preliminary marks and the key-word line. */
  live: boolean;
}

export interface ProtocolFollowup {
  pointId: string;
  question: string;
  /** What the student answered; «не знаю» when the button was pressed, '' when nothing was heard. */
  answer: string;
  status: FollowupStatus;
  /**
   * keywords: the quick check did not answer and the browser's key-word rule decided — the status
   * is shown as such. A saved protocol does not know it (the save keeps only the status).
   */
  judgedBy?: 'check' | 'keywords' | null;
}

export function livePoints(rubric: Rubric, evaluation: Evaluation | null, live: ReadonlySet<string> = new Set()): ProtocolPoint[] {
  const evaluated = new Map((evaluation?.points ?? []).map((point) => [point.id, point]));
  return rubric.points.map((point, index) => {
    const result = evaluated.get(point.id);
    const source = pointSource(point, rubric);
    return {
      id: point.id,
      number: index + 1,
      title: point.title,
      essential: point.essential,
      status: result?.status ?? 'unrated',
      studentQuote: result?.student_quote ?? '',
      comment: result?.comment ?? '',
      corrections: (evaluation?.errors ?? []).filter((error) => error.point_id === point.id).map((error) => error.correction),
      sourceQuote: point.source_quote,
      sourceLabel: source.label,
      fragments: source.fragments,
      anchors: point.anchors,
      live: live.has(point.id),
    };
  });
}

export function storedPoints(protocol: StoredProtocol, anchors: Record<string, string[][]>): ProtocolPoint[] {
  return protocol.points.map((point, index) => ({
    id: point.id,
    number: index + 1,
    title: point.title,
    essential: point.essential,
    status: point.status,
    studentQuote: point.student_quote,
    comment: point.comment,
    corrections: protocol.errors.filter((error) => error.point_id === point.id).map((error) => error.correction),
    sourceQuote: point.source_quote,
    sourceLabel: point.source_label,
    fragments: fragmentsLabel(point.source_ids),
    anchors: anchors[point.id] ?? [],
    live: point.live,
  }));
}

const MARKS: Partial<Record<PointStatus, MarkKind>> = { covered: 'tick', partial: 'cup', missing: 'dash', wrong: 'cross' };

/**
 * «Вы: в ответе не прозвучало» only where the status does not say the point was said: next to «упомянут»,
 * «раскрыт» or «ошибка» without a quote it contradicted the line above (live run of release 29.1: an answer that
 * was a list of terms, every point «упомянут», no quote of the student's). The comment says what was there.
 */
export function saidNothing(status: PointStatus): boolean {
  return status === 'missing' || status === 'unrated';
}

/** What the reply to the examiner's question did for the point: the words of the point lines, no verdict on the answer. */
const FOLLOWUP_WORDS: Record<FollowupStatus, string> = {
  covered: 'пункт назван',
  partial: 'пункт упомянут',
  missing: 'пункт не назван',
  wrong: 'сказано неверно',
};

/** «пункт упомянут», or «по ключевым словам пункт упомянут» when the browser's rule decided. */
function followupVerdict(followup: ProtocolFollowup): string {
  const word = FOLLOWUP_WORDS[followup.status];
  return followup.judgedBy === 'keywords' ? `по ключевым словам ${word}` : word;
}

/** The point's line about the follow-up: «на вопрос экзаменатора — «не знаю»» (redesign spec 5.12). */
function askedLine(followup: ProtocolFollowup): string {
  if (!followup.answer.trim()) return 'на вопрос экзаменатора ответа не прозвучало';
  const said = `на вопрос экзаменатора — «${followup.answer}»`;
  return followup.judgedBy === 'keywords' ? `${said}, ${followupVerdict(followup)}` : said;
}

/** «ответ: не знаю.», «ответ: «…», пункт упомянут.» or «ответа не прозвучало.» */
function extraLine(followup: ProtocolFollowup): string {
  if (followup.answer === 'не знаю') return 'ответ: не знаю.';
  if (!followup.answer.trim()) return 'ответа не прозвучало.';
  return `ответ: «${followup.answer}», ${followupVerdict(followup)}.`;
}

/** The lecture's title in a source label «"Нейронные сети", фрагмент 12», or '' when it has none. */
export function lectureTitleOf(label: string): string {
  return /^«([^»]*)»/.exec(label.trim())?.[1]?.trim() ?? '';
}

/**
 * «Лекция «Нейронные сети», фрагмент 12» on the lecture's first mention in a protocol, «Лекция,
 * фрагмент 13» after it (redesign critique 4, round 2 — the same rule as «там же» on the sheet).
 */
function lectureCaption(label: string, fragments: string, named: boolean): string {
  const clean = label.trim();
  if (named && clean.startsWith('«')) return `Лекция ${clean}`;
  if (named && clean) return clean;
  return `Лекция${fragments ? `, ${fragments}` : ''}`;
}

/**
 * The label in front of a lecture quote: «Лекция «Нейронные сети», фрагмент 12:» where the lecture
 * is named for the first time on the sheet (an exam has many lectures: QA s35), «Лекция, фрагмент 13:»
 * for the next quotes from it. A rubric that knows no lecture title says «Лекция, фрагмент 12:».
 */
export function quoteLabel(point: Pick<ProtocolPoint, 'sourceLabel' | 'fragments'>, named = true): string {
  return `${lectureCaption(point.sourceLabel, point.fragments, named)}:`;
}

/**
 * For each point, whether its quote names the lecture: the «там же» rule of the exam sheet, against
 * the quote right above (QA r3 #1). A quote names its lecture unless the point right above showed a
 * quote from the same lecture; a point without a quote resets it. So a quote never follows another
 * lecture's quote without its own lecture's name, even when the points of two lectures alternate.
 */
export function lectureMentions(points: Array<Pick<ProtocolPoint, 'sourceLabel' | 'sourceQuote'>>): boolean[] {
  let previous: string | null = null;
  return points.map((point) => {
    if (!point.sourceQuote) {
      previous = null;
      return false;
    }
    const title = lectureTitleOf(point.sourceLabel);
    const named = title !== '' && title !== previous;
    previous = title;
    return named;
  });
}

/**
 * Why a point's key-word mark and the model's status differ (Jury_Check item 7), or null when they
 * agree. It speaks of key words and of the check, never of marks on screen: an answer given with the
 * marks hidden (exam mode) has the same saved key-word result.
 */
export function keywordNote(live: boolean, status: PointStatus): string | null {
  if (live && (status === 'partial' || status === 'missing' || status === 'wrong')) {
    return `По ключевым словам пункт назван; проверка по всему ответу: ${STATUS_WORDS[status]}.`;
  }
  if (!live && (status === 'covered' || status === 'partial')) {
    return `По ключевым словам пункт не назван; проверка по всему ответу: ${STATUS_WORDS[status]}.`;
  }
  return null;
}

/**
 * The line under the sheet's header that says why the examiner asked, so the asked point is clear
 * above the fold (redesign critique 4, round 2): «Пункт 4 не назван — о нём спросил экзаменатор.»
 */
export function askedNote(number: number, status: PointStatus): string {
  if (status === 'missing') return `Пункт ${number} не назван — о нём спросил экзаменатор.`;
  if (status === 'wrong') return `В пункте ${number} ошибка — о ней спросил экзаменатор.`;
  if (status === 'partial') return `Пункт ${number} упомянут не полностью — о нём спросил экзаменатор.`;
  return `О пункте ${number} спросил экзаменатор.`;
}

function PointRow({
  point,
  followup,
  seed,
  preliminary,
  animate,
  namesLecture,
}: {
  point: ProtocolPoint;
  followup: ProtocolFollowup | null;
  seed: string;
  preliminary: boolean;
  animate: boolean;
  /** The quote right above is from another lecture (or there is none): this quote names its lecture. */
  namesLecture: boolean;
}) {
  const markSeed = seedFrom(seed, point.id);
  const asked = followup && followup.pointId === point.id ? followup : null;
  const main = point.essential ? `${MAIN_POINT} · ` : '';
  if (preliminary) {
    return (
      <li className="or-ppt" data-point={point.id}>
        {/* Named by key words only: the provisional pencil dot of the answer sheet, never a tick. */}
        <span className="or-pt-m">{point.live ? <Mark kind="dot" seed={markSeed} /> : null}</span>
        <span className="or-pt-n" aria-hidden="true">
          {point.number}
        </span>
        <div className="or-ppt-body">
          <p className="or-ppt-t">{point.title}</p>
          <p className="or-ppt-st">{`${main}${point.live ? 'по ключевым словам назван' : 'по ключевым словам не назван'}`}</p>
          {point.sourceQuote ? (
            <p className="or-q2">
              <span className="or-q2-label">{glue(quoteLabel(point, namesLecture))}</span>
              «<UnderlinedText text={quoteText(point.sourceQuote)} anchors={point.anchors} seed={markSeed + 31} />»
            </p>
          ) : null}
        </div>
      </li>
    );
  }
  const kind = MARKS[point.status];
  const word = STATUS_WORDS[point.status];
  // The same words are underlined in «Вы» and in the lecture: what the point was counted for.
  const shared = sharedGroups(point.anchors, point.studentQuote, point.sourceQuote);
  const underDelay = (point.number - 1) * 60;
  const statusLine = asked ? (
    <>{`${main}${word}; ${askedLine(asked)}`}</>
  ) : point.fragments && (point.status === 'covered' || point.status === 'partial') ? (
    <>
      {main}
      {/* «фрагмент 12» never breaks before its number (a phone's narrow sheet). */}
      {word} · <span className="sf-pnote">{point.fragments.replace(/ (?=\d)/g, '\u00a0')}</span>
    </>
  ) : (
    <>{`${main}${word}`}</>
  );
  // The key-word mark said one thing, the check of the whole answer another: say so (Jury_Check item 7).
  const why = keywordNote(point.live, point.status);
  const showComment = Boolean(point.comment) && point.status !== 'unrated' && (point.status !== 'covered' || why !== null);
  return (
    // The asked point takes the focus from the line under the sheet's header («Пункт 4 не назван…»).
    <li className="or-ppt" data-point={point.id} data-status={point.status} data-asked={asked ? '' : undefined} tabIndex={asked ? -1 : undefined}>
      <span className="or-pt-m">
        {kind ? <Mark kind={kind} seed={markSeed} animate={animate} delayMs={(point.number - 1) * 60} /> : null}
        <span className="sr-only">{word}</span>
      </span>
      <span className="or-pt-n" aria-hidden="true">
        {point.number}
      </span>
      <div className="or-ppt-body">
        <p className="or-ppt-t">{point.title}</p>
        <p className="or-ppt-st">{statusLine}</p>
        {why ? <p className="or-ppt-why">{why}</p> : null}
        {showComment ? <p className="or-ppt-cm sf-pnote">{point.comment}</p> : null}
        {point.corrections.map((correction, index) => (
          <p key={index} className="or-ppt-cm sf-pnote">
            Поправка: {correction}
          </p>
        ))}
        {point.studentQuote ? (
          <p className="or-q2">
            <span className="or-q2-label">Вы:</span>
            <>
              «<UnderlinedText text={point.studentQuote} anchors={point.anchors} groups={shared} seed={markSeed + 17} animate={animate} delayMs={underDelay} />»
            </>
          </p>
        ) : saidNothing(point.status) ? (
          <p className="or-q2">
            <span className="or-q2-label">Вы:</span>
            <span className="or-q2-none">в ответе не прозвучало</span>
          </p>
        ) : null}
        {point.sourceQuote ? (
          point.status === 'covered' ? (
            <p className="or-q2">
              <span className="or-q2-label">{glue(quoteLabel(point, namesLecture))}</span>
              «<UnderlinedText text={quoteText(point.sourceQuote)} anchors={point.anchors} groups={shared} seed={markSeed + 31} animate={animate} delayMs={underDelay} />»
            </p>
          ) : (
            <blockquote className="sf-slip or-pslip">
              <span className="or-slip-cap">{glue(lectureCaption(point.sourceLabel, point.fragments, namesLecture))}</span>
              <span className="or-pslip-quote">
                «<UnderlinedText text={quoteText(point.sourceQuote)} anchors={point.anchors} groups={shared} seed={markSeed + 31} animate={animate} delayMs={underDelay} />»
              </span>
            </blockquote>
          )
        ) : null}
      </div>
    </li>
  );
}

function prefersReducedMotion(): boolean {
  try {
    return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Brings a point of the sheet into view below the sticky top line and gives it the focus: one
 * 400 ms ease-out scroll (each step instant, so the page's smooth scrolling does not fight it), or a
 * jump under reduced motion.
 */
export function revealPoint(element: HTMLElement): void {
  element.focus({ preventScroll: true });
  if (typeof window.scrollTo !== 'function') return;
  const bar = document.querySelector<HTMLElement>('.sf-room-bar');
  const offset = (bar ? bar.getBoundingClientRect().height : 0) + 16;
  const from = window.scrollY;
  const to = Math.max(0, Math.round(from + element.getBoundingClientRect().top - offset));
  if (Math.abs(to - from) < 2) return;
  if (prefersReducedMotion() || typeof window.requestAnimationFrame !== 'function') {
    window.scrollTo({ top: to, behavior: 'instant' });
    return;
  }
  const start = typeof performance !== 'undefined' ? performance.now() : Date.now();
  const step = (now: number) => {
    const t = Math.min(1, Math.max(0, (now - start) / ASKED_SCROLL_MS));
    const eased = 1 - (1 - t) ** 3;
    window.scrollTo({ top: Math.round(from + (to - from) * eased), behavior: 'instant' });
    if (t < 1) window.requestAnimationFrame(step);
  };
  window.requestAnimationFrame(step);
}

interface ProtocolSheetProps {
  /** «Билет 12, вопрос 1 · ответ 3 октября, 14:12» or «Ответ от 7 окт., 14:02». */
  heading: string;
  points: ProtocolPoint[];
  followup: ProtocolFollowup | null;
  /**
   * What the answer did to the cheat sheet, under the heading where the «Засчитано» stamp used to be
   * (Ф1): «На шпаргалке: 2 строки стёрлись наполовину, 1 вернулась». Null when the protocol does not
   * know it (not saved yet, a saved protocol read later, the journal not read): then nothing is there.
   */
  sheetNote?: ReactNode;
  /**
   * How the answer was checked, a line of its own under the date: the /try example says whether the AI
   * checked it or, when the AI check was not there, the key words and why. A real ticket has none.
   */
  checkNote?: ReactNode;
  /** Seed of the marks: the attempt or the session id, so a protocol always looks the same. */
  seed: string;
  /** The evaluation failed: only the browser's key-word marks, labelled as such. */
  preliminary?: boolean;
  /** A fresh judgement draws its marks in (250 ms, 60 ms apart); a saved protocol is simply there. */
  animate?: boolean;
}

/**
 * The answer sheet after the answer (redesign spec 5.12): every point in lecture order with its
 * title, its status in a word and a pencil mark, what the student said («Вы: «…»») and what the
 * lecture says, the same words underlined in both — so it is visible what a point was counted for.
 */
export function ProtocolSheet({ heading, points, followup, sheetNote = null, checkNote = null, seed, preliminary = false, animate = false }: ProtocolSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const mentions = lectureMentions(points);
  const asked = followup && !preliminary ? points.find((point) => point.id === followup.pointId) ?? null : null;
  const showAsked = () => {
    if (!asked) return;
    const row = sheetRef.current?.querySelector<HTMLElement>(`[data-point="${asked.id}"]`);
    if (row) revealPoint(row);
  };
  return (
    <div ref={sheetRef} className="sf-sheet or-psheet">
      <div className="or-ph">
        <span className="or-ph-date">{heading}</span>
        {checkNote ? <p className="or-ph-check">{checkNote}</p> : null}
        {sheetNote ? <p className="or-ph-sheet or-sheet-change">{sheetNote}</p> : null}
      </div>
      {/* Above the fold on the stage: which point the examiner asked about, one click from it. */}
      {asked ? (
        <p className="or-asked">
          <button type="button" className="sf-link or-asked-link" onClick={showAsked}>
            {askedNote(asked.number, asked.status)}
          </button>
        </p>
      ) : null}
      {preliminary ? <p className="or-prelim">Предварительно: по ключевым словам</p> : null}
      <ol className="or-ppts" aria-label="Пункты ответа">
        {points.map((point, index) => (
          <PointRow
            key={point.id}
            point={point}
            followup={followup}
            seed={seed}
            preliminary={preliminary}
            animate={animate}
            namesLecture={mentions[index]}
          />
        ))}
      </ol>
      {followup && !preliminary ? (
        <p className="or-extra">
          <span className="or-extra-label">Дополнительный вопрос:</span> «{followup.question}» — {extraLine(followup)}
        </p>
      ) : null}
    </div>
  );
}

/**
 * «Как считается» (Ф1): what the words of the result mean, and when a question becomes «подтверждено» —
 * in words, with no grade and no formula. The rule is the internal grade of oralGrade.ts (an answer
 * counts from 65 of 100; two errors, or a main point the examiner asked about and got no answer on,
 * keep it out), said as the student meets it.
 */
export function HowCounted() {
  // glue: on a phone the lines ended in «до» and «С» (a short word stays with the next one, spec 3.10).
  return (
    <div className="or-how">
      <p className="or-how-text">
        {glue(
          'Сами — пункт назван в ответе, до вопроса экзаменатора. После вопроса — пункт назван только в ответ на вопрос экзаменатора: ' +
            'строку шпаргалки такой пункт не стирает. Ошибка — пункт назван неверно.',
        )}
      </p>
      <p className="or-how-text">
        {glue(
          'Вопрос подтверждается, когда дважды, в разные дни, в ответе названо достаточно: около двух третей пунктов, если главный ' +
            'считать за два, а упомянутый и названный после вопроса — за половину. С двумя ошибками ответ вопрос не подтверждает. Если ' +
            'экзаменатор спросил о главном пункте, на его вопрос нужно ответить хотя бы частично.',
        )}
      </p>
    </div>
  );
}

interface ProtocolResultProps {
  /** The protocol's points (their statuses after the check) and the follow-up: the result is counted from them. */
  points: ReadonlyArray<Pick<ProtocolPoint, 'id' | 'essential' | 'status'>>;
  followup: Pick<ProtocolFollowup, 'pointId' | 'status'> | null;
  /**
   * A previous answer to the same question, on its own muted line under «Как считается»: «Прошлый
   * ответ, 2 окт.», the date being the link to its protocol (redesign critique 4, round 2).
   */
  previous?: ReactNode;
  /** The small lines at the end; SCALE_NOTE by default (the example says its own). */
  fine?: ReactNode;
  children?: ReactNode;
}

/**
 * The summary line typeset (glue) with the number of «после вопроса 1» and «ошибок: 1» kept on its word's
 * line: on a 320–340 px phone the line broke as «после вопроса» / «1 · ошибок: 1».
 */
function summaryText(line: string): string {
  return glue(line).replace(/(вопроса|ошибок:) (\d)/g, '$1\u00a0$2');
}

/**
 * The result on the desk (Ф1, 2026-10-07): no grade, no «Засчитано» — «Назвали сами 3 из 4 главных ·
 * после вопроса 1 · ошибок: 1», the counts in a plain sentence, «Как считается» and the line that the
 * teacher grades on the 10-point scale.
 */
export function ProtocolResult({ points, followup, previous, fine, children }: ProtocolResultProps) {
  const [open, setOpen] = useState(false);
  const howId = useId();
  const summary = answerSummary(
    points.map((point) => ({ id: point.id, essential: point.essential, status: point.status })),
    followup ? { point_id: followup.pointId, status: followup.status } : null,
  );
  const line = summaryLine(summary);
  return (
    <div className="or-grade">
      <p className="or-grade-label" aria-hidden="true">
        Итог
      </p>
      <p className="or-sum">{line ? summaryText(line) : 'Ни один пункт не оценён.'}</p>
      {line ? <p className="or-grade-why">{glue(countsSentence(summary.counts))}</p> : null}
      <p className="or-how-row">
        {/* aria-controls only while the panel is there: collapsed, it is not rendered (QA 2026-10-07). */}
        <button
          type="button"
          className="sf-link"
          aria-expanded={open}
          aria-controls={open ? howId : undefined}
          onClick={() => setOpen((value) => !value)}
        >
          Как считается
        </button>
      </p>
      {previous ? <p className="or-previous or-prev-line">{previous}</p> : null}
      {open ? (
        <div id={howId}>
          <HowCounted />
        </div>
      ) : null}
      {fine ?? <p className="or-grade-fine">{glue(SCALE_NOTE)}</p>}
      {children}
    </div>
  );
}

/** «завтра» in the landing's hand (zavtraPath.ts), 26 px high, on the index card of the follow-up. */
function Zavtra() {
  const px = 26;
  const scale = px / 100;
  const pad = 3;
  const width = (ZAVTRA.bbox.x2 - ZAVTRA.bbox.x) * scale + pad * 2;
  const height = (ZAVTRA.bbox.y2 - ZAVTRA.bbox.y) * scale + pad * 2;
  return (
    <svg className="or-rcard-zav" width={width.toFixed(1)} height={height.toFixed(1)} aria-hidden="true" focusable="false">
      <g transform={`translate(${(pad - ZAVTRA.bbox.x * scale).toFixed(2)} ${(pad - ZAVTRA.bbox.y * scale).toFixed(2)}) scale(${scale})`}>
        {ZAVTRA.paths.map((d, index) => (
          <path key={index} d={d} strokeWidth={(1.6 / scale).toFixed(2)} />
        ))}
      </g>
    </svg>
  );
}

/**
 * The follow-up turned into a review card (redesign spec 5.12): the question on a landing index card
 * with a pencil «завтра» — the card is due in one day. Shown only when the save added the card.
 */
export function ReviewCard({ question }: { question: string }) {
  return (
    <div className="sf-index-card or-rcard">
      <Zavtra />
      <p className="or-rcard-q" data-long={question.length > 80 ? '' : undefined}>
        {question}
      </p>
      <span className="sr-only">Вернётся в повторении завтра.</span>
    </div>
  );
}
