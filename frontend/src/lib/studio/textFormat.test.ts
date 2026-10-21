import { describe, expect, it } from 'vitest';
import { PICTURE_STEM, type TestItem } from '../../types/container';
import type { DocBlock, TestDoc } from '../../types/testDoc';
import { draftOf, draftProblems } from '../../components/containers/keys/editorModel';
import { itemFromInput } from '../../components/test/buildModel';
import { bindRefs, emptyDoc, newId, normalizeDoc, questionIds, type RandomFill } from './doc';
import { fromText, TEXT_SYNTAX, toText } from './textFormat';

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
const PIC = `${EXAM}/${'a'.repeat(64)}.png`;
const PIC2 = `${EXAM}/${'b'.repeat(64)}.png`;
const YT = 'https://youtu.be/dQw4w9WgXcQ?t=42';
const RT = 'https://rutube.ru/video/c6cc4d620b1d4338901770a44b3e82f4/';

function row(id: string, partial: Partial<TestItem>): TestItem {
  return {
    id,
    container_id: EXAM,
    subject_id: 's',
    position: 1,
    file_no: '1',
    topic: null,
    kind: 'single',
    stem: 'Вопрос',
    options: ['а', 'б'],
    correct: [0],
    answers: [],
    key_source: 'manual',
    code: false,
    keep_order: false,
    flags: [],
    rev: 1,
    updated_at: '',
    images: null,
    explanation: '',
    ...partial,
  };
}

const Q1 = row('q1', { stem: 'Сколько будет 2 + 2?', options: ['3', '4', '5'], correct: [1], explanation: 'Два и два — четыре.\n\nПроверьте на пальцах.', file_no: '7' });
const Q2 = row('q2', {
  kind: 'multiple',
  stem: 'Что выведет код?\n\nfor i in range(2):\n    print(i)\n  \n# конец',
  options: ['0\n1', '1\n\n2', '+ 0', '\\n', '  отступ'],
  correct: [0, 2],
  code: true,
  file_no: '12a',
});
const Q3 = row('q3', { kind: 'short', stem: '# не заголовок\n- не вариант\n> не пояснение\n\\обратная\n=== не страница', options: [], correct: [], answers: ['Москва', 'г. Москва'] });
const Q4 = row('q4', { stem: '!важно не заметка', options: ['да', 'нет'], correct: [] });
const Q5 = row('q5', { kind: 'short', stem: '[обложка] не обложка', options: [], correct: [], answers: [] });
const Q6 = row('q6', { stem: PICTURE_STEM, options: ['Рисунок А', 'Рисунок Б'], correct: [1], images: { stem: ['s.png'], options: [['a.png'], ['b.png']] } });
const Q7 = row('q7', { stem: 'Хвост   ', options: ['a', 'b'], correct: [0] });
const ITEMS = [Q1, Q2, Q3, Q4, Q5, Q6, Q7];

const q = (item: TestItem, points = 1, required = false): DocBlock => ({ type: 'question', id: `blk${item.id}aaaaa`, item_id: item.id, points, required });

function richDoc(): TestDoc {
  return {
    ...emptyDoc('Тест'),
    theme: { accent: { custom: '#123456' }, background: { kind: 'soft', tone: 'pink' }, font: 'mono', radius: 'round', density: 'compact', answers: 'grid', buttons: 'square' },
    layout: 'pages',
    blocks: [
      { type: 'cover', id: 'cover0000001', title: 'Тест по всему', subtitle: '[обложка] подзаголовок', image: PIC, align: 'left' },
      { type: 'heading', id: 'heading00001', text: 'Часть 1', size: 'l' },
      { type: 'heading', id: 'heading00002', text: '## звёзды', size: 'm' },
      {
        type: 'text',
        id: 'text00000001',
        text: 'Первая строка\n\n   \n# не заголовок\n\\обратная черта\n---\n===\n+ плюс\n- минус\n= равно\n> больше\n[картинка] нет\n!совет нет\n  отступ\n**жирный** и [ссылка](https://a.ru)\n[видео](https://youtu.be/dQw4w9WgXcQ) не видео\n[видео] и это',
        align: 'center',
      },
      { type: 'note', id: 'note00000001', tone: 'info', text: 'совет дня\nвторая строка' },
      { type: 'note', id: 'note00000002', tone: 'tip', text: 'Не спешите' },
      { type: 'note', id: 'note00000003', tone: 'warn', text: '\nпервая пустая' },
      { type: 'image', id: 'image0000001', path: PIC, caption: 'Схема', width: 'narrow' },
      { type: 'image', id: 'image0000002', path: PIC2, caption: '', width: 'full' },
      { type: 'video', id: 'video0000001', url: YT, caption: 'Опыт с натрием (2 мин)' },
      { type: 'video', id: 'video0000002', url: RT, caption: '' },
      { type: 'divider', id: 'divider00001' },
      { type: 'page', id: 'page00000001', title: '' },
      q(Q1, 3, true),
      q(Q2),
      { type: 'page', id: 'page00000002', title: 'Вторая страница' },
      q(Q3),
      q(Q4),
      q(Q5),
      q(Q6),
      q(Q7),
      { type: 'text', id: 'text00000002', text: 'Итог', align: 'center' },
      { type: 'divider', id: 'divider00002' },
    ],
    results: { bands: [{ from: 0, to: 100, title: 'Всё', text: '', image: null }], cta: null },
  };
}

const replaceChunk = (text: string, from: string, to: string) => {
  expect(text).toContain(from);
  return text.replace(from, to);
};

describe('toText', () => {
  it('writes each block in its marks, an empty line between blocks', () => {
    const doc: TestDoc = {
      ...emptyDoc('Т'),
      blocks: [
        { type: 'cover', id: 'cover0000001', title: 'Контрольная', subtitle: 'Тема 1', image: null, align: 'center' },
        { type: 'heading', id: 'heading00001', text: 'Часть 1', size: 'l' },
        { type: 'text', id: 'text00000001', text: 'Ответьте **на все** вопросы.', align: 'left' },
        { type: 'note', id: 'note00000001', tone: 'tip', text: 'Не спешите' },
        { type: 'divider', id: 'divider00001' },
        { type: 'page', id: 'page00000001', title: 'Вторая' },
        q(Q1),
        { type: 'image', id: 'image0000001', path: PIC, caption: 'Схема', width: 'wide' },
        q(row('q8', { kind: 'short', options: [], correct: [], answers: ['Москва', 'Moscow'] })),
      ],
    };
    const short = row('q8', { kind: 'short', options: [], correct: [], answers: ['Москва', 'Moscow'] });
    expect(toText(doc, [Q1, short])).toBe(
      [
        '[обложка] Контрольная',
        'Тема 1',
        '',
        '# Часть 1',
        '',
        'Ответьте **на все** вопросы.',
        '',
        '!совет Не спешите',
        '',
        '---',
        '',
        '=== Вторая',
        '',
        'Сколько будет 2 + 2?',
        '- 3',
        '+ 4',
        '- 5',
        '> Два и два — четыре.',
        '>',
        '> Проверьте на пальцах.',
        '',
        '[картинка] Схема',
        '',
        'Вопрос',
        '= Москва; Moscow',
        '',
      ].join('\n'),
    );
  });

  it('a cover without a subtitle is one line; a row without the explanation field has none', () => {
    const bare: TestItem = { ...row('q9', { stem: 'Без пояснения' }), explanation: undefined };
    const doc: TestDoc = { ...emptyDoc('Т'), blocks: [{ type: 'cover', id: 'cover0000001', title: 'Тест', subtitle: '', image: null, align: 'center' }, q(bare)] };
    const text = toText(doc, [bare]);
    expect(text).toBe('[обложка] Тест\n\nБез пояснения\n+ а\n- б\n');
    expect(fromText(text, doc, [bare]).doc).toBe(doc);
  });

  it('nothing for an empty page; a question whose row is gone is left out', () => {
    expect(toText(emptyDoc('Т'), [])).toBe('');
    expect(toText({ ...emptyDoc('Т'), blocks: [q(Q1), q(Q7)] }, [Q7])).toBe('Хвост   \n+ a\n- b\n');
  });

  it('escapes the lines that would read as marks', () => {
    const text = toText(richDoc(), ITEMS);
    expect(text).toContain('[обложка] Тест по всему\n\\[обложка] подзаголовок\n');
    expect(text).toContain('Первая строка\n\\\n\\   \n\\# не заголовок\n\\\\обратная черта\n\\---\n\\===\n\\+ плюс\n\\- минус\n\\= равно\n\\> больше\n\\[картинка] нет\n\\!совет нет\n  отступ\n**жирный**');
    expect(text).toContain('! совет дня\nвторая строка');
    expect(text).toContain('!важно\nпервая пустая');
    expect(text).toContain('Что выведет код?\n\\\nfor i in range(2):\n    print(i)\n\\  \n\\# конец\n+ 0\n  1\n- 1\n  \\\n  2\n+ + 0\n- \\n\n-   отступ');
    expect(text).toContain('\\# не заголовок\n\\- не вариант\n\\> не пояснение\n\\\\обратная\n\\=== не страница\n= Москва; г. Москва');
    expect(text).toContain('\\!важно не заметка\n- да\n- нет');
    expect(text).toContain('\\[обложка] не обложка\n=\n');
    expect(text).toContain('[картинка]\n\n[видео](https://youtu.be/dQw4w9WgXcQ?t=42) Опыт с натрием (2 мин)\n\n[видео](https://rutube.ru/video/c6cc4d620b1d4338901770a44b3e82f4/)\n\n---');
    expect(text).toContain('[ссылка](https://a.ru)\n\\[видео](https://youtu.be/dQw4w9WgXcQ) не видео\n\\[видео] и это\n');
  });
});

describe('a round trip changes nothing', () => {
  it('fromText(toText(doc)) is the same document with no changes and no problems', () => {
    const doc = richDoc();
    const text = toText(doc, ITEMS);
    const back = fromText(text, doc, ITEMS, { random: seeded() });
    expect(back).toEqual({ doc, adds: [], updates: [], removes: [], problems: [] });
    expect(back.doc).toBe(doc);
    expect(toText(back.doc, ITEMS)).toBe(text);
  });

  it('holds for a normalised document of any kind', () => {
    const raw = { ...richDoc(), blocks: [...richDoc().blocks, { type: 'heading', id: 'heading00009', text: 'Две\nстроки', size: 'm' }] };
    const doc = normalizeDoc(raw, ITEMS.map((item) => item.id), seeded()).doc;
    const text = toText(doc, ITEMS);
    expect(fromText(text, doc, ITEMS, { random: seeded() }).doc).toBe(doc);
  });

  it('CRLF and a byte-order mark read the same', () => {
    const doc = richDoc();
    const text = toText(doc, ITEMS);
    expect(fromText(`\ufeff${text.replace(/\n/g, '\r\n')}`, doc, ITEMS).doc).toBe(doc);
  });

  it('a question whose row is gone leaves the page (it could not be saved)', () => {
    const doc: TestDoc = { ...emptyDoc('Т'), blocks: [q(Q1), q(row('gone', {}))] };
    const back = fromText(toText(doc, [Q1]), doc, [Q1]);
    expect(questionIds(back.doc)).toEqual(['q1']);
    expect(back.removes).toEqual([]);
  });
});

describe('fromText makes the fewest changes', () => {
  const doc = richDoc();
  const text = toText(doc, ITEMS);
  const read = (edited: string, items: readonly TestItem[] = ITEMS) => fromText(edited, doc, items, { random: seeded(3), importId: 'imp' });

  it('an option changed: one patch of the options', () => {
    const result = read(replaceChunk(text, '- 3\n+ 4\n- 5', '- 3\n+ 4\n- 6'));
    expect(result.updates).toEqual([{ id: 'q1', patch: { options: ['3', '4', '6'] } }]);
    expect(result.doc).toBe(doc);
    expect([result.adds, result.removes, result.problems]).toEqual([[], [], []]);
  });

  it('a second «+»: the key and the kind', () => {
    expect(read(replaceChunk(text, '- 3\n+ 4\n- 5', '- 3\n+ 4\n+ 5')).updates).toEqual([{ id: 'q1', patch: { correct: [1, 2], kind: 'multiple' } }]);
  });

  it('the explanation changed, the short answer forms changed', () => {
    const edited = replaceChunk(replaceChunk(text, '> Проверьте на пальцах.', '> Посчитайте.'), '= Москва; г. Москва', '= Москва\n= Moscow; город Москва');
    expect(read(edited).updates).toEqual([
      { id: 'q1', patch: { explanation: 'Два и два — четыре.\n\nПосчитайте.' } },
      { id: 'q3', patch: { answers: ['Москва', 'Moscow', 'город Москва'] } },
    ]);
  });

  it('the editor tidying is left out: only what the author changed', () => {
    const result = read(replaceChunk(text, 'Хвост   \n+ a\n- b', 'Хвост   \n+ a\n- b\n> Пояснение'));
    expect(result.updates).toEqual([{ id: 'q7', patch: { explanation: 'Пояснение' } }]);
    // Only the tidying itself (the spaces at the end of a stem) is no change to send.
    expect(read(replaceChunk(text, 'Хвост   \n', 'Хвост\n')).updates).toEqual([]);
    expect(read(replaceChunk(text, 'Сколько будет 2 + 2?\n', 'Сколько будет 2 + 2?   \n')).updates).toEqual([]);
  });

  it('a picture question keeps its pictures', () => {
    const result = read(replaceChunk(text, 'Вопрос на картинке\n- Рисунок А\n+ Рисунок Б', 'Вопрос на картинке\n+ Рисунок А\n- Рисунок Б'));
    expect(result.updates).toEqual([{ id: 'q6', patch: { correct: [0] } }]);
    const words = read(replaceChunk(text, 'Вопрос на картинке\n- Рисунок А', 'Что на рисунке?\n- Рисунок А'));
    expect(words.updates).toEqual([{ id: 'q6', patch: { stem: 'Что на рисунке?' } }]);
  });

  it('a question taken out of the text: its row is deleted', () => {
    const result = read(replaceChunk(text, '\\!важно не заметка\n- да\n- нет\n\n', ''));
    expect(result.removes).toEqual(['q4']);
    expect(questionIds(result.doc)).toEqual(['q1', 'q2', 'q3', 'q5', 'q6', 'q7']);
    expect(result.updates).toEqual([]);
  });

  it('a new question: a row to add, its block holds the ref until bindRefs', () => {
    const result = read(`${text}\nСтолица Франции?\n- Лондон\n+ Париж\n> Париж — столица с X века.\n`);
    expect(result.adds).toEqual([
      {
        ref: 'imp:1',
        stem: 'Столица Франции?',
        options: ['Лондон', 'Париж'],
        correct: [1],
        kind: 'single',
        file_no: '8',
        key_source: 'manual',
        code: false,
        keep_order: false,
        explanation: 'Париж — столица с X века.',
      },
    ]);
    const last = result.doc.blocks[result.doc.blocks.length - 1];
    expect(last).toMatchObject({ type: 'question', item_id: 'imp:1', points: 1, required: false });
    expect(questionIds(bindRefs(result.doc, [{ ref: 'imp:1', id: 'new-row' }])).slice(-1)).toEqual(['new-row']);
    expect(result.problems).toEqual([]);
  });

  it('a moved question is the same question', () => {
    const chunk = 'Хвост   \n+ a\n- b\n\n';
    const moved = chunk + replaceChunk(text, chunk, '');
    const result = read(moved);
    expect([result.adds, result.updates, result.removes]).toEqual([[], [], []]);
    expect(result.doc.blocks[0]).toEqual(q(Q7));
    expect(result.doc.blocks).toHaveLength(doc.blocks.length);
  });

  it('a question rewritten in its place is patched, not deleted and added', () => {
    const result = read(replaceChunk(text, 'Сколько будет 2 + 2?', 'Чему равна сумма двух двоек?'));
    expect(result.updates).toEqual([{ id: 'q1', patch: { stem: 'Чему равна сумма двух двоек?' } }]);
    expect(result.removes).toEqual([]);
  });

  it('between unchanged neighbours the likelier question is the one kept', () => {
    const a = row('qa', { stem: 'Какая столица у Франции?', options: ['Париж', 'Лион'], correct: [0] });
    const b = row('qb', { stem: 'Какая река самая длинная?', options: ['Нил', 'Волга'], correct: [0] });
    const page: TestDoc = { ...emptyDoc('Т'), blocks: [q(a), q(b)] };
    const result = fromText('Какая река самая длинная в мире?\n+ Нил\n- Волга\n', page, [a, b], { random: seeded() });
    expect(result.updates).toEqual([{ id: 'qb', patch: { stem: 'Какая река самая длинная в мире?' } }]);
    expect(result.removes).toEqual(['qa']);
  });

  it('a text of signs only is still the same block when it changes', () => {
    const page: TestDoc = { ...emptyDoc('Т'), blocks: [{ type: 'text', id: 'text00000001', text: '...', align: 'center' }] };
    expect(fromText('?\n', page, []).doc.blocks).toEqual([{ type: 'text', id: 'text00000001', text: '?', align: 'center' }]);
  });

  it('a question edited and a new one after it: the edited one is patched, the other added', () => {
    const a = row('qa', { stem: 'Какая столица у Франции?', options: ['Париж', 'Лион'], correct: [0] });
    const page: TestDoc = { ...emptyDoc('Т'), blocks: [q(a)] };
    const result = fromText('Какая столица у Франции сейчас?\n+ Париж\n- Лион\n\nСовсем другой вопрос\n+ да\n- нет\n', page, [a], { random: seeded(), importId: 'imp' });
    expect(result.updates).toEqual([{ id: 'qa', patch: { stem: 'Какая столица у Франции сейчас?' } }]);
    expect(result.adds.map((input) => input.stem)).toEqual(['Совсем другой вопрос']);
    expect(result.removes).toEqual([]);
  });

  it('blocks keep their ids and their settings the text does not show', () => {
    const edited = replaceChunk(
      replaceChunk(replaceChunk(replaceChunk(text, '# Часть 1', '# Часть первая'), '[картинка] Схема', '[картинка] Новая подпись'), '! совет дня', '!важно совет дня'),
      'Итог',
      'Итог теста',
    );
    const result = read(edited);
    const byId = new Map(result.doc.blocks.map((block) => [block.id, block]));
    expect(byId.get('heading00001')).toEqual({ type: 'heading', id: 'heading00001', text: 'Часть первая', size: 'l' });
    expect(byId.get('image0000001')).toEqual({ type: 'image', id: 'image0000001', path: PIC, caption: 'Новая подпись', width: 'narrow' });
    expect(byId.get('note00000001')).toMatchObject({ tone: 'warn', text: 'совет дня\nвторая строка' });
    expect(byId.get('text00000002')).toEqual({ type: 'text', id: 'text00000002', text: 'Итог теста', align: 'center' });
    // Blocks the text left as they were are the page's own objects.
    expect(byId.get('note00000002')).toBe(doc.blocks[5]);
    expect(byId.get('image0000002')).toBe(doc.blocks[8]);
    expect(result.doc.theme).toEqual(doc.theme);
    expect(result.doc.results).toEqual(doc.results);
    expect(result.problems).toEqual([]);
  });

  it('the cover keeps its picture when its words change', () => {
    const result = read(replaceChunk(text, '[обложка] Тест по всему\n\\[обложка] подзаголовок', '[обложка] Новое название\nНовый подзаголовок'));
    expect(result.doc.blocks[0]).toEqual({ type: 'cover', id: 'cover0000001', title: 'Новое название', subtitle: 'Новый подзаголовок', image: PIC, align: 'left' });
  });

  it('new blocks get new ids and their default settings; a block of another type is not reused', () => {
    const result = read(replaceChunk(text, '# Часть 1', 'Часть 1 — теперь текст\n\n[обложка] Вторая обложка\n\n=== Ещё страница'));
    const added = result.doc.blocks.slice(1, 4);
    expect(added.map((block) => block.type)).toEqual(['text', 'cover', 'page']);
    expect(added[0]).toMatchObject({ text: 'Часть 1 — теперь текст', align: 'left' });
    expect(added[1]).toMatchObject({ title: 'Вторая обложка', subtitle: '', image: null, align: 'center' });
    for (const block of added) expect(block.id).toMatch(/^[a-z0-9]{12}$/);
    expect(result.doc.blocks.some((block) => block.id === 'heading00001')).toBe(false);
  });

  it('a video comes from text: its link in brackets, the caption after it; a link is made clean', () => {
    const page = emptyDoc('Т');
    const result = fromText('[видео](youtu.be/dQw4w9WgXcQ) Опыт\n\n[видео](https://vk.com/video-1_2)', page, [], { random: seeded() });
    expect(result.problems).toEqual([]);
    expect(result.doc.blocks.map((block) => (block.type === 'video' ? [block.url, block.caption] : block.type))).toEqual([
      ['https://youtu.be/dQw4w9WgXcQ', 'Опыт'],
      ['https://vk.com/video-1_2', ''],
    ]);
    // Back as text: the link the page keeps.
    expect(toText(result.doc, [])).toBe('[видео](https://youtu.be/dQw4w9WgXcQ) Опыт\n\n[видео](https://vk.com/video-1_2)\n');
  });

  it('a video whose caption or link changed keeps its block id', () => {
    const page: TestDoc = { ...emptyDoc('Т'), blocks: [{ type: 'video', id: 'video0000001', url: YT, caption: 'Было' }] };
    const changed = fromText(`[видео](${RT}) Стало`, page, [], { random: seeded() });
    expect(changed.problems).toEqual([]);
    expect(changed.doc.blocks).toEqual([{ type: 'video', id: 'video0000001', url: RT, caption: 'Стало' }]);
  });

  it('a new picture cannot come from text', () => {
    const result = read(`${text}\n[картинка] Новая\n`);
    expect(result.problems).toEqual([{ line: text.split('\n').length + 1, message: `Строка ${text.split('\n').length + 1}: новую картинку добавьте на холсте. В тексте её можно только подписать или переставить.` }]);
  });

  it('the refs start with a fresh import id when none is given', () => {
    const result = fromText('Вопрос?\n+ да\n- нет\n', emptyDoc('Т'), [], { random: seeded(5) });
    expect(result.adds[0].ref).toBe(`text-${newId(seeded(5))}:1`);
    expect(fromText('Вопрос?\n+ да\n- нет\n', emptyDoc('Т'), []).adds[0].ref).toMatch(/^text-[a-z0-9]{12}:1$/);
  });
});

describe('fromText reads what people type', () => {
  const read = (text: string) => fromText(text, emptyDoc('Т'), [], { random: seeded(), importId: 'imp' });

  it('questions one after another without empty lines; numbering kept as words', () => {
    const result = read('1. Первый?\n+ да\n- нет\n2. Второй?\n- а\n+ б\n- в\n> Потому что б.\nПросто текст после');
    expect(result.adds.map((input) => [input.stem, input.options, input.correct, input.explanation])).toEqual([
      ['1. Первый?', ['да', 'нет'], [0], undefined],
      ['2. Второй?', ['а', 'б', 'в'], [1], 'Потому что б.'],
    ]);
    expect(result.doc.blocks.map((block) => block.type)).toEqual(['question', 'question', 'text']);
    expect(result.adds.map((input) => input.file_no)).toEqual(['1', '2']);
  });

  it('a heading, a page, a divider and a picture end on their line; a cover takes one line more', () => {
    const result = read('# Часть\nТекст под ней\n## Меньше\n=== Страница\nПосле страницы\n---\nПосле линии\n[обложка] Название\nПодзаголовок\nЕщё текст');
    expect(result.doc.blocks.map((block) => block.type)).toEqual(['heading', 'text', 'heading', 'page', 'text', 'divider', 'text', 'cover', 'text']);
    expect(result.doc.blocks[2]).toMatchObject({ size: 'm', text: 'Меньше' });
    expect(result.doc.blocks[7]).toMatchObject({ title: 'Название', subtitle: 'Подзаголовок' });
  });

  it('notes: the tone from the mark, more lines below', () => {
    const result = read('!совет Сначала\nпотом\n\n!важно Внимание\n\n! Просто');
    expect(result.doc.blocks.map((block) => (block.type === 'note' ? [block.tone, block.text] : null))).toEqual([
      ['tip', 'Сначала\nпотом'],
      ['warn', 'Внимание'],
      ['info', 'Просто'],
    ]);
  });

  it('a long option goes on after two spaces; forms on several lines; explanation lines', () => {
    const result = read('Вопрос\n+ первая строка\n  вторая строка\n  \\  с отступом\n- другой\n\nКороткий\n= а; б\n= в\n> раз\n>\n> два');
    expect(result.adds[0].options).toEqual(['первая строка\nвторая строка\n  с отступом', 'другой']);
    expect(result.adds[1]).toMatchObject({ kind: 'short', options: [], correct: [], answers: ['а', 'б', 'в'], explanation: 'раз\n\nдва' });
  });

  it('«верно / неверно» and «все перечисленные» keep their order; two «+» are several answers', () => {
    const result = read('Земля круглая.\n+ Верно\n- Неверно\n\nЧто полезно?\n- Сон\n- Еда\n+ Все перечисленные\n\nЧётные?\n+ 2\n+ 4\n- 5');
    expect(result.adds.map((input) => [input.keep_order, input.kind])).toEqual([
      [true, 'single'],
      [true, 'single'],
      [false, 'multiple'],
    ]);
  });

  it('new rows are numbered after the exam numbers', () => {
    const result = fromText('Вопрос\n+ а\n- б', emptyDoc('Т'), [row('x', { file_no: '41' }), row('y', { file_no: '№ 50' })], { importId: 'imp' });
    expect(result.adds[0].file_no).toBe('42');
  });

  it('every sample a new question gives is one the editor would save', () => {
    const result = read('Вопрос?\n+ да\n- нет\n\nКороткий?\n= ответ\n> пояснение');
    for (const input of result.adds) expect(draftProblems(draftOf(itemFromInput(input, 'id', 1, 's', EXAM)))).toEqual([]);
  });

  it('the syntax help names every mark', () => {
    expect(TEXT_SYNTAX.map((entry) => entry.mark.trim())).toEqual(['#', '!', '---', '===', '+', '-', '=', '>', '[обложка]', '[картинка]', '[видео](https://…)']);
  });
});

describe('problems: the line and what to do', () => {
  const problemsOf = (text: string, doc: TestDoc = emptyDoc('Т')) => fromText(text, doc, [], { random: seeded(), importId: 'imp' }).problems;
  const long = (n: number) => 'я'.repeat(n);

  it.each([
    ['Вопрос\n- а\n- б', 2, 'у вопроса нет верного варианта. Отметьте его «+».'],
    ['+ а\n- б', 1, 'у вопроса нет текста. Напишите его перед вариантами.'],
    ['Вопрос\n+ а', 2, 'у вопроса один вариант. Добавьте ещё хотя бы один.'],
    [`Вопрос\n+ 1\n${Array.from({ length: 8 }, (_, at) => `- ${at + 2}`).join('\n')}`, 10, 'вариантов больше 8. Оставьте не больше восьми.'],
    ['Вопрос\n+ а\n- б\n-', 4, 'пустой вариант. Напишите его или удалите строку.'],
    [`Вопрос\n+ а\n- ${long(601)}`, 3, 'вариант длиннее 600 знаков. Сократите его.'],
    [`Вопрос\n+ ${long(600)}\n${Array.from({ length: 7 }, () => `- ${long(600)}`).join('\n')}`, 2, 'варианты вместе слишком длинные. Сократите их.'],
    ['Вопрос\n=', 2, 'после «=» напишите верный ответ.'],
    ['Вопрос\n= 1; 2; 3; 4; 5; 6; 7; 8; 9; 10; 11', 2, 'верных ответов больше 10. Оставьте не больше десяти.'],
    [`Вопрос\n= ${long(201)}`, 2, 'ответ длиннее 200 знаков. Сократите его.'],
    [`Вопрос\n+ а\n- б\n> ${long(2001)}`, 4, 'пояснение длиннее 2000 знаков. Сократите его.'],
    [`${long(4001)}\n+ а\n- б`, 1, 'вопрос длиннее 4000 знаков. Сократите его.'],
    ['Вопрос\n+ а\n- б\n= в', 4, 'у вопроса и варианты, и ответ «=». Оставьте что-то одно.'],
    ['> пояснение', 1, 'пояснение «>» ставят сразу после вариантов вопроса. Перенесите его или уберите «>».'],
    ['#', 1, 'пустой заголовок. Допишите его или удалите строку.'],
    [`# ${long(201)}`, 1, 'заголовок длиннее 200 знаков. Сократите его.'],
    [long(4001), 1, 'текст длиннее 4000 знаков. Разделите его пустой строкой.'],
    ['\\', 1, 'пустой текст. Удалите эту строку.'],
    ['!важно', 1, 'пустая заметка. Допишите её или удалите строку.'],
    [`! ${long(4001)}`, 1, 'заметка длиннее 4000 знаков. Сократите её.'],
    ['[обложка]', 1, 'у обложки нет названия. Напишите его после «[обложка]».'],
    [`[обложка] ${long(201)}`, 1, 'название на обложке длиннее 200 знаков. Сократите его.'],
    [`[обложка] Т\n${long(301)}`, 2, 'подзаголовок обложки длиннее 300 знаков. Сократите его.'],
    [`=== ${long(201)}`, 1, 'название страницы длиннее 200 знаков. Сократите его.'],
    ['[видео] https://youtu.be/dQw4w9WgXcQ', 1, 'ссылку на видео пишут в скобках сразу после метки: [видео](https://…).'],
    ['[видео](https://vimeo.com/1)', 1, 'это не ссылка на видео YouTube, RuTube или VK Видео. Проверьте адрес.'],
    ['[видео]()', 1, 'это не ссылка на видео YouTube, RuTube или VK Видео. Проверьте адрес.'],
    [`[видео](https://youtu.be/dQw4w9WgXcQ) ${long(301)}`, 1, 'подпись видео длиннее 300 знаков. Сократите её.'],
  ])('%#: line %i', (text, line, words) => {
    expect(problemsOf(text)).toEqual([{ line, message: `Строка ${line}: ${words}` }]);
  });

  it('a caption too long on a picture of the page', () => {
    const page: TestDoc = { ...emptyDoc('Т'), blocks: [{ type: 'image', id: 'image0000001', path: PIC, caption: '', width: 'wide' }] };
    expect(problemsOf(`[картинка] ${long(301)}`, page)).toEqual([{ line: 1, message: 'Строка 1: подпись картинки длиннее 300 знаков. Сократите её.' }]);
  });

  it('more than 400 blocks', () => {
    const text = Array.from({ length: 401 }, () => '---').join('\n\n');
    expect(problemsOf(text)).toEqual([{ line: 801, message: 'Строка 801: блоков больше 400. Уберите лишние.' }]);
  });

  it('problems in line order; questions left as they were are not checked again', () => {
    const page: TestDoc = { ...emptyDoc('Т'), blocks: [q(Q4), q(Q5)] };
    const text = `${toText(page, [Q4, Q5])}\n#\n\nНовый\n- а\n- б\n`;
    expect(fromText(text, page, [Q4, Q5], { importId: 'imp' }).problems.map((problem) => problem.line)).toEqual([8, 11]);
  });
});
