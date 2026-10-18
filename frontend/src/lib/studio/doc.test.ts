import { describe, expect, it } from 'vitest';
import casesJson from '../../../../contracts/studio/test_doc_cases.json';
import { BLOCK_ID_RE, DOC_BLOCK_TYPES, DOC_MAX_BLOCKS, type DocBlock, type TestDoc } from '../../types/testDoc';
import {
  BLOCK_WORDS,
  bindRefs,
  chars,
  cut,
  danglingBlocks,
  DEFAULT_TITLE,
  docProblems,
  duplicateBlock,
  emptyDoc,
  findBlock,
  freshId,
  hasWords,
  imageOk,
  insertBlock,
  jsonbTextBytes,
  moveBlock,
  newBlock,
  newId,
  normalizeDoc,
  normalizeTheme,
  oneLine,
  questionIds,
  type RandomFill,
  removeBlock,
  replaceBlock,
  ruleMessage,
  sameValue,
  syncQuestions,
  urlOk,
  withoutDangling,
} from './doc';

/** A fixed source of random bytes (a small LCG): the same ids on every run. */
function seeded(seed = 7): RandomFill {
  let state = seed;
  return (bytes) => {
    for (let at = 0; at < bytes.length; at += 1) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      bytes[at] = (state >> 16) & 0xff;
    }
    return bytes;
  };
}

const EXAM = '11111111-2222-3333-4444-555555555555';
const OTHER = '99999999-2222-3333-4444-555555555555';
const PIC = `${EXAM}/${'a'.repeat(64)}.png`;
const PIC2 = `${EXAM}/${'b'.repeat(64)}.webp`;
const ITEM_A = 'aaaaaaaa-0000-0000-0000-000000000001';
const ITEM_B = 'aaaaaaaa-0000-0000-0000-000000000002';
const GONE = 'aaaaaaaa-0000-0000-0000-00000000dead';

function fullDoc(): TestDoc {
  return {
    v: 1,
    title: 'Контрольная',
    theme: { accent: 'green', background: { kind: 'image', path: PIC, dim: 40 }, font: 'serif', radius: 'round', density: 'compact', answers: 'grid', buttons: 'square' },
    layout: 'pages',
    blocks: [
      { type: 'cover', id: 'cover0000001', title: 'Контрольная', subtitle: 'Тема 1', image: PIC, align: 'left' },
      { type: 'heading', id: 'heading00001', text: 'Часть 1', size: 'm' },
      { type: 'text', id: 'text00000001', text: 'Прочитайте **внимательно**.\nВторая строка', align: 'center' },
      { type: 'image', id: 'image0000001', path: PIC2, caption: 'Схема', width: 'full' },
      { type: 'note', id: 'note00000001', tone: 'warn', text: 'Время — 20 минут' },
      { type: 'divider', id: 'divider00001' },
      { type: 'page', id: 'page00000001', title: 'Вопросы' },
      { type: 'question', id: 'question0001', item_id: ITEM_A, points: 2, required: true },
      { type: 'question', id: 'question0002', item_id: ITEM_B, points: 1, required: false },
    ],
    results: {
      bands: [
        { from: 0, to: 49, title: 'Повторите', text: '', image: null },
        { from: 50, to: 100, title: 'Хорошо', text: 'Молодец', image: PIC },
      ],
      cta: { label: 'Дальше', url: 'https://example.com/next' },
    },
  };
}

/** The document with one field set (by a path of keys) — for the rule tests. */
function withField(path: Array<string | number>, value: unknown): Record<string, unknown> {
  const doc = JSON.parse(JSON.stringify(fullDoc())) as Record<string, unknown>;
  let node: Record<string | number, unknown> = doc;
  for (const key of path.slice(0, -1)) node = node[key] as Record<string | number, unknown>;
  node[path[path.length - 1]] = value;
  return doc;
}

const ITEMS = [ITEM_A, ITEM_B];

describe('ids', () => {
  it('makes 12 characters of [a-z0-9], the same from the same source', () => {
    const id = newId(seeded(1));
    expect(id).toMatch(/^[a-z0-9]{12}$/);
    expect(BLOCK_ID_RE.test(id)).toBe(true);
    expect(newId(seeded(1))).toBe(id);
    expect(newId(seeded(2))).not.toBe(id);
  });

  it('uses crypto by default', () => {
    expect(newId()).toMatch(/^[a-z0-9]{12}$/);
  });

  it('skips the bytes that would bias the letters and gives up on a source with none usable', () => {
    let call = 0;
    const lumpy: RandomFill = (bytes) => {
      call += 1;
      bytes.fill(call === 1 ? 255 : 1);
      bytes[0] = 252;
      return bytes;
    };
    expect(newId(lumpy)).toBe('bbbbbbbbbbbb');
    expect(() => newId((bytes) => bytes.fill(255))).toThrow(/random/);
  });

  it('freshId avoids the ids taken and adds its own', () => {
    const taken = new Set([newId(seeded(3))]);
    const id = freshId(taken, seeded(3));
    expect(taken.has(id)).toBe(true);
    expect(taken.size).toBe(2);
    expect(freshId(new Set())).toMatch(/^[a-z0-9]{12}$/);
  });
});

describe('a new document and new blocks', () => {
  it('emptyDoc: a valid page with nothing on it', () => {
    const doc = emptyDoc('  История\nРоссии ');
    expect(doc).toEqual({
      v: 1,
      title: 'История России',
      theme: { accent: 'blue', background: { kind: 'plain' }, font: 'onest', radius: 'soft', density: 'airy', answers: 'list', buttons: 'pill' },
      layout: 'one_by_one',
      blocks: [],
      results: { bands: [], cta: null },
    });
    expect(docProblems(doc, [])).toEqual([]);
    expect(emptyDoc('   ').title).toBe(DEFAULT_TITLE);
    expect(chars(emptyDoc('я'.repeat(300)).title)).toBe(200);
  });

  it('newBlock: each type valid as it starts (a picture waits for its upload)', () => {
    const random = seeded(4);
    const blocks = DOC_BLOCK_TYPES.map((type) => newBlock(type, type === 'question' ? ITEM_A : undefined, random));
    expect(new Set(blocks.map((block) => block.id)).size).toBe(blocks.length);
    const doc: TestDoc = { ...emptyDoc('Т'), blocks };
    expect(docProblems(doc, [ITEM_A])).toEqual(['block:3:path']);
    expect(newBlock('heading', undefined, random)).toMatchObject({ type: 'heading', text: BLOCK_WORDS.heading, size: 'l' });
    expect(newBlock('question')).toMatchObject({ type: 'question', item_id: '', points: 1, required: false });
  });
});

describe('helpers', () => {
  it('counts characters as the database does and cuts by them', () => {
    expect(chars('😀😀')).toBe(2);
    expect(cut('😀😀😀', 2)).toBe('😀😀');
    expect(cut('abc', 5)).toBe('abc');
    expect(oneLine('a\n  b\r\nc \r d')).toBe('a b c d');
  });

  it('images live in the bucket and, when the exam is known, in its folder', () => {
    expect(imageOk(PIC)).toBe(true);
    expect(imageOk(PIC, EXAM)).toBe(true);
    expect(imageOk(PIC, EXAM.toUpperCase())).toBe(true);
    expect(imageOk(PIC, OTHER)).toBe(false);
    expect(imageOk('x.png')).toBe(false);
    expect(imageOk(5)).toBe(false);
  });

  it('the result screen link as the server takes it: https, up to 300 characters', () => {
    expect(urlOk('https://a.ru/x')).toBe(true);
    expect(urlOk('https://a.ru/x y')).toBe(true);
    expect(urlOk('http://a.ru')).toBe(false);
    expect(urlOk(`https://a.ru/${'x'.repeat(300)}`)).toBe(false);
    expect(urlOk(null)).toBe(false);
  });

  it('hasWords counts spaces as the server does', () => {
    expect(hasWords('a')).toBe(true);
    expect(hasWords(' \t\n\u2003\u3000\u2028')).toBe(false);
    expect(hasWords('\u00a0')).toBe(true);
    expect(hasWords('\ufeff')).toBe(true);
  });

  it('sameValue compares data in any key order', () => {
    expect(sameValue({ a: 1, b: [1, { c: 'x' }] }, { b: [1, { c: 'x' }], a: 1 })).toBe(true);
    expect(sameValue({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(sameValue({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameValue({ a: 1, b: 3 }, { a: 1, c: 3 })).toBe(false);
    expect(sameValue([1, 2], [1, 2, 3])).toBe(false);
    expect(sameValue([1], { 0: 1 })).toBe(false);
    expect(sameValue(null, {})).toBe(false);
    expect(sameValue('a', 'a')).toBe(true);
  });

  it('jsonbTextBytes measures jsonb::text (a space after «:» and «,»)', () => {
    expect(jsonbTextBytes({ a: 1, b: [1, 2] })).toBe('{"a": 1, "b": [1, 2]}'.length);
    expect(jsonbTextBytes({ a: { b: 'я' }, c: [], d: {} })).toBe(new TextEncoder().encode('{"a": {"b": "я"}, "c": [], "d": {}}').length);
    expect(jsonbTextBytes({ a: undefined, b: () => 1, c: null })).toBe('{"c": null}'.length);
    expect(jsonbTextBytes([])).toBe(2);
    expect(jsonbTextBytes(undefined)).toBe(0);
  });
});

interface Corpus {
  container_id: string;
  items: string[];
  cases: Array<{ name: string; expect: string | null; doc: unknown }>;
}
const corpus = casesJson as unknown as Corpus;
/** One name per rule kind: `block:<n>:text` → `block:text`. */
const kindOf = (rule: string | null) => (rule === null ? null : rule.replace(/^block:\d+:/, 'block:'));

describe('docProblems gives the first rule test_doc_ok gives (contracts/studio/test_doc_cases.json)', () => {
  it('the corpus: at least 60 documents, valid ones and every rule', () => {
    expect(corpus.cases.length).toBeGreaterThanOrEqual(60);
    const kinds = new Set(corpus.cases.map((entry) => kindOf(entry.expect)));
    const block = ['type', 'id', 'title', 'subtitle', 'image', 'align', 'text', 'size', 'path', 'caption', 'width', 'tone', 'item_id', 'points', 'required'];
    for (const kind of [null, 'version', 'title', 'theme', 'layout', 'blocks', 'results', ...block.map((rule) => `block:${rule}`)]) expect([kind, kinds.has(kind)]).toEqual([kind, true]);
  });

  // `size` is the client's own last name (test_doc_save checks it before test_doc_ok); no case is that big.
  it.each(corpus.cases.map((entry) => [entry.name, entry] as const))('%s', (_, entry) => {
    const problems = docProblems(entry.doc, corpus.items, corpus.container_id).filter((rule) => rule !== 'size');
    expect(problems[0] ?? null).toBe(entry.expect);
  });
});

describe('docProblems, beyond the first rule', () => {
  it('every broken block, one rule each, counted from 0, then the results', () => {
    const doc = withField(['blocks', 1, 'text'], '');
    (doc.blocks as Array<Record<string, unknown>>)[1].size = 'xl';
    (doc.blocks as Array<Record<string, unknown>>)[4].tone = 'x';
    (doc.results as Record<string, unknown>).cta = 'link';
    expect(docProblems(doc, ITEMS)).toEqual(['block:1:text', 'block:4:tone', 'results']);
    expect(docProblems({}, ITEMS)).toEqual(['version', 'title', 'theme', 'layout', 'blocks', 'results']);
  });

  it('without the exam, pictures are checked against the bucket pattern only', () => {
    const elsewhere = `${OTHER}/${'c'.repeat(64)}.jpg`;
    expect(docProblems(withField(['blocks', 3, 'path'], elsewhere), ITEMS)).toEqual([]);
    expect(docProblems(withField(['blocks', 3, 'path'], elsewhere), ITEMS, EXAM)).toEqual(['block:3:path']);
  });

  it('question ids compare in any case, on both sides', () => {
    expect(docProblems(fullDoc(), ITEMS.map((id) => id.toUpperCase()))).toEqual([]);
    expect(docProblems(withField(['blocks', 8, 'item_id'], ITEM_A.toUpperCase()), ITEMS)).toEqual(['block:8:item_id']);
  });

  it('a key holding undefined is not a key (JSON drops it)', () => {
    expect(docProblems({ ...fullDoc(), extra: undefined }, ITEMS)).toEqual([]);
    expect(docProblems(withField(['blocks', 5, 'style'], undefined), ITEMS)).toEqual([]);
  });

  it('size: test_doc_save keeps 200 KB of jsonb text', () => {
    const blocks = Array.from({ length: 60 }, (_, at) => ({ type: 'text', id: `t${String(at).padStart(8, '0')}`, text: 'я'.repeat(4000), align: 'left' }));
    expect(docProblems(withField(['blocks'], blocks), ITEMS)).toEqual(['size']);
  });
});

describe('ruleMessage', () => {
  it.each([
    ['version', 'другой версии'],
    ['title', 'Название теста'],
    ['theme', 'Оформление'],
    ['layout', 'как проходить'],
    ['blocks', 'больше 400'],
    ['results', 'Экран результата'],
    ['size', '200 КБ'],
    ['something', 'обновите страницу'],
    ['block:2:type', 'Блок 3: сломан'],
    ['block:2:id', 'Блок 3: сломан'],
    ['block:0:text', 'Блок 1: текст пустой'],
    ['block:2:title', 'заголовок пустой'],
    ['block:2:subtitle', 'подпись'],
    ['block:2:caption', 'подпись'],
    ['block:2:image', 'картинка'],
    ['block:2:path', 'картинка'],
    ['block:2:item_id', 'вопроса больше нет'],
    ['block:2:points', 'от 1 до 100'],
    ['block:2:align', 'настройки'],
  ])('%s', (rule, words) => {
    const message = ruleMessage(rule);
    expect(message).toContain(words);
    expect(message).not.toContain('!');
  });

  it('with the document: a repeated block or question has its own words', () => {
    const repeatedId = withField(['blocks', 5, 'id'], 'cover0000001');
    expect(ruleMessage('block:5:id', repeatedId)).toBe('Блок 6: копия другого блока — удалите её и добавьте блок заново.');
    expect(ruleMessage('block:5:id', withField(['blocks', 5, 'id'], 'BAD'))).toBe('Блок 6: сломан — удалите его и добавьте заново.');
    const repeatedItem = withField(['blocks', 8, 'item_id'], ITEM_A.toUpperCase());
    expect(ruleMessage('block:8:item_id', repeatedItem)).toBe('Блок 9: этот вопрос уже есть на странице — уберите копию.');
    expect(ruleMessage('block:7:item_id', repeatedItem)).toBe('Блок 8: этого вопроса больше нет — уберите блок.');
    expect(ruleMessage('block:0:item_id', { blocks: ['x'] })).toBe('Блок 1: этого вопроса больше нет — уберите блок.');
    expect(ruleMessage('block:0:item_id', null)).toBe('Блок 1: этого вопроса больше нет — уберите блок.');
  });
});

describe('normalizeDoc', () => {
  it('keeps a valid document as it is', () => {
    const { doc, dangling } = normalizeDoc(fullDoc(), ITEMS, seeded());
    expect(doc).toEqual(fullDoc());
    expect(dangling).toEqual([]);
  });

  it('makes a page of anything', () => {
    for (const raw of [null, 5, 'doc', [], {}, { blocks: 'x', results: { bands: 'x' } }]) {
      const { doc } = normalizeDoc(raw, [], seeded());
      expect(doc).toEqual(emptyDoc(DEFAULT_TITLE));
      expect(docProblems(doc, [])).toEqual([]);
    }
  });

  it('drops unknown fields and puts one-line fields on one line', () => {
    const raw = {
      ...fullDoc(),
      extra: 1,
      title: 'Тест\nпо истории',
      theme: { ...fullDoc().theme, extra: true },
      blocks: [
        { type: 'cover', id: 'cover0000001', title: 'А\nБ', subtitle: 'В\r\nГ', image: PIC, align: 'left', html: '<b>' },
        { type: 'heading', id: 'heading00001', text: 'Раз\nдва', size: 'm' },
        { type: 'image', id: 'image0000001', path: PIC, caption: 'под\nпись', width: 'narrow' },
        { type: 'page', id: 'page00000001', title: 'Стр\nаница' },
      ],
      results: { bands: [{ from: 0, to: 100, title: 'Ито\nг', text: 'a\nb', image: null, x: 1 }], cta: { label: 'Да\nлее', url: 'https://a.ru', y: 2 } },
    };
    const { doc } = normalizeDoc(raw, [], seeded());
    expect(doc.title).toBe('Тест по истории');
    expect(doc.theme).toEqual(fullDoc().theme);
    expect(doc.blocks).toEqual([
      { type: 'cover', id: 'cover0000001', title: 'А Б', subtitle: 'В Г', image: PIC, align: 'left' },
      { type: 'heading', id: 'heading00001', text: 'Раз два', size: 'm' },
      { type: 'image', id: 'image0000001', path: PIC, caption: 'под пись', width: 'narrow' },
      { type: 'page', id: 'page00000001', title: 'Стр аница' },
    ]);
    expect(doc.results).toEqual({ bands: [{ from: 0, to: 100, title: 'Ито г', text: 'a\nb', image: null }], cta: { label: 'Да лее', url: 'https://a.ru' } });
    expect('extra' in doc).toBe(false);
  });

  it('sets broken values to their defaults and drops blocks it cannot keep', () => {
    const raw = {
      v: 9,
      title: '',
      theme: { accent: { custom: '#ABCDEF' }, background: { kind: 'image', path: PIC }, font: 'x' },
      layout: 'x',
      blocks: [
        'text',
        { type: 'poll', id: 'poll00000001' },
        { type: 'cover', id: 'BAD', title: ' ', image: 'x.png' },
        { type: 'heading', text: '  ' },
        { type: 'text', text: '' },
        { type: 'note', text: '\n' },
        { type: 'image', path: 'nope' },
        { type: 'text', id: 'dup000000001', text: 'я'.repeat(5000), align: 'x' },
        { type: 'note', id: 'dup000000001', tone: 'x', text: 'Заметка' },
        { type: 'question', item_id: '' },
        { type: 'question', id: 'q00000000001', item_id: ITEM_A, points: 500, required: 'yes' },
        { type: 'question', id: 'q00000000002', item_id: ITEM_A, points: 1 },
        { type: 'question', id: 'q00000000003', item_id: ITEM_B, points: -3.4, required: true },
        { type: 'question', id: 'q00000000004', item_id: GONE, points: 'x' },
        { type: 'divider', id: 'd00000000001', extra: 1 },
        { type: 'page' },
      ],
    };
    const { doc, dangling } = normalizeDoc(raw, ITEMS, seeded(11));
    expect(doc.v).toBe(1);
    expect(doc.title).toBe(DEFAULT_TITLE);
    expect(doc.theme).toEqual({ accent: { custom: '#abcdef' }, background: { kind: 'image', path: PIC, dim: 40 }, font: 'onest', radius: 'soft', density: 'airy', answers: 'list', buttons: 'pill' });
    expect(doc.layout).toBe('one_by_one');
    const types = doc.blocks.map((block) => block.type);
    expect(types).toEqual(['cover', 'text', 'note', 'question', 'question', 'question', 'divider', 'page']);
    const [cover, text, note, q1, q2, q3, , page] = doc.blocks;
    expect(cover).toMatchObject({ title: DEFAULT_TITLE, subtitle: '', image: null, align: 'center' });
    expect(cover.id).toMatch(BLOCK_ID_RE);
    expect(text).toMatchObject({ id: 'dup000000001', align: 'left' });
    expect(chars((text as { text: string }).text)).toBe(4000);
    expect(note.id).not.toBe('dup000000001');
    expect(note).toMatchObject({ tone: 'info', text: 'Заметка' });
    expect(q1).toMatchObject({ item_id: ITEM_A, points: 100, required: false });
    expect(q2).toMatchObject({ item_id: ITEM_B, points: 1, required: true });
    expect(q3).toMatchObject({ item_id: GONE, points: 1 });
    expect(page).toMatchObject({ title: '' });
    expect(dangling).toEqual([q3.id]);
    expect(docProblems(doc, [...ITEMS, GONE])).toEqual([]);
    expect(docProblems(doc, ITEMS)).toEqual(['block:5:item_id']);
    expect(normalizeDoc(doc, ITEMS, seeded(11)).doc).toEqual(doc);
  });

  it('dangling stays empty without the rows', () => {
    expect(normalizeDoc(fullDoc()).dangling).toEqual([]);
  });

  it('keeps at most 400 blocks', () => {
    const blocks = Array.from({ length: 450 }, () => ({ type: 'divider' }));
    expect(normalizeDoc({ blocks }, [], seeded()).doc.blocks).toHaveLength(DOC_MAX_BLOCKS);
  });

  it('theme: soft tones, image dims, accents', () => {
    expect(normalizeTheme({ background: { kind: 'soft', tone: 'x' } }).background).toEqual({ kind: 'soft', tone: 'blue' });
    expect(normalizeTheme({ background: { kind: 'soft', tone: 'pink' } }).background).toEqual({ kind: 'soft', tone: 'pink' });
    expect(normalizeTheme({ background: { kind: 'image', path: PIC, dim: 99.6 } }).background).toEqual({ kind: 'image', path: PIC, dim: 80 });
    expect(normalizeTheme({ background: { kind: 'image', path: PIC, dim: -4 } }).background).toEqual({ kind: 'image', path: PIC, dim: 0 });
    expect(normalizeTheme({ background: { kind: 'image', path: 'x', dim: 10 } }).background).toEqual({ kind: 'plain' });
    expect(normalizeTheme({ accent: 'violet' }).accent).toBe('violet');
    expect(normalizeTheme({ accent: { custom: 'red' } }).accent).toBe('blue');
    expect(normalizeTheme({ accent: { custom: 5 } }).accent).toBe('blue');
    expect(normalizeTheme(null)).toEqual(emptyDoc('x').theme);
  });

  it('results: sorted bands without overlaps, at most six, a valid link or none', () => {
    const bands = [
      { from: 80, to: 60, title: 'Перевёрнутый', text: 5, image: 'x' },
      'band',
      { from: 0, to: 30, title: 'Первый', text: 'a' },
      { from: 20, to: 40, title: 'Наложился', text: '' },
      { from: 90, to: 95, title: ' ' },
      { title: 'Без чисел' },
    ];
    const { doc } = normalizeDoc({ results: { bands, cta: { label: 'Дальше', url: 'http://a.ru' } } }, [], seeded());
    expect(doc.results.bands).toEqual([
      { from: 0, to: 30, title: 'Первый', text: 'a', image: null },
      { from: 60, to: 80, title: 'Перевёрнутый', text: '', image: null },
    ]);
    expect(doc.results.cta).toBeNull();
    const seven = Array.from({ length: 8 }, (_, at) => ({ from: at * 10, to: at * 10 + 5, title: `Б${at}` }));
    expect(normalizeDoc({ results: { bands: seven, cta: { label: ' ', url: 'https://a.ru' } } }, [], seeded()).doc.results).toMatchObject({ cta: null });
    expect(normalizeDoc({ results: { bands: seven } }, [], seeded()).doc.results.bands).toHaveLength(6);
  });
});

describe('the page and the exam questions', () => {
  const base = (): TestDoc => ({ ...emptyDoc('Т'), blocks: [newBlock('text', undefined, seeded(1)), newBlock('question', ITEM_A, seeded(2))] });

  it('questionIds in page order', () => {
    expect(questionIds(fullDoc())).toEqual([ITEM_A, ITEM_B]);
    expect(questionIds(emptyDoc('x'))).toEqual([]);
  });

  it('syncQuestions appends the missing questions once, in the order given', () => {
    const doc = base();
    const next = syncQuestions(doc, [{ id: ITEM_B }, { id: ITEM_A }, { id: 'x3' }, { id: ITEM_B }], seeded(5));
    expect(questionIds(next)).toEqual([ITEM_A, ITEM_B, 'x3']);
    expect(new Set(next.blocks.map((block) => block.id)).size).toBe(4);
    expect(next.blocks[3]).toMatchObject({ type: 'question', points: 1, required: false });
    expect(syncQuestions(next, [{ id: ITEM_A }], seeded(5))).toBe(next);
    expect(syncQuestions(next, [])).toBe(next);
  });

  it('syncQuestions stops at 400 blocks', () => {
    const doc: TestDoc = { ...emptyDoc('Т'), blocks: Array.from({ length: DOC_MAX_BLOCKS - 1 }, (_, at): DocBlock => ({ type: 'divider', id: `d${String(at).padStart(8, '0')}` })) };
    const next = syncQuestions(doc, [{ id: 'q1' }, { id: 'q2' }], seeded());
    expect(next.blocks).toHaveLength(DOC_MAX_BLOCKS);
    expect(questionIds(next)).toEqual(['q1']);
    expect(syncQuestions(next, [{ id: 'q2' }], seeded())).toBe(next);
  });

  it('dangling blocks are found and left out of a save', () => {
    const doc = fullDoc();
    expect(danglingBlocks(doc, [ITEM_A])).toEqual(['question0002']);
    const saved = withoutDangling(doc, [ITEM_A]);
    expect(questionIds(saved)).toEqual([ITEM_A]);
    expect(withoutDangling(doc, ITEMS)).toBe(doc);
  });

  it('a save also drops the same question again and an unbound ref; ids compare in any case', () => {
    const doc = withField(['blocks', 8, 'item_id'], ITEM_A.toUpperCase()) as unknown as TestDoc;
    expect(danglingBlocks(doc, ITEMS)).toEqual(['question0002']);
    expect(docProblems(withoutDangling(doc, ITEMS), ITEMS)).toEqual([]);
    const ref = withField(['blocks', 7, 'item_id'], 'text-abc:1') as unknown as TestDoc;
    expect(danglingBlocks(ref, ITEMS.map((id) => id.toUpperCase()))).toEqual(['question0001']);
    expect(syncQuestions(fullDoc(), [{ id: ITEM_A.toUpperCase() }], seeded())).toEqual(fullDoc());
  });

  it('bindRefs puts the new rows ids in place of their refs', () => {
    const doc: TestDoc = { ...emptyDoc('Т'), blocks: [newBlock('question', 'imp:1', seeded(1)), newBlock('text', undefined, seeded(2)), newBlock('question', 'imp:2', seeded(3))] };
    const bound = bindRefs(doc, [
      { ref: 'imp:2', id: ITEM_B },
      { ref: 'imp:1', id: ITEM_A },
    ]);
    expect(questionIds(bound)).toEqual([ITEM_A, ITEM_B]);
    expect(bindRefs(bound, [{ ref: 'imp:1', id: ITEM_A }])).toBe(bound);
  });
});

describe('block edits', () => {
  const doc = fullDoc();
  const ids = (page: TestDoc) => page.blocks.map((block) => block.id);
  const last = (list: string[]) => list[list.length - 1];

  it('findBlock', () => {
    expect(findBlock(doc, 'note00000001')?.type).toBe('note');
    expect(findBlock(doc, 'nope')).toBeNull();
  });

  it('insertBlock at a place, at the end, clamped', () => {
    const block = newBlock('divider', undefined, seeded());
    expect(ids(insertBlock(doc, block, 1))[1]).toBe(block.id);
    expect(last(ids(insertBlock(doc, block)))).toBe(block.id);
    expect(ids(insertBlock(doc, block, -5))[0]).toBe(block.id);
    expect(last(ids(insertBlock(doc, block, 99)))).toBe(block.id);
  });

  it('removeBlock', () => {
    expect(ids(removeBlock(doc, 'divider00001'))).not.toContain('divider00001');
    expect(removeBlock(doc, 'nope')).toBe(doc);
  });

  it('moveBlock to a place of the page after the move', () => {
    expect(ids(moveBlock(doc, 'question0002', 0))[0]).toBe('question0002');
    expect(last(ids(moveBlock(doc, 'cover0000001', 99)))).toBe('cover0000001');
    expect(ids(moveBlock(doc, 'heading00001', 2)).slice(0, 3)).toEqual(['cover0000001', 'text00000001', 'heading00001']);
    expect(moveBlock(doc, 'heading00001', 1)).toBe(doc);
    expect(moveBlock(doc, 'nope', 1)).toBe(doc);
  });

  it('replaceBlock', () => {
    const next = replaceBlock(doc, { type: 'heading', id: 'heading00001', text: 'Новое', size: 'l' });
    expect(findBlock(next, 'heading00001')).toEqual({ type: 'heading', id: 'heading00001', text: 'Новое', size: 'l' });
    expect(replaceBlock(doc, { ...doc.blocks[1] })).toBe(doc);
    expect(replaceBlock(doc, { type: 'divider', id: 'nope00000000' })).toBe(doc);
  });

  it('duplicateBlock copies after itself, never a question', () => {
    const next = duplicateBlock(doc, 'note00000001', seeded(9));
    expect(next.blocks[5]).toEqual({ ...doc.blocks[4], id: next.blocks[5].id });
    expect(next.blocks[5].id).not.toBe('note00000001');
    expect(duplicateBlock(doc, 'question0001')).toBe(doc);
    expect(duplicateBlock(doc, 'nope')).toBe(doc);
    const full: TestDoc = { ...doc, blocks: Array.from({ length: DOC_MAX_BLOCKS }, (_, at): DocBlock => ({ type: 'divider', id: `d${String(at).padStart(8, '0')}` })) };
    expect(duplicateBlock(full, 'd00000000')).toBe(full);
  });
});
