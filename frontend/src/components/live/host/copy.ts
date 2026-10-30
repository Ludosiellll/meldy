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
export const LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е'] as const;

const BATTLE_LEAD = 'Весь класс бьёт монстра верными ответами.';

export const MODE = {
  name: 'Битва с монстром',
  about: `${BATTLE_LEAD} За ошибку игрок замерзает.`,
};

export const SETUP = {
  top: 'Провести игру',
  title: (name: string) => `Игра по тесту «${name}»`,
  titleNone: 'Игра по тесту',
  lead: (n: number) =>
    `${count(n, QUESTIONS)} в игре. Откройте игру на проекторе или большом экране. Ученики войдут с телефона по PIN или QR-коду, на сайте или в Telegram.`,
  loading: 'Загружаем вопросы…',
  failed: 'Не получилось загрузить вопросы.',
  retry: 'Повторить',
  game: 'Какая игра',
  /** The setup's one choice of the game (docs/live/MODE_MIXED.md §1): none, every Nth question, or all of them. */
  mini: 'Мини-игра с движением',
  miniOption: { none: 'Нет', 3: 'Каждые 3 вопроса', 5: 'Каждые 5 вопросов', 10: 'Каждые 10 вопросов', all: 'Все вопросы' } as Record<string, string>,
  /**
   * The battle with movement rounds, told by its questions (`standRounds`): «На вопросах 3 и 6 ученики бегут на
   * верный ответ.»; more than four rounds by the rule instead.
   */
  mixedAbout: (every: number, rounds: readonly number[]) => {
    const run = 'ученики бегут на верный ответ.';
    if (rounds.length === 0 || rounds.length > 4) return `${BATTLE_LEAD} На каждом ${every}-м вопросе ${run}`;
    const n = rounds.map((qi) => qi + 1);
    const list = n.length === 1 ? `вопросе ${n[0]}` : `вопросах ${n.slice(0, -1).join(', ')} и ${n[n.length - 1]}`;
    return `${BATTLE_LEAD} На ${list} ${run}`;
  },
  boss: 'Босс',
  time: 'Время на вопрос',
  timeOption: (s: number) => `${s}${NBSP}с`,
  speed: 'Очки за скорость',
  speedOn: 'Да',
  speedOff: 'Нет',
  who: 'Кто играет',
  whoPin: 'Все по PIN',
  whoMembers: 'Только участники экзамена',
  names: 'Назвать в чате трёх лучших',
  namesHint: 'В конце игры бот назовёт в беседе Telegram трёх лучших. Иначе только общий итог.',
  namesOff: 'Нет',
  namesOn: 'Да',
  amount: 'Вопросов',
  amountAll: (n: number) => `все ${n}`,
  skippedHead: (n: number) => `${count(n, QUESTIONS)} ${plural(n, ['не войдёт', 'не войдут', 'не войдут'])} в игру`,
  skippedWhyWide: 'В игру идут вопросы с одним верным ответом и 2–6 вариантами.',
  // why a question is not in the game: each a short sentence of its own under the question
  reason: {
    multiple: 'Несколько верных ответов.',
    short: 'Ответ вводят сами.',
    options: 'Вариантов меньше двух или больше четырёх.',
    nokey: 'Нет верного ответа.',
    picture: 'Есть картинка.',
  },
  reasonOptionsWide: 'Вариантов меньше двух или больше шести.',
  tooFew: 'Для игры нужно хотя бы 3 подходящих вопроса. Добавьте их в тест.',
  foot: 'Гости увидят верный ответ после каждого вопроса. Ответы на другие вопросы экзамена они не увидят.',
  open: 'Открыть комнату',
  opening: 'Открываем…',
  signIn: 'Войдите, чтобы провести игру.',
  back: 'К тесту',
  error: {
    ML008: 'В тесте нет вопросов для игры. Нужны вопросы с одним верным ответом и 2–6 вариантами (с мини-игрой — 2–4, без картинок).',
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
  sound: 'Звук',
  soundOn: 'Включить звук',
  soundOff: 'Выключить звук',
  fullscreen: 'Во весь экран',
  fullscreenOff: 'Выйти из полного экрана',
  end: 'Закончить',
  offline: 'Нет связи, пробуем снова',
};

export const LOBBY = {
  how: 'Как войти в игру',
  go: 'Заходите на',
  pin: 'PIN игры',
  camera: 'Или наведите камеру телефона на код.',
  tg: (title: string) => `В Telegram — кнопка «Играть» в беседе ${title ? `«${title}»` : 'группы'}.`,
  later: 'Войти можно и после начала.',
  players: 'Игроки',
  count: (n: number) => ({ n: nb(n), word: plural(n, PLAYERS) }),
  waiting: 'Ждём игроков',
  waitingHint: 'Они появятся здесь, как только войдут.',
  more: (n: number) => `и ещё ${nb(n)}`,
  start: 'Начать',
  /** `rounds`: a battle's movement rounds (qi), told at the end («мини-игра на вопросах 3 и 6»). */
  settings: (time: number, speed: boolean, members: boolean, rounds?: readonly number[]) =>
    [
      `${time}${NBSP}с на вопрос`,
      speed ? 'очки за скорость' : 'только верность',
      members ? 'только участники экзамена' : 'все по PIN',
      ...(rounds && rounds.length ? [MIXED.rounds(rounds)] : []),
    ].join(' · '),
};

const chatName = (title: string | null) => (title ? `«${title}»` : 'без названия');

/**
 * The game's post into the exam's Telegram group (`live_tg_post`, W1 20.10), from the lobby: a compact control of the
 * teacher's. The way to bind a chat is told only when pressed with none bound — the class never reads it.
 */
export const TG = {
  send: 'Отправить в беседу',
  sendTo: (title: string | null) => `Отправить в беседу ${chatName(title)}`,
  sending: 'Отправляем…',
  sent: (title: string | null) => `Пост в беседе ${chatName(title)}`,
  posted: (title: string | null) => `Пост отправлен в беседу ${chatName(title)}`,
  pick: 'В какую беседу?',
  none: 'К этому тесту не подключена ни одна беседа. Подключить: страница теста → «⋯» → «Пригласить группу» → «Подключить беседу». Ученики пока входят по PIN.',
  failed: 'Не получилось узнать, какие беседы подключены.',
  retry: 'Повторить',
  close: 'Закрыть',
  wait: (s: number | null) => (s ? `Пост уже отправлен. Следующий можно через ${s} с.` : 'Пост уже отправлен. Следующий можно через минуту.'),
  error: {
    '28000': 'Войдите на сайт, чтобы отправить пост в беседу.',
    '42501': 'Отправить пост может только автор теста.',
    game: 'Игра не найдена.',
    group: 'Эта беседа не подключена к тесту.',
    ML002: 'Игра уже закончилась.',
    ML010: 'Бот Meldy пока не настроен для бесед. Ученики входят по PIN.',
    network: 'Нет связи. Попробуйте ещё раз.',
    other: 'Не получилось отправить пост. Попробуйте ещё раз.',
  } as Record<string, string>,
};

export const BATTLE = {
  boss: 'Дедлайн',
  hp: (hp: number, max: number) => `${nb(hp)} из ${nb(max)}`,
  phaseNote: ['', 'Злится: замораживает и тех, кто не ответил', 'Последняя минута: если верных меньше ⅔, лечится на 5 %'] as const,
  strikeLabel: 'Больше всех урона за вопрос',
  ready: 'Приготовьтесь',
  answered: 'ответили',
  right: 'верно',
  of: (n: number) => `из ${nb(n)}`,
  timeUp: 'Время вышло',
  allIn: 'Все ответили',
  more: (n: number) => `+${nb(n)}`,
};

/**
 * A battle's movement rounds on the projector (docs/live/MODE_MIXED.md §8): the arena over the battle, its board, the
 * hits on the boss after the stomp, and when the next one comes.
 */
export const MIXED = {
  /** The board's line over a movement round's question. */
  hint: 'Мини-игра. Встаньте на верный ответ.',
  /** In the bar during the battle's questions: when the next movement round comes (k button questions before it). */
  soon: (k: number) => (k === 0 ? 'Следующий вопрос с мини-игрой' : `Мини-игра через ${count(k, QUESTIONS)}`),
  /** The lobby's settings line: which questions are movement rounds. */
  rounds: (rounds: readonly number[]) => {
    const n = rounds.map((qi) => qi + 1);
    if (n.length === 0) return '';
    if (n.length === 1) return `мини-игра на вопросе ${n[0]}`;
    if (n.length > 4) return `мини-игра на каждом ${n[0]}-м вопросе`;
    return `мини-игра на вопросах ${n.slice(0, -1).join(', ')} и ${n[n.length - 1]}`;
  },
  stood: (n: number, of: number) => ({ before: 'Попали ', n: nb(n), after: ` из ${nb(of)}` }),
  nobody: 'Никто не попал',
  fastest: (name: string, dmg: number) => `Быстрее всех ${name}, −${nb(dmg)}`,
  playing: 'Играют',
  frozen: 'Заморожены',
  /** Under the bar after the hits: the round's three who hit hardest (the battle's own line). */
  strikeLabel: 'Больше всех урона за мини-игру',
  void: { title: 'Мини-игра не засчитана', sub: 'Связь с игрой пропала. Урон и лёд не изменились.' },
  loading: 'Загружаем арену…',
  lost: 'Связь с ареной пропала. Подключаемся.',
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
  stats: (questions: number, players: number, pct: number) => [count(questions, QUESTIONS), count(players, PLAYERS), `верных ответов ${pct}${NBSP}%`].join(' · '),
  /** The teacher ended the game early: the questions that closed, of how many. */
  statsStopped: (questions: number, of: number, players: number, pct: number) =>
    [`${count(questions, QUESTIONS)} из ${nb(of)}`, count(players, PLAYERS), `верных ответов ${pct}${NBSP}%`].join(' · '),
  dmg: (n: number) => `${nb(n)} урона`,
  review: 'Разбор',
  again: 'Ещё раз',
  finish: 'Закончить игру',
  finished: 'Игра закончена. Разбор у каждого ученика в игре ещё 7 дней.',
};

/** Ended before any question closed. */
export const CLOSED = {
  title: 'Игра закрыта',
  why: 'Войти в неё по этому PIN больше нельзя.',
  back: 'К тесту',
  again: 'Новая игра',
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
