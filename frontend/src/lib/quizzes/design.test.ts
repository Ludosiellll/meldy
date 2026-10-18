import { describe, expect, it } from 'vitest';
import type { QuizAttemptItem } from '../../types/quiz';
import type { DocBlock, DocDesign } from '../../types/testDoc';
import { asDocItem, attemptAnswer, attemptDoc, bandOf, designDoc, docAnswer, EXTRA_PREFIX, startCover } from './design';

const EXAM = '11111111-2222-4333-8444-555555555555';
const PIC = `${EXAM}/${'a'.repeat(64)}.jpg`;
const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'aaaaaaaa-0000-4000-8000-000000000002';
const C = 'aaaaaaaa-0000-4000-8000-000000000003';

const item = (id: string, over: Partial<QuizAttemptItem> = {}): QuizAttemptItem => ({ id, kind: 'single', stem: `Вопрос ${id}`, options: ['да', 'нет'], code: false, keep_order: false, images: null, ...over });

function design(blocks: DocBlock[]): DocDesign {
  return {
    title: 'Кислоты',
    theme: { accent: { custom: '#3fb68b' }, background: { kind: 'plain' }, font: 'serif', radius: 'round', density: 'compact', answers: 'grid', buttons: 'square' },
    layout: 'one_by_one',
    blocks,
    results: { bands: [{ from: 0, to: 100, title: 'Итог', text: '', image: null }], cta: { label: 'Дальше', url: 'https://example.org/next' } },
  };
}

const cover: DocBlock = { type: 'cover', id: 'cover0000001', title: 'Кислоты и основания', subtitle: 'Проверочная', image: PIC, align: 'left' };
const q = (id: string, itemId: string, points = 1, required = false): DocBlock => ({ type: 'question', id, item_id: itemId, points, required });

describe('design: the page a quiz «как в студии» carries', () => {
  it('is drawn only from an object with blocks, and made safe (normalizeDoc)', () => {
    expect(designDoc(null)).toBeNull();
    expect(designDoc('page')).toBeNull();
    expect(designDoc({ title: 'x' })).toBeNull();
    const doc = designDoc({ ...design([cover, q('quest0000001', A, 3, true)]), theme: { accent: 'nonsense' }, layout: 'sideways' });
    expect(doc?.v).toBe(1);
    expect(doc?.layout).toBe('one_by_one');
    expect(doc?.theme.accent).toBe('blue');
    expect(doc?.blocks).toHaveLength(2);
    expect(designDoc(design([cover]))?.theme).toMatchObject({ accent: { custom: '#3fb68b' }, font: 'serif', answers: 'grid', buttons: 'square' });
  });

  it('the start screen’s cover is the first cover before any question', () => {
    const doc = designDoc(design([{ type: 'text', id: 'text00000001', text: 'Вступление', align: 'left' }, cover, q('quest0000001', A)]))!;
    expect(startCover(doc)?.title).toBe('Кислоты и основания');
    expect(startCover(designDoc(design([q('quest0000001', A), cover]))!)).toBeNull();
    expect(startCover(designDoc(design([q('quest0000001', A)]))!)).toBeNull();
  });

  it('the band as the page would keep it, or null', () => {
    expect(bandOf(null)).toBeNull();
    expect(bandOf({ from: 50, to: 80 })).toBeNull();
    expect(bandOf({ from: 50, to: 80, title: 'Хорошо\nочень', text: 'Почти **всё**', image: 'elsewhere.png' })).toEqual({ from: 50, to: 80, title: 'Хорошо очень', text: 'Почти **всё**', image: null });
    expect(bandOf({ from: 0, to: 49, title: 'Ещё раз', text: '', image: PIC })?.image).toBe(PIC);
  });
});

describe('design: the page an attempt is shown on', () => {
  const page = designDoc(
    design([
      cover,
      { type: 'note', id: 'note00000001', tone: 'tip', text: 'Подсказка' },
      q('quest0000001', A.toUpperCase(), 2, true),
      q('quest0000002', 'bbbbbbbb-0000-4000-8000-00000000dead'),
      q('quest0000003', B, 3),
    ]),
  )!;

  it('keeps the cover’s title as a heading, leaves out questions the attempt does not hold, adds the ones the page lost', () => {
    const doc = attemptDoc(page, [item(A), item(B), item(C)]);
    expect(doc.blocks.map((block) => [block.type, block.id])).toEqual([
      ['heading', 'cover0000001'],
      ['note', 'note00000001'],
      ['question', 'quest0000001'],
      ['question', 'quest0000003'],
      ['question', `${EXTRA_PREFIX}${C}`],
    ]);
    expect(doc.blocks[0]).toMatchObject({ text: 'Кислоты и основания', size: 'l' });
    // The attempt's spelling of the id; points and «обязательный» stay; a lost question weighs 1, not required.
    expect(doc.blocks[2]).toMatchObject({ item_id: A, points: 2, required: true });
    expect(doc.blocks[4]).toMatchObject({ item_id: C, points: 1, required: false });
    expect(doc.theme).toBe(page.theme);
  });

  it('shows each question once', () => {
    const twice = { ...page, blocks: [...page.blocks, q('quest0000009', B)] };
    expect(attemptDoc(twice, [item(A), item(B)]).blocks.filter((block) => block.type === 'question')).toHaveLength(2);
  });

  it('reads an attempt’s question and its answers both ways', () => {
    const multiple = item(A, { kind: 'multiple', options: ['a', 'b', 'c'], keep_order: true, images: { stem: ['p.png'] } as QuizAttemptItem['images'] });
    expect(asDocItem(multiple)).toEqual({ id: A, kind: 'multiple', stem: `Вопрос ${A}`, options: ['a', 'b', 'c'], code: false, keep_order: true, images: { stem: ['p.png'] } });
    expect(asDocItem({ ...multiple, options: null as unknown as string[], images: undefined as unknown as null }).options).toEqual([]);
    expect(docAnswer([2, 0])).toEqual({ chosen: [2, 0] });
    expect(docAnswer([])).toBeUndefined();
    expect(docAnswer('Лион')).toEqual({ text: 'Лион' });
    expect(docAnswer('')).toBeUndefined();
    expect(docAnswer(null)).toBeUndefined();
    expect(docAnswer(undefined)).toBeUndefined();
    expect(attemptAnswer({ chosen: [2, 0, 2] }, 'multiple')).toEqual([0, 2]);
    expect(attemptAnswer({ chosen: [] }, 'single')).toBeNull();
    expect(attemptAnswer({}, 'single')).toBeNull();
    expect(attemptAnswer({ text: 'нейтрализация' }, 'short')).toBe('нейтрализация');
    expect(attemptAnswer({ text: '' }, 'short')).toBeNull();
    expect(attemptAnswer({}, 'short')).toBeNull();
    expect(attemptAnswer({ text: 'я'.repeat(250) }, 'short')).toHaveLength(200);
  });
});
