import { useEffect, useMemo, useRef, useState } from 'react';
import { oralSync } from '../../api/containers';
import type { ContainerSummary, SummarySubject } from '../../types/container';
import { count } from './copyImport';

/**
 * A member's oral subjects that have no copy of theirs yet (audit of 04.11). The copies are made by the backend's
 * oral-sync (backend/container_shares.py) when the member joins by /g/<code>; the page never asked again, so a copy
 * that did not come then — the link had closed or expired, the call timed out, a subject was added later — never came,
 * and the subject just read «вопросов пока нет». The exam's page now asks once when it finds such a subject: a copy
 * made reads the exam again; a subject the server answers «closed» for (no open link with the author's consent, or its
 * oral link closed) is named with the way on: the author opens the link again («Открыть снова», 20261107090200), and
 * the next visit brings the copy. One call per exam per ASK_GAP_MS: the route allows 6 a minute.
 */

export const ORAL_COPIES = {
  closed: (titles: readonly string[]) =>
    `Устные вопросы ${titles.length === 1 ? `по предмету «${titles[0]}»` : `по ${count(titles.length, 'предмету', 'предметам', 'предметам')}`} не пришли: ссылка экзамена больше не работает. Попросите автора открыть её снова.`,
} as const;

/** One oral-sync of an exam this often at most (the page reads its data again after a copy). */
export const ASK_GAP_MS = 60_000;
const askedAt = new Map<string, number>();

export function resetOralCopiesForTests(): void {
  askedAt.clear();
}

/** /g/<code> asked for the copies of this exam just now (the join): the exam page does not ask again at once. */
export function markOralAsked(containerId: string): void {
  askedAt.set(containerId, Date.now());
}

export function askedRecently(containerId: string): boolean {
  const last = askedAt.get(containerId);
  return last !== undefined && Date.now() - last < ASK_GAP_MS;
}

/** A member's oral subjects without their copy: the summary gives the subject's oral part with no exam of theirs. */
export function missingOral(summary: ContainerSummary): SummarySubject[] {
  if (summary.role !== 'member') return [];
  return summary.subjects.filter((subject) => subject.oral && !subject.oral.exam_id);
}

export function useOralCopies(summary: ContainerSummary, reload: () => void): { closed: string[]; line: string | null } {
  const missing = useMemo(() => missingOral(summary), [summary]);
  const key = missing.length > 0 ? `${summary.id}:${missing.map((subject) => subject.id).join(',')}` : '';
  const [closed, setClosed] = useState<string[]>([]);
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  const titles = useRef(new Map<string, string>());
  titles.current = new Map(summary.subjects.map((subject) => [subject.id, subject.title]));

  useEffect(() => {
    if (!key) {
      setClosed([]);
      return undefined;
    }
    if (askedRecently(summary.id)) return undefined;
    markOralAsked(summary.id);
    let live = true;
    oralSync(summary.id).then(
      (result) => {
        if (!live) return;
        const rows = result.oral ?? [];
        setClosed(rows.filter((row) => row.status === 'closed').map((row) => titles.current.get(row.subject_id) ?? '').filter(Boolean));
        if (rows.some((row) => row.status === 'copied' || row.status === 'bound')) reloadRef.current();
      },
      () => {
        // Nothing to say: the subject reads as before and the next visit asks again.
      },
    );
    return () => {
      live = false;
    };
  }, [key, summary.id]);

  return { closed, line: closed.length > 0 ? ORAL_COPIES.closed(closed) : null };
}
