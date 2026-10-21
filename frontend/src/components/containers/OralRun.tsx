import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContainerSummary, DayPlan, LocalDay, PlanInput } from '../../types/container';
import { fetchSheet, type SheetResponse } from '../../api/cheatSheet';
import { counter } from '../../lib/containers/session';
import { recordSelfRating, recordSheetPeek, type SelfRating } from '../../api/learning';
import { track } from '../../lib/telemetry';
import { RoomBar } from './RoomParts';
import SessionEnd, { useReplan, type OralTally } from './SessionEnd';
import * as copy from './copy';
import { subjectTitle, type Figure } from './model';
import {
  clearSession,
  firstSessionDone,
  loadSession,
  markFirstSessionDone,
  markSelfCheckNoteSeen,
  markSessionEnded,
  nameInAddress,
  resumable,
  saveSession,
  selfCheckNoteSeen,
} from './sessionStore';
import type { SessionSetup } from './studySetup';
import './room.css';

/**
 * An oral subject's free self-check, 10 questions (Concept 1 §3.8; spec §6, decisions 19, 51 and the critique's I7):
 * «Вспомните ответ — вслух или про себя.» → «Показать пункты» (the cheat sheet's lines of the question, read with the
 * existing api/cheatSheet.ts; opening them is a peek of each line, as on the sheet) → «Знаю · Плаваю · Не знаю», the
 * existing `self_rating`. A self-check never counts; no «Ответить с проверкой Meldy» here — the AI check is a session
 * of its own (one ticket, decision 29в). Each rating is saved before the next question, so the plan is read again
 * (SessionEnd useReplan) as soon as the session ends, once the peeks of its points have left too.
 *
 * Kept like a session of answers (owner, 21.10: a reload lost the place): the session is saved on this device with
 * its question and its ratings so far, and the address names it (?sid=), so a reload goes on at the same question.
 */
interface Props {
  containerId: string;
  userId: string | null;
  summary: ContainerSummary;
  plan: DayPlan | null;
  input: PlanInput | null;
  offline: boolean;
  setup: SessionSetup;
  examId: string | null;
  tz: string;
  today: LocalDay;
  base: Figure;
  wide: boolean;
  onEnded: () => void;
  onDone: (guide: boolean) => void;
}

const RATINGS: Array<{ value: SelfRating; label: string }> = [
  { value: 'know', label: copy.RATE_KNOW },
  { value: 'unsure', label: copy.RATE_UNSURE },
  { value: 'dont_know', label: copy.RATE_DONT_KNOW },
];

export default function OralRun({ containerId, userId, summary, plan, input, offline, setup, examId, tz, today, base, wide, onEnded, onDone }: Props) {
  const [sheet, setSheet] = useState<SheetResponse | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [pos, setPos] = useState(() => Math.min(Math.max(0, setup.pos), Math.max(0, setup.queue.length - 1)));
  const [shown, setShown] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tally, setTally] = useState<OralTally>(() =>
    setup.oral ? { know: setup.oral.know, unsure: setup.oral.unsure, dontKnow: setup.oral.dontKnow, questions: setup.oral.questions } : { know: 0, unsure: 0, dontKnow: 0, questions: 0 },
  );
  /** The questions rated in this session (what is left today leaves them out). */
  const [rated, setRated] = useState<ReadonlySet<string>>(() => new Set(setup.oral?.rated ?? []));
  const [ended, setEnded] = useState<number | null>(null);
  const firstEver = useRef(!firstSessionDone());
  const showNote = useRef(!selfCheckNoteSeen());
  const headRef = useRef<HTMLHeadingElement | null>(null);
  /** The peeks of the points on their way: the plan is read again once they have left. */
  const peeks = useRef<Promise<unknown>[]>([]);
  const replan = useReplan(input, onEnded);
  const ids = useMemo(() => setup.queue.map((entry) => entry.id), [setup.queue]);
  const subject = subjectTitle(summary, setup.subjectId);

  useEffect(() => {
    if (!examId) return undefined;
    const controller = new AbortController();
    setFailed(null);
    fetchSheet(examId, { signal: controller.signal }).then(
      (response) => setSheet(response),
      (failure: unknown) => {
        if (!controller.signal.aborted) setFailed(failure instanceof Error ? failure.message : copy.ORAL_OFFLINE);
      },
    );
    return () => controller.abort();
  }, [examId, attempt]);

  /** The session on this device: its question and its ratings so far. */
  const persist = (nextPos: number, nextTally: OralTally, nextRated: ReadonlySet<string>) => {
    if (!userId) return;
    saveSession(userId, {
      v: 1,
      id: setup.id,
      containerId,
      day: today,
      subjectId: setup.subjectId,
      kind: 'self_check',
      topic: setup.topic,
      only: setup.only,
      queue: setup.queue,
      pos: nextPos,
      startedAt: setup.startedAt,
      records: [],
      oral: { ...nextTally, rated: Array.from(nextRated) },
    });
  };

  // The session starts (a resumed one was counted when it started): kept before the first rating too, and named in
  // the address. Another session of today with answers stays kept until this one has a rating of its own.
  useEffect(() => {
    if (!setup.resumed) track('container.session_started', { planned: ids.length, kind: 'self_check' });
    const kept = !setup.resumed && userId ? loadSession(userId, containerId) : null;
    if (!setup.resumed && !(kept && kept.id !== setup.id && resumable(kept, today))) persist(pos, tally, rated);
    nameInAddress(setup.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    headRef.current?.focus({ preventScroll: true });
  }, [pos, sheet]);

  const byId = useMemo(() => new Map((sheet?.questions ?? []).map((question) => [question.question_id, question])), [sheet]);
  const question = byId.get(ids[pos] ?? '') ?? null;

  const end = () => {
    const at = Date.now();
    setEnded(at);
    if (userId) clearSession(userId, containerId);
    markSessionEnded(setup.id);
    markFirstSessionDone();
    track('container.session_finished', { answered: tally.questions, retries: 0, minutes: Math.max(1, Math.round((at - setup.startedAt) / 60_000)) });
    replan.ask(peeks.current);
  };

  // A question that left the oral list (the author edited it): step over it.
  const missing = Boolean(sheet) && pos < ids.length && !question;
  useEffect(() => {
    if (!missing || ended !== null) return;
    if (pos + 1 >= ids.length) end();
    else setPos(pos + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missing, pos]);

  if (ended !== null) {
    return (
      <SessionEnd
        containerId={containerId}
        summary={summary}
        subjectId={setup.subjectId}
        stats={null}
        oral={tally}
        minutes={Math.max(1, Math.round((ended - setup.startedAt) / 60_000))}
        base={base}
        plan={plan}
        input={input}
        // Each rating was saved before the next question: the headline and the tally are final when the screen opens.
        settled
        fresh={replan.fresh}
        answered={rated}
        tz={tz}
        today={today}
        firstEver={firstEver.current}
        wide={wide}
        onDone={() => onDone(firstEver.current)}
      />
    );
  }

  let count = { n: Math.min(pos + 1, ids.length), of: ids.length };
  try {
    count = counter(setup.queue, Math.min(pos, Math.max(0, setup.queue.length - 1)));
  } catch {
    // The plain count above.
  }
  const bar = (
    <RoomBar long={copy.glue(`${subject} · ${copy.counter(count.n, count.of)}`)} short={copy.counter(count.n, count.of)} exitLabel={copy.FINISH} onExit={() => (tally.questions > 0 ? end() : onDone(false))} />
  );

  if (!sheet) {
    return (
      <>
        {bar}
        <main className="sf-page ct-study">
          {failed || offline || !examId ? (
            <>
              <p className="ct-recall" role="alert">
                {offline || !examId ? copy.ORAL_OFFLINE : failed}
              </p>
              {failed && !offline ? (
                <button type="button" className="sf-link" onClick={() => setAttempt((n) => n + 1)}>
                  {copy.RETRY}
                </button>
              ) : null}
            </>
          ) : (
            <p className="ct-recall" role="status">
              {copy.ORAL_LOADING}
            </p>
          )}
        </main>
      </>
    );
  }

  const advance = (nextTally: OralTally = tally, nextRated: ReadonlySet<string> = rated) => {
    setShown(false);
    setError(null);
    if (pos + 1 >= ids.length) end();
    else {
      setPos(pos + 1);
      persist(pos + 1, nextTally, nextRated);
    }
  };

  if (!question) return <>{bar}</>;

  const points = question.rubric?.points ?? [];
  const showPoints = () => {
    setShown(true);
    if (!question.rubric || !question.question_hash || !examId) return;
    for (const point of points) {
      peeks.current.push(recordSheetPeek({ questionHash: question.question_hash, rubricId: question.rubric.rubric_id, pointId: point.id, title: point.title, examId }).catch(() => undefined));
    }
  };

  const rate = async (rating: SelfRating) => {
    if (busy || !examId) return;
    setBusy(true);
    setError(null);
    try {
      if (question.question_hash) {
        await recordSelfRating({ questionHash: question.question_hash, rating, examId, examQuestionId: question.question_id, materialId: question.rubric?.materials[0]?.material_id || null });
      }
      const nextRated = new Set(rated).add(question.question_id);
      const nextTally: OralTally = {
        know: tally.know + (rating === 'know' ? 1 : 0),
        unsure: tally.unsure + (rating === 'unsure' ? 1 : 0),
        dontKnow: tally.dontKnow + (rating === 'dont_know' ? 1 : 0),
        questions: tally.questions + 1,
      };
      setRated(nextRated);
      setTally(nextTally);
      markSelfCheckNoteSeen();
      advance(nextTally, nextRated);
    } catch {
      setError(copy.RATING_FAILED);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {bar}
      <main className="sf-page ct-study">
        <p className="ct-ctx">{copy.glue(`${subject} · ${copy.ORAL_TAG}`)}</p>
        <p className="ct-oral-no">{copy.oralNumber(question.label || String(question.position))}</p>
        <h1 className="ct-stem" ref={headRef} tabIndex={-1}>
          {question.text}
        </h1>
        {!shown ? (
          <>
            <p className="ct-recall">{copy.RECALL}</p>
            <div className="ct-bar">
              <div className="ct-bar-row" style={wide ? undefined : { width: '100%' }}>
                <button type="button" className="sf-primary" onClick={showPoints}>
                  {copy.SHOW_POINTS}
                </button>
              </div>
            </div>
          </>
        ) : (
          <>
            <section className="ct-points" aria-labelledby="ct-points-t">
              <h2 id="ct-points-t">{copy.POINTS_TITLE}</h2>
              {points.length > 0 ? (
                <ul>
                  {points.map((point) => (
                    <li key={point.id} data-essential={point.essential ? '' : undefined}>
                      {point.short || point.title}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="ct-recall">{copy.NO_POINTS}</p>
              )}
            </section>
            <p className="ct-rate-t">{copy.HOW_ANSWERED}</p>
            <div className="ct-rate" role="group" aria-label={copy.HOW_ANSWERED}>
              {RATINGS.map((rating) => (
                <button key={rating.value} type="button" aria-busy={busy || undefined} onClick={() => void rate(rating.value)}>
                  {rating.label}
                </button>
              ))}
            </div>
            {error ? (
              <p className="ct-sheet-error" role="alert">
                {error}
              </p>
            ) : null}
            {showNote.current ? <p className="ct-rate-note">{copy.SELF_CHECK_NOTE}</p> : null}
          </>
        )}
      </main>
    </>
  );
}
