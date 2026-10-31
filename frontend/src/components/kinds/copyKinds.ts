/**
 * The words of the new question kinds (release 48, docs/kinds/CONTRACT.md §4) on every screen that shows them: the
 * participant's fields, the review, the editor. Plain and short, in the tone of containers/copy.ts.
 */
import type { ItemKind } from '../../types/container';

const plural = (n: number, one: string, few: string, many: string) => {
  const t = Math.abs(n) % 100;
  const u = t % 10;
  if (t > 10 && t < 20) return many;
  if (u === 1) return one;
  if (u >= 2 && u <= 4) return few;
  return many;
};
/** «0,5», «1», «2,25»: a number as people write it here. */
export const num = (x: number | string) => String(x).replace('.', ',');

export const KIND_NAMES: Record<ItemKind, string> = {
  single: 'Один ответ',
  multiple: 'Несколько ответов',
  short: 'Короткий ответ',
  number: 'Число',
  order: 'Порядок',
  match: 'Соответствие',
  cloze: 'Пропуски в тексте',
  essay: 'Развёрнутый ответ',
};

export const KINDS = {
  // the participant
  numberLabel: 'Ваш ответ — число',
  numberUnit: (unit: string) => `в ${unit}`,
  orderHint: 'Расставьте по порядку: перетащите строку или нажмите стрелки.',
  orderKeys: 'Пробел — взять строку, стрелки — передвинуть, пробел — поставить.',
  orderKeep: 'Оставить такой порядок',
  orderKept: 'Порядок записан.',
  orderUp: (text: string) => `Выше: ${text}`,
  orderDown: (text: string) => `Ниже: ${text}`,
  orderGrab: (text: string) => `Переставить: ${text}`,
  orderMoved: (text: string, place: number, of: number) => `${text} — место ${place} из ${of}.`,
  orderTaken: (text: string, place: number, of: number) => `Взята строка ${text}, место ${place} из ${of}. Стрелки — передвинуть, пробел — поставить.`,
  orderDropped: (text: string, place: number, of: number) => `Строка ${text} поставлена на место ${place} из ${of}.`,
  orderCancelled: 'Перестановка отменена.',
  matchHint: 'Выберите пару каждой строке. Можно перетащить ответ из списка под таблицей.',
  matchPick: 'Выбрать',
  matchNone: 'Не выбрано',
  matchPool: 'Ответы',
  matchSlot: (left: string) => `Пара для: ${left}`,
  matchSet: (right: string, left: string) => `${right} — к строке ${left}.`,
  matchCleared: (left: string) => `Строка ${left} без пары.`,
  matchExtra: 'Лишние ответы останутся без пары.',
  gapLabel: (n: number, of: number) => (of > 1 ? `Пропуск ${n} из ${of}` : 'Пропуск'),
  clozeHint: (n: number) => (n > 1 ? `Впишите слова в ${n} ${plural(n, 'пропуск', 'пропуска', 'пропусков')}.` : 'Впишите слово в пропуск.'),
  essayLabel: 'Ваш ответ',
  essayCount: (n: number, max: number) => `${n} из ${max}`,
  essayNote: 'Ответ проверит автор теста.',
  partialNote: 'Засчитывается частично: за каждую верную часть — доля балла.',
  emptyNumber: 'Впишите число.',
  emptyOrder: 'Передвиньте строки или нажмите «Оставить такой порядок».',
  emptyMatch: 'Выберите хотя бы одну пару.',
  emptyCloze: 'Впишите ответ хотя бы в один пропуск.',
  emptyEssay: 'Напишите ответ.',
  // the review
  yours: 'Ваш ответ',
  right: 'Верный ответ',
  rightOrder: 'Верный порядок',
  rightPairs: 'Верные пары',
  placeRight: 'на месте',
  placeWrong: (place: number) => `верное место — ${place}`,
  pairRight: 'верно',
  pairWrong: (right: string) => `верно: ${right}`,
  pairEmpty: 'без пары',
  gapRight: 'верно',
  gapWrong: (forms: string) => `верно: ${forms}`,
  gapEmpty: 'пусто',
  numberRight: (answers: string[], tolerance: number | string | null | undefined, unit: string | null | undefined) =>
    `${answers.map(num).join(' или ')}${tolerance !== null && tolerance !== undefined && Number(tolerance) > 0 ? ` ± ${num(tolerance)}` : ''}${unit ? ` ${unit}` : ''}`,
  credit: (credit: number) => `Засчитано ${num(Math.round(credit * 100) / 100)} из 1`,
  creditPart: (credit: number) => `Засчитано частично: ${Math.round(credit * 100)} %`,
  essayWait: 'Ответ ещё не проверен.',
  verdicts: { full: 'Полно', partial: 'Частично', none: 'Нет' } as Record<'full' | 'partial' | 'none', string>,
  verdictLine: { full: 'Ответ полный.', partial: 'Ответ неполный.', none: 'Ответ не засчитан.' } as Record<'full' | 'partial' | 'none', string>,
  quoteLead: 'В лекции:',
  byCheck: 'Проверено по лекциям',
  byAuthor: 'Оценка автора',
  // the session's verdict
  wrongBelow: 'Неверно. Верный ответ — под вопросом.',
  dontKnowBelow: 'Верный ответ — под вопросом.',
  // read aloud
  readAloud: 'Озвучить вопрос',
  readStop: 'Остановить',
  readFailed: 'Не получилось озвучить. Попробуйте ещё раз.',
};
