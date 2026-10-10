import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import type { ContainerSummary, LocalDay, PlanInput, TestItem } from '../../types/container';
import { clearMock, loadMock, saveMock, submitMock, type MockProgress } from '../../lib/containers/mockStore';
import { optionOrder, pinnedLast } from '../../lib/containers/session';
import { dayText } from '../../lib/containers/words';
import { track } from '../../lib/telemetry';
import QuestionCard from './QuestionCard';
import { RoomBar } from './RoomParts';
import MockSetup from './MockSetup';
import { Mark, Sheet } from './ui';
import * as copy from './copy';
import { comesBackWhen, dayIn, studyHref, subjectTitle } from './model';
import { clock, drawMock, isAnswered, mockAnswers, scoreMock, type MockAnswer } from './mockModel';
import { newId } from './sessionStore';
import { useWide } from './useWide';
import './room.css';

/**
 * «Как на экзамене» (Concept 1 §3.6; spec decisions 20, 36, 53): no «Не знаю»; a tap chooses (an outline) and reveals
 * nothing; the answer can be changed until «Завершить»; the clock runs; «Все вопросы» shows which are answered. The
 * try lives on the device as it goes (lib/containers/mockStore.ts: a closed tab or a call loses nothing) and is sent
 * through the queue at the end (submitMock): without network the result is counted on the device and the answers
 * leave later. An unanswered question counts as an error. The result: «31 из 40», the time, the errors — no percent,
 * no mark, no forecast.
 */
interface Result {
  correct: number;
  items: number;
  unanswered: number;
  wrongIds: string[];
  minutes: number;
  limit: number | null;
  day: LocalDay;
  offline: boolean;
  timedOutAway: boolean;
}

function orderFor(item: TestItem, runId: string): number[] {
  if (item.kind === 'short') return [];
  try {
    const order = optionOrder(item.options.length, item.keep_order, pinnedLast(item.options), `${runId}:${item.id}`);
    if (order.length === item.options.length && new Set(order).size === order.length) return order;
  } catch {
    // The file's order.
  }
  return item.options.map((_, index) => index);
}

function safeLoad(userId: string | null, containerId: string): MockProgress | null {
  if (!userId) return null;
  try {
    const saved = loadMock(userId, containerId);
    return saved && saved.itemIds.length > 0 ? saved : null;
  } catch {
    return null;
  }
}

function safeSave(userId: string | null, progress: MockProgress): void {
  if (!userId) return;
  try {
    saveMock(userId, progress);
  } catch {
    // Without storage the try still runs; it just cannot survive a closed tab.
  }
}

export default function MockRun({
  containerId,
  userId,
  summary,
  items,
  input,
  tz,
  offline,
}: {
  containerId: string;
  userId: string | null;
  summary: ContainerSummary;
  items: ReadonlyMap<string, TestItem>;
  input: PlanInput | null;
  tz: string;
  offline: boolean;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const wide = useWide();
  const subjectParam = params.get('s');
  const count = Number(params.get('n'));
  const minutesParam = Number(params.get('t'));

  // The try in progress, or a new one from the address (?n=40&t=40), or the setup.
  const [start] = useState(() => {
    const saved = safeLoad(userId, containerId);
    if (saved) {
      const over = saved.timeLimitS !== null && Date.now() >= saved.startedAt + saved.timeLimitS * 1000;
      return { progress: saved, resumed: true, over };
    }
    if (!subjectParam || !(count > 0)) return { progress: null, resumed: false, over: false };
    const runId = newId();
    const itemIds = drawMock(input, items, subjectParam, count, runId);
    if (itemIds.length === 0) return { progress: null, resumed: false, over: false };
    const progress: MockProgress = {
      runId,
      containerId,
      subjectIds: [subjectParam],
      itemIds,
      answers: {},
      marked: [],
      startedAt: Date.now(),
      timeLimitS: minutesParam > 0 ? Math.round(minutesParam * 60) : null,
    };
    safeSave(userId, progress);
    return { progress, resumed: false, over: false };
  });
  const [progress, setProgress] = useState<MockProgress | null>(start.progress);
  const [pos, setPos] = useState(() => {
    const p = start.progress;
    if (!p || !start.resumed) return 0;
    const first = p.itemIds.findIndex((id) => !isAnswered(p.answers[id]));
    return first >= 0 ? first : p.itemIds.length - 1;
  });
  const [now, setNow] = useState(Date.now());
  const [allOpen, setAllOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [sending, setSending] = useState(false);
  const [resumedNote, setResumedNote] = useState(start.resumed && !start.over);
  const stemRef = useRef<HTMLHeadingElement | null>(null);
  const finishing = useRef(false);

  const subjectId = progress?.subjectIds[0] ?? subjectParam ?? summary.subjects[0]?.id ?? '';
  const subject = subjectTitle(summary, subjectId);
  const back = `/exams/c/${containerId}${summary.subjects.length > 1 ? `/s/${subjectId}` : ''}`;
  const orders = useMemo(() => {
    const out: Record<string, number[]> = {};
    for (const id of progress?.itemIds ?? []) {
      const item = items.get(id);
      if (item && progress) out[id] = orderFor(item, progress.runId);
    }
    return out;
  }, [progress?.runId, progress?.itemIds, items]); // eslint-disable-line react-hooks/exhaustive-deps

  const finish = useCallback(
    async (timedOutAway = false) => {
      if (!progress || finishing.current) return;
      finishing.current = true;
      setFinishOpen(false);
      setAllOpen(false);
      const ended = Math.min(Date.now(), progress.timeLimitS !== null ? progress.startedAt + progress.timeLimitS * 1000 : Date.now());
      const local = scoreMock(progress.itemIds, progress.answers, items);
      const day = dayIn(ended, tz);
      const base: Result = {
        correct: local.correct,
        items: progress.itemIds.length,
        unanswered: local.unanswered,
        wrongIds: local.wrongIds,
        minutes: Math.max(1, Math.round((ended - progress.startedAt) / 60_000)),
        limit: progress.timeLimitS !== null ? Math.round(progress.timeLimitS / 60) : null,
        day,
        offline: false,
        timedOutAway,
      };
      setSending(true);
      let server = null;
      try {
        server = userId
          ? await submitMock(userId, {
              client_run_id: progress.runId,
              container_id: containerId,
              local_date: day,
              subject_ids: progress.subjectIds,
              time_limit_s: progress.timeLimitS ?? undefined,
              duration_s: Math.max(1, Math.round((ended - progress.startedAt) / 1000)),
              answers: mockAnswers({ runId: progress.runId, itemIds: progress.itemIds, answers: progress.answers, orders, bank: items }),
            })
          : null;
      } catch {
        server = null;
      }
      setSending(false);
      if (userId) {
        try {
          clearMock(userId, containerId);
        } catch {
          // Already gone.
        }
      }
      const final: Result = server ? { ...base, correct: server.correct, items: server.items, unanswered: server.unanswered } : { ...base, offline: true };
      track('container.mock_finished', { items: final.items, correct: final.correct });
      setResult(final);
    },
    [progress, items, tz, userId, containerId, orders],
  );

  // The clock; at 0:00 the try ends by itself. A try whose time ran out while the tab was closed ends at once.
  useEffect(() => {
    if (!progress || result) return undefined;
    if (start.over) {
      void finish(true);
      return undefined;
    }
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [progress, result]); // eslint-disable-line react-hooks/exhaustive-deps
  const left = progress?.timeLimitS != null ? progress.startedAt + progress.timeLimitS * 1000 - now : null;
  useEffect(() => {
    if (left !== null && left <= 0 && progress && !result) void finish(false);
  }, [left, progress, result, finish]);

  useEffect(() => {
    stemRef.current?.focus({ preventScroll: true });
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    } catch {
      window.scrollTo(0, 0);
    }
  }, [pos]);

  const update = (id: string, answer: MockAnswer) => {
    if (!progress) return;
    const next: MockProgress = { ...progress, answers: { ...progress.answers, [id]: answer } };
    setProgress(next);
    safeSave(userId, next);
    if (resumedNote) setResumedNote(false);
  };

  // ── the setup (no try yet)
  if (!progress && !result) {
    const subjectFacts = summary.subjects.find((entry) => entry.id === subjectId);
    const last = summary.mock_runs.filter((run) => run.subject_ids.includes(subjectId)).sort((a, b) => (a.local_date < b.local_date ? 1 : -1))[0] ?? null;
    return (
      <>
        <RoomBar long={subject} short={subject} exitLabel={copy.END_EXIT} onExit={() => navigate(back)} />
        <main className="sf-page ct-study" />
        <MockSetup
          keyed={subjectFacts?.keyed ?? 0}
          last={last}
          onClose={() => navigate(back)}
          onStart={(n, t) => navigate(`/exams/c/${containerId}/mock?s=${subjectId}&n=${n}&t=${t}`, { replace: true })}
        />
      </>
    );
  }

  // ── the result
  if (result) {
    const errors = result.items - result.correct;
    const reviewHref = studyHref(containerId, { s: subjectId, only: 'errors', back: summary.subjects.length > 1 ? 's' : null });
    return (
      <>
        <RoomBar long={subject} short={subject} exitLabel={copy.END_EXIT} onExit={() => navigate(back)} />
        <main className="sf-page ct-study ct-end">
          {result.timedOutAway ? <p className="ct-end-small">{copy.mockTimeOut(result.items - result.unanswered, result.items)}</p> : null}
          <h1 className="ct-end-h" tabIndex={-1}>
            {copy.mockResultHead(dayText(result.day))}
          </h1>
          <p className="ct-score">
            <Mark>{copy.mockScore(result.correct, result.items)}</Mark>
          </p>
          <p className="ct-end-p">
            {copy.mockTime(result.minutes, result.limit)} {copy.mockErrors(errors, result.unanswered, comesBackWhen(result.day, input?.studyWeekdays))}
          </p>
          {result.offline ? <p className="ct-end-small">{copy.MOCK_OFFLINE}</p> : null}
          {errors > 0 ? (
            <div className="ct-end-links">
              <Link className="sf-link" to={back}>
                {copy.DONE}
              </Link>
            </div>
          ) : null}
          <div className="ct-bar">
            <div className="ct-bar-row" style={wide ? undefined : { width: '100%' }}>
              {errors > 0 ? (
                <Link className="sf-primary" to={reviewHref}>
                  {copy.MOCK_REVIEW}
                </Link>
              ) : (
                <Link className="sf-primary" to={back}>
                  {copy.DONE}
                </Link>
              )}
            </div>
          </div>
        </main>
      </>
    );
  }

  // ── the result on its way (the queue sends it; without network it is counted on the device)
  if (sending) {
    return (
      <>
        <RoomBar long={subject} short={subject} exitLabel={copy.END_EXIT} onExit={() => navigate(back)} />
        <main className="sf-page ct-study ct-end">
          <p className="ct-recall" role="status">
            {copy.MOCK_SENDING}
          </p>
        </main>
      </>
    );
  }

  // ── the try
  const run = progress!;
  const id = run.itemIds[pos];
  const item = items.get(id) ?? null;
  const total = run.itemIds.length;
  const answeredCount = run.itemIds.filter((itemId) => isAnswered(run.answers[itemId])).length;
  const missing = run.itemIds.map((itemId, index) => (isAnswered(run.answers[itemId]) ? -1 : index + 1)).filter((n) => n > 0);
  const timeText = left !== null ? clock(left) : null;
  const barText = copy.mockBar(pos + 1, total, timeText);
  const last = pos === total - 1;
  const answer = run.answers[id];
  const picked = Array.isArray(answer) ? answer : null;

  return (
    <>
      <RoomBar long={copy.glue(`${subject} · ${barText}`)} short={barText} exitLabel={copy.MOCK_FINISH} onExit={() => setFinishOpen(true)} />
      <main className="sf-page ct-study">
        {resumedNote ? <p className="ct-offline">{copy.mockResumed(pos + 1, total, timeText)}</p> : null}
        {item ? (
          <QuestionCard
            item={item}
            order={orders[id] ?? []}
            context={copy.glue(`${copy.MOCK_TITLE} · ${subject}`)}
            mode="mock"
            answered={null}
            ticked={[]}
            picked={picked}
            text={typeof answer === 'string' ? answer : ''}
            onPick={(placeIndex) => {
              const fileIndex = (orders[id] ?? [])[placeIndex];
              if (fileIndex === undefined) return;
              if (item.kind === 'multiple') {
                const list = picked ?? [];
                update(id, list.includes(fileIndex) ? list.filter((v) => v !== fileIndex) : [...list, fileIndex]);
              } else {
                update(id, picked?.[0] === fileIndex ? null : [fileIndex]);
              }
            }}
            onText={(value) => update(id, value === '' ? null : value)}
            onSubmitText={() => (last ? setFinishOpen(true) : setPos(pos + 1))}
            stemRef={stemRef}
          />
        ) : null}
        <div className="ct-under ct-mock-all">
          <button type="button" className="sf-link" data-muted="" aria-haspopup="dialog" onClick={() => setAllOpen(true)}>
            {copy.MOCK_ALL}
          </button>
        </div>
        <div className="ct-bar">
          <div className="ct-bar-row" style={wide ? undefined : { width: '100%' }}>
            <button type="button" className="ct-back" disabled={pos === 0} onClick={() => setPos(Math.max(0, pos - 1))}>
              {copy.MOCK_BACK}
            </button>
            {last ? (
              <button type="button" className="sf-primary" onClick={() => setFinishOpen(true)}>
                {copy.MOCK_FINISH}
              </button>
            ) : (
              <button type="button" className="sf-primary" onClick={() => setPos(pos + 1)}>
                {copy.NEXT}
              </button>
            )}
          </div>
        </div>
      </main>
      {allOpen ? (
        <Sheet title={copy.MOCK_ALL} onClose={() => setAllOpen(false)}>
          <ul className="ct-cells">
            {run.itemIds.map((itemId, index) => (
              <li key={itemId}>
                <button
                  type="button"
                  data-answered={isAnswered(run.answers[itemId]) ? '' : undefined}
                  aria-current={index === pos ? 'true' : undefined}
                  aria-label={copy.mockAllCell(index + 1, isAnswered(run.answers[itemId]))}
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
        <Sheet
          title={copy.MOCK_TITLE}
          onClose={() => setFinishOpen(false)}
          bare
          actions={
            <>
              <button type="button" className="sf-primary" aria-busy={sending || undefined} onClick={() => void finish(false)}>
                {copy.MOCK_FINISH}
              </button>
              <button type="button" className="sf-link" onClick={() => setFinishOpen(false)}>
                {copy.MOCK_BACK_TO_QUESTIONS}
              </button>
            </>
          }
        >
          <p className="ct-finish-line">{copy.mockFinishLine(answeredCount, total, missing)}</p>
        </Sheet>
      ) : null}
    </>
  );
}
