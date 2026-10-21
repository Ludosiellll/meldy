import { describe, expect, it } from 'vitest';
import { PICTURE_STEM, type TestItem } from '../../types/container';
import type { DocBlock, TestDoc } from '../../types/testDoc';
import { applyFix, checkTest, DRAFT_WORDS, draftTitle, isDraftQuestion, isTrueFalse, numberForms, orderBound, type Fix, type Hint } from './checker';
import { readableAccent } from './contrast';
import { emptyDoc } from './doc';

let made = 0;
function row(partial: Partial<TestItem> = {}): TestItem {
  made += 1;
  return {
    id: `item-${made}`,
    container_id: 'c',
    subject_id: 's',
    position: made,
    file_no: String(made),
    topic: null,
    kind: 'single',
    stem: `Вопрос номер ${made}`,
    options: ['Первый', 'Второй', 'Третий', 'Четвёртый'],
    correct: [made % 4],
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

const question = (item: Pick<TestItem, 'id'>, id = `b-${item.id}`): DocBlock => ({ type: 'question', id, item_id: item.id, points: 1, required: false });
function pageOf(items: readonly TestItem[], more: Partial<TestDoc> = {}): TestDoc {
  return { ...emptyDoc('Тест'), blocks: items.map((item) => question(item)), ...more };
}
const ids = (hints: readonly Hint[]) => hints.map((hint) => hint.id);

describe('checkTest', () => {
  it('a sound test has nothing to say', () => {
    const items = [row(), row(), row({ kind: 'short', options: [], correct: [], answers: ['Москва', 'г. Москва'] }), row({ kind: 'multiple', correct: [0, 2] })];
    expect(checkTest(pageOf(items), items)).toEqual([]);
  });

  it('a question block whose row is gone', () => {
    const doc: TestDoc = { ...emptyDoc('Т'), blocks: [question({ id: 'gone' }, 'block1')] };
    expect(checkTest(doc, [])).toEqual([
      { id: 'gone:block1', blockId: 'block1', level: 'fix', message: 'Вопрос этого блока удалён — уберите блок.', fix: { kind: 'remove_block', blockId: 'block1' } },
    ]);
  });

  it('no words in the question', () => {
    const picture = row({ stem: PICTURE_STEM });
    const pictured = row({ stem: PICTURE_STEM, images: { stem: ['c/abc.png'] } });
    const blank = row({ stem: '  ' });
    const hints = checkTest(pageOf([picture, pictured, blank]), [picture, pictured, blank]);
    expect(ids(hints)).toEqual([`no_stem:${picture.id}`, `no_stem:${blank.id}`]);
    expect(hints[0].message).toBe('Вопрос 1: нет текста — напишите его.');
  });

  it('no key', () => {
    const single = row({ correct: [] });
    const short = row({ kind: 'short', options: [], correct: [], answers: [] });
    const hints = checkTest(pageOf([single, short]), [single, short]);
    expect(hints.map((hint) => [hint.id, hint.message, hint.blockId, hint.itemId])).toEqual([
      [`no_key:${single.id}`, 'Вопрос 1: нет верного ответа — отметьте его.', `b-${single.id}`, single.id],
      [`no_key:${short.id}`, 'Вопрос 2: нет верного ответа — впишите его.', `b-${short.id}`, short.id],
    ]);
  });

  it('the same option twice: drops the unticked one; no fix when only two are left', () => {
    const later = row({ options: ['Париж', 'Лондон', ' париж.', 'Рим'], correct: [0] });
    const ticked = row({ options: ['Париж', 'Лондон', 'ПАРИЖ'], correct: [2] });
    const two = row({ options: ['Да', 'да'], correct: [0] });
    const pictures = row({ options: ['Рисунок А', 'Рисунок А', '.', '.'], correct: [0] });
    const hints = checkTest(pageOf([later, ticked, two, pictures]), [later, ticked, two, pictures]);
    expect(hints.map((hint) => [hint.id, hint.fix])).toEqual([
      [`same_option:${later.id}:2`, { kind: 'drop_option', itemId: later.id, index: 2 }],
      [`same_option:${ticked.id}:2`, { kind: 'drop_option', itemId: ticked.id, index: 0 }],
      [`same_option:${two.id}:1`, undefined],
    ]);
    expect(hints[0].message).toBe('Вопрос 1: вариант «париж.» повторяется — уберите лишний.');
  });

  it.each(['Все перечисленные', 'всё вышеперечисленное', 'Нет верного ответа', 'А и Б', 'а, б и в', 'Оба варианта', 'Ни один из них', 'Все ответы верны', 'Первый и второй'])(
    '«%s» with shuffling: keep the order',
    (words) => {
      const item = row({ options: ['Один', 'Два', words], correct: [2] });
      const [hint] = checkTest(pageOf([item]), [item]);
      expect(hint).toMatchObject({ id: `order:${item.id}`, level: 'fix', fix: { kind: 'keep_order', itemId: item.id } });
      expect(hint.message).toContain('закрепите порядок');
      expect(checkTest(pageOf([{ ...item, keep_order: true }]), [{ ...item, keep_order: true }])).toEqual([]);
    },
  );

  it('«верно / неверно» and «да / нет» without a fixed order', () => {
    const yes = row({ options: ['Да', 'Нет'], correct: [0] });
    const right = row({ options: ['Неверно', 'Верно'], correct: [1] });
    const fixed = row({ options: ['Верно', 'Неверно'], correct: [0], keep_order: true });
    const hints = checkTest(pageOf([yes, right, fixed]), [yes, right, fixed]);
    expect(ids(hints)).toEqual([`true_false:${yes.id}`, `true_false:${right.id}`]);
    expect(hints[1].message).toBe('Вопрос 2: варианты «Неверно» и «Верно» лучше не перемешивать — закрепите их порядок.');
  });

  it('a short answer whose only form is a number', () => {
    const comma = row({ kind: 'short', options: [], correct: [], answers: ['12,5'] });
    const unit = row({ kind: 'short', options: [], correct: [], answers: ['3.5 кг'] });
    const year = row({ kind: 'short', options: [], correct: [], answers: ['1945'] });
    const two = row({ kind: 'short', options: [], correct: [], answers: ['2', 'два'] });
    const words = row({ kind: 'short', options: [], correct: [], answers: ['Москва'] });
    const hints = checkTest(pageOf([comma, unit, year, two, words]), [comma, unit, year, two, words]);
    expect(hints.map((hint) => [hint.id, hint.level, hint.message, hint.fix])).toEqual([
      [`short_number:${comma.id}`, 'think', 'Вопрос 1: единственный ответ «12,5» — число. Добавьте и другую запись: «12.5».', { kind: 'add_forms', itemId: comma.id, forms: ['12.5'] }],
      [
        `short_number:${unit.id}`,
        'think',
        'Вопрос 2: единственный ответ «3.5 кг» — число. Добавьте и другие записи: «3,5 кг», «3.5».',
        { kind: 'add_forms', itemId: unit.id, forms: ['3,5 кг', '3.5'] },
      ],
      [`short_number:${year.id}`, 'think', 'Вопрос 3: единственный ответ «1945» — число. Подумайте, как ещё его могут записать, и добавьте эти записи.', undefined],
    ]);
  });

  it('a repeated question: the same one is a problem, the same words with other options a thought', () => {
    const first = row({ stem: 'Столица Франции?', options: ['Париж', 'Лондон'], correct: [0] });
    const twin = row({ stem: '  столица  франции? ', options: ['лондон', 'ПАРИЖ'], correct: [1] });
    const cousin = row({ stem: 'Столица Франции?', options: ['Париж', 'Рим'], correct: [0] });
    const shortTwin = row({ stem: 'Столица Франции?', kind: 'short', options: [], correct: [], answers: ['Париж'] });
    const picA = row({ stem: PICTURE_STEM, images: { stem: ['a'] } });
    const picB = row({ stem: PICTURE_STEM, images: { stem: ['b'] } });
    const items = [first, twin, cousin, shortTwin, picA, picB];
    const hints = checkTest(pageOf(items), items);
    expect(hints.map((hint) => [hint.id, hint.level, hint.message, hint.fix])).toEqual([
      [`repeat:${twin.id}`, 'fix', 'Вопрос 2: повторяет вопрос 1 — удалите повтор.', { kind: 'delete_question', itemId: twin.id, blockId: `b-${twin.id}` }],
      [`repeat:${cousin.id}`, 'think', 'Вопрос 3: такой же текст у вопроса 1 — проверьте, не повтор ли это.', undefined],
      [`repeat:${shortTwin.id}`, 'think', 'Вопрос 4: такой же текст у вопроса 1 — проверьте, не повтор ли это.', undefined],
    ]);
  });

  it('two short answers with the same words and forms are a repeat too', () => {
    const one = row({ stem: 'Столица России?', kind: 'short', options: [], correct: [], answers: ['Москва', 'г. Москва'] });
    const two = row({ stem: 'Столица России?', kind: 'short', options: [], correct: [], answers: ['г. москва', 'МОСКВА'] });
    expect(checkTest(pageOf([one, two]), [one, two]).map((hint) => [hint.id, hint.level])).toEqual([[`repeat:${two.id}`, 'fix']]);
  });

  it('two hints of one question keep the order they were found in', () => {
    const item = row({ options: ['Один', 'Один', 'Два'], correct: [] });
    expect(ids(checkTest(pageOf([item]), [item]))).toEqual([`no_key:${item.id}`, `same_option:${item.id}:1`]);
  });

  it('the right option is clearly the longest in most questions', () => {
    const long = (correct: number) =>
      row({ options: ['Да', 'Нет', 'Иногда'].map((option, at) => (at === correct ? 'Только при нормальном давлении и температуре' : option)), correct: [correct] });
    const even = () => row({ options: ['Красный', 'Зелёный', 'Синий'], correct: [1] });
    const most = [long(0), long(1), long(2), even()];
    const [hint] = checkTest(pageOf(most), most);
    expect(hint).toEqual({ id: 'longest', level: 'think', message: 'Верный ответ — самый длинный в 3 из 4 вопросов: его можно угадать по длине. Допишите неверные варианты.' });
    const half = [long(0), long(1), even(), even()];
    expect(checkTest(pageOf(half), half)).toEqual([]);
    const few = [long(0), long(1), long(2)];
    expect(checkTest(pageOf(few), few)).toEqual([]);
    const pictures = [long(0), long(1), long(2), row({ options: ['Рисунок А', 'Рисунок Б', 'Рисунок В'], correct: [0] })];
    expect(checkTest(pageOf(pictures), pictures)).toEqual([]);
    // A key past the options (a broken row) is never «the longest».
    const broken = [long(0), long(1), row({ options: ['Да', 'Нет', 'Иногда'], correct: [7] }), even()];
    expect(checkTest(pageOf(broken), broken)).toEqual([]);
  });

  it('the key under one letter in most of 8 questions or more', () => {
    const under = (key: number) => row({ correct: [key] });
    const most = [1, 1, 1, 1, 1, 0, 2, 3].map(under);
    expect(checkTest(pageOf(most), most)).toEqual([
      { id: 'letter', level: 'think', message: 'Верный ответ почти всегда под буквой «Б» — в 5 из 8 вопросов. Поменяйте варианты местами.' },
    ]);
    const half = [1, 1, 1, 1, 0, 0, 2, 3].map(under);
    expect(checkTest(pageOf(half), half)).toEqual([]);
    const seven = [1, 1, 1, 1, 1, 1, 1].map(under);
    expect(checkTest(pageOf(seven), seven)).toEqual([]);
    const withTrueFalse = [...[1, 1, 1, 1, 1].map(under), ...[0, 0, 0].map(() => row({ options: ['Верно', 'Неверно'], correct: [0], keep_order: true }))];
    expect(checkTest(pageOf(withTrueFalse), withTrueFalse)).toEqual([]);
  });

  it('an empty page of the «по страницам» layout', () => {
    const item = row();
    const blocks: DocBlock[] = [
      { type: 'page', id: 'page1', title: '' },
      question(item),
      { type: 'page', id: 'page2', title: '' },
      { type: 'page', id: 'page3', title: '' },
    ];
    const hints = checkTest({ ...emptyDoc('Т'), layout: 'pages', blocks }, [item]);
    expect(hints.map((hint) => [hint.id, hint.fix])).toEqual([
      ['empty_page:page2', { kind: 'remove_block', blockId: 'page2' }],
      ['empty_page:page3', { kind: 'remove_block', blockId: 'page3' }],
    ]);
    expect(checkTest({ ...emptyDoc('Т'), layout: 'one_page', blocks }, [item])).toEqual([]);
  });

  it('a custom colour too light for white text', () => {
    const doc: TestDoc = { ...emptyDoc('Т'), theme: { ...emptyDoc('Т').theme, accent: { custom: '#ffee00' } } };
    expect(checkTest(doc, [])).toEqual([
      {
        id: 'contrast',
        level: 'fix',
        message: 'Свой цвет слишком светлый: белый текст на кнопках читается плохо. Возьмите чуть темнее.',
        fix: { kind: 'theme_accent', value: { custom: readableAccent('#ffee00', '#ffffff').color } },
      },
    ]);
    expect(checkTest({ ...doc, theme: { ...doc.theme, accent: { custom: '#1f7a3d' } } }, [])).toEqual([]);
  });

  it('problems first, each group in page order, the whole-test hints last; plain words', () => {
    const keyless = row({ correct: [] });
    const shortNumber = row({ kind: 'short', options: [], correct: [], answers: ['7'] });
    const dup = row({ options: ['Один', 'Один', 'Два'], correct: [2] });
    const sameLetter = Array.from({ length: 8 }, () => row({ correct: [3] }));
    const items = [shortNumber, keyless, dup, ...sameLetter];
    const doc: TestDoc = { ...pageOf(items), blocks: [question({ id: 'gone' }, 'goneblock'), ...items.map((item) => question(item))], theme: { ...emptyDoc('Т').theme, accent: { custom: '#ffffff' } } };
    const hints = checkTest(doc, items);
    expect(ids(hints)).toEqual(['gone:goneblock', `no_key:${keyless.id}`, `same_option:${dup.id}:1`, 'contrast', `short_number:${shortNumber.id}`, 'letter']);
    for (const hint of hints) {
      expect(hint.message).not.toMatch(/!/);
      expect('at' in hint).toBe(false);
    }
  });
});

describe('helpers', () => {
  it('orderBound finds the option that points at others', () => {
    expect(orderBound(['Один', 'Все перечисленные'])).toBe(1);
    expect(orderBound(['Один', 'Два'])).toBe(-1);
    expect(orderBound(['Всего два'])).toBe(-1);
  });

  it('isTrueFalse: two options, either order, any case', () => {
    expect(isTrueFalse(['ВЕРНО', 'неверно'])).toBe(true);
    expect(isTrueFalse(['Ложь', 'Правда'])).toBe(true);
    expect(isTrueFalse(['Истина', 'Ложь'])).toBe(true);
    expect(isTrueFalse(['Да', 'Нет', 'Не знаю'])).toBe(false);
    expect(isTrueFalse(['Да', 'Верно'])).toBe(false);
  });

  it('numberForms: comma and point, the number without its unit, nothing repeated', () => {
    expect(numberForms('0,75')).toEqual(['0.75']);
    expect(numberForms('-2.5 м')).toEqual(['-2,5 м', '-2.5']);
    expect(numberForms('25 %')).toEqual(['25']);
    expect(numberForms('1945')).toEqual([]);
    expect(numberForms('100.')).toEqual([]);
    expect(numberForms(' 1,5 кг ')).toEqual(['1.5 кг', '1,5']);
  });
});

describe('applyFix', () => {
  const item = row({ id: 'x', options: ['Париж', 'Лондон', 'Париж', 'Рим'], correct: [2], images: { stem: [], options: [['p1'], [], ['p3'], []] } });
  const short = row({ id: 'y', kind: 'short', options: [], correct: [], answers: ['12,5'] });
  const doc = pageOf([item, short], { blocks: [question(item, 'bx'), question(short, 'by'), { type: 'page', id: 'pg', title: '' }] });
  const items = [item, short];
  const none = (fix: Fix) => expect(applyFix(fix, doc, items)).toEqual({ doc, updates: [], removes: [] });

  it('keep_order patches the row once', () => {
    expect(applyFix({ kind: 'keep_order', itemId: 'x' }, doc, items)).toEqual({ doc, updates: [{ id: 'x', patch: { keep_order: true } }], removes: [] });
    expect(applyFix({ kind: 'keep_order', itemId: 'x' }, doc, [{ ...item, keep_order: true }]).updates).toEqual([]);
    none({ kind: 'keep_order', itemId: 'nope' });
  });

  it('drop_option takes the option with its tick and picture', () => {
    const { updates } = applyFix({ kind: 'drop_option', itemId: 'x', index: 0 }, doc, items);
    expect(updates).toEqual([{ id: 'x', patch: { options: ['Лондон', 'Париж', 'Рим'], correct: [1], images: { stem: [], options: [[], ['p3'], []] } } }]);
    none({ kind: 'drop_option', itemId: 'x', index: 9 });
    none({ kind: 'drop_option', itemId: 'x', index: -1 });
    none({ kind: 'drop_option', itemId: 'y', index: 0 });
  });

  it('add_forms adds the new forms only, up to ten', () => {
    expect(applyFix({ kind: 'add_forms', itemId: 'y', forms: ['12.5', '12,5', '', '12.5', 'двенадцать с половиной'] }, doc, items).updates).toEqual([
      { id: 'y', patch: { answers: ['12,5', '12.5', 'двенадцать с половиной'] } },
    ]);
    const nine = { ...short, answers: Array.from({ length: 9 }, (_, at) => String(at)) };
    expect(applyFix({ kind: 'add_forms', itemId: 'y', forms: ['a', 'b'] }, doc, [item, nine]).updates[0].patch.answers).toHaveLength(10);
    none({ kind: 'add_forms', itemId: 'y', forms: ['12,5'] });
    none({ kind: 'add_forms', itemId: 'x', forms: ['новое'] });
  });

  it('delete_question deletes the row and takes the block off the page', () => {
    const result = applyFix({ kind: 'delete_question', itemId: 'x', blockId: 'bx' }, doc, items);
    expect(result.removes).toEqual(['x']);
    expect(result.doc.blocks.map((block) => block.id)).toEqual(['by', 'pg']);
    none({ kind: 'delete_question', itemId: 'nope', blockId: 'bx' });
  });

  it('remove_block and theme_accent change the page only', () => {
    expect(applyFix({ kind: 'remove_block', blockId: 'pg' }, doc, items).doc.blocks).toHaveLength(2);
    expect(applyFix({ kind: 'theme_accent', value: { custom: '#123456' } }, doc, items)).toEqual({
      doc: { ...doc, theme: { ...doc.theme, accent: { custom: '#123456' } } },
      updates: [],
      removes: [],
    });
  });
});

describe('the studio’s own checks (release 47.2)', () => {
  it('the kind does not fit the key: «несколько ответов» with one tick, or words that ask for all in a one-answer question', () => {
    const one = row({ kind: 'multiple', correct: [1] });
    const asks = row({ stem: 'Какие из этих металлов щелочные? Отметьте все верные.', correct: [0] });
    const fine = row({ kind: 'multiple', correct: [0, 1] });
    const tf = row({ kind: 'multiple', options: ['Верно', 'Неверно'], correct: [0], keep_order: true });
    const items = [one, asks, fine, tf];
    const hints = checkTest(pageOf(items), items).filter((hint) => hint.id.startsWith('kind:'));
    expect(hints.map((hint) => [hint.id, hint.level, hint.fix])).toEqual([
      [`kind:${one.id}`, 'think', { kind: 'set_kind', itemId: one.id, value: 'single' }],
      [`kind:${asks.id}`, 'think', { kind: 'set_kind', itemId: asks.id, value: 'multiple' }],
    ]);
    expect(hints[0].message).toBe(
      'Вопрос 1: выбран тип «несколько ответов», а верный отмечен один — участник будет искать второй. Отметьте остальные верные или сделайте вопрос с одним ответом.',
    );
    expect(hints[1].message).toMatch(/^Вопрос 2: в тексте просят отметить все верные/);
  });

  it('set_kind patches the kind once, and only when it still does not fit', () => {
    const one = row({ id: 'm1', kind: 'multiple', correct: [1] });
    const doc = pageOf([one]);
    expect(applyFix({ kind: 'set_kind', itemId: 'm1', value: 'single' }, doc, [one])).toEqual({ doc, updates: [{ id: 'm1', patch: { kind: 'single' } }], removes: [] });
    expect(applyFix({ kind: 'set_kind', itemId: 'm1', value: 'single' }, doc, [{ ...one, correct: [0, 1] }]).updates).toEqual([]);
    expect(applyFix({ kind: 'set_kind', itemId: 'm1', value: 'multiple' }, doc, [{ ...one, kind: 'single' }]).updates).toEqual([{ id: 'm1', patch: { kind: 'multiple' } }]);
    expect(applyFix({ kind: 'set_kind', itemId: 'm1', value: 'multiple' }, doc, [one]).updates).toEqual([]);
  });

  it('a question still holding the palette’s words is a problem', () => {
    const stem = row({ stem: DRAFT_WORDS.stem });
    const options = row({ options: [DRAFT_WORDS.option(1), DRAFT_WORDS.option(2), DRAFT_WORDS.option(3)] });
    const form = row({ kind: 'short', options: [], correct: [], answers: [DRAFT_WORDS.form] });
    const statement = row({ stem: DRAFT_WORDS.statement, options: ['Верно', 'Неверно'], keep_order: true });
    const items = [stem, options, form, statement];
    const hints = checkTest(pageOf(items), items).filter((hint) => hint.id.startsWith('draft:'));
    expect(hints.map((hint) => [hint.id, hint.level])).toEqual(items.map((item) => [`draft:${item.id}`, 'fix']));
    expect(hints[2].message).toBe('Вопрос 3: это заготовка — напишите вопрос и принятые ответы.');
    const unkeyed = row({ stem: DRAFT_WORDS.stem, correct: [] });
    expect(checkTest(pageOf([unkeyed]), [unkeyed]).map((hint) => [hint.id, hint.message])).toEqual([
      [`draft:${unkeyed.id}`, 'Вопрос 1: это заготовка — напишите вопрос и варианты ответа, отметьте верный.'],
    ]);
    expect(isDraftQuestion(row({ options: ['Вариант 1', 'Медь'] }))).toBe(false);
    expect(isDraftQuestion(row({ kind: 'short', options: [], answers: ['ответ', 'другой'] }))).toBe(false);
  });

  it('a title nobody wrote: empty, «Контрольная · …», «Новый тест», and a cover still called «Название теста»', () => {
    expect(['', '  ', 'Контрольная · 18 октября', 'Контрольная\u00a0· 1', 'Новый тест', 'Название теста'].map(draftTitle)).toEqual([true, true, true, true, true, true]);
    expect(['Химия, 8 класс', 'Контрольная по химии'].map(draftTitle)).toEqual([false, false]);
    const doc: TestDoc = {
      ...emptyDoc('Т'),
      title: 'Контрольная · 18 октября',
      blocks: [
        { type: 'cover', id: 'cover1', title: 'Название теста', subtitle: '', image: null, align: 'center' },
        { type: 'cover', id: 'cover2', title: 'Кислоты и основания', subtitle: '', image: null, align: 'center' },
      ],
    };
    const hints = checkTest(doc, []);
    // Covers and no question: the page cannot be sent, and that comes first (UX audit of 21.10).
    expect(hints.map((hint) => [hint.id, hint.level, hint.blockId])).toEqual([
      ['no_keyed', 'fix', undefined],
      ['title', 'think', undefined],
      ['cover_title:cover1', 'think', 'cover1'],
    ]);
    expect(hints[1].message).toMatch(/^Название теста «Контрольная · 18 октября» — черновое/);
    expect(checkTest({ ...doc, title: ' ', blocks: [] }, [])[0].message).toBe('У теста нет названия. Назовите его в настройках страницы.');
  });
});

describe('a picture or a video block still empty (live check of 47.4: it vanished after a reload, unsaid)', () => {
  it('is named as not saved, with «Показать» and a press that takes it off', () => {
    const doc: TestDoc = {
      ...emptyDoc('Тест'),
      blocks: [
        { type: 'image', id: 'img000000001', path: '', caption: '', width: 'wide' },
        { type: 'video', id: 'video0000001', url: '', caption: '' } as DocBlock,
        { type: 'video', id: 'video0000002', url: 'https://youtu.be/dQw4w9WgXcQ', caption: '' } as DocBlock,
      ],
    };
    const found = checkTest(doc, []).filter((hint) => hint.id.startsWith('unfinished:'));
    expect(found.map((hint) => [hint.blockId, hint.level, hint.fix])).toEqual([
      ['img000000001', 'fix', { kind: 'remove_block', blockId: 'img000000001' }],
      ['video0000001', 'fix', { kind: 'remove_block', blockId: 'video0000001' }],
    ]);
    expect(found[0].message).toBe('Блок «Картинка» без картинки не сохраняется — загрузите её или уберите блок.');
    expect(found[1].message).toBe('Блок «Видео» без ссылки не сохраняется — вставьте ссылку или уберите блок.');
    expect(applyFix(found[0].fix as Fix, doc, []).doc.blocks.map((block) => block.id)).toEqual(['video0000001', 'video0000002']);
  });
});
