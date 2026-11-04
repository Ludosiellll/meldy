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
/** A link's end from the dates never passes this (link_date_end's cap). */
const MAX_DAYS = 760;
/** The dates the database counts (and takes): 2000-01-01..2100-12-31. */
const inRange = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && day >= '2000-01-01' && day <= '2100-12-31';

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
 * The exam's last date as the database reads it for a link (link_date_end): the exam's own, every subject's and every
 * subject's oral exam's, 2000..2100 only. `days`: those dates as read from the exam's own rows (InviteExam reads them:
 * api/containers.ts fetchExamDays); without them the summary's — where, with the author's own date set, every date is
 * that one, so only the exam's common date is known.
 */
export function lastExamDay(summary: ContainerSummary, days?: readonly string[] | null): DayKey | null {
  const known: string[] = [];
  if (summary.own_exam_date) {
    if (summary.author_exam_date) known.push(summary.author_exam_date);
  } else {
    if (summary.exam_date) known.push(summary.exam_date);
    for (const subject of summary.subjects) if (subject.exam_date) known.push(subject.exam_date);
  }
  if (days) known.push(...days);
  const usable = known.filter(inRange).sort();
  return usable.length > 0 ? (usable[usable.length - 1] as DayKey) : null;
}

/** The end «Продлить» / «Открыть снова» gives (container_link_extend), in ms. */
export function extendedEnd(summary: ContainerSummary, now: number, days?: readonly string[] | null): number {
  const floor = now + NEW_LINK_DAYS * DAY_MS;
  const last = lastExamDay(summary, days);
  if (!last) return floor;
  const afterExam = Math.min(Date.parse(`${last}T00:00:00Z`) + AFTER_EXAM_DAYS * DAY_MS, now + MAX_DAYS * DAY_MS);
  return Number.isFinite(afterExam) ? Math.max(floor, afterExam) : floor;
}

/** «Продлить» means something: an open link with an end that the rule moves on by a day or more. */
export function canExtend(link: ExamLink, summary: ContainerSummary, now: number, days?: readonly string[] | null): boolean {
  if (linkState(link, now) !== 'open' || !link.expires_at) return false;
  return extendedEnd(summary, now, days) - Date.parse(link.expires_at) >= DAY_MS;
}

/** The local day of a moment (the device's zone), «2026-10-14»; null for a missing or broken value. */
export function localDayOf(iso: string | null | undefined): DayKey | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
