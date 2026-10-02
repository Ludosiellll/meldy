/**
 * The one lecture the whole landing is built from: «Эластичность спроса», a microeconomics
 * topic. Every sample output on the page (the hero card, the summary, the quiz, the
 * conversation, the concept map and the oral exam) comes from this text, and every sentence
 * appears on the page once.
 */
import { NBSP, ty } from './typo';

const NB = NBSP;

/* ---------- the hero page ---------- */

export const HERO_PAGE = {
  title: 'Эластичность спроса',
  p1: ty('Эластичность показывает, насколько сильно покупатели реагируют на изменение цены.'),
  /** Desktop only: the rest of the first paragraph. */
  p1more: ty(' Её считают как отношение процентного изменения объёма спроса к процентному изменению цены.'),
  /** Desktop only: the paragraph under the key sentence. */
  more: ty('Так ведут себя товары, которым легко найти замену: подорожал один сорт кофе — берут другой. Хлеб и лекарства покупают почти в прежнем количестве, спрос на них неэластичен.'),
};

/** The sentence Meldy underlines, lifts off the page and pastes on the card. */
export const KEY_SENTENCE = `Спрос эластичен, если объём покупок меняется сильнее, чем${NB}цена.`;
export const CARD_QUESTION = 'Когда спрос эластичен?';

/* ---------- «Ваша очередь»: the next part of the same lecture ---------- */

export const DEMO_SHEET = {
  title: 'Эластичность и выручка',
  /** Sentences that the summary points to, by thesis index. */
  sources: [
    ty('Выручка продавца — это цена, умноженная на число проданных единиц.'),
    ty('Если спрос эластичен, повышение цены уменьшает выручку: продажи падают сильнее, чем растёт цена.'),
    ty('При неэластичном спросе всё наоборот: продажи падают меньше, чем растёт цена, и выручка увеличивается.'),
  ],
  /** Follows the first source sentence; no thesis points to it. */
  aside: ty('Поэтому продавцу важно знать, как покупатели ответят на новую цену.'),
};

export const THESES = [
  'Выручка — цена, умноженная на количество',
  'Эластичный спрос: выше цена — меньше выручка',
  'Неэластичный спрос: выше цена — больше выручка',
].map(ty);

export const QUIZ = {
  question: ty(`Кофейня подняла цену капучино на 10${NB}%, а продавать стала на 25${NB}% меньше. Что стало с выручкой?`),
  options: ['Выросла', 'Уменьшилась', 'Не изменилась'],
  correct: 1,
  right: ty(`Верно: 1,1${NB}×${NB}0,75${NB}≈${NB}0,83, то есть выручка уменьшилась примерно на 17${NB}%. Продажи упали сильнее, чем выросла цена.`),
  wrong: ty(`Посчитайте: цена выросла в 1,1 раза, а продажи составили 0,75 от прежних. 1,1${NB}×${NB}0,75${NB}≈${NB}0,83, значит, выручка уменьшилась.`),
};

/* ---------- «Что ещё получится»: the conversation, the map, the oral exam ---------- */

export type Speaker = 'Макс' | 'Софья';

export interface CompareVisual {
  type: 'compare';
  title: string;
  sides: Array<{ label: string; points: string[]; verdict: string }>;
}
export interface FormulaVisual {
  type: 'formula';
  title: string;
  /** Numerator and denominator of the ratio, and the worked example. */
  top: string;
  bottom: string;
  example: { top: string; bottom: string; result: string };
  legend: Array<[string, string]>;
}
export interface BarsVisual {
  type: 'bars';
  title: string;
  unit: string;
  bars: Array<{ label: string; value: number; note: string }>;
}
export type TalkVisual = CompareVisual | FormulaVisual | BarsVisual;

export interface Exchange {
  lines: Array<[Speaker, string]>;
  visual: TalkVisual;
}

export const TALK: Exchange[] = [
  {
    lines: [
      ['Макс', ty('Когда кофе дорожает, люди просто идут в соседнюю кофейню. А хлеб берут всё равно. Почему так?')],
      ['Софья', ty('У капучино в одной кофейне много замен, а хлебу заменить почти нечем. Чем легче найти замену, тем эластичнее спрос.')],
    ],
    visual: {
      type: 'compare',
      title: 'Есть ли замена',
      sides: [
        { label: 'Капучино', points: ['рядом другие кофейни', 'можно сварить дома'], verdict: 'спрос эластичен' },
        { label: 'Хлеб', points: ['замен почти нет', 'нужен каждый день'], verdict: 'спрос неэластичен' },
      ],
    },
  },
  {
    lines: [
      ['Макс', ty('А насколько эластичен? Это можно посчитать?')],
      ['Софья', ty(`Делим процентное изменение спроса на процентное изменение цены. Цена выросла на 10${NB}%, продажи упали на 20${NB}% — эластичность минус два.`)],
    ],
    visual: {
      type: 'formula',
      title: 'Эластичность спроса по цене',
      top: '%ΔQ',
      bottom: '%ΔP',
      example: { top: `−20${NB}%`, bottom: `+10${NB}%`, result: '−2' },
      legend: [['%ΔQ', 'изменение объёма спроса'], ['%ΔP', 'изменение цены']],
    },
  },
  {
    lines: [
      ['Макс', ty('Но продавец же выигрывает, когда поднимает цену?')],
      ['Софья', ty('Только если спрос неэластичен. Было сто чашек по сто рублей, стало восемьдесят по сто десять — выручка упала с десяти тысяч до восьми тысяч восьмисот.')],
    ],
    visual: {
      type: 'bars',
      title: 'Выручка кофейни за день',
      unit: '₽',
      bars: [
        { label: 'до', value: 10000, note: `100 чашек × 100${NB}₽` },
        { label: 'после', value: 8800, note: `80 чашек × 110${NB}₽` },
      ],
    },
  },
];

/** The lecture's concepts as Meldy's map links them. */
export interface MapNode { id: string; label: string; x: number; y: number }
export interface MapEdge { from: string; to: string; label?: string }

export const MAP = {
  nodes: [
    { id: 'e', label: 'эластичность спроса', x: 50, y: 0 },
    { id: 'el', label: 'эластичный спрос', x: 22, y: 47 },
    { id: 'in', label: 'неэластичный спрос', x: 78, y: 47 },
    { id: 'down', label: 'подорожание снижает выручку', x: 22, y: 100 },
    { id: 'up', label: 'подорожание повышает выручку', x: 78, y: 100 },
  ] as MapNode[],
  edges: [
    { from: 'e', to: 'el', label: '|E| > 1' },
    { from: 'e', to: 'in', label: '|E| < 1' },
    { from: 'el', to: 'down' },
    { from: 'in', to: 'up' },
  ] as MapEdge[],
};

export const EXAM = {
  question: ty('Почему пекарня, подняв цену на хлеб, может заработать больше, а кофейня, подняв цену на капучино, — меньше?'),
  answer: ty('У кофе много замен, поэтому после подорожания часть покупателей уходит.'),
  note: ty('Хорошо, что вспомнили про замены. Не хватает вывода про пекарню: продажи хлеба падают меньше, чем растёт цена, поэтому выручка увеличивается.'),
};

/* ---------- «Подход»: when the card comes back ---------- */

/**
 * SM-2 in api/flashcards.ts with «Знаю» (quality 5) every time: 1 day, 6 days, then the
 * interval times the ease factor (2.7 → 16 days, 2.8 → 45 days).
 */
export const SCHEDULE = [
  { days: 1, label: 'завтра' },
  { days: 6, label: 'через 6 дней' },
  { days: 16, label: 'через 2 недели' },
  { days: 45, label: 'через полтора месяца' },
] as const;
