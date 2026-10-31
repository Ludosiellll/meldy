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
 *   keep_order for «Все перечисленные» / «Ни один…», ref = `<import id>:<position>`.
 */
import {
  EXPLANATION_MAX, PICTURE_LIMITS, PICTURE_STEM, pictureOption,
  type BankItem, type BankParseResult, type ItemInput, type ItemKind, type KeySource, type PlanInput, type PlanItem,
} from '../../../types/container';
import { subjectFromFileName } from './subjectName';

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
  | 'too_long';

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
  fileId: string;
  fileName: string;
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
  'key_invalid', 'key_letter', 'partial', 'no_key', 'duplicate', 'too_long',
];
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

  const saveKey = !imageLost && !several && correct.length > 0;
  const keyFlags: string[] = [];
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

/** The subjects to save, from every file and the student's edits, in the files' order. */
export function deriveSubjects(files: readonly ImportFile[], edits: ImportEdits = NO_EDITS): DraftSubject[] {
  const out: DraftSubject[] = [];
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
      const pictures = item.images ? `|${item.images.stem.join(',')}|${item.images.options.map((list) => list.join(',')).sort().join(';')}` : '';
      const key = `${sameKey(item.text)}|${[...item.options].map(sameKey).sort().join('|')}${pictures}`;
      const first = firstOf.get(key);
      if (first !== undefined) twinOf.set(item.position, first);
      else firstOf.set(key, item.label || String(item.position));
    }

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
        const variant = groups.length === 1 && typeof result.variant === 'number' ? `Вариант ${result.variant}` : null;
        const named = (text: string) => new RegExp(`(^|\\D)${result.variant}(\\D|$)`).test(text);
        if (fromName && !(variant && !named(fromName))) {
          title = fromName;
          titleFrom = 'file';
        } else if (variant) {
          title = fromName && /^вариант$/iu.test(fromName) ? variant : fromName ? `${fromName}, ${variant.toLocaleLowerCase('ru-RU')}` : variant;
          titleFrom = 'file';
        } else {
          untitled += 1;
          title = `Предмет ${untitled}`;
          titleFrom = 'number';
        }
      }

      const test: DraftItem[] = [];
      const blocked: DraftItem[] = [];
      const oral: DraftOral[] = [];
      let skippedKinds = 0;
      let removedItems = 0;
      let shortOral = 0;
      let answerDropped = 0;
      for (const item of items) {
        const uid = `${file.id}:${item.position}`;
        const fix = edits.items[uid] ?? {};
        if (fix.removed) {
          removedItems += 1;
          continue;
        }
        const asOral = (hadAnswer: boolean) => {
          const text = item.text.trim().slice(0, ORAL_MAX_CHARS);
          if (text.length < ORAL_MIN_CHARS) {
            shortOral += 1;
            return;
          }
          if (hadAnswer) answerDropped += 1;
          oral.push({ uid, position: item.position, label: (item.label ?? '').trim(), text, section: item.topic, hadAnswer });
        };
        if (file.format === 'open') {
          asOral(Boolean(item.answer));
          continue;
        }
        if (item.kind === 'order' || item.kind === 'match' || item.kind === 'cloze') {
          // Release 48: order and match are questions of their own kinds now (none is thrown away when it has its key);
          // release 49: so is a Moodle cloze.
          const kept = kindDraft(item, { fileId: file.id, twin: twinOf.get(item.position) ?? null });
          if (!kept) {
            skippedKinds += 1;
            continue;
          }
          kept.topic = item.topic;
          test.push(kept);
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
        const draft = draftItem(item, { fileId: file.id, signal, fix, twin: twinOf.get(item.position) ?? null });
        draft.topic = item.topic;
        (draft.blocked ? blocked : test).push(draft);
      }

      // Topics of the test part: numbered 1.. in the order they appear, the tail merged into the 99th.
      const topicIds: number[] = [];
      for (const item of [...test, ...blocked]) {
        if (item.topic !== null && !topicIds.includes(item.topic)) topicIds.push(item.topic);
      }
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

      const keyedTest = test.filter((item) => item.kind === 'short' || item.correct.length > 0);
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
      const allNoKey = !fileEdit.noKeyLater && choice.length > 0 && choice.every((item) => item.rawCorrect.length === 0);

      // More than 150 oral questions: parts of 150, the test part stays with the first.
      const parts = Math.max(1, Math.ceil(oral.length / ORAL_CAP));
      for (let part = 1; part <= parts; part += 1) {
        const split = parts > 1;
        const key = split ? `${group.key}#${part}` : group.key;
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
        const partTitle = split
          ? edit.title?.trim() || `${title}, часть ${part}`
          : title;
        out.push({
          key,
          fileId: file.id,
          fileName: file.name,
          source: file.source,
          format: file.format,
          title: partTitle,
          titleFrom: split && edit.title?.trim() ? 'user' : titleFrom,
          restart,
          merged,
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
          oralSections: sections.map((id, index) => (topicTitle.get(id) ?? `Раздел ${index + 1}`).slice(0, 200)),
          skippedKinds: first ? skippedKinds : 0,
          removedItems: first ? removedItems : 0,
          shortOral: first ? shortOral : 0,
          keySource: first ? keySource : null,
          keyed: first ? keyedTest.length : 0,
          noKey: first ? choice.filter((item) => item.correct.length === 0 && !item.imageLost).length : 0,
          imageLost: first ? test.filter((item) => item.imageLost).length : 0,
          answerDropped: first ? answerDropped : 0,
          allNoKey: first ? allNoKey : false,
          numbers: first ? numbersOf(items) : null,
          topicCounts: first ? topicCounts : [],
        });
      }
    });
  }
  return out;
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
    const items = [...subject.test, ...subject.blocked].sort((a, b) => a.position - b.position);
    for (const item of items) {
      const problems = subject.allNoKey ? item.problems.filter((problem) => problem !== 'no_key') : item.problems;
      if (problems.length === 0) continue;
      out.push({ uid: item.uid, subjectKey: subject.key, subjectTitle: subject.title, item, problem: problems[0] });
    }
  }
  return out;
}

/** «в 4 нет ответа, в 2 выделено два, 1 повторяется» for one subject's preview. */
export function problemParts(subject: DraftSubject): Array<{ problem: Problem; n: number }> {
  const counts = new Map<Problem, number>();
  for (const item of [...subject.test, ...subject.blocked]) {
    const problems = subject.allNoKey ? item.problems.filter((problem) => problem !== 'no_key') : item.problems;
    if (problems.length) counts.set(problems[0], (counts.get(problems[0]) ?? 0) + 1);
  }
  return PROBLEM_ORDER.filter((problem) => counts.has(problem)).map((problem) => ({ problem, n: counts.get(problem)! }));
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
  const keyed = activeSubjects(subjects).flatMap((subject) =>
    subject.test.filter((item) => item.kind !== 'short' && item.correct.length > 0).map((item) => ({ subject: subject.title, item })),
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
export function itemInputs(subject: Pick<DraftSubject, 'test'>, importId: string, place: PicturePlace = () => null): ItemInput[] {
  return subject.test.map((item) => {
    if (item.kind === 'number' || item.kind === 'order' || item.kind === 'match' || item.kind === 'cloze') {
      // release 48 (docs/kinds/CONTRACT.md §1): their key is in options / answers
      const input: ItemInput = {
        ref: `${importId}:${item.position}`,
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
      ref: `${importId}:${item.position}`,
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
          .filter((item) => item.kind === 'short' || item.correct.length > 0)
          .map((item) => ({
            id: item.uid,
            s: subject.key,
            f: 't' as const,
            tp: item.topic,
            o: item.position,
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
