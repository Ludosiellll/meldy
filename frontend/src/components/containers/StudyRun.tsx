import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AnswerInput, AnswerResult, ContainerSummary, DayPlan, LocalDay, PlanInput, TestItem, UnitState } from '../../types/container';
import { enqueueAnswers } from '../../lib/containers/answerQueue';
import { afterAnswer, counter, optionOrder, pinnedLast, type QueueEntry } from '../../lib/containers/session';
import { dayText } from '../../lib/containers/words';
import { track } from '../../lib/telemetry';
import QuestionCard, { type Answered } from './QuestionCard';
import { DoubtSheet, KeyFix, RoomBar } from './RoomParts';
import SessionEnd from './SessionEnd';
import * as copy from './copy';
import {
  comesBackWhen,
  dayIn,
  gradeLocal,
  hasGroup,
  isAuthor,
  keyNames,
  subjectTitle,
  summarize,
  topicNumber,
  type Figure,
  type StudyRecord,
} from './model';
import { clearSession, firstSessionDone, keysHintSeen, markFirstSessionDone, markKeysHintSeen, saveSession } from './sessionStore';
import type { SessionSetup } from './studySetup';
import './room.css';

/**
 * A «занятие» of questions with variants (Concept 1 §3.7; spec decisions 12, 13, 14, 37, 41–43, 50):
 * - a tap is the answer; the verdict comes from the key on the device at once (the server's verdict, which wins, comes
 *   with the queue's result); a right answer moves on after a second, a tap in that second holds it;
 * - a wrong answer or «Не знаю» comes back 3–5 questions later (at most twice, «повтор, не в счёт») and on the next
 *   study day (tomorrow, or after the days off);
 * - «Нажали не туда?» under a wrong answer until «Дальше»: the answer then goes to the server with `misclick` — not a
 *   mistake, the series kept, no count today;
 * - a member's «Сомневаюсь в ключе» sets the question aside; the author (a solo student is the author of their own
 *   exam) has «Ключ неверный?» instead, which fixes the key in place (the bot spec's decision 17);
 * - an answer leaves the device when the student moves on (so «Нажали не туда?» can still mark it), through the offline
 *   queue, with its client_event_id, the item's rev, the shown order in file indices, ms, cls, the local day and the
 *   session;
 * - keys on a computer: 1–8 (or А–З) answer, 0 «Не знаю», Enter «Дальше», Backspace «Нажали не туда?».
 */
interface Pending {
  chosen: number[] | null;
  text: string | null;
  dontKnow: boolean;
  correct: boolean;
  misclick: boolean;
  again: boolean;
  at: number;
}

export interface StudyRunProps {
  containerId: string;
  userId: string | null;
  summary: ContainerSummary;
  items: ReadonlyMap<string, TestItem>;
  input: PlanInput;
  plan: DayPlan | null;
  offline: boolean;
  setup: SessionSetup;
  tz: string;
  today: LocalDay;
  base: Figure;
  wide: boolean;
  onEnded: () => void;
  onDone: (guide: boolean) => void;
}

const AUTO_MS = 1000;
const HOLD_GUARD_MS = 300;
const LETTERS = 'АБВГДЕЖЗ';

function comesAgain(queue: QueueEntry[], pos: number, id: string, seed: string): boolean {
  try {
    return afterAnswer(queue, pos, { id, correct: false }, seed)
      .slice(pos + 1)
      .some((entry) => entry.id === id);
  } catch {
    return false;
  }
}

function shownOrder(item: TestItem, seed: string): number[] {
  if (item.kind === 'short') return [];
  try {
    const order = optionOrder(item.options.length, item.keep_order, pinnedLast(item.options), seed);
    if (order.length === item.options.length && new Set(order).size === order.length) return order;
  } catch {
    // The file's order is always a fair fallback.
  }
  return item.options.map((_, index) => index);
}

export default function StudyRun(props: StudyRunProps) {
  const { containerId, userId, summary, items, input, plan, offline, setup, tz, today, base, wide, onEnded, onDone } = props;
  const author = isAuthor(summary.role);
  const [queue, setQueue] = useState<QueueEntry[]>(setup.queue);
  const [pos, setPos] = useState(setup.pos);
  const [records, setRecords] = useState<StudyRecord[]>(setup.records);
  const [results, setResults] = useState<Map<string, AnswerResult>>(() => new Map());
  const [pending, setPending] = useState<Pending | null>(null);
  const [ticked, setTicked] = useState<number[]>([]);
  const [text, setText] = useState('');
  const [hint, setHint] = useState<string | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [doubtOpen, setDoubtOpen] = useState(false);
  const [patches, setPatches] = useState<Record<string, Pick<TestItem, 'correct' | 'answers' | 'rev'>>>({});
  const [aside, setAside] = useState<ReadonlySet<string>>(() => new Set());
  const [ended, setEnded] = useState<{ at: number } | null>(null);
  const firstEver = useRef(!firstSessionDone());
  const showKeys = useRef(!keysHintSeen());
  const shownAt = useRef(Date.now());
  const advancedAt = useRef(0);
  const timer = useRef<number | null>(null);
  const committed = useRef(false);
  const fixedNow = useRef(false);
  const stemRef = useRef<HTMLHeadingElement | null>(null);
  const fileRef = useRef<HTMLButtonElement | null>(null);
  const keyRef = useRef<HTMLDivElement | null>(null);

  const entry = queue[pos] ?? null;
  const base_ = entry ? items.get(entry.id) ?? null : null;
  const item = base_ && patches[base_.id] ? { ...base_, ...patches[base_.id] } : base_;
  const seed = `${setup.id}:${pos}`;
  const order = useMemo(() => (item ? shownOrder(item, seed) : []), [item?.id, item?.options.length, seed]); // eslint-disable-line react-hooks/exhaustive-deps

  // «7 из 20» (lib/containers/session.ts counter): a retry repeats the place it came back to.
  const count = useMemo(() => {
    try {
      return counter(queue, Math.min(pos, Math.max(0, queue.length - 1)));
    } catch {
      return { n: Math.min(pos + 1, queue.length), of: queue.length };
    }
  }, [queue, pos]);
  const subject = subjectTitle(summary, setup.subjectId);
  // The states before this session, for the figure's change at the end (session.ts figureChange).
  const before = useRef<ReadonlyMap<string, UnitState | undefined> | null>(null);
  if (before.current === null) before.current = new Map(input.items.map((entry) => [entry.id, entry.u]));

  // A question the bank does not have (deleted, not loaded): step over it.
  useEffect(() => {
    if (ended || !entry || item) return;
    const nextPos = pos + 1;
    if (nextPos >= queue.length) setEnded({ at: Date.now() });
    else setPos(nextPos);
  }, [ended, entry, item, pos, queue.length]);

  // The session starts: telemetry once (a resumed one was counted when it started).
  useEffect(() => {
    if (!setup.resumed) track('container.session_started', { planned: count.of, kind: setup.only ?? (setup.topic ? 'topic' : 'plan') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // A new question: its top, the focus on its words, its clock.
  useEffect(() => {
    if (ended) return;
    shownAt.current = Date.now();
    committed.current = false;
    fixedNow.current = false;
    try {
      window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
    } catch {
      window.scrollTo(0, 0);
    }
    stemRef.current?.focus({ preventScroll: true });
  }, [pos, ended]);

  // «Ключ неверный?» opens below the question: bring it into view above the pinned bar.
  useEffect(() => {
    if (!keyOpen) return;
    const frame = window.requestAnimationFrame(() => {
      let still = false;
      try {
        still = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
      } catch {
        still = false;
      }
      keyRef.current?.scrollIntoView?.({ block: 'start', behavior: still ? 'auto' : 'smooth' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [keyOpen]);

  const merge = useCallback((list: AnswerResult[]) => {
    if (list.length === 0) return;
    setResults((current) => {
      const next = new Map(current);
      for (const result of list) if (result.client_event_id) next.set(result.client_event_id, result);
      return next;
    });
  }, []);

  /** The answer leaves the device (through the queue): once per shown question. */
  const commit = useCallback(
    (answer: Pending, at: number, recordsNow: StudyRecord[]): StudyRecord[] => {
      if (!item || !entry || committed.current) return recordsNow;
      committed.current = true;
      if (fixedNow.current) return recordsNow; // the key changed under it: the question starts again for everyone
      const clientEventId = `${setup.id}:${String(recordsNow.length + 1).padStart(2, '0')}`;
      const input: AnswerInput = {
        client_event_id: clientEventId,
        item_id: item.id,
        rev: item.rev,
        mode: 'learn',
        session_id: setup.id,
        local_date: dayIn(at, tz),
        ms: Math.max(0, Math.min(600_000, answer.at - shownAt.current)),
        cls: setup.cls[item.id] ?? 'free',
        ...(entry.retry > 0 ? { retry: true } : {}),
        ...(answer.misclick ? { misclick: true } : {}),
        ...(item.kind === 'short'
          ? { text: answer.dontKnow ? null : answer.text }
          : {
              chosen: answer.dontKnow ? null : item.kind === 'single' ? answer.chosen![0] : answer.chosen,
              shown_order: order,
            }),
      };
      const record: StudyRecord = {
        id: item.id,
        retry: entry.retry > 0,
        correct: answer.correct,
        dontKnow: answer.dontKnow,
        misclick: answer.misclick,
        clientEventId,
      };
      if (userId) {
        void enqueueAnswers(userId, [input]).then(merge, () => undefined);
      }
      return [...recordsNow, record];
    },
    [item, entry, setup.id, setup.cls, tz, order, userId, merge],
  );

  const persist = useCallback(
    (nextQueue: QueueEntry[], nextPos: number, nextRecords: StudyRecord[]) => {
      if (!userId) return;
      saveSession(userId, {
        v: 1,
        id: setup.id,
        containerId,
        day: today,
        subjectId: setup.subjectId,
        kind: 'answer',
        topic: setup.topic,
        only: setup.only,
        queue: nextQueue,
        pos: nextPos,
        startedAt: setup.startedAt,
        records: nextRecords,
      });
    },
    [userId, setup, containerId, today],
  );

  const finish = useCallback(
    (finalRecords: StudyRecord[]) => {
      if (timer.current) window.clearTimeout(timer.current);
      const at = Date.now();
      setRecords(finalRecords);
      setEnded({ at });
      if (userId) clearSession(userId, containerId);
      if (finalRecords.length > 0) {
        markKeysHintSeen();
        markFirstSessionDone();
        const answered = new Set(finalRecords.filter((r) => !r.retry).map((r) => r.id)).size;
        track('container.session_finished', {
          answered,
          retries: finalRecords.filter((r) => r.retry).length,
          minutes: Math.max(1, Math.round((at - setup.startedAt) / 60_000)),
        });
      }
      onEnded();
    },
    [userId, containerId, setup.startedAt, onEnded],
  );

  /** «Дальше»: the answer leaves, the queue takes a retry when the answer was wrong, the next question comes. */
  const next = useCallback(
    (auto = false) => {
      if (!pending || !entry || !item) return;
      if (timer.current) {
        window.clearTimeout(timer.current);
        timer.current = null;
      }
      const at = Date.now();
      const nextRecords = commit(pending, at, records);
      let nextQueue = queue;
      if (!fixedNow.current) {
        try {
          nextQueue = afterAnswer(queue, pos, { id: item.id, correct: pending.correct, misclick: pending.misclick }, seed);
        } catch {
          nextQueue = queue;
        }
      }
      if (aside.size > 0) nextQueue = [...nextQueue.slice(0, pos + 1), ...nextQueue.slice(pos + 1).filter((e) => !aside.has(e.id))];
      const nextPos = pos + 1;
      if (auto) advancedAt.current = at;
      setPending(null);
      setTicked([]);
      setText('');
      setHint(null);
      setKeyOpen(false);
      setDoubtOpen(false);
      if (nextPos >= nextQueue.length) {
        setQueue(nextQueue);
        finish(nextRecords);
        return;
      }
      setRecords(nextRecords);
      setQueue(nextQueue);
      setPos(nextPos);
      persist(nextQueue, nextPos, nextRecords);
    },
    [pending, entry, item, commit, records, queue, pos, seed, aside, finish, persist],
  );

  // The latest «next» for the timer and the keys.
  const nextRef = useRef(next);
  nextRef.current = next;

  const answer = (choice: { chosen: number[] | null; text: string | null }) => {
    if (!item || pending || ended) return;
    const dontKnow = item.kind === 'short' ? choice.text === null : choice.chosen === null;
    const correct = !dontKnow && gradeLocal(item, choice);
    const again = !correct && comesAgain(queue, pos, item.id, seed);
    setHint(null);
    setPending({ ...choice, dontKnow, correct, misclick: false, again, at: Date.now() });
    if (correct) {
      timer.current = window.setTimeout(() => {
        timer.current = null;
        nextRef.current(true);
      }, AUTO_MS);
    } else {
      window.setTimeout(() => fileRef.current?.scrollIntoView?.({ block: 'nearest' }), 0);
    }
  };

  const pick = (placeIndex: number) => {
    if (!item || pending) return;
    if (Date.now() - advancedAt.current < HOLD_GUARD_MS) return; // a held tap must not answer the next question
    const fileIndex = order[placeIndex];
    if (fileIndex === undefined) return;
    if (item.kind === 'multiple') {
      setHint(null);
      setTicked((list) => (list.includes(fileIndex) ? list.filter((v) => v !== fileIndex) : [...list, fileIndex]));
      return;
    }
    answer({ chosen: [fileIndex], text: null });
  };

  const submit = () => {
    if (!item || pending) return;
    if (item.kind === 'multiple') {
      if (ticked.length === 0) {
        setHint(copy.MULTIPLE_EMPTY);
        return;
      }
      answer({ chosen: [...ticked].sort((a, b) => a - b), text: null });
    } else if (item.kind === 'short') {
      if (text.trim() === '') {
        setHint(copy.SHORT_EMPTY);
        return;
      }
      answer({ chosen: null, text: text.trim() });
    }
  };

  const dontKnow = () => answer({ chosen: null, text: null });

  const misclick = () => {
    if (!pending || pending.correct || pending.misclick || committed.current) return;
    setPending({ ...pending, misclick: true, again: false });
  };

  // A tap anywhere in that second holds the right answer on screen.
  const hold = () => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }
  };

  /** «Закончить»: what was answered stays; the end screen, or straight back when nothing was answered. */
  const exit = () => {
    hold();
    const at = Date.now();
    const finalRecords = pending ? commit(pending, at, records) : records;
    if (finalRecords.length === 0) {
      if (userId) clearSession(userId, containerId);
      onDone(false);
      return;
    }
    setPending(null);
    finish(finalRecords);
  };

  // Leaving the page (closing the tab, another page of the app) sends the answer on screen as it is.
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  const commitRef = useRef(commit);
  commitRef.current = commit;
  const recordsRef = useRef(records);
  recordsRef.current = records;
  useEffect(() => {
    const flush = () => {
      if (pendingRef.current && !committed.current) commitRef.current(pendingRef.current, Date.now(), recordsRef.current);
    };
    window.addEventListener('pagehide', flush);
    return () => {
      window.removeEventListener('pagehide', flush);
      flush();
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, []);

  // Keys on a computer.
  const keyState = useRef({ pick, dontKnow, submit, misclick, pending, item, keyOpen, doubtOpen, ended });
  keyState.current = { pick, dontKnow, submit, misclick, pending, item, keyOpen, doubtOpen, ended };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const s = keyState.current;
      if (s.ended || !s.item || s.doubtOpen || event.ctrlKey || event.metaKey || event.altKey) return;
      const target = event.target as HTMLElement | null;
      const typing = Boolean(target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable));
      if (document.querySelector('[data-ct-sheet]')) return;
      if (event.key === 'Enter') {
        if (target && (target.tagName === 'BUTTON' || target.tagName === 'A') && !typing) return; // the button itself answers Enter
        if (s.pending) {
          event.preventDefault();
          nextRef.current();
        } else if (s.item.kind !== 'single' && !typing) {
          event.preventDefault();
          s.submit();
        }
        return;
      }
      if (typing || s.keyOpen) return;
      if (event.key === 'Backspace') {
        if (s.pending && !s.pending.correct && !s.pending.misclick) {
          event.preventDefault();
          s.misclick();
        }
        return;
      }
      if (s.pending) return;
      if (event.key === '0') {
        event.preventDefault();
        s.dontKnow();
        return;
      }
      const digit = /^[1-8]$/.test(event.key) ? Number(event.key) - 1 : LETTERS.indexOf(event.key.toUpperCase());
      if (digit >= 0 && s.item.kind !== 'short') {
        event.preventDefault();
        s.pick(digit);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // ── the end
  if (ended) {
    const effective = records.map((record) => {
      const result = results.get(record.clientEventId);
      return result && typeof result.correct === 'boolean' && (result.status === 'saved' || result.status === 'late') ? { ...record, correct: result.correct } : record;
    });
    const stats = summarize(effective, results, before.current ?? new Map(), today, tz);
    return (
      <SessionEnd
        containerId={containerId}
        summary={summary}
        subjectId={setup.subjectId}
        stats={stats}
        oral={null}
        minutes={Math.max(1, Math.round((ended.at - setup.startedAt) / 60_000))}
        base={base}
        plan={plan}
        input={input}
        answered={new Set(records.map((r) => r.id))}
        tz={tz}
        today={today}
        firstEver={firstEver.current}
        wide={wide}
        onDone={() => onDone(firstEver.current)}
      />
    );
  }

  const bar = (
    <RoomBar
      long={copy.glue(`${subject} · ${copy.counter(count.n, count.of)}`)}
      short={copy.counter(count.n, count.of)}
      exitLabel={copy.FINISH}
      onExit={exit}
    />
  );
  if (!item || !entry) return <>{bar}</>;

  // ── the question
  const answered: Answered | null = pending
    ? { chosen: pending.chosen, text: pending.text, dontKnow: pending.dontKnow, correct: !pending.dontKnow && gradeLocal(item, pending) }
    : null;
  const topicTitle = item.topic ? summary.subjects.find((s) => s.id === item.subject_id)?.topic_titles[item.topic - 1] : undefined;
  const topicNo = topicNumber(topicTitle);
  const context = [
    subject,
    entry.retry > 0 ? copy.RETRY_TAG : null,
    pending ? copy.fileNo(item.file_no || String(item.position)) : null,
    pending && topicNo ? copy.topicNo(topicNo) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  let verdict: string | null = null;
  if (pending && answered) {
    // A mistake comes back on the next study day (input.studyWeekdays), as the end of the session says: «завтра», or
    // «в понедельник» when tomorrow is a day off.
    const back = comesBackWhen(today, input.studyWeekdays);
    if (fixedNow.current) verdict = copy.VERDICT_KEY_FIXED;
    else if (pending.misclick) verdict = copy.misclickLine(back);
    else if (answered.correct) verdict = item.kind === 'multiple' ? copy.verdictRightAll(item.correct.length) : copy.VERDICT_RIGHT;
    else if (item.kind === 'short') {
      const form = item.answers[0] ?? '';
      verdict = pending.dontKnow ? copy.shortDontKnow(form, pending.again, back) : copy.verdictShortWrong(form, pending.again, back);
    } else {
      // The key in the file's own words: the screen's letters are shuffled, the key panel and «Ключи» use the file's.
      const names = keyNames(item);
      verdict = pending.dontKnow ? copy.verdictDontKnow(names, pending.again, back) : copy.verdictWrong(names, pending.again, back);
    }
  }

  const notes: string[] = [];
  if (pending) {
    if (item.key_source === 'manual') notes.push(author ? copy.NOTE_MANUAL_OWN : copy.NOTE_MANUAL_AUTHOR);
    if (!author && item.rev > 1 && item.updated_at) notes.push(copy.noteKeyFixed(dayText(item.updated_at.slice(0, 10))));
  }

  const under: ReactNode[] = [];
  if (pending) {
    // After a key fix in place the answer is not sent: neither «Нажали не туда?» nor a doubt means anything then.
    const fixed = fixedNow.current;
    if (!answered!.correct && !pending.misclick && !committed.current && !fixed) {
      under.push(
        <button key="misclick" type="button" className="sf-link" onClick={misclick}>
          {copy.MISCLICK}
        </button>,
      );
    }
    // A member doubts the key; the author — a solo student too, the author of their own exam — fixes it (the bot
    // spec's decision 17): one key link each, never both.
    if (!author && !aside.has(item.id) && !fixed) {
      under.push(
        <button key="doubt" type="button" className="sf-link" data-muted="" aria-haspopup="dialog" onClick={() => setDoubtOpen(true)}>
          {copy.DOUBT}
        </button>,
      );
    }
    if (author) {
      under.push(
        <button key="key" type="button" className="sf-link" data-muted="" aria-expanded={keyOpen} onClick={() => setKeyOpen((v) => !v)}>
          {copy.KEY_WRONG}
        </button>,
      );
    }
  }

  const needsSubmit = !pending && (item.kind === 'multiple' || item.kind === 'short');
  return (
    <>
      {bar}
      <main className="sf-page ct-study" onPointerDown={pending?.correct ? hold : undefined}>
        {offline ? <p className="ct-offline">{copy.OFFLINE_STUDY}</p> : null}
        <QuestionCard
          item={item}
          order={order}
          context={context}
          mode="learn"
          answered={answered}
          ticked={ticked}
          text={text}
          textInvalid={hint === copy.SHORT_EMPTY}
          hint={hint ? <p className="ct-hint" data-tone="warn" role="alert">{hint}</p> : null}
          onPick={pick}
          onText={(value) => {
            setText(value);
            if (hint) setHint(null);
          }}
          onSubmitText={submit}
          stemRef={stemRef}
          fileRef={fileRef}
        />
        {under.length > 0 ? <div className="ct-under">{under}</div> : null}
        {notes.length > 0 ? (
          <div className="ct-notes-q">
            {notes.map((note) => (
              <p key={note}>{note}</p>
            ))}
          </div>
        ) : null}
        {keyOpen && pending && author ? (
          <div ref={keyRef} className="ct-key-at">
            <KeyFix
              item={item}
              typed={pending.text}
              group={hasGroup(summary)}
              onFixed={(patch) => {
                fixedNow.current = true;
                setPatches((current) => ({ ...current, [item.id]: patch }));
              }}
              onCancel={() => setKeyOpen(false)}
            />
          </div>
        ) : null}
        {!pending ? (
          <div className="ct-under ct-dontknow">
            <button type="button" className="sf-link" onClick={dontKnow}>
              {copy.DONT_KNOW}
            </button>
          </div>
        ) : null}
        {wide && showKeys.current && item.kind !== 'short' ? <p className="ct-keyshint">{copy.KEYS_HINT}</p> : null}
        {pending || needsSubmit ? (
          <div className="ct-bar">
            {verdict ? (
              <p className="ct-verdict" role="status" data-tone={answered?.correct && !pending?.misclick ? 'right' : undefined}>
                {verdict}
              </p>
            ) : null}
            <div className="ct-bar-row" style={wide ? undefined : { width: '100%' }}>
              {pending ? (
                <button type="button" className="sf-primary" onClick={() => next()}>
                  {copy.NEXT}
                </button>
              ) : (
                <button type="button" className="sf-primary" onClick={submit}>
                  {copy.ANSWER}
                </button>
              )}
            </div>
          </div>
        ) : null}
      </main>
      {doubtOpen && pending ? (
        <DoubtSheet
          item={item}
          proposed={pending.chosen}
          author={author}
          onDone={() => setAside((current) => new Set(current).add(item.id))}
          onClose={() => setDoubtOpen(false)}
        />
      ) : null}
    </>
  );
}
