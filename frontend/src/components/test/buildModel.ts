import type { ItemImages, ItemInput, SummarySubject, TestItem, Uuid } from '../../types/container';
import { BUILD, type BuildType } from './copyTest';

/**
 * The builder's rules (spec 2026-10-18 §47.2), pure: what kind a question reads as, the question a new one of each kind
 * starts from, the input of a copy for container_items_add, and the order of a subject's questions while the author
 * moves them (container_items_reorder takes every question of the subject, in the new order).
 */

export const BUILD_TYPES: readonly BuildType[] = ['single', 'multiple', 'short', 'truefalse'];

/** A question that has its key: ticked options, or the accepted forms of a short answer. */
export const isKeyed = (item: Pick<TestItem, 'correct' | 'answers'>) => item.correct.length > 0 || item.answers.length > 0;

/** A subject of test questions (an oral one keeps its questions in its own editor), as «Вопросы и ключи» says it. */
export const takesItems = (subject: SummarySubject) =>
  !(subject.oral && subject.oral.questions > 0 && subject.kinds.single + subject.kinds.multiple + subject.kinds.short === 0);

/** The subject the page opens on: the first with questions, else the first. */
export function defaultSubject(subjects: readonly SummarySubject[], items: readonly Pick<TestItem, 'subject_id'>[]): SummarySubject | null {
  const filled = new Set(items.map((item) => item.subject_id));
  return subjects.find((subject) => filled.has(subject.id)) ?? subjects[0] ?? null;
}

const isTrueFalse = (options: readonly string[]) => options.length === 2 && options[0].trim() === BUILD.trueWord && options[1].trim() === BUILD.falseWord;

/** How the card names a question: «верно / неверно» is a one-answer question with exactly those two options. */
export function typeOf(item: Pick<TestItem, 'kind' | 'options'>): BuildType {
  if (item.kind === 'short') return 'short';
  if (item.kind === 'multiple') return 'multiple';
  return isTrueFalse(item.options) ? 'truefalse' : 'single';
}

/**
 * The question a new one of that kind starts from, handed to QuestionEditor as its `item` (the editor takes no draft of
 * its own): four empty options for one or several answers, the accepted forms for a short answer, «Верно» and
 * «Неверно» kept in that order for «верно / неверно». Nothing is keyed: the author marks the right one.
 */
export function templateItem(type: BuildType, subjectId: string, containerId: string): TestItem {
  const options = type === 'short' ? [] : type === 'truefalse' ? [BUILD.trueWord, BUILD.falseWord] : ['', '', '', ''];
  return {
    id: `new-${type}`,
    container_id: containerId,
    subject_id: subjectId,
    position: 0,
    file_no: '',
    topic: null,
    kind: type === 'short' ? 'short' : type === 'multiple' ? 'multiple' : 'single',
    stem: '',
    options,
    correct: [],
    answers: [],
    key_source: 'none',
    code: false,
    keep_order: type === 'truefalse',
    flags: [],
    rev: 1,
    updated_at: '',
    images: null,
    explanation: '',
  };
}

function copyImages(images: ItemImages | null | undefined): ItemImages | null {
  const stem = [...(images?.stem ?? [])];
  const options = (images?.options ?? []).map((list) => [...list]);
  return stem.length > 0 || options.some((list) => list.length > 0) ? { stem, options } : null;
}

/** A copy of a question as container_items_add takes it: the same content under a new ref and number. */
export function copyInput(item: TestItem, fileNo: string, ref: string): ItemInput {
  const short = item.kind === 'short';
  const input: ItemInput = {
    ref,
    stem: item.stem,
    options: short ? [] : [...item.options],
    correct: short ? [] : [...item.correct],
    kind: item.kind,
    file_no: fileNo,
    topic: item.topic,
    key_source: item.key_source,
    code: item.code,
    keep_order: item.keep_order,
    flags: [...item.flags],
  };
  if (short) input.answers = [...item.answers];
  const images = copyImages(item.images);
  if (images) input.images = images;
  if (item.explanation) input.explanation = item.explanation;
  return input;
}

/** The question the page shows for one it has just added, until the next read brings the saved row. */
export function itemFromInput(input: ItemInput, id: Uuid, position: number, subjectId: Uuid, containerId: Uuid): TestItem {
  return {
    id,
    container_id: containerId,
    subject_id: subjectId,
    position,
    file_no: input.file_no ?? '',
    topic: input.topic ?? null,
    kind: input.kind ?? 'single',
    stem: input.stem,
    options: [...input.options],
    correct: [...input.correct],
    answers: [...(input.answers ?? [])],
    key_source: input.key_source ?? 'none',
    code: input.code ?? false,
    keep_order: input.keep_order ?? false,
    flags: [...(input.flags ?? [])],
    rev: 1,
    updated_at: '',
    images: copyImages(input.images),
    explanation: input.explanation ?? '',
  };
}

/** The ids with one moved a place up (-1) or down (1); null when it is already at that end. */
export function moveIds(ids: readonly string[], id: string, dir: -1 | 1): string[] | null {
  const at = ids.indexOf(id);
  const to = at + dir;
  if (at < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  next[at] = ids[to];
  next[to] = id;
  return next;
}

/** The ids with `added` put right after `after`, in their order (at the end when `after` is not among them). */
export function insertAfter(ids: readonly string[], after: string, added: readonly string[]): string[] {
  const fresh = new Set(added);
  const rest = ids.filter((entry) => !fresh.has(entry));
  const at = rest.indexOf(after);
  if (at < 0) return [...rest, ...added];
  return [...rest.slice(0, at + 1), ...added, ...rest.slice(at + 1)];
}

/**
 * The inputs with a number from the file for those that have none: one past the subject's largest whole number, then
 * on (editorModel.nextFileNo's rule, for a batch).
 */
export function numbered(inputs: readonly ItemInput[], items: readonly Pick<TestItem, 'subject_id' | 'file_no'>[], subjectId: string): ItemInput[] {
  let top = 0;
  for (const item of items) {
    if (item.subject_id === subjectId && /^\d+$/.test(item.file_no.trim())) top = Math.max(top, Number(item.file_no.trim()));
  }
  return inputs.map((input) => (input.file_no && input.file_no.trim() ? input : { ...input, file_no: String(++top) }));
}

/**
 * A subject's questions in the order the page shows: the author's order of this visit when there is one (questions it
 * does not name follow, by position), else by position.
 */
export function orderItems<T extends Pick<TestItem, 'id' | 'position'>>(items: readonly T[], order?: readonly string[] | null): T[] {
  const byPosition = [...items].sort((a, b) => a.position - b.position);
  if (!order || order.length === 0) return byPosition;
  const rank = new Map(order.map((id, index) => [id, index]));
  const named = byPosition.filter((item) => rank.has(item.id)).sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0));
  return [...named, ...byPosition.filter((item) => !rank.has(item.id))];
}
