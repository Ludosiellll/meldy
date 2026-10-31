/**
 * The questions a game would take, for the setup screen: which of the test's questions play and which are skipped, by
 * name (CONTRACT §4: exactly one correct option; a battle without mini-games takes 2–6 options and pictures, a game with
 * the arena — a mini-game or «Встань на ответ» — 2–4 options without pictures: the arena has four zones and draws no
 * pictures). The server draws and counts on its own at create; this list only tells the teacher beforehand. With the
 * fake server, the example test and two questions that do not fit.
 */
import { fetchAllItems, fetchSummary } from '../../../api/containers';
import { EXAMPLE_QUESTIONS } from '../../../lib/live/fake';
import type { TestItem } from '../../../types/container';

/**
 * Why a question is not in the game. Release 48's kinds that no game plays name themselves (order, match, cloze,
 * essay); a number plays in a battle (20261102090100_live_numbers.sql) and is 'number' only in «Встань на ответ».
 */
export type SkipReason = 'multiple' | 'short' | 'number' | 'order' | 'match' | 'cloze' | 'essay' | 'options' | 'nokey' | 'picture';

/** Release 48's kinds that no game plays (docs/kinds/CONTRACT.md): each its own reason. */
const UNPLAYED = new Set<SkipReason>(['order', 'match', 'cloze', 'essay']);

export interface SourceQuestion {
  id: string;
  text: string;
  /** Why a game with the arena skips it (2–4 options, no pictures). */
  skip: SkipReason | null;
  /** Why a battle without mini-games skips it (2–6 options, pictures allowed). */
  wideSkip: SkipReason | null;
  /**
   * Why a game skips it under 20261102090000_live_kinds_teams.sql: several right answers and text answers play too
   * (`playSkip`: a battle, with or without movement rounds), «Встань на ответ» takes no text answer (`standSkip`).
   * Absent: an older preview (the wide rule).
   */
  playSkip?: SkipReason | null;
  standSkip?: SkipReason | null;
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

/** The question or one of its options has a picture: the arena skips it (counted in `skipped`). */
function hasPicture(item: Pick<TestItem, 'images'>): boolean {
  const im = item.images;
  return !!im && ((im.stem?.length ?? 0) > 0 || (im.options ?? []).some((o) => (o?.length ?? 0) > 0));
}

/** Why a game skips the item; `wide`: a battle without mini-games (meldy_private.live_playable(item, wide)). */
export function skipReason(item: Pick<TestItem, 'kind' | 'options' | 'correct' | 'images'>, wide = false): SkipReason | null {
  if (UNPLAYED.has(item.kind as SkipReason)) return item.kind as SkipReason;
  if (item.kind === 'number') return 'number';
  if (item.kind === 'short' || item.options.length === 0) return 'short';
  if (item.correct.length === 0) return 'nokey';
  if (item.correct.length > 1) return 'multiple';
  if (item.options.length < 2 || item.options.length > (wide ? 6 : 4)) return 'options';
  if (!wide && hasPicture(item)) return 'picture';
  return null;
}

/**
 * Why a game skips the item with several right answers, text answers and numbers (meldy_private.live_playable(item,
 * true) or live_more(item, text)): 2–6 options with one right or more, or a text answer or a number with accepted
 * answers when `text` (not in «Встань на ответ»). Order, match, cloze and essay never play.
 */
export function kindSkip(item: Pick<TestItem, 'kind' | 'options' | 'correct'> & { answers?: readonly string[] }, text: boolean): SkipReason | null {
  if (UNPLAYED.has(item.kind as SkipReason)) return item.kind as SkipReason;
  if (item.kind === 'number') {
    if (!text) return 'number';
    return item.answers === undefined || item.answers.length > 0 ? null : 'nokey';
  }
  if (item.kind === 'short' || item.options.length === 0) {
    if (!text) return 'short';
    return item.answers === undefined || item.answers.length > 0 ? null : 'nokey';
  }
  if (item.correct.length === 0) return 'nokey';
  if (item.options.length < 2 || item.options.length > 6) return 'options';
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
    questions: items.map((item) => ({
      id: item.id,
      text: questionLine(item.stem),
      skip: skipReason(item),
      wideSkip: skipReason(item, true),
      playSkip: kindSkip(item, true),
      standSkip: kindSkip(item, false),
    })),
  };
}

export function fakeSource(): SourcePreview {
  return {
    containerId: '00000000-0000-4000-8000-00000000c001',
    title: 'Базы данных',
    subjectIds: ['00000000-0000-4000-8000-00000000d001'],
    questions: [
      ...EXAMPLE_QUESTIONS.map((q, i) => ({ id: `fake-${i}`, text: questionLine(q.text), skip: null, wideSkip: null })),
      { id: 'fake-m', text: 'Какие команды относятся к DML? Отметьте все.', skip: 'multiple' as const, wideSkip: 'multiple' as const },
      { id: 'fake-s', text: 'Напишите команду, которая удаляет таблицу целиком.', skip: 'short' as const, wideSkip: 'short' as const },
      { id: 'fake-p', text: 'Какая связь показана на схеме?', skip: 'picture' as const, wideSkip: null },
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
