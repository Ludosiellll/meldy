import { useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { Mark, seedFrom, type MarkKind } from '../marks';
import { quoteText } from '../oral/RubricSlots';
import { lectureTitleOf, type ProtocolFollowup, type ProtocolPoint } from '../oral/OralProtocol';
import { glue } from '../../lib/oral/format';
import { FROM_TRY } from '../../lib/returnTo';
import type { ExampleQuestion } from '../../data/example';
import { checkHeadline, replyOutcome, rowStatus, ROW_WORDS, type RowStatus } from './exampleCheck';
import { checkLine, type TryCheckSummary } from './tryCheck';
import { tryLecturePart } from './tryParts';

/** Step 3's heading: what the page is. */
export const CHECK_TITLE = 'Вот что проверил Meldy';

/** Under the points: who grades, and what Meldy does not do. */
export const CHECK_SCALE_NOTE = 'Оценку ставит преподаватель. Meldy только проверяет, какие пункты из лекций прозвучали в ответе.';

/** The guest's own exam, after the example: what it takes. */
export const OWN_EXAM_LINE = 'В своём экзамене вы добавите вопросы кафедры и свои лекции. Meldy так же проверит каждый ответ.';

/** The way to what Meldy made of the first lecture (/try/lecture), at the end of the story: a verb and what it shows. */
export const LECTURE_AFTER_LINK = 'Посмотреть конспект и тест по лекции';

const MARKS: Record<RowStatus, MarkKind | null> = { named: 'tick', after: 'cup', partial: 'cup', wrong: 'cross', missing: 'dash', unrated: null };

interface ExampleCheckProps {
  question: ExampleQuestion;
  /** The points with the check's statuses (OralProtocol.livePoints). */
  points: ProtocolPoint[];
  followup: ProtocolFollowup | null;
  /** How the answer was checked: the AI, «не знаю», or the key words and why. */
  checked: TryCheckSummary | null;
  /** Seed of the marks: one look per answer. */
  seed: string;
  /** Where the guest's own exam starts (sign-up first for a guest). */
  ownHref: string;
  /** Another question: back to step 1. */
  onOther: () => void;
  /** The same question again, from the start. */
  onAgain: () => void;
}

/**
 * Step 3 of the example (/try/ticket after «Проверить ответ»): what the check found, for someone who sees the app for
 * the first time — how many points of the lectures the answer named, each point with its fate and the lecture's own
 * words, the examiner's question and what the reply did, how the answer was checked; then the way to an exam of one's
 * own. The statuses are the real check's (the AI, or the key words, said so). Nothing is kept: leaving forgets it.
 */
export default function ExampleCheck({ question, points, followup, checked, seed, ownHref, onOther, onAgain }: ExampleCheckProps) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  // The step starts at its heading, for the eye and for a screen reader: the answer screen's controls are gone.
  useLayoutEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
    if (typeof window.scrollTo === 'function') window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
  }, []);
  const headline = checkHeadline(points, followup);
  const asked = followup ? (points.find((point) => point.id === followup.pointId) ?? null) : null;
  const fetchLecture = () => {
    void tryLecturePart.load().catch(() => undefined);
  };
  // The points of a question come from one lecture of the example: its title once, in the card's heading.
  const lectureTitle = lectureTitleOf(points[0]?.sourceLabel ?? '');
  const pointsCard = (
    <section className="tx-card tx-ck-points" aria-labelledby="tx-ck-points-h">
      <h2 id="tx-ck-points-h" className="tx-card-h">
        {lectureTitle ? glue(`Пункты из лекции «${lectureTitle}»`) : 'Пункты из лекций'}
      </h2>
      <ol className="tx-ck-list">
        {points.map((point) => {
          const status = rowStatus(point, followup);
          const kind = MARKS[status];
          return (
            <li key={point.id} className="tx-ck-row" data-status={status}>
              <span className="tx-ck-mark" aria-hidden="true">
                {kind ? <Mark kind={kind} seed={seedFrom(seed, point.id)} /> : null}
              </span>
              <div className="tx-ck-body">
                <p className="tx-ck-word">{ROW_WORDS[status]}</p>
                <p className="tx-ck-title">{`${point.number}. ${point.title}`}</p>
                {status !== 'missing' && status !== 'after' && point.studentQuote ? (
                  <p className="tx-ck-said">{glue(`В ответе: «${point.studentQuote.replace(/[.!?…]+$/, '')}»`)}</p>
                ) : null}
                {(status === 'partial' || status === 'wrong') && point.comment ? <p className="tx-ck-said">{glue(point.comment)}</p> : null}
                {point.corrections.map((correction) => (
                  <p key={correction} className="tx-ck-fix">
                    {glue(`Правильно: ${correction}`)}
                  </p>
                ))}
                <p className="tx-ck-src">
                  <span className="sr-only">В лекции: </span>
                  {`«${quoteText(point.sourceQuote)}»`}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <p className="tx-ck-fine">{glue(CHECK_SCALE_NOTE)}</p>
    </section>
  );
  return (
    <div className="tx-check">
      <header className="tx-head tx-check-head">
        <h1 className="tx-h1" ref={headingRef} tabIndex={-1}>
          {CHECK_TITLE}
        </h1>
        <p className="tx-lead">{glue(`Вопрос ${question.number}. ${question.text}`)}</p>
      </header>

      {/* A computer: the result and the points on the left, the examiner and the way on at the right. A phone reads
          them as one column: the result, the examiner, the points, the way on (example.css). */}
      <div className="tx-ck-main">
        <section className="tx-card tx-ck-sum" aria-label="Итог">
          <p className="tx-ck-big">{glue(headline.title)}</p>
          {headline.rest ? <p className="tx-ck-rest">{glue(headline.rest)}</p> : null}
          {checked ? <p className="tx-ck-how">{glue(checkLine(checked))}</p> : null}
        </section>
        {points.length > 0 ? pointsCard : null}
      </div>

      <div className="tx-ck-aside">
        {followup ? (
          <section className="tx-card tx-ck-exam" aria-labelledby="tx-ck-exam-h">
            <h2 id="tx-ck-exam-h" className="tx-ck-exam-h">
              {asked ? `Экзаменатор спросил о пункте ${asked.number}` : 'Вопрос экзаменатора'}
            </h2>
            <p className="tx-ck-q">{`«${followup.question}»`}</p>
            {followup.answer && followup.answer !== 'не знаю' ? <p className="tx-ck-a">{glue(`Ваш ответ: «${followup.answer.replace(/\.$/, '')}»`)}</p> : null}
            <p className="tx-ck-out">{replyOutcome(followup, asked?.status ?? 'unrated')}</p>
          </section>
        ) : null}

        <section className="tx-card tx-ck-next" aria-labelledby="tx-ck-next-h">
          <h2 id="tx-ck-next-h" className="tx-card-h">
            Ваш экзамен
          </h2>
          <p className="tx-ck-own">{glue(OWN_EXAM_LINE)}</p>
          <div className="tx-ck-acts">
            <Link className="sf-primary" to={ownHref} state={FROM_TRY}>
              Создать свой экзамен
            </Link>
            <button type="button" className="tx-secondary" onClick={onOther}>
              Ответить на другой вопрос
            </button>
          </div>
          <p className="tx-ck-links">
            <button type="button" className="sf-link" data-muted="" onClick={onAgain}>
              Ответить на этот вопрос ещё раз
            </button>
            <Link className="sf-link" data-muted="" to="/try/lecture" onPointerEnter={fetchLecture} onFocus={fetchLecture} onTouchStart={fetchLecture}>
              {glue(LECTURE_AFTER_LINK)}
            </Link>
          </p>
        </section>
      </div>
    </div>
  );
}
