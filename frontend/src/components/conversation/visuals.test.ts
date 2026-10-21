import { describe, expect, it } from 'vitest';
import {
  assignVoices,
  buildConversation,
  cleanSourceIds,
  conversationOutline,
  estimateSeconds,
  conversationMeta,
  fragmentWords,
  lengthPhrase,
  sourceNote,
  visualCaption,
  hasModelVisuals,
  mergeVisualsByIndex,
  normalizeForMatch,
  normalizeLines,
  normalizeSpeaker,
  outlineTitle,
  OUTLINE_LIMIT,
  OUTLINE_TITLE_MAX,
  parseGeneratedLines,
  pluralLines,
  provenanceLead,
  quoteSourceIds,
  sanitizeVisual,
  toFiniteNumber,
  topicKey,
  visualLabel,
  voiceForSpeaker,
  VISUAL_LIMITS,
} from './visuals';
import { axisNotToScale, chartScale } from './ChartView';
import { splitStep } from './ConversationVisual';

describe('sanitizeVisual', () => {
  it('drops the fragment marks the model copied into the words on the sheet (QA 2026-10-11)', () => {
    expect(sanitizeVisual({ type: 'term', term: 'Клетка [S01]', definition: 'Наименьшая единица живого [S01, S02].' })).toEqual({
      type: 'term',
      term: 'Клетка',
      definition: 'Наименьшая единица живого.',
    });
    expect(sanitizeVisual({ type: 'steps', title: 'Путь белка', items: ['Рибосома [S02]', 'ЭПС [S03], [S04]'] })).toMatchObject({
      items: ['Рибосома', 'ЭПС'],
    });
    // A glossary term picked for a line of an older podcast says its definition without them too.
    const [line] = buildConversation([{ speaker: 'Софья', text: 'Начнём с того, что такое клетка.' }], {
      terms: [{ term: 'Клетка', definition: 'Наименьшая единица живого, способная к существованию [S01].' }],
    });
    expect(line.visual).toEqual({ type: 'term', term: 'Клетка', definition: 'Наименьшая единица живого, способная к существованию.' });
  });

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
    // Время суток через полночь — ровный шаг, а не «скачок назад».
    expect(axisNotToScale(['6:00', '9:00', '12:00', '15:00', '18:00', '21:00', '0:00'])).toBe(false);
    expect(axisNotToScale(['22:00', '23:00', '0:00', '1:00'])).toBe(false);
    expect(axisNotToScale(['6:00', '9:00', '18:00'])).toBe(true);
  });

  it('starts a line chart at zero unless the values sit in a narrow band or go below zero', () => {
    // Кривая забывания: 21% не должен выглядеть как «почти ничего».
    expect(chartScale('line', [58, 44, 36, 33, 25, 21])).toMatchObject({ min: 0, fromZero: true, grid: [] });
    const narrow = chartScale('line', [91, 93, 95]);
    expect(narrow.fromZero).toBe(false);
    expect(narrow.min).toBeGreaterThan(80);
    expect(narrow.grid).toHaveLength(2);
    narrow.grid.forEach(value => {
      expect(value).toBeGreaterThan(narrow.min);
      expect(value).toBeLessThan(narrow.max);
    });
    const negative = chartScale('line', [-2.7, 1.5, -1.2, 3]);
    expect(negative.min).toBeLessThan(-2.7);
    expect(negative.fromZero).toBe(false);
    expect(chartScale('bar', [12, 30])).toMatchObject({ min: 0, max: 30, fromZero: true });
    expect(chartScale('bar', [-5, 30])).toMatchObject({ min: -5, max: 30 });
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

  it('estimates how long the hosts speak, at the 140 words a minute their voices were measured at', () => {
    const words = (count: number) => Array.from({ length: count }, () => 'слово').join(' ');
    expect(estimateSeconds([{ text: words(280) }])).toBe(120);
    // The podcast of the live QA (2026-10-11): 208 words in 14 lines, about 85 s of speech.
    expect(estimateSeconds([{ text: words(100) }, { text: words(108) }])).toBe(89);
    expect(estimateSeconds([{ text: 'коротко' }])).toBe(0);
    expect(estimateSeconds([])).toBe(0);
  });
});

describe('line contract on stored conversations', () => {
  it('maps host names to the two voices whatever the spelling', () => {
    expect(['Max', 'макс', 'MAX', 'Maks', ' Макс: '].map(normalizeSpeaker)).toEqual(['Макс', 'Макс', 'Макс', 'Макс', 'Макс']);
    expect(['Sofia', 'софия', 'Sophia:'].map(normalizeSpeaker)).toEqual(['Софья', 'Софья', 'Софья']);
    expect(normalizeSpeaker('Гость')).toBe('Гость');
    expect(['Max', 'MAX', 'Sofia'].map(voiceForSpeaker)).toEqual(['male', 'male', 'female']);
    const lines = buildConversation([{ speaker: 'Max', text: 'Hi' }, { speaker: 'Sofia', text: 'Hello' }]);
    expect(lines.map(line => line.speaker)).toEqual(['Макс', 'Софья']);
  });

  it('gives two unknown hosts different voices', () => {
    expect(Object.fromEntries(assignVoices(['Ведущий', 'Эксперт']))).toEqual({ 'Ведущий': 'male', 'Эксперт': 'female' });
    expect(Object.fromEntries(assignVoices(['Макс', 'Гость']))).toEqual({ 'Макс': 'male', 'Гость': 'female' });
    expect(Object.fromEntries(assignVoices(['Софья', 'Гость']))).toEqual({ 'Софья': 'female', 'Гость': 'male' });
  });

  it('caps the number and length of lines and keeps only real fragment ids', () => {
    const many = Array.from({ length: 4000 }, (_, index) => ({ speaker: 'Макс', text: `Реплика ${index}` }));
    expect(normalizeLines(many)).toHaveLength(40);
    const [long] = normalizeLines([{ speaker: 'Софья', text: 'а'.repeat(5000) }]);
    expect(long.text.length).toBeLessThanOrEqual(2000);
    expect(long.text.endsWith('…')).toBe(true);
    expect(cleanSourceIds(['[s03]', 'S03', 'S1234', 'javascript:x', 7, 's7', 'S01', 'S02', 'S04', 'S05'])).toEqual(['S03', 'S7', 'S01', 'S02', 'S04']);
  });
});

describe('provenance of pictures', () => {
  const sources = [
    { id: 'S01', text: 'Герман Эббингауз в 1885 году описал кривую забывания.' },
    { id: 'S02', text: 'Каждое повторение делает след памяти прочнее,' },
    { id: 'S03', text: 'поэтому после повторения кривая забывания становится более пологой.' },
  ];

  it('finds word-for-word quotes, across fragments and with an ellipsis', () => {
    expect(quoteSourceIds('Каждое повторение делает след памяти прочнее…', sources)).toEqual(['S02']);
    expect(quoteSourceIds('след памяти прочнее, поэтому после повторения кривая', sources)).toEqual(['S02', 'S03']);
    expect(quoteSourceIds('Эббингауз… описал кривую забывания', sources)).toEqual(['S01']);
    expect(quoteSourceIds('Эббингауз лично доказал, что сон удваивает память.', sources)).toEqual([]);
    expect(quoteSourceIds('кривую', sources)).toEqual([]);
    expect(quoteSourceIds('Каждое повторение делает след памяти прочнее', [])).toEqual([]);
  });

  it('claims a source only for what was checked', () => {
    const lines = [
      { speaker: 'Макс', text: 'Цитата.', source_ids: ['S09'], visual: { type: 'fact', title: 'Цитата', text: 'Каждое повторение делает след памяти прочнее…' } },
      { speaker: 'Софья', text: 'Пересказ.', source_ids: ['S01'], visual: { type: 'fact', title: 'Сон', text: 'Эббингауз лично доказал, что сон удваивает память.' } },
      { speaker: 'Макс', text: 'Формула.', source_ids: ['S01'], visual: { type: 'formula', title: 'Кривая', latex: 'R = e^{-t/S}' } },
      { speaker: 'Софья', text: 'Числа.', source_ids: ['S03'], visual: { type: 'chart', title: 'Кривая', kind: 'line', data: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] } },
      { speaker: 'Макс', text: 'Даты.', visual: { type: 'timeline', title: 'История', events: [{ date: '1885', label: 'Опыт' }, { date: '1968', label: 'Модель' }] } },
      { speaker: 'Софья', text: 'Термин.', source_ids: ['S01'], visual: { type: 'term', term: 'Память', definition: 'Способность помнить.' } },
      { speaker: 'Макс', text: 'Дальше.' },
    ];
    const result = buildConversation(lines, { sources });
    expect(result.map(line => line.provenance)).toEqual([
      { kind: 'quote', ids: ['S02'] },
      { kind: 'none' },
      { kind: 'none' },
      // В S03 нет чисел 1 и 2: номер фрагмента не показываем, хотя реплика на него ссылается.
      { kind: 'numbers', ids: [] },
      { kind: 'dates', ids: [] },
      { kind: 'none' },
      { kind: 'none' },
    ]);
    expect(visualLabel(result[0].visual, result[0].provenance)).toBe('Цитата');
    expect(visualLabel(result[1].visual, result[1].provenance)).toBe('Пересказ');
    expect(result.map(line => provenanceLead(line.provenance))).toEqual([
      'Из материала',
      null,
      null,
      'Числа — из материала',
      'Даты — из материала',
      null,
      null,
    ]);
  });

  it('names where automatically picked pictures come from', () => {
    const result = buildConversation(
      [
        { speaker: 'Макс', text: 'Что такое энтропия?' },
        { speaker: 'Софья', text: 'Почему молекулы двигаются быстрее при нагревании?' },
        { speaker: 'Макс', text: 'Пример.', source_ids: ['S01'] },
      ],
      {
        terms: [{ term: 'Энтропия', definition: 'Мера беспорядка.' }],
        flashcards: [{ question: 'Почему молекулы двигаются быстрее при нагревании?', answer: 'Растёт энергия.' }],
        sources,
      },
    );
    expect(result.map(line => provenanceLead(line.provenance))).toEqual(['Из конспекта', 'Из карточек', 'Из материала']);
    expect(result[2].provenance).toEqual({ kind: 'quote', ids: ['S01'] });
  });

  it('words fragment numbers like a reader would', () => {
    expect(fragmentWords(['S03'])).toBe('фрагмент 3');
    expect(fragmentWords(['S03', 'S04'])).toBe('фрагменты 3 и 4');
    expect(fragmentWords(['S02', 'S03', 'S10'])).toBe('фрагменты 2, 3 и 10');
  });

  it('replaces word-matched fragment ids of a line when the server sends checked ones', () => {
    const lines = [
      { speaker: 'Макс', text: 'Первая', source_ids: ['S01'] },
      { speaker: 'Софья', text: 'Вторая', source_ids: ['S01'] },
      { speaker: 'Макс', text: 'Третья', source_ids: ['S01'] },
    ];
    const chart = { type: 'chart', title: 'Числа', kind: 'bar', data: [{ label: 'a', value: 1 }, { label: 'b', value: 2 }] };
    const { lines: merged } = mergeVisualsByIndex(lines, {
      visuals: [
        { index: 0, visual: chart, source_ids: ['s04'] },
        { index: 1, visual: chart },
        { index: 2, visual: { type: 'term', term: 'Атом', definition: 'Частица.' } },
      ],
    });
    expect(merged[0]).toMatchObject({ source_ids: ['S04'] });
    expect(merged[1]).not.toHaveProperty('source_ids');
    expect(merged[2]).toMatchObject({ source_ids: ['S01'] });
  });
});

describe('steps', () => {
  it('splits a step into its name and explanation', () => {
    expect(splitStep('Кодирование: превращаем впечатление в след')).toEqual({ head: 'Кодирование', tail: 'превращаем впечатление в след' });
    expect(splitStep('Хранение — удерживаем след')).toEqual({ head: 'Хранение', tail: 'удерживаем след' });
    expect(splitStep('Свет поглощается хлорофиллом')).toBeNull();
    expect(splitStep('Очень длинное начало шага без двоеточия долго тянется: и только потом пояснение')).toBeNull();
  });
});

describe('words on the paper sheet (spec 5.7)', () => {
  it('writes the source note of the corner only for what was checked', () => {
    expect(sourceNote({ kind: 'numbers', ids: ['S04'] })).toBe('Числа взяты из лекции, фрагмент 4');
    expect(sourceNote({ kind: 'numbers', ids: [] })).toBe('Числа взяты из лекции');
    expect(sourceNote({ kind: 'dates', ids: ['S02', 'S05'] })).toBe('Даты взяты из лекции, фрагменты 2 и 5');
    expect(sourceNote({ kind: 'quote', ids: ['S01'] })).toBe('Из лекции, фрагмент 1');
    expect(sourceNote({ kind: 'summary' })).toBe('Из конспекта');
    expect(sourceNote({ kind: 'cards' })).toBe('Из карточек');
    // A paraphrase, a diagram or a formula of the model says nothing about the lecture.
    expect(sourceNote({ kind: 'none' })).toBeNull();
  });

  it('says who talks, how many lines and how long, in one line above the sheet', () => {
    // ~85 s was «около минуты» while the length was whole minutes (live QA 2026-10-11).
    expect(conversationMeta(['Макс', 'Софья'], 14, 89)).toBe('Макс и Софья обсуждают лекцию · 14 реплик, около полутора минут');
    expect(conversationMeta(['Макс', 'Софья', 'Анна', 'Борис'], 3, 120)).toBe('Макс, Софья и Анна обсуждают лекцию · 3 реплики, около 2 минут');
    expect(conversationMeta(['Софья'], 1, 0)).toBe('Софья рассказывает о лекции · 1 реплика');
    expect(conversationMeta([], 21, 21 * 60)).toBe('Подкаст по лекции · 21 реплика, около 21 минуты');
  });

  it('names the length to the half minute while it is short', () => {
    expect(lengthPhrase(8)).toBe('меньше минуты');
    expect(lengthPhrase(44)).toBe('меньше минуты');
    expect(lengthPhrase(45)).toBe('около минуты');
    expect(lengthPhrase(74)).toBe('около минуты');
    expect(lengthPhrase(85)).toBe('около полутора минут');
    expect(lengthPhrase(104)).toBe('около полутора минут');
    expect(lengthPhrase(105)).toBe('около 2 минут');
    expect(lengthPhrase(150)).toBe('около 3 минут');
    expect(lengthPhrase(300)).toBe('около 5 минут');
  });

  it('never shows the internal «Из источника S03» title of a found quote', () => {
    const quote = { type: 'fact' as const, title: 'Из источника S03', text: 'Эластичность показывает, на сколько процентов изменится величина спроса при изменении цены на один процент.' };
    expect(visualCaption(quote)).not.toMatch(/S03|Из источника/);
    expect(visualCaption(quote)).toMatch(/^Эластичность показывает/);
    expect(visualCaption(quote).length).toBeLessThanOrEqual(60);
    expect(visualCaption({ type: 'fact', title: 'Определение', text: 'Текст.' })).toBe('Определение');
  });
});

describe('the plan on the first line', () => {
  const scene = { type: 'scene', title: 'Эластичность спроса', icon: 'scale', caption: 'Почему цена меняет выручку' };
  const term = (word: string) => ({ type: 'term', term: word, definition: 'Определение.' });
  const steps = (title: string) => ({ type: 'steps', title, items: ['Один', 'Два'] });
  const plan = (visuals: unknown[]) => {
    const lines = buildConversation(
      visuals.map((visual, index) => ({ speaker: index % 2 ? 'Софья' : 'Макс', text: `Реплика ${index + 1}.`, visual })),
    );
    const opening = lines[0]?.visual;
    return conversationOutline(lines, opening?.type === 'scene' ? opening.title : '');
  };

  it('names topics, not self-check questions or quotes, each once and at most four', () => {
    const items = plan([
      scene,
      term('Эластичный спрос'),
      term('ЭЛАСТИЧНЫЙ спрос.'),
      { type: 'question', question: 'Почему пекарня заработает больше, подняв цену на хлеб?', answer: 'Спрос на хлеб неэластичен.' },
      { type: 'fact', title: 'Определение', text: 'Эластичность показывает, насколько меняется спрос.' },
      steps('Эластичного спроса'),
      steps('Эластичность спроса'),
      { type: 'compare', title: 'Кофе и хлеб', left: { label: 'Кофе', points: ['Легко заменить'] }, right: { label: 'Хлеб', points: ['Нужен всегда'] } },
      term('Выручка'),
      term('Неэластичный спрос'),
      term('Ценовая дискриминация'),
    ]);
    // «Эластичного спроса» is the same topic as «Эластичный спрос»; «Эластичность спроса» is the plan's own title.
    expect(items).toEqual([
      { position: 1, caption: 'Эластичный спрос' },
      { position: 7, caption: 'Кофе и хлеб' },
      { position: 8, caption: 'Выручка' },
      { position: 9, caption: 'Неэластичный спрос' },
    ]);
    expect(items).toHaveLength(OUTLINE_LIMIT);
  });

  it('skips the pictures carried over from the opening and shows no plan for fewer than two topics', () => {
    expect(plan([scene, null, term('Выручка'), term('выручка')])).toEqual([]);
    expect(plan([scene, null, term('Выручка'), steps('Как считать выручку')])).toEqual([
      { position: 2, caption: 'Выручка' },
      { position: 3, caption: 'Как считать выручку' },
    ]);
    expect(conversationOutline([])).toEqual([]);
  });

  it('keeps topic names short: the part before a colon or a dash, or a cut on a word', () => {
    expect(outlineTitle('Эластичность спроса: как цена меняет выручку у пекарни и у кофейни в центре города')).toBe('Эластичность спроса');
    const long = 'Почему пекарня и кофейня по-разному реагируют на повышение цен для своих покупателей';
    expect(outlineTitle(long)).toMatch(/…$/);
    expect(outlineTitle(long).length).toBeLessThanOrEqual(OUTLINE_TITLE_MAX);
    expect(outlineTitle('  Короткая   тема ')).toBe('Короткая тема');
    expect(topicKey('Эластичный спрос!')).toBe(topicKey('эластичного  СПРОСА'));
    expect(topicKey('Ёмкость рынка')).toBe(topicKey('емкость рынка'));
    expect(topicKey('Эластичный спрос')).not.toBe(topicKey('Эластичность спроса'));
  });
});
