import { useEffect, useState, type ReactNode } from 'react';
import type { ContainerSummary } from '../../types/container';
import type { GroupSummary } from '../../types/groupSummary';
import { fetchGroupSummary } from '../../api/containers';
import { useAuth } from '../../hooks/useAuth';
import { dayText } from '../../lib/containers/words';
import { NoteLine, Sheet } from './ui';
import * as copy from './copy';
import { groupSummaryState } from './model';
import { GROUP_NOTE_JOINED_BEFORE, groupNoteSeen, markGroupNoteSeen } from './sessionStore';

/**
 * The group's summary without names (owner, 2026-11-09; docs/answers-privacy.md; container_group_summary).
 *
 * The author of an exam could see only who came in, so a group that had stopped studying looked the same as one that
 * had not. From 5 members the exam's page says one quiet line under its rows — «Группа: на этой неделе занимались 6 из
 * 19, в среднем выучено 40 %. Подробнее» — and «Подробнее» opens the sheet «Группа»: this week, the week before, ever,
 * the average share learned, the hard topics. No card and no button of the page's own (the owner finds the page full
 * already). The numbers are the group's: never a name, never a person's answers.
 *
 * For 7 days after the author removed a member the database gives no numbers (before and after they would differ by
 * that one person; «Вернуть» ends it at once). The line then says when the summary is there again and why — «Сводка
 * группы снова появится 16 ноября: состав группы менялся.» — with nothing to open.
 *
 * The read is lazy: only for the author, only from 5 members, only for an exam with questions that count, and not
 * without network. Its failure is quiet: no line. The line's place is kept from the first paint (a hidden line of the
 * same words), and the line is the last of the notes, so nothing moves when the numbers come, or when they do not.
 * Coming back to the page within a minute shows the last numbers at once.
 *
 * The other side: a member who came in while the invitation promised that nobody sees their progress reads once, in
 * the same quiet place, that the author now sees the group's numbers (useGroupNotice).
 */

/** A read this young is not asked for again when the page is opened once more. */
export const GROUP_FRESH_MS = 60_000;

interface Read {
  at: number;
  members: number;
  promise: Promise<GroupSummary>;
}
/** The reads of this tab, by exam: one in flight is shared, a young one reused. Gone with a reload. */
const reads = new Map<string, Read>();
/** The last numbers read of each exam, for the first paint of a page opened again. */
const last = new Map<string, GroupSummary>();

export function resetGroupSummaryForTests(): void {
  reads.clear();
  last.clear();
}

function readGroup(containerId: string, members: number): Promise<GroupSummary> {
  const kept = reads.get(containerId);
  if (kept && kept.members === members && Date.now() - kept.at < GROUP_FRESH_MS) return kept.promise;
  const promise = fetchGroupSummary(containerId);
  reads.set(containerId, { at: Date.now(), members, promise });
  promise.then(
    (value) => {
      last.set(containerId, value);
    },
    () => {
      // A failed read is not kept: the next visit asks again.
      if (reads.get(containerId)?.promise === promise) reads.delete(containerId);
    },
  );
  return promise;
}

/**
 * The author's line and its sheet. `line` goes last among the page's quiet notes (null when there is nothing to say
 * or to keep room for); `sheet` goes on the page. `enabled` false — the page does not carry the line (a subject of
 * several) or has no network to read it with.
 */
export function useGroupLine(summary: ContainerSummary, enabled: boolean): { line: ReactNode; sheet: ReactNode } {
  const id = summary.id;
  const members = summary.owner?.members ?? 0;
  const wanted = enabled && groupSummaryState(summary) === 'ready';
  const [state, setState] = useState<{ id: string; value: GroupSummary | null; done: boolean }>(() => ({ id, value: last.get(id) ?? null, done: last.has(id) }));
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!wanted) return undefined;
    let live = true;
    readGroup(id, members).then(
      (value) => {
        if (live) setState({ id, value, done: true });
      },
      () => {
        // Quiet: the numbers already on the page stay; without any, the page says nothing of the group.
        if (live) setState((current) => (current.id === id && current.value ? current : { id, value: null, done: true }));
      },
    );
    return () => {
      live = false;
    };
  }, [wanted, id, members]);

  if (!wanted) return { line: null, sheet: null };
  // Another exam in the same page (the address changed): its own last numbers, or its place kept.
  const current = state.id === id ? state : { id, value: last.get(id) ?? null, done: last.has(id) };
  const numbers = current.value?.numbers ?? null;
  const pausedDay = current.value?.paused_until ? pausedDayText(current.value.paused_until) : '';
  // The pause: one line with nothing to press; an open sheet goes with the numbers it showed.
  if (pausedDay) return { line: <NoteLine key="group" text={copy.groupPaused(pausedDay)} />, sheet: null };
  if (!current.value || !numbers) {
    if (current.done) return { line: null, sheet: null };
    return {
      line: (
        <p key="group" className="ct-note" data-wait="" aria-hidden="true">
          {copy.groupLinePlace(members)} {copy.GROUP_MORE}
        </p>
      ),
      sheet: null,
    };
  }
  const line = (
    <NoteLine
      key="group"
      text={copy.groupLine(numbers.studied_7d, current.value.members, numbers.learned_pct)}
      action={
        <button type="button" className="sf-link" aria-haspopup="dialog" onClick={() => setOpen(true)}>
          {copy.GROUP_MORE}
        </button>
      }
    />
  );
  const sheet = open ? (
    <GroupSheet
      value={current.value}
      severalSubjects={summary.subjects.length > 1}
      oral={summary.subjects.some((subject) => subject.oral)}
      onClose={() => setOpen(false)}
    />
  ) : null;
  return { line, sheet };
}

/** «16 ноября» of the pause's day; '' for a day the words cannot read (then the page says nothing). */
function pausedDayText(day: string): string {
  try {
    return dayText(day);
  } catch {
    return '';
  }
}

/** «Группа»: the counts, the share, the hard topics, and that it has no names. Nothing to do in it but read. */
export function GroupSheet({ value, severalSubjects, oral, onClose }: { value: GroupSummary; severalSubjects: boolean; oral: boolean; onClose: () => void }) {
  const numbers = value.numbers;
  if (!numbers) return null;
  const members = value.members;
  return (
    <Sheet title={copy.GROUP_TITLE} onClose={onClose}>
      <ul className="ct-days">
        <li>{copy.groupWeekRow(numbers.studied_7d, members)}</li>
        <li>{copy.groupPrevRow(numbers.studied_prev_7d, members)}</li>
        <li>{copy.groupEverRow(numbers.studied_ever, members)}</li>
        {numbers.learned_pct !== null ? <li>{copy.groupLearnedRow(numbers.learned_pct)}</li> : null}
      </ul>
      <h3 className="ct-sheet-h">{copy.GROUP_HARD}</h3>
      {numbers.hard_topics.length > 0 ? (
        <ul className="ct-days">
          {numbers.hard_topics.map((topic) => (
            <li key={`${topic.subject}|${topic.topic ?? ''}`}>{copy.groupTopicRow(topic, severalSubjects)}</li>
          ))}
        </ul>
      ) : (
        <p>{copy.GROUP_NO_HARD}</p>
      )}
      <p data-muted="">
        {copy.GROUP_NO_NAMES}
        {oral ? ` ${copy.GROUP_NO_ORAL}` : null}
      </p>
    </Sheet>
  );
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The member's one-time note, a quiet line of the page (last among its notes) with «Понятно»: for a member who came in
 * before the invitation said what the author sees (sessionStore GROUP_NOTE_JOINED_BEFORE; a day of coming in that is
 * not known counts as before), once per account and exam on this device. Null when there is nothing to say.
 */
export function useGroupNotice(summary: ContainerSummary): ReactNode {
  const { user } = useAuth();
  const userId = user?.id ?? null;
  // «Понятно» in this visit, by exam: the line goes at once, whether or not the device kept it.
  const [told, setTold] = useState<string | null>(null);
  if (summary.role !== 'member' || !userId) return null;
  const joined = summary.first_plan_day;
  if (typeof joined === 'string' && DAY.test(joined) && joined >= GROUP_NOTE_JOINED_BEFORE) return null;
  if (told === summary.id || groupNoteSeen(userId, summary.id)) return null;
  const ok = () => {
    markGroupNoteSeen(userId, summary.id);
    setTold(summary.id);
  };
  return (
    <NoteLine
      key="group-note"
      text={copy.GROUP_MEMBER_NOTE}
      action={
        <button type="button" className="sf-link" onClick={ok}>
          {copy.GROUP_MEMBER_OK}
        </button>
      }
    />
  );
}
