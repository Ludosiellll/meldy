/**
 * The words of «Соревнование в своё время» (docs/live/CHALLENGE.md): the player's screens at /s/<code> and the author's
 * at /live/challenge. Plain short sentences, no exclamation marks, the game's own names (Дедлайн, «Без спешки»).
 * Comments stay in English.
 */
import type { LiveError } from '../../lib/live/types';
import { NBSP, plural } from '../live/player/copy';

export { NBSP, plural };

/** «3 ноября, 23:59» (the deadline, in the device's time zone). */
export function dateText(iso: string, now: Date = new Date()): string {
  const at = new Date(iso);
  if (!Number.isFinite(at.getTime())) return '';
  const day = at.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(at.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}) });
  const time = at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${time}`;
}

/** «1 мин 12 с» / «48 с»: a run's whole time. */
export function timeText(ms: number): string {
  const s = Math.round(Math.max(0, ms) / 1000);
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}${NBSP}мин ${s % 60}${NBSP}с` : `${s}${NBSP}с`;
}

export const questionsText = (n: number) => `${n}${NBSP}${plural(n, 'вопрос', 'вопроса', 'вопросов')}`;
export const pointsText = (n: number) => `${n}${NBSP}${plural(n, 'очко', 'очка', 'очков')}`;
export const peopleText = (n: number) => `${n}${NBSP}${plural(n, 'человек', 'человека', 'человек')}`;

export const CH = {
  name: 'Соревнование',
  gone: {
    noLink: { title: 'Ссылка не найдена', text: 'Проверьте адрес или попросите ссылку у того, кто её прислал.' },
    removed: { title: 'Автор убрал вас из таблицы', text: 'Сыграть по этой ссылке ещё раз не получится.' },
    failedTitle: 'Не получилось открыть',
  },
  intro: {
    kicker: 'Соревнование по ссылке',
    meta: (n: number, t: number) => `${questionsText(n)} · ${t}${NBSP}секунд на вопрос`,
    until: (d: string) => `Открыто до ${d}`,
    speed: 'Чем быстрее верный ответ, тем больше очков. Несколько верных подряд дают бонус.',
    calm: 'Без спешки: очки только за верные ответы, скорость не важна.',
    once: 'Пройти можно один раз. После каждого вопроса вы увидите верный ответ и пояснение.',
    boss: 'Каждый верный ответ бьёт по Дедлайну. Ошибка замораживает: следующий верный ответ только растопит лёд.',
    calmBoss: 'Каждый верный ответ бьёт по Дедлайну. Никто не замерзает.',
    played: (n: number) => (n > 0 ? `Уже прошли: ${peopleText(n)}` : 'Пока никто не прошёл. Вы можете быть первым.'),
    start: 'Начать',
    board: 'Таблица',
    overTitle: 'Соревнование закончилось',
    overClosed: 'Автор закрыл его раньше срока. Таблица осталась.',
    overDeadline: 'Срок вышел. Таблица осталась.',
  },
  builder: {
    back: 'Назад',
    rude: 'Такое имя не подойдёт. Выберите другое.',
    length: `Напишите имя${NBSP}— до 24 знаков.`,
  },
  ready: {
    title: 'Готовы?',
    lines: (n: number, t: number) => [
      `${questionsText(n)}, на каждый ${t}${NBSP}секунд. Первые три секунды можно читать: ответы откроются после отсчёта.`,
      'Вопросы идут по одному. Между ними можно передохнуть: время идёт, только пока вопрос открыт.',
    ],
    go: 'Первый вопрос',
    board: 'Таблица',
  },
  q: {
    count: (i: number, n: number) => `Вопрос ${i} из ${n}`,
    boss: 'Дедлайн',
    calm: 'Без спешки: отвечайте спокойно',
    streak: (n: number) => `Серия ${n}`,
    frozen: 'Вы заморожены: верный ответ растопит лёд',
    fast: `Отвечайте быстрее${NBSP}— очков больше`,
    sending: 'Отправляем ответ…',
    up: 'Время вышло',
    upWait: 'Проверяем…',
    angry: `Дедлайн злится: без ответа${NBSP}— тоже замёрзнете.`,
    last: `Последняя минута: за промах Дедлайн лечится.`,
    down: 'повержен',
  },
  sheet: {
    right: 'Верно',
    partial: 'Частично верно',
    wrong: 'Неверно',
    none: 'Время вышло',
    thawed: `Верно${NBSP}— лёд растаял`,
    thawedLine: 'Очков за этот вопрос нет: вы были заморожены. Дальше считается как обычно.',
    points: (n: number) => `+${n}`,
    pointsWord: (n: number) => plural(n, 'очко', 'очка', 'очков'),
    frozenNow: 'Ошибка заморозила вас. Следующий верный ответ растопит лёд.',
    frozenStill: 'Вы всё ещё заморожены. Следующий верный ответ растопит лёд.',
    calmMiss: 'Без спешки никто не замерзает. Следующий вопрос — новый шанс.',
    noneLine: 'Ответ не пришёл вовремя.',
    healed: (n: number) => `Последняя минута: Дедлайн восстановил ${n}${NBSP}HP.`,
    phase1: 'Дедлайн злится. Теперь и вопрос без ответа замораживает.',
    phase1Calm: 'Дедлайн злится, но без спешки никто не замерзает.',
    phase2: 'Последняя минута. За каждый промах Дедлайн лечится.',
    defeated: 'Дедлайн повержен. Остальные вопросы добавят очков в таблицу.',
    explanation: 'Пояснение',
    next: 'Дальше',
    final: 'Итог',
    streak: (n: number) => `Серия ${n}`,
    seconds: (ms: number) => `${(Math.max(0, ms) / 1000).toFixed(1).replace('.', ',')}${NBSP}с`,
    calmPill: 'Без спешки',
  },
  final: {
    won: 'Дедлайн повержен',
    lost: 'Дедлайн устоял',
    place: (p: number) => `${p}-е место`,
    of: (n: number) => `из ${n}`,
    noPlace: 'Место появится, когда соревнование закроется',
    points: 'очков',
    right: (r: number, n: number) => `${r} из ${n}`,
    rightLabel: 'верных',
    time: 'время',
    best: 'лучшая серия',
    review: 'Разбор и ошибки',
    board: 'Таблица',
    note: 'Таблица обновляется, пока идёт соревнование.',
    top: 'Первые места',
  },
  board: {
    title: 'Таблица',
    until: (d: string) => `Открыто до ${d}`,
    over: 'Соревнование закончилось',
    finished: (n: number) => `Прошли: ${n}`,
    playing: (n: number) => `Играют сейчас: ${n}`,
    empty: 'Пока никто не прошёл до конца.',
    me: 'вы',
    mine: (p: number | null) => (p ? `Ваше место: ${p}` : 'Вы ещё не закончили'),
    points: 'очки',
    right: 'верных',
    time: 'время',
    back: 'Назад',
    loading: 'Загружаем таблицу…',
    play: 'Сыграть',
  },
  review: {
    lead: (right: number, total: number) => `Верно ${right} из ${total}. Здесь только вопросы, которые вы видели.`,
    back: 'Назад к итогу',
  },
} as const;

/** What a refusal means for the player, in plain words. */
export function errorWords(e: LiveError): string {
  const d = e.detail;
  switch (e.code) {
    case 'P0002':
      return d === 'token' ? 'Это соревнование открыто на другом устройстве.' : 'Соревнование не найдено. Проверьте ссылку.';
    case 'ML001':
      return 'В соревновании уже 300 участников: мест нет.';
    case 'ML002':
      return d === 'closed' ? 'Автор закрыл соревнование.' : 'Срок соревнования вышел.';
    case 'ML005':
      return 'Слишком много входов подряд. Подождите минуту и попробуйте снова.';
    case 'ML006':
      return d === 'rude' ? CH.builder.rude : CH.builder.length;
    case 'ML007':
      return d === 'locked' ? 'Эта часть ещё закрыта. Выберите другую.' : 'Эта часть не подошла. Выберите другую.';
    case 'ML004':
      if (d === 'late') return 'Время вышло: ответ не успел.';
      if (d === 'twice') return 'Ответ на этот вопрос уже принят.';
      return 'Сейчас ответить нельзя.';
    case '42501':
      return d === 'removed' ? CH.gone.removed.title : 'Нет доступа.';
    case '22023':
      return 'Что-то не так с данными. Обновите страницу.';
    case 'network':
      return 'Нет связи. Проверьте интернет и попробуйте снова.';
    default:
      return 'Не получилось. Попробуйте ещё раз.';
  }
}
