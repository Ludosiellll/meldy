import { describe, expect, it } from 'vitest';
import type { BankItem, BankParseResult } from '../../../types/container';
import { applyReview, editMode, fragmentOf, looksLikeStem, needsLook, reviewCounts, reviewed, type ReviewOp } from './reviewModel';

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
    expect([second.label, second.text, second.options, second.kind]).toEqual(['Б', 'Самая длинная река Европы?', [], 'open']);
    expect(result.items.map((entry) => entry.position)).toEqual([1, 2, 3, 4]);
    expect(first.marks.bold).toEqual([0, 1]);
    // a split is not a check: neither part is «Проверено»; the first is whole now, the second has no options yet
    expect([first.reviewed, second.reviewed]).toEqual([undefined, undefined]);
    expect([needsLook(first), needsLook(second)]).toEqual([false, true]);
    expect(reviewCounts(result)).toMatchObject({ total: 4, checked: 0 });
  });

  // Six questions glued into one, the key read from an «Ответ: …» line of the whole block (live, 2026-10-20).
  const block = (patch: Partial<BankItem> = {}) =>
    bank([
      item(1, {
        label: '1',
        kind: 'multiple',
        text: 'Какой частью речи является слово «стол»?',
        options: [
          'существительное', 'глагол', 'прилагательное',
          '2. Какой частью речи является слово «бежать»?', 'существительное', 'глагол', 'наречие',
          '3. Какой частью речи является слово «красный»?', 'существительное', 'прилагательное', 'глагол',
        ],
        correct: [0, 5, 9],
        evidence: 'answer_line',
        answer: 'А, Б, В',
        flags: ['several_marked', 'many_options'],
        marks: {},
        confidence: 0.1,
        doubts: ['structure', 'key', 'option_merged'],
        ...patch,
      }),
      item(2),
    ]);

  it('a split never checks a part: a part still glued stays doubtful, and the block’s key line is no part’s key', () => {
    const result = applyReview(block(), [{ op: 'split', id: '1', at: 3 }]);
    const [head, tail] = result.items;
    expect(result.items).toHaveLength(3);
    expect([head.reviewed, tail.reviewed]).toEqual([undefined, undefined]);
    // «А существительное» was the block's key line, not the first question's: the student sets it
    expect([head.correct, head.evidence, head.kind, head.answer]).toEqual([[], '', 'single', null]);
    expect(head.flags).toContain('no_key');
    expect(head.doubts).toContain('key_split');
    expect(needsLook(head)).toBe(true);
    // the second part still holds the third question
    expect([tail.label, tail.options.length, tail.correct]).toEqual(['2', 7, []]);
    expect(tail.doubts).toEqual(expect.arrayContaining(['option_merged', 'key_split']));
    expect(needsLook(tail)).toBe(true);
    expect(reviewCounts(result)).toMatchObject({ total: 3, doubtful: 2, checked: 0 });
    expect(result.doubtful).toBe(2);
    expect(result.stats).toMatchObject({ items: 3, no_key: 2, with_key: 1 });
  });

  it('after a split a part is single choice by its own keys: a press on В gives В, not «А, В»', () => {
    const ops: ReviewOp[] = [{ op: 'split', id: '1', at: 3 }, { op: 'key', id: '1', correct: [2] }];
    const head = applyReview(block(), ops).items[0];
    expect([head.correct, head.kind, head.evidence, head.reviewed]).toEqual([[2], 'single', 'manual', true]);
    expect(head.doubts).not.toContain('key_split');
    const counts = reviewCounts(applyReview(block(), ops));
    expect(counts).toMatchObject({ total: 3, doubtful: 1, checked: 1 });
  });

  it('keys marked on the options themselves go with their options: one each — no doubt, but still not checked', () => {
    const bold = block({
      options: ['существительное', 'глагол', 'прилагательное', '2. Какой частью речи является слово «бежать»?', 'существительное', 'глагол', 'наречие'],
      correct: [0, 5],
      evidence: 'bold',
      marks: { bold: [1, 0, 0, 0, 0, 1, 0] },
    });
    const result = applyReview(bold, [{ op: 'split', id: '1', at: 3 }]);
    const [head, tail] = result.items;
    expect([head.correct, head.kind, head.evidence, head.flags]).toEqual([[0], 'single', 'bold', []]);
    expect([tail.correct, tail.kind, tail.evidence, tail.flags]).toEqual([[1], 'single', 'bold', []]);
    expect([needsLook(head), needsLook(tail), head.reviewed, tail.reviewed]).toEqual([false, false, undefined, undefined]);
    expect(reviewCounts(result)).toMatchObject({ doubtful: 0, checked: 0 });
    // two marks left on one part: which is its key is the student's call
    const two = applyReview(block({ ...bold.items[0], correct: [0, 1, 5] }), [{ op: 'split', id: '1', at: 3 }]).items[0];
    expect([two.correct, two.kind]).toEqual([[0, 1], 'multiple']);
    expect(two.flags).toContain('several_marked');
    expect(needsLook(two)).toBe(true);
  });

  it('a key found by the question’s number stays with the first part only while it points at its own options', () => {
    const listed = (correct: number[]) => applyReview(block({ evidence: 'key_list', correct }), [{ op: 'split', id: '1', at: 3 }]).items;
    const [own, rest] = listed([1]);
    expect([own.correct, own.evidence, needsLook(own)]).toEqual([[1], 'key_list', false]);
    expect([rest.correct, rest.doubts?.includes('key_split')]).toEqual([[], true]);
    const [outside] = listed([5]);
    expect([outside.correct, outside.doubts?.includes('key_split')]).toEqual([[], true]);
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

// «Изменить текст» (the owner, 18.11): the student types the question's words and its options on the review screen.
describe('«Изменить текст»: the words of a question and its options, typed by hand', () => {
  const same = (options: string[]) => options.map((text, from) => ({ from, text }));
  const doubtful = (patch: Partial<BankItem> = {}) =>
    bank([
      item(1, {
        text: 'Скольок будет 2 + 2?',
        options: ['три', 'четыре Ответ: б', 'пять'],
        flags: ['joined_lines'],
        confidence: 0.2,
        doubts: ['option_merged', 'key'],
        images: { stem: ['p1'], options: [[], ['p2'], []] },
        ...patch,
      }),
      item(2),
    ]);

  it('new words keep the key, the kind, the marks and the pictures; the question is checked and its text doubts go', () => {
    const ops: ReviewOp[] = [{ op: 'edit', id: '1', text: ' Сколько будет 2 + 2? ', options: same(['три', 'четыре', 'пять']) }];
    const base = doubtful({ doubts: ['option_merged', 'structure'] });
    const result = applyReview(base, ops);
    const fixed = result.items[0];
    expect([fixed.text, fixed.options]).toEqual(['Сколько будет 2 + 2?', ['три', 'четыре', 'пять']]);
    expect([fixed.correct, fixed.kind, fixed.evidence]).toEqual([[1], 'single', 'bold']);
    expect(fixed.marks).toEqual({ bold: [0, 1, 0] });
    expect(fixed.images).toEqual({ stem: ['p1'], options: [[], ['p2'], []] });
    expect([fixed.reviewed, fixed.doubts, fixed.flags]).toEqual([true, [], []]);
    expect(needsLook(fixed)).toBe(false);
    expect(reviewCounts(result)).toMatchObject({ total: 2, doubtful: 0, checked: 1 });
    // the question beside it is not touched, and the parse the review began from is not changed
    expect(result.items[1]).toEqual(item(2));
    expect(base.items[0].text).toBe('Скольок будет 2 + 2?');
  });

  it('a doubt about the key is not settled by new words: the question still waits for a press on an option', () => {
    const ops: ReviewOp[] = [{ op: 'edit', id: '1', text: 'Сколько будет 2 + 2?', options: same(['три', 'четыре', 'пять']) }];
    const result = applyReview(doubtful(), ops);
    const fixed = result.items[0];
    expect([fixed.text, fixed.reviewed, fixed.doubts]).toEqual(['Сколько будет 2 + 2?', undefined, ['key']]);
    expect(needsLook(fixed)).toBe(true);
    expect(reviewCounts(result)).toMatchObject({ doubtful: 1, checked: 0 });
    // the press checks it, and one kept earlier stays kept after new words
    const pressed = applyReview(doubtful(), [...ops, { op: 'key', id: '1', correct: [1] }]).items[0];
    expect([pressed.reviewed, pressed.doubts, pressed.text]).toEqual([true, [], 'Сколько будет 2 + 2?']);
    expect(applyReview(doubtful(), [{ op: 'keep', id: '1' }, ...ops]).items[0].reviewed).toBe(true);
    // the same for a key the rules and the file's key list read differently
    const conflict = applyReview(doubtful({ doubts: ['structure'], flags: ['key_conflict'], confidence: 1 }), ops).items[0];
    expect([conflict.reviewed, needsLook(conflict)]).toEqual([undefined, true]);
  });

  it('an option taken out takes its key, mark and picture with it; the keys of the rest follow their options', () => {
    const base = doubtful({ kind: 'multiple', correct: [1, 2], marks: { bold: [0, 1, 1] } });
    const drop = applyReview(base, [{ op: 'edit', id: '1', text: 'Скольок будет 2 + 2?', options: [{ from: 0, text: 'три' }, { from: 2, text: 'пять' }] }]).items[0];
    expect([drop.options, drop.correct, drop.kind]).toEqual([['три', 'пять'], [1], 'single']);
    expect(drop.marks).toEqual({ bold: [0, 1] });
    expect(drop.images).toEqual({ stem: ['p1'], options: [[], []] });
    // the only right option is taken out: no key is left, and the question says so
    const none = applyReview(doubtful(), [{ op: 'edit', id: '1', text: 'Скольок будет 2 + 2?', options: [{ from: 0, text: 'три' }, { from: 2, text: 'пять' }] }]).items[0];
    expect([none.correct, none.evidence, none.kind]).toEqual([[], '', 'single']);
    expect(none.flags).toContain('no_key');
    // a question the edit left without a key is not «Проверено»: it waits for its key, even one the parse was sure of
    const sure = applyReview(doubtful({ confidence: 1, doubts: [] }), [{ op: 'edit', id: '1', text: 'x', options: [{ from: 0, text: 'три' }, { from: 2, text: 'пять' }] }]).items[0];
    expect([sure.reviewed, sure.doubts, needsLook(sure)]).toEqual([undefined, ['key'], true]);
    expect(applyReview(doubtful(), [{ op: 'edit', id: '1', text: 'x', options: [{ from: 0, text: 'три' }, { from: 2, text: 'пять' }] }]).stats).toMatchObject({ no_key: 1, with_key: 1 });
  });

  it('an option added by hand goes where it was put, without a key; an empty added one is nothing', () => {
    const ops: ReviewOp[] = [
      { op: 'edit', id: '1', text: 'Скольок будет 2 + 2?', options: [{ from: 0, text: 'три' }, { from: null, text: ' шесть ' }, { from: 1, text: 'четыре' }, { from: 2, text: 'пять' }, { from: null, text: '  ' }] },
    ];
    const fixed = applyReview(doubtful(), ops).items[0];
    expect([fixed.options, fixed.correct, fixed.kind]).toEqual([['три', 'шесть', 'четыре', 'пять'], [2], 'single']);
    expect(fixed.marks).toEqual({ bold: [0, 0, 1, 0] });
    expect(fixed.images).toEqual({ stem: ['p1'], options: [[], [], ['p2'], []] });
  });

  it('options added to a question without options make it a choice question that waits for its key', () => {
    const open = bank([item(1, { kind: 'open', options: [], correct: [], evidence: '', marks: {}, confidence: 0.2, doubts: ['options_unread'] })]);
    const fixed = applyReview(open, [{ op: 'edit', id: '1', text: 'Вопрос 1?', options: [{ from: null, text: 'да' }, { from: null, text: 'нет' }] }]).items[0];
    expect([fixed.kind, fixed.options, fixed.correct, fixed.reviewed]).toEqual(['single', ['да', 'нет'], [], undefined]);
    expect(fixed.flags).toContain('no_key');
    expect(needsLook(fixed)).toBe(true);
    // and the other way: every option taken out leaves an open question, with no key flags
    const bare = applyReview(doubtful({ flags: ['no_key'], correct: [], evidence: '' }), [{ op: 'edit', id: '1', text: 'Назовите столицу.', options: [] }]).items[0];
    expect([bare.kind, bare.options, bare.flags, bare.doubts, bare.reviewed]).toEqual(['open', [], [], [], true]);
  });

  it('an empty text keeps the old one; words left as they were are kept to the letter', () => {
    const base = doubtful({ options: ['три ', 'четыре\nстрока', 'пять'] });
    const fixed = applyReview(base, [{ op: 'edit', id: '1', text: '   ', options: same(['три ', 'четыре\nстрока', 'шесть']) }]).items[0];
    expect(fixed.text).toBe('Скольок будет 2 + 2?');
    expect(fixed.options).toEqual(['три ', 'четыре\nстрока', 'шесть']);
  });

  it('an order question takes new words only: its options are not added or taken out; a cloze is not edited at all', () => {
    const order = bank([item(1, { kind: 'order', options: ['утро', 'день', 'вечер'], correct: [], order: [0, 1, 2], evidence: 'order_numbers', marks: {} })]);
    const fixed = applyReview(order, [{ op: 'edit', id: '1', text: 'Расставьте по порядку.', options: [{ from: 2, text: 'ночь' }, { from: null, text: 'лишний' }] }]).items[0];
    expect([fixed.text, fixed.options, fixed.order, fixed.kind]).toEqual(['Расставьте по порядку.', ['утро', 'день', 'ночь'], [0, 1, 2], 'order']);
    const cloze = bank([item(1, { kind: 'cloze', text: 'Столица ___.', options: [], correct: [], gaps: [['Минск']], marks: {} })]);
    expect(applyReview(cloze, [{ op: 'edit', id: '1', text: 'Столица.', options: [] }]).items[0]).toEqual(cloze.items[0]);
    expect([editMode(order.items[0]), editMode(cloze.items[0]), editMode(item(1)), editMode(item(1, { kind: 'match' }))]).toEqual(['words', null, 'full', 'words']);
  });

  it('undo is the list without the last operation: the question is as the file gave it', () => {
    const ops: ReviewOp[] = [{ op: 'edit', id: '1', text: 'Новый текст?', options: same(['а', 'б', 'в']) }];
    expect(applyReview(doubtful(), ops.slice(0, -1)).items[0]).toEqual(doubtful().items[0]);
  });
});
