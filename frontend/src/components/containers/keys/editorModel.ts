import { EXPLANATION_MAX, isPictureWord, PICTURE_STEM, pictureOption, type ItemImages, type ItemInput, type ItemKind, type ItemPatch, type TestItem } from '../../../types/container';
import { letter } from '../copyImport';
import { answersOfGaps, gapCount, gapForms, GAPS_MAX, GAP_FORMS_MAX, GAP_TEXT_MAX } from '../../../lib/kinds/cloze';
import { canonicalNumber, canonicalTolerance } from '../../../lib/kinds/number';
import { shortNorm } from '../../../lib/kinds/norm';

/** The kinds of release 48 the editor writes (docs/kinds/CONTRACT.md §1). */
export type NewKind = 'number' | 'order' | 'match' | 'cloze' | 'essay';
export const NEW_KIND_LIST: readonly NewKind[] = ['number', 'order', 'match', 'cloze', 'essay'];
export const isNewKind = (kind: string | undefined): kind is NewKind => NEW_KIND_LIST.includes(kind as NewKind);

/**
 * The author's editor of one question («Вопросы и ключи», spec 2026-10-16 part 1): a draft made from a question (or
 * empty for a new one), the checks the database would refuse (test_items CHECKs: stem 1–4000, 2–8 options of 1–600
 * characters and ≤ 8 KB, 1–10 accepted forms of ≤ 200), the patch of only what changed for container_item_update, the
 * input of a new question for container_items_add, and the database trigger's rule of when everyone's progress on the
 * question restarts (decision 15). A picture stands for its words: a stem or option that is only a picture is saved as
 * «Вопрос на картинке» / «Рисунок Б» and shown back empty here. The explanation (release 47, ≤ EXPLANATION_MAX) is
 * shown after an answer; changing it never restarts anybody's progress. A choice question keeps the kind the author
 * gave it (release 47, M5): «несколько ответов» stays so with one tick; two ticks make any choice question one with
 * several answers (the database refuses a one-answer question with two keys).
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
  /**
   * The kind the author chose for a choice question: several answers even with one tick (or none). Absent or false —
   * one answer while at most one option is ticked. Two ticks always make it several (kindOf).
   */
  multiple?: boolean;
  /** A short answer's accepted forms, «;» between them. */
  forms: string;
  /** «Пояснение»: shown after an answer; '' — none. */
  explanation: string;
  /**
   * Release 48: a question of a new kind (absent — a choice or a short answer, as before). number: `numbers` (the
   * accepted numbers, «;» between them), `tolerance`, `unit`; order: `options` in the right order; match: `options` are
   * the left items, `rights` their pairs, `extras` the right items without a pair; cloze: the stem's gaps (three or more
   * underscores) and `gaps`, the accepted forms of each («;» between them); essay: `materialIds`, the lectures to check by.
   */
  kind?: NewKind;
  numbers?: string;
  tolerance?: string;
  unit?: string;
  rights?: string[];
  extras?: string[];
  gaps?: string[];
  materialIds?: string[];
  /** Partial credit (multiple, order, match, cloze). */
  partial?: boolean;
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
  | 'explanation_long'
  // release 48
  | 'numbers'
  | 'tolerance'
  | 'unit_long'
  | 'pairs'
  | 'pairs_same'
  | 'pair_long'
  | 'pairs_many'
  | 'gaps'
  | 'gaps_many'
  | 'gap_forms'
  | 'materials_many';

export const LIMITS = { stem: 4000, option: 600, optionsMin: 2, optionsMax: 8, optionsBytes: 8192, forms: 10, form: 200, explanation: EXPLANATION_MAX,
  numbers: 10, unit: 20, rights: 10, right: 200, gaps: GAPS_MAX, gapForms: GAP_FORMS_MAX, gapForm: GAP_TEXT_MAX, materials: 10 } as const;
/** The explanation's counter shows from this many characters on. */
export const EXPLANATION_COUNT_FROM = LIMITS.explanation - 200;

const sorted = (list: readonly number[]) => [...new Set(list)].sort((a, b) => a - b);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function draftOf(item: TestItem): Draft {
  if (isNewKind(item.kind)) return newKindDraft(item);
  const short = item.kind === 'short';
  return {
    stem: isPictureWord(item.stem) ? '' : item.stem,
    stemPictures: [...(item.images?.stem ?? [])],
    code: item.code,
    keepOrder: item.keep_order,
    short,
    options: short ? [] : item.options.map((text, index) => ({ text: isPictureWord(text) ? '' : text, pictures: [...(item.images?.options?.[index] ?? [])] })),
    correct: short ? [] : sorted(item.correct),
    multiple: item.kind === 'multiple',
    forms: item.answers.join('; '),
    explanation: item.explanation ?? '',
    ...(item.kind === 'multiple' && item.partial ? { partial: true } : {}),
  };
}

/** The draft of a question of a new kind (release 48). */
function newKindDraft(item: TestItem): Draft {
  const kind = item.kind as NewKind;
  const n = item.options.length;
  const base = draftOf({ ...item, kind: 'single', options: kind === 'order' || kind === 'match' ? item.options : [], answers: [], correct: [] });
  return {
    ...base,
    kind,
    correct: [],
    multiple: false,
    forms: '',
    numbers: kind === 'number' ? item.answers.map((a) => a.replace('.', ',')).join('; ') : '',
    tolerance: kind === 'number' && item.tolerance !== null && item.tolerance !== undefined ? String(item.tolerance).replace('.', ',') : '',
    unit: kind === 'number' ? item.unit ?? '' : '',
    rights: kind === 'match' ? item.answers.slice(0, n) : [],
    extras: kind === 'match' ? item.answers.slice(n) : [],
    gaps: kind === 'cloze' ? gapForms(item.answers).map((forms) => forms.join('; ')) : [],
    materialIds: kind === 'essay' ? [...(item.material_ids ?? [])] : [],
    partial: Boolean(item.partial),
  };
}

/** A blank draft of a new kind, keeping the stem and explanation typed so far (the editor's kind switch). */
export function switchKind(draft: Draft, kind: NewKind | 'choice' | 'short'): Draft {
  const keep = { stem: draft.stem, stemPictures: draft.stemPictures, code: draft.code, explanation: draft.explanation, keepOrder: draft.keepOrder };
  const options = draft.options.length >= 2 ? draft.options : emptyDraft().options;
  if (kind === 'choice' || kind === 'short') {
    return { ...emptyDraft(), ...keep, short: kind === 'short', options: kind === 'short' ? emptyDraft().options : options };
  }
  return {
    ...emptyDraft(),
    ...keep,
    kind,
    options: kind === 'order' || kind === 'match' ? options.map((option) => ({ ...option, pictures: [] })) : [],
    numbers: '',
    tolerance: '',
    unit: '',
    rights: kind === 'match' ? options.map(() => '') : [],
    extras: [],
    gaps: kind === 'cloze' ? Array.from({ length: Math.max(1, gapCount(draft.stem)) }, () => '') : [],
    materialIds: [],
    partial: false,
  };
}

/** The accepted numbers typed, canonical; null for one that is not a number. */
export function numbersOf(text: string): Array<string | null> {
  return text.split(';').map((part) => part.trim()).filter(Boolean).map(canonicalNumber);
}

/** The gaps' forms as the row keeps them: one element per gap of the stem, the forms joined by a newline. */
export function gapAnswers(draft: Pick<Draft, 'stem' | 'gaps'>): string[] {
  const count = gapCount(draft.stem);
  return answersOfGaps(Array.from({ length: count }, (_, index) => formsOf(draft.gaps?.[index] ?? '')));
}

/** match: the right items as the row keeps them — the pairs in the order of the left items, then the extras. */
export function rightItems(draft: Pick<Draft, 'rights' | 'extras' | 'options'>): string[] {
  const pairs = draft.options.map((_, index) => (draft.rights?.[index] ?? '').trim());
  return [...pairs, ...(draft.extras ?? []).map((text) => text.trim()).filter(Boolean)];
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
    multiple: false,
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
  if (draft.kind === 'number') {
    const numbers = numbersOf(draft.numbers ?? '');
    if (numbers.length === 0 || numbers.length > LIMITS.numbers || numbers.some((value) => value === null)) problems.push('numbers');
    if (canonicalTolerance(draft.tolerance ?? '') === undefined) problems.push('tolerance');
    if ((draft.unit ?? '').trim().length > LIMITS.unit) problems.push('unit_long');
  } else if (draft.kind === 'cloze') {
    const count = gapCount(stemText(draft));
    if (count === 0) problems.push('gaps');
    else if (count > LIMITS.gaps) problems.push('gaps_many');
    else {
      const gaps = Array.from({ length: count }, (_, index) => formsOf(draft.gaps?.[index] ?? ''));
      if (gaps.some((forms) => forms.length === 0 || forms.length > LIMITS.gapForms)) problems.push('gap_forms');
      else if (gaps.some((forms) => forms.some((form) => form.length > LIMITS.gapForm))) problems.push('form_long');
    }
  } else if (draft.kind === 'essay') {
    if ((draft.materialIds ?? []).length > LIMITS.materials) problems.push('materials_many');
  } else if (draft.short) {
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
    if (draft.kind === 'match') {
      const rights = rightItems(draft);
      if (draft.options.some((_, index) => !(draft.rights?.[index] ?? '').trim())) problems.push('pairs');
      if (rights.length > LIMITS.rights) problems.push('pairs_many');
      if (rights.some((text) => text.length > LIMITS.right)) problems.push('pair_long');
      const norms = rights.filter(Boolean).map(shortNorm);
      if (new Set(norms).size !== norms.length) problems.push('pairs_same');
    }
  }
  if (explanationText(draft).length > LIMITS.explanation) problems.push('explanation_long');
  return problems;
}

/** The kind the question is saved as: the author's, unless two ticks make a one-answer question one with several. */
export function kindOf(draft: Pick<Draft, 'short' | 'correct' | 'multiple'> & { kind?: NewKind }): ItemKind {
  if (draft.kind) return draft.kind;
  if (draft.short) return 'short';
  return draft.correct.length >= 2 || draft.multiple ? 'multiple' : 'single';
}

/** The author chose one answer and ticked two or more: the question is saved with several (the live line says so). */
export const kindForced = (draft: Pick<Draft, 'short' | 'correct' | 'multiple'> & { kind?: NewKind }) => !draft.kind && !draft.short && !draft.multiple && draft.correct.length >= 2;

/** One tick only (a «верно / неверно» question): the option becomes the key, the others lose theirs. */
export function tickOnly(draft: Draft, index: number): Draft {
  return { ...draft, correct: [index] };
}

/** A tick on or off; the order of the key follows the options. */
export function toggleTick(draft: Draft, index: number): Draft {
  const correct = draft.correct.includes(index) ? draft.correct.filter((at) => at !== index) : [...draft.correct, index];
  return { ...draft, correct: sorted(correct) };
}

/** One more empty option at the end. */
export function appendOption(draft: Draft): Draft {
  return { ...draft, options: [...draft.options, { text: '', pictures: [] }] };
}

/**
 * The editor holds something not saved: the draft differs from the question it was opened on (patchOf), or, for a
 * question of «Вопросы и ключи» that starts empty, from the empty draft.
 */
export function draftChanged(item: TestItem | null, draft: Draft): boolean {
  if (item) return patchOf(item, draft) !== null;
  const blank = emptyDraft();
  const held = (d: Draft) => ({
    stem: d.stem.trim(),
    stemPictures: d.stemPictures,
    code: d.code,
    keepOrder: d.keepOrder,
    options: d.short ? blank.options : d.options,
    correct: d.short ? [] : d.correct,
    forms: d.short ? d.forms.trim() : '',
    explanation: d.explanation.trim(),
  });
  return !same(held(draft), held(blank));
}

function imagesOf(draft: Draft): Required<ItemImages> {
  const noOptions = draft.short || draft.kind === 'number' || draft.kind === 'cloze' || draft.kind === 'essay';
  return { stem: [...draft.stemPictures], options: noOptions ? [] : draft.options.map((option) => [...option.pictures]) };
}

const hasPictures = (images: Required<ItemImages>) => images.stem.length > 0 || images.options.some((list) => list.length > 0);

function storedImages(item: TestItem): Required<ItemImages> {
  return {
    stem: [...(item.images?.stem ?? [])],
    options: item.options.length === 0 ? [] : item.options.map((_, index) => [...(item.images?.options?.[index] ?? [])]),
  };
}

/** The key fields of a new kind's draft, as the row keeps them (release 48). */
function newKindFields(draft: Draft): Pick<ItemInput, 'options' | 'correct' | 'answers' | 'tolerance' | 'unit' | 'partial' | 'material_ids'> {
  const kind = draft.kind;
  const options = kind === 'order' || kind === 'match' ? optionTexts(draft) : [];
  const answers =
    kind === 'number' ? numbersOf(draft.numbers ?? '').filter((value): value is string => value !== null)
    : kind === 'match' ? rightItems(draft)
    : kind === 'cloze' ? gapAnswers({ stem: stemText(draft), gaps: draft.gaps })
    : [];
  const tolerance = kind === 'number' ? canonicalTolerance(draft.tolerance ?? '') ?? null : null;
  const unit = kind === 'number' ? (draft.unit ?? '').trim() || null : null;
  return {
    options,
    correct: kind === 'order' ? options.map((_, index) => index) : [],
    answers,
    tolerance,
    unit,
    partial: (kind === 'order' || kind === 'match' || kind === 'cloze') && Boolean(draft.partial),
    material_ids: kind === 'essay' ? [...(draft.materialIds ?? [])] : [],
  };
}

/** Only what the draft changed; null when it changed nothing. */
export function patchOf(item: TestItem, draft: Draft): ItemPatch | null {
  const patch: ItemPatch = {};
  const stem = stemText(draft);
  if (stem !== item.stem) patch.stem = stem;
  if (draft.code !== item.code) patch.code = draft.code;
  if (draft.keepOrder !== item.keep_order) patch.keep_order = draft.keepOrder;
  if (draft.kind || isNewKind(item.kind)) {
    // release 48: a new kind (or a switch to or from one) sends the whole key the kind holds
    const kind = kindOf(draft);
    const fields = draft.kind ? newKindFields(draft) : null;
    const options = fields ? fields.options : draft.short ? [] : optionTexts(draft);
    const correct = fields ? fields.correct : draft.short ? [] : sorted(draft.correct);
    const answers = fields ? fields.answers ?? [] : draft.short ? formsOf(draft.forms) : [];
    const switched = kind !== item.kind;
    if (switched) patch.kind = kind;
    if (switched || !same(options, item.options)) patch.options = options;
    if (switched || !same(correct, item.correct)) patch.correct = correct;
    if (switched || !same(answers, item.answers)) patch.answers = answers;
    if (fields) {
      const tolerance = fields.tolerance === null || fields.tolerance === undefined ? null : String(fields.tolerance);
      const stored = item.tolerance === null || item.tolerance === undefined ? null : String(item.tolerance);
      if (kind === 'number' && (switched || (tolerance === null ? stored !== null : stored === null || Number(tolerance) !== Number(stored)))) patch.tolerance = tolerance;
      if (kind === 'number' && (switched || (fields.unit ?? null) !== (item.unit ?? null))) patch.unit = fields.unit ?? null;
      if (fields.partial !== Boolean(item.partial)) patch.partial = fields.partial;
      if (kind === 'essay' && !same(fields.material_ids, item.material_ids ?? [])) patch.material_ids = fields.material_ids;
    }
    const images = imagesOf(draft);
    if (!same(hasPictures(images) ? images : {}, hasPictures(storedImages(item)) ? storedImages(item) : {})) patch.images = hasPictures(images) ? images : {};
    const explanation = explanationText(draft);
    if (explanation !== (item.explanation ?? '').trim()) patch.explanation = explanation;
    return Object.keys(patch).length > 0 ? patch : null;
  }
  if (Boolean(draft.partial) !== Boolean(item.partial) && kindOf(draft) === 'multiple') patch.partial = Boolean(draft.partial);
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
  if (isNewKind(item.kind)) {
    // release 48 (test_items_guard's kind_key): the key of the kind, compared as the server compares it
    const norm = (list: readonly string[]) => list.map(shortNorm);
    if (item.kind === 'number') {
      const values = (list: readonly string[]) => [...new Set(list.map(Number))].sort((a, b) => a - b);
      if (patch.answers !== undefined && !same(values(patch.answers), values(item.answers))) return true;
      if (patch.tolerance !== undefined && Number(patch.tolerance ?? 0) !== Number(item.tolerance ?? 0)) return true;
      if (patch.unit !== undefined && shortNorm(patch.unit ?? '').replace(/ /g, '') !== shortNorm(item.unit ?? '').replace(/ /g, '')) return true;
      return false;
    }
    if (patch.options !== undefined && (item.kind === 'order' || item.kind === 'match') && !same(norm(patch.options), norm(item.options))) return true;
    if (patch.answers !== undefined && item.kind === 'match' && !same(norm(patch.answers), norm(item.answers))) return true;
    if (patch.answers !== undefined && item.kind === 'cloze') {
      const sets = (list: readonly string[]) => gapForms(list).map((forms) => [...new Set(forms.map(shortNorm))].sort());
      if (!same(sets(patch.answers), sets(item.answers))) return true;
    }
    return false;
  }
  if (patch.options !== undefined && patch.options.length !== item.options.length) return true;
  if (patch.correct !== undefined && !same(sorted(patch.correct), sorted(item.correct))) return true;
  if (patch.answers !== undefined && !same(formSet(patch.answers), formSet(item.answers))) return true;
  return false;
}

/**
 * Whether «Счёт по этому вопросу начнётся заново» is true after a save that moved the question's rev: somebody's answers
 * to it were counted. The group's are not the author's to see, so a member is enough; else the author's own (the plan's
 * state of the question, `seen`), unless this page restarted it already. A brand-new test's question was answered by
 * nobody: its save says only «Сохранено.» (phone audit 47.3).
 */
export function countRestarts(group: boolean, own: { seen: number } | null | undefined, restartedHere = false): boolean {
  if (group) return true;
  return !restartedHere && (own?.seen ?? 0) > 0;
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
  if (draft.kind) {
    // release 48: a question of a new kind
    const fields = newKindFields(draft);
    const images = imagesOf(draft);
    const input: ItemInput = {
      ref,
      stem: stemText(draft),
      ...fields,
      kind,
      file_no: fileNo,
      key_source: draft.kind === 'essay' ? 'none' : 'manual',
      code: draft.code,
      keep_order: draft.keepOrder,
    };
    if (kind !== 'number') {
      delete input.tolerance;
      delete input.unit;
    }
    if (!input.partial) delete input.partial;
    if (kind !== 'essay') delete input.material_ids;
    if (hasPictures(images)) input.images = images;
    const explanation = explanationText(draft);
    if (explanation) input.explanation = explanation;
    return input;
  }
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
  if (kind === 'multiple' && draft.partial) input.partial = true;
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
