/**
 * The words of the teacher's screen in «Битва с монстром» (docs/live/CONTRACT.md; prototype host.js, 20.10). Plain
 * Russian: names of actions and facts, no slogans. Numbers keep a no-break space between thousands («7 920»).
 */

const NBSP = ' ';

/** «7 920»: thousands split by a no-break space. */
export function nb(n: number): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
}

/** 1 игрок, 2 игрока, 5 игроков. */
export function plural(n: number, forms: readonly [string, string, string]): string {
  const a = Math.abs(n) % 10;
  const b = Math.abs(n) % 100;
  return forms[a === 1 && b !== 11 ? 0 : a >= 2 && a <= 4 && (b < 10 || b >= 20) ? 1 : 2];
}

export const count = (n: number, forms: readonly [string, string, string]) => `${nb(n)}${NBSP}${plural(n, forms)}`;

const QUESTIONS = ['вопрос', 'вопроса', 'вопросов'] as const;
const PLAYERS = ['игрок', 'игрока', 'игроков'] as const;

/** «482 913». */
export const pinText = (pin: string) => (pin.length === 6 ? `${pin.slice(0, 3)}${NBSP}${pin.slice(3)}` : pin);

/** The letters on the projector are the letters on the phones (CONTRACT §4). */
export const LETTERS = ['А', 'Б', 'В', 'Г'] as const;

export const MODE = {
  name: 'Битва с монстром',
  about: 'Весь класс против монстра. Верный ответ — удар, ошибка — заморозка.',
};

export const SETUP = {
  top: 'Провести игру',
  title: (name: string) => `Игра по тесту «${name}»`,
  titleNone: 'Игра по тесту',
  lead: (n: number) => `${count(n, QUESTIONS)} в игре. Ученики входят с телефона по PIN или QR-коду.`,
  loading: 'Загружаем вопросы…',
  failed: 'Не получилось загрузить вопросы.',
  retry: 'Повторить',
  time: 'Время на вопрос',
  timeOption: (s: number) => `${s}${NBSP}с`,
  speed: 'Очки за скорость',
  speedOn: 'Да',
  speedOff: 'Нет, только верность',
  who: 'Кто играет',
  whoPin: 'Все по PIN',
  whoMembers: 'Только участники экзамена',
  names: 'Показывать имена тройки в чате',
  namesHint: 'В конце игры бот назовёт в беседе Telegram трёх лучших. Иначе только общий итог.',
  namesOff: 'Нет',
  namesOn: 'Да',
  amount: 'Вопросов',
  amountAll: (n: number) => `все ${n}`,
  skippedHead: (n: number) => `Не войдут в игру: ${count(n, QUESTIONS)}`,
  skippedWhy: 'В игре только вопросы с одним верным ответом и 2–4 вариантами.',
  reason: {
    multiple: 'несколько верных ответов',
    short: 'ответ пишут словами',
    options: 'не 2–4 варианта',
    nokey: 'нет верного ответа',
  },
  tooFew: 'Для игры нужно хотя бы 3 подходящих вопроса. Добавьте их в студии.',
  foot: 'Гости увидят верный ответ после каждого вопроса. Ключи остальных вопросов экзамена им не видны.',
  open: 'Открыть комнату',
  opening: 'Открываем…',
  signIn: 'Войдите, чтобы провести игру.',
  back: 'К тесту',
  error: {
    ML008: 'В тесте нет вопросов для игры: нужны вопросы с одним верным ответом и 2–4 вариантами.',
    ML009: 'У вас уже открыто 3 игры. Закончите одну из них.',
    ML005: 'Слишком много игр за час. Попробуйте позже.',
    '42501': 'Провести игру может только автор теста.',
    '28000': 'Войдите, чтобы провести игру.',
    network: 'Нет связи. Проверьте интернет и попробуйте ещё раз.',
    other: 'Не получилось открыть комнату. Попробуйте ещё раз.',
  } as Record<string, string>,
};

export const TOP = {
  mode: MODE.name,
  question: (i: number, n: number) => ({ before: 'Вопрос ', i: String(i), after: ` из ${n}` }),
  final: 'Итог',
  pin: (pin: string) => `PIN ${pinText(pin)}`,
  playing: (n: number) => `Играют ${nb(n)}`,
  players: 'Игроки',
  fullscreen: 'Во весь экран',
  fullscreenOff: 'Выйти из полного экрана',
  end: 'Закончить',
  offline: 'Нет связи, пробуем снова',
};

export const LOBBY = {
  pin: 'PIN игры',
  camera: 'Камера:',
  cameraText: 'наведите на код',
  site: 'Сайт:',
  count: (n: number) => ({ n: nb(n), word: plural(n, PLAYERS) }),
  waiting: 'Ждём игроков',
  more: (n: number) => `и ещё ${nb(n)}`,
  foot: 'Начните, когда соберутся все. Войти можно и после начала.',
  start: 'Начать',
  settings: (time: number, speed: boolean, members: boolean) =>
    [`${time}${NBSP}с на вопрос`, speed ? 'очки за скорость' : 'только верность', members ? 'только участники экзамена' : 'все по PIN'].join(' · '),
  kickHint: 'Нажмите на игрока, чтобы убрать его.',
};

export const BATTLE = {
  boss: 'Дедлайн',
  hp: (hp: number, max: number) => `${nb(hp)} из ${nb(max)}`,
  phaseNote: ['', 'Злится: замораживает и тех, кто не ответил', 'Последняя минута: если верных меньше ⅔, лечится на 5 %'] as const,
  ready: 'Приготовьтесь',
  answered: 'ответили',
  right: 'верно',
  of: (n: number) => `из ${nb(n)}`,
  timeUp: 'Время вышло',
  more: (n: number) => `+${nb(n)}`,
};

export const BANNER = {
  phase1: { title: 'Дедлайн злится', sub: 'Теперь замораживает и тех, кто не успел ответить' },
  phase2: { title: 'Последняя минута', sub: 'Если верных меньше двух третей, Дедлайн восстанавливает 5 %' },
  heal: (n: number) => ({ title: `Дедлайн восстановил ${nb(n)}`, sub: 'Верных ответов меньше двух третей' }),
  defeated: { title: 'Дедлайн повержен', sub: '' },
};

export const BOARD = {
  title: 'Больше всех урона',
  side: 'урон за игру',
  up: (n: number) => `↑${n}`,
  down: (n: number) => `↓${n}`,
  newcomer: 'новый',
};

export const PODIUM = {
  won: 'Дедлайн повержен',
  lost: 'Дедлайн победил',
  ended: 'Игра закончена',
  stats: (questions: number, players: number, pct: number | null) =>
    [count(questions, QUESTIONS), count(players, PLAYERS), pct === null ? null : `верных ответов ${pct}${NBSP}%`].filter(Boolean).join(' · '),
  dmg: (n: number) => `${nb(n)} урона`,
  review: 'Разбор',
  again: 'Ещё раз',
  finish: 'Закончить игру',
  finished: 'Игра закончена. Разбор у каждого ученика в игре ещё 7 дней.',
};

export const NEXT = {
  lobby: LOBBY.start,
  reveal: 'Дальше',
  revealLast: 'Итог',
  leaderboard: 'Следующий вопрос',
  podium: PODIUM.finish,
  key: 'Пробел',
};

export const REVIEW = {
  title: 'Разбор',
  questions: 'Вопросы',
  students: 'Ученики',
  close: 'Закрыть',
  right: (r: number, n: number) => `Верно ${nb(r)} из ${nb(n)}`,
  none: 'Вопросов пока не было.',
  missing: 'Этот вопрос шёл, пока экран был закрыт.',
  place: 'Место',
  name: 'Имя',
  rightCol: 'Верных',
  dmg: 'Урон',
  of: (r: number, n: number) => `${r} из ${n}`,
  note: 'Свои ответы по каждому вопросу ученик видит у себя в игре.',
};

export const PLAYERS_SHEET = {
  title: (n: number) => `Игроки · ${nb(n)}`,
  kick: 'Убрать',
  kickAsk: (name: string) => `Убрать ${name} из игры?`,
  kickWhy: 'Ученик больше не сможет отвечать. Его урон останется в общем счёте.',
  kickYes: 'Убрать',
  cancel: 'Отмена',
  close: 'Закрыть',
  empty: 'Пока никого.',
  dmg: (n: number) => `${nb(n)} урона`,
  frozen: 'заморожен',
};

export const END = {
  ask: 'Закончить игру?',
  why: 'Ученики больше не смогут отвечать. Разбор останется у каждого.',
  yes: 'Закончить',
  cancel: 'Отмена',
};

export const SCREEN = {
  loading: 'Подключаемся к игре…',
  notoken: 'Эту игру ведут с другого устройства',
  notokenWhy: 'Откройте её там, где нажали «Открыть комнату». Или начните новую игру.',
  notfound: 'Игра не найдена',
  notfoundWhy: 'Возможно, она уже закончилась.',
  denied: 'Нет доступа к этой игре',
  deniedWhy: 'Откройте её на том устройстве, где её создали.',
  error: 'Не получилось открыть игру',
  retry: 'Повторить',
  home: 'К экзаменам',
};

/** The entry on a test's page. */
export const ENTRY = {
  host: 'Провести игру',
};
