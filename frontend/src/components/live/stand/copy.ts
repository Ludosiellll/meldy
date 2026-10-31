/**
 * The words of the projector in «Встань на ответ» (docs/live/MODE_STAND.md §8). Plain Russian, one short sentence per
 * thought, numbers first (the plain-words rules of 21.10). Shared words come from the battle's copy.
 */
import { NEXT, count, nb, plural } from '../host/copy';

const NBSP = ' ';
const QUESTIONS = ['вопрос', 'вопроса', 'вопросов'] as const;

export const STAND = {
  name: 'Встань на ответ',
  about: 'Ученики бегут на верный ответ. Остальной пол проваливается.',
  question: (i: number, n: number) => `Вопрос ${i} из ${n}`,
  pin: (pin: string) => `PIN ${pin.length === 6 ? `${pin.slice(0, 3)}${NBSP}${pin.slice(3)}` : pin}`,
  questions: (n: number) => count(n, QUESTIONS),
  hint: 'Встаньте на верный ответ. Остальной пол провалится.',
  /** A chase round (mode B, MODE_RUN.md): «Дедлайн» hunts the class. */
  chaseHint: 'Убегайте от Дедлайна и встаньте на верный ответ.',
  caught: 'Поймал',
  right: 'Верный ответ',
  alive: 'Живы',
  ghosts: 'Призраки',
  playing: 'Играют',
  stood: (n: number, of: number) => ({ before: 'Устояли ', n: nb(n), after: ` из ${nb(of)}` }),
  nobody: 'Никто не устоял',
  fastest: (name: string, pts: number) => `Быстрее всех ${name}, +${nb(pts)}`,
  top: 'Больше всех очков',
  topAfter: (i: number, n: number) => `После ${i} ${plural(i, ['вопроса', 'вопросов', 'вопросов'])} из ${n}`,
  up: (n: number) => `▲${NBSP}${n}`,
  down: (n: number) => `▼${NBSP}${n}`,
  final: 'Итог игры',
  accuracy: (pct: number) => `Верных ответов ${pct}${NBSP}%`,
  ended: 'Игра закончилась',
  // the teacher's «next» reads as in the battle
  next: NEXT.reveal,
  nextLast: NEXT.revealLast,
  nextQuestion: NEXT.leaderboard,
  review: 'Разбор',
  again: 'Ещё раз',
  finish: 'Закончить игру',
  start: 'Начать',
  go: 'Заходите на',
  camera: 'Или наведите камеру телефона на код.',
  // short sentences, no «·» chains (the plain-words rules)
  settings: (time: number, speed: boolean, members: boolean) =>
    [`${time}${NBSP}с на вопрос.`, speed ? 'Быстрым больше очков.' : 'Очки только за верный ответ.', members ? 'Играют участники экзамена.' : 'Войти можно по PIN.'].join(' '),
  lost: 'Связь с игрой пропала. Подключаемся.',
  noWebgl: 'Этот браузер не показывает 3D. Откройте игру в Chrome, Edge или Firefox.',
  sound: 'Звук',
  soundOn: 'Включить звук',
  soundOff: 'Выключить звук',
  players: 'Игроки',
  fullscreen: 'Во весь экран',
  fullscreenOff: 'Выйти из полного экрана',
  end: 'Закончить',
  offline: 'Нет связи, пробуем снова',
};

/** The two bosses the teacher picks from (the setup page and the lobby). */
export const BOSSES = {
  clock: { name: 'Будильник', about: 'Будильник-громила' },
  skeleton: { name: 'Скелет', about: 'Скелет с будильником' },
} as const;

/** The battle on the 3D projector (BattleHost.tsx): its button questions over the arena, the five best, the end. */
export const BATTLE_3D = {
  ready: 'Приготовьтесь',
  hint: 'Отвечайте на телефоне',
  right: 'Верный ответ',
  answered: (n: number, of: number) => ({ before: 'Ответили ', n: nb(n), after: ` из ${nb(of)}` }),
  rightOf: (n: number, of: number) => ({ before: 'Верно ', n: nb(n), after: ` из ${nb(of)}` }),
  nobody: 'Никто не ответил верно',
  fastest: (name: string, dmg: number) => `Быстрее всех ${name}, −${nb(dmg)}`,
  top: 'Больше всех урона',
  picture: 'Рисунок к вопросу',
  pictureBig: 'Рисунок к вопросу: показать крупно',
  pictureFailed: 'Рисунок не загрузился',
  /** Several right answers (CONTRACT §3): the board says how many. */
  multi: (n: number) => `Верных: ${n}${NBSP}— отметьте все`,
  rightMany: 'Верные ответы',
  /** A text answer. */
  text: 'Напишите ответ на телефоне',
  tops: 'Чаще писали',
  topsNone: 'Ответов не было',
  /** A number question (20261102090100_live_numbers.sql). */
  number: 'Введите число на телефоне',
  unit: (u: string) => `Ответ в\u00a0${u}`,
  line: 'Ответы класса',
  /** «Без спешки» (20261106090000_live_calm.sql): said on the board of every question. */
  calm: 'Без спешки: очки только за верные ответы',
  near: 'Ближе всех',
};

/** «два», «три»: how many right zones a movement round has (MODE_MIXED.md §5). */
const ZONES_N = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть'] as const;
/** A number question played as ranges (20261102090200_live_ranges.sql). */
export const RANGES = {
  hint: 'Встаньте на промежуток с ответом',
  /** «Ответ: 343 ± 10 м/с» under the right range at the reveal (the board already says «Верный ответ»). */
  value: (answer: string) => `Ответ: ${answer}`,
};

export const MULTI_ZONES = {
  /** «Верных ответов два — встаньте на любой». */
  hint: (n: number) => `Верных ответов ${ZONES_N[n] ?? n}${NBSP}— встаньте на любой`,
};

/** Teams (CONTRACT §13): their names and colours, the same on the projector and the phones. */
export const TEAM_NAMES = ['', 'Красные', 'Синие', 'Жёлтые', 'Зелёные'] as const;
export const TEAM_COLOURS = ['', '#ef5b4c', '#2f74e8', '#f2b928', '#2fa866'] as const;
export const TEAMS_COPY = {
  name: (t: number) => TEAM_NAMES[t] ?? `Команда ${t}`,
  board: 'Команды',
  avgLabel: 'в среднем',
  mvp: 'Лучший игрок',
  players: (n: number) => `${n}${NBSP}${plural(n, ['игрок', 'игрока', 'игроков'])}`,
  best: (name: string) => `лучший: ${name}`,
  won: (t: number) => `Победили ${TEAM_NAMES[t] ?? `команда ${t}`}`,
  lobby: 'Команды набираются сами: каждый новый игрок идёт в меньшую.',
};
