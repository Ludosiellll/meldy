import { describe, expect, it } from 'vitest';
import { emptyDoc } from '../../lib/studio/doc';
import type { DocBlock, TestDoc } from '../../types/testDoc';
import { answered, bandFor, gradeDoc, isRight, missingRequired, normShort, questionNumbers, stepsOf, visibleBlocks, type DocItem } from './docRun';

const single: DocItem = { id: 'i1', kind: 'single', stem: 'Один', options: ['а', 'б', 'в'], code: false, correct: [1] };
const multiple: DocItem = { id: 'i2', kind: 'multiple', stem: 'Несколько', options: ['а', 'б', 'в'], code: false, correct: [0, 2] };
const short: DocItem = { id: 'i3', kind: 'short', stem: 'Слово', options: [], code: false, answers: ['Ёж', 'ежик'] };
const unkeyed: DocItem = { id: 'i4', kind: 'single', stem: 'Без ключа', options: ['а', 'б'], code: false, correct: [] };
const items = new Map([single, multiple, short, unkeyed].map((item) => [item.id, item]));

const q = (id: string, itemId: string, points = 1, required = false): DocBlock => ({ type: 'question', id, item_id: itemId, points, required });
const blocks: DocBlock[] = [
  { type: 'cover', id: 'cover', title: 'Тест', subtitle: '', image: null, align: 'center' },
  { type: 'text', id: 'intro', text: 'Начнём', align: 'left' },
  q('q1', 'i1', 1, true),
  { type: 'page', id: 'p2', title: 'Вторая' },
  { type: 'heading', id: 'h2', text: 'Часть 2', size: 'l' },
  q('q2', 'i2', 2),
  q('gone', 'missing'),
  q('q3', 'i3', 1, true),
  { type: 'page', id: 'p3', title: 'Пустая' },
  { type: 'divider', id: 'end' },
  q('q4', 'i4'),
];
const doc = (layout: TestDoc['layout']): TestDoc => ({
  ...emptyDoc('Т'),
  layout,
  blocks,
  results: { bands: [{ from: 0, to: 49, title: 'Слабо', text: '', image: null }, { from: 50, to: 100, title: 'Хорошо', text: '', image: null }], cta: null },
});

describe('docRun: the steps of the layouts', () => {
  it('skips question blocks without their row and numbers the rest', () => {
    const shown = visibleBlocks(doc('one_page'), items);
    expect(shown.map((block) => block.id)).not.toContain('gone');
    expect([...questionNumbers(shown)]).toEqual([
      ['q1', 1],
      ['q2', 2],
      ['q3', 3],
      ['q4', 4],
    ]);
  });

  it('«Одна страница»: everything in one step, the page marks left out', () => {
    const page = doc('one_page');
    const steps = stepsOf(page, visibleBlocks(page, items));
    expect(steps).toHaveLength(1);
    expect(steps[0].blocks.map((block) => block.type)).not.toContain('page');
  });

  it('«По одному»: each question with the blocks before it; what follows the last one goes with it', () => {
    const page = doc('one_by_one');
    const steps = stepsOf(page, visibleBlocks(page, items));
    expect(steps.map((step) => step.blocks.map((block) => block.id))).toEqual([['cover', 'intro', 'q1'], ['h2', 'q2'], ['q3'], ['end', 'q4']]);
  });

  it('«По страницам»: a page block starts a step with its title; an empty page is skipped', () => {
    const page = doc('pages');
    const steps = stepsOf(page, visibleBlocks(page, items));
    expect(steps.map((step) => [step.page?.title ?? null, step.blocks.map((block) => block.id)])).toEqual([
      [null, ['cover', 'intro', 'q1']],
      ['Вторая', ['h2', 'q2', 'q3']],
      ['Пустая', ['end', 'q4']],
    ]);
    const blank = { ...emptyDoc('Т'), layout: 'pages' as const };
    expect(stepsOf(blank, [])).toEqual([{ page: null, blocks: [] }]);
  });

  it('lists the required questions without an answer', () => {
    const shown = visibleBlocks(doc('one_page'), items);
    const numbers = questionNumbers(shown);
    expect(missingRequired(shown, {}, numbers)).toEqual([1, 3]);
    expect(missingRequired(shown, { i1: { chosen: [0] }, i3: { text: '  ' } }, numbers)).toEqual([3]);
    expect(answered({ text: 'x' })).toBe(true);
    expect(answered({ chosen: [] })).toBe(false);
    expect(answered(undefined)).toBe(false);
  });
});

describe('docRun: grading in the author’s preview', () => {
  it('checks each kind by its key; a row without a key is not graded', () => {
    expect(isRight(single, { chosen: [1] })).toBe(true);
    expect(isRight(single, { chosen: [0] })).toBe(false);
    expect(isRight(multiple, { chosen: [2, 0, 0] })).toBe(true);
    expect(isRight(multiple, { chosen: [0] })).toBe(false);
    expect(isRight(short, { text: '  ЕЖ ' })).toBe(true);
    expect(isRight(short, { text: 'ёжик' })).toBe(true);
    expect(isRight(short, { text: '' })).toBe(false);
    expect(isRight(unkeyed, { chosen: [0] })).toBeNull();
    expect(isRight({ ...short, answers: [] }, { text: 'a' })).toBeNull();
    expect(normShort('  Ёлка   зелёная ')).toBe('елка зеленая');
  });

  it('counts the points of the right answers, the percent and its band', () => {
    const page = doc('one_page');
    expect(gradeDoc(page, items, { i1: { chosen: [1] }, i2: { chosen: [0, 2] }, i3: { text: 'нет' } })).toMatchObject({ score: 3, max: 4, percent: 75, band: { title: 'Хорошо' } });
    expect(gradeDoc(page, items, {})).toMatchObject({ score: 0, max: 4, percent: 0, band: { title: 'Слабо' } });
    expect(gradeDoc({ ...page, blocks: [] }, items, {})).toMatchObject({ score: 0, max: 0, percent: 0 });
    expect(bandFor({ ...page, results: { bands: [], cta: null } }, 50)).toBeNull();
  });
});
