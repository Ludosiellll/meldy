import { useEffect, useMemo, useRef, useState } from 'react';
import type { TestItem } from '../../types/container';
import type { QuizAccent, QuizAttempt, QuizAttemptItem, QuizResult } from '../../types/quiz';
import { quizOrder } from '../../lib/quizzes/quizModel';
import { designDoc } from '../../lib/quizzes/design';
import { AttemptPictures } from '../containers/ItemPictures';
import QuestionCard from '../containers/QuestionCard';
import { Sheet } from '../containers/ui';
import { isAnswered } from '../containers/mockModel';
import { useWide } from '../containers/useWide';
import { RUN } from './copyTake';
import QuizDocRun from './QuizDocRun';
import { FinishSheet, RunBar, RunEnding, TimeStrip, where } from './RunParts';
import { resumeIndex, useAttempt, type AttemptRun } from './useAttempt';
import { useFieldInView } from './fieldInView';
import '../containers/room.css';
import './quizTake.css';

/**
 * The attempt of «Контрольная» (spec 2026-10-16 §2.2; plan Task 4), built as «Как на экзамене» (MockRun): one question
 * at a time, a tap chooses and reveals nothing, «Завершить» asks first. The attempt lives on the server: useAttempt
 * keeps the machinery (each change saved after half a second of quiet, a copy on the device until the server has it,
 * tries again when sending fails, the clock to the server's deadline, the end), and the way it is drawn is pluggable —
 * this one question at a time, or the studio's page for a quiz «как в студии» (release 47.2, `attempt.design`:
 * QuizDocRun), with the same answers, saving, clock, network handling, guests and pictures.
 *
 * Release 47 (spec 2026-10-18 §47.1, §47.4): a taker without an account passes the device's token, and every call of
 * the attempt goes with it (quiz_guest_answer / _finish / _result), and its question pictures come through the
 * quiz-media function with that token (AttemptPictures); with a timer a thin strip along the top line's lower edge
 * shrinks to the deadline in the quiz's colour (a progressbar «Осталось времени»; the clock in the top line says the
 * same in words).
 *
 * The top line reads «1 из 3 · осталось 19:58». With five minutes left and again with one the clock (and the strip)
 * turns red and bold, and a status line says «Осталось 5 минут» / «Осталась 1 минута» — once each, only when the
 * attempt crosses that mark (a resumed attempt already past it is not told again). A mark is only for an attempt longer
 * than it (release 47.1): a five-minute test does not start red, it has the last minute only (timeStage).
 */

export { RETRY_MS, SEND_DELAY_MS, readPending, resumeIndex, storeKey, type QuizAnswer } from './useAttempt';

const TEXT_MAX = 200;

/** QuestionCard reads a TestItem: the attempt's question with no key and no file number. */
export function asTestItem(item: QuizAttemptItem, index: number): TestItem {
  return {
    id: item.id,
    container_id: '',
    subject_id: '',
    position: index + 1,
    file_no: '',
    topic: null,
    kind: item.kind,
    stem: item.stem,
    options: Array.isArray(item.options) ? item.options : [],
    correct: [],
    answers: [],
    key_source: 'none',
    code: Boolean(item.code),
    keep_order: Boolean(item.keep_order),
    flags: [],
    rev: 0,
    updated_at: '',
    images: item.images ?? null,
  };
}

/** The option order lives in the model now (the review uses it too); kept here for the page's imports. */
export { quizOrder };

export interface QuizRunProps {
  attempt: QuizAttempt;
  /** The device's token of a taker without an account (lib/quizzes/guestToken.ts); null — signed in. */
  token: string | null;
  /** The quiz's colour: the sheets open outside the page's root, so they take it by class. */
  accent?: QuizAccent;
  /** The app's theme is dark (a quiz «как в студии» turns its page's theme into colours for it). */
  dark?: boolean;
  /** The attempt is over (sent, out of time, or closed by the server): its result. */
  onResult: (result: QuizResult) => void;
  /** The attempt is gone on the server (the author reset it): the page goes back to its start with these words. */
  onLost: (message: string) => void;
}

export default function QuizRun({ attempt, token, accent = 'blue', dark = false, onResult, onLost }: QuizRunProps) {
  const run = useAttempt(attempt, token, { onResult, onLost });
  const doc = useMemo(() => designDoc(attempt.design), [attempt.design]);
  // The short answer's field stays in sight when the keyboard comes up (phone audit 47.3), in both ways of drawing.
  useFieldInView(!run.ending);
  if (doc) return <QuizDocRun run={run} attempt={attempt} token={token} doc={doc} dark={dark} />;
  return <ClassicRun run={run} attempt={attempt} token={token} accent={accent} />;
}

/** One question at a time (the attempt of every quiz but one «как в студии»). */
function ClassicRun({ run, attempt, token, accent }: { run: AttemptRun; attempt: QuizAttempt; token: string | null; accent: QuizAccent }) {
  const id = attempt.attempt_id;
  const items = attempt.items;
  const total = items.length;
  const wide = useWide();
  const cards = useMemo(() => new Map(items.map((item, index) => [item.id, asTestItem(item, index)])), [items]);
  const orders = useMemo(() => {
    const out: Record<string, number[]> = {};
    for (const item of items) out[item.id] = quizOrder(item, id, attempt.shuffle_options);
    return out;
  }, [items, id, attempt.shuffle_options]);

  const [pos, setPos] = useState(() =>
    resumeIndex(
      items.map((item) => item.id),
      run.startAnswers,
      attempt.allow_back,
    ),
  );
  const [allOpen, setAllOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const stemRef = useRef<HTMLHeadingElement | null>(null);

  // The end began (sent, or the clock): the sheets close; «Вернуться к вопросам» does not bring them back.
  useEffect(() => {
    if (!run.ending) return;
    setFinishOpen(false);
    setAllOpen(false);
  }, [run.ending]);

  useEffect(() => {
    stemRef.current?.focus({ preventScroll: true });
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    } catch {
      window.scrollTo(0, 0);
    }
  }, [pos]);

  const shown = Math.min(pos + 1, total);
  const place = RUN.place(shown, total);
  const sheetClass = `qt-accent qt-accent-${accent}`;

  // ── the end on its way (or waiting for the network)
  if (run.ending) return <RunEnding run={run} place={place} />;

  // ── the attempt
  const answers = run.answers;
  const item = items[pos] ?? null;
  const card = item ? cards.get(item.id) ?? null : null;
  const answer = item ? answers[item.id] : undefined;
  const picked = Array.isArray(answer) ? answer : null;
  const answeredCount = items.filter((entry) => isAnswered(answers[entry.id])).length;
  const missing = items.map((entry, index) => (isAnswered(answers[entry.id]) ? -1 : index + 1)).filter((n) => n > 0);
  const last = pos >= total - 1;

  return (
    <AttemptPictures attemptId={id} token={token}>
      <RunBar where={where(place, run.timeText, run.stage)} onExit={() => setFinishOpen(true)}>
        <TimeStrip run={run} />
      </RunBar>
      <main className="sf-page ct-study qt-run">
        <p className="qt-low" role="status">
          {run.lowNote}
        </p>
        {run.resumed ? <p className="ct-offline">{RUN.resumed(shown, total, run.timeText)}</p> : null}
        {item && card ? (
          <QuestionCard
            item={card}
            order={orders[item.id] ?? []}
            context={attempt.quiz_title}
            mode="mock"
            answered={null}
            ticked={[]}
            picked={picked}
            text={typeof answer === 'string' ? answer : ''}
            onPick={(place) => {
              const fileIndex = (orders[item.id] ?? [])[place];
              if (fileIndex === undefined) return;
              if (item.kind === 'multiple') {
                const list = picked ?? [];
                const next = list.includes(fileIndex) ? list.filter((value) => value !== fileIndex) : [...list, fileIndex];
                run.update(item.id, next.length > 0 ? next : null);
              } else {
                run.update(item.id, picked?.[0] === fileIndex ? null : [fileIndex]);
              }
            }}
            onText={(value) => {
              const text = value.slice(0, TEXT_MAX);
              run.update(item.id, text === '' ? null : text);
            }}
            onSubmitText={() => (last ? setFinishOpen(true) : setPos(pos + 1))}
            stemRef={stemRef}
          />
        ) : null}
        <div className="ct-under ct-mock-all qt-under">
          {attempt.allow_back ? (
            <button type="button" className="sf-link" data-muted="" aria-haspopup="dialog" onClick={() => setAllOpen(true)}>
              {RUN.all}
            </button>
          ) : (
            <p className="qt-forward">{RUN.forwardOnly}</p>
          )}
          <p className="qt-saved" role="status" data-tone={run.status}>
            {run.statusText}
          </p>
        </div>
        <div className="ct-bar">
          <div className="ct-bar-row" style={wide ? undefined : { width: '100%' }}>
            {attempt.allow_back ? (
              <button type="button" className="ct-back" disabled={pos === 0} onClick={() => setPos(Math.max(0, pos - 1))}>
                {RUN.back}
              </button>
            ) : null}
            {last ? (
              <button type="button" className="sf-primary" onClick={() => setFinishOpen(true)}>
                {RUN.finish}
              </button>
            ) : (
              <button type="button" className="sf-primary" onClick={() => setPos(pos + 1)}>
                {RUN.next}
              </button>
            )}
          </div>
        </div>
      </main>
      {allOpen && attempt.allow_back ? (
        <Sheet title={RUN.all} onClose={() => setAllOpen(false)} className={sheetClass}>
          <ul className="ct-cells">
            {items.map((entry, index) => (
              <li key={entry.id}>
                <button
                  type="button"
                  data-answered={isAnswered(answers[entry.id]) ? '' : undefined}
                  aria-current={index === pos ? 'true' : undefined}
                  aria-label={RUN.cell(index + 1, isAnswered(answers[entry.id]))}
                  onClick={() => {
                    setPos(index);
                    setAllOpen(false);
                  }}
                >
                  {index + 1}
                </button>
              </li>
            ))}
          </ul>
        </Sheet>
      ) : null}
      {finishOpen ? (
        <FinishSheet
          line={RUN.finishLine(answeredCount, total, missing)}
          className={sheetClass}
          onFinish={() => run.end('sent')}
          onClose={() => setFinishOpen(false)}
        />
      ) : null}
    </AttemptPictures>
  );
}
