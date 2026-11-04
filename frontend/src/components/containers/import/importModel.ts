/**
 * The import page's model (package D3a): parse results of the question-bank importer (POST /api/exams/parse-bank,
 * types/container.ts BankParseResult) plus the student's edits → the subjects to save. Pure: no React, no network.
 *
 * Rules (spec v2.2):
 * - kinds (decision 6): single / multiple stay; truefalse → single; an open question with a short answer from the
 *   file («Впишите…», GIFT {=…}) → short; an open question without one → the subject's ORAL part; order / match →
 *   not saved, one preview line.
 * - release 49 (GIFT, Moodle XML): the file's explanation goes with every kind (≤ EXPLANATION_MAX); a Moodle cloze
 *   becomes a cloze question (its gaps' forms); a match keeps its extra right items (distractors).
 * - lost images (decision 7): an image question the author did not confirm is saved WITHOUT a key, so no session
 *   offers it (plan_inputs plans every keyed item), and keeps the flag has_image for the pages to name it.
 * - carried pictures (owner, 2026-10-14): a DOCX's pictures come with the parse (BankItem.images, ids of
 *   BankParseResult.pictures) and are saved with the question; a stem or an option that is only a picture is saved
 *   under PICTURE_STEM / «Рисунок Б» (the file's letter), since the database keeps text. A picture that does not reach
 *   storage on saving is a lost image again (itemInputs).
 * - more than 150 open questions in one subject (decision 5 + the design table): parts «X, часть 1», «X, часть 2» …
 *   of at most 150 oral questions each; the questions with variants stay with part 1.
 * - topics: at most 99 per subject (spec §3), the tail goes into the 99th; oral sections at most 20 (the oral editor).
 * - the database's rules for an item (supabase/migrations/20261009093500_containers.sql): options 2..8, each 1..600,
 *   8 KB together; stem 1..4000; short answers 1..10 forms of 1..200; flags ≤ 16 of [a-z_]. An item that breaks one
 *   of them is «blocked»: it is listed in the problem queue and is not saved until fixed (or kept as oral).
 * - ItemInput: file_no = the file's number, topic per subject, key_source from the evidence (a checkbox → 'marker'),
 *   keep_order for «Все перечисленные» / «Ни один…», ref = `<import id>:<position>` (the import id of the question's
 *   own file).
 * - variants of one subject (owner, 2026-11-04: «КПиЯП_Вариант_1» … «_12»): two files or more with a variant number (the
 *   parse's «Вариант N», else the file name's) and the same name (the discipline heading, else the file name without the
 *   variant) are one subject: variants in order, a topic «Вариант N» each (or the files' topics merged by name), a
 *   question several variants share kept once (different keys: key_conflict, saved without a key until the student
 *   picks one). «Разделить по файлам» (edits.split) gives one subject per file again. A single file is as before.
 */
import {
  EXPLANATION_MAX, PICTURE_LIMITS, PICTURE_STEM, pictureOption,
  type BankItem, type BankParseResult, type ItemInput, type ItemKind, type KeySource, type PlanInput, type PlanItem,
} from '../../../types/container';
import { subjectFromFileName, subjectNameKey, variantFromFileName } from './subjectName';

export const ORAL_CAP = 150;
export const TOPIC_CAP = 99;
export const ORAL_SECTION_CAP = 20;
export const ITEMS_CAP = 2000;
export const SUBJECTS_CAP = 20;
export const MARK_SHARE = 0.6;
const OPTIONS_MIN = 2;
const OPTIONS_MAX = 8;
const OPTION_CHARS = 600;
const STEM_CHARS = 4000;
const OPTIONS_BYTES = 8192;
const ORAL_MIN_CHARS = 3;
const ORAL_MAX_CHARS = 1000;
const LABEL_CHARS = 16;
const FILE_LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З', 'И', 'К', 'Л', 'М', 'Н', 'О', 'П', 'Р', 'С', 'Т', 'У', 'Ф'];
const FLAGS_MAX = 16;
const SHORT_FORMS_MAX = 10;
const SHORT_FORM_CHARS = 200;
const SHORT_BRIEF_CHARS = 40;

export type FileFormat = 'auto' | 'test' | 'open';
export type FileSource = 'file' | 'paste' | 'pdf';
/** How the file marks its key: as the importer found it, a formatting signal of the file, or the student's choice. */
export type KeySignal = 'auto' | 'bold' | 'underline' | 'italic' | 'color' | 'highlight' | 'shade' | 'first_option' | 'none';
export const FORMAT_SIGNALS = ['bold', 'underline', 'italic', 'color', 'highlight', 'shade'] as const;

export interface ImportFile {
  id: string;
  name: string;
  /** The prefix of every item's ref: a resent batch inserts nothing twice. [A-Za-z0-9_.-] */
  importId: string;
  source: FileSource;
  format: FileFormat;
  keyText: string;
  /** The key kept in another file, by name (null — none was added). */
  keyFileName?: string | null;
  result: BankParseResult;
}

/** What the student did to one question (by uid `<file id>:<position>`). Option indices are the FILE's. */
export interface ItemFix {
  correct?: number[];
  kind?: 'single' | 'multiple';
  drop?: number[];
  removed?: boolean;
  oral?: boolean;
  imageOk?: boolean;
  keepBoth?: boolean;
  accept?: boolean;
  /**
   * «Подобрать ключи с ИИ» (owner, 2026-11-04): `correct` came from the AI, not the file. Saved as a key the student set
   * (key_source 'manual') with the flag ai_key, and waits in the queue «Проверьте ключи от ИИ» until accepted (aiOk) or
   * changed (a key the student taps drops aiKey).
   */
  aiKey?: boolean;
  aiOk?: boolean;
  /** The AI gave no key: 'low' (not sure, the answers differed — asking again gives the same), 'none' (no answer). */
  aiTried?: 'low' | 'none';
  /** The server's note for a question it gave no key («ИИ не уверен»). */
  aiNote?: string;
}
export interface SubjectEdit {
  title?: string;
  date?: string | null;
  removed?: boolean;
}
export interface FileEdit {
  signal?: KeySignal;
  merged?: boolean;
  /** «Отмечать по ходу»: a file without keys goes into the problem queue question by question. */
  noKeyLater?: boolean;
}
export interface ImportEdits {
  items: Record<string, ItemFix>;
  subjects: Record<string, SubjectEdit>;
  files: Record<string, FileEdit>;
  /** «Разделить по файлам»: variants of one subject the student keeps as one subject per file (by the group's key). */
  split?: Record<string, boolean>;
}
export const NO_EDITS: ImportEdits = { items: {}, subjects: {}, files: {} };

export type Problem =
  | 'image'
  | 'no_options'
  | 'few_options'
  | 'many_options'
  | 'empty_option'
  | 'same_options'
  | 'several'
  | 'key_conflict'
  | 'key_invalid'
  | 'key_letter'
  | 'partial'
  | 'no_key'
  | 'duplicate'
  | 'too_long'
  /** A key the AI suggested («Подобрать ключи с ИИ»): not a problem of the file, the student confirms it apart. */
  | 'ai_key';

export interface DraftItem {
  uid: string;
  fileId: string;
  position: number;
  label: string;
  text: string;
  /** The file's options (trimmed), with the file's letters: the queue shows these. */
  rawOptions: string[];
  /** Saved option i is the file's option optionMap[i]. */
  optionMap: number[];
  options: string[];
  /** The key as saved (indices into `options`); [] = saved without a key. */
  correct: number[];
  /** The key the question has now, in the file's indices (shown in the queue). */
  rawCorrect: number[];
  /** Options the file marked (several_marked: «В файле выделены два ответа: Б и Г»). */
  marked: number[];
  kind: ItemKind;
  answers: string[];
  keySource: KeySource;
  code: boolean;
  keepOrder: boolean;
  flags: string[];
  topic: number | null;
  topicTitle: string | null;
  problems: Problem[];
  imageLost: boolean;
  blocked: boolean;
  twin: string | null;
  /** The question's pictures (ids into the file's pictures): the stem's and each SAVED option's; null — none. */
  images: DraftImages | null;
  /** number (release 48): the tolerance; absent — exact. */
  tolerance?: string | null;
  /** Release 49: the file's explanation (GIFT «####…», Moodle feedback); absent — none. */
  explanation?: string;
  /** In a subject made of variants: the variant of the file the question came from. */
  variant?: number | null;
  /** The same question in several variants with different keys (in this question's option indices): it waits for the student. */
  variantKeys?: VariantKey[];
  /** The key came from «Подобрать ключи с ИИ», not the file: labelled «Ключ подобран ИИ, не из файла» (flag ai_key). */
  aiKey?: boolean;
}

/** One key a question has in some of the variants (variant numbers; null — a file without one). */
export interface VariantKey {
  variants: Array<number | null>;
  key: number[];
}

/** A file of a subject: one, or each variant of a subject made of variants (in their order). */
export interface SubjectFile {
  id: string;
  name: string;
  variant: number | null;
}

/** A subject that is variants of one subject in several files: the group (its key) and whether it was split back. */
export interface VariantInfo {
  key: string;
  files: number;
  /** «Разделить по файлам»: this subject is one file of the group; «Объединить варианты» joins them again. */
  split: boolean;
}

export interface DraftImages {
  stem: string[];
  /** In the order of the saved options. */
  options: string[][];
  /** In the file's order (the problem queue shows the file's options). */
  fileOptions: string[][];
}

export interface DraftOral {
  uid: string;
  position: number;
  label: string;
  text: string;
  section: number | null;
  hadAnswer: boolean;
}

export interface DraftSubject {
  key: string;
  /** The (first) file of the subject; `files` — all of them. */
  fileId: string;
  fileName: string;
  files: SubjectFile[];
  source: FileSource;
  format: FileFormat;
  title: string;
  titleFrom: 'heading' | 'file' | 'number' | 'user';
  /** The file's numbering starts again: Meldy split it into subjects (offer «Оставить одним»). */
  restart: boolean;
  merged: boolean;
  part: number | null;
  parts: number;
  /** The oral questions of this part, by their order in the subject (1-based). */
  oralRange: [number, number] | null;
  removed: boolean;
  date: string | null;
  test: DraftItem[];
  blocked: DraftItem[];
  oral: DraftOral[];
  oralTotal: number;
  topics: string[];
  topicsTotal: number;
  oralSections: string[];
  skippedKinds: number;
  removedItems: number;
  shortOral: number;
  keySource: KeySource | null;
  keyed: number;
  noKey: number;
  imageLost: number;
  answerDropped: number;
  allNoKey: boolean;
  numbers: { first: string; last: string; missing: number[]; more: number } | null;
  topicCounts: Array<{ title: string; items: number }>;
  /** Variants of one subject from several files (or one of them, split back); null — an ordinary subject. */
  variants: VariantInfo | null;
  /** Questions of other variants left out as repeats of one already in the subject. */
  variantRepeats: number;
  /** Keys from «Подобрать ключи с ИИ» (not counted in `keyed`, which says what the file marked). */
  aiKeyed: number;
}

// ─────────────────────────────────────────────── helpers ───────────────────────────────────────────────

const KEY_SOURCES: readonly KeySource[] = [
  'bold', 'underline', 'italic', 'color', 'highlight', 'shade', 'marker', 'key_column', 'answer_line', 'key_list',
  'key_text', 'gift', 'first_option', 'manual', 'none',
];

/** The importer's evidence → the database's key_source (a checkbox is a mark in the file: 'marker'). */
export function evidenceSource(evidence: string | null | undefined): KeySource {
  if (!evidence) return 'none';
  if (evidence === 'checkbox') return 'marker';
  return (KEY_SOURCES as readonly string[]).includes(evidence) ? (evidence as KeySource) : 'none';
}

/** The normal form of a short answer, as the database compares it (meldy_short_norm). */
export function shortNorm(text: string): string {
  const t = text.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();
  return (t.endsWith('.') ? t.slice(0, -1) : t).trimEnd();
}

const FILL_HINT = /_{3,}|\.{5,}|(?<![а-яё])(?:впишите|дополните|вставьте\s+пропущ)/i;

/** The accepted forms of an open question that is a short answer (decision 6), or null: an oral question. */
export function shortForms(item: BankItem): string[] | null {
  if (item.kind !== 'open' || !item.answer) return null;
  const forms = item.answer
    .split(/\s*;\s*/)
    .map((form) => form.trim())
    .filter(Boolean);
  if (forms.length < 1 || forms.length > SHORT_FORMS_MAX) return null;
  if (forms.some((form) => form.length > SHORT_FORM_CHARS || shortNorm(form) === '')) return null;
  const gift = item.evidence === 'gift';
  const brief = forms.every((form) => form.length <= SHORT_BRIEF_CHARS);
  return gift || brief || FILL_HINT.test(item.text) ? forms : null;
}

// «Все перечисленные», «Ни один из перечисленных», «Нет верного ответа», «Оба варианта», «Верны А и Б»: the option must
// stay where the file put it (keep_order), or the shuffle makes it nonsense.
// (No \b here: in a JavaScript regular expression it only knows Latin letters.)
const KEEP_ORDER =
  /^(?:(?:все|всё)\s.*(?:перечисл|верн|правильн)|ни\s+од[а-яё]*|ничего\s+из|нет\s+(?:верн|правильн)|оба(?![а-яё])|(?:верны|правильны)(?![а-яё])|все\s+ответы|all\s+of\s+the|none\s+of\s+the|both\b)/i;
export function needsOrder(options: readonly string[]): boolean {
  return options.some((option) => KEEP_ORDER.test(option.trim()));
}

function sameKey(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

function utf8Length(text: string): number {
  let bytes = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
  }
  return bytes;
}

const PROBLEM_ORDER: readonly Problem[] = [
  'image', 'no_options', 'few_options', 'many_options', 'empty_option', 'same_options', 'several', 'key_conflict',
  'key_invalid', 'key_letter', 'partial', 'no_key', 'duplicate', 'too_long', 'ai_key',
];
/** The flag of a key the AI suggested (test_items.flags; owner, 2026-11-04). */
export const AI_KEY_FLAG = 'ai_key';
const KEY_FLAGS = new Set(['no_key', 'several_marked', 'key_conflict', 'key_invalid', 'key_letter_ambiguous', 'partial_mark']);
const SHAPE_FLAGS = new Set(['has_image', 'duplicate', 'empty_option', 'same_options', 'many_options', 'few_options', 'no_options', 'too_long']);
const FLAG_RE = /^[a-z_]{1,32}$/;

function sortProblems(list: Problem[]): Problem[] {
  return PROBLEM_ORDER.filter((problem) => list.includes(problem));
}

/** The key a question has now, in the file's option indices, and where it came from. */
function rawKey(item: BankItem, fix: ItemFix, signal: KeySignal): { key: number[]; source: KeySource; auto: boolean } {
  if (fix.correct) return { key: [...fix.correct], source: 'manual', auto: false };
  if (signal === 'none') return { key: [], source: 'none', auto: false };
  if (signal === 'first_option') return { key: item.options.length ? [0] : [], source: 'first_option', auto: false };
  if (signal !== 'auto') {
    const shares = item.marks?.[signal] ?? [];
    const key = shares.map((share, index) => (share >= MARK_SHARE ? index : -1)).filter((index) => index >= 0);
    return { key, source: key.length ? signal : 'none', auto: false };
  }
  return { key: [...item.correct], source: item.correct.length ? evidenceSource(item.evidence) : 'none', auto: true };
}

interface ItemContext {
  fileId: string;
  signal: KeySignal;
  fix: ItemFix;
  twin: string | null;
}

/** One question with variants (or a short answer) as it would be saved, with what is still wrong with it. */
/**
 * An order or match question of the file as a question of its kind (release 48; spec: «парсер уже узнаёт order/match —
 * перестать выбрасывать»): order — the options put in the key's order (BankItem.order), match — the pairs. null when it
 * cannot be saved so (no key, too few or too many, an empty or repeated item): it is skipped as before.
 */
export function kindDraft(item: BankItem, context: { fileId: string; twin: string | null }): DraftItem | null {
  const text = item.text.trim().slice(0, STEM_CHARS);
  if (!text) return null;
  let options: string[];
  let answers: string[] = [];
  const explanation = explanationOf(item);
  if (item.kind === 'cloze') {
    const gaps = clozeAnswers(text, item.gaps ?? []);
    if (!gaps) return null;
    return {
      uid: `${context.fileId}:${item.position}`,
      fileId: context.fileId,
      position: item.position,
      label: (item.label ?? '').trim(),
      text,
      rawOptions: [],
      optionMap: [],
      options: [],
      correct: [],
      rawCorrect: [],
      marked: [],
      kind: 'cloze',
      answers: gaps,
      keySource: evidenceSource(item.evidence) === 'none' ? 'key_text' : evidenceSource(item.evidence),
      code: Boolean(item.code),
      keepOrder: false,
      flags: [],
      topic: null,
      topicTitle: null,
      problems: [],
      imageLost: false,
      blocked: false,
      twin: context.twin,
      images: null,
      ...(explanation ? { explanation } : {}),
    };
  }
  if (item.kind === 'order') {
    const all = item.options.map((option) => option.trim());
    const order = item.order ?? [];
    if (order.length !== all.length || new Set(order).size !== all.length || order.some((i) => !Number.isInteger(i) || i < 0 || i >= all.length)) return null;
    options = order.map((index) => all[index]);
  } else {
    const pairs = (item.pairs ?? []).map(([left, right]) => [String(left).trim(), String(right).trim()] as const);
    options = pairs.map(([left]) => left);
    answers = pairs.map(([, right]) => right);
    if (answers.some((right) => !right || right.length > 200) || new Set(answers.map(shortNorm)).size !== answers.length) return null;
    // Release 49: extra right items (a Moodle or GIFT distractor), up to 10 right items in all; a repeat is left out.
    const seen = new Set(answers.map(shortNorm));
    for (const raw of item.extras ?? []) {
      const extra = String(raw).trim();
      if (answers.length >= MATCH_RIGHT_MAX || !extra || extra.length > 200 || !shortNorm(extra) || seen.has(shortNorm(extra))) continue;
      seen.add(shortNorm(extra));
      answers.push(extra);
    }
  }
  if (options.length < 2 || options.length > 8 || options.some((option) => !option || option.length > 600)) return null;
  return {
    uid: `${context.fileId}:${item.position}`,
    fileId: context.fileId,
    position: item.position,
    label: (item.label ?? '').trim(),
    text,
    rawOptions: options,
    optionMap: options.map((_, index) => index),
    options,
    correct: item.kind === 'order' ? options.map((_, index) => index) : [],
    rawCorrect: [],
    marked: [],
    kind: item.kind === 'order' ? 'order' : 'match',
    answers,
    keySource: evidenceSource(item.evidence) === 'none' ? 'key_text' : evidenceSource(item.evidence),
    code: Boolean(item.code),
    keepOrder: false,
    flags: [],
    topic: null,
    topicTitle: null,
    problems: [],
    imageLost: false,
    blocked: false,
    twin: context.twin,
    images: null,
    ...(explanation ? { explanation } : {}),
  };
}

const MATCH_RIGHT_MAX = 10;
const GAPS_MAX = 10;
const GAP_FORMS_MAX = 10;
const GAP_FORM_CHARS = 200;

/** The file's explanation, trimmed to what an item keeps (release 49); '' — none. */
export function explanationOf(item: Pick<BankItem, 'explanation'>): string {
  return (item.explanation ?? '').trim().slice(0, EXPLANATION_MAX).trim();
}

/**
 * A cloze's answers as test_items keeps them (docs/kinds/CONTRACT.md §1): one element per gap «___» of the stem, its
 * forms joined by a line break; null when they do not fit (a gap count that differs, an empty or too long form).
 */
export function clozeAnswers(stem: string, gaps: readonly (readonly string[])[]): string[] | null {
  const runs = stem.match(/_{3,}/g)?.length ?? 0;
  if (gaps.length < 1 || gaps.length > GAPS_MAX || runs !== gaps.length) return null;
  const out: string[] = [];
  for (const raw of gaps) {
    const forms = Array.from(new Set(raw.map((form) => String(form).replace(/\s+/g, ' ').trim()).filter(Boolean)));
    if (forms.length < 1 || forms.length > GAP_FORMS_MAX) return null;
    if (forms.some((form) => form.length > GAP_FORM_CHARS || shortNorm(form) === '')) return null;
    out.push(forms.join('\n'));
  }
  return out;
}

export function draftItem(item: BankItem, context: ItemContext): DraftItem {
  const { fix, signal } = context;
  const uid = `${context.fileId}:${item.position}`;
  const pictures = item.images ?? null;
  const stemPictures = (pictures?.stem ?? []).slice(0, PICTURE_LIMITS.stem);
  const optionPictures = (index: number) => (pictures?.options[index] ?? []).slice(0, PICTURE_LIMITS.option);
  const text = item.text.trim().slice(0, STEM_CHARS) || (stemPictures.length > 0 ? PICTURE_STEM : '');
  const hasImage = item.flags.includes('has_image');
  const imageLost = hasImage && !fix.imageOk;
  const problems: Problem[] = [];
  const base = {
    uid,
    fileId: context.fileId,
    position: item.position,
    label: (item.label ?? '').trim(),
    text,
    code: Boolean(item.code),
    topic: null,
    topicTitle: null,
    twin: context.twin,
    images: stemPictures.length > 0 ? { stem: stemPictures, options: [], fileOptions: [] } : null,
  };
  const unresolvedDuplicate = item.flags.includes('duplicate') && !fix.keepBoth;
  const unresolvedLong = item.flags.includes('too_long') && !fix.accept;

  // Release 48: a number with its tolerance (GIFT «{#…}», Moodle numerical) is saved as a number question.
  if (item.kind === 'open' && item.number && item.number.answers.length > 0 && text) {
    return {
      ...base,
      rawOptions: [],
      optionMap: [],
      options: [],
      correct: [],
      rawCorrect: [],
      marked: [],
      kind: 'number',
      answers: item.number.answers.slice(0, 10),
      tolerance: item.number.tolerance,
      ...(explanationOf(item) ? { explanation: explanationOf(item) } : {}),
      keySource: evidenceSource(item.evidence) === 'none' ? 'answer_line' : evidenceSource(item.evidence),
      keepOrder: false,
      flags: cleanFlags(item.flags.filter((flag) => !KEY_FLAGS.has(flag) && !SHAPE_FLAGS.has(flag)), { duplicate: unresolvedDuplicate, tooLong: item.flags.includes('too_long') }),
      problems: sortProblems([...(unresolvedDuplicate ? (['duplicate'] as Problem[]) : []), ...(unresolvedLong ? (['too_long'] as Problem[]) : [])]),
      imageLost: false,
      blocked: false,
    };
  }

  // A short answer from the file.
  const forms = shortForms(item);
  if (forms) {
    if (unresolvedDuplicate) problems.push('duplicate');
    if (unresolvedLong) problems.push('too_long');
    const flags = cleanFlags(item.flags.filter((flag) => !KEY_FLAGS.has(flag) && !SHAPE_FLAGS.has(flag)), {
      duplicate: unresolvedDuplicate,
      tooLong: item.flags.includes('too_long'),
    });
    return {
      ...base,
      rawOptions: [],
      optionMap: [],
      options: [],
      correct: [],
      rawCorrect: [],
      marked: [],
      kind: 'short',
      answers: forms,
      keySource: evidenceSource(item.evidence) === 'none' ? 'answer_line' : evidenceSource(item.evidence),
      keepOrder: false,
      flags,
      problems: sortProblems(problems),
      imageLost: false,
      blocked: !text,
      ...(explanationOf(item) ? { explanation: explanationOf(item) } : {}),
    };
  }

  const rawOptions = item.options.map((option) => option.trim());
  const drop = new Set(fix.drop ?? []);
  const optionMap: number[] = [];
  const options: string[] = [];
  rawOptions.forEach((option, index) => {
    if (drop.has(index)) return;
    if (!option && optionPictures(index).length > 0) {
      optionMap.push(index);
      options.push(pictureOption(FILE_LETTERS[index] ?? String(index + 1)));
      return;
    }
    if (!option) {
      // An option that was a picture keeps its place under a word; an empty one is left out when saved.
      if (hasImage) {
        optionMap.push(index);
        options.push('(картинка)');
      }
      return;
    }
    optionMap.push(index);
    options.push(option.slice(0, OPTION_CHARS));
  });

  const { key, source, auto } = rawKey(item, fix, signal);
  const kindBase: 'single' | 'multiple' = fix.kind ?? (item.kind === 'multiple' ? 'multiple' : 'single');
  const rawCorrect = key.filter((index) => index >= 0 && index < rawOptions.length && !drop.has(index));
  const correct = rawCorrect.map((index) => optionMap.indexOf(index)).filter((index) => index >= 0);
  const several = kindBase === 'single' && correct.length > 1;
  const marked = item.flags.includes('several_marked') || several ? rawCorrect : [];

  const emptyLeft = rawOptions.some((option, index) => !option && !drop.has(index) && !hasImage && optionPictures(index).length === 0);
  const savedPictures = optionMap.map((index) => optionPictures(index));
  const filePictures = rawOptions.map((_, index) => optionPictures(index));
  const images: DraftImages | null =
    stemPictures.length > 0 || filePictures.some((list) => list.length > 0)
      ? { stem: stemPictures, options: savedPictures, fileOptions: filePictures }
      : null;
  const sameUnresolved = item.flags.includes('same_options') && !fix.accept && drop.size === 0;
  const tooFew = options.length < OPTIONS_MIN;
  const tooMany = options.length > OPTIONS_MAX;
  const tooBig = utf8Length(JSON.stringify(options)) > OPTIONS_BYTES;
  const noOptions = rawOptions.length === 0;
  const blocked = noOptions || tooFew || tooMany || tooBig || !text;

  if (imageLost) problems.push('image');
  if (noOptions) problems.push('no_options');
  else if (tooFew) problems.push('few_options');
  if (tooMany || tooBig) problems.push('many_options');
  if (emptyLeft) problems.push('empty_option');
  if (sameUnresolved) problems.push('same_options');
  if (!noOptions) {
    if (several) problems.push('several');
    else if (correct.length === 0) problems.push('no_key');
    if (auto && !fix.correct) {
      if (item.flags.includes('key_conflict')) problems.push('key_conflict');
      if (item.flags.includes('key_invalid')) problems.push('key_invalid');
      if (item.flags.includes('key_letter_ambiguous')) problems.push('key_letter');
      if (item.flags.includes('partial_mark') && correct.length === 0) problems.push('partial');
    }
  }
  if (unresolvedDuplicate) problems.push('duplicate');
  if (unresolvedLong) problems.push('too_long');
  // «Подобрать ключи с ИИ»: a key the AI suggested is a key the student set, with its flag, until they change it
  const aiKey = Boolean(fix.aiKey && fix.correct && correct.length > 0);
  if (aiKey && !fix.aiOk) problems.push('ai_key');

  const saveKey = !imageLost && !several && correct.length > 0;
  const keyFlags: string[] = [];
  if (aiKey && saveKey) keyFlags.push(AI_KEY_FLAG);
  if (!imageLost && correct.length === 0 && !noOptions) keyFlags.push('no_key');
  if (several) keyFlags.push('several_marked');
  if (auto && !fix.correct) {
    for (const flag of ['key_conflict', 'key_invalid', 'key_letter_ambiguous', 'partial_mark']) {
      if (item.flags.includes(flag)) keyFlags.push(flag);
    }
  }
  const flags = cleanFlags(
    [...item.flags.filter((flag) => !KEY_FLAGS.has(flag) && !SHAPE_FLAGS.has(flag)), ...keyFlags],
    {
      image: imageLost,
      duplicate: unresolvedDuplicate,
      same: sameUnresolved,
      tooLong: item.flags.includes('too_long'),
    },
  );

  return {
    ...base,
    rawOptions,
    optionMap,
    options,
    correct: saveKey ? correct : [],
    rawCorrect,
    marked,
    kind: kindBase,
    answers: [],
    keySource: saveKey ? source : 'none',
    keepOrder: needsOrder(options),
    flags,
    problems: sortProblems(problems),
    imageLost,
    blocked,
    images,
    ...(explanationOf(item) ? { explanation: explanationOf(item) } : {}),
    ...(aiKey ? { aiKey: true } : {}),
  };
}

function cleanFlags(
  flags: string[],
  extra: { image?: boolean; duplicate?: boolean; same?: boolean; tooLong?: boolean },
): string[] {
  const out = [...flags];
  if (extra.image) out.push('has_image');
  if (extra.duplicate) out.push('duplicate');
  if (extra.same) out.push('same_options');
  if (extra.tooLong) out.push('too_long');
  return Array.from(new Set(out.filter((flag) => FLAG_RE.test(flag)))).slice(0, FLAGS_MAX);
}

function numbersOf(items: BankItem[]): DraftSubject['numbers'] {
  const values = items
    .map((item) => (/^\d{1,4}$/.test((item.label ?? '').trim()) ? Number(item.label.trim()) : null))
    .filter((value): value is number => value !== null);
  if (values.length < 2) return null;
  const sorted = Array.from(new Set(values)).sort((a, b) => a - b);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const present = new Set(sorted);
  const missing: number[] = [];
  let more = 0;
  // A numbering that starts again (two lists in one subject) is not a list of gaps.
  if (last - first + 1 <= sorted.length * 2) {
    for (let n = first; n <= last; n += 1) {
      if (present.has(n)) continue;
      if (missing.length < 6) missing.push(n);
      else more += 1;
    }
  }
  return { first: String(first), last: String(last), missing, more };
}

// ─────────────────────────────────────────────── subjects ───────────────────────────────────────────────

interface Group {
  key: string;
  indices: number[];
  title: string | null;
  evidence: string;
}

function groupsOf(file: ImportFile, merged: boolean): Group[] {
  const listed = file.result.subjects.length
    ? file.result.subjects
    : [{ index: 1, title: null, evidence: 'none' as const, items: file.result.items.length }];
  if (merged) {
    const titled = listed.find((subject) => subject.title);
    return [{ key: `${file.id}:all`, indices: listed.map((subject) => subject.index), title: titled?.title ?? null, evidence: titled?.evidence ?? 'none' }];
  }
  return listed.map((subject) => ({ key: `${file.id}:${subject.index}`, indices: [subject.index], title: subject.title, evidence: subject.evidence }));
}

/** One subject of one file, as read: its name, its questions and what a group of variants needs to know of it. */
interface Unit {
  file: ImportFile;
  key: string;
  title: string;
  titleFrom: DraftSubject['titleFrom'];
  restart: boolean;
  merged: boolean;
  signal: KeySignal;
  noKeyLater: boolean;
  items: BankItem[];
  twinOf: Map<number, string>;
  topicTitle: Map<number, string>;
  /** «Вариант N» of the file (the parse's, else the file name's); null — none. */
  variant: number | null;
  /** The name variants of one subject share: the discipline heading, else the file name without the variant. */
  name: string | null;
  nameFrom: 'heading' | 'file';
  /** The file has this one subject: only then can it be a variant of a subject. */
  whole: boolean;
}

/** The subjects of every file as read (the order of the files), with today's names. */
function unitsOf(files: readonly ImportFile[], edits: ImportEdits): Unit[] {
  const out: Unit[] = [];
  let untitled = 0;
  for (const file of files) {
    const fileEdit = edits.files[file.id] ?? {};
    const signal = fileEdit.signal ?? 'auto';
    const result = file.result;
    const restart =
      result.subjects.some((subject) => subject.evidence === 'restart') || result.warnings.some((warning) => warning.code === 'subjects_restart');
    const merged = Boolean(fileEdit.merged) && result.subjects.length > 1;
    const groups = groupsOf(file, merged);
    const topicTitle = new Map(result.topics.map((topic) => [topic.index, topic.title]));
    const knownSubjects = new Set(groups.flatMap((group) => group.indices));
    // Twins: the first question with the same text, options and pictures in the file (the same words under other
    // pictures — «Что означает выделенная стрелка?» ×3 — are different questions).
    const firstOf = new Map<string, string>();
    const twinOf = new Map<number, string>();
    for (const item of result.items) {
      const key = identityOf(item);
      const first = firstOf.get(key);
      if (first !== undefined) twinOf.set(item.position, first);
      else firstOf.set(key, item.label || String(item.position));
    }
    const fromFile = file.source !== 'paste' ? variantFromFileName(file.name) : { variant: null, base: null };
    const variant = typeof result.variant === 'number' ? result.variant : fromFile.variant;

    groups.forEach((group, groupIndex) => {
      const items = result.items.filter(
        (item) => group.indices.includes(item.subject) || (groupIndex === 0 && !knownSubjects.has(item.subject)),
      );
      const baseEdit = edits.subjects[group.key] ?? {};
      let title: string;
      let titleFrom: DraftSubject['titleFrom'];
      if (baseEdit.title?.trim()) {
        title = baseEdit.title.trim();
        titleFrom = 'user';
      } else if (group.title?.trim()) {
        title = group.title.trim();
        titleFrom = 'heading';
      } else {
        const fromName = groups.length === 1 && file.source !== 'paste' ? subjectFromFileName(file.name) : null;
        // «ТЕСТОВЫЙ ВАРИАНТ 4» above the questions names a one-subject file whose name does not («Тест.docx»).
        const variantName = groups.length === 1 && typeof result.variant === 'number' ? `Вариант ${result.variant}` : null;
        const named = (text: string) => new RegExp(`(^|\\D)${result.variant}(\\D|$)`).test(text);
        if (fromName && !(variantName && !named(fromName))) {
          title = fromName;
          titleFrom = 'file';
        } else if (variantName) {
          title = fromName && /^вариант$/iu.test(fromName) ? variantName : fromName ? `${fromName}, ${variantName.toLocaleLowerCase('ru-RU')}` : variantName;
          titleFrom = 'file';
        } else {
          untitled += 1;
          title = `Предмет ${untitled}`;
          titleFrom = 'number';
        }
      }
      const heading = group.title?.trim() || null;
      out.push({
        file,
        key: group.key,
        title,
        titleFrom,
        restart,
        merged,
        signal,
        noKeyLater: Boolean(fileEdit.noKeyLater),
        items,
        twinOf,
        topicTitle,
        variant,
        name: heading ?? fromFile.base,
        nameFrom: heading ? 'heading' : 'file',
        whole: groups.length === 1,
      });
    });
  }
  return out;
}

/** A question as twins and variants compare it: its text, its set of options and its pictures. */
function identityOf(item: BankItem): string {
  const pictures = item.images ? `|${item.images.stem.join(',')}|${item.images.options.map((list) => list.join(',')).sort().join(';')}` : '';
  return `${sameKey(item.text)}|${[...item.options].map(sameKey).sort().join('|')}${pictures}`;
}

/** The key of a question as the variants compare it (option texts, not letters: a variant may shuffle them); '' — none. */
function keyTextOf(item: BankItem, unit: Unit, fix: ItemFix): string {
  if (unit.file.format === 'open') return '';
  if (item.kind === 'open') {
    if (item.number && item.number.answers.length > 0) return `n:${item.number.answers.map(shortNorm).sort().join('|')}`;
    const forms = shortForms(item);
    return forms ? `s:${forms.map(shortNorm).sort().join('|')}` : '';
  }
  if (item.kind === 'order') return item.order.length ? `o:${item.order.map((index) => sameKey(item.options[index] ?? '')).join('|')}` : '';
  if (item.kind === 'match') return item.pairs.length ? `m:${item.pairs.map(([left, right]) => `${sameKey(left)}=${sameKey(right)}`).sort().join('|')}` : '';
  if (item.kind === 'cloze') return item.gaps?.length ? `c:${item.gaps.map((forms) => forms.map(shortNorm).sort().join(',')).join('|')}` : '';
  const { key } = rawKey(item, fix, unit.signal);
  return key.length ? `k:${key.map((index) => sameKey(item.options[index] ?? '')).sort().join('|')}` : '';
}

const CHOICE_KINDS: ReadonlySet<string> = new Set(['single', 'multiple', 'truefalse']);

/** What the questions of a unit came to: drafts with variants, oral questions, and what was left out. */
interface UnitBody {
  test: DraftItem[];
  blocked: DraftItem[];
  oral: DraftOral[];
  skippedKinds: number;
  removedItems: number;
  shortOral: number;
  answerDropped: number;
}

/** The questions of one unit as they would be saved; `skip` — repeats of other variants, `conflicts` — their keys. */
function draftUnit(
  unit: Unit,
  edits: ImportEdits,
  skip: ReadonlySet<string> = new Set(),
  conflicts: ReadonlyMap<string, VariantKey[]> = new Map(),
): UnitBody {
  const { file } = unit;
  const body: UnitBody = { test: [], blocked: [], oral: [], skippedKinds: 0, removedItems: 0, shortOral: 0, answerDropped: 0 };
  for (const item of unit.items) {
    const uid = `${file.id}:${item.position}`;
    if (skip.has(uid)) continue;
    const fix = edits.items[uid] ?? {};
    if (fix.removed) {
      body.removedItems += 1;
      continue;
    }
    const asOral = (hadAnswer: boolean) => {
      const text = item.text.trim().slice(0, ORAL_MAX_CHARS);
      if (text.length < ORAL_MIN_CHARS) {
        body.shortOral += 1;
        return;
      }
      if (hadAnswer) body.answerDropped += 1;
      body.oral.push({ uid, position: item.position, label: (item.label ?? '').trim(), text, section: item.topic, hadAnswer });
    };
    if (file.format === 'open') {
      asOral(Boolean(item.answer));
      continue;
    }
    if (item.kind === 'order' || item.kind === 'match' || item.kind === 'cloze') {
      // Release 48: order and match are questions of their own kinds now (none is thrown away when it has its key);
      // release 49: so is a Moodle cloze.
      const kept = kindDraft(item, { fileId: file.id, twin: unit.twinOf.get(item.position) ?? null });
      if (!kept) {
        body.skippedKinds += 1;
        continue;
      }
      kept.topic = item.topic;
      body.test.push(kept);
      continue;
    }
    if (item.kind === 'open' && !shortForms(item)) {
      asOral(Boolean(item.answer));
      continue;
    }
    if (fix.oral) {
      asOral(false);
      continue;
    }
    const draft = draftItem(item, { fileId: file.id, signal: unit.signal, fix, twin: unit.twinOf.get(item.position) ?? null });
    draft.topic = item.topic;
    const keys = conflicts.get(uid);
    if (keys && draft.kind !== 'short' && !fix.correct) markConflict(draft, keys);
    (draft.blocked ? body.blocked : body.test).push(draft);
  }
  return body;
}

/** The same question in two variants with different keys: saved without a key until the student picks the right one. */
function markConflict(draft: DraftItem, keys: VariantKey[]): void {
  draft.variantKeys = keys;
  draft.marked = Array.from(new Set(keys.flatMap((entry) => entry.key))).sort((a, b) => a - b);
  draft.rawCorrect = [];
  draft.correct = [];
  draft.keySource = 'none';
  draft.problems = sortProblems([...draft.problems.filter((problem) => problem !== 'no_key' && problem !== 'several'), 'key_conflict']);
  draft.flags = cleanFlags([...draft.flags.filter((flag) => flag !== 'several_marked'), 'no_key', 'key_conflict'], {});
}

/** Everything a subject row needs, before its oral part is cut into parts of 150. */
interface SubjectSpec {
  key: string;
  file: ImportFile;
  files: SubjectFile[];
  title: string;
  titleFrom: DraftSubject['titleFrom'];
  restart: boolean;
  merged: boolean;
  body: UnitBody;
  /** The topic ids of the test part in their order, and their titles. */
  topicIds: number[];
  topicTitle: Map<number, string>;
  /** Oral sections take their titles here (the file's topics, or the variants'). */
  sectionTitle: Map<number, string>;
  noKeyLater: boolean;
  items: BankItem[];
  variants: VariantInfo | null;
  variantRepeats: number;
}

function emitSubject(out: DraftSubject[], spec: SubjectSpec, edits: ImportEdits): void {
  const { test, blocked, oral, skippedKinds, removedItems, shortOral, answerDropped } = spec.body;
  const baseEdit = edits.subjects[spec.key] ?? {};
  const { topicIds, topicTitle } = spec;

  // Topics of the test part: numbered 1.. in the order they appear, the tail merged into the 99th.
  const localTopic = new Map<number, number>();
  topicIds.forEach((id, index) => localTopic.set(id, Math.min(index + 1, TOPIC_CAP)));
  const topics = topicIds.slice(0, TOPIC_CAP).map((id, index) => (topicTitle.get(id) ?? `Тема ${index + 1}`).slice(0, 200));
  for (const item of [...test, ...blocked]) {
    const global = item.topic;
    item.topic = global !== null ? localTopic.get(global) ?? null : null;
    item.topicTitle = item.topic !== null ? topics[item.topic - 1] ?? null : null;
  }
  const topicCounts = topics.map((topicName, index) => ({
    title: topicName,
    items: [...test, ...blocked].filter((item) => item.topic === index + 1).length,
  }));

  // a key the AI suggested is not the file's: «Ответ выделен жирным в N из M» counts the file's own (aiKeyed apart)
  const keyedTest = test.filter((item) => (item.kind === 'short' || item.correct.length > 0) && !item.aiKey);
  const aiKeyed = test.filter((item) => item.aiKey && item.correct.length > 0).length;
  const choice = test.filter((item) => item.kind !== 'short');
  const sources = new Map<KeySource, number>();
  for (const item of keyedTest) sources.set(item.keySource, (sources.get(item.keySource) ?? 0) + 1);
  let keySource: KeySource | null = null;
  let best = 0;
  sources.forEach((value, source) => {
    if (value > best) {
      best = value;
      keySource = source;
    }
  });
  const allNoKey = !spec.noKeyLater && choice.length > 0 && choice.every((item) => item.rawCorrect.length === 0 && !item.variantKeys);

  // More than 150 oral questions: parts of 150, the test part stays with the first.
  const parts = Math.max(1, Math.ceil(oral.length / ORAL_CAP));
  for (let part = 1; part <= parts; part += 1) {
    const split = parts > 1;
    const key = split ? `${spec.key}#${part}` : spec.key;
    const edit = edits.subjects[key] ?? {};
    const slice = oral.slice((part - 1) * ORAL_CAP, part * ORAL_CAP);
    const sectionIds: number[] = [];
    for (const question of slice) {
      if (question.section !== null && !sectionIds.includes(question.section)) sectionIds.push(question.section);
    }
    const sections = sectionIds.slice(0, ORAL_SECTION_CAP);
    const partOral = slice.map((question) => {
      const at = question.section !== null ? sections.indexOf(question.section) : -1;
      return { ...question, section: at >= 0 ? at + 1 : null };
    });
    const first = part === 1;
    const partTitle = split ? edit.title?.trim() || `${spec.title}, часть ${part}` : spec.title;
    out.push({
      key,
      fileId: spec.file.id,
      fileName: spec.file.name,
      files: spec.files,
      source: spec.file.source,
      format: spec.file.format,
      title: partTitle,
      titleFrom: split && edit.title?.trim() ? 'user' : spec.titleFrom,
      restart: spec.restart,
      merged: spec.merged,
      part: split ? part : null,
      parts,
      oralRange: split ? [(part - 1) * ORAL_CAP + 1, (part - 1) * ORAL_CAP + slice.length] : null,
      removed: Boolean(edit.removed ?? (split ? false : baseEdit.removed)),
      date: (split ? edit.date : baseEdit.date) ?? null,
      test: first ? test : [],
      blocked: first ? blocked : [],
      oral: partOral,
      oralTotal: oral.length,
      topics: first ? topics : [],
      topicsTotal: first ? topicIds.length : 0,
      oralSections: sections.map((id, index) => (spec.sectionTitle.get(id) ?? `Раздел ${index + 1}`).slice(0, 200)),
      skippedKinds: first ? skippedKinds : 0,
      removedItems: first ? removedItems : 0,
      shortOral: first ? shortOral : 0,
      keySource: first ? keySource : null,
      keyed: first ? keyedTest.length : 0,
      noKey: first ? choice.filter((item) => item.correct.length === 0 && !item.imageLost).length : 0,
      imageLost: first ? test.filter((item) => item.imageLost).length : 0,
      answerDropped: first ? answerDropped : 0,
      allNoKey: first ? allNoKey : false,
      numbers: first ? numbersOf(spec.items) : null,
      topicCounts: first ? topicCounts : [],
      variants: spec.variants,
      variantRepeats: first ? spec.variantRepeats : 0,
      aiKeyed: first ? aiKeyed : 0,
    });
  }
}

/** The topic ids of a test part in the order they first appear. */
function topicOrder(items: readonly DraftItem[]): number[] {
  const ids: number[] = [];
  for (const item of items) {
    if (item.topic !== null && !ids.includes(item.topic)) ids.push(item.topic);
  }
  return ids;
}

/** One file's subject, as before variants were grouped. */
function singleSpec(unit: Unit, edits: ImportEdits, variants: VariantInfo | null): SubjectSpec {
  const body = draftUnit(unit, edits);
  return {
    key: unit.key,
    file: unit.file,
    files: [{ id: unit.file.id, name: unit.file.name, variant: unit.variant }],
    title: unit.title,
    titleFrom: unit.titleFrom,
    restart: unit.restart,
    merged: unit.merged,
    body,
    topicIds: topicOrder([...body.test, ...body.blocked]),
    topicTitle: unit.topicTitle,
    sectionTitle: unit.topicTitle,
    noKeyLater: unit.noKeyLater,
    items: unit.items,
    variants,
    variantRepeats: 0,
  };
}

/** A short stable key of a group of variants (the name it shares): the edits and the save follow it. */
function variantGroupKey(nameKey: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < nameKey.length; index += 1) {
    hash ^= nameKey.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return `v:${hash.toString(36)}`;
}

/**
 * Variants of one subject as one subject (owner, 2026-11-04: «КПиЯП_Вариант_1» … «_12» are one subject, not twelve).
 * The variants go in their order, each a topic «Вариант N» (or, when the files have topics, the topics merged by name).
 * A question several variants share (text, options, pictures) is kept once: with the same key silently (counted in
 * variantRepeats), with different keys as one question with the problem key_conflict, saved without a key until the
 * student picks one. Twins inside one file stay as they are. A question the student removed takes its repeats along.
 */
function groupSpec(members: Unit[], key: string, edits: ImportEdits): SubjectSpec {
  const fixOf = (uid: string) => edits.items[uid] ?? {};
  type Occurrence = { unit: number; item: BankItem; uid: string; key: string; removed: boolean };
  const occurrences = new Map<string, Occurrence[]>();
  members.forEach((unit, index) => {
    for (const item of [...unit.items].sort((a, b) => a.position - b.position)) {
      const uid = `${unit.file.id}:${item.position}`;
      const fix = fixOf(uid);
      const identity = unit.file.format === 'open' || (item.kind === 'open' && !shortForms(item) && !item.number?.answers.length) ? `oral|${sameKey(item.text)}` : identityOf(item);
      const list = occurrences.get(identity) ?? [];
      list.push({ unit: index, item, uid, key: keyTextOf(item, unit, fix), removed: Boolean(fix.removed) });
      occurrences.set(identity, list);
    }
  });
  const skip = new Set<string>();
  const conflicts = new Map<string, VariantKey[]>();
  let repeats = 0;
  for (const list of occurrences.values()) {
    if (new Set(list.map((entry) => entry.unit)).size < 2) continue;
    const keys = new Set(list.map((entry) => entry.key).filter(Boolean));
    const removed = list.find((entry) => entry.removed);
    const choice = CHOICE_KINDS.has(list[0].item.kind) && members[list[0].unit].file.format !== 'open';
    // Two different keys of a question that is not a choice: both stay, each with its own key (never a wrong one).
    if (!removed && keys.size > 1 && !choice) continue;
    const rep = removed ?? (keys.size <= 1 ? list.find((entry) => entry.key) ?? list[0] : list[0]);
    for (const entry of list) {
      if (entry.unit === rep.unit) continue;
      skip.add(entry.uid);
      repeats += 1;
    }
    if (!removed && keys.size > 1 && !fixOf(rep.uid).correct) {
      // each key once, with the variants that have it: «варианты 1–6, 8–12 — Б, вариант 7 — Г»
      const seen = new Set<number>();
      const byKey = new Map<string, VariantKey>();
      for (const entry of list) {
        if (seen.has(entry.unit) || !entry.key) continue;
        seen.add(entry.unit);
        const texts = new Set(rawKey(entry.item, fixOf(entry.uid), members[entry.unit].signal).key.map((at) => sameKey(entry.item.options[at] ?? '')));
        const mapped = rep.item.options.map((option, at) => (texts.has(sameKey(option)) ? at : -1)).filter((at) => at >= 0);
        const known = byKey.get(entry.key);
        if (known) known.variants.push(members[entry.unit].variant);
        else byKey.set(entry.key, { variants: [members[entry.unit].variant], key: mapped });
      }
      conflicts.set(rep.uid, [...byKey.values()]);
    }
  }

  // Topics: the files' own merged by name, or one per variant.
  const ownTopics = members.some((unit) => unit.items.some((item) => item.topic !== null));
  const variantNumbers = Array.from(new Set(members.map((unit) => unit.variant ?? 0))).sort((a, b) => a - b);
  const topicTitle = new Map<number, string>();
  const byName = new Map<string, number>();
  const mergedTopic = (unit: Unit, id: number | null): number | null => {
    if (!ownTopics) {
      const rank = variantNumbers.indexOf(unit.variant ?? 0) + 1;
      topicTitle.set(rank, `Вариант ${unit.variant ?? rank}`);
      return rank;
    }
    if (id === null) return null;
    const title = unit.topicTitle.get(id) ?? `Тема ${id}`;
    const name = subjectNameKey(title);
    let merged = byName.get(name);
    if (merged === undefined) {
      merged = byName.size + 1;
      byName.set(name, merged);
      topicTitle.set(merged, title);
    }
    return merged;
  };

  const body: UnitBody = { test: [], blocked: [], oral: [], skippedKinds: 0, removedItems: 0, shortOral: 0, answerDropped: 0 };
  const topicIds: number[] = [];
  for (const unit of members) {
    const part = draftUnit(unit, edits, skip, conflicts);
    for (const item of [...part.test, ...part.blocked]) {
      item.variant = unit.variant;
      item.topic = mergedTopic(unit, item.topic);
    }
    for (const question of part.oral) question.section = mergedTopic(unit, question.section);
    for (const id of topicOrder([...part.test, ...part.blocked])) if (!topicIds.includes(id)) topicIds.push(id);
    body.test.push(...part.test);
    body.blocked.push(...part.blocked);
    body.oral.push(...part.oral);
    body.skippedKinds += part.skippedKinds;
    body.removedItems += part.removedItems;
    body.shortOral += part.shortOral;
    body.answerDropped += part.answerDropped;
  }
  const first = members[0];
  const edit = edits.subjects[key] ?? {};
  const named = edit.title?.trim();
  return {
    key,
    file: first.file,
    files: members.map((unit) => ({ id: unit.file.id, name: unit.file.name, variant: unit.variant })),
    title: named || (first.name ?? first.title),
    titleFrom: named ? 'user' : first.nameFrom,
    restart: false,
    merged: false,
    body,
    topicIds,
    topicTitle,
    sectionTitle: topicTitle,
    noKeyLater: members.every((unit) => unit.noKeyLater),
    items: members.flatMap((unit) => unit.items),
    variants: { key, files: members.length, split: false },
    variantRepeats: repeats,
  };
}

/**
 * The subjects to save, from every file and the student's edits, in the files' order. Variants of one subject (a
 * variant number from the parse or the file name, the same name from the heading or the file name, two files or more)
 * are one subject unless the student split them back (edits.split); a single file and files without variants are as
 * before.
 */
export function deriveSubjects(files: readonly ImportFile[], edits: ImportEdits = NO_EDITS): DraftSubject[] {
  const units = unitsOf(files, edits);
  const groups = new Map<string, Unit[]>();
  for (const unit of units) {
    if (!unit.whole || unit.variant === null || !unit.name) continue;
    const key = variantGroupKey(subjectNameKey(unit.name));
    groups.set(key, [...(groups.get(key) ?? []), unit]);
  }
  const groupOf = new Map<Unit, string>();
  groups.forEach((members, key) => {
    if (new Set(members.map((unit) => unit.file.id)).size < 2) return;
    for (const unit of members) groupOf.set(unit, key);
  });

  const out: DraftSubject[] = [];
  const done = new Set<string>();
  for (const unit of units) {
    const key = groupOf.get(unit);
    if (!key) {
      emitSubject(out, singleSpec(unit, edits, null), edits);
      continue;
    }
    const members = groups.get(key)!;
    if (edits.split?.[key]) {
      emitSubject(out, singleSpec(unit, edits, { key, files: members.length, split: true }), edits);
      continue;
    }
    if (done.has(key)) continue;
    done.add(key);
    const index = (member: Unit) => files.indexOf(member.file);
    const ordered = [...members].sort((a, b) => (a.variant ?? 0) - (b.variant ?? 0) || index(a) - index(b));
    emitSubject(out, groupSpec(ordered, key, edits), edits);
  }
  return out;
}

/** The questions of a subject in its order: its files' (the variants') order, then the file's. */
export function subjectOrder<T extends { fileId: string; position: number }>(items: readonly T[], fileIds: readonly string[]): T[] {
  const rank = (item: T) => {
    const at = fileIds.indexOf(item.fileId);
    return at < 0 ? fileIds.length : at;
  };
  return [...items].sort((a, b) => rank(a) - rank(b) || a.position - b.position);
}

export const activeSubjects = (subjects: readonly DraftSubject[]) => subjects.filter((subject) => !subject.removed);

// ─────────────────────────────────────────────── the problem queue ───────────────────────────────────────────────

export interface QueueEntry {
  uid: string;
  subjectKey: string;
  subjectTitle: string;
  item: DraftItem;
  problem: Problem;
}

/** Questions that need a look, across all subjects (Concept 1 §3.2): one problem each, the most serious first. */
export function queueOf(subjects: readonly DraftSubject[]): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const subject of activeSubjects(subjects)) {
    const items = subjectOrder([...subject.test, ...subject.blocked], subject.files.map((entry) => entry.id));
    for (const item of items) {
      // a key from the AI is confirmed in its own queue (aiKeyQueue), not counted with the file's problems
      const problems = (subject.allNoKey ? item.problems.filter((problem) => problem !== 'no_key') : item.problems).filter(
        (problem) => problem !== 'ai_key',
      );
      if (problems.length === 0) continue;
      out.push({ uid: item.uid, subjectKey: subject.key, subjectTitle: subject.title, item, problem: problems[0] });
    }
  }
  return out;
}

/** «Проверьте ключи от ИИ (N)»: the keys the AI suggested that the student has not accepted or changed yet. */
export function aiKeyQueue(subjects: readonly DraftSubject[]): QueueEntry[] {
  const out: QueueEntry[] = [];
  for (const subject of activeSubjects(subjects)) {
    for (const item of subjectOrder(subject.test, subject.files.map((entry) => entry.id))) {
      if (item.problems.includes('ai_key')) out.push({ uid: item.uid, subjectKey: subject.key, subjectTitle: subject.title, item, problem: 'ai_key' });
    }
  }
  return out;
}

/** «в 4 нет ответа, в 2 выделено два, 1 повторяется» for one subject's preview. */
export function problemParts(subject: DraftSubject): Array<{ problem: Problem | 'variant_keys'; n: number }> {
  const counts = new Map<Problem | 'variant_keys', number>();
  for (const item of [...subject.test, ...subject.blocked]) {
    const problems = (subject.allNoKey ? item.problems.filter((problem) => problem !== 'no_key') : item.problems).filter(
      (problem) => problem !== 'ai_key',
    );
    if (!problems.length) continue;
    // the same question in two variants with different keys is told apart from a key list against the file's marks
    const part = problems[0] === 'key_conflict' && item.variantKeys ? 'variant_keys' : problems[0];
    counts.set(part, (counts.get(part) ?? 0) + 1);
  }
  const order = PROBLEM_ORDER.flatMap((problem): Array<Problem | 'variant_keys'> => (problem === 'key_conflict' ? [problem, 'variant_keys'] : [problem]));
  return order.filter((problem) => counts.has(problem)).map((problem) => ({ problem, n: counts.get(problem)! }));
}

// ─────────────────────────────────────────────── counts and checks ───────────────────────────────────────────────

export interface ImportTotals {
  subjects: number;
  found: number;
  test: number;
  oral: number;
  blocked: number;
  skippedKinds: number;
  imageLost: DraftItem[];
  answerDropped: number;
}

export function totalsOf(subjects: readonly DraftSubject[]): ImportTotals {
  const active = activeSubjects(subjects);
  const sum = (pick: (subject: DraftSubject) => number) => active.reduce((total, subject) => total + pick(subject), 0);
  return {
    subjects: active.length,
    found: sum((subject) => subject.test.length + subject.blocked.length + subject.oral.length + subject.skippedKinds),
    test: sum((subject) => subject.test.length),
    oral: sum((subject) => subject.oral.length),
    blocked: sum((subject) => subject.blocked.length),
    skippedKinds: sum((subject) => subject.skippedKinds),
    imageLost: active.flatMap((subject) => subject.test.filter((item) => item.imageLost)),
    answerDropped: sum((subject) => subject.answerDropped),
  };
}

/** One subject, only open questions, at most 150: the oral exam of today, through createExam (decision 21). */
export function isSingleOralList(subjects: readonly DraftSubject[]): boolean {
  const active = activeSubjects(subjects);
  return (
    active.length === 1 &&
    active[0].part === null &&
    active[0].test.length === 0 &&
    active[0].blocked.length === 0 &&
    active[0].oral.length > 0 &&
    active[0].oral.length <= ORAL_CAP
  );
}

/** Three questions with a key, spread across the subjects, to compare with the file («Сверить ключ на трёх вопросах»). */
export function spotCheck(subjects: readonly DraftSubject[]): Array<{ subject: string; item: DraftItem }> {
  // a key the AI suggested is not compared with the file: the file has none
  const keyed = activeSubjects(subjects).flatMap((subject) =>
    subject.test.filter((item) => item.kind !== 'short' && item.correct.length > 0 && !item.aiKey).map((item) => ({ subject: subject.title, item })),
  );
  if (keyed.length <= 3) return keyed;
  const picks = [Math.floor(keyed.length / 6), Math.floor(keyed.length / 2), Math.floor((keyed.length * 5) / 6)];
  return picks.map((index) => keyed[index]);
}

// ─────────────────────────────────────────────── saving ───────────────────────────────────────────────

/** Where a picture of the file was put (its storage path), or null when it did not get there. */
export type PicturePlace = (id: string) => string | null;

/** The ids of the pictures the subject's questions show (each once). */
export function pictureIds(subject: Pick<DraftSubject, 'test'>): string[] {
  const ids = new Set<string>();
  for (const item of subject.test) {
    for (const id of item.images?.stem ?? []) ids.add(id);
    for (const list of item.images?.options ?? []) for (const id of list) ids.add(id);
  }
  return Array.from(ids);
}

/**
 * The items of one subject as container_items_add takes them (types/container.ts ItemInput). A picture that has no
 * place is lost: the question is saved without a key and with has_image (decision 7), so no session asks it unseen.
 */
export function itemInputs(
  subject: Pick<DraftSubject, 'test'>,
  importId: string | ((fileId: string) => string),
  place: PicturePlace = () => null,
): ItemInput[] {
  // Each question's ref carries its own file's import id: a subject of variants takes questions from several files.
  const refOf = (item: DraftItem) => `${typeof importId === 'string' ? importId : importId(item.fileId)}:${item.position}`;
  return subject.test.map((item) => {
    if (item.kind === 'number' || item.kind === 'order' || item.kind === 'match' || item.kind === 'cloze') {
      // release 48 (docs/kinds/CONTRACT.md §1): their key is in options / answers
      const input: ItemInput = {
        ref: refOf(item),
        stem: item.text,
        options: item.kind === 'number' || item.kind === 'cloze' ? [] : item.options,
        correct: item.kind === 'order' ? item.options.map((_, index) => index) : [],
        answers: item.kind === 'order' ? [] : item.answers,
        kind: item.kind,
        file_no: item.label.slice(0, LABEL_CHARS),
        topic: item.topic,
        key_source: item.keySource,
        code: item.code,
        keep_order: item.keepOrder,
        flags: item.flags,
      };
      if (item.kind === 'number' && item.tolerance) input.tolerance = item.tolerance;
      if (item.explanation) input.explanation = item.explanation;
      return input;
    }
    const input: ItemInput = {
      ref: refOf(item),
      stem: item.text,
      options: item.kind === 'short' ? [] : item.options,
      correct: item.kind === 'short' ? [] : item.correct,
      kind: item.kind,
      file_no: item.label.slice(0, LABEL_CHARS),
      topic: item.topic,
      key_source: item.keySource,
      code: item.code,
      keep_order: item.keepOrder,
      flags: item.flags,
    };
    if (item.kind === 'short') input.answers = item.answers;
    if (item.explanation) input.explanation = item.explanation;
    if (item.images) {
      const stem = item.images.stem.map(place);
      const options = item.images.options.map((list) => list.map(place));
      const kept = { stem: stem.filter(isPath), options: options.map((list) => list.filter(isPath)) };
      if (kept.stem.length > 0 || kept.options.some((list) => list.length > 0)) input.images = kept;
      if (stem.includes(null) || options.some((list) => list.includes(null))) {
        input.correct = [];
        input.key_source = 'none';
        input.flags = cleanFlags(item.flags, { image: true });
      }
    }
    return input;
  });
}

const isPath = (value: string | null): value is string => value !== null;

/** A ref prefix: letters, digits and «-» only (the database's ref is [A-Za-z0-9_:.-]{1,80}). */
export function newImportId(now: number = Date.now(), random: () => number = Math.random): string {
  const tail = Math.floor(random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `imp-${now.toString(36)}-${tail}`;
}

/**
 * The input of `feasibility` (lib/containers/plan.ts) for the questions about to be saved: nothing answered yet; an oral
 * exam joining as subject 1 with its questions in the plan as they stand.
 */
export function draftPlanInput(
  subjects: readonly DraftSubject[],
  options: {
    now: number;
    tz: string;
    today: string;
    minutes: number;
    date: string | null;
    perSubject: boolean;
    /** An oral exam that joins as subject 1 («Куда добавить: к …»): its questions in the plan, as they stand. */
    extra?: { id: string; title: string; date: string | null; items: PlanItem[] } | null;
    /** The exam's size after saving (every question, oral included): the minutes line names what it counts by it. */
    examQuestions?: number;
  },
): PlanInput {
  const active = activeSubjects(subjects);
  const extra = options.extra ?? null;
  return {
    v: 1,
    now: options.now,
    tz: options.tz,
    containerId: 'draft',
    budgetMin: options.minutes,
    firstPlanDay: options.today,
    subjects: [
      ...(extra ? [{ id: extra.id, title: extra.title, date: extra.date }] : []),
      ...active.map((subject) => ({ id: subject.key, title: subject.title, date: options.perSubject ? subject.date : options.date })),
    ],
    items: [
      ...(extra ? extra.items.map((item) => ({ ...item, s: extra.id })) : []),
      ...active.flatMap((subject) =>
        subject.test
          .map((item, index) => ({ item, index }))
          .filter(({ item }) => item.kind === 'short' || item.correct.length > 0)
          .map(({ item, index }) => ({
            id: item.uid,
            s: subject.key,
            f: 't' as const,
            tp: item.topic,
            // a subject of variants: positions repeat in every file, so its order is the subject's own
            o: subject.files.length > 1 ? index + 1 : item.position,
            ...(item.code || item.kind === 'multiple' ? { slow: 1 as const } : {}),
          })),
      ),
    ],
    today: { firstAt: null, doneSec: 0, newDone: {} },
    pace: null,
    ai: null,
    ...(typeof options.examQuestions === 'number' ? { examQuestions: options.examQuestions } : {}),
  };
}

/** Signals of a file the student can pick in «Как в файле отмечен ответ?», with the items each marks. */
export function signalCounts(result: BankParseResult): Array<{ signal: (typeof FORMAT_SIGNALS)[number]; n: number }> {
  return FORMAT_SIGNALS.map((signal) => {
    const counts = result.format_signals?.[signal];
    return { signal, n: counts ? counts.one + counts.many : 0 };
  });
}
