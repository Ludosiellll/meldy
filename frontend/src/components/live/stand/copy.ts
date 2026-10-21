/**
 * The words of the projector in «Встань на ответ» (docs/live/MODE_STAND.md §8). Plain Russian, one short sentence per
 * thought, numbers first (the plain-words rules of 21.10). Shared words come from the battle's copy.
 */
import { count, nb, plural } from '../host/copy';

const NBSP = ' ';
const QUESTIONS = ['вопрос', 'вопроса', 'вопросов'] as const;

export const STAND = {
  name: 'Встань на ответ',
  about: 'Ученики бегут на верный ответ. Остальной пол проваливается.',
  question: (i: number, n: number) => `Вопрос ${i} из ${n}`,
  pin: (pin: string) => `PIN ${pin.length === 6 ? `${pin.slice(0, 3)}${NBSP}${pin.slice(3)}` : pin}`,
  questions: (n: number) => count(n, QUESTIONS),
  hint: 'Встаньте на верный ответ. Остальной пол провалится.',
  right: 'Верный ответ',
  alive: 'Живы',
  ghosts: 'Призраки',
  playing: 'Играют',
  stood: (n: number, of: number) => ({ before: 'Устояли ', n: nb(n), after: ` из ${nb(of)}` }),
  nobody: 'Никто не устоял',
  fastest: (name: string, pts: number) => `Быстрее всех ${name}, +${nb(pts)}`,
  back: (n: number) => `${nb(n)} ${plural(n, ['призрак вернулся', 'призрака вернулись', 'призраков вернулись'])} в игру`,
  top: 'Больше всех очков',
  topAfter: (i: number, n: number) => `После ${i} ${plural(i, ['вопроса', 'вопросов', 'вопросов'])} из ${n}`,
  points: (n: number) => nb(n),
  up: (n: number) => `▲${NBSP}${n}`,
  down: (n: number) => `▼${NBSP}${n}`,
  final: 'Итог игры',
  accuracy: (pct: number) => `Верных ответов ${pct}${NBSP}%`,
  ended: 'Игра закончилась',
  next: 'Дальше',
  nextLast: 'К итогам',
  nextQuestion: 'Следующий вопрос',
  review: 'Разбор',
  again: 'Ещё игра',
  finish: 'Закончить игру',
  start: 'Начать',
  go: 'Заходите на',
  camera: 'Или наведите камеру телефона на код.',
  waiting: 'Ждём игроков',
  joined: (n: number) => `${nb(n)} ${plural(n, ['игрок', 'игрока', 'игроков'])} в игре`,
  settings: (time: number, speed: boolean, members: boolean) =>
    [`${time}${NBSP}с на вопрос`, speed ? 'очки за скорость' : 'только верность', members ? 'только участники экзамена' : 'все по PIN'].join(' · '),
  lost: 'Связь с игрой пропала. Подключаемся.',
  closed: 'Комната игры закрыта.',
  loading: 'Загружаем игру…',
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
