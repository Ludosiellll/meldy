import type { ContainerSummary, DayKey } from '../../../types/container';

/**
 * The links of an exam as «Пригласить группу» shows them (20261107090200, the owner's report of 04.11: a new link had
 * closed the one 19 members joined by, without a word, and a link died at the exam's old date). Pure: the moment is
 * passed in. A link is open while it is not closed and its end is ahead; the end container_link_extend gives is the
 * later of 120 days from now and 30 days after the exam's last date (00:00 UTC), as the database counts it.
 */

export type ExamLink = NonNullable<ContainerSummary['owner']>['links'][number];
export type LinkState = 'open' | 'expired' | 'revoked';

const DAY_MS = 24 * 60 * 60 * 1000;
const NEW_LINK_DAYS = 120;
const AFTER_EXAM_DAYS = 30;

export function linkState(link: ExamLink, now: number): LinkState {
  if (link.revoked_at) return 'revoked';
  if (link.expires_at && Date.parse(link.expires_at) <= now) return 'expired';
  return 'open';
}

/** Newest first. */
export function byNewest(links: readonly ExamLink[]): ExamLink[] {
  return [...links].sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
}

/**
 * The exam's last date as the database reads it for a link (link_date_end): the exam's own and every subject's. With
 * the author's own date set the summary's dates are that one, so only the exam's own common date is known.
 */
export function lastExamDay(summary: ContainerSummary): DayKey | null {
  const days: DayKey[] = [];
  if (summary.own_exam_date) {
    if (summary.author_exam_date) days.push(summary.author_exam_date);
  } else {
    if (summary.exam_date) days.push(summary.exam_date);
    for (const subject of summary.subjects) if (subject.exam_date) days.push(subject.exam_date);
  }
  return days.length > 0 ? days.sort()[days.length - 1] : null;
}

/** The end «Продлить» / «Открыть снова» gives (container_link_extend), in ms. */
export function extendedEnd(summary: ContainerSummary, now: number): number {
  const floor = now + NEW_LINK_DAYS * DAY_MS;
  const last = lastExamDay(summary);
  if (!last) return floor;
  const afterExam = Date.parse(`${last}T00:00:00Z`) + AFTER_EXAM_DAYS * DAY_MS;
  return Number.isFinite(afterExam) ? Math.max(floor, afterExam) : floor;
}

/** «Продлить» means something: an open link with an end that the rule moves on by a day or more. */
export function canExtend(link: ExamLink, summary: ContainerSummary, now: number): boolean {
  if (linkState(link, now) !== 'open' || !link.expires_at) return false;
  return extendedEnd(summary, now) - Date.parse(link.expires_at) >= DAY_MS;
}

/** The local day of a moment (the device's zone), «2026-10-14»; null for a missing or broken value. */
export function localDayOf(iso: string | null | undefined): DayKey | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
