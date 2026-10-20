import { describe, expect, it } from 'vitest';
import type { BankItem, BankParseResult } from '../../../types/container';
import { applyReview, fragmentOf, looksLikeStem, needsLook, reviewCounts, reviewed } from './reviewModel';

function item(position: number, patch: Partial<BankItem> = {}): BankItem {
  return {
    position,
    label: String(position),
    subject: 1,
    topic: null,
    kind: 'single',
    text: `Вопрос ${position}?`,
    options: ['один', 'два', 'три'],
    correct: [1],
    order: [],
    pairs: [],
    answer: null,
    evidence: 'bold',
    flags: [],
    code: false,
    where: '',
    marks: { bold: [0, 1, 0] },
    lines: [position * 4 - 3, position * 4],
    confidence: 1,
    doubts: [],
    ...patch,
  };
}

function bank(items: BankItem[], patch: Partial<BankParseResult> = {}): BankParseResult {
  return {
    method: 'rules',
    layout: 'numbered_paragraphs',
    layouts_seen: {},
    confidence: 1,
    key_source: {},
    format_signal: 'bold',
    format_signals: {},
    mark_share: 0.6,
    marker: null,
    markers: [],
    subjects: [{ index: 1, title: null, evidence: 'none', items: items.length }],
    topics: [],
    skipped: [],
    warnings: [],
    items,
    stats: { items: items.length, with_key: items.length, no_key: 0, ambiguous: 0, to_check: 0, duplicates: 0, kinds: {}, options: {}, gaps: [], key_lists: 0 },
    doubtful: items.filter((entry) => (entry.confidence ?? 1) < 0.6).length,
    source_lines: [],
    ...patch,
  };
}

// «А. Кто написал …?» with the next question glued in as its last option, and «Дунай» read as a question of its own.
const GLUED = bank([
  item(1, {
    label: '',
    text: 'Кто написал «Войну и мир»?',
    options: ['Достоевский', 'Толстой', 'Б. Самая длинная река Европы?'],
    correct: [1],
    marks: { bold: [0, 1, 0] },
    confidence: 0.15,
    doubts: ['option_merged'],
  }),
  item(2, { label: '1', text: 'Дунай', options: [], correct: [], kind: 'open', evidence: '', flags: [], confidence: 0.55, doubts: ['stem_fragment'] }),
  item(3, { text: 'Сколько будет 2 + 2?', options: ['3', '4'], correct: [1], confidence: 1 }),
]);

describe('the review of a parse', () => {
  it('splits a glued question at the option that starts it, keys and numbers staying with their own question', () => {
    const { result, ids } = reviewed(GLUED, [{ op: 'split', id: '1', at: 2 }]);
    expect(ids).toEqual(['1', '1+', '2', '3']);
    const [first, second] = result.items;
    expect([first.text, first.options, first.correct]).toEqual(['Кто написал «Войну и мир»?', ['Достоевский', 'Толстой'], [1]]);
    expect([second.label, second.text, second.options, second.kind, second.reviewed]).toEqual(['Б', 'Самая длинная река Европы?', [], 'open', true]);
    expect(result.items.map((entry) => entry.position)).toEqual([1, 2, 3, 4]);
    expect(first.marks.bold).toEqual([0, 1]);
  });

  it('merges a one-word «question» into the question above as its option, and a cut stem with its second half', () => {
    const asOption = applyReview(GLUED, [{ op: 'split', id: '1', at: 2 }, { op: 'merge', id: '1+' }]);
    expect(asOption.items[1].text).toBe('Самая длинная река Европы?');
    expect(asOption.items[1].options).toEqual(['Дунай']);
    expect(asOption.items.length).toBe(3);
    expect(asOption.items[1].doubts).toEqual([]);
    // the same from below: «Дунай» — «Это вариант вопроса выше»
    expect(applyReview(GLUED, [{ op: 'split', id: '1', at: 2 }, { op: 'up', id: '2' }]).items[1].options).toEqual(['Дунай']);
    expect(applyReview(GLUED, [{ op: 'up', id: '1' }]).items).toHaveLength(3); // nothing above the first
    const cut = bank([
      item(1, { text: 'Чему равна сумма', options: [], correct: [], kind: 'open', evidence: '' }),
      item(2, { text: 'углов треугольника?', options: ['90°', '180°'], correct: [1] }),
    ]);
    const stem = applyReview(cut, [{ op: 'merge', id: '1' }]);
    expect(stem.items).toHaveLength(1);
    expect([stem.items[0].text, stem.items[0].options, stem.items[0].correct, stem.items[0].kind]).toEqual([
      'Чему равна сумма\nуглов треугольника?', ['90°', '180°'], [1], 'single',
    ]);
    expect(stem.items[0].lines).toEqual([1, 8]);
  });

  it('sets a key by hand, drops what is not a question, keeps the rest as it is, and recounts', () => {
    const noKey = bank([item(1, { correct: [], evidence: '', flags: ['no_key'], confidence: 0.4, doubts: ['key'] }), item(2), item(3, { text: 'Страница 3 из 10', options: [], correct: [], kind: 'open', confidence: 0.3, doubts: ['stem_fragment'] })]);
    expect(reviewCounts(noKey)).toMatchObject({ total: 3, doubtful: 2, checked: 0 });
    const fixed = applyReview(noKey, [{ op: 'key', id: '1', correct: [2] }, { op: 'drop', id: '3' }, { op: 'keep', id: '2' }]);
    expect(fixed.items.map((entry) => [entry.correct, entry.evidence, entry.flags])).toEqual([[[2], 'manual', []], [[1], 'bold', []]]);
    expect(fixed.stats).toMatchObject({ items: 2, with_key: 2, no_key: 0 });
    expect(fixed.subjects[0].items).toBe(2);
    expect(reviewCounts(fixed)).toMatchObject({ total: 2, doubtful: 0, checked: 2 });
    expect(applyReview(noKey, [{ op: 'key', id: '1', correct: [0, 2] }]).items[0].kind).toBe('multiple');
  });

  it('takes the other version after the model pass, and keeps the first as the other', () => {
    const differ = bank([
      item(1, {
        source: 'rules',
        flags: ['ai_disagrees'],
        alt: { text: 'Вопрос 1?', options: ['один', 'два'], correct: [0], kind: 'single', answer: null, evidence: 'bold', source: 'ai' },
      }),
    ]);
    expect(needsLook(differ.items[0])).toBe(true);
    const taken = applyReview(differ, [{ op: 'alt', id: '1' }]).items[0];
    expect([taken.options, taken.correct, taken.source, taken.flags, taken.reviewed]).toEqual([['один', 'два'], [0], 'ai', [], true]);
    expect(taken.alt).toMatchObject({ options: ['один', 'два', 'три'], source: 'rules' });
  });

  it('ignores an operation on a question that is gone, and an undo is the list without its last step', () => {
    const ops = [{ op: 'drop', id: '2' } as const, { op: 'keep', id: '2' } as const];
    expect(applyReview(GLUED, ops).items.map((entry) => entry.text)).toEqual(['Кто написал «Войну и мир»?', 'Сколько будет 2 + 2?']);
    expect(applyReview(GLUED, ops.slice(0, 0)).items).toHaveLength(3);
  });

  it('gives the file lines around a question and spots an option that starts a question', () => {
    const lines = [1, 2, 3, 4, 5, 6].map((n) => ({ n, runs: [{ t: `строка ${n}`, m: '' }], cell: null, checkbox: null, images: 0 }));
    const result = bank([item(1, { lines: [2, 4] })], { source_lines: lines });
    expect(fragmentOf(result, result.items[0]).map((line) => line.n)).toEqual([1, 2, 3, 4, 5]);
    expect(fragmentOf(result, { ...result.items[0], lines: null })).toEqual([]);
    expect(looksLikeStem('Б. Самая длинная река Европы?')).toBe(true);
    expect(looksLikeStem('Л. Н. Толстой')).toBe(false);
  });
});
