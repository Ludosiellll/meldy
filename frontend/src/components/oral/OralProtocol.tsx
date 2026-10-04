import { useId, useRef, useState, type ReactNode } from 'react';
import { MARK_DRAW_MS, MARK_STAGGER_MS, Mark, PencilOval, seedFrom, type MarkKind } from '../marks';
import { ZAVTRA } from '../landing/zavtraPath';
import { UnderlinedText, quoteText } from './RubricSlots';
import {
  STATUS_WORDS,
  countsSentence,
  formulaLine,
  gradeAnswer,
  gradeWord,
  type FollowupStatus,
  type Grade,
  type GradeFollowup,
  type GradeResult,
  type PointStatus,
} from '../../lib/oral/oralGrade';
import { fragmentsLabel, pointSource } from '../../lib/oral/oralPersistence';
import type { Evaluation, Rubric } from '../../lib/oral/oralApi';
import type { StoredProtocol } from '../../lib/oral/ticketData';
import { glue } from '../../lib/oral/format';
import { sharedGroups } from '../../lib/oral/rubricMatch';

/** Redesign spec 5.12, word for word. */
export const TRAINING_NOTE = 'Оценка тренировочная: по пунктам эталона из ваших лекций, а не по требованиям преподавателя.';

/** The stamp of a 4 or a 5 (in the pencil oval) and of a 2 or a 3 (Jury_Check item 11: not «зачтено»). */
export const STAMP_PASSED = 'Засчитано';
export const STAMP_NOT_PASSED = 'В готовность не засчитано';

/** The start of an essential point's status line: the weight-2 points are marked on the sheet. */
export const MAIN_POINT = 'главный пункт';

/** A saved answer graded before the cap for an unrecovered main point (formula v2). */
export const OLD_RULE_NOTE =
  'Этот ответ оценён по правилу, которое действовало в день ответа: без потолка за главный пункт, не восстановленный на вопросе экзаменатора.';
/** A saved grade that today's formula does not explain: it is shown as it was saved. */
export const SAVED_GRADE_NOTE = 'Оценка сохранена в день ответа.';

/** The stamp of a grade: «Засчитано» for a 4 or a 5, «В готовность не засчитано» for a 2 or a 3, none without a grade. */
export function stampFor(grade: number | null | undefined): 'passed' | 'not_passed' | 'none' {
  if (grade === 4 || grade === 5) return 'passed';
  if (grade === 2 || grade === 3) return 'not_passed';
  return 'none';
}

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

const FOLLOWUP_WORDS: Record<FollowupStatus, string> = {
  covered: 'засчитан',
  partial: 'засчитан частично',
  missing: 'не засчитан',
  wrong: 'сказано неверно',
};

/** «засчитан частично», or «по ключевым словам засчитан частично» when the browser's rule decided. */
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

/** «ответ: не знаю.», «ответ: «…», засчитан частично.» or «ответа не прозвучало.» */
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
        <p className="or-q2">
          <span className="or-q2-label">Вы:</span>
          {point.studentQuote ? (
            <>
              «<UnderlinedText text={point.studentQuote} anchors={point.anchors} groups={shared} seed={markSeed + 17} animate={animate} delayMs={underDelay} />»
            </>
          ) : (
            <span className="or-q2-none">в ответе не прозвучало</span>
          )}
        </p>
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
  /** passed: «Засчитано» in a pencil oval; not_passed: «В готовность не засчитано»; none: no stamp (no grade). */
  stamp: 'passed' | 'not_passed' | 'none';
  /** Seed of the oval and the marks: the attempt or the session id, so a protocol always looks the same. */
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
export function ProtocolSheet({ heading, points, followup, stamp, seed, preliminary = false, animate = false }: ProtocolSheetProps) {
  const sheetRef = useRef<HTMLDivElement>(null);
  const mentions = lectureMentions(points);
  const asked = followup && !preliminary ? points.find((point) => point.id === followup.pointId) ?? null : null;
  // The point marks are drawn in lecture order, 250 ms each, 60 ms apart; the oval after the last one.
  const ovalDelay = animate ? Math.max(0, points.length - 1) * MARK_STAGGER_MS + MARK_DRAW_MS : 0;
  const showAsked = () => {
    if (!asked) return;
    const row = sheetRef.current?.querySelector<HTMLElement>(`[data-point="${asked.id}"]`);
    if (row) revealPoint(row);
  };
  return (
    <div ref={sheetRef} className="sf-sheet or-psheet">
      <div className="or-ph">
        <span className="or-ph-date">{heading}</span>
        {stamp === 'passed' ? (
          <span className="or-stamp" data-passed="true">
            {/* Wide enough that the line never cuts the word's corners (spec 3.8: word +10/+7), fitted to «Засчитано». */}
            <PencilOval seed={seedFrom(seed, 'oval')} animate={animate} delayMs={ovalDelay} padX={16} padY={9}>
              {STAMP_PASSED}
            </PencilOval>
          </span>
        ) : stamp === 'not_passed' ? (
          <span className="or-stamp" data-passed="false">
            {STAMP_NOT_PASSED}
          </span>
        ) : null}
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
      <ol className="or-ppts" aria-label="Пункты эталона">
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

/** The sentence about the cap that set this grade, or about the cap left out (formula v2). */
export function capSentence(result: GradeResult): string | null {
  if (result.cap === 'essential_unrecovered') {
    const which = result.capPoint ? `пункт ${result.capPoint.number}` : 'главный пункт';
    return `Здесь оценку ограничил ${which}: на вопрос экзаменатора о нём не было верного ответа.`;
  }
  if (result.cap === 'essential_wrong') return 'Здесь оценку ограничила ошибка в главном пункте.';
  if (result.cap === 'two_wrong') return 'Здесь оценку ограничили две ошибки.';
  return null;
}

export const CAP_SKIPPED_SENTENCE = 'Ответ на вопрос экзаменатора проверен только по ключевым словам, поэтому этот потолок здесь не применён.';

/** The formula v2 in words (redesign spec 5.12, «Как считается»): weights, credits, the three caps and which one applied. */
export function HowGraded({ result }: { result: GradeResult }) {
  const formula = formulaLine(result);
  const applied = capSentence(result);
  return (
    <div className="or-how">
      {formula ? <p className="or-how-formula">{formula}</p> : null}
      <p className="or-how-text">
        Главный пункт весит 2, остальные — 1. Раскрытый пункт даёт 1, упомянутый — 0,5, не названный и ошибочный — 0. Ответ на
        вопрос экзаменатора поднимает свой пункт до 0,5, частичный ответ — до 0,25. Пункты без оценки в счёт не входят.
      </p>
      <p className="or-how-text">
        Оценка 5 — от 85 из 100, 4 — от 65, 3 — от 45. Ошибка в главном пункте — не выше 4, две ошибки — не выше 3. Если экзаменатор
        спросил о главном пункте, который не назван или назван неверно, а ответа на его вопрос нет или он неверный, — не выше 3. В
        готовность засчитываются ответы на 4 и 5.
      </p>
      {applied || result.capSkipped ? (
        <p className="or-how-text or-how-cap">
          {[applied, result.capSkipped === 'keywords' ? CAP_SKIPPED_SENTENCE : null].filter(Boolean).join(' ')}
        </p>
      ) : null}
    </div>
  );
}

interface ProtocolGradeProps {
  result: GradeResult;
  /** A saved answer: how its grade relates to today's formula (storedGrade), shown under the counts. */
  note?: string | null;
  /**
   * A previous answer to the same question, on its own muted line under «Как считается»: «Прошлый
   * ответ, 2 окт.: «хорошо».», the date being the link (redesign critique 4, round 2; a grade in words
   * because «4 из 5» next to «Раскрыто 3 пункта из 5» read as points).
   */
  previous?: ReactNode;
  children?: ReactNode;
}

/** The grade on the desk: «4 хорошо», the counts in a plain sentence, «Как считается», the note. */
export function ProtocolGrade({ result, note = null, previous, children }: ProtocolGradeProps) {
  const [open, setOpen] = useState(false);
  const howId = useId();
  const word = gradeWord(result.grade);
  return (
    <div className="or-grade">
      <p className="or-grade-label" aria-hidden="true">
        Оценка
      </p>
      <p className="or-grade-g">
        <span className="sr-only">{word ? `Оценка ${result.grade} · ${word}` : 'Оценки нет'}</span>
        <span className="or-grade-digit" aria-hidden="true">
          {result.grade ?? '—'}
        </span>
        {word ? (
          // «удовлетворительно» is set smaller, so it stays on the digit's line (and the actions in a 720 px window).
          <span className="or-grade-word" aria-hidden="true" data-long={word.length > 8 ? '' : undefined}>
            {word}
          </span>
        ) : null}
      </p>
      <p className="or-grade-why">{glue(countsSentence(result.counts))}</p>
      {note ? <p className="or-grade-note">{note}</p> : null}
      <p className="or-how-row">
        <button type="button" className="sf-link" aria-expanded={open} aria-controls={howId} onClick={() => setOpen((value) => !value)}>
          Как считается
        </button>
      </p>
      {previous ? <p className="or-previous or-prev-line">{previous}</p> : null}
      {open ? (
        <div id={howId}>
          <HowGraded result={result} />
        </div>
      ) : null}
      <p className="or-grade-fine">{TRAINING_NOTE}</p>
      {children}
    </div>
  );
}

export interface StoredGradeView {
  result: GradeResult;
  /** OLD_RULE_NOTE, SAVED_GRADE_NOTE or null (the saved grade is today's formula, a protocol like a fresh one). */
  note: string | null;
}

function isGrade(value: number | null): value is Grade {
  return value === 2 || value === 3 || value === 4 || value === 5;
}

/**
 * The grade of a saved protocol (?session=). The save keeps the follow-up's status but not how it was
 * judged, and the grade is written at answer time, so the saved grade is matched against both
 * readings: with the cap for an unrecovered main point (a trusted verdict) and without it (a key-word
 * verdict, or the rule before formula v2).
 * - the capped reading gives the saved grade → shown exactly like a fresh protocol;
 * - the plain reading does → shown with its formula (which leads to the saved grade) and a note: the
 *   old rule for an explicit «не знаю» or silence (those were never key-word verdicts), else neutral;
 * - neither → the saved grade as it is, with no formula line.
 */
export function storedGrade(protocol: StoredProtocol): StoredGradeView {
  const points = protocol.points.map((point) => ({ id: point.id, essential: point.essential, status: point.status }));
  const saved = protocol.followup;
  const followup = (judgedBy: GradeFollowup['judgedBy']): GradeFollowup | null =>
    saved ? { point_id: saved.point_id, status: saved.status, judgedBy } : null;
  const capped = gradeAnswer(points, followup(null));
  if (!isGrade(protocol.grade)) return { result: capped, note: null };
  const matches = (result: GradeResult) => result.grade === protocol.grade && (protocol.score === null || result.score === protocol.score);
  if (matches(capped)) return { result: capped, note: null };
  const plain = gradeAnswer(points, followup('keywords'));
  if (matches(plain)) {
    const answer = saved ? saved.student_quote.trim() : '';
    const dontKnow = saved !== null && saved.status === 'missing' && (answer === 'не знаю' || answer === '');
    return { result: { ...plain, capSkipped: null, capPoint: null }, note: dontKnow ? OLD_RULE_NOTE : SAVED_GRADE_NOTE };
  }
  const grade = protocol.grade;
  return {
    result: { ...capped, score: protocol.score, grade, word: gradeWord(grade), passed: grade >= 4, terms: [], cap: null, capSkipped: null, capPoint: null },
    note: SAVED_GRADE_NOTE,
  };
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
