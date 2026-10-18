/**
 * Starters for an empty test (plan «Doc library», templates; spec §47.6 «Подсказки»): four ready pages — контрольная по
 * теме, викторина, входной тест, самопроверка — each with its theme, layout, result screen and 5–8 sample questions on
 * a neutral topic. The questions are new rows (ItemInput made by the question editor's own rules, so each is one the
 * editor would save); their blocks hold the import ref until container_items_add answers and doc.ts bindRefs puts the
 * ids in — the same way as the text view's new questions. Also the four ready themes of «Оформление».
 */
import type { ItemInput, TestItem } from '../../types/container';
import { TEST_DOC_VERSION, type DocBlock, type DocTheme, type ResultBand, type TestDoc } from '../../types/testDoc';
import { emptyDraft, inputOf, type Draft } from '../../components/containers/keys/editorModel';
import { isTrueFalse, orderBound } from './checker';
import { cryptoFill, cut, freshId, newId, oneLine, type BlockBody, type RandomFill } from './doc';

export type TemplateId = 'topic_check' | 'quiz' | 'entry' | 'self_check';

export interface Sample {
  stem: string;
  /** Options in order; absent — a short answer. */
  options?: string[];
  /** Ticked options (indices). */
  right?: number[];
  /** A short answer's accepted forms. */
  forms?: string[];
  explanation?: string;
}

type Spec = BlockBody | { question: number; points?: number; required?: boolean };

interface Template {
  id: TemplateId;
  title: string;
  /** One line under the title on the empty canvas. */
  lead: string;
  /** The page's title when the exam's own is not given. */
  docTitle: string;
  theme: DocTheme;
  layout: TestDoc['layout'];
  samples: Sample[];
  blocks: (title: string) => Spec[];
  bands: ResultBand[];
}

const TRUE_FALSE = ['Верно', 'Неверно'];
const band = (from: number, to: number, title: string, text: string): ResultBand => ({ from, to, title, text, image: null });

const DEFINITIONS: readonly Template[] = [
  {
    id: 'topic_check',
    title: 'Контрольная по теме',
    lead: 'Все вопросы на одной странице, обязательные ответы и итог по баллам.',
    docTitle: 'Солнечная система',
    theme: { accent: 'blue', background: { kind: 'plain' }, font: 'onest', radius: 'soft', density: 'compact', answers: 'list', buttons: 'pill' },
    layout: 'one_page',
    samples: [
      { stem: 'Какая планета ближе всего к Солнцу?', options: ['Венера', 'Меркурий', 'Марс', 'Земля'], right: [1] },
      { stem: 'Какая планета самая большая в Солнечной системе?', options: ['Сатурн', 'Нептун', 'Юпитер', 'Земля'], right: [2] },
      { stem: 'Какие из этих планет относятся к планетам земной группы? Отметьте все верные.', options: ['Венера', 'Юпитер', 'Марс', 'Уран'], right: [0, 2] },
      { stem: 'Сколько планет в Солнечной системе? Напишите число.', forms: ['8', 'восемь'] },
      { stem: 'Луна — естественный спутник Земли.', options: TRUE_FALSE, right: [0] },
      {
        stem: 'За какое время Земля делает один оборот вокруг Солнца?',
        options: ['Примерно за сутки', 'Примерно за месяц', 'Примерно за год', 'Примерно за десять лет'],
        right: [2],
      },
    ],
    blocks: (title) => [
      { type: 'cover', title, subtitle: 'Контрольная по теме', image: null, align: 'center' },
      { type: 'note', tone: 'info', text: 'Ответьте на все вопросы и нажмите «Отправить». Где верных ответов несколько, это сказано в вопросе.' },
      { question: 0, required: true },
      { question: 1, required: true },
      { question: 2, points: 2, required: true },
      { question: 3, required: true },
      { question: 4, required: true },
      { question: 5, required: true },
    ],
    bands: [
      band(0, 49, 'Тему стоит повторить', 'Перечитайте конспект и попробуйте ещё раз.'),
      band(50, 84, 'Хороший результат', 'Посмотрите разбор: ошибок немного.'),
      band(85, 100, 'Отлично', 'Тема усвоена.'),
    ],
  },
  {
    id: 'quiz',
    title: 'Викторина',
    lead: 'По одному вопросу на экране, яркое оформление и ответы плиткой.',
    docTitle: 'Вокруг света',
    theme: { accent: 'orange', background: { kind: 'soft', tone: 'orange' }, font: 'onest', radius: 'round', density: 'airy', answers: 'grid', buttons: 'pill' },
    layout: 'one_by_one',
    samples: [
      { stem: 'Какой город — столица Австралии?', options: ['Сидней', 'Мельбурн', 'Канберра', 'Перт'], right: [2] },
      { stem: 'Какая река самая длинная в Европе?', options: ['Дунай', 'Волга', 'Рейн', 'Днепр'], right: [1] },
      { stem: 'Какое озеро самое глубокое в мире?', options: ['Байкал', 'Виктория', 'Танганьика', 'Онтарио'], right: [0] },
      { stem: 'На каком материке находится Кения?', options: ['Азия', 'Европа', 'Южная Америка', 'Африка'], right: [3] },
      { stem: 'Какой океан самый большой по площади?', options: ['Атлантический', 'Тихий', 'Индийский', 'Северный Ледовитый'], right: [1] },
      { stem: 'Какие из этих стран находятся в Южной Америке? Отметьте все верные.', options: ['Бразилия', 'Мексика', 'Аргентина', 'Испания', 'Чили'], right: [0, 2, 4] },
      { stem: 'Эверест — самая высокая гора Земли над уровнем моря.', options: TRUE_FALSE, right: [0] },
    ],
    blocks: (title) => [
      { type: 'cover', title, subtitle: 'Викторина о странах, реках и океанах', image: null, align: 'center' },
      { type: 'text', text: 'На экране — один вопрос. Выберите ответ, и откроется следующий.', align: 'center' },
      { question: 0 },
      { question: 1 },
      { question: 2 },
      { question: 3 },
      { question: 4 },
      { question: 5 },
      { question: 6 },
    ],
    bands: [
      band(0, 39, 'Есть куда расти', 'Загляните в разбор: там верные ответы.'),
      band(40, 79, 'Неплохо', 'Больше половины верно.'),
      band(80, 100, 'Знаток географии', 'Почти всё верно.'),
    ],
  },
  {
    id: 'entry',
    title: 'Входной тест',
    lead: 'Что человек уже знает до начала курса: разделы на отдельных страницах.',
    docTitle: 'Дроби и проценты',
    theme: { accent: 'green', background: { kind: 'plain' }, font: 'onest', radius: 'soft', density: 'airy', answers: 'list', buttons: 'rounded' },
    layout: 'pages',
    samples: [
      { stem: 'Чему равна сумма 1/2 + 1/4?', options: ['2/6', '3/4', '1/6', '2/4'], right: [1] },
      { stem: 'Какая дробь больше остальных?', options: ['3/5', '4/7', '2/3', '5/9'], right: [2] },
      { stem: 'Запишите дробь 3/4 десятичной дробью.', forms: ['0,75', '0.75'] },
      { stem: 'Сколько будет 10 % от 250?', options: ['25', '2,5', '10', '250'], right: [0] },
      { stem: 'Цена выросла с 200 до 250 рублей. На сколько процентов?', options: ['На 20 %', 'На 50 %', 'На 5 %', 'На 25 %'], right: [3] },
      { stem: 'Какие записи равны половине? Отметьте все верные.', options: ['0,5', '50 %', '1/2', '0,05'], right: [0, 1, 2] },
    ],
    blocks: (title) => [
      { type: 'cover', title, subtitle: 'Входной тест', image: null, align: 'left' },
      { type: 'text', text: 'Тест покажет, с чего начать. Если не уверены, выберите ответ, который кажется **самым верным**.', align: 'left' },
      { type: 'page', title: 'Дроби' },
      { question: 0 },
      { question: 1 },
      { question: 2 },
      { type: 'page', title: 'Проценты' },
      { question: 3 },
      { question: 4 },
      { question: 5 },
    ],
    bands: [
      band(0, 49, 'Начнём с основ', 'Курс начнётся с дробей и действий с ними.'),
      band(50, 79, 'Основы знакомы', 'Начните с процентов, дроби можно повторить по ходу.'),
      band(80, 100, 'Можно сразу к сложному', 'Основы вы знаете.'),
    ],
  },
  {
    id: 'self_check',
    title: 'Самопроверка',
    lead: 'Для себя: после каждого ответа — пояснение, без оценок.',
    docTitle: 'Трудные места орфографии',
    theme: { accent: 'violet', background: { kind: 'soft', tone: 'violet' }, font: 'serif', radius: 'round', density: 'airy', answers: 'list', buttons: 'rounded' },
    layout: 'one_by_one',
    samples: [
      {
        stem: 'Как правильно?',
        options: ['в течение дня', 'в течении дня', 'в теченье дня'],
        right: [0],
        explanation: 'Предлог «в течение» о времени пишется с «е» на конце: в течение дня, в течение недели.',
      },
      {
        stem: 'Как пишется предлог в сочетании «… на дождь»?',
        options: ['несмотря на дождь', 'не смотря на дождь'],
        right: [0],
        explanation: 'Предлог «несмотря на» пишется слитно: его можно заменить словом «вопреки». Раздельно пишут деепричастие: «шёл, не смотря под ноги».',
      },
      {
        stem: 'Напишите слово, вставив пропущенную букву: «изв…ните».',
        forms: ['извините'],
        explanation: 'Правильно: «извините». Проверочное слово — «вина».',
      },
      {
        stem: 'Слово «кофе» — мужского рода.',
        options: TRUE_FALSE,
        right: [0],
        explanation: 'По норме литературного языка «кофе» — мужского рода: «горячий кофе». Средний род допустим только в разговорной речи.',
      },
      {
        stem: 'В каких словах ударение падает на последний слог? Отметьте все верные.',
        options: ['звонит', 'документ', 'торты', 'кухонный'],
        right: [0, 1],
        explanation: 'Верно: звонИт, докумЕнт. В словах «тОрты» и «кУхонный» ударение на первом слоге.',
      },
      {
        stem: 'Какое сочетание верное?',
        options: ['надеть пальто', 'одеть пальто'],
        right: [0],
        explanation: 'Надевают что-то на себя: надеть пальто. Одевают кого-то: одеть ребёнка.',
      },
    ],
    blocks: (title) => [
      { type: 'cover', title, subtitle: 'Самопроверка с пояснениями', image: null, align: 'center' },
      { type: 'note', tone: 'tip', text: 'После каждого ответа откроется пояснение. Прочитайте его, даже если ответили верно.' },
      { question: 0 },
      { question: 1 },
      { question: 2 },
      { question: 3 },
      { question: 4 },
      { question: 5 },
    ],
    bands: [
      band(0, 59, 'Повторите правила', 'Вернитесь к вопросам с ошибками и прочитайте пояснения ещё раз.'),
      band(60, 100, 'Хорошо', 'Правила вы знаете. Проверьте себя ещё раз через пару дней.'),
    ],
  },
];

const BY_ID = new Map(DEFINITIONS.map((entry) => [entry.id, entry]));
const definition = (id: TemplateId) => BY_ID.get(id) as Template;

export interface StudioTemplate {
  id: TemplateId;
  title: string;
  lead: string;
  /** How many sample questions it brings. */
  questions: number;
}

/** The four starters for the empty canvas, in the order shown. */
export const TEMPLATES: readonly StudioTemplate[] = DEFINITIONS.map(({ id, title, lead, samples }) => ({ id, title, lead, questions: samples.length }));

/** The sample questions of a starter (for the preview and the tests). */
export function templateSamples(id: TemplateId): readonly Sample[] {
  return definition(id).samples;
}

/** A sample as a new row, made by the question editor's rules («верно / неверно» and «все перечисленные» keep their order). */
export function sampleInput(sample: Sample, fileNo: string, ref: string): ItemInput {
  const options = sample.options ?? [];
  const draft: Draft = {
    ...emptyDraft(),
    stem: sample.stem,
    short: sample.options === undefined,
    options: options.map((text) => ({ text, pictures: [] })),
    correct: [...(sample.right ?? [])],
    forms: (sample.forms ?? []).join('; '),
    explanation: sample.explanation ?? '',
    keepOrder: isTrueFalse(options) || orderBound(options) >= 0,
  };
  return inputOf(draft, fileNo, ref);
}

export interface TemplateOptions {
  /** The page's title (the exam's name); the starter's own topic when absent or empty. */
  title?: string;
  random?: RandomFill;
  /** The first part of the rows' refs; a fresh «tpl-…» by default. */
  importId?: string;
  /** The exam's rows, to number the new ones after them. */
  items?: readonly Pick<TestItem, 'file_no'>[];
}

/**
 * A starter as a document and its rows to add. The document's question blocks hold the refs of `adds` (in order):
 * add the rows, then doc.ts bindRefs(doc, response.items).
 */
export function templateDoc(id: TemplateId, options: TemplateOptions = {}): { doc: TestDoc; adds: ItemInput[] } {
  const template = definition(id);
  const random = options.random ?? cryptoFill;
  const importId = options.importId ?? `tpl-${newId(random)}`;
  let fileNo = 0;
  for (const item of options.items ?? []) if (/^\d+$/.test(item.file_no.trim())) fileNo = Math.max(fileNo, Number(item.file_no.trim()));
  const adds = template.samples.map((sample, at) => sampleInput(sample, String(fileNo + at + 1), `${importId}:${at + 1}`));
  const title = cut(oneLine(options.title ?? '').trim(), 200) || template.docTitle;
  const ids = new Set<string>();
  const blocks = template.blocks(title).map((spec): DocBlock => {
    const id = freshId(ids, random);
    if ('question' in spec) return { type: 'question', id, item_id: adds[spec.question].ref, points: spec.points ?? 1, required: spec.required ?? false };
    return { ...spec, id } as DocBlock;
  });
  const doc: TestDoc = {
    v: TEST_DOC_VERSION,
    title,
    theme: { ...template.theme, background: { ...template.theme.background } },
    layout: template.layout,
    blocks,
    results: { bands: template.bands.map((entry) => ({ ...entry })), cta: null },
  };
  return { doc, adds };
}

/** «Оформление»: four ready themes, one press each. */
export const READY_THEMES: ReadonlyArray<{ id: string; title: string; theme: DocTheme }> = [
  {
    id: 'calm',
    title: 'Спокойная',
    theme: { accent: 'blue', background: { kind: 'plain' }, font: 'onest', radius: 'soft', density: 'airy', answers: 'list', buttons: 'pill' },
  },
  {
    id: 'bright',
    title: 'Яркая',
    theme: { accent: 'orange', background: { kind: 'soft', tone: 'orange' }, font: 'onest', radius: 'round', density: 'airy', answers: 'grid', buttons: 'pill' },
  },
  {
    id: 'strict',
    title: 'Строгая',
    theme: { accent: 'graphite', background: { kind: 'plain' }, font: 'onest', radius: 'square', density: 'compact', answers: 'list', buttons: 'square' },
  },
  {
    id: 'book',
    title: 'Книжная',
    theme: { accent: 'violet', background: { kind: 'soft', tone: 'violet' }, font: 'serif', radius: 'soft', density: 'airy', answers: 'list', buttons: 'rounded' },
  },
];
