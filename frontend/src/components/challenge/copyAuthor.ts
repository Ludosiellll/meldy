/**
 * The author's words of «Соревнование в своё время» (docs/live/CHALLENGE.md): the setup at /live/challenge?c=<test>, the
 * challenge's page /live/challenge/<id> (the link, the QR, the results, «Закрыть досрочно»), and its entries on «Игры»,
 * the test's page and the game's setup. Plain sentences, no exclamation marks.
 */
import { NBSP, plural } from '../live/player/copy';
import type { DeadlinePreset } from '../../lib/challenge/rules';

const QUESTIONS = (n: number) => `${n}${NBSP}${plural(n, 'вопрос', 'вопроса', 'вопросов')}`;

export const CHALLENGE_ENTRY = {
  /** Beside «Начать игру» and «Провести игру». */
  action: 'Соревнование по ссылке',
  /** On the game's setup: the other way to play the same test. */
  setupLink: 'Без проектора: соревнование по ссылке',
};

export const CSETUP = {
  top: 'Соревнование по ссылке',
  title: (name: string) => `Соревнование по тесту «${name}»`,
  titleNone: 'Соревнование по тесту',
  lead: (n: number) =>
    `${QUESTIONS(n)}. Каждый проходит сам, когда удобно, с телефона или компьютера, до срока. Входить в аккаунт не нужно. Таблица лидеров открывается по той же ссылке.`,
  loading: 'Загружаем вопросы…',
  failed: 'Не получилось загрузить вопросы.',
  retry: 'Повторить',
  deadline: 'Срок',
  deadlineHint: (text: string) => `Открыто до ${text}`,
  deadlineOption: { hour: 'Час', today: 'Сегодня', days3: '3 дня', week: 'Неделя', weeks2: '2 недели', custom: 'Другая дата' } as Record<DeadlinePreset | 'custom', string>,
  deadlineCustom: 'Дата и время',
  deadlineBad: 'Срок — от 5 минут до 30 дней.',
  time: 'Время на вопрос',
  timeOption: (s: number) => `${s}${NBSP}с`,
  calm: 'Без спешки',
  calmHint: 'Очки только за верные ответы: без бонуса за скорость и серию, никто не замерзает.',
  calmOn: 'Да',
  calmOff: 'Нет',
  speed: 'Очки за скорость',
  speedOn: 'Да',
  speedOff: 'Нет',
  /** When a person sees the keys and the explanations. */
  reveal: 'Верный ответ',
  revealEach: 'После каждого вопроса',
  revealEnd: 'В конце',
  /** The one line that names what no setting can stop. */
  revealHint: 'Порядок вариантов у каждого свой. Но кто пройдёт второй раз с другого устройства, будет знать ответы.',
  amount: 'Вопросов',
  amountAll: (n: number) => `все ${n}`,
  amountHint: 'Каждый получит одни и те же вопросы в одном порядке.',
  skippedHead: (n: number) => `${QUESTIONS(n)} не ${plural(n, 'войдёт', 'войдут', 'войдут')} в соревнование`,
  skippedWhy: 'Идут вопросы с 2–6 вариантами и с ответом словами или числом, без картинок.',
  reason: {
    picture: 'Есть картинка.',
    options: 'Вариантов меньше двух или больше шести.',
  },
  tooFew: 'Нужно хотя бы 3 подходящих вопроса. Добавьте их в тест.',
  foot: 'После каждого вопроса участник увидит верный ответ и пояснение. Ответы на другие вопросы теста он не увидит.',
  create: 'Создать ссылку',
  creating: 'Создаём…',
  error: {
    ML008: 'В тесте нет вопросов для соревнования: нужны вопросы с вариантами или с ответом словами или числом, без картинок.',
    ML009: 'У вас уже 20 открытых соревнований. Закройте одно из них.',
    ML005: 'Слишком много соревнований за час. Попробуйте позже.',
    '42501': 'Создать соревнование может только автор теста.',
    '28000': 'Войдите, чтобы создать соревнование.',
    '22023': 'Проверьте срок: от 5 минут до 30 дней.',
    network: 'Нет связи. Проверьте интернет и попробуйте ещё раз.',
    other: 'Не получилось создать ссылку. Попробуйте ещё раз.',
  } as Record<string, string>,
};

export const CPAGE = {
  top: 'Соревнование по ссылке',
  loading: 'Загружаем результаты…',
  failed: 'Не получилось загрузить результаты.',
  retry: 'Повторить',
  notMine: 'Это соревнование другого автора.',
  link: 'Ссылка для участников',
  copy: 'Скопировать',
  copied: 'Скопировано',
  qr: 'Показать QR',
  qrTitle: (title: string) => `Соревнование «${title}»`,
  open: 'Открыть как участник',
  close: 'Закрыть досрочно',
  closing: 'Закрываем…',
  closeAsk: 'Закрыть соревнование сейчас? Новые участники не смогут начать. Кто уже отвечает на вопрос, успеет его закончить.',
  closeYes: 'Закрыть',
  closeNo: 'Оставить открытым',
  state: {
    open: (d: string) => `Открыто до ${d}`,
    closed: (d: string) => `Закрыто досрочно ${d}`,
    deadline: (d: string) => `Срок вышел ${d}`,
  },
  meta: (n: number, t: number, calm: boolean, end = false) =>
    `${QUESTIONS(n)} · ${t}${NBSP}с на вопрос · ${calm ? 'без спешки' : 'очки за скорость'}${end ? ' · ответы в конце' : ''}`,
  finished: (n: number) => `Прошли: ${n}`,
  playing: (n: number) => `Играют сейчас: ${n}`,
  table: 'Результаты',
  empty: 'Пока никто не начал. Отправьте ссылку классу или покажите QR-код.',
  head: { place: 'Место', name: 'Имя', points: 'Очки', right: 'Верных', time: 'Время' },
  underway: (answered: number, n: number) => `идёт, ${answered} из ${n}`,
  notStarted: 'не начал',
  removed: 'убран',
  remove: 'Убрать',
  removeAsk: (name: string) => `Убрать «${name}» из таблицы? Этот участник больше не сможет играть по ссылке.`,
  removeYes: 'Убрать',
  questions: 'Вопросы',
  questionLine: (right: number, answered: number) => (answered > 0 ? `верно ${right} из ${answered}` : 'ещё никто не ответил'),
  hard: 'труднее всего',
  back: 'К тесту',
  games: 'Все игры',
};

export const CLIST = {
  title: 'Соревнования по ссылке',
  empty: 'Здесь появятся соревнования по ссылке: каждый проходит тест сам, до срока, а таблица лидеров собирается по мере ответов.',
  loading: 'Загружаем…',
  failed: 'Не получилось загрузить список.',
  retry: 'Повторить',
  open: (d: string) => `открыто до ${d}`,
  over: 'закончилось',
  finished: (n: number) => `прошли ${n}`,
  playing: (n: number) => `играют ${n}`,
  leader: (name: string) => `первое место: ${name}`,
};
