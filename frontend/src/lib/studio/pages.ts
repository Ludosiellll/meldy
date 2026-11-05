/**
 * The test's pages as the canvas shows them (owner, 2026-11-05: an exam of 960 questions — «можно ли показать остальные
 * на второй странице, потом на третьей»): pure functions over the blocks.
 *
 * A page is the run of blocks from one «Новая страница» block (it opens its page) to the next; the first page is what
 * stands before the first one (when the test starts with a «Новая страница», that block opens the first page). The same
 * cut as the participant's «По страницам» (components/studio/docRun.ts stepsOf), so «Страница 3» of the canvas is the
 * participant's third page; the other layouts ignore the cut, and the canvas still shows one page at a time.
 *
 * A page holds at most DOC_PAGE_BLOCKS (400) blocks — the size the canvas is proven smooth at; the whole test holds
 * DOC_MAX_BLOCKS. The questions the studio adds from the exam keep the exam's order, a subject starts a page of its own
 * (titled by the subject), and a page that would pass 400 is cut (appendQuestions). «Страница на каждый предмет»
 * (pagesBySubject) adds the cuts at the subject boundaries of a page built before. Neither moves nor removes a block.
 */
import { DOC_MAX_BLOCKS, DOC_PAGE_BLOCKS, type DocBlock, type PageBlock, type QuestionBlock, type TestDoc } from '../../types/testDoc';
import { cryptoFill, cut, freshId, oneLine, type RandomFill } from './basics';

/** A page of the canvas: the blocks [start, end) of the test. */
export interface PageRange {
  start: number;
  end: number;
}

/** Where each page starts: 0, then the index of every «Новая страница» after the first block. */
export function pageStarts(blocks: readonly Pick<DocBlock, 'type'>[]): number[] {
  const starts = [0];
  for (let at = 1; at < blocks.length; at += 1) if (blocks[at].type === 'page') starts.push(at);
  return starts;
}

/** The pages of the test (one empty page when there are no blocks). */
export function pageRanges(blocks: readonly Pick<DocBlock, 'type'>[]): PageRange[] {
  const starts = pageStarts(blocks);
  return starts.map((start, at) => ({ start, end: at + 1 < starts.length ? starts[at + 1] : blocks.length }));
}

/** The page (from 0) that holds block `index`; past the end — the last page. */
export function pageOfIndex(starts: readonly number[], index: number): number {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (starts[mid] <= index) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

/** The page a block inserted at `index` lands on (it follows block index − 1). */
export function pageOfInsert(starts: readonly number[], index: number): number {
  return index <= 0 ? 0 : pageOfIndex(starts, index - 1);
}

/** The number of blocks of the biggest page. */
export function largestPage(blocks: readonly Pick<DocBlock, 'type'>[]): number {
  let most = 0;
  for (const range of pageRanges(blocks)) most = Math.max(most, range.end - range.start);
  return most;
}

/**
 * A change keeps the pages within DOC_PAGE_BLOCKS: no page of `after` passes it, unless one of `before` already did and
 * none grew past that (a page made elsewhere is not made worse, nor is every edit near it refused).
 */
export function pagesFit(before: readonly Pick<DocBlock, 'type'>[], after: readonly Pick<DocBlock, 'type'>[]): boolean {
  const most = largestPage(after);
  return most <= DOC_PAGE_BLOCKS || most <= largestPage(before);
}

/** A page's own title: its «Новая страница» block's, or '' (the first page, or a page without one). */
export function pageTitle(blocks: readonly DocBlock[], range: PageRange): string {
  const first = blocks[range.start];
  return first?.type === 'page' ? first.title.trim() : '';
}

/** The questions of each page: how many, and the number (from 1, over the whole test) of the first one. */
export function pageQuestions(blocks: readonly DocBlock[], ranges: readonly PageRange[], counts: (block: QuestionBlock) => boolean): Array<{ count: number; first: number }> {
  let before = 0;
  return ranges.map((range) => {
    let count = 0;
    for (let at = range.start; at < range.end; at += 1) {
      const block = blocks[at];
      if (block.type === 'question' && counts(block)) count += 1;
    }
    const out = { count, first: before + 1 };
    before += count;
    return out;
  });
}

// ─────────────────────────────────────────────── questions added from the exam

/** What the paging knows of the exam: a row's subject, a subject's title. */
export interface SubjectsOf {
  /** The subject of the row a question block points at (undefined: unknown, a row gone). */
  subjectOf: (itemId: string) => string | undefined;
  /** A subject's title, for the page it opens. */
  titleOf: (subjectId: string) => string;
}

const pageTitleOf = (title: string) => cut(oneLine(title).trim(), 200);

/** The subject of the last question block of `blocks[from, to)` whose subject is known, or null. */
function lastSubject(blocks: readonly DocBlock[], subjects: SubjectsOf, from: number, to: number): string | null {
  for (let at = to - 1; at >= from; at -= 1) {
    const block = blocks[at];
    if (block.type !== 'question') continue;
    const subject = subjects.subjectOf(block.item_id);
    if (subject !== undefined) return subject;
  }
  return null;
}

/**
 * The exam's questions not on the page yet, appended at the end in the order given (the exam's), each subject on a page
 * of its own and no page past DOC_PAGE_BLOCKS, while the test has room (DOC_MAX_BLOCKS); what does not fit is left out
 * (the caller counts it).
 *
 * - A question of another subject than the last question on the test starts a new page titled by its subject (not when
 *   the test has no question yet, nor when its last block opens a page still empty: the questions go there).
 * - The last page full: when it holds the end of another subject before this one's run, the page is cut where that
 *   subject ends (the run, with the blocks the author put before it, goes to a new page with what comes); otherwise a new
 *   page continues the subject.
 *
 * Blocks already there are never moved or removed; a cut is a «Новая страница» put between them. The same document back
 * when nothing is added.
 */
export function appendQuestions(
  doc: TestDoc,
  items: ReadonlyArray<{ id: string; subject_id?: string }>,
  subjects: SubjectsOf | null,
  random: RandomFill = cryptoFill,
): TestDoc {
  const blocks = [...doc.blocks];
  const ids = new Set(blocks.map((block) => block.id));
  const onPage = new Set<string>();
  for (const block of blocks) if (block.type === 'question') onPage.add(block.item_id.toLowerCase());
  const added = new Map<string, string | undefined>();
  const known: SubjectsOf = {
    subjectOf: (itemId) => (added.has(itemId) ? added.get(itemId) : subjects?.subjectOf(itemId)),
    titleOf: (subject) => subjects?.titleOf(subject) ?? '',
  };
  const starts = pageStarts(blocks);
  let start = starts[starts.length - 1];
  let current = lastSubject(blocks, known, 0, blocks.length);
  let changed = false;
  const newPage = (at: number, subject: string | undefined) => {
    const page: PageBlock = { type: 'page', id: freshId(ids, random), title: subject ? pageTitleOf(known.titleOf(subject)) : '' };
    blocks.splice(at, 0, page);
    start = at;
  };
  for (const item of items) {
    const key = item.id.toLowerCase();
    if (onPage.has(key)) continue;
    const subject = item.subject_id;
    const emptyPage = blocks.length > 0 && blocks[blocks.length - 1].type === 'page';
    if (subjects && subject !== undefined && current !== null && subject !== current && !emptyPage) {
      if (blocks.length + 2 > DOC_MAX_BLOCKS) break;
      newPage(blocks.length, subject);
    } else if (blocks.length - start + 1 > DOC_PAGE_BLOCKS) {
      // The last page is full: cut it where another subject's questions end, when this run started on it.
      let cutAt = -1;
      if (subjects && subject !== undefined) {
        for (let at = blocks.length - 1; at > start; at -= 1) {
          const block = blocks[at];
          if (block.type !== 'question') continue;
          const of = known.subjectOf(block.item_id);
          if (of !== undefined && of !== subject) {
            cutAt = at + 1;
            break;
          }
        }
      }
      if (cutAt > start && cutAt < blocks.length && blocks.length + 1 <= DOC_MAX_BLOCKS) newPage(cutAt, subject);
      if (blocks.length - start + 1 > DOC_PAGE_BLOCKS) {
        if (blocks.length + 2 > DOC_MAX_BLOCKS) break;
        newPage(blocks.length, subject);
      }
    }
    if (blocks.length + 1 > DOC_MAX_BLOCKS) break;
    const question: QuestionBlock = { type: 'question', id: freshId(ids, random), item_id: item.id, points: 1, required: false };
    blocks.push(question);
    onPage.add(key);
    added.set(item.id, subject);
    if (subject !== undefined) current = subject;
    changed = true;
  }
  return changed ? { ...doc, blocks } : doc;
}

/**
 * «Страница на каждый предмет»: a «Новая страница» (titled by the subject) where a question of another subject follows
 * one of the previous subject with no page break between them — put right after that question, so the blocks between
 * them (a heading of the next part) go with the next subject; then a page still past DOC_PAGE_BLOCKS is cut every 400
 * blocks. Nothing moves, nothing is removed; `added` — how many pages were put in (0: the same document back). null
 * when the test would pass DOC_MAX_BLOCKS.
 */
export function pagesBySubject(doc: TestDoc, subjects: SubjectsOf, random: RandomFill = cryptoFill): { doc: TestDoc; added: number } | null {
  const ids = new Set(doc.blocks.map((block) => block.id));
  const out: DocBlock[] = [];
  let previous: string | null = null;
  let lastQuestion = -1;
  let broken = false;
  let added = 0;
  for (const block of doc.blocks) {
    if (block.type === 'page') broken = true;
    if (block.type === 'question') {
      const subject = subjects.subjectOf(block.item_id);
      if (subject !== undefined) {
        if (previous !== null && subject !== previous && !broken) {
          out.splice(lastQuestion + 1, 0, { type: 'page', id: freshId(ids, random), title: pageTitleOf(subjects.titleOf(subject)) });
          added += 1;
        }
        previous = subject;
        broken = false;
      }
      out.push(block);
      lastQuestion = out.length - 1;
      continue;
    }
    out.push(block);
  }
  // A page still too big (a subject of more than 400 blocks on one page): cut every DOC_PAGE_BLOCKS.
  for (let range = 0; range < pageRanges(out).length; range += 1) {
    const { start, end } = pageRanges(out)[range];
    if (end - start <= DOC_PAGE_BLOCKS) continue;
    const at = start + DOC_PAGE_BLOCKS;
    const next = out.slice(at).find((block): block is QuestionBlock => block.type === 'question');
    const subject = next ? subjects.subjectOf(next.item_id) : undefined;
    out.splice(at, 0, { type: 'page', id: freshId(ids, random), title: subject ? pageTitleOf(subjects.titleOf(subject)) : '' });
    added += 1;
  }
  if (out.length > DOC_MAX_BLOCKS) return null;
  return added === 0 ? { doc, added } : { doc: { ...doc, blocks: out }, added };
}

/**
 * The pages made to fit: a page past DOC_PAGE_BLOCKS cut every 400 blocks with an untitled «Новая страница» (a test
 * read from text, or made elsewhere); the same document when every page fits or when the cuts would pass DOC_MAX_BLOCKS.
 */
export function fitPages(doc: TestDoc, random: RandomFill = cryptoFill): TestDoc {
  if (largestPage(doc.blocks) <= DOC_PAGE_BLOCKS) return doc;
  const ids = new Set(doc.blocks.map((block) => block.id));
  const out = [...doc.blocks];
  for (let range = 0; range < pageRanges(out).length; range += 1) {
    const { start, end } = pageRanges(out)[range];
    if (end - start > DOC_PAGE_BLOCKS) out.splice(start + DOC_PAGE_BLOCKS, 0, { type: 'page', id: freshId(ids, random), title: '' });
  }
  return out.length > DOC_MAX_BLOCKS ? doc : { ...doc, blocks: out };
}
