import { useId, useState, type ReactNode } from 'react';
import { Mark, PencilOval, seedFrom, type MarkKind } from '../marks';
import { ZAVTRA } from '../landing/zavtraPath';
import { UnderlinedText, quoteText } from './RubricSlots';
import {
  STATUS_WORDS,
  countsSentence,
  formulaLine,
  gradeAnswer,
  gradeWord,
  type FollowupStatus,
  type GradeResult,
  type PointStatus,
} from '../../lib/oral/oralGrade';
import { fragmentsLabel, pointSource } from '../../lib/oral/oralPersistence';
import type { Evaluation, Rubric } from '../../lib/oral/oralApi';
import type { StoredProtocol } from '../../lib/oral/ticketData';
import { glue } from '../../lib/oral/format';

/** Redesign spec 5.12, word for word. */
export const TRAINING_NOTE = 'Оценка тренировочная: по пунктам эталона из ваших лекций, а не по требованиям преподавателя.';

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
  /** Named by key words during the answer (only for the preliminary sheet). */
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

function lectureCaption(label: string): string {
  return label.startsWith('«') ? `Лекция ${label}` : label || 'Лекция';
}

function PointRow({
  point,
  followup,
  seed,
  preliminary,
  animate,
}: {
  point: ProtocolPoint;
  followup: ProtocolFollowup | null;
  seed: string;
  preliminary: boolean;
  animate: boolean;
}) {
  const markSeed = seedFrom(seed, point.id);
  const asked = followup && followup.pointId === point.id ? followup : null;
  if (preliminary) {
    return (
      <li className="or-ppt" data-point={point.id}>
        <span className="or-pt-m">{point.live ? <Mark kind="tick" seed={markSeed} /> : null}</span>
        <span className="or-pt-n" aria-hidden="true">
          {point.number}
        </span>
        <div className="or-ppt-body">
          <p className="or-ppt-t">{point.title}</p>
          <p className="or-ppt-st">{point.live ? 'по ключевым словам назван' : 'по ключевым словам не назван'}</p>
          {point.sourceQuote ? (
            <p className="or-q2">
              <span className="or-q2-label">{glue(`Лекция${point.fragments ? `, ${point.fragments}` : ''}:`)}</span>
              «<UnderlinedText text={quoteText(point.sourceQuote)} anchors={point.anchors} seed={markSeed + 31} />»
            </p>
          ) : null}
        </div>
      </li>
    );
  }
  const kind = MARKS[point.status];
  const word = STATUS_WORDS[point.status];
  const statusLine = asked ? (
    <>{`${word}; ${askedLine(asked)}`}</>
  ) : point.fragments && (point.status === 'covered' || point.status === 'partial') ? (
    <>
      {word} · <span className="sf-pnote">{point.fragments}</span>
    </>
  ) : (
    <>{word}</>
  );
  const showComment = point.comment && point.status !== 'covered' && point.status !== 'unrated';
  return (
    <li className="or-ppt" data-point={point.id} data-status={point.status}>
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
              «<UnderlinedText text={point.studentQuote} anchors={point.anchors} seed={markSeed + 17} />»
            </>
          ) : (
            <span className="or-q2-none">в ответе не прозвучало</span>
          )}
        </p>
        {point.sourceQuote ? (
          point.status === 'covered' ? (
            <p className="or-q2">
              <span className="or-q2-label">{glue(`Лекция${point.fragments ? `, ${point.fragments}` : ''}:`)}</span>
              «<UnderlinedText text={quoteText(point.sourceQuote)} anchors={point.anchors} seed={markSeed + 31} />»
            </p>
          ) : (
            <blockquote className="sf-slip or-pslip">
              <span className="or-slip-cap">{lectureCaption(point.sourceLabel)}</span>
              <span className="or-pslip-quote">
                «<UnderlinedText text={quoteText(point.sourceQuote)} anchors={point.anchors} seed={markSeed + 31} />»
              </span>
            </blockquote>
          )
        ) : null}
      </div>
    </li>
  );
}

interface ProtocolSheetProps {
  /** «Билет 12, вопрос 1 · ответ 3 октября, 14:12» or «Ответ от 7 окт., 14:02». */
  heading: string;
  points: ProtocolPoint[];
  followup: ProtocolFollowup | null;
  /** passed: «Зачтено» in a pencil oval; not_passed: «Пока не зачтено»; none: no stamp (no grade). */
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
  return (
    <div className="sf-sheet or-psheet">
      <div className="or-ph">
        <span className="or-ph-date">{heading}</span>
        {stamp === 'passed' ? (
          <span className="or-stamp" data-passed="true">
            <PencilOval seed={seedFrom(seed, 'oval')} animate={animate}>
              Зачтено
            </PencilOval>
          </span>
        ) : stamp === 'not_passed' ? (
          <span className="or-stamp" data-passed="false">
            Пока не зачтено
          </span>
        ) : null}
      </div>
      {preliminary ? <p className="or-prelim">Предварительно: по ключевым словам</p> : null}
      <ol className="or-ppts" aria-label="Пункты эталона">
        {points.map((point) => (
          <PointRow key={point.id} point={point} followup={followup} seed={seed} preliminary={preliminary} animate={animate} />
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

/** The formula v1 in words (redesign spec 5.12, «Как считается»). */
export function HowGraded({ result }: { result: GradeResult }) {
  const formula = formulaLine(result);
  return (
    <div className="or-how">
      {formula ? <p className="or-how-formula">{formula}</p> : null}
      <p className="or-how-text">
        Главный пункт весит 2, остальные — 1. Раскрытый пункт даёт 1, упомянутый — 0,5, не названный и ошибочный — 0. Ответ на
        вопрос экзаменатора поднимает свой пункт до 0,5, частичный ответ — до 0,25. Пункты без оценки в счёт не входят.
      </p>
      <p className="or-how-text">
        Оценка 5 — от 85 из 100, 4 — от 65, 3 — от 45. Ошибка в главном пункте — не выше 4, две ошибки — не выше 3.
        {result.cap === 'essential_wrong' ? ' Здесь оценку ограничила ошибка в главном пункте.' : ''}
        {result.cap === 'two_wrong' ? ' Здесь оценку ограничили две ошибки.' : ''}
      </p>
    </div>
  );
}

interface ProtocolGradeProps {
  result: GradeResult;
  /** A previous answer to the same question: «В прошлый раз (1 окт.): 3 из 5» (redesign spec 5.12). */
  previous?: ReactNode;
  children?: ReactNode;
}

/** The grade on the desk: «4 хорошо», the counts in a plain sentence, «Как считается», the note. */
export function ProtocolGrade({ result, previous, children }: ProtocolGradeProps) {
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
          <span className="or-grade-word" aria-hidden="true">
            {word}
          </span>
        ) : null}
      </p>
      <p className="or-grade-why">{glue(countsSentence(result.counts))}</p>
      <button type="button" className="sf-link" aria-expanded={open} aria-controls={howId} onClick={() => setOpen((value) => !value)}>
        Как считается
      </button>
      {open ? (
        <div id={howId}>
          <HowGraded result={result} />
        </div>
      ) : null}
      <p className="or-grade-fine">{TRAINING_NOTE}</p>
      {previous ? <p className="or-previous">{previous}</p> : null}
      {children}
    </div>
  );
}

/** The grade of a saved protocol: its own score and grade, the formula when it still gives them. */
export function storedGrade(protocol: StoredProtocol): GradeResult {
  const followup = protocol.followup ? { point_id: protocol.followup.point_id, status: protocol.followup.status } : null;
  const result = gradeAnswer(
    protocol.points.map((point) => ({ id: point.id, essential: point.essential, status: point.status })),
    followup,
  );
  if (protocol.grade !== null && (result.grade !== protocol.grade || result.score !== protocol.score)) {
    const grade = protocol.grade as 2 | 3 | 4 | 5;
    return { ...result, score: protocol.score, grade, word: gradeWord(grade), passed: grade >= 4, terms: [] };
  }
  return result;
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
