import type { CSSProperties, ReactNode } from 'react';
import { Sheet } from '../containers/ui';
import { RUN } from './copyTake';
import type { AttemptRun } from './useAttempt';

/**
 * What every way of drawing an attempt shares (QuizRun, QuizDocRun): the top line with the place, the clock and
 * «Завершить», the time strip along its lower edge, the screen of the end on its way, and «Завершить контрольную?».
 */

/** The top line of the attempt (RoomBar's look, with the clock as its own span: it turns red near the end). */
export function RunBar({ where, short, onExit, children }: { where: ReactNode; short?: ReactNode; onExit?: () => void; children?: ReactNode }) {
  return (
    <header className="sf-room-bar ct-roombar qt-roombar">
      {children}
      <div className="ct-rb-left">
        <span className="ct-rb-mark" aria-hidden="true">
          Meldy
        </span>
        <span className="ct-rb-where">
          <span className="ct-rb-long">{where}</span>
          <span className="ct-rb-short">{short ?? where}</span>
        </span>
      </div>
      {onExit ? (
        <button type="button" className="sf-link ct-rb-exit" data-muted="" onClick={onExit}>
          {RUN.finish}
        </button>
      ) : null}
    </header>
  );
}

/** «1 из 3 · осталось 19:58»; without a timer «1 из 3». `place` — the words before the clock. */
export function where(place: string, clock: string | null, stage: 0 | 1 | 2): ReactNode {
  return (
    <>
      {place}
      {clock ? (
        <>
          {RUN.sep}
          <span className="qt-clock" data-low={stage > 0 ? '' : undefined}>
            {RUN.clock(clock)}
          </span>
        </>
      ) : null}
    </>
  );
}

/** The phone's top line when the place is long («Страница 2 из 3 · 14:54»): the clock without «осталось». */
export function whereShort(place: string, clock: string | null, stage: 0 | 1 | 2): ReactNode {
  return (
    <>
      {place}
      {clock ? (
        <>
          {RUN.sep}
          <span className="qt-clock" data-low={stage > 0 ? '' : undefined}>
            {clock}
          </span>
        </>
      ) : null}
    </>
  );
}

/** The thin strip under the top line: the share of the time left (a progressbar «Осталось времени»). */
export function TimeStrip({ run }: { run: AttemptRun }) {
  if (run.share === null || run.timeText === null) return null;
  return (
    <div
      className="qt-time"
      role="progressbar"
      aria-label={RUN.timeLabel}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(run.share * 100)}
      aria-valuetext={RUN.clock(run.timeText)}
      data-low={run.stage > 0 ? '' : undefined}
    >
      <span className="qt-time-left" style={{ transform: `scaleX(${run.share})` }} />
    </div>
  );
}

/** The end on its way, or waiting for the network: the line, «Сдать ещё раз», «Вернуться к вопросам». */
export function RunEnding({ run, place }: { run: AttemptRun; place: string }) {
  const ending = run.ending;
  if (!ending) return null;
  const line = ending.state === 'sending' ? (ending.reason === 'time' ? RUN.timeUp : RUN.sending) : ending.state === 'offline' ? RUN.endOffline : RUN.endFailed;
  return (
    <>
      <RunBar where={where(place, null, 0)} />
      <main className="sf-page ct-study ct-end">
        <p className="ct-recall" role="status">
          {line}
        </p>
        {ending.state !== 'sending' ? (
          <div className="ct-end-links qt-end-acts">
            <button type="button" className="sf-primary" onClick={run.retryEnd}>
              {RUN.retryEnd}
            </button>
            {run.canGoBack ? (
              <button type="button" className="sf-link" onClick={run.backToQuestions}>
                {RUN.backToQuestions}
              </button>
            ) : null}
          </div>
        ) : null}
      </main>
    </>
  );
}

/** «Завершить контрольную?» with how many have an answer and which have none. */
export function FinishSheet({
  line,
  className,
  style,
  onFinish,
  onClose,
}: {
  line: string;
  className: string;
  /** The page's own colours (a quiz «как в студии»): the sheet opens outside the page's root. */
  style?: CSSProperties;
  onFinish: () => void;
  onClose: () => void;
}) {
  return (
    <Sheet
      title={RUN.finishTitle}
      onClose={onClose}
      bare
      className={className}
      style={style}
      actions={
        <>
          <button type="button" className="sf-primary" onClick={onFinish}>
            {RUN.finish}
          </button>
          <button type="button" className="sf-link" onClick={onClose}>
            {RUN.backToQuestions}
          </button>
        </>
      }
    >
      <p className="ct-finish-line">{line}</p>
    </Sheet>
  );
}
