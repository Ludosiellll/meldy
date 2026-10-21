import { useId, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import {
  ALL_CLOSED_LINE,
  CARD_TITLE,
  NO_LECTURES_LINE,
  ORAL_TAG,
  closedAt,
  closedFoldLine,
  closedOnLine,
  countWords,
  howLines,
  oralStateLine,
  outLines,
  tally,
  topicRowLine,
  type Topic,
  type TopicList,
  type TopicQuestion,
} from '../../lib/containers/topics';
import { localDay } from '../../lib/containers/time';
import './learnLeft.css';

/**
 * «Осталось выучить» (owner, 2026-10-21; design learn-left §3): the exam's topics, the open ones first with a bar of one
 * segment per question (blue learned, yellow started), the closed ones folded into «Выучено 3 темы», what is not counted
 * and «Как считается» under them. A test topic opens its sheet («Начать 20 вопросов по теме»); an oral one opens in place
 * with its questions left and «Ответить». A phone starts with every row folded. While it loads, a quiet card of the same
 * size holds its place.
 */
export interface LearnLeftProps {
  list: TopicList | null;
  status: 'loading' | 'ready' | 'error';
  now: number;
  tz: string;
  /** A phone: every row starts folded. */
  phone?: boolean;
  /** A test topic's sheet («Начать 20 вопросов по теме»). */
  onOpenTopic?: (topic: Topic) => void;
  /** An oral question's «Ответить». */
  answerHref?: (question: TopicQuestion) => string | null;
  /** The question's words (the oral page has them). */
  questionText?: (question: TopicQuestion) => string;
  /** «Добавить лекции». */
  lecturesHref?: string | null;
  /** «У 10 вопросов ещё нет пунктов ответа» with «Подготовить» (the existing writing job). */
  prepare?: ReactNode;
  onRetry?: () => void;
  id?: string;
}

function Segments({ questions, label }: { questions: TopicQuestion[]; label?: string }) {
  return (
    <span className="ll-segs" aria-hidden={label ? undefined : 'true'} role={label ? 'img' : undefined} aria-label={label}>
      {questions.map((q) => (
        <i key={q.id} data-s={q.step} />
      ))}
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg className="ll-chev" data-open={open ? '' : undefined} viewBox="0 0 20 20" aria-hidden="true" focusable="false">
      <path d="M5 8l5 5 5-5" />
    </svg>
  );
}

function Tick() {
  return (
    <span className="ll-tick" aria-hidden="true">
      <svg viewBox="0 0 16 16" focusable="false">
        <path d="M3.5 8.5l3 3 6-6.5" />
      </svg>
    </span>
  );
}

function OralQuestions({ topic, now, answerHref, questionText }: { topic: Topic; now: number; answerHref?: LearnLeftProps['answerHref']; questionText?: LearnLeftProps['questionText'] }) {
  const left = topic.questions.filter((q) => q.step !== 'done');
  return (
    <ul className="ll-qs">
      {left.map((q) => {
        const href = answerHref?.(q) ?? null;
        const text = questionText?.(q) ?? '';
        return (
          <li key={q.id}>
            <span className="ll-qn" data-s={q.step}>
              {q.n}
            </span>
            <span className="ll-qt">
              {text ? <span className="ll-qtext">{text}</span> : <span className="ll-qtext">{`Вопрос ${q.n}`}</span>}
              <span className="ll-qw">{q.kind === 'o' ? oralStateLine(q, now) : q.step === 'started' ? 'Один верный ответ есть. Ответьте ещё раз в другой день.' : 'Ещё не отвечали.'}</span>
            </span>
            {href ? (
              <Link className="ll-go" to={href} aria-label={`Ответить на вопрос ${q.n}`}>
                Ответить
              </Link>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function TopicRow({
  topic,
  open,
  onToggle,
  onOpenTopic,
  now,
  answerHref,
  questionText,
}: {
  topic: Topic;
  open: boolean;
  onToggle: () => void;
  onOpenTopic?: LearnLeftProps['onOpenTopic'];
  now: number;
  answerHref?: LearnLeftProps['answerHref'];
  questionText?: LearnLeftProps['questionText'];
}) {
  const panelId = useId();
  const oral = topic.testTopic === null && topic.questions.some((q) => q.kind === 'o');
  const meta = (
    <span className="ll-m">
      {topicRowLine(topic)}
      {topic.oralTag ? <span className="ll-tag">{ORAL_TAG}</span> : null}
    </span>
  );
  const head = (
    <>
      <span className="ll-t">{topic.title}</span>
      {meta}
      <Segments questions={topic.questions} />
    </>
  );
  if (oral) {
    return (
      <li className="ll-row">
        <button type="button" className="ll-head" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={onToggle}>
          <span className="ll-main">{head}</span>
          <Chevron open={open} />
        </button>
        {open ? (
          <div id={panelId}>
            <OralQuestions topic={topic} now={now} answerHref={answerHref} questionText={questionText} />
          </div>
        ) : null}
      </li>
    );
  }
  if (onOpenTopic && topic.testTopic !== null) {
    return (
      <li className="ll-row">
        <button type="button" className="ll-head" aria-haspopup="dialog" onClick={() => onOpenTopic(topic)}>
          <span className="ll-main">{head}</span>
          <svg className="ll-chev ll-chev-go" viewBox="0 0 20 20" aria-hidden="true" focusable="false">
            <path d="M8 5l5 5-5 5" />
          </svg>
        </button>
      </li>
    );
  }
  return (
    <li className="ll-row">
      <div className="ll-head" data-static="">
        <span className="ll-main">{head}</span>
      </div>
    </li>
  );
}

/** The quiet card while the topics are read: the same frame and rhythm, nothing that reads as content. */
function Skeleton({ id }: { id?: string }) {
  return (
    <section className="ll" id={id} aria-busy="true" aria-label={CARD_TITLE}>
      <h2 className="ll-h">{CARD_TITLE}</h2>
      <div className="ll-skel" aria-hidden="true">
        <span className="ll-skel-n" />
        {[0, 1, 2].map((i) => (
          <span key={i} className="ll-skel-row">
            <span className="ll-skel-t" />
            <span className="ll-skel-m" />
            <span className="ll-skel-bar" />
          </span>
        ))}
      </div>
    </section>
  );
}

export default function LearnLeft({ list, status, now, tz, phone = false, onOpenTopic, answerHref, questionText, lecturesHref = null, prepare = null, onRetry, id }: LearnLeftProps) {
  const headingId = useId();
  const howId = useId();
  const foldId = useId();
  const counts = list ? tally(list.topics) : null;
  // A computer opens the first open oral topic; a phone keeps every row folded.
  const firstOral = !phone ? counts?.open.find((topic) => topic.testTopic === null && topic.questions.some((q) => q.kind === 'o'))?.key ?? null : null;
  const [opened, setOpened] = useState<Set<string> | null>(null);
  const openSet = opened ?? new Set(firstOral ? [firstOral] : []);
  const [foldOpen, setFoldOpen] = useState(false);
  const [howOpen, setHowOpen] = useState(false);

  if (!list || (status === 'loading' && list.topics.length === 0 && list.out.length === 0)) {
    if (status === 'error') {
      return (
        <section className="ll" id={id} aria-labelledby={headingId}>
          <h2 className="ll-h" id={headingId}>
            {CARD_TITLE}
          </h2>
          <p className="ll-note" role="alert">
            Не получилось загрузить темы.{' '}
            {onRetry ? (
              <button type="button" className="sf-link" onClick={onRetry}>
                Попробовать ещё раз
              </button>
            ) : null}
          </p>
        </section>
      );
    }
    return <Skeleton id={id} />;
  }

  const toggle = (key: string) => {
    const next = new Set(openSet);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setOpened(next);
  };
  const outs = outLines(list.out);
  const notes = (
    <>
      {outs.map((line) => (
        <p key={line.reason} className="ll-note">
          {line.text}
          {line.reason === 'none' && lecturesHref ? (
            <>
              {' '}
              <Link className="sf-link" to={lecturesHref}>
                Добавить лекции
              </Link>
            </>
          ) : null}
        </p>
      ))}
      {prepare ? <div className="ll-note">{prepare}</div> : null}
    </>
  );

  if (list.topics.length === 0) {
    if (!list.noLectures && outs.length === 0) return null;
    return (
      <section className="ll" id={id} aria-labelledby={headingId}>
        <h2 className="ll-h" id={headingId}>
          {CARD_TITLE}
        </h2>
        {list.noLectures ? (
          <p className="ll-note">
            {NO_LECTURES_LINE}{' '}
            {lecturesHref ? (
              <Link className="sf-link" to={lecturesHref}>
                Добавить лекции
              </Link>
            ) : null}
          </p>
        ) : (
          notes
        )}
      </section>
    );
  }

  const t = counts!;
  const day = (ms: number) => localDay(ms, tz);
  return (
    <section className="ll" id={id} aria-labelledby={headingId} data-loading={status === 'loading' ? '' : undefined}>
      <h2 className="ll-h" id={headingId}>
        {CARD_TITLE}
      </h2>
      {t.left > 0 ? (
        <p className="ll-n">
          <b>{t.left}</b> <span>{countWords(t.left, t.total, t.begun)}</span>
        </p>
      ) : (
        <p className="ll-all">{ALL_CLOSED_LINE}</p>
      )}
      <ul className="ll-list">
        {t.open.map((topic) => (
          <TopicRow
            key={topic.key}
            topic={topic}
            open={openSet.has(topic.key)}
            onToggle={() => toggle(topic.key)}
            onOpenTopic={onOpenTopic}
            now={now}
            answerHref={answerHref}
            questionText={questionText}
          />
        ))}
        {t.closed.length > 0 ? (
          <li className="ll-row ll-fold">
            <button type="button" className="ll-head ll-fold-head" aria-expanded={foldOpen} aria-controls={foldOpen ? foldId : undefined} onClick={() => setFoldOpen((v) => !v)}>
              <Tick />
              <span className="ll-fold-t">{closedFoldLine(t.closed.length)}</span>
              <Chevron open={foldOpen} />
            </button>
            {foldOpen ? (
              <ul className="ll-closed" id={foldId}>
                {t.closed.map((topic) => (
                  <li key={topic.key}>
                    <span className="ll-t">{topic.title}</span>
                    <span className="ll-m">{closedOnLine(closedAt(topic), day)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </li>
        ) : null}
      </ul>
      {notes}
      <button type="button" className="sf-link ll-how-link" data-muted="" aria-expanded={howOpen} aria-controls={howOpen ? howId : undefined} onClick={() => setHowOpen((v) => !v)}>
        Как считается
      </button>
      {howOpen ? (
        <div className="ll-how" id={howId}>
          {howLines(list).map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
