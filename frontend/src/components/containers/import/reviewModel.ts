/**
 * The review screen's model: a parse of the question-bank importer (POST /api/exams/parse-bank or …/ai) and the fixes
 * the student made on it, as one-press operations on the questions. `applyReview` returns a new parse in the importer's
 * own shape, so the rest of the import page (importModel.deriveSubjects, saving) takes it as if the file had read so.
 *
 * Questions are named by a stable id (the position in the parse the review started from; a question split off gets
 * `<id>+`), so the operations stay valid while positions shift after a merge, a split or a removal.
 */
import { BANK_DOUBT_AT, type BankItem, type BankItemKind, type BankParseResult, type BankSourceLine } from '../../../types/container';

export type ReviewOp =
  | { op: 'key'; id: string; correct: number[] }
  | { op: 'merge'; id: string }
  | { op: 'up'; id: string }
  | { op: 'split'; id: string; at: number }
  | { op: 'drop'; id: string }
  | { op: 'keep'; id: string }
  | { op: 'alt'; id: string };

export interface ReviewItem extends BankItem {
  id: string;
}

export interface ReviewCounts {
  total: number;
  doubtful: number;
  /** Questions the student kept, fixed or took the other version of. */
  checked: number;
  /** Questions in the model's version (after the AI pass). */
  fromModel: number;
  /** Questions where the rules and the model read differently. */
  differ: number;
}

const KEY_FLAGS = new Set(['no_key', 'key_conflict', 'key_invalid', 'key_letter_ambiguous', 'several_marked', 'partial_mark', 'ai_key_rejected']);
const CHOICE: ReadonlySet<BankItemKind> = new Set(['single', 'multiple', 'truefalse']);
const LEAD_LABEL = /^\(?((?:\d{1,3})|[А-ЯЁA-Z])\s?[.)]\s+(?=\S)/;
const FRAGMENT_MARGIN = 1;

export function isDoubtful(item: BankItem): boolean {
  return !item.reviewed && typeof item.confidence === 'number' && item.confidence < BANK_DOUBT_AT;
}

const LOOK_FLAGS = ['ai_disagrees', 'ai_key_rejected', 'key_conflict'];

/** A question to look at: doubtful, or the rules and the model read it differently. Kept ones are not. */
export function needsLook(item: BankItem): boolean {
  return !item.reviewed && (isDoubtful(item) || item.flags.some((flag) => LOOK_FLAGS.includes(flag)));
}

export function hasKey(item: BankItem): boolean {
  return item.correct.length > 0 || Boolean(item.answer) || item.order.length > 0 || item.pairs.length > 0;
}

/** The parse's questions with stable ids (the position they had when the review began). */
export function reviewItems(result: BankParseResult): ReviewItem[] {
  return result.items.map((item) => ({ ...item, id: String(item.position) }));
}

function cloneItem(item: ReviewItem): ReviewItem {
  return {
    ...item,
    options: [...item.options],
    correct: [...item.correct],
    order: [...item.order],
    pairs: item.pairs.map(([a, b]) => [a, b] as [string, string]),
    flags: [...item.flags],
    doubts: item.doubts ? [...item.doubts] : item.doubts,
    marks: Object.fromEntries(Object.entries(item.marks ?? {}).map(([signal, shares]) => [signal, [...shares]])),
    images: item.images ? { stem: [...item.images.stem], options: item.images.options.map((ids) => [...ids]) } : item.images,
  };
}

function checked(item: ReviewItem): ReviewItem {
  return { ...item, reviewed: true };
}

function kindFor(options: number, correct: number[], kind: BankItemKind): BankItemKind {
  if (options === 0) return kind === 'match' || kind === 'order' || kind === 'cloze' ? kind : 'open';
  if (correct.length > 1) return 'multiple';
  if (kind === 'open' || kind === 'unknown') return 'single';
  return kind;
}

function sliceImages(images: BankItem['images'], from: number, to?: number): BankItem['images'] {
  if (!images) return images;
  return { stem: [], options: images.options.slice(from, to) };
}

function sliceMarks(marks: Record<string, number[]>, from: number, to?: number): Record<string, number[]> {
  return Object.fromEntries(Object.entries(marks ?? {}).map(([signal, shares]) => [signal, shares.slice(from, to)]));
}

function freeId(items: readonly ReviewItem[], base: string): string {
  let id = `${base}+`;
  while (items.some((item) => item.id === id)) id += '+';
  return id;
}

/** «Соединить со следующим»: a stem cut in two, or a «question» that is one of the previous question's options. */
function merge(a: ReviewItem, b: ReviewItem): ReviewItem {
  const out = cloneItem(a);
  if (a.options.length === 0 && !/[?:…]\s*$/.test(a.text)) {
    // the stem goes on: «Чему равна сумма» + «углов треугольника?» with the options under the second part
    out.text = [a.text, b.text].filter(Boolean).join('\n');
    out.options = [...b.options];
    out.correct = [...b.correct];
    out.kind = b.options.length ? b.kind : a.kind;
    out.evidence = b.evidence || a.evidence;
    out.answer = a.answer ?? b.answer;
    out.marks = sliceMarks(b.marks, 0);
    out.images = a.images || b.images ? { stem: [...(a.images?.stem ?? []), ...(b.images?.stem ?? [])], options: b.images?.options ?? [] } : null;
  } else {
    // «Дунай» read as a question of its own: it (and its options, if any) are options of the question above
    const shift = a.options.length + 1;
    out.options = [...a.options, b.text, ...b.options];
    out.correct = [...a.correct, ...b.correct.map((index) => index + shift)];
    out.kind = kindFor(out.options.length, out.correct, a.kind);
    out.marks = Object.fromEntries(
      Object.keys({ ...a.marks, ...b.marks }).map((signal) => [
        signal,
        [...(a.marks?.[signal] ?? a.options.map(() => 0)), 0, ...(b.marks?.[signal] ?? b.options.map(() => 0))],
      ]),
    );
    out.images = a.images || b.images
      ? { stem: a.images?.stem ?? [], options: [...(a.images?.options ?? a.options.map(() => [])), b.images?.stem ?? [], ...(b.images?.options ?? b.options.map(() => []))] }
      : null;
  }
  out.lines = a.lines && b.lines ? [a.lines[0], Math.max(a.lines[1], b.lines[1])] : a.lines ?? b.lines ?? null;
  out.flags = out.flags.filter((flag) => !['few_options', 'no_options', 'joined_lines'].includes(flag));
  out.doubts = [];
  return checked(out);
}

/** A key that marks the option itself (its formatting, a «+», a ticked box, GIFT, the student's press): it goes with it. */
const OPTION_KEYS = new Set(['bold', 'underline', 'italic', 'highlight', 'color', 'shade', 'marker', 'checkbox', 'gift', 'manual']);
/** A key found by the question's number (a list at the end of the file, or the student's): the first part has the number. */
const NUMBER_KEYS = new Set(['key_list', 'key_text']);
/** What the parse said of the glued block as a whole; each part of a split is judged anew (settle). */
const BLOCK_DOUBTS = new Set(['option_merged', 'structure', 'options_count', 'options_unlike', 'joined_lines', 'key', 'key_split']);
const COUNT_FLAGS = new Set(['many_options', 'few_options', 'no_options']);
/** Confidence of a part that still needs a look (below BANK_DOUBT_AT). */
const PART_DOUBT = BANK_DOUBT_AT / 2;

/** The kind of a part by its own options and keys: a block read as «several answers» for its glued keys is not one. */
function ownKind(options: number, correct: number[], kind: BankItemKind): BankItemKind {
  if (kind === 'match' || kind === 'order' || kind === 'cloze') return kind;
  if (options === 0) return 'open';
  if (correct.length > 1) return 'multiple';
  return kind === 'truefalse' && options === 2 ? 'truefalse' : 'single';
}

/**
 * The keys of the two parts of a block split at `at`, or null: the block's key does not say this part's key (a line
 * «Ответ: …» or a key column of the whole block; a number's key pointing past the first part's options).
 */
function partKeys(item: ReviewItem, at: number): [number[] | null, number[] | null] {
  if (!item.correct.length) return [[], []];
  const head = item.correct.filter((index) => index < at);
  const tail = item.correct.filter((index) => index > at).map((index) => index - at - 1);
  if (item.evidence === 'first_option') return [[0], item.options.length > at + 1 ? [0] : []];
  if (OPTION_KEYS.has(item.evidence)) return [head, tail];
  if (NUMBER_KEYS.has(item.evidence)) return [head.length === item.correct.length ? head : null, null];
  return [null, null];
}

/**
 * A part of a split, judged on its own: its kind by its own keys, a doubt while it still looks broken (an option that
 * starts another question, too few options, a key that was the block's, several marks). Never checked by the split:
 * only the student's press («Оставить как есть», a key) checks it.
 */
function settle(part: ReviewItem, block: ReviewItem, keys: number[] | null): ReviewItem {
  part.correct = (keys ?? []).filter((index) => index < part.options.length);
  if (keys === null) part.answer = null; // the block's «Ответ: …» line is no part's own either
  part.kind = ownKind(part.options.length, part.correct, block.kind);
  part.evidence = part.correct.length ? block.evidence : '';
  part.flags = part.flags.filter((flag) => !KEY_FLAGS.has(flag) && !COUNT_FLAGS.has(flag));
  const doubts = (part.doubts ?? []).filter((doubt) => !BLOCK_DOUBTS.has(doubt));
  const asks = CHOICE.has(part.kind);
  if (asks && !part.correct.length) part.flags.push('no_key');
  if (asks && keys === null) doubts.push('key_split');
  if (part.correct.length > 1) {
    part.flags.push('several_marked');
    doubts.push('key');
  }
  if (CHOICE.has(block.kind) && part.options.length < 2) doubts.push('structure');
  if (part.options.some((option, index) => index > 0 && looksLikeStem(option))) doubts.push('option_merged');
  part.doubts = doubts;
  part.confidence = doubts.length ? Math.min(block.confidence ?? 0, PART_DOUBT) : Math.max(block.confidence ?? 0, BANK_DOUBT_AT);
  delete part.reviewed;
  return part;
}

/** «Отсюда новый вопрос»: option `at` is the stem of the next question, the options after it are its options. */
function split(item: ReviewItem, at: number, id: string): [ReviewItem, ReviewItem] {
  const head = cloneItem(item);
  const tail = cloneItem(item);
  head.options = item.options.slice(0, at);
  head.marks = sliceMarks(item.marks, 0, at);
  head.images = item.images ? { stem: item.images.stem, options: item.images.options.slice(0, at) } : item.images;
  const stem = item.options[at] ?? '';
  const lead = LEAD_LABEL.exec(stem);
  tail.id = id;
  tail.label = lead ? lead[1] : '';
  tail.text = lead ? stem.slice(lead[0].length) : stem;
  tail.options = item.options.slice(at + 1);
  tail.answer = null;
  tail.marks = sliceMarks(item.marks, at + 1);
  tail.images = sliceImages(item.images, at + 1);
  tail.alt = null;
  tail.flags = [];
  tail.doubts = [];
  const [headKeys, tailKeys] = partKeys(item, at);
  return [settle(head, item, headKeys), settle(tail, item, tailKeys)];
}

function setKey(item: ReviewItem, correct: number[]): ReviewItem {
  const out = cloneItem(item);
  out.correct = [...new Set(correct)].filter((index) => index >= 0 && index < item.options.length).sort((a, b) => a - b);
  out.kind = out.correct.length > 1 ? 'multiple' : item.kind === 'multiple' && out.correct.length === 1 ? 'single' : kindFor(item.options.length, out.correct, item.kind);
  out.evidence = out.correct.length ? 'manual' : '';
  out.flags = out.flags.filter((flag) => !KEY_FLAGS.has(flag));
  if (!out.correct.length) out.flags.push('no_key');
  out.doubts = (out.doubts ?? []).filter((doubt) => doubt !== 'key' && doubt !== 'key_split');
  return checked(out);
}

function takeAlt(item: ReviewItem): ReviewItem {
  if (!item.alt) return item;
  const out = cloneItem(item);
  const alt = item.alt;
  out.text = alt.text;
  out.options = [...alt.options];
  out.correct = [...alt.correct];
  out.kind = alt.kind;
  out.answer = alt.answer;
  out.evidence = alt.evidence ?? '';
  out.source = alt.source;
  out.alt = {
    text: item.text, options: [...item.options], correct: [...item.correct], kind: item.kind, answer: item.answer,
    evidence: item.evidence || null, source: item.source === 'ai' ? 'ai' : 'rules',
  };
  if (out.options.length !== item.options.length) {
    out.marks = {};
    out.images = item.images ? { stem: item.images.stem, options: out.options.map(() => []) } : item.images;
  }
  out.flags = out.flags.filter((flag) => flag !== 'ai_disagrees');
  return checked(out);
}

/** The parse with the student's operations applied, renumbered, with its counts recomputed. */
export function applyReview(result: BankParseResult, ops: readonly ReviewOp[]): BankParseResult {
  return reviewed(result, ops).result;
}

/** applyReview and the ids of its questions, in order (the operations name questions by these). */
export function reviewed(result: BankParseResult, ops: readonly ReviewOp[]): { result: BankParseResult; ids: string[] } {
  let items = reviewItems(result);
  for (const step of ops) {
    const index = items.findIndex((item) => item.id === step.id);
    if (index < 0) continue;
    const item = items[index];
    const next = [...items];
    switch (step.op) {
      case 'key':
        next[index] = setKey(item, step.correct);
        break;
      case 'keep':
        next[index] = checked(item);
        break;
      case 'drop':
        next.splice(index, 1);
        break;
      case 'alt':
        next[index] = takeAlt(item);
        break;
      case 'merge':
        if (index + 1 >= items.length) continue;
        next.splice(index, 2, merge(item, items[index + 1]));
        break;
      case 'up':
        if (index < 1) continue;
        next.splice(index - 1, 2, merge(items[index - 1], item));
        break;
      case 'split':
        if (step.at < 1 || step.at >= item.options.length) continue;
        next.splice(index, 1, ...split(item, step.at, freeId(items, item.id)));
        break;
    }
    items = next;
  }
  return { result: withCounts(result, items), ids: items.map((item) => item.id) };
}

function withCounts(result: BankParseResult, items: ReviewItem[]): BankParseResult {
  const out: BankItem[] = items.map(({ id: _id, ...item }, index) => ({ ...item, position: index + 1 }));
  const withKey = out.filter(hasKey).length;
  const kinds: Partial<Record<BankItemKind, number>> = {};
  const options: Record<string, number> = {};
  for (const item of out) {
    kinds[item.kind] = (kinds[item.kind] ?? 0) + 1;
    options[String(item.options.length)] = (options[String(item.options.length)] ?? 0) + 1;
  }
  return {
    ...result,
    items: out,
    subjects: result.subjects.map((subject) => ({ ...subject, items: out.filter((item) => item.subject === subject.index).length })),
    topics: result.topics.map((topic) => ({ ...topic, items: out.filter((item) => item.topic === topic.index).length })),
    doubtful: out.filter(needsLook).length,
    stats: {
      ...result.stats,
      items: out.length,
      with_key: withKey,
      no_key: out.filter((item) => item.flags.includes('no_key')).length,
      to_check: out.filter((item) => item.flags.length > 0).length,
      kinds,
      options,
    },
  };
}

export function reviewCounts(result: BankParseResult): ReviewCounts {
  return {
    total: result.items.length,
    doubtful: result.items.filter(needsLook).length,
    checked: result.items.filter((item) => item.reviewed).length,
    fromModel: result.items.filter((item) => item.source === 'ai').length,
    differ: result.items.filter((item) => item.flags.includes('ai_disagrees')).length,
  };
}

/** The file's lines around a question (one line of margin), from the lines the parse sent; [] — none sent. */
export function fragmentOf(result: BankParseResult, item: BankItem): BankSourceLine[] {
  if (!item.lines) return [];
  const [first, last] = item.lines;
  return (result.source_lines ?? []).filter((line) => line.n >= first - FRAGMENT_MARGIN && line.n <= last + FRAGMENT_MARGIN);
}

/**
 * The parse after the model pass with the lines the rules parse had sent kept as well: both number the file the same
 * way, and a question the model read anew may sit on lines only the first answer carried.
 */
export function keepSourceLines(next: BankParseResult, before: BankParseResult): BankParseResult {
  const have = new Set((next.source_lines ?? []).map((line) => line.n));
  const kept = (before.source_lines ?? []).filter((line) => !have.has(line.n));
  if (!kept.length) return next;
  return { ...next, source_lines: [...(next.source_lines ?? []), ...kept].sort((a, b) => a.n - b.n) };
}

const plainText = (text: string) => text.replace(/\s+/g, ' ').trim();

/** What the other version (after the model pass) changes: only the key, the options under the same words, or the words. */
export function altDifference(item: BankItem): 'key' | 'options' | 'text' | null {
  const alt = item.alt;
  if (!alt) return null;
  if (plainText(alt.text) !== plainText(item.text)) return 'text';
  if (alt.options.length !== item.options.length || alt.options.some((option, index) => plainText(option) !== plainText(item.options[index]))) {
    return 'options';
  }
  const sameKey = [...alt.correct].sort().join() === [...item.correct].sort().join() && (alt.answer ?? '') === (item.answer ?? '');
  return sameKey ? 'text' : 'key';
}

/** Whether a question's option looks like the start of another question (a split is offered on it). */
export function looksLikeStem(option: string): boolean {
  return /\?\s*$/.test(option) || (LEAD_LABEL.test(option) && option.length > 24);
}
