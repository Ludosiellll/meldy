/**
 * Who the account is on today's screens (UX audit of 06.11, the owner of 07.11: «если уверен, что это не нужно, то
 * убирай»): a group student, an author, or a new account. Read from what the app already loads — containers_overview's
 * role per exam, the lectures, the account's own exams of the old kind — with no database change.
 *
 * - 'member' — every exam of the account is someone else's (role 'member') and it owns nothing: no exam, no test, no
 *   lecture. A group student who came by a link. The first own lecture, import or test makes it an author.
 * - 'author' — it owns an exam or a test, or has a lecture, or an exam of the old kind outside any container.
 * - 'new' — nothing at all yet.
 * - 'unknown' — a part could not be read (or has not come yet): the screens then stay as they are for everyone.
 *
 * A screen passes only what it reads: `lectures` or `ownExams` left out (undefined) are not asked; null is «not known».
 */
import { supabase } from './supabase';
import type { ContainerRole } from '../types/container';

export type AccountShape = 'member' | 'author' | 'new' | 'unknown';

export interface AccountFacts {
  /** containers_overview's exams and tests; null while it has not answered, or when the containers cannot be read. */
  containers: ReadonlyArray<{ role: ContainerRole }> | null;
  /** The account's own lectures: undefined — this screen does not ask; null — not known. */
  lectures?: number | null;
  /** The account's own exams of the old kind that live in no container: undefined — not asked; null — not known. */
  ownExams?: number | null;
}

export function accountShape({ containers, lectures, ownExams }: AccountFacts): AccountShape {
  if (containers === null) return 'unknown';
  if (containers.some((container) => container.role !== 'member')) return 'author';
  if ((lectures ?? 0) > 0 || (ownExams ?? 0) > 0) return 'author';
  if (lectures === null || ownExams === null) return 'unknown';
  return containers.length > 0 ? 'member' : 'new';
}

/** Only a member of someone else's exams, for certain: the screens may leave out what is the author's. */
export function isMemberOnly(facts: AccountFacts): boolean {
  return accountShape(facts) === 'member';
}

/**
 * What a screen that does not read them itself needs besides the overview: the number of the account's lectures and of
 * its own exams of the old kind outside the containers (`attached`: containers_overview.attached_exam_ids — a member's
 * copy of an oral part is one of them). A count that cannot be read is null. One HEAD request and one list of ids.
 */
export async function readOwnWork(userId: string, attached: readonly string[]): Promise<{ lectures: number | null; ownExams: number | null }> {
  const lectures = async (): Promise<number | null> => {
    try {
      const { count, error } = await supabase.from('materials').select('id', { count: 'exact', head: true }).eq('user_id', userId);
      return error || typeof count !== 'number' ? null : Math.max(0, count);
    } catch {
      return null;
    }
  };
  const ownExams = async (): Promise<number | null> => {
    try {
      const { data, error } = await supabase.from('exams').select('id').eq('user_id', userId);
      if (error || !Array.isArray(data)) return null;
      const inside = new Set(attached);
      return (data as Array<{ id?: unknown }>).filter((row) => typeof row.id === 'string' && !inside.has(row.id)).length;
    } catch {
      return null;
    }
  };
  const [lectureCount, examCount] = await Promise.all([lectures(), ownExams()]);
  return { lectures: lectureCount, ownExams: examCount };
}
