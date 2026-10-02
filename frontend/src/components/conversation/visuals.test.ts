import { describe, expect, it } from 'vitest';
import {
  buildConversation,
  estimateMinutes,
  hasModelVisuals,
  mergeVisualsByIndex,
  normalizeForMatch,
  parseGeneratedLines,
  pluralLines,
  sanitizeVisual,
  toFiniteNumber,
  VISUAL_LIMITS,
} from './visuals';
import { axisNotToScale } from './ChartView';

describe('sanitizeVisual', () => {
  it('keeps a valid chart and strips unknown keys', () => {
    const visual = sanitizeVisual({
      type: 'chart',
      title: 'Рост выручки',
      kind: 'bar',
      unit: 'млн ₽',
      data: [
        { label: '2022', value: 12, color: 'red' },
        { label: '2023', value: '15,5' },
      ],
      extra: '<script>',
    });
    expect(visual).toEqual({
      type: 'chart',
      title: 'Рост выручки',
      kind: 'bar',
      unit: 'млн ₽',
      data: [
        { label: '2022', value: 12 },
        { label: '2023', value: 15.5 },
      ],
    });
  });

  it('rejects bad charts', () => {
    const base = { type: 'chart', title: 'График', kind: 'line' };
    expect(sanitizeVisual({ ...base, data: [{ label: 'a', value: 1 }, { label: 'b', value: Number.NaN }] })).toBeNull();
    expect(sanitizeVisual({ ...base, data: [{ label: 'a', value: 1 }, { label: 'b', value: Infinity }] })).toBeNull();
    expect(sanitizeVisual({ ...base, data: [{ label: 'a', value: 1 }, { label: 'b', value: 'много' }] })).toBeNull();
    expect(sanitizeVisual({ ...base, data: [{ label: 'a', value: 1 }] })).toBeNull();
    expect(sanitizeVisual({ ...base, data: [{ value: 1 }, { label: 'b', value: 2 }] })).toBeNull();
    expect(sanitizeVisual({ ...base, data: [{ label: 'a', value: true }, { label: 'b', value: 2 }] })).toBeNull();
    expect(sanitizeVisual({ ...base, data: 'много' })).toBeNull();
  });

  it('normalises charts the same way as the server', () => {
    const nine = sanitizeVisual({
      type: 'Chart',
      title: 'Девять точек',
      kind: 'pie',
      data: Array.from({ length: 9 }, (_, index) => ({ label: `p${index}`, value: `${index}%` })),
    });
    expect(nine?.type === 'chart' && nine.kind).toBe('bar');
    expect(nine?.type === 'chart' && nine.data).toHaveLength(8);
    expect(nine?.type === 'chart' && nine.data[3]).toEqual({ label: 'p3', value: 3 });
  });

  it('rejects diagrams whose edges point to missing nodes and drops single bad edges', () => {
    const nodes = [
      { id: 'a', label: 'Свет' },
      { id: 'b', label: 'Хлорофилл' },
      { id: 'c', label: 'Глюкоза' },
    ];
    expect(
      sanitizeVisual({ type: 'diagram', title: 'Фотосинтез', nodes, edges: [{ from: 'a', to: 'zzz' }, { from: 'x', to: 'b' }] }),
    ).toBeNull();

    const visual = sanitizeVisual({
      type: 'diagram',
      title: 'Фотосинтез',
      nodes,
      edges: [
        { from: 'a', to: 'b', label: 'поглощается' },
        { from: 'b', to: 'missing' },
        { from: 'c', to: 'c' },
        { from: 'b', to: 'c' },
        { from: 'b', to: 'c' },
      ],
    });
    expect(visual).toEqual({
      type: 'diagram',
      title: 'Фотосинтез',
      nodes,
      edges: [
        { from: 'a', to: 'b', label: 'поглощается' },
        { from: 'b', to: 'c' },
      ],
    });

    const tooMany = Array.from({ length: 8 }, (_, index) => ({ id: `n${index}`, label: `Узел ${index}` }));
    const trimmed = sanitizeVisual({
      type: 'diagram',
      title: 'Много',
      nodes: tooMany,
      edges: [{ from: 'n0', to: 'n1' }, { from: 'n6', to: 'n7' }],
    });
    expect(trimmed?.type === 'diagram' && trimmed.nodes).toHaveLength(7);
    expect(trimmed?.type === 'diagram' && trimmed.edges).toEqual([{ from: 'n0', to: 'n1' }]);
  });

  it('rejects scenes with an unknown icon', () => {
    expect(sanitizeVisual({ type: 'scene', title: 'Клетка', icon: 'rocket', caption: 'Подпись' })).toBeNull();
    expect(sanitizeVisual({ type: 'scene', title: 'Клетка', icon: 'dna', caption: 'Подпись' })).toEqual({
      type: 'scene',
      title: 'Клетка',
      icon: 'dna',
      caption: 'Подпись',
    });
  });

  it('applies length limits and list bounds', () => {
    const longTitle = 'Очень длинный заголовок '.repeat(10);
    const steps = sanitizeVisual({
      type: 'steps',
      title: longTitle,
      items: ['1', '2', '3', '4', '5', '6', '7', '8', 'x'.repeat(300)],
    });
    expect(steps?.type).toBe('steps');
    if (steps?.type !== 'steps') throw new Error('expected steps');
    expect(steps.title.length).toBeLessThanOrEqual(VISUAL_LIMITS.title);
    expect(steps.title.endsWith('…')).toBe(true);
    expect(steps.items).toHaveLength(6);

    expect(sanitizeVisual({ type: 'steps', title: 'Шаги', items: ['Только один'] })).toBeNull();
    expect(sanitizeVisual({ type: 'formula', title: 'Формула', latex: 'x'.repeat(201) })).toBeNull();
    expect(sanitizeVisual({ type: 'formula', title: 'Ом', latex: '$$ I =   U / R $$' })).toEqual({
      type: 'formula',
      title: 'Ом',
      latex: 'I = U / R',
    });
    expect(sanitizeVisual({ type: 'formula', title: 'Закон Ома', latex: 'I = \\frac{U}{R}', legend: 'bad' })).toEqual({
      type: 'formula',
      title: 'Закон Ома',
      latex: 'I = \\frac{U}{R}',
    });
    expect(sanitizeVisual({ type: 'compare', title: 'Сравнение', left: { label: 'A', points: [] }, right: { label: 'B', points: ['b'] } })).toBeNull();
    expect(sanitizeVisual({ type: 'timeline', title: 'История', events: [{ date: '1905', label: 'СТО' }] })).toBeNull();
    expect(sanitizeVisual({ type: 'video', title: 'Нет такого' })).toBeNull();
    expect(sanitizeVisual(null)).toBeNull();
    expect(sanitizeVisual('term')).toBeNull();
  });
});

describe('buildConversation', () => {
  const terms = [
    { term: 'Энтропия', definition: 'Мера беспорядка системы.' },
    { term: 'Граф', definition: 'Набор вершин и рёбер.' },
    { term: 'Ёмкость', definition: 'Способность накапливать заряд.' },
  ];
  const flashcards = [{ question: 'Почему молекулы двигаются быстрее при нагревании?', answer: 'Растёт их энергия.' }];
  const sources = [{ id: 'S03', text: '   Вода кипит при 100 °C на уровне моря.   ' }];

  it('maps legacy lines with the a–e rules in order', () => {
    const lines = [
      { speaker: 'Макс', text: 'Привет! Сегодня говорим о тепле.' },
      { speaker: 'Софья', text: 'Начнём с того, что такое энтропия в физике.' },
      { speaker: 'Макс', text: 'И как это связано с тем, что все молекулы при нагревании двигаются?' },
      { speaker: 'Софья', text: 'Есть хороший пример.', source_ids: ['S03'] },
      { speaker: 'Макс', text: 'Понятно, спасибо.' },
      { speaker: 'Софья', text: 'А ещё конденсатор: его емкость важна.' },
    ];
    const result = buildConversation(lines, { title: 'Термодинамика', terms, flashcards, sources });

    expect(result.map(line => line.visual.type)).toEqual(['scene', 'term', 'question', 'fact', 'fact', 'term']);
    // Заставку никто не подбирал: у неё своё происхождение и нет выдуманной подписи.
    expect(result.map(line => line.origin)).toEqual(['cover', 'auto', 'auto', 'auto', 'auto', 'auto']);

    expect(result[0].visual).toEqual({ type: 'scene', title: 'Термодинамика', icon: 'book', caption: '' });
    expect(result[0].visualSourceIds).toEqual([]);
    expect(result[1].visual).toEqual({ type: 'term', term: 'Энтропия', definition: 'Мера беспорядка системы.' });
    expect(result[2].visual).toEqual({
      type: 'question',
      question: 'Почему молекулы двигаются быстрее при нагревании?',
      answer: 'Растёт их энергия.',
    });
    expect(result[3].visual).toEqual({ type: 'fact', title: 'Из источника S03', text: 'Вода кипит при 100 °C на уровне моря.' });
    expect(result[3].sourceIds).toEqual(['S03']);
    expect(result[3].visualSourceIds).toEqual(['S03']);

    // d: реплика без совпадений продолжает показывать изображение предыдущей
    // вместе с его источником, а не со своими source_ids.
    expect(result[4].carried).toBe(true);
    expect(result[4].visual).toBe(result[3].visual);
    expect(result[4].visualFrom).toBe(3);
    expect(result[4].visualSourceIds).toEqual(['S03']);

    // ё/е и регистр не важны.
    expect(result[5].visual).toEqual({ type: 'term', term: 'Ёмкость', definition: 'Способность накапливать заряд.' });
  });

  it('matches terms only from the start of a word', () => {
    const [line] = buildConversation([{ speaker: 'Софья', text: 'Это фотография лаборатории.' }], { title: 'Т', terms });
    expect(line.visual.type).toBe('scene');

    const [match] = buildConversation([{ speaker: 'Софья', text: 'Каждый граф состоит из вершин.' }], { terms });
    expect(match.visual).toEqual({ type: 'term', term: 'Граф', definition: 'Набор вершин и рёбер.' });
  });

  it('matches inflected short words of a term', () => {
    const [line] = buildConversation([{ speaker: 'Софья', text: 'В световой фазе образуется кислород.' }], {
      terms: [{ term: 'Световая фаза', definition: 'Этап фотосинтеза на свету.' }],
    });
    expect(line.visual.type === 'term' && line.visual.term).toBe('Световая фаза');
  });

  it('cites only the fragment a quote was taken from', () => {
    const result = buildConversation(
      [{ speaker: 'Софья', text: 'Есть пример.', source_ids: ['S09', 'S03', 'S05'] }],
      { sources },
    );
    expect(result[0].visual.type).toBe('fact');
    expect(result[0].visualSourceIds).toEqual(['S03']);
  });

  it('prefers the term that appears first in the line', () => {
    const [line] = buildConversation([{ speaker: 'Макс', text: 'Граф и энтропия — разные вещи.' }], { terms });
    expect(line.visual.type === 'term' && line.visual.term).toBe('Граф');
  });

  it('uses valid model visuals and falls back when a model visual is invalid', () => {
    const lines = [
      { speaker: 'Макс', text: 'Смотрим на рост.', visual: { type: 'chart', title: 'Рост', kind: 'bar', data: [{ label: 'A', value: 1 }, { label: 'B', value: 2 }] } },
      { speaker: 'Софья', text: 'А энтропия?', visual: { type: 'chart', title: 'Плохой', kind: 'bar', data: [{ label: 'A', value: Number.NaN }] } },
      { speaker: 'Макс', text: 'Продолжаем.' },
    ];
    const result = buildConversation(lines, { terms });
    expect(result[0].origin).toBe('model');
    expect(result[0].visual.type).toBe('chart');
    expect(result[1].origin).toBe('auto');
    expect(result[1].visual.type).toBe('term');
    expect(result[2].carried).toBe(true);
    expect(result[2].origin).toBe('auto');
  });

  it('keeps carried model visuals marked as model', () => {
    const result = buildConversation([
      { speaker: 'Макс', text: 'Шаги.', visual: { type: 'steps', title: 'План', items: ['Один', 'Два'] } },
      { speaker: 'Софья', text: 'Дальше.' },
    ]);
    expect(result[1]).toMatchObject({ origin: 'model', carried: true, visualFrom: 0 });
  });

  it('is deterministic and keeps original indices for legacy data', () => {
    const lines = [
      null,
      { speaker: 'Макс', text: '   ' },
      { speaker: 'Макс', text: 'Энтропия растёт.' },
      { text: 'Без имени.' },
      { speaker: 'Софья', text: 'Ответ.', source_ids: ['S03', 7] },
    ];
    const first = buildConversation(lines, { terms, sources });
    const second = buildConversation(lines, { terms, sources });
    expect(first).toEqual(second);
    expect(first.map(line => line.index)).toEqual([2, 3, 4]);
    expect(first[1].speaker).toBe('');
    expect(first[2].sourceIds).toEqual(['S03']);
    expect(buildConversation(undefined)).toEqual([]);
    expect(buildConversation('oops')).toEqual([]);
  });
});

describe('helpers', () => {
  it('reads numbers the way the server does', () => {
    expect(toFiniteNumber('12,5')).toBe(12.5);
    expect(toFiniteNumber('12,500')).toBe(12500);
    expect(toFiniteNumber('1,234,567')).toBe(1234567);
    expect(toFiniteNumber('12 500')).toBe(12500);
    expect(toFiniteNumber('40%')).toBe(40);
    expect(toFiniteNumber('1,2,3')).toBeNull();
  });

  it('escapes percent signs in formulas so KaTeX does not cut them', () => {
    expect(sanitizeVisual({ type: 'formula', title: 'КПД', latex: '\\eta = \\frac{A_p}{A_z} \\cdot 100%' })).toEqual({
      type: 'formula',
      title: 'КПД',
      latex: '\\eta = \\frac{A_p}{A_z} \\cdot 100\\%',
    });
    expect(sanitizeVisual({ type: 'formula', title: 'Доля', latex: 'w = 40\\% \\cdot m' })).toMatchObject({ latex: 'w = 40\\% \\cdot m' });
  });

  it('pluralizes line counts', () => {
    expect(pluralLines(1)).toBe('1 реплика');
    expect(pluralLines(3)).toBe('3 реплики');
    expect(pluralLines(10)).toBe('10 реплик');
    expect(pluralLines(12)).toBe('12 реплик');
    expect(pluralLines(21)).toBe('21 реплика');
  });

  it('notes when a line chart axis is not to scale', () => {
    expect(axisNotToScale(['20 мин', '1 час', '9 часов', '1 день'])).toBe(true);
    expect(axisNotToScale(['2020', '2021', '2022'])).toBe(false);
    expect(axisNotToScale(['2019', '2021', '2022'])).toBe(true);
    expect(axisNotToScale(['Январь', 'Февраль', 'Март'])).toBe(false);
    expect(axisNotToScale(['1 этап', '2 этап', '3 этап'])).toBe(false);
  });

  it('normalizes text for matching', () => {
    expect(normalizeForMatch('Ёлка, ЁЖ!')).toBe('елка еж');
  });

  it('detects model visuals', () => {
    expect(hasModelVisuals([{ speaker: 'Макс', text: 'Привет' }])).toBe(false);
    expect(hasModelVisuals([{ speaker: 'Макс', text: 'Привет', visual: { type: 'term', term: 'Атом', definition: 'Частица.' } }])).toBe(true);
    expect(hasModelVisuals([{ speaker: 'Макс', text: 'Привет', visual: { type: 'term' } }])).toBe(false);
  });

  it('merges returned visuals by index without touching the lines', () => {
    const lines = [
      { speaker: 'Макс', text: 'Первая' },
      { speaker: 'Софья', text: 'Вторая', source_ids: ['S01'] },
      { speaker: 'Макс', text: 'Третья' },
    ];
    const positional = mergeVisualsByIndex(lines, {
      visuals: [null, { type: 'term', term: 'Атом', definition: 'Частица.' }, { type: 'scene', title: 'X', icon: 'nope' }],
    });
    expect(positional.added).toBe(1);
    expect(positional.lines).toEqual([
      lines[0],
      { speaker: 'Софья', text: 'Вторая', source_ids: ['S01'], visual: { type: 'term', term: 'Атом', definition: 'Частица.' } },
      lines[2],
    ]);

    const indexed = mergeVisualsByIndex(lines, {
      visuals: [{ index: 2, visual: { type: 'question', question: 'Что?', answer: 'Это.' } }],
    });
    expect(indexed.added).toBe(1);
    expect((indexed.lines[2] as { visual?: unknown }).visual).toEqual({ type: 'question', question: 'Что?', answer: 'Это.' });

    const asLines = mergeVisualsByIndex(lines, {
      podcast: [{ speaker: 'Макс', text: 'Первая', visual: { type: 'fact', title: 'Факт', text: 'Текст' } }],
    });
    expect(asLines.added).toBe(1);
    expect(lines[0]).toEqual({ speaker: 'Макс', text: 'Первая' });
  });

  it('parses generated lines and drops invalid visuals', () => {
    expect(
      parseGeneratedLines({
        podcast: [
          { speaker: 'Макс', text: 'Привет', visual: { type: 'scene', title: 'Тема', icon: 'atom', caption: '' } },
          { speaker: 'Софья', text: 'Здравствуй', visual: { type: 'chart' }, source_ids: ['S01'] },
          { speaker: 'Софья' },
        ],
      }),
    ).toEqual([
      { speaker: 'Макс', text: 'Привет', visual: { type: 'scene', title: 'Тема', icon: 'atom', caption: '' } },
      { speaker: 'Софья', text: 'Здравствуй', source_ids: ['S01'] },
    ]);
    expect(parseGeneratedLines({ error: 'nope' })).toEqual([]);
  });

  it('estimates duration at about 150 words per minute', () => {
    const words = Array.from({ length: 300 }, () => 'слово').join(' ');
    expect(estimateMinutes([{ text: words }])).toBe(2);
    expect(estimateMinutes([{ text: 'коротко' }])).toBe(1);
    expect(estimateMinutes([])).toBe(0);
  });
});
