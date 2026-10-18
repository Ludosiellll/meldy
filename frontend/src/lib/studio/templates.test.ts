import { describe, expect, it } from 'vitest';
import type { TestItem } from '../../types/container';
import { draftOf, draftProblems } from '../../components/containers/keys/editorModel';
import { itemFromInput } from '../../components/test/buildModel';
import { checkTest } from './checker';
import { contrast, themeTokens } from './contrast';
import { bindRefs, docProblems, emptyDoc, newId, questionIds, type RandomFill } from './doc';
import { READY_THEMES, sampleInput, TEMPLATES, templateDoc, templateSamples, type TemplateId } from './templates';
import { fromText, toText } from './textFormat';

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
const IDS: TemplateId[] = ['topic_check', 'quiz', 'entry', 'self_check'];

/** A starter added: rows made from its inputs (uuids ending in n) and the document with them bound. */
function added(id: TemplateId, title?: string) {
  const { doc, adds } = templateDoc(id, { title, random: seeded(), importId: `tpl-${id}` });
  const items: TestItem[] = adds.map((input, at) => itemFromInput(input, `00000000-0000-4000-8000-${String(at + 1).padStart(12, '0')}`, at + 1, 's', EXAM));
  return { doc: bindRefs(doc, items.map((item, at) => ({ ref: adds[at].ref, id: item.id }))), items, adds, raw: doc };
}

describe('the four starters', () => {
  it('in plain Russian, in order', () => {
    expect(TEMPLATES.map((entry) => [entry.id, entry.title])).toEqual([
      ['topic_check', 'Контрольная по теме'],
      ['quiz', 'Викторина'],
      ['entry', 'Входной тест'],
      ['self_check', 'Самопроверка'],
    ]);
    for (const entry of TEMPLATES) {
      expect(entry.lead).toMatch(/^[А-ЯЁ].+\.$/);
      expect(`${entry.title} ${entry.lead}`).not.toMatch(/!/);
      expect(entry.questions).toBe(templateSamples(entry.id).length);
    }
  });

  it.each(IDS)('%s: 5–8 sample questions, each one the editor would save, each with its key', (id) => {
    const samples = templateSamples(id);
    expect(samples.length).toBeGreaterThanOrEqual(5);
    expect(samples.length).toBeLessThanOrEqual(8);
    const { items } = added(id);
    for (const item of items) {
      expect(draftProblems(draftOf(item))).toEqual([]);
      expect(item.kind === 'short' ? item.answers.length : item.correct.length).toBeGreaterThan(0);
      expect(item.key_source).toBe('manual');
      expect(`${item.stem} ${item.options.join(' ')} ${item.explanation}`).not.toMatch(/!/);
    }
    const kinds = new Set(items.map((item) => item.kind));
    expect(kinds.has('single')).toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(2);
  });

  it.each(IDS)('%s: a valid page that the checker has nothing against', (id) => {
    const { doc, items, raw, adds } = added(id);
    expect(questionIds(raw)).toEqual(adds.map((input) => input.ref));
    // Until bindRefs the question blocks hold refs, which the server refuses: the rows are added first.
    expect(docProblems(raw, adds.map((input) => input.ref))).toEqual(raw.blocks.flatMap((block, at) => (block.type === 'question' ? [`block:${at}:item_id`] : [])));
    expect(docProblems(doc, items.map((item) => item.id), EXAM)).toEqual([]);
    expect(checkTest(doc, items)).toEqual([]);
    expect(doc.results.bands.length).toBeGreaterThan(0);
    expect(doc.results.bands[0].from).toBe(0);
    expect(doc.results.bands[doc.results.bands.length - 1].to).toBe(100);
  });

  it.each(IDS)('%s: its text reads back unchanged', (id) => {
    const { doc, items } = added(id);
    const back = fromText(toText(doc, items), doc, items);
    expect(back.doc).toBe(doc);
    expect([back.adds, back.updates, back.removes, back.problems]).toEqual([[], [], [], []]);
  });

  it('each has its own look and way through', () => {
    const looks = IDS.map((id) => {
      const { doc } = added(id);
      return `${JSON.stringify(doc.theme)} ${doc.layout}`;
    });
    expect(new Set(looks).size).toBe(4);
    expect(added('entry').doc.blocks.filter((block) => block.type === 'page')).toHaveLength(2);
    expect(added('self_check').items.every((item) => (item.explanation ?? '').length > 0)).toBe(true);
    expect(added('topic_check').doc.blocks.filter((block) => block.type === 'question').every((block) => block.type === 'question' && block.required)).toBe(true);
  });

  it('the page takes the exam name; without one, the starter topic', () => {
    const named = added('quiz', '  География\n7 класс ').doc;
    expect(named.title).toBe('География 7 класс');
    expect(named.blocks[0]).toMatchObject({ type: 'cover', title: 'География 7 класс' });
    expect(added('quiz', '   ').doc.title).toBe('Вокруг света');
    expect(added('quiz').doc.title).toBe('Вокруг света');
  });

  it('refs from a fresh import id by default, rows numbered after the exam', () => {
    const { adds } = templateDoc('entry', { random: seeded(3), items: [{ file_no: '9' }, { file_no: 'x' }] });
    expect(adds.map((input) => input.ref)).toEqual(adds.map((_, at) => `tpl-${newId(seeded(3))}:${at + 1}`));
    expect(adds.map((input) => input.file_no)).toEqual(['10', '11', '12', '13', '14', '15']);
    expect(templateDoc('quiz').adds[0].ref).toMatch(/^tpl-[a-z0-9]{12}:1$/);
    expect(adds.every((input) => /^[A-Za-z0-9_:.-]{1,80}$/.test(input.ref))).toBe(true);
  });

  it('a new document each time: changing one leaves the next as it was', () => {
    const first = templateDoc('quiz', { random: seeded() });
    first.doc.results.bands[0].title = 'Изменено';
    if (first.doc.theme.background.kind === 'soft') first.doc.theme.background.tone = 'pink';
    const second = templateDoc('quiz', { random: seeded() });
    expect(second.doc.results.bands[0].title).not.toBe('Изменено');
    expect(second.doc.theme.background).toEqual({ kind: 'soft', tone: 'orange' });
  });
});

describe('sampleInput', () => {
  it('«верно / неверно» and «все перечисленные» keep their order, a short answer keeps its forms', () => {
    expect(sampleInput({ stem: 'Земля круглая.', options: ['Верно', 'Неверно'], right: [0] }, '1', 'r:1')).toMatchObject({ keep_order: true, kind: 'single' });
    expect(sampleInput({ stem: 'Что полезно?', options: ['Сон', 'Еда', 'Все перечисленные'], right: [2] }, '2', 'r:2')).toMatchObject({ keep_order: true });
    expect(sampleInput({ stem: 'Чётные?', options: ['2', '3', '4'], right: [0, 2] }, '3', 'r:3')).toMatchObject({ keep_order: false, kind: 'multiple', correct: [0, 2] });
    expect(sampleInput({ stem: 'Столица?', forms: ['Москва'], explanation: 'Да.' }, '4', 'r:4')).toEqual({
      ref: 'r:4',
      stem: 'Столица?',
      options: [],
      correct: [],
      answers: ['Москва'],
      kind: 'short',
      file_no: '4',
      key_source: 'manual',
      code: false,
      keep_order: false,
      explanation: 'Да.',
    });
    expect(sampleInput({ stem: 'Пусто' }, '5', 'r:5')).toMatchObject({ kind: 'short', answers: [], key_source: 'none' });
  });
});

describe('ready themes', () => {
  it('four, each valid and readable in both themes', () => {
    expect(READY_THEMES.map((entry) => entry.title)).toEqual(['Спокойная', 'Яркая', 'Строгая', 'Книжная']);
    for (const { theme } of READY_THEMES) {
      expect(docProblems({ ...emptyDoc('Т'), theme }, [])).toEqual([]);
      for (const dark of [false, true]) {
        const tokens = themeTokens(theme, dark);
        expect(contrast(tokens['--qt-fill'], tokens['--qt-on-fill'])).toBeGreaterThanOrEqual(4.5);
        expect(contrast(tokens['--qt-link'], tokens['--doc-canvas'])).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
