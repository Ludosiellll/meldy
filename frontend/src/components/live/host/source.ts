/**
 * The questions a game would take, for the setup screen: which of the test's questions play and which are skipped, by
 * name (CONTRACT §4: exactly one correct option and 2–4 options). The server draws and counts on its own at create;
 * this list only tells the teacher beforehand. With the fake server, the example test and two questions that do not fit.
 */
import { fetchAllItems, fetchSummary } from '../../../api/containers';
import { EXAMPLE_QUESTIONS } from '../../../lib/live/fake';
import type { TestItem } from '../../../types/container';

export type SkipReason = 'multiple' | 'short' | 'options' | 'nokey';

export interface SourceQuestion {
  id: string;
  text: string;
  skip: SkipReason | null;
}

export interface SourcePreview {
  containerId: string;
  title: string;
  subjectIds: string[];
  questions: SourceQuestion[];
}

/** Questions a game takes at most, and at least (CONTRACT §4: `count` 3–30). */
export const MAX_GAME_QUESTIONS = 30;
export const MIN_GAME_QUESTIONS = 3;

export function skipReason(item: Pick<TestItem, 'kind' | 'options' | 'correct'>): SkipReason | null {
  if (item.kind === 'short' || item.options.length === 0) return 'short';
  if (item.correct.length === 0) return 'nokey';
  if (item.correct.length > 1) return 'multiple';
  if (item.options.length < 2 || item.options.length > 4) return 'options';
  return null;
}

/** The question as one line for the list: its first line, cut at a word. */
export function questionLine(stem: string, max = 110): string {
  const line = stem.replace(/\s+/g, ' ').trim();
  if ([...line].length <= max) return line;
  const cut = [...line].slice(0, max).join('');
  const space = cut.lastIndexOf(' ');
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:—-]+$/, '')}…`;
}

export async function loadSource(containerId: string): Promise<SourcePreview> {
  const summary = await fetchSummary(containerId);
  const subjectIds = summary.subjects.map((s) => s.id);
  const items = await fetchAllItems(subjectIds);
  return {
    containerId,
    title: summary.title,
    subjectIds,
    questions: items.map((item) => ({ id: item.id, text: questionLine(item.stem), skip: skipReason(item) })),
  };
}

export function fakeSource(): SourcePreview {
  return {
    containerId: '00000000-0000-4000-8000-00000000c001',
    title: 'Базы данных',
    subjectIds: ['00000000-0000-4000-8000-00000000d001'],
    questions: [
      ...EXAMPLE_QUESTIONS.map((q, i) => ({ id: `fake-${i}`, text: questionLine(q.text), skip: null })),
      { id: 'fake-m', text: 'Какие команды относятся к DML? Отметьте все.', skip: 'multiple' as const },
      { id: 'fake-s', text: 'Напишите команду, которая удаляет таблицу целиком.', skip: 'short' as const },
    ],
  };
}

/**
 * The amounts a teacher can choose from when the test has more than 10 fitting questions: 10, 15, 20 below the cap, and
 * the cap (all of them, or 30). Up to 10, the game simply takes them all (one choice: the row is not shown).
 */
export function amountChoices(playable: number): number[] {
  const cap = Math.min(playable, MAX_GAME_QUESTIONS);
  if (cap < MIN_GAME_QUESTIONS) return [];
  return [...[10, 15, 20].filter((n) => n < cap), cap];
}
