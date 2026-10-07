/**
 * The exam «Сегодня» leads with (pages/Dashboard.tsx), here so that «Профиль» names the same exam without the
 * page: the daily reminder's calendar event is one per student and exam (lib/reminders/ics.ts reminderUid).
 */
import type { ExamRow } from '../../api/exams';
import { supabase } from '../supabase';
import { isDateKey, localDateKey, shiftDateKey } from '../../utils/streak';

/** Exams dated from today up to this many days ahead lead «Сегодня». */
export const EXAM_HORIZON_DAYS = 21;

/**
 * The exam «Сегодня» leads with: the nearest one dated from today up to three weeks ahead; without
 * one, the newest exam that has no date (a list pasted without a date is still the student's exam).
 */
export function pickExam(exams: Array<Pick<ExamRow, 'id' | 'exam_date' | 'created_at'>>, today: string = localDateKey()): string | null {
  const horizon = shiftDateKey(today, EXAM_HORIZON_DAYS);
  const near = exams
    .filter((exam) => isDateKey(exam.exam_date) && exam.exam_date >= today && exam.exam_date <= horizon)
    .sort((a, b) => (a.exam_date! < b.exam_date! ? -1 : a.exam_date! > b.exam_date! ? 1 : a.created_at > b.created_at ? -1 : 1));
  if (near.length > 0) return near[0].id;
  const undated = exams.filter((exam) => !exam.exam_date).sort((a, b) => (a.created_at > b.created_at ? -1 : 1));
  return undated.length > 0 ? undated[0].id : null;
}

/** The account's leading exam, read with three columns per exam; null without one. Throws when unreadable. */
export async function leadingExamId(userId: string): Promise<string | null> {
  const { data, error } = await supabase.from('exams').select('id, exam_date, created_at').eq('user_id', userId);
  if (error) throw error;
  const rows = (Array.isArray(data) ? data : []).filter(
    (row): row is Pick<ExamRow, 'id' | 'exam_date' | 'created_at'> =>
      typeof row === 'object' && row !== null && typeof (row as { id?: unknown }).id === 'string' && typeof (row as { created_at?: unknown }).created_at === 'string',
  );
  return pickExam(rows.map((row) => ({ id: row.id, exam_date: isDateKey(row.exam_date) ? row.exam_date : null, created_at: row.created_at })));
}
