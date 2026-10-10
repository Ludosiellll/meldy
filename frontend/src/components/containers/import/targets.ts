/**
 * «Куда добавить» on the import page (spec decision 22): a new exam, an exam of the student's own that already has
 * subjects (a container they own), or one of their plain oral exams — that exam then becomes subject 1 of a new exam
 * (container_create with its exam_id). An oral exam already inside a container (containers_overview.attached_exam_ids)
 * is not offered: an exam is a subject of one container at most.
 */
import { supabase } from '../../../lib/supabase';
import type { ContainersOverview } from '../../../types/container';

export interface OldExam {
  id: string;
  title: string;
  exam_date: string | null;
}

export interface ContainerTarget {
  id: string;
  title: string;
  exam_date: string | null;
  subjects: number;
  items: number;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The student's plain oral exams, newest first (at most 50): id, title, date. Never throws: [] when unreadable. */
export async function fetchOldExams(userId: string, attached: readonly string[]): Promise<OldExam[]> {
  try {
    const { data, error } = await supabase
      .from('exams')
      .select('id, title, exam_date')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(50);
    if (error || !Array.isArray(data)) return [];
    const skip = new Set(attached);
    return data
      .filter((row): row is { id: string; title: string; exam_date: string | null } => typeof row?.id === 'string' && typeof row?.title === 'string')
      .filter((row) => !skip.has(row.id))
      .map((row) => ({ id: row.id, title: row.title.trim(), exam_date: typeof row.exam_date === 'string' && DAY.test(row.exam_date) ? row.exam_date : null }));
  } catch {
    return [];
  }
}

/** The containers the student may add subjects to: their own. */
export function ownContainers(overview: ContainersOverview | null | undefined): ContainerTarget[] {
  return (overview?.containers ?? [])
    .filter((container) => container.role === 'owner')
    .map((container) => ({
      id: container.id,
      title: container.title,
      exam_date: container.exam_date,
      subjects: container.subjects.length,
      items: container.items,
    }));
}
