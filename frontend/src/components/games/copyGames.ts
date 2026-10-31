/**
 * The words of «Игры» (owner, 31.10: «мне интересно есть ли обучение о том что эти мини-игры есть, да и в целом может
 * отдельный Блок сверху как "лекции"»): the section in the top line, its page /games, its row on «Сегодня» on a phone,
 * and the picker. Plain short sentences that say what happens; the names of the games and of
 * the buttons are the game's own (components/live: MODE, STAND). copyGames.test.tsx checks the rules.
 */
import { MODE } from '../live/host/copy';
import { STAND } from '../live/stand/copy';

/** The section's address. */
export const GAMES_PATH = '/games';
/** Where a student joins a game: the phone's page, by the PIN or the QR code on the projector. */
export const PLAY_PATH = '/play';

const QUESTIONS = ['вопрос', 'вопроса', 'вопросов'] as const;

function plural(n: number, forms: readonly [string, string, string]): string {
  const a = Math.abs(n) % 10;
  const b = Math.abs(n) % 100;
  return forms[a === 1 && b !== 11 ? 0 : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? 1 : 2];
}

/** The name of the third game: the boss leaves its stage in every second round with movement (docs/live/MODE_RUN.md). */
export const CHASE_NAME = 'Убеги от Дедлайна';

export const GAMES = {
  /** The section's name in the menu and the page's title. */
  title: 'Игры',
  lede: 'Игра по вопросам вашего теста или экзамена. Она идёт на проекторе, а ученики отвечают с телефонов.',
  /** For a student: the phone's page with the PIN. */
  join: 'Войти в игру по коду',
  joinShort: 'Войти по коду',
  hero: {
    title: 'Игра в классе',
    text: 'Откройте игру на проекторе или большом экране. Ученики входят с телефона по PIN или QR-коду, на сайте или в Telegram. Аккаунт им не нужен.',
    start: 'Начать игру',
    /** Beside «Начать игру»: the own-time challenge by a link (docs/live/CHALLENGE.md). */
    challenge: 'Соревнование по ссылке',
    /** What the projector's picture shows, for those who do not see it. */
    alt: 'Игра «Встань на ответ» на проекторе. Класс бежит к ответам, потом пол под неверными ответами проваливается.',
  },
  modesTitle: 'Что бывает в игре',
  modes: [
    {
      id: 'battle',
      name: MODE.name,
      text: `${MODE.about} Отвечают кнопками на телефоне.`,
    },
    {
      id: 'stand',
      name: STAND.name,
      text: 'Каждый ведёт своего героя к ответу. Когда время выйдет, пол под неверными ответами провалится.',
    },
    {
      id: 'chase',
      name: CHASE_NAME,
      text: 'В каждом втором раунде с движением Дедлайн спрыгивает со сцены и гонится за классом. Кого поймал, того отбрасывает с ответа.',
    },
  ],
  /** Under the games: how a game is chosen at its start. */
  modesNote: 'Перед игрой выберите, как часто класс будет бегать к ответам. Например, раз в 5 вопросов или на каждом.',
  pick: {
    title: 'Выберите тест или экзамен',
    lede: 'В игру идут вопросы с одним верным ответом.',
    /** «Соревнование по ссылке» (docs/live/CHALLENGE.md). */
    challengeTitle: 'Соревнование по какому тесту',
    challengeLede: 'Каждый пройдёт тест сам, когда удобно, до срока. Таблица лидеров будет по той же ссылке.',
    test: 'Тест',
    exam: 'Экзамен',
    questions: (n: number) => `${n} ${plural(n, QUESTIONS)}`,
    noQuestions: 'Пока без вопросов',
    /** None of its questions has its answer yet: nothing to play. */
    noKey: 'нет отмеченных ответов',
    loading: 'Загружаем…',
    failed: 'Не получилось загрузить список.',
    retry: 'Повторить',
    empty: 'У вас пока нет своих тестов и экзаменов. Начните с быстрой контрольной. Вставьте вопросы, и по ним можно провести игру.',
    quick: 'Быстрая контрольная',
  },
  /** The compact row on «Сегодня» on a phone. */
  today: {
    title: 'Игры',
    text: 'Игра на проекторе',
  },
} as const;

/** «Тест · 24 вопроса» for a row of the picker. */
export function pickMeta(kind: 'test' | 'exam', questions: number): string {
  return `${kind === 'test' ? GAMES.pick.test : GAMES.pick.exam} · ${questions > 0 ? GAMES.pick.questions(questions) : GAMES.pick.noQuestions}`;
}
