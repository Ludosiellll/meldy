/**
 * The words of «Дуэль» (docs/live/DUEL.md): the duel's page /d/<code> and its setup /live/duel. Plain short sentences, no
 * exclamation marks, the game's own names («Без спешки»). Comments stay in English.
 */
import type { LiveError } from '../../lib/live/types';
import { NBSP, plural } from '../live/player/copy';

export { NBSP, plural };

export const questionsText = (n: number) => `${n}${NBSP}${plural(n, 'вопрос', 'вопроса', 'вопросов')}`;
export const pointsText = (n: number) => `${n}${NBSP}${plural(n, 'очко', 'очка', 'очков')}`;
export const rightText = (n: number) => `${n}${NBSP}${plural(n, 'верный', 'верных', 'верных')}`;
export const secondsText = (n: number) => `${n}${NBSP}${plural(n, 'секунда', 'секунды', 'секунд')}`;

/** «0:45» */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export const DU = {
  name: 'Дуэль',
  loading: 'Открываем дуэль…',
  /** The start refused for the rate (429): the page tries again by itself. */
  loadingBusy: 'Сервер сейчас занят. Пробуем ещё раз…',
  gone: {
    noLink: { title: 'Дуэль не найдена', text: 'Проверьте адрес или попросите ссылку у того, кто её прислал.' },
    over: { title: 'Эта дуэль уже закончилась', text: 'Попросите новую ссылку, если хотите сыграть.' },
    other: { title: 'Дуэль открыта на другом устройстве', text: 'С этого устройства место уже не ваше. Вернитесь туда, где вы играли.' },
    freed: { title: 'Ваше место освободилось', text: 'Вас долго не было в зале ожидания. Откройте ссылку снова, если место ещё свободно.' },
    failedTitle: 'Не получилось открыть',
    /** The way out of a link that leads nowhere: «Выйти» read as «log out» to a guest (audit 07.11, STAND-7). */
    toGames: 'К играм',
    toStart: 'На главную',
  },
  full: {
    title: 'Места заняты',
    text: 'В этой дуэли уже два игрока. Попросите у друга новую ссылку.',
    retry: 'Проверить ещё раз',
  },
  intro: {
    kicker: 'Вас вызвали на дуэль',
    who: (name: string) => `${name} зовёт на дуэль`,
    meta: (n: number, t: number) => `${questionsText(n)} · ${t}${NBSP}секунд на вопрос`,
    rules: [
      'Вопросы одни и те же, у каждого на своём устройстве, в одно время.',
      'Отвечаете один раз. Ответ соперника видно только после вопроса.',
      'Побеждает тот, у кого больше очков. При равных очках — больше верных ответов.',
    ],
    calm: 'Без спешки: очки только за верные ответы, скорость не важна.',
    speed: 'Чем быстрее верный ответ, тем больше очков. Серия верных добавляет ещё.',
    go: 'Принять вызов',
  },
  builder: {
    back: 'Назад',
    rude: 'Это имя не подойдёт. Выберите другое.',
    length: 'Имя — от 1 до 24 символов.',
  },
  lobby: {
    title: 'Зал ожидания',
    invite: 'Пригласите соперника',
    inviteText: 'Отправьте ссылку или покажите QR-код. Сопернику не нужен аккаунт: только имя и персонаж.',
    copy: 'Скопировать ссылку',
    copied: 'Скопировано',
    share: 'Отправить',
    waitingOther: 'Ждём соперника по ссылке',
    ready: 'Готов',
    readyDone: 'Вы готовы',
    otherReady: '«Готов» нажато',
    otherNotReady: 'ждём «Готов»',
    away: 'не на связи',
    both: 'Когда оба нажмут «Готов», через 2 секунды появится первый вопрос.',
    expires: (time: string) => `Ссылка действует до ${time}, пока дуэль не началась.`,
    round: (n: number) => `Раунд ${n}`,
  },
  q: {
    soon: 'Сейчас будет вопрос',
    count: (i: number, n: number) => `Вопрос ${i} из ${n}`,
    sending: 'Отправляем ответ…',
    sent: 'Ответ принят. Ждём соперника.',
    sentBoth: 'Оба ответили.',
    otherAnswered: 'есть ответ',
    meAnswered: 'ответ принят',
    meThinking: 'ваш ход',
    otherThinking: 'думает',
    up: 'Время вышло',
    upWait: 'Подводим итог вопроса.',
    frozen: 'Вы во льду: верный ответ растопит лёд, но очков не даст.',
    fast: 'Отвечайте быстро: так больше очков.',
    calm: 'Без спешки: важна только верность.',
    me: 'Вы',
  },
  reveal: {
    right: 'Верно',
    wrong: 'Неверно',
    partial: 'Частично',
    none: 'Без ответа',
    thawed: 'Лёд растаял',
    frozen: 'во льду',
    mine: 'ваш ответ',
    theirs: (name: string) => `ответ: ${name}`,
    both: 'оба выбрали',
    key: 'верный ответ',
    rightText: 'Верный ответ',
    rightMany: 'Верные ответы',
    masked: 'ответ скрыт',
    noAnswer: 'нет ответа',
    explanation: 'Пояснение',
    next: 'Дальше',
    final: 'Итог',
    otherNext: 'Соперник готов идти дальше',
    waitOther: 'Ждём соперника…',
    auto: (s: number) => `Дальше через ${s}${NBSP}с`,
  },
  wait: {
    title: 'Соперник пропал со связи',
    text: 'Ждём его до минуты. Если не вернётся, победа ваша, какой бы ни был счёт.',
    /** Its wait budget runs out before the minute: the duel goes on without it. */
    openText: 'Он уже пропадал в этой дуэли, поэтому ждём меньше. Если не вернётся, следующий вопрос начнётся без него.',
    left: (clock: string) => `Осталось ${clock}`,
  },
  final: {
    won: 'Победа',
    lost: 'Поражение',
    draw: 'Ничья',
    none: 'Без победителя',
    expired: 'Дуэль не началась',
    reason: {
      done: '',
      leftWon: 'Соперник не вернулся за минуту.',
      leftLost: 'Вы не вернулись за минуту.',
      gone: 'Оба игрока ушли со связи.',
      expired: 'Второй игрок так и не пришёл, ссылка больше не действует.',
    } as Record<string, string>,
    points: 'очки',
    right: 'верных',
    match: (me: number, other: number) => `Счёт матча ${me}${NBSP}:${NBSP}${other}`,
    draws: (n: number) => `${n}${NBSP}${plural(n, 'ничья', 'ничьи', 'ничьих')}`,
    review: 'Разбор и ошибки',
    again: 'Ещё раз',
    againWait: 'Ждём ответа соперника…',
    againOther: 'Соперник хочет сыграть ещё раз',
    againLast: 'Это был 20-й раунд: больше раундов в матче нет.',
    exit: 'Выйти',
    next: 'Следующая дуэль',
    moving: 'Переходим к следующей дуэли…',
  },
  review: {
    title: 'Разбор и ошибки',
    lead: (right: number, total: number) => `Вы ответили верно на ${right} из ${total}. Рядом ответ соперника.`,
    back: 'К итогу',
    yours: 'Ваш ответ',
    theirs: (name: string) => `Ответ: ${name}`,
    practice: 'Тренировать ошибки',
  },
  board: {
    vs: 'против',
    track: (name: string) => `Ответы: ${name}`,
  },
};

/** The words of a refusal. */
export function errorWords(e: LiveError): string {
  const d = e.detail;
  switch (e.code) {
    case 'P0002':
      return d === 'token' ? DU.gone.other.title : 'Дуэль не найдена. Проверьте ссылку.';
    case 'ML001':
      return DU.full.text;
    case 'ML002':
      return d === 'expired' ? 'Прошло больше 7 дней: эти вопросы для дуэли уже не открыть.' : 'Эта дуэль уже закончилась.';
    case 'ML005':
      return 'Слишком много дуэлей подряд. Подождите немного и попробуйте снова.';
    case 'ML006':
      return d === 'rude' ? DU.builder.rude : DU.builder.length;
    case 'ML007':
      return d === 'locked' ? 'Эта часть ещё закрыта. Выберите другую.' : 'Эта часть не подошла. Выберите другую.';
    case 'ML008':
      return 'В этом тесте нет вопросов, которые можно сыграть в дуэли.';
    case 'ML009':
      return d === 'source'
        ? 'На этих вопросах уже открыто 5 незаконченных дуэлей. Доиграйте одну из них.'
        : 'У вас 20 незаконченных дуэлей. Доиграйте одну из них.';
    case 'ML004':
      if (d === 'late') return 'Время вышло: ответ не успел.';
      if (d === 'twice') return 'Ответ на этот вопрос уже принят.';
      if (d === 'not_over') return 'Эти вопросы откроются для дуэли, когда игра или соревнование закончится.';
      if (d === 'rounds') return DU.final.againLast;
      return 'Сейчас этого сделать нельзя.';
    case '42501':
      return d === 'removed' ? 'Автор убрал вас из таблицы соревнования.' : d === 'kicked' ? 'Ведущий убрал вас из игры.' : 'Нет доступа.';
    case '28000':
      return 'Войдите в аккаунт.';
    case '22023':
      return 'Что-то не так с данными. Обновите страницу.';
    case 'network':
      return 'Нет связи. Проверьте интернет и попробуйте снова.';
    default:
      // a 429 of the site's /sb proxy: no code of the database
      return e.status === 429 ? 'Сервер сейчас занят. Подождите немного и попробуйте снова.' : 'Не получилось. Попробуйте ещё раз.';
  }
}

/** The setup /live/duel and the entries to it. */
export const DUEL_ENTRY = {
  /** «Игры» and the test's page, beside «Соревнование по ссылке». */
  action: 'Дуэль',
  /** A finished challenge's final, a finished live game's personal review. */
  sameQuestions: 'Дуэль на этих вопросах',
  pickTitle: 'Дуэль по какому тесту',
  pickLede: 'Двое отвечают на одни и те же вопросы в одно время, каждый со своего телефона или компьютера.',
};

export const DSETUP = {
  top: 'Дуэль',
  title: (name: string) => `Дуэль по тесту «${name}»`,
  titleSame: 'Дуэль на этих вопросах',
  lead: (n: number) =>
    `${questionsText(n)}. Двое отвечают в одно время, каждый со своего устройства. Сопернику не нужен аккаунт: вы отправите ему ссылку или покажете QR-код.`,
  leadChallenge: 'Вопросы, которые вы видели в соревновании, в той же формулировке. Соперник ответит на них вместе с вами.',
  leadGame: 'Вопросы, которые были в игре, в той же формулировке. Соперник ответит на них вместе с вами.',
  loading: 'Загружаем вопросы…',
  failed: 'Не получилось загрузить вопросы.',
  retry: 'Попробовать ещё раз',
  noTokenChallenge: 'Дуэль на этих вопросах открывается на том устройстве и в том браузере, где вы проходили соревнование.',
  noTokenGame: 'Дуэль на этих вопросах открывается в той вкладке, где вы играли.',
  noSource: 'Не понятно, по каким вопросам дуэль. Откройте её со страницы теста или из «Игр».',
  time: 'Время на вопрос',
  timeOption: (s: number) => `${s}${NBSP}с`,
  same: 'Как было',
  calm: 'Без спешки',
  calmHint: 'Очки только за верные ответы: без бонуса за скорость и серию, никто не замерзает.',
  on: 'Да',
  off: 'Нет',
  amount: 'Вопросов',
  amountAll: (n: number) => `все ${n}`,
  skipped: (n: number) => `${questionsText(n)} не ${plural(n, 'войдёт', 'войдут', 'войдут')} в дуэль: с картинкой, на порядок, соответствие, пропуски или эссе.`,
  tooFew: 'Нужно хотя бы 3 подходящих вопроса. Добавьте их в тест.',
  foot: 'Сначала вы выберете имя и персонажа, потом получите ссылку для соперника.',
  next: 'Дальше',
  create: 'Создать дуэль',
  creating: 'Создаём…',
  back: 'К настройкам',
};
