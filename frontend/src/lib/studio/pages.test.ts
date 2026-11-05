import { describe, expect, it } from 'vitest';
import { DOC_MAX_BLOCKS, DOC_PAGE_BLOCKS, type DocBlock, type TestDoc } from '../../types/testDoc';
import { emptyDoc, questionIds, syncQuestions } from './doc';
import { appendQuestions, fitPages, largestPage, pageOfIndex, pageOfInsert, pageQuestions, pageRanges, pagesBySubject, pagesFit, pageStarts, pageTitle, type SubjectsOf } from './pages';

/** Made-up subjects of an exam: four of 240 questions, as an exam of 4 × 12 variants of 20. */
const SUBJECTS = ['sa', 'sb', 'sc', 'sd'];
const TITLES: Record<string, string> = { sa: 'Анатомия', sb: 'Физиология', sc: 'Фармакология', sd: 'Гигиена' };
const itemId = (subject: string, n: number) => `${subject}-${String(n).padStart(4, '0')}`;
const EXAM = SUBJECTS.flatMap((subject) => Array.from({ length: 240 }, (_, at) => ({ id: itemId(subject, at + 1), subject_id: subject })));
const SUBJECT_OF = new Map(EXAM.map((item) => [item.id, item.subject_id]));
const subjects: SubjectsOf = { subjectOf: (id) => SUBJECT_OF.get(id), titleOf: (id) => TITLES[id] ?? '' };

const q = (item: string, n: number): DocBlock => ({ type: 'question', id: `q${String(n).padStart(8, '0')}`, item_id: item, points: 1, required: false });
const line = (n: number): DocBlock => ({ type: 'divider', id: `line${String(n).padStart(6, '0')}` });
const page = (n: number, title = ''): DocBlock => ({ type: 'page', id: `page${String(n).padStart(6, '0')}`, title });
const docOf = (blocks: DocBlock[]): TestDoc => ({ ...emptyDoc('Итоговый экзамен'), blocks });

/** Each page's question count and title. */
function shape(doc: TestDoc) {
  const ranges = pageRanges(doc.blocks);
  const counts = pageQuestions(doc.blocks, ranges, () => true);
  return ranges.map((range, at) => ({ title: pageTitle(doc.blocks, range), questions: counts[at].count, blocks: range.end - range.start }));
}

describe('the pages of the test', () => {
  it('a page from one «Новая страница» to the next; the first is what stands before', () => {
    const blocks = [line(0), line(1), page(2), line(3), page(4)];
    expect(pageStarts(blocks)).toEqual([0, 2, 4]);
    expect(pageRanges(blocks)).toEqual([
      { start: 0, end: 2 },
      { start: 2, end: 4 },
      { start: 4, end: 5 },
    ]);
    // A test that starts with «Новая страница»: that block opens the first page.
    expect(pageRanges([page(0), line(1)])).toEqual([{ start: 0, end: 2 }]);
    expect(pageRanges([])).toEqual([{ start: 0, end: 0 }]);
  });

  it('the page of a block, and of a place a block is put at', () => {
    const starts = pageStarts([line(0), line(1), page(2), line(3), page(4), line(5)]);
    expect([0, 1, 2, 3, 4, 5, 9].map((at) => pageOfIndex(starts, at))).toEqual([0, 0, 1, 1, 2, 2, 2]);
    // Put at 2: after block 1, on the first page (before the «Новая страница» of the second).
    expect([0, 1, 2, 3, 4, 6].map((at) => pageOfInsert(starts, at))).toEqual([0, 0, 0, 1, 1, 2]);
  });

  it('pagesFit: no page past 400, unless one was already and none grew', () => {
    const full = Array.from({ length: DOC_PAGE_BLOCKS }, (_, at) => line(at));
    expect(pagesFit([], full)).toBe(true);
    expect(pagesFit(full, [...full, line(999)])).toBe(false);
    expect(pagesFit(full, [...full, page(998), line(999)])).toBe(true);
    const over = [...full, line(999)];
    expect(largestPage(over)).toBe(401);
    expect(pagesFit(over, over.slice(1))).toBe(true);
    // Two pages joined past 400 (a «Новая страница» taken away).
    const two = [...full.slice(0, 300), page(1), ...full.slice(0, 200).map((_, at) => line(1000 + at))];
    expect(pagesFit(two, two.filter((block) => block.type !== 'page'))).toBe(false);
  });
});

describe('the exam\'s questions go on pages (appendQuestions, syncQuestions)', () => {
  it('a new test: the exam\'s order, a page a subject, titled by it (none before the first)', () => {
    const doc = syncQuestions(emptyDoc('Итоговый экзамен'), EXAM, undefined, subjects);
    expect(questionIds(doc)).toEqual(EXAM.map((item) => item.id));
    expect(shape(doc)).toEqual([
      { title: '', questions: 240, blocks: 240 },
      { title: 'Физиология', questions: 240, blocks: 241 },
      { title: 'Фармакология', questions: 240, blocks: 241 },
      { title: 'Гигиена', questions: 240, blocks: 241 },
    ]);
    expect(syncQuestions(doc, EXAM, undefined, subjects)).toBe(doc);
  });

  it('the owner\'s test (05.11): 400 on one page, then the 560 not on it — four pages of 240, nothing moved', () => {
    const first = EXAM.slice(0, 400).map((item, at) => q(item.id, at));
    const before = docOf(first);
    const next = appendQuestions(before, EXAM.slice(400), subjects);
    expect(questionIds(next)).toEqual(EXAM.map((item) => item.id));
    expect(shape(next)).toEqual([
      { title: '', questions: 240, blocks: 240 },
      { title: 'Физиология', questions: 240, blocks: 241 },
      { title: 'Фармакология', questions: 240, blocks: 241 },
      { title: 'Гигиена', questions: 240, blocks: 241 },
    ]);
    // The author's 400 blocks stay as they were, in their order; only page breaks came between them.
    expect(next.blocks.filter((block) => first.includes(block))).toEqual(first);
    // «Страница на каждый предмет» has nothing more to do.
    expect(pagesBySubject(next, subjects)).toEqual({ doc: next, added: 0 });
  });

  it('a subject past 400 goes on over pages of 400', () => {
    const big = Array.from({ length: 900 }, (_, at) => ({ id: itemId('sa', at + 1), subject_id: 'sa' }));
    const known: SubjectsOf = { subjectOf: (id) => (id.startsWith('sa') ? 'sa' : undefined), titleOf: () => 'Анатомия' };
    const doc = appendQuestions(emptyDoc('Т'), big, known);
    expect(shape(doc)).toEqual([
      { title: '', questions: 400, blocks: 400 },
      { title: 'Анатомия', questions: 399, blocks: 400 },
      { title: 'Анатомия', questions: 101, blocks: 102 },
    ]);
    expect(largestPage(doc.blocks)).toBe(DOC_PAGE_BLOCKS);
  });

  it('the blocks the author put before a subject go with it when its full page is cut', () => {
    const blocks = [...EXAM.slice(0, 239).map((item, at) => q(item.id, at)), { type: 'heading', id: 'headpart2', text: 'Часть 2', size: 'l' } as DocBlock];
    blocks.push(...EXAM.slice(240, 400).map((item, at) => q(item.id, 1000 + at)));
    const doc = appendQuestions(docOf(blocks), [EXAM[400]], subjects);
    const ranges = pageRanges(doc.blocks);
    expect(ranges).toHaveLength(2);
    // The cut is right after the last question of the first subject: the heading opens the second page's run.
    expect(doc.blocks[ranges[1].start]).toMatchObject({ type: 'page', title: 'Физиология' });
    expect(doc.blocks[ranges[1].start + 1]).toMatchObject({ id: 'headpart2' });
    expect(shape(doc)).toEqual([
      { title: '', questions: 239, blocks: 239 },
      { title: 'Физиология', questions: 161, blocks: 163 },
    ]);
    // A question of the first subject not on the test yet comes at the end, on a page of its own subject.
    const later = appendQuestions(doc, [EXAM[239]], subjects);
    expect(shape(later)[2]).toEqual({ title: 'Анатомия', questions: 1, blocks: 2 });
  });

  it('an empty page at the end takes the questions; without subjects only the 400 cut counts', () => {
    const doc = appendQuestions(docOf([line(0), page(1, 'Вопросы')]), EXAM.slice(240, 243), subjects);
    expect(shape(doc)).toEqual([
      { title: '', questions: 0, blocks: 1 },
      { title: 'Вопросы', questions: 3, blocks: 4 },
    ]);
    const plain = appendQuestions(docOf(Array.from({ length: 399 }, (_, at) => line(at))), EXAM.slice(0, 3).map(({ id }) => ({ id })), null);
    expect(shape(plain)).toEqual([
      { title: '', questions: 1, blocks: 400 },
      { title: '', questions: 2, blocks: 3 },
    ]);
  });

  it('stops at the test\'s 2100 blocks', () => {
    const blocks = Array.from({ length: DOC_MAX_BLOCKS - 2 }, (_, at) => (at > 0 && at % 400 === 0 ? page(at) : line(at)));
    const doc = appendQuestions(docOf(blocks), EXAM.slice(0, 5), subjects);
    expect(doc.blocks).toHaveLength(DOC_MAX_BLOCKS);
    expect(questionIds(doc)).toEqual([EXAM[0].id, EXAM[1].id]);
  });
});

describe('«Страница на каждый предмет» (pagesBySubject)', () => {
  it('a break before each subject, after the last question of the one before; nothing moves', () => {
    const blocks: DocBlock[] = [
      { type: 'cover', id: 'cover0001', title: 'Экзамен', subtitle: '', image: null, align: 'center' },
      ...EXAM.slice(0, 150).map((item, at) => q(item.id, at)),
      { type: 'heading', id: 'headpart2', text: 'Вторая часть', size: 'l' },
      ...EXAM.slice(240, 390).map((item, at) => q(item.id, 1000 + at)),
    ];
    const result = pagesBySubject(docOf(blocks), subjects);
    expect(result?.added).toBe(1);
    const doc = result?.doc as TestDoc;
    expect(doc.blocks.filter((block) => block.type !== 'page')).toEqual(blocks);
    expect(shape(doc)).toEqual([
      { title: '', questions: 150, blocks: 151 },
      { title: 'Физиология', questions: 150, blocks: 152 },
    ]);
    expect(doc.blocks[151]).toMatchObject({ type: 'page', title: 'Физиология' });
    expect(pagesBySubject(doc, subjects)).toEqual({ doc, added: 0 });
  });

  it('a break the author put between subjects is enough; a subject over 400 is cut every 400', () => {
    const blocks = [...EXAM.slice(0, 10).map((item, at) => q(item.id, at)), page(1, 'Своё'), ...EXAM.slice(240, 250).map((item, at) => q(item.id, 100 + at))];
    expect(pagesBySubject(docOf(blocks), subjects)?.added).toBe(0);
    const over = docOf(Array.from({ length: 450 }, (_, at) => q(itemId('sa', at + 1), at)));
    const cut = pagesBySubject(over, { subjectOf: () => 'sa', titleOf: () => 'Анатомия' });
    expect(cut?.added).toBe(1);
    expect(shape(cut?.doc as TestDoc)).toEqual([
      { title: '', questions: 400, blocks: 400 },
      { title: 'Анатомия', questions: 50, blocks: 51 },
    ]);
  });

  it('null when the breaks would not fit in the test', () => {
    const alternating = Array.from({ length: DOC_MAX_BLOCKS }, (_, at) => q(itemId(at % 2 === 0 ? 'sa' : 'sb', at), at));
    const known: SubjectsOf = { subjectOf: (id) => id.slice(0, 2), titleOf: () => '' };
    expect(pagesBySubject(docOf(alternating), known)).toBeNull();
  });
});

describe('fitPages', () => {
  it('a page past 400 is cut every 400; the same document when every page fits', () => {
    const doc = docOf(Array.from({ length: 900 }, (_, at) => line(at)));
    const fitted = fitPages(doc);
    expect(pageRanges(fitted.blocks).map((range) => range.end - range.start)).toEqual([400, 400, 102]);
    expect(fitPages(fitted)).toBe(fitted);
  });
});
