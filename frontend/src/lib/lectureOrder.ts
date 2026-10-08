/**
 * The order of an exam's lectures, the same in «Лекции» and on «Карта знаний» (finding LIB-7: «Лекция 1» of
 * the map was lecture 3 of the list). By the time a lecture was added to the exam (exam_materials.added_at);
 * lectures added together — one request attaches several at once, with one time — by their own date
 * (materials.created_at, older first); then by their place in the list as it was read.
 */

function timeOf(value: string | null | undefined): number {
  const time = typeof value === 'string' && value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(time) ? time : Number.NaN;
}

/** Earlier first; a missing or unreadable time counts as equal, so the next key decides. */
function compareTimes(a: string | null | undefined, b: string | null | undefined): number {
  const ta = timeOf(a);
  const tb = timeOf(b);
  if (Number.isNaN(ta) || Number.isNaN(tb) || ta === tb) return 0;
  return ta - tb;
}

export interface ExamLectureLink {
  id: string;
  addedAt?: string | null;
}

/** The exam's links in the order both pages number them (a new array; each id once, its first link). */
export function orderExamLectures<T extends ExamLectureLink>(links: readonly T[], createdAtOf: (id: string) => string | null | undefined): T[] {
  const seen = new Set<string>();
  return links
    .map((link, index) => ({ link, index }))
    .filter(({ link }) => {
      if (seen.has(link.id)) return false;
      seen.add(link.id);
      return true;
    })
    .sort((a, b) => compareTimes(a.link.addedAt, b.link.addedAt) || compareTimes(createdAtOf(a.link.id), createdAtOf(b.link.id)) || a.index - b.index)
    .map(({ link }) => link);
}
