/**
 * What the reel shows. The example is the landing's own course (microeconomics, the ticket about
 * the bakery and the coffee shop) and the stage list of the app: 40 questions, 24 «есть»,
 * 7 «частично», 9 «нет» (lib/exams, sheetModel tests). No figures about users: only the product.
 */
import type { Coverage } from './parts';

export interface FloatingCard {
  kind: 'question' | 'file' | 'ticket';
  title: string;
  meta: string;
  x: number;
  y: number;
  scale: number;
  rotate: number;
  /** 0 = far (small, soft), 1 = middle (sharp), 2 = near (big, soft). */
  depth: 0 | 1 | 2;
}

/** The scattered materials of a session, around the question «С чего начать?». */
export const CHAOS_CARDS: FloatingCard[] = [
  { kind: 'question', title: 'Денежный мультипликатор', meta: 'Вопрос 14', x: 330, y: 200, scale: 0.95, rotate: -6, depth: 1 },
  { kind: 'file', title: 'Лекция 4.3 — Инфляция.pdf', meta: '38 страниц', x: 760, y: 150, scale: 0.72, rotate: 4, depth: 0 },
  { kind: 'ticket', title: 'Билет 7', meta: '3 вопроса', x: 1190, y: 175, scale: 0.86, rotate: -3, depth: 1 },
  { kind: 'question', title: 'Кривая Филлипса', meta: 'Вопрос 22', x: 1600, y: 225, scale: 1.04, rotate: 7, depth: 1 },
  { kind: 'file', title: 'Семинар 6 — задачи.pdf', meta: '12 страниц', x: 150, y: 540, scale: 0.78, rotate: 5, depth: 0 },
  { kind: 'file', title: 'Конспект_финал_2.docx', meta: 'изменён вчера', x: 1780, y: 580, scale: 0.82, rotate: -8, depth: 0 },
  { kind: 'question', title: 'ВВП и способы его расчёта', meta: 'Вопрос 3', x: 430, y: 880, scale: 1.08, rotate: -4, depth: 1 },
  { kind: 'file', title: 'Запись лекции 12.m4a', meta: '1 ч 24 мин', x: 930, y: 965, scale: 0.74, rotate: 6, depth: 0 },
  { kind: 'question', title: 'Монетарная политика ЦБ', meta: 'Вопрос 31', x: 1390, y: 890, scale: 1.0, rotate: -5, depth: 1 },
  { kind: 'ticket', title: 'Билет 19', meta: '3 вопроса', x: 1850, y: 800, scale: 1.32, rotate: 9, depth: 2 },
  { kind: 'question', title: 'Эластичность спроса', meta: 'Вопрос 8', x: 70, y: 770, scale: 1.36, rotate: -10, depth: 2 },
  { kind: 'file', title: 'Лекция 2 — Спрос.pdf', meta: '24 страницы', x: 600, y: 420, scale: 0.56, rotate: -2, depth: 0 },
  { kind: 'question', title: 'Излишек потребителя', meta: 'Вопрос 17', x: 1370, y: 410, scale: 0.6, rotate: 3, depth: 0 },
  { kind: 'question', title: 'Рыночное равновесие', meta: 'Вопрос 5', x: 985, y: 300, scale: 0.5, rotate: -6, depth: 0 },
  { kind: 'file', title: 'Список вопросов.docx', meta: '40 вопросов', x: 1890, y: 340, scale: 1.4, rotate: -12, depth: 2 },
  { kind: 'question', title: 'Внешние эффекты', meta: 'Вопрос 40', x: 50, y: 390, scale: 1.22, rotate: 8, depth: 2 },
  { kind: 'question', title: 'Совершенная конкуренция', meta: 'Вопрос 26', x: 760, y: 735, scale: 0.6, rotate: 5, depth: 0 },
  { kind: 'file', title: 'Лекция 7 — Деньги.pdf', meta: '31 страница', x: 1230, y: 730, scale: 0.64, rotate: -4, depth: 0 },
];

export interface SheetRow {
  title: string;
  status: Coverage;
}

/** The exam list of the ticket chapter: 40 questions, 24 «есть», 7 «частично», 9 «нет». */
export const SHEET_ROWS: SheetRow[] = [
  { title: 'Предмет и метод экономической теории', status: 'ok' },
  { title: 'Спрос и закон спроса', status: 'ok' },
  { title: 'Эластичность спроса и её виды', status: 'ok' },
  { title: 'Выручка и эластичность', status: 'ok' },
  { title: 'Предложение и его факторы', status: 'ok' },
  { title: 'Рыночное равновесие', status: 'half' },
  { title: 'Излишек потребителя', status: 'ok' },
  { title: 'Государство на рынке: налоги', status: 'no' },
  { title: 'Теория поведения потребителя', status: 'ok' },
  { title: 'Кривые безразличия', status: 'half' },
  { title: 'Бюджетное ограничение', status: 'ok' },
  { title: 'Производство и его факторы', status: 'ok' },
  { title: 'Издержки в краткосрочном периоде', status: 'ok' },
  { title: 'Издержки в долгосрочном периоде', status: 'no' },
  { title: 'Совершенная конкуренция', status: 'ok' },
  { title: 'Монополия', status: 'ok' },
  { title: 'Ценовая дискриминация', status: 'half' },
  { title: 'Олигополия', status: 'no' },
  { title: 'Монополистическая конкуренция', status: 'ok' },
  { title: 'Рынок труда', status: 'ok' },
  { title: 'Рынок капитала', status: 'no' },
  { title: 'Рынок земли и рента', status: 'no' },
  { title: 'Внешние эффекты', status: 'ok' },
  { title: 'Общественные блага', status: 'half' },
  { title: 'ВВП и способы его расчёта', status: 'ok' },
  { title: 'Номинальный и реальный ВВП', status: 'ok' },
  { title: 'Безработица', status: 'ok' },
  { title: 'Инфляция: виды и причины', status: 'ok' },
  { title: 'Кривая Филлипса', status: 'half' },
  { title: 'Деньги и их функции', status: 'ok' },
  { title: 'Денежный мультипликатор', status: 'ok' },
  { title: 'Центральный банк', status: 'no' },
  { title: 'Монетарная политика', status: 'ok' },
  { title: 'Фискальная политика', status: 'half' },
  { title: 'Государственный долг', status: 'no' },
  { title: 'Экономический рост', status: 'ok' },
  { title: 'Экономические циклы', status: 'half' },
  { title: 'Платёжный баланс', status: 'no' },
  { title: 'Валютный курс', status: 'ok' },
  { title: 'Международная торговля', status: 'no' },
];

export const SHEET_TOTALS = {
  ok: SHEET_ROWS.filter((row) => row.status === 'ok').length,
  half: SHEET_ROWS.filter((row) => row.status === 'half').length,
  no: SHEET_ROWS.filter((row) => row.status === 'no').length,
};

/** The ticket of the oral chapter: the landing's question and its answer sheet, shortened. */
export const TICKET = {
  name: 'Билет 7',
  subject: 'Микроэкономика',
  question: 'Почему пекарня, подняв цену на хлеб, может заработать больше, а кофейня, подняв цену на капучино, — меньше?',
  /** What the student says, word by word. */
  answer:
    'У кофе много замен: подорожал капучино — часть покупателей уходит к другим, и выручка падает. А хлеб покупают почти столько же, поэтому выручка растёт.',
  points: [
    'Когда спрос эластичен',
    'Кофе легко заменить',
    'Хлеб — спрос неэластичен',
    'Эластичный спрос: выручка падает',
    'Неэластичный: выручка растёт',
  ],
  /** Point index → the answer word after which it is named. */
  namedAfterWord: { 1: 3, 3: 14, 2: 20, 4: 23 } as Record<number, number>,
  missed: 0,
  examiner: 'Хорошо. А когда спрос называют эластичным?',
  reply: 'Когда покупки меняются сильнее, чем цена.',
};

export interface ReviewColumn {
  title: string;
  cards: Array<{ text: string; from?: string }>;
}

/** Cards by the day they come back (spaced repetition). */
export const REVIEW_COLUMNS: ReviewColumn[] = [
  {
    title: 'Сегодня',
    cards: [{ text: 'Что такое излишек потребителя?' }, { text: 'Как найти точку равновесия?' }, { text: 'Чем фирма отличается от отрасли?' }],
  },
  {
    title: 'Завтра',
    cards: [{ text: 'Когда спрос называют эластичным?', from: 'из ответа на билет 7' }, { text: 'Что показывает кривая предложения?' }],
  },
  {
    title: 'Через 3 дня',
    cards: [{ text: 'Издержки в краткосрочном периоде' }, { text: 'Признаки совершенной конкуренции' }],
  },
  {
    title: 'Через неделю',
    cards: [{ text: 'Ценовая дискриминация: виды' }, { text: 'Внешние эффекты: пример' }],
  },
];

/** Notes floating around the readiness grid. */
export const READY_NOTES = [
  { text: 'Билет 7 — засчитано', tone: 'green', x: 330, y: 500 },
  { text: '12 карточек на сегодня', tone: 'blue', x: 1590, y: 450 },
  { text: 'Пункт 1 — в повторение', tone: 'yellow', x: 350, y: 800 },
  { text: 'Вопрос 14 — разобран', tone: 'sky', x: 1580, y: 790 },
] as const;
