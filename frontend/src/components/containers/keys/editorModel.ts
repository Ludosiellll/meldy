import { EXPLANATION_MAX, isPictureWord, PICTURE_STEM, pictureOption, type ItemImages, type ItemInput, type ItemKind, type ItemPatch, type TestItem } from '../../../types/container';
import { letter } from '../copyImport';

/**
 * The author's editor of one question («Вопросы и ключи», spec 2026-10-16 part 1): a draft made from a question (or
 * empty for a new one), the checks the database would refuse (test_items CHECKs: stem 1–4000, 2–8 options of 1–600
 * characters and ≤ 8 KB, 1–10 accepted forms of ≤ 200), the patch of only what changed for container_item_update, the
 * input of a new question for container_items_add, and the database trigger's rule of when everyone's progress on the
 * question restarts (decision 15). A picture stands for its words: a stem or option that is only a picture is saved as
 * «Вопрос на картинке» / «Рисунок Б» and shown back empty here. The explanation (release 47, ≤ EXPLANATION_MAX) is
 * shown after an answer; changing it never restarts anybody's progress.
 */

export interface DraftOption {
  text: string;
  pictures: string[];
}

export interface Draft {
  stem: string;
  stemPictures: string[];
  code: boolean;
  keepOrder: boolean;
  short: boolean;
  options: DraftOption[];
  /** Ticked options, file order. */
  correct: number[];
  /** A short answer's accepted forms, «;» between them. */
  forms: string;
  /** «Пояснение»: shown after an answer; '' — none. */
  explanation: string;
}

export type DraftProblem =
  | 'stem'
  | 'stem_long'
  | 'option_empty'
  | 'option_long'
  | 'options_few'
  | 'options_many'
  | 'options_size'
  | 'forms'
  | 'form_long'
  | 'explanation_long';

export const LIMITS = { stem: 4000, option: 600, optionsMin: 2, optionsMax: 8, optionsBytes: 8192, forms: 10, form: 200, explanation: EXPLANATION_MAX } as const;
/** The explanation's counter shows from this many characters on. */
export const EXPLANATION_COUNT_FROM = LIMITS.explanation - 200;

const sorted = (list: readonly number[]) => [...new Set(list)].sort((a, b) => a - b);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function draftOf(item: TestItem): Draft {
  const short = item.kind === 'short';
  return {
    stem: isPictureWord(item.stem) ? '' : item.stem,
    stemPictures: [...(item.images?.stem ?? [])],
    code: item.code,
    keepOrder: item.keep_order,
    short,
    options: short ? [] : item.options.map((text, index) => ({ text: isPictureWord(text) ? '' : text, pictures: [...(item.images?.options?.[index] ?? [])] })),
    correct: short ? [] : sorted(item.correct),
    forms: item.answers.join('; '),
    explanation: item.explanation ?? '',
  };
}

export function emptyDraft(): Draft {
  return {
    stem: '',
    stemPictures: [],
    code: false,
    keepOrder: false,
    short: false,
    options: [
      { text: '', pictures: [] },
      { text: '', pictures: [] },
    ],
    correct: [],
    forms: '',
    explanation: '',
  };
}

export function removeOption(draft: Draft, index: number): Draft {
  return {
    ...draft,
    options: draft.options.filter((_, at) => at !== index),
    correct: draft.correct.filter((at) => at !== index).map((at) => (at > index ? at - 1 : at)),
  };
}

export function formsOf(text: string): string[] {
  return text
    .split(';')
    .map((form) => form.trim())
    .filter(Boolean);
}

/** The stem as saved: the typed words (code keeps its indentation; blank lines around it go), or the picture's stand-in. */
export function stemText(draft: Draft): string {
  const words = draft.stem.replace(/^(?:[ \t]*\r?\n)+/, '').replace(/\s+$/, '');
  if (words.trim()) return words;
  return draft.stemPictures.length > 0 ? PICTURE_STEM : '';
}

/** The explanation as saved: the typed words without blank lines or spaces around them. */
export function explanationText(draft: Pick<Draft, 'explanation'>): string {
  return draft.explanation.trim();
}

export function optionTexts(draft: Draft): string[] {
  return draft.options.map((option, index) => option.text.trim() || (option.pictures.length > 0 ? pictureOption(letter(index)) : ''));
}

export function draftProblems(draft: Draft): DraftProblem[] {
  const problems: DraftProblem[] = [];
  const stem = stemText(draft);
  if (!stem.trim()) problems.push('stem');
  else if (stem.length > LIMITS.stem) problems.push('stem_long');
  if (draft.short) {
    const forms = formsOf(draft.forms);
    if (forms.length === 0 || forms.length > LIMITS.forms) problems.push('forms');
    else if (forms.some((form) => form.length > LIMITS.form)) problems.push('form_long');
  } else {
    const texts = optionTexts(draft);
    if (texts.length < LIMITS.optionsMin) problems.push('options_few');
    if (texts.length > LIMITS.optionsMax) problems.push('options_many');
    if (texts.some((text) => !text)) problems.push('option_empty');
    if (texts.some((text) => text.length > LIMITS.option)) problems.push('option_long');
    else if (new TextEncoder().encode(JSON.stringify(texts)).length > LIMITS.optionsBytes) problems.push('options_size');
  }
  if (explanationText(draft).length > LIMITS.explanation) problems.push('explanation_long');
  return problems;
}

function kindOf(draft: Draft): ItemKind {
  if (draft.short) return 'short';
  return draft.correct.length >= 2 ? 'multiple' : 'single';
}

function imagesOf(draft: Draft): Required<ItemImages> {
  return { stem: [...draft.stemPictures], options: draft.short ? [] : draft.options.map((option) => [...option.pictures]) };
}

const hasPictures = (images: Required<ItemImages>) => images.stem.length > 0 || images.options.some((list) => list.length > 0);

function storedImages(item: TestItem): Required<ItemImages> {
  return {
    stem: [...(item.images?.stem ?? [])],
    options: item.kind === 'short' ? [] : item.options.map((_, index) => [...(item.images?.options?.[index] ?? [])]),
  };
}

/** Only what the draft changed; null when it changed nothing. */
export function patchOf(item: TestItem, draft: Draft): ItemPatch | null {
  const patch: ItemPatch = {};
  const stem = stemText(draft);
  if (stem !== item.stem) patch.stem = stem;
  if (draft.code !== item.code) patch.code = draft.code;
  if (draft.keepOrder !== item.keep_order) patch.keep_order = draft.keepOrder;
  if (draft.short) {
    const forms = formsOf(draft.forms);
    if (!same(forms, item.answers)) patch.answers = forms;
  } else {
    const options = optionTexts(draft);
    if (!same(options, item.options)) patch.options = options;
    const correct = sorted(draft.correct);
    if (!same(correct, sorted(item.correct))) patch.correct = correct;
  }
  const kind = kindOf(draft);
  if (kind !== item.kind) patch.kind = kind;
  const images = imagesOf(draft);
  if (!same(hasPictures(images) ? images : {}, hasPictures(storedImages(item)) ? storedImages(item) : {})) patch.images = hasPictures(images) ? images : {};
  // Compared with the saved words trimmed too: opening and saving never sends an explanation nobody touched.
  const explanation = explanationText(draft);
  if (explanation !== (item.explanation ?? '').trim()) patch.explanation = explanation;
  return Object.keys(patch).length > 0 ? patch : null;
}

const normForm = (form: string) => form.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ');
const formSet = (forms: readonly string[]) => [...new Set(forms.map(normForm))].sort();

/** test_items_guard's rule: a new kind, option count, key or set of forms restarts the question for everyone (words, pictures and the explanation never do). */
export function resetsProgress(item: TestItem, patch: ItemPatch): boolean {
  if (patch.kind !== undefined && patch.kind !== item.kind) return true;
  if (patch.options !== undefined && patch.options.length !== item.options.length) return true;
  if (patch.correct !== undefined && !same(sorted(patch.correct), sorted(item.correct))) return true;
  if (patch.answers !== undefined && !same(formSet(patch.answers), formSet(item.answers))) return true;
  return false;
}

/** The number a new question gets: one past the subject's largest whole number from the file. */
export function nextFileNo(items: readonly TestItem[], subjectId: string): string {
  let top = 0;
  for (const item of items) {
    if (item.subject_id !== subjectId || !/^\d+$/.test(item.file_no.trim())) continue;
    top = Math.max(top, Number(item.file_no.trim()));
  }
  return String(top + 1);
}

/** A new question as container_items_add takes it. */
export function inputOf(draft: Draft, fileNo: string, ref: string): ItemInput {
  const kind = kindOf(draft);
  const answers = draft.short ? formsOf(draft.forms) : undefined;
  const correct = draft.short ? [] : sorted(draft.correct);
  const keyed = draft.short ? (answers?.length ?? 0) > 0 : correct.length > 0;
  const images = imagesOf(draft);
  const input: ItemInput = {
    ref,
    stem: stemText(draft),
    options: draft.short ? [] : optionTexts(draft),
    correct,
    ...(answers ? { answers } : {}),
    kind,
    file_no: fileNo,
    key_source: keyed ? 'manual' : 'none',
    code: draft.code,
    keep_order: draft.keepOrder,
  };
  if (hasPictures(images)) input.images = images;
  const explanation = explanationText(draft);
  if (explanation) input.explanation = explanation;
  return input;
}

const searchNorm = (text: string) => text.toLowerCase().replace(/ё/g, 'е');

/** Questions holding every word of the query (any case, ё = е) in the stem, the options or the forms. */
export function searchItems(items: readonly TestItem[], query: string): TestItem[] {
  const words = searchNorm(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  return items.filter((item) => {
    const text = searchNorm([item.stem, ...item.options, ...item.answers].join(' '));
    return words.every((word) => text.includes(word));
  });
}
