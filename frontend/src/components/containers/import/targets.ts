/**
 * «Куда добавить» on the import page (spec decision 22): a new exam, an exam of the student's own that already has
 * subjects (a container they own), or one of their plain oral exams — that exam then becomes subject 1 of a new exam
 * (container_create with its exam_id). An oral exam already inside a container (containers_overview.attached_exam_ids)
 * is not offered: an exam is a subject of one container at most.
 *
 * Two targets of one name are told apart as the exam lists show them — the date and the number of questions — and,
 * when even those are equal (a copy of the same list), by the day the exam was made (usability check 2026-10-10, m4:
 * «К «Базы данных»» was listed twice).
 */
import { listExams } from '../../../api/exams';
import type { ContainersOverview, LocalDay } from '../../../types/container';
import { IMPORT, dayText } from '../copyImport';

export interface OldExam {
  id: string;
  title: string;
  exam_date: string | null;
  /** Its questions, as «Экзамены» counts them. */
  questions: number;
  created_at: string;
}

export interface ContainerTarget {
  id: string;
  title: string;
  exam_date: string | null;
  subjects: number;
  items: number;
  created_at: string;
  /** The test dates of its subjects and its own, sorted, each once. */
  dates: string[];
  /** The oral exams of its subjects: their questions are part of its size. */
  oralExamIds: string[];
}

export interface TargetOption {
  value: string;
  label: string;
}

/** At most this many plain oral exams are offered, newest first. */
export const OLD_EXAMS_SHOWN = 50;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Every oral exam of the student with its number of questions (api/exams.ts listExams, the read of «Экзамены»), newest
 * first — those inside an exam too, whose questions are part of that exam's size. Never throws: [] when unreadable.
 */
export async function fetchOldExams(userId: string): Promise<OldExam[]> {
  try {
    const items = await listExams(userId);
    return items
      .filter((item) => typeof item?.id === 'string' && typeof item.title === 'string')
      .map((item) => ({
        id: item.id,
        title: item.title.trim(),
        exam_date: typeof item.exam_date === 'string' && DAY.test(item.exam_date) ? item.exam_date : null,
        questions: Number.isFinite(item.total) ? Math.max(0, item.total) : 0,
        created_at: typeof item.created_at === 'string' ? item.created_at : '',
      }))
      .sort((a, b) => (a.created_at > b.created_at ? -1 : a.created_at < b.created_at ? 1 : 0));
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
      created_at: container.created_at,
      dates: Array.from(new Set([container.exam_date, ...container.subjects.map((subject) => subject.exam_date)].filter((day): day is string => Boolean(day)))).sort(),
      oralExamIds: container.subjects.map((subject) => subject.oral_exam_id).filter((id): id is string => Boolean(id)),
    }));
}

/** The plain oral exams that can join an exam: not inside one already, newest first, at most OLD_EXAMS_SHOWN. */
export function plainExams(exams: readonly OldExam[], attached: readonly string[]): OldExam[] {
  const inside = new Set(attached);
  return exams.filter((exam) => !inside.has(exam.id)).slice(0, OLD_EXAMS_SHOWN);
}

/** «21 октября» of a moment's local day, and its time «14:05». */
function madeAt(iso: string): { day: string; time: string } | null {
  const at = new Date(iso);
  if (!iso || Number.isNaN(at.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  return { day: dayText(day), time: `${at.getHours()}:${pad(at.getMinutes())}` };
}

/** A target and its labels, each telling it apart more than the one before: the name, then its date and size, then the day it was made, then its time. */
interface Candidate {
  value: string;
  levels: string[];
}

/** Every label two targets share moves on to its next level, until none is shared or no level is left. */
function apart(candidates: readonly Candidate[]): string[] {
  const level = candidates.map(() => 0);
  const key = (index: number) => candidates[index].levels[level[index]].toLocaleLowerCase('ru-RU');
  for (;;) {
    const counts = new Map<string, number>();
    candidates.forEach((_, index) => counts.set(key(index), (counts.get(key(index)) ?? 0) + 1));
    const shared = candidates.map((candidate, index) => (counts.get(key(index)) ?? 0) > 1 && level[index] + 1 < candidate.levels.length);
    if (!shared.some(Boolean)) break;
    shared.forEach((move, index) => {
      if (move) level[index] += 1;
    });
  }
  return candidates.map((candidate, index) => candidate.levels[level[index]]);
}

function levelsOf(name: string, detail: string, createdAt: string): string[] {
  const base = IMPORT.targetTo(name);
  const levels = [base, `${base} · ${detail}`];
  const made = madeAt(createdAt);
  if (made) levels.push(`${levels[1]} · ${IMPORT.targetMade(made.day, null)}`, `${levels[1]} · ${IMPORT.targetMade(made.day, made.time)}`);
  return levels;
}

/**
 * The options of «Куда добавить»: «Новый экзамен», the student's own exams with subjects, then their plain oral exams.
 * A name two of them share gets the date (the nearest ahead of `today`, else the last) and the size as «Экзамены»
 * says them («К «Базы данных» · 21 октября · 20 вопросов»; an exam's size counts its oral parts); copies equal in both
 * get the day they were made, then its time.
 */
export function targetOptions(containers: readonly ContainerTarget[], exams: readonly OldExam[], attached: readonly string[], today: LocalDay): TargetOption[] {
  const sizes = new Map(exams.map((exam) => [exam.id, exam.questions]));
  const candidates: Candidate[] = [
    ...containers.map((container) => {
      const date = container.dates.find((day) => day >= today) ?? container.dates[container.dates.length - 1] ?? null;
      const size = container.items + container.oralExamIds.reduce((sum, id) => sum + (sizes.get(id) ?? 0), 0);
      return { value: `c:${container.id}`, levels: levelsOf(container.title, IMPORT.targetDetail(date ? dayText(date) : '', size), container.created_at) };
    }),
    ...plainExams(exams, attached).map((exam) => ({
      value: `old:${exam.id}`,
      levels: levelsOf(exam.title, IMPORT.targetDetail(exam.exam_date ? dayText(exam.exam_date) : '', exam.questions), exam.created_at),
    })),
  ];
  const labels = apart(candidates);
  return [{ value: 'new', label: IMPORT.targetNew }, ...candidates.map((candidate, index) => ({ value: candidate.value, label: labels[index] }))];
}
