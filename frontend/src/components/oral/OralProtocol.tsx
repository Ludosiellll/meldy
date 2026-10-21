import { useId, useRef, useState, type ReactNode } from 'react';
import { Mark, seedFrom, type MarkKind } from '../marks';
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

/**
 * The point named only once the examiner asked (missed, mentioned or said wrong in the answer, the reply
 * covered it). Such a naming does not count towards learning the question (lib/exams/cheatSheet.ts, after_question).
 */
export const AFTER_QUESTION = 'назван только после вопроса экзаменатора';

/** What the reply to the examiner's question did for the point, in the words of the point lines. */
const REPLY_WORDS: Record<FollowupStatus, string> = {
  covered: 'назван',
  partial: 'упомянут',
  missing: 'не назван',
  wrong: 'ошибка',
};

/** The reply named the point the answer had missed, mentioned or said wrong: «после вопроса экзаменатора». */
export function namedAfterQuestion(status: PointStatus, followup: Pick<ProtocolFollowup, 'status'> | null): boolean {
  return Boolean(followup) && followup?.status === 'covered' && (status === 'missing' || status === 'partial' || status === 'wrong');
}

/**
 * The check's comment on a point the reply named later, said as the answer's: «В ответе: пункт про … полностью
 * отсутствует.» (a word in capitals, an abbreviation, keeps them).
 */
export function answerComment(comment: string): string {
  const text = comment.trim();
  const [first = '', second = ''] = text;
  const lower = first.toLocaleLowerCase('ru-RU');
  return `В ответе: ${first !== lower && second === second.toLocaleLowerCase('ru-RU') ? lower + text.slice(first.length) : text}`;
}

/**
 * The asked point's one status (EX-30: «упомянут», «по ключевым словам не назван» and «пункт назван» on one
 * card read as three verdicts): «назван только после вопроса экзаменатора» when the reply named it;
 * otherwise the answer's own word and what the reply did — «упомянут; после вопроса экзаменатора — не назван»,
 * «не назван и после вопроса экзаменатора», «не назван; на вопрос экзаменатора — «не знаю»»,
 * «не назван; после вопроса экзаменатора по ключевым словам — упомянут».
 */
export function askedStatusLine(status: PointStatus, followup: ProtocolFollowup): string {
  const word = STATUS_WORDS[status];
  if (status === 'covered') return word;
  if (namedAfterQuestion(status, followup)) return status === 'wrong' ? `${word}, верно — только после вопроса экзаменатора` : AFTER_QUESTION;
  if (followup.answer === 'не знаю') return `${word}; на вопрос экзаменатора — «не знаю»`;
  if (!followup.answer.trim()) return `${word}; на вопрос экзаменатора ответа не прозвучало`;
  const keywords = followup.judgedBy === 'keywords';
  if (REPLY_WORDS[followup.status] === word) return `${word} и после вопроса экзаменатора${keywords ? ', по ключевым словам' : ''}`;
  return `${word}; после вопроса экзаменатора${keywords ? ' по ключевым словам' : ''} — ${REPLY_WORDS[followup.status]}`;
}

/** The reply as quoted: without the full stop the quote would carry into «….». (No lookbehind: old Safari.) */
function replyQuote(answer: string): string {
  const text = answer.trim();
  return text.endsWith('.') && !text.endsWith('..') ? text.slice(0, -1) : text;
}

/**
 * Under «Дополнительный вопрос: «…» —»: the reply and what it did, in a sentence of its own. «ответ: не знаю.»,
 * «ответа не прозвучало.», «ответ: «…». Пункт назван после вопроса, его не считаем.»,
 * «ответ: «…». По ключевым словам пункт упомянут.» `status` is the asked point's status in the answer: a
 * point the answer had already named says nothing about the sheet.
 */
export function extraLine(followup: ProtocolFollowup, status: PointStatus): string {
  if (followup.answer === 'не знаю') return 'ответ: не знаю.';
  if (!followup.answer.trim()) return 'ответа не прозвучало.';
  const said = `ответ: «${replyQuote(followup.answer)}».`;
  const word = REPLY_WORDS[followup.status];
  if (followup.judgedBy === 'keywords') return `${said} По ключевым словам пункт ${word}.`;
  if (namedAfterQuestion(status, followup)) return `${said} Пункт назван после вопроса, его не считаем.`;
  if (followup.status === 'wrong') return `${said} Сказано неверно.`;
  return `${said} Пункт ${word}.`;
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
 * above the fold (redesign critique 4, round 2): «Пункт 4 не назван — о нём спросил экзаменатор.» Once the reply
 * named the point it says what happened, as the point's own line does: «Пункт 4 назван только после вопроса
 * экзаменатора.» (it said «не назван» over a point named after the question: jury QA, 2026-10-11).
 */
export function askedNote(number: number, status: PointStatus, followup: Pick<ProtocolFollowup, 'status'> | null = null): string {
  if (namedAfterQuestion(status, followup)) {
    return status === 'wrong' ? `В пункте ${number} ошибка. Верно только после вопроса экзаменатора.` : `Пункт ${number} ${AFTER_QUESTION}.`;
  }
  if (status === 'missing') return `Пункт ${number} не назван, о нём спросил экзаменатор.`;
  if (status === 'wrong') return `В пункте ${number} ошибка, о ней спросил экзаменатор.`;
  if (status === 'partial') return `Пункт ${number} упомянут не полностью, о нём спросил экзаменатор.`;
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
  // Named only after the examiner's question: half a point, as «упомянут» (the cup), unless it was an error.
  const after = asked !== null && namedAfterQuestion(point.status, asked);
  const kind = after && point.status !== 'wrong' ? 'cup' : MARKS[point.status];
  const word = after ? AFTER_QUESTION : STATUS_WORDS[point.status];
  // The same words are underlined in «Вы» and in the lecture: what the point was counted for.
  const shared = sharedGroups(point.anchors, point.studentQuote, point.sourceQuote);
  const underDelay = (point.number - 1) * 60;
  const statusLine = asked ? (
    // The longest status line: typeset (glue), so «не | назван» and «— | …» never split at a line's end.
    <>{glue(`${main}${askedStatusLine(point.status, asked)}`)}</>
  ) : point.fragments && (point.status === 'covered' || point.status === 'partial') ? (
    <>
      {main}
      {/* «фрагмент 12» never breaks before its number (a phone's narrow sheet). */}
      {word} · <span className="sf-pnote">{point.fragments.replace(/ (?=\d)/g, '\u00a0')}</span>
    </>
  ) : (
    <>{`${main}${word}`}</>
  );
  // The key-word mark said one thing, the check of the whole answer another: say so (Jury_Check item 7) — but not
  // on the point the examiner asked about: there the question and the reply decide, and one status says it (EX-30).
  const why = asked ? null : keywordNote(point.live, point.status);
  const showComment = Boolean(point.comment) && point.status !== 'unrated' && (point.status !== 'covered' || why !== null);
  // The check's comment is about the answer. Under «назван только после вопроса экзаменатора» it says so, or «…полностью
  // отсутствует» read as the point's last word (jury QA, 2026-10-11).
  const comment = after ? answerComment(point.comment) : point.comment;
  return (
    // The asked point takes the focus from the line under the sheet's header («Пункт 4 не назван…»).
    <li
      className="or-ppt"
      data-point={point.id}
      data-status={point.status}
      data-asked={asked ? '' : undefined}
      data-after={after ? '' : undefined}
      tabIndex={asked ? -1 : undefined}
    >
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
        {showComment ? <p className="or-ppt-cm sf-pnote">{comment}</p> : null}
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
   * What the answer did to its topic, under the heading where the «Засчитано» stamp used to be (Ф1):
   * «Тема «…» выучена.» or «В теме «…» осталось 2 вопроса из 6.» Null when the protocol does not know it
   * (not saved yet, a saved protocol read later, learn_left not read): then nothing is there.
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
            {askedNote(asked.number, asked.status, followup)}
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
          <span className="or-extra-label">Дополнительный вопрос:</span> «{followup.question}» — {extraLine(followup, asked?.status ?? 'unrated')}
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
          'Сами — пункт назван в ответе, до вопроса экзаменатора. После вопроса — пункт назван только в ответ на вопрос экзаменатора. ' +
            'Такой пункт не считаем. Ошибка — пункт назван неверно.',
        )}
      </p>
      <p className="or-how-text">
        {glue(
          'Вопрос выучен, когда вы дважды, в разные дни, ответили полно. Полный ответ — около двух третей пунктов. Главный пункт ' +
            'считается за два, упомянутый и названный после вопроса — за половину. С двумя ошибками ответ неполный. Если ' +
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
 * The summary line typeset (glue) with «ещё 1» kept on one line: on a 320–340 px phone a number left alone at
 * the start of a line read as a new count.
 */
function summaryText(line: string): string {
  return glue(line).replace(/(ещё) (\d)/g, '$1\u00a0$2');
}

/**
 * The result on the desk (Ф1, 2026-10-07; decision 2 of 2026-10-08): no grade, no «Засчитано» — «Сами назвали
 * 3 из 4 главных пунктов, ещё 1 — после вопроса экзаменатора», the counts in a plain sentence, «Как
 * считается» and the line that the teacher grades on the 10-point scale.
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
      {line ? <p className="or-grade-why">{glue(countsSentence(summary.counts, summary.afterQuestionFrom))}</p> : null}
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

/**
 * The follow-up turned into a review card (redesign spec 5.12): the question on an index card with «завтра» in its
 * corner — the card is due in one day. Typed, not handwritten (decision 2026-10-10: no pencil handwriting in the app).
 * Shown only when the save added the card.
 */
export function ReviewCard({ question }: { question: string }) {
  return (
    <div className="sf-index-card or-rcard">
      <span className="sf-pnote or-rcard-when" aria-hidden="true">
        завтра
      </span>
      <p className="or-rcard-q" data-long={question.length > 80 ? '' : undefined}>
        {question}
      </p>
      <span className="sr-only">Повторим завтра.</span>
    </div>
  );
}
