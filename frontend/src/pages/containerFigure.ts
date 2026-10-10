/**
 * The words of an exam container's row on today's screens («Экзамены», «Прогресс»): its date, its size and its figure
 * (spec decisions 8, 46, 48). Pure functions of the overview (containers_overview); moved here from Exams.tsx so
 * «Прогресс» says the same as «Экзамены» (usability check m7).
 */
import { daysUntil, formatDay, relativeDays } from '../lib/exams/format';
import { pluralRu } from '../components/conversation/visuals';
import { localDateKey } from '../utils/streak';
import type { OverviewContainer } from '../types/container';
import { containerDays } from './containerLayer';

const QUESTION_FORMS = ['вопрос', 'вопроса', 'вопросов'] as const;
const SUBJECT_FORMS = ['предмет', 'предмета', 'предметов'] as const;

/** «28 октября, через 19 дней», «с 12 января, через 95 дней», «Экзамен прошёл 28 октября», «Дата не указана». */
export function containerDateLine(container: Pick<OverviewContainer, 'exam_date' | 'subjects'>, now: Date = new Date()): string {
  const { day, several, past } = containerDays(container, localDateKey(now));
  const text = formatDay(day, now);
  if (!day || !text) return 'Дата не указана';
  if (past) return `Экзамен прошёл ${text}`;
  const days = daysUntil(day, now);
  return `${several ? 'с ' : ''}${text}${days === null ? '' : `, ${relativeDays(days)}`}`;
}

/** The questions of a container: its own (with variants) and those of its oral parts, as «Экзамены» lists them. */
export function containerQuestions(container: Pick<OverviewContainer, 'items' | 'subjects'>, oralTotals: ReadonlyMap<string, number>): number {
  const oral = container.subjects.reduce((sum, subject) => sum + (subject.oral_exam_id ? oralTotals.get(subject.oral_exam_id) ?? 0 : 0), 0);
  return container.items + oral;
}

/** «960 вопросов»; with `subjects` and more than one subject, «4 предмета, 960 вопросов»; «вопросов пока нет». */
export function containerSizeLine(container: Pick<OverviewContainer, 'subjects'>, questions: number, subjects: boolean): string {
  if (questions === 0) return 'вопросов пока нет';
  const size = `${questions} ${pluralRu(questions, QUESTION_FORMS)}`;
  const count = container.subjects.length;
  return subjects && count > 1 ? `${count} ${pluralRu(count, SUBJECT_FORMS)}, ${size}` : size;
}

/** The figure of a container's test part (spec decision 8): «N из M · верно в два разных дня», over the questions with a key. */
export function containerFigure(container: Pick<OverviewContainer, 'subjects'>): { twoDays: number; seen: number; keyed: number } | null {
  let twoDays = 0;
  let seen = 0;
  let keyed = 0;
  for (const subject of container.subjects) {
    twoDays += subject.two_days;
    seen += subject.seen;
    keyed += subject.keyed;
  }
  seen = Math.min(seen, keyed);
  twoDays = Math.min(twoDays, seen);
  // Before any answer: no bar and no line (design critique I4).
  return keyed > 0 && seen > 0 ? { twoDays, seen, keyed } : null;
}

/**
 * «Верно в два разных дня: 143 из 960» (spec decision 48); while it is 0 the line adds what moved: «… 0 из 960 · видели
 * 60». No forecast and no other verb: the figure is named only «верно в два разных дня» (spec decision 55).
 */
export function containerFigureLine(figure: { twoDays: number; seen: number; keyed: number }): string {
  const line = `Верно в два разных дня: ${figure.twoDays} из ${figure.keyed}`;
  return figure.twoDays === 0 ? `${line} · видели ${figure.seen}` : line;
}

