/**
 * A quiz «как в студии» (release 47.2; plan docs/superpowers/plans/2026-10-18-studio.md «Participant (agent S4)»;
 * migration 20261019100000_test_docs.sql): the studio page that the preview, the attempt and the result carry as
 * `design`, made safe to draw, and the page an attempt is shown on.
 *
 * - The page's cover (the first cover block, before any question) is the start screen of /k/<код>: the title, the
 *   line under it and the picture. The attempt does not repeat it: its title stays as the page's heading.
 * - The attempt's questions are the server's (`attempt.items`, drawn from the page at the start, keyed ones only): a
 *   question block whose row is not among them is left out (no key, deleted, added after the start, or not drawn: a page
 *   of more than 200 questions gives each attempt item_count of them, 20261107090500_studio_pages.sql), and a question
 *   of the attempt the page no longer has (the author edited the page after the start) comes at the end.
 * - A page of the test (from one «Новая страница» to the next) whose questions are all left out is left out whole, its
 *   other blocks with it (a subject's heading over none of its questions): the participant meets no empty page. A page
 *   that never had a question (an introduction) stays; the start screen's title stays on the first page shown.
 */
import { normalizeDoc } from '../studio/doc';
import type { Answer, DocItem } from '../../components/studio/docRun';
import type { MockAnswer } from '../../components/containers/mockModel';
import type { QuizAttemptItem } from '../../types/quiz';
import type { CoverBlock, DocBlock, QuestionBlock, ResultBand, TestDoc } from '../../types/testDoc';

const isObject = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/** The page of a quiz «как в студии» as DocView draws it (normalizeDoc: anything odd falls back); null — not one. */
export function designDoc(raw: unknown): TestDoc | null {
  if (!isObject(raw) || !Array.isArray(raw.blocks)) return null;
  return normalizeDoc(raw).doc;
}

/** The result's band as the page would keep it (one line of title, https links only, a picture of the bucket); null — none. */
export function bandOf(raw: unknown): ResultBand | null {
  if (!isObject(raw)) return null;
  return normalizeDoc({ blocks: [], results: { bands: [raw], cta: null } }).doc.results.bands[0] ?? null;
}

/** The cover the start screen shows: the first cover block, when it comes before any question. */
export function startCover(doc: TestDoc): CoverBlock | null {
  for (const block of doc.blocks) {
    if (block.type === 'question') return null;
    if (block.type === 'cover') return block;
  }
  return null;
}

/** Prefix of the blocks made for questions the page no longer has (not a studio id: those are [a-z0-9] only). */
export const EXTRA_PREFIX = 'extra-';

/**
 * The page an attempt is shown on: the start screen's cover reduced to its title (a heading), without question blocks
 * of questions the attempt does not hold (each question once, in the attempt's spelling of its id) and without the pages
 * of the test all of whose questions those were, and with the attempt's questions the page no longer has at the end —
 * one point each, not required.
 */
export function attemptDoc(doc: TestDoc, items: ReadonlyArray<Pick<QuizAttemptItem, 'id'>>): TestDoc {
  const ids = new Map(items.map((item) => [item.id.toLowerCase(), item.id]));
  const cover = startCover(doc);
  const used = new Set<string>();
  // The test's pages (a «Новая страница» after the first block opens one): their blocks, their questions, the kept ones.
  const pages: Array<{ blocks: DocBlock[]; had: number; kept: number; title: DocBlock | null }> = [];
  let current: (typeof pages)[number] = { blocks: [], had: 0, kept: 0, title: null };
  doc.blocks.forEach((block, at) => {
    if (block.type === 'page' && at > 0) {
      pages.push(current);
      current = { blocks: [block], had: 0, kept: 0, title: null };
      return;
    }
    if (block === cover) {
      // The start screen showed the cover; the page keeps its title as its heading.
      const heading: DocBlock = { type: 'heading', id: block.id, text: block.title, size: 'l' };
      current.blocks.push(heading);
      current.title = heading;
      return;
    }
    if (block.type !== 'question') {
      current.blocks.push(block);
      return;
    }
    current.had += 1;
    const id = ids.get(block.item_id.toLowerCase());
    if (!id || used.has(id)) return;
    used.add(id);
    current.kept += 1;
    current.blocks.push(id === block.item_id ? block : { ...block, item_id: id });
  });
  pages.push(current);
  const blocks: DocBlock[] = [];
  let title: DocBlock | null = null;
  for (const entry of pages) {
    if (entry.had > 0 && entry.kept === 0) {
      title ??= entry.title;
      continue;
    }
    if (title) {
      // The test's title heads the first page shown (after its «Новая страница», whose title the participant sees first).
      entry.blocks.splice(entry.blocks[0]?.type === 'page' ? 1 : 0, 0, title);
      title = null;
    }
    blocks.push(...entry.blocks);
  }
  if (title) blocks.unshift(title);
  for (const item of items) {
    if (used.has(item.id)) continue;
    used.add(item.id);
    const extra: QuestionBlock = { type: 'question', id: `${EXTRA_PREFIX}${item.id}`, item_id: item.id, points: 1, required: false };
    blocks.push(extra);
  }
  return { ...doc, blocks };
}

/** A question of the attempt as DocView reads it (no key: the attempt has none). */
export function asDocItem(item: QuizAttemptItem): DocItem {
  return {
    id: item.id,
    kind: item.kind,
    stem: item.stem,
    options: Array.isArray(item.options) ? item.options : [],
    code: Boolean(item.code),
    keep_order: Boolean(item.keep_order),
    images: item.images ?? null,
    // release 48: only what the attempt's item carries (a new kind or partial credit)
    ...(item.unit !== undefined ? { unit: item.unit } : {}),
    ...(item.partial !== undefined ? { partial: Boolean(item.partial) } : {}),
    ...(item.right !== undefined ? { right: item.right } : {}),
  };
}

/** The attempt's answer (QuizRun: file indices, the words, or null) as DocView holds it. */
export function docAnswer(value: MockAnswer | string[] | undefined): Answer | undefined {
  if (Array.isArray(value) && value.length > 0 && typeof value[0] === 'string') return { texts: [...(value as string[])] };
  if (Array.isArray(value)) return value.length > 0 ? { chosen: [...(value as number[])] } : undefined;
  if (typeof value === 'string') return value === '' ? undefined : { text: value };
  return undefined;
}

/** DocView's answer as the attempt keeps it: an empty choice or empty words take the answer back (null). */
export function attemptAnswer(answer: Answer, kind: QuizAttemptItem['kind'], textMax = 200): MockAnswer | string[] {
  // release 48: the new kinds keep their lists as given (order, match), a text per gap (cloze), longer essays
  if (kind === 'cloze') return answer.texts && answer.texts.some((t) => t.trim() !== '') ? answer.texts.map((t) => t.slice(0, 200)) : null;
  if (kind === 'order' || kind === 'match') return answer.chosen && answer.chosen.some((v) => v >= 0) ? [...answer.chosen] : null;
  if (kind === 'number' || kind === 'essay') {
    const text = (answer.text ?? '').slice(0, kind === 'essay' ? 6000 : textMax);
    return text.trim() === '' ? null : text;
  }
  if (kind === 'short') {
    const text = (answer.text ?? '').slice(0, textMax);
    return text === '' ? null : text;
  }
  const chosen = [...new Set(answer.chosen ?? [])].sort((a, b) => a - b);
  return chosen.length > 0 ? chosen : null;
}
