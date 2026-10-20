/**
 * The player's words (Russian UI copy) and the small number formats of the game screens. Plain words: no keys, no
 * codes, no exclamation marks. Comments stay in English.
 */
import type { LiveError, UnlockId } from '../../../lib/live/types';

export const NBSP = ' ';

/** Russian plural: one (1, 21), few (2–4, 22–24), many (0, 5–20, 11–14). */
export function plural(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a >= 11 && a <= 14) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** «12 345»: thousands with a no-break space. */
export function nb(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** «482 913». */
export function pinText(pin: string): string {
  return pin.length === 6 ? `${pin.slice(0, 3)}${NBSP}${pin.slice(3)}` : pin;
}

/** «0,9 с». */
export function seconds(ms: number): string {
  return `${(Math.max(0, ms) / 1000).toFixed(1).replace('.', ',')}${NBSP}с`;
}

/** «×1,25». */
export function multText(streakAfter: number): string {
  const m = 1 + 0.25 * Math.min(Math.max(streakAfter - 1, 0), 4);
  return `×${String(m).replace('.', ',')}`;
}

export const questions = (n: number) => `${n}${NBSP}${plural(n, 'вопрос', 'вопроса', 'вопросов')}`;
export const playersOf = (n: number) => `${n}${NBSP}${plural(n, 'игрока', 'игроков', 'игроков')}`;

export const UNLOCK_NAMES: Record<UnlockId, { title: string; why: string }> = {
  crown: { title: 'Новая шапка: корона', why: 'За место в тройке.' },
  grad: { title: 'Новая шапка: шапочка выпускника', why: 'За 10 игр.' },
  horns: { title: 'Новая шапка: рожки', why: 'За то, что оттаяли 3 раза за игру.' },
  graphite: { title: 'Новый цвет: графит', why: 'За серию из 5 верных ответов.' },
  snow: { title: 'Новый цвет: белый', why: 'За 5 побед над Дедлайном.' },
};

/** What a refusal of the server means for the player, in plain words. */
export function errorText(error: LiveError, pin: string | null): string {
  const d = error.detail;
  switch (error.code) {
    case 'P0002':
      if (d === 'pin') return pin ? `Игры с PIN ${pinText(pin)} нет. Проверьте цифры у ведущего.` : 'Такой игры нет. Проверьте PIN у ведущего.';
      return 'Игра не найдена. Войдите заново по PIN.';
    case 'ML001':
      return 'В игре уже 300 игроков: мест нет.';
    case 'ML002':
      return d === 'expired' ? 'Вход в эту игру закрыт: она идёт больше трёх часов.' : 'Эта игра уже закончилась.';
    case 'ML003':
      return 'В эту игру входят только участники экзамена. Войдите в Meldy своим аккаунтом или откройте игру из Telegram.';
    case 'ML005':
      return 'Слишком много входов подряд. Подождите минуту и попробуйте снова.';
    case 'ML006':
      return d === 'rude' ? 'Такое имя не подойдёт. Выберите другое.' : 'Имя — от 1 до 24 знаков.';
    case 'ML007':
      return d === 'locked' ? 'Эта часть ещё закрыта. Выберите другую.' : 'Эта часть не подошла. Выберите другую.';
    case 'ML004':
      if (d === 'late') return 'Время вышло: ответ не успел.';
      if (d === 'not_joined_yet') return 'Вы вошли во время вопроса: отвечать можно со следующего.';
      return 'Сейчас ответить нельзя.';
    case '42501':
      return d === 'kicked' ? 'Ведущий убрал вас из игры.' : 'Нет доступа к этой игре.';
    case '22023':
      return 'Что-то не так с данными. Обновите страницу и войдите заново.';
    case 'network':
      return 'Нет связи. Проверьте интернет и попробуйте снова.';
    default:
      if (d === 'launch') return 'Откройте игру заново кнопкой «Играть» в беседе.';
      return 'Не получилось. Попробуйте ещё раз.';
  }
}
