/**
 * The bot's own words (spec §3–§5; the container's v2.1/v2.2 words override older lines: no «сгорело», a hard budget,
 * «знакомые», plan and count lines from the copied words.ts). Every plan and count line comes from
 * `../plan/words.ts`; numbers here are worded only through its `glue` / `plural` / `dayText`.
 *
 * The strings are plain text: builders glue and escape them (html.ts). Comments stay in English: a test reads the
 * Russian strings for forbidden words.
 */
import { dayText, glue, plural } from '../plan/words.ts';
import { weekday } from '../plan/time.ts';
import type { LocalDay } from '../plan/container.ts';

export const SITE = 'https://ludosiel-studyforge.hf.space';
export const BOT_USERNAME = 'Meldyteach_bot';

export const PATH = {
  profile: '/profile#telegram',
  upload: '/exams/import',
  exam: (id: string) => `/exams/c/${id}`,
  examSettings: (id: string) => `/exams/c/${id}/settings`,
};

// ─────────────────────────────────────────── §4.1 linking ───────────────────────────────────────────

export const OPEN_PROFILE = 'Открыть профиль Meldy';
export const M1 = [
  'Здесь будет план на каждый день и вопросы вашего экзамена — по 20 за раз, ответ кнопкой.',
  '',
  'Для этого один раз подключите Meldy: в профиле на сайте — «Подключить Telegram».',
];
export const M2_TITLE = 'Telegram подключён к Meldy.';
export const examIs = (title: string, date: LocalDay | null) =>
  date ? `Экзамен — «${title}», ${dayText(date)}.` : `Экзамен — «${title}», дата не указана.`;
export const NO_EXAM = 'В Meldy пока нет экзамена с планом на день.';
export const NO_EXAM_UPLOAD = 'В Meldy пока нет экзамена с планом на день. Загрузите вопросы — файл на каждый предмет или один на все.';
export const UPLOAD = 'Загрузить вопросы';
export const m2Time = (time: string) => `Раз в день бот пришлёт план на сегодня, если в нём что-то есть. Во сколько? Пока стоит ${time}.`;
/** The quick times of M2 and S2, in minutes after midnight. */
export const TIME_OPTIONS: readonly number[] = [7 * 60 + 30, 19 * 60, 20 * 60, 21 * 60];
export const OTHER_TIME = 'Другое время';
export const m3Title = (time: string) => `Готово: план на день — в ${time}.`;
export const M3_SETTINGS = 'Время и пауза — /settings';
export const TIME_PROMPT = 'Напишите время, например 7:45.';
export const TIME_PLACEHOLDER = 'Например, 7:45';
export const TIME_BAD = 'Время не распознано. Напишите так: 7:45.';
export const TIME_RANGE = 'Напоминание можно поставить с 7:00 до 22:59.';
/** The earliest and the latest reminder (the bot is quiet from 23:00 to 7:00). */
export const TIME_MIN = 7 * 60;
export const TIME_MAX = 22 * 60 + 59;
export const LINK_USED = 'Эта ссылка уже использована. В профиле Meldy нажмите «Подключить Telegram» ещё раз.';
export const LINK_EXPIRED = 'Ссылка устарела: она действует 15 минут. В профиле Meldy нажмите «Подключить Telegram» ещё раз.';
export const LINK_INVALID = 'Ссылка не подошла. В профиле Meldy нажмите «Подключить Telegram».';
export const LINK_SLOW = 'Слишком много попыток. Попробуйте через час.';
export const LINK_MOVED = 'Meldy подключили к другому Telegram — сюда план больше не придёт.';

// ─────────────────────────────────────────── §4.2 the day card ───────────────────────────────────────────

export const START = 'Начать';
export const OPEN_IN_MELDY = 'Открыть в Meldy';
export const SET_DATE = 'Указать дату';
export const OTHER_EXAM = 'Другой экзамен';
export const BACK = '‹ Назад';
export const NEW_DATE = 'Новая дата';
export const EXAM_EVE = 'Завтра экзамен.';
export const NO_DATE = 'дата не указана';
export const onlyErrors = (n: number) => `Только ошибки: ${n}`;
export const throughErrors = (n: number) => `Пройтись по ошибкам: ${n}`;
export const resume = (n: number, of: number) => `Продолжить: ${n} из ${of}`;
/** «3 ноября, через 18 дней», «3 ноября, завтра», «3 ноября, сегодня». */
export function dateWhen(date: LocalDay, daysLeft: number): string {
  if (daysLeft === 0) return `${dayText(date)}, сегодня`;
  if (daysLeft === 1) return `${dayText(date)}, завтра`;
  if (daysLeft < 0) return dayText(date);
  return `${dayText(date)}, через ${glue(daysLeft, 'день', 'дня', 'дней')}`;
}
export const examLine = (title: string, when: string | null) => `${title} · ${when ?? NO_DATE}`;
export const aboutMinutes = (minutes: number) => `около ${glue(Math.max(1, minutes), 'минуты', 'минут', 'минут')}`;
export const alsoToday = (title: string, minutes: number) => `Ещё сегодня: «${title}» — ${aboutMinutes(minutes)}.`;
export const keysFixed = (n: number) =>
  `Автор исправил ключ в ${glue(n, 'вопросе', 'вопросах', 'вопросах')} — ${plural(n, 'он начнётся', 'они начнутся', 'они начнутся')} заново.`;
/** «Ещё 20 новых» (words.ts more_new) + why it helps. */
export const moreNewNote = (moreNew: string) => `${moreNew} сейчас — завтра их будет меньше.`;

// K2
export const K2_TITLE = 'Присылать план дальше?';
export function k2Body(daysLeft: number | null, minutes: number): string {
  const exam = daysLeft !== null && daysLeft > 0 ? ` До экзамена ${glue(daysLeft, 'день', 'дня', 'дней')},` : '';
  return exam ? `Три дня он оставался без ответа.${exam} сегодня ${aboutMinutes(minutes)}.` : `Три дня он оставался без ответа. Сегодня ${aboutMinutes(minutes)}.`;
}
export const k2Yes = (time: string) => `Да, в ${time}`;
export const PAUSE = 'Пауза';
export const DONT_SEND = 'Не присылать';
export const k2YesDone = (time: string) => `Хорошо: план — каждый день в ${time}.`;
export const K2_NO_DONE = 'План больше не придёт. Включить снова — /settings.';

// K3
export const examPassed = (date: LocalDay) => `Экзамен прошёл ${dayText(date)}.`;
export function k3Days(days: number, studyDays: number, answers: string, answersN: number): string {
  return `За ${glue(days, 'день', 'дня', 'дней')} — ${studyDays} с занятиями, ${answers} ${plural(answersN, 'ответ', 'ответа', 'ответов')}.`;
}
export const k3Figure = (twoDays: number, inPlan: number) => `${twoDays} из ${inPlan} — верно в два разных дня.`;
export const K3_LAST = 'По этому экзамену бот больше не напишет. Экзамен и счёт остаются в Meldy.';

// ─────────────────────────────────────────── §4.5 pause, settings, help ───────────────────────────────────────────

export const SETTINGS_TITLE = 'Настройки';
export const planAt = (time: string, zone: string) => `План на день — в ${time} ${zone}.`;
export const PLAN_OFF = 'План на день сейчас не приходит. Чтобы он снова приходил, выберите время.';
export const TIME = 'Время';
export const UNPAUSE = 'Снять паузу';
export const UNLINK_TG = 'Отключить Telegram';
export const S2_TITLE = 'Во сколько присылать план?';
export const S3_TITLE = 'Пауза';
export const S3_BODY = 'До какого дня ничего не присылать? Вопросы разойдутся по следующим дням.';
export const PAUSE_1 = 'До завтра';
export const PAUSE_3 = 'На 3 дня';
export const PAUSE_MON = 'До понедельника';
export const PAUSE_DATE = 'Другая дата';
export const DATE_PROMPT = 'Напишите дату, например 25.10.';
export const DATE_PLACEHOLDER = 'Например, 25.10';
export const DATE_BAD = 'Дата не распознана. Напишите так: 25.10.';
export const DATE_PAST = 'Эта дата уже прошла. Напишите будущую.';
export const dateAfterExam = (date: LocalDay) => `Эта дата позже экзамена ${dayText(date)}. Напишите дату до него.`;
export const S4_TITLE = 'Отключить Telegram от Meldy?';
export const S4_BODY = 'План перестанет приходить, ответы здесь не будут сохраняться. Экзамен и счёт останутся в Meldy.';
export const UNLINK = 'Отключить';
export const CANCEL = 'Отмена';
export const UNLINKED_DONE = 'Telegram отключён от Meldy. Подключить снова можно в профиле на сайте.';
export const HELP_TITLE = 'Как это работает';
export const HELP = [
  'Раз в день, в выбранное время, бот присылает план на сегодня, если в нём что-то есть. «Начать» открывает занятие: 20 вопросов одного предмета.',
  '',
  'Нажали вариант — сразу видно, верно ли. Ошибка вернётся через пару вопросов и завтра. В счёт идёт вопрос, на который вы ответили верно в два разных дня, между ответами — не меньше 20 часов. Так же считает сайт.',
  '',
  'Ключ — ответ из файла. Не согласны — «Сомневаюсь в ключе» после ответа.',
  '',
  '/today — план на сегодня',
  '/settings — время и пауза',
  '/stop — отключить бота',
];
export const BUTTONS_ONLY = 'Здесь отвечают кнопками. План на сегодня — /today.';

const WEEKDAY_GEN = ['понедельника', 'вторника', 'среды', 'четверга', 'пятницы', 'субботы', 'воскресенья'];
const WEEKDAY_ACC = ['В понедельник', 'Во вторник', 'В среду', 'В четверг', 'В пятницу', 'В субботу', 'В воскресенье'];

/** «до завтра» / «до понедельника, 19 октября». */
export function pauseUntil(until: LocalDay, tomorrow: LocalDay): string {
  return until === tomorrow ? 'Пауза до завтра.' : `Пауза до ${WEEKDAY_GEN[weekday(until)]}, ${dayText(until)}.`;
}
/** «Завтра план снова придёт в 20:00…» / «В понедельник…» within a week, else «В воскресенье, 25 октября, …». */
export function pauseBack(until: LocalDay, tomorrow: LocalDay, daysAhead: number, time: string): string {
  const when = until === tomorrow ? 'Завтра' : daysAhead <= 6 ? WEEKDAY_ACC[weekday(until)] : `${WEEKDAY_ACC[weekday(until)]}, ${dayText(until)},`;
  return `${when} план снова придёт в ${time}. Заниматься можно и раньше — /today.`;
}
export const unpaused = (todayOrTomorrow: 'сегодня' | 'завтра', time: string) => `Пауза снята: план придёт ${todayOrTomorrow} в ${time}.`;

/** «по Минску» for frequent zones, else the IANA name (spec S1). */
const ZONES: Record<string, string> = {
  'Europe/Minsk': 'по Минску',
  'Europe/Moscow': 'по Москве',
  'Europe/Kaliningrad': 'по Калининграду',
  'Europe/Samara': 'по Самаре',
  'Europe/Volgograd': 'по Волгограду',
  'Europe/Kyiv': 'по Киеву',
  'Europe/Kiev': 'по Киеву',
  'Europe/Vilnius': 'по Вильнюсу',
  'Europe/Riga': 'по Риге',
  'Europe/Tallinn': 'по Таллину',
  'Europe/Warsaw': 'по Варшаве',
  'Europe/Berlin': 'по Берлину',
  'Europe/London': 'по Лондону',
  'Europe/Chisinau': 'по Кишинёву',
  'Asia/Yekaterinburg': 'по Екатеринбургу',
  'Asia/Omsk': 'по Омску',
  'Asia/Novosibirsk': 'по Новосибирску',
  'Asia/Krasnoyarsk': 'по Красноярску',
  'Asia/Irkutsk': 'по Иркутску',
  'Asia/Yakutsk': 'по Якутску',
  'Asia/Vladivostok': 'по Владивостоку',
  'Asia/Magadan': 'по Магадану',
  'Asia/Kamchatka': 'по Камчатке',
  'Asia/Almaty': 'по Алматы',
  'Asia/Tashkent': 'по Ташкенту',
  'Asia/Bishkek': 'по Бишкеку',
  'Asia/Tbilisi': 'по Тбилиси',
  'Asia/Yerevan': 'по Еревану',
  'Asia/Baku': 'по Баку',
};
export const zoneText = (tz: string) => ZONES[tz] ?? `(${tz})`;

// ─────────────────────────────────────────── §4.8 failures and old buttons ───────────────────────────────────────────

export const DB_DOWN_TAP = 'Meldy сейчас не отвечает, ответ не записан. Нажмите ещё раз через минуту.';
export const DB_DOWN_AGAIN = 'Meldy сейчас не отвечает, ответ не записан. Нажмите «Повторить» через минуту — ответ не потеряется.';
export const RETRY = 'Повторить';
export const OLD_BUTTON = 'Этот вопрос уже закрыт — занятие в последнем сообщении.';
export const SESSION_OVER = 'Это занятие уже закончено.';
export const KEY_STALE = 'Автор исправил ключ в этом вопросе. Ответ не записан — вопрос начнётся заново.';
export const ITEM_GONE = 'Этого вопроса больше нет в экзамене. Вот следующий.';
export const examGone = (title: string) => `Экзамен «${title}» больше недоступен — занятие закрыто.`;
export const NOT_LINKED = 'Telegram отключён от Meldy. Подключить снова можно в профиле.';

// ─────────────────────────────────────────── §5 the profile ───────────────────────────────────────────

export const PROFILE = {
  name: 'Meldy',
  shortDescription: 'План на день и вопросы вашего экзамена, по 20 за раз. Работает с аккаунтом Meldy.',
  description: [
    'Meldy раз в день присылает план: сколько вопросов и минут на сегодня. Вопросы с вариантами можно решать здесь же, по 20 за раз: нажали вариант — сразу видно, верно ли, а ошибка вернётся через пару вопросов и завтра.',
    'Вопрос входит в счёт, когда вы ответили на него верно в два разных дня — как на сайте. Ключ — ответ из файла.',
    'Нужен аккаунт Meldy. Загрузка вопросов, шпаргалка и лекции — на сайте.',
  ].join('\n\n'),
  commands: [
    { command: 'today', description: 'План на сегодня' },
    { command: 'settings', description: 'Время и пауза' },
    { command: 'help', description: 'Как это работает' },
  ],
};
