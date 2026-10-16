/**
 * Every Russian line of the exam's screens (spec 2026-10-09 §16 #45: one source of words). The plan's own lines
 * («Сегодня около 45 минут: 30 новых и 60 знакомых», the skipped day, the final days) live in lib/containers/words.ts;
 * this file holds what the exam page, the subject page, the «занятие», «Как на экзамене», the end of a session and the
 * «Сегодня» card say. copy.test.ts fails on the banned words of §16 #45.
 *
 * Numbers and the word after them are glued with a no-break space (`glue`), so «90 вопросов» never breaks.
 */
import { ALL_QUESTIONS_MIN } from '../../lib/containers/plan';

export const NBSP = String.fromCharCode(0xa0);

/** Russian plural: one (1, 21, 101), few (2–4, 22–24), many (0, 5–20, 11–14). */
export function pl(n: number, one: string, few: string, many: string): string {
  const a = Math.abs(Math.trunc(n)) % 100;
  const b = a % 10;
  if (a >= 11 && a <= 14) return many;
  if (b === 1) return one;
  if (b >= 2 && b <= 4) return few;
  return many;
}

/** «7 вопросов», «7 из 20» and «· …» never break inside; a short preposition keeps the next word. */
export function glue(text: string): string {
  const short = /(^|\s)(в|во|к|ко|с|со|у|о|об|и|а|на|по|за|из|до|не|но|от|без|для|при) /gi;
  return text
    .replace(/(\d) (?=[а-яёА-ЯЁa-zA-Z%№«])/g, `$1${NBSP}`)
    // Twice: «и в два» has two short words in a row, and a match takes the space it ends with.
    .replace(short, `$1$2${NBSP}`)
    .replace(short, `$1$2${NBSP}`)
    .replace(/ ·/g, `${NBSP}·`)
    .replace(/№ /g, `№${NBSP}`)
    .replace(/ —/g, `${NBSP}—`);
}

export const q = (n: number) => `${n} ${pl(n, 'вопрос', 'вопроса', 'вопросов')}`;
/** «около 45 минут». */
const minGen = (n: number) => `${n} ${pl(n, 'минуты', 'минут', 'минут')}`;
/** «за 11 минут». */
const minAcc = (n: number) => `${n} ${pl(n, 'минуту', 'минуты', 'минут')}`;
/** «45 минут в день», «34 минуты». */
export const minNom = (n: number) => `${n} ${pl(n, 'минута', 'минуты', 'минут')}`;

export const TWO_DAYS = 'верно в два разных дня';
/** « · » between parts of a line: the dot stays with the word before it when the line wraps. */
export const SEP = `${NBSP}· `;

// ─────────────────────────────────────────────── the exam page and the subject page

export const LOADING = 'Загружаем экзамен…';
export const LOAD_FAILED = 'Не удалось загрузить экзамен';
export const RETRY = 'Повторить';
export const UNAVAILABLE_TITLE = 'Экзамен пока не открывается';
export const UNAVAILABLE_TEXT = 'Эта часть Meldy ещё обновляется. Загляните чуть позже.';
export const TO_EXAMS = 'Экзамены';
export const SUBJECT_MISSING = 'Такого предмета в экзамене нет.';

/** The meta's day: «28 октября, через 19 дней», «28 октября, завтра», «Экзамен прошёл 28 октября». */
export function examDay(dayText: string, days: number | null): string {
  if (days === null) return dayText;
  if (days < 0) return `Экзамен прошёл ${dayText}`;
  if (days === 0) return `${dayText}, сегодня`;
  if (days === 1) return `${dayText}, завтра`;
  return `${dayText}, через ${days} ${pl(days, 'день', 'дня', 'дней')}`;
}

/** Several dates: «с 25 по 28 октября, через 15 дней» (the span from the nearest date to the last). */
export function examSpan(fromText: string, toText: string, days: number | null): string {
  const span = `с ${fromText} по ${toText}`;
  if (days === null || days < 0) return span;
  if (days === 0) return `${span}, первый сегодня`;
  if (days === 1) return `${span}, первый завтра`;
  return `${span}, через ${days} ${pl(days, 'день', 'дня', 'дней')}`;
}

export const NO_DATE = 'Дата не указана';
export const subjectsCount = (n: number) => `${n} ${pl(n, 'предмет', 'предмета', 'предметов')}`;

/** The meta line: one line on a phone without the number of subjects (decision 46). */
export function metaLine(day: string, questions: number, subjects: number | null): string {
  const size = subjects && subjects > 1 ? `${subjectsCount(subjects)}, ${q(questions)}` : q(questions);
  return glue(`${day}${SEP}${size}`);
}

// The plan card (decision 46): the title and the lines are the plan's words (lib/containers/words.ts).
export const PLAN_BY_DAYS = 'План по дням';
export const ONLY_ERRORS = (n: number) => glue(`Только ошибки: ${n}`);
export const MOCK_LINK = 'Как на экзамене';
export const SUBJECT_DONE = 'На сегодня здесь всё.';
export const EXAM_TODAY = 'Сегодня экзамен.';
export const SET_NEW_DATE = 'Поставить новую дату';
export const DELETE_EXAM_LINK = 'Удалить экзамен';
export const AFTER_EXAM = 'Экзамен прошёл.';
export const SET_DATE = 'Указать дату';
export const CHANGE_MINUTES = 'Изменить время';
// The figure (decision 8, 46): its words are the plan's (words.ts figureLines); «Как считается» is the screen's.
export const HOW_COUNTED = 'Как считается';
/** «Как считается», with the intervals of the rule (lib/containers/rule.ts DUE_DAYS). */
export function howCounted(dueDays: readonly number[]): string[] {
  const days = dueDays.length > 1 ? `${dueDays.slice(0, -1).join(', ')} и ${dueDays[dueDays.length - 1]}` : String(dueDays[0] ?? 5);
  return [
    'В счёт идёт вопрос, на который вы ответили верно в два разных дня — между ответами не меньше 20 часов. Ошибка начинает счёт заново.',
    'С вариантами — верно, если выбран ответ из файла. Устный — если в проверенных ответах в два разных дня вы назвали все главные пункты из своих лекций; самопроверка в счёт не идёт.',
    `Вопросы в счёте возвращаются через ${days} дней, а в последние дни перед экзаменом — все.`,
    'Видели — был хотя бы один ответ. Ошибки сейчас — последний ответ неверный.',
  ].map(glue);
}

// Subject and topic rows (rows of one card, phone rule 8).
/**
 * «видели 40 из 373», then «в счёте 12» once a question counts. A bare «0 из 373» after 40 answers read as «nothing
 * seen» (the owner, 2026-10-14): the row names both numbers, as the figure's small line does.
 */
function progress(seen: number, total: number, twoDays: number): string[] {
  const shown = [`видели ${Math.min(seen, total)} из ${total}`];
  if (twoDays > 0) shown.push(`в счёте ${twoDays}`);
  return shown;
}
/** A row's parts never break inside («сегодня / 22» on a phone): the line wraps only after « · ». */
const rowLine = (parts: string[]) => parts.map((part) => part.replace(/ /g, NBSP)).join(SEP);
export function subjectRowTest(p: { twoDays: number; keyed: number; seen: number; today: number; dateText: string | null; passed: boolean }): string {
  const parts: string[] = [];
  if (p.dateText) parts.push(p.passed ? `экзамен прошёл ${p.dateText}` : p.dateText);
  parts.push(...(p.seen > 0 ? progress(p.seen, p.keyed, p.twoDays) : [q(p.keyed)]));
  if (p.today > 0 && !p.passed) parts.push(`сегодня ${p.today}`);
  return rowLine(parts);
}
/** «Устный» as «Настройки» marks an oral subject: the row of an oral part says it first (usability check 2026-10-10, m7). */
export const ORAL_ROW = 'устный';
export function subjectRowOral(p: { twoDays: number; seen: number; inPlan: number; questions: number; today: number; dateText: string | null }): string {
  const parts: string[] = [];
  if (p.inPlan === 0) {
    if (p.dateText) parts.push(p.dateText);
    parts.push(`${p.questions} ${pl(p.questions, 'устный', 'устных', 'устных')}${SEP}нужны лекции`);
  } else {
    parts.push(ORAL_ROW);
    if (p.dateText) parts.push(p.dateText);
    parts.push(...(p.seen > 0 ? progress(p.seen, p.inPlan, p.twoDays) : [q(p.inPlan)]));
    if (p.today > 0) parts.push(`сегодня ${p.today}`);
  }
  return rowLine(parts);
}
export const subjectRowEmpty = 'вопросов пока нет';
export function topicRow(p: { twoDays: number; keyed: number; seen: number; errors: number }): string {
  if (p.seen === 0) return 'не начинали';
  return rowLine([...progress(p.seen, p.keyed, p.twoDays), ...(p.errors > 0 ? [`ошибок ${p.errors}`] : [])]);
}
export const oralSheetRow = (n: number) => glue(`Шпаргалка к ${n} ${pl(n, 'устному вопросу', 'устным вопросам', 'устным вопросам')}`);
export const TOPICS_LABEL = 'Темы';
export const SUBJECTS_LABEL = 'Предметы';

// Notes under the rows and in the card (each one line, phone rule 5).
export function noKeyLine(n: number): string {
  return glue(`${q(n)} без ключа ${pl(n, 'не идёт', 'не идут', 'не идут')} в занятия.`);
}
export const MARK_ANSWERS = 'Отметить ответы';
export const doubtsLine = (n: number) => glue(`Сомневаются в ключе: ${q(n)}.`);
export const LOOK = 'Посмотреть';
export const setAsideLine = (n: number) => glue(`${pl(n, 'Отложен', 'Отложено', 'Отложено')} ${q(n)} — вы сомневаетесь в ключе.`);
export const RETURN_TO_PLAN = 'Вернуть в занятия';
export function keyFixedLine(n: number): string {
  return glue(`Автор исправил ключ в ${n} ${pl(n, 'вопросе', 'вопросах', 'вопросах')} — счёт по ${pl(n, 'нему', 'ним', 'ним')} начнётся заново.`);
}
export const OFFLINE_PAGE = 'Нет сети. Вопросы на сегодня сохранены, заниматься можно.';
export const ADD_LECTURES = 'Добавить лекции';
/** The re-estimate of the pace (Concept 2 §3.6): «Поставить 45» / «Оставить 60». */
export const paceSet = (minutes: number) => `Поставить ${minutes}`;
export const paceKeep = (minutes: number) => `Оставить ${minutes}`;
export const SAVE_FAILED = 'Не сохранилось. Проверьте связь и повторите.';

// «⋯» of the exam and of a subject (decision 44, the critique's I9: one «Настройки»).
export const MENU_LABEL_EXAM = 'Ещё: экзамен';
export const MENU_LABEL_SUBJECT = 'Ещё: предмет';
export const MENU_INVITE = 'Пригласить группу';
export const MENU_KEYS = 'Вопросы и ключи';
export const menuKeysWaiting = (n: number) => glue(`Вопросы и ключи · ${n} ждут`);
export const MENU_MINUTES = 'Время в день';
export const MENU_ADD_SUBJECT = 'Добавить предмет';
export const MENU_SETTINGS = 'Настройки';
export const MENU_DELETE = 'Удалить';
export const MENU_REFRESH = 'Обновить из файла';
export const MENU_REMOVE_SUBJECT = 'Убрать предмет';
export const CANCEL = 'Отмена';
export const removeSubjectTitle = (title: string) => `Убрать предмет «${title}»?`;
export const REMOVE_SUBJECT_TEXT = 'Его вопросы и ответы по ним пропадут.';
export const REMOVE_SUBJECT_CONFIRM = 'Убрать';

export const CLOSE = 'Закрыть';
export const END_EXIT = 'Закрыть';

// «План по дням».
export const daysMinutesRow = (minutes: number) =>
  glue(minutes >= ALL_QUESTIONS_MIN ? 'Время в день: все вопросы' : `Время в день: ${minNom(minutes)}`);
const DAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
/**
 * «Дни занятий: Пн–Пт», «Дни занятий: Пн, Ср, Пт, Сб» — the student's days of the week (`study_weekdays`, Monday = 1 …
 * Sunday = 64), three or more in a row as a range. «План по дням» shows it when not every day.
 */
export function studyDaysRow(mask: number): string {
  const on = DAY_SHORT.map((_, day) => (mask & (1 << day)) !== 0);
  const parts: string[] = [];
  for (let day = 0; day < 7; ) {
    if (!on[day]) {
      day += 1;
      continue;
    }
    let end = day;
    while (end + 1 < 7 && on[end + 1]) end += 1;
    if (end - day >= 2) parts.push(`${DAY_SHORT[day]}–${DAY_SHORT[end]}`);
    else for (let k = day; k <= end; k += 1) parts.push(DAY_SHORT[k]);
    day = end + 1;
  }
  return `Дни занятий: ${parts.join(', ')}`;
}
export const CHANGE = 'Изменить';

// The topic sheet (Concept 1 §3.4).
export function topicSheetMeta(p: { keyed: number; twoDays: number; errors: number }): string {
  return glue([q(p.keyed), `${TWO_DAYS} ${p.twoDays}`, ...(p.errors > 0 ? [`ошибок ${p.errors}`] : [])].join(SEP));
}
export const topicStart = (n: number) => glue(`Начать ${q(n)} по теме`);
export const TOPIC_EMPTY = 'Вопросы этой темы сегодня уже были — они вернутся завтра.';

// ─────────────────────────────────────────────── the «занятие»

export const FINISH = 'Закончить';
export const NEXT = 'Дальше';
export const ANSWER = 'Ответить';
export const DONT_KNOW = 'Не знаю';
export const RETRY_TAG = 'повтор, не в счёт';
export const ORAL_TAG = 'устно';
export const counter = (pos: number, total: number) => glue(`${pos} из ${total}`);
export const fileNo = (no: string) => glue(`№ ${no}`);
export const topicNo = (no: string) => `тема ${no}`;
export const MULTIPLE_HINT = glue('Верных ответов несколько — отметьте все.');
export const MULTIPLE_EMPTY = 'Отметьте хотя бы один вариант.';
export const SHORT_LABEL = 'Ваш ответ';
export const SHORT_EMPTY = 'Впишите ответ.';
export const TAG_YOURS = 'Ваш ответ';
export const TAG_FILE = 'В файле';
export const TAG_RIGHT = 'Верно';
export const VERDICT_RIGHT = 'Верно.';
export const verdictRightAll = (n: number) => glue(`Верно: ${n === 2 ? 'оба' : `все ${n}`}.`);
/**
 * The return, after a wrong answer or «Не знаю»: in this session and on `when`, or on `when` only. `when` is «завтра»,
 * or the next study day when tomorrow is a day off («в понедельник», model.ts comesBackWhen).
 */
export const comesBack = (again: boolean, when = 'завтра') => (again ? `Вернётся через пару вопросов и ${when}.` : `Вернётся ${when}.`);
/** Several keys are named while their words fit this; past it the verdict points to the options marked above. */
const KEY_NAMES_MAX = 90;
/** A name that ends a sentence itself («…», «?», «;») takes no period after it. */
const sentence = (text: string) => (/[.!?…;]$/u.test(text) ? text : `${text}.`);
/**
 * «В файле — 7 12.» / «В файле верны: CREATE, ALTER и DROP.»: the key in the file's own words (model.ts keyNames), as
 * the bot says it («В файле — DHCP»), so the verdict, the key panel and «Ключи» never name one option two ways.
 */
function inFile(names: string[]): string {
  if (names.length <= 1) return sentence(`В файле — ${names[0] ?? '—'}`);
  const list = listLetters(names);
  if (list.length > KEY_NAMES_MAX) return `В файле верны ${names.length} ${pl(names.length, 'вариант', 'варианта', 'вариантов')} — они отмечены выше.`;
  return sentence(`В файле верны: ${list}`);
}
export function verdictWrong(keyNames: string[], again: boolean, when?: string): string {
  return glue(`Неверно. ${inFile(keyNames)} ${comesBack(again, when)}`);
}
export function verdictDontKnow(keyNames: string[], again: boolean, when?: string): string {
  return glue(`${inFile(keyNames)} ${comesBack(again, when)}`);
}
export function verdictShortWrong(answer: string, again: boolean, when?: string): string {
  return glue(`Неверно. ${inFile([answer])} ${comesBack(again, when)}`);
}
export const shortDontKnow = (answer: string, again: boolean, when?: string) => glue(`${inFile([answer])} ${comesBack(again, when)}`);
/** After the author changed the key in place (decision 14): the panel says what changed; this answer is not sent. */
export const VERDICT_KEY_FIXED = 'Этот ответ в счёт не идёт.';
/** «Нажали не туда?»: no mistake, but the answer was seen, so the question comes back on `when` (as comesBack). */
export const misclickLine = (when = 'завтра') => `Ошибку не считаем. Ответ вы уже видели, поэтому вопрос вернётся ${glue(when)}.`;
function listLetters(names: string[]): string {
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}` : names.join('');
}
export const MISCLICK = 'Нажали не туда?';
export const DOUBT = 'Сомневаюсь в ключе';
export const KEY_WRONG = 'Ключ неверный?';
export const NOTE_MANUAL_AUTHOR = glue('В файле ответ не был выделен — ключ поставил автор.');
export const NOTE_MANUAL_OWN = glue('В файле ответ не был выделен — ключ поставили вы.');
export const noteKeyFixed = (dayText: string) => glue(`Ключ исправлен автором ${dayText}.`);
export const OFFLINE_STUDY = 'Нет сети. Ответы сохранятся на этом устройстве и уйдут, когда сеть появится.';
export const KEYS_HINT = glue('1–8 — ответ · 0 — не знаю · Enter — дальше · Backspace — нажали не туда');
export const SESSION_LOADING = 'Собираем занятие…';
export const SESSION_EMPTY = 'На сегодня здесь всё.';
export const ERRORS_EMPTY = 'Ошибок сейчас нет.';
export const BACK_TO_EXAM = 'Вернуться к экзамену';
export const OPTION_LETTERS = ['А', 'Б', 'В', 'Г', 'Д', 'Е', 'Ж', 'З'] as const;
export const PICTURE_FAILED = 'Картинка не загрузилась.';
export const PICTURE_RETRY = 'Загрузить ещё раз';

// «Ключ неверный?» in place (the author, a solo student too; decision 14) and «Сомневаюсь в ключе» (a member; the bot
// spec's decision 17 — after an answer the author has only «Ключ неверный?»). The *_OWN lines stay for the sheet's
// author branch (RoomParts DoubtSheet), which the session no longer opens.
export const keyFixPrompt = (no: string) => glue(`Сверьте № ${no} в файле. Там другой ответ? Нажмите его.`);
export const keyFixPromptMultiple = (no: string) => glue(`Сверьте № ${no} в файле. Отметьте все верные варианты и сохраните.`);
export const keyFixPromptShort = (no: string) => glue(`Сверьте № ${no} в файле. Ответы, которые сейчас принимаются:`);
export const ADD_YOUR_ANSWER = 'Добавить ваш ответ к ключу';
export const SAVE_KEY = 'Сохранить ключ';
export const keyChanged = (group: boolean) =>
  group ? 'Ключ изменён. Счёт по этому вопросу начнётся заново, у вас и у группы.' : 'Ключ изменён. Счёт по этому вопросу начнётся заново.';
export const KEY_SAME = 'Это и есть ключ из файла.';
export const doubtTitle = (no: string) => glue(`Сомневаюсь в ключе · № ${no}`);
export const DOUBT_MEMBER_TEXT = 'Автор увидит число отметок и комментарии, но не имена.';
export const DOUBT_OWN_TEXT = 'Вопрос отложится: в занятия он не придёт, пока вы не решите в «Вопросах и ключах».';
export const DOUBT_NOTE_LABEL = 'Комментарий';
export const DOUBT_PLACEHOLDER = 'Например: в лекции сказано иначе';
export const DOUBT_SEND = 'Отметить';
export const DOUBT_DONE_MEMBER = 'Отложено. Когда автор ответит, вопрос вернётся в занятия.';
export const DOUBT_DONE_OWN = 'Отложено: вопрос не придёт в занятия, пока вы не решите. Он в «Вопросах и ключах».';

// The oral turn: a free self-check (decisions 19, 51; Concept 1 §3.8 with the critique's lines).
export const oralNumber = (label: string) => `Вопрос ${label}`;
export const RECALL = glue('Вспомните ответ — вслух или про себя.');
export const SHOW_POINTS = 'Показать пункты';
export const POINTS_TITLE = 'Пункты из ваших лекций';
export const NO_POINTS = 'Пунктов пока нет: к предмету не добавлены лекции.';
export const HOW_ANSWERED = 'Как вы ответили?';
export const RATE_KNOW = 'Знаю';
export const RATE_UNSURE = 'Плаваю';
export const RATE_DONT_KNOW = 'Не знаю';
export const SELF_CHECK_NOTE = 'Самопроверка в счёт не идёт: она решает, когда вопрос вернётся.';
export const ORAL_OFFLINE = 'Устные — когда появится сеть: их пункты не сохранены на этом устройстве.';
export const ORAL_LOADING = 'Загружаем пункты…';
export const RATING_FAILED = 'Отметка не сохранена. Повторите.';

// ─────────────────────────────────────────────── the end of a session (decision 49)

export function sessionTime(questions: number, retries: number, minutes: number): string {
  const m = Math.max(1, minutes);
  const what = retries > 0 ? `${q(questions)} и ${retries} ${pl(retries, 'повтор', 'повтора', 'повторов')}` : q(questions);
  return glue(`${what} за ${minAcc(m)}`);
}
export const nowFigure = (n: number, total: number) => glue(`Теперь ${n} из ${total} — ${TWO_DAYS}`);
/** The headline in three parts, the figure marked: [«Теперь », «147 из 960», « — верно в два разных дня»]. */
export const nowFigureParts = (n: number, total: number): [string, string, string] => ['Теперь ', glue(`${n} из ${total}`), glue(` — ${TWO_DAYS}`)];
export const firstRight = (n: number, of: number) => glue(`Верно с первого раза — ${n} из ${of}.`);
/**
 * `when` on the lines below: «завтра», or the next study day («в понедельник», model.ts comesBackWhen) when tomorrow
 * is not one of the student's days of the week — the plan brings nothing back on a day off.
 */
export const errorsBack = (n: number, when = 'завтра') => glue(`${n} ${pl(n, 'ошибка вернётся', 'ошибки вернутся', 'ошибок вернутся')} ${when}.`);
export function droppedLine(n: number): string {
  return glue(
    `В ${n} ${pl(n, 'вопросе, который был', 'вопросах, которые были', 'вопросах, которые были')} в счёте, сегодня ошибка: счёт по ${pl(n, 'нему', 'ним', 'ним')} начнётся заново.`,
  );
}
export function tooEarlyLine(n: number, time: string | null, day = 'завтра'): string {
  const when = time ? `после ${time}` : day;
  return glue(
    `На ${q(n)} вы снова ответили верно, но раньше чем через 20 часов: ${pl(n, 'он войдёт', 'они войдут', 'они войдут')} в счёт, если ответите ${when}.`,
  );
}
export const firstCountLine = (time: string | null, when = 'завтра') =>
  glue(time ? `Первые войдут в счёт ${when} после ${time} — если снова ответите верно.` : `Первые войдут в счёт ${when} — если снова ответите верно.`);
export function selfCheckLine(know: number, unsure: number, dontKnow: number): string {
  return glue(`«Знаю» — ${know}${SEP}«плаваю» — ${unsure}${SEP}«не знаю» — ${dontKnow}. ${SELF_CHECK_NOTE}`);
}
export function leftToday(questions: number, minutes: number): string {
  return glue(`Сегодня ${pl(questions, 'остался', 'осталось', 'осталось')} ${q(questions)}, около ${minGen(Math.max(1, minutes))}.`);
}
export const moreQuestions = (n: number) => glue(`Ещё ${q(n)}`);
export const nextSubject = (subject: string, n: number) => glue(`Дальше: ${subject} — ${q(n)}`);
/** The exam page's pill when more than one subject has work today: the subject named, as the end screen names it. */
export const startSubject = (subject: string, n: number) => glue(`Начать: ${subject} — ${q(n)}`);
export const aloudSubject = (subject: string, n: number) => glue(`Ответить вслух: ${subject} — ${q(n)}`);
export const DONE = 'Готово';

// ─────────────────────────────────────────────── «Как на экзамене» (decisions 20, 36, 53)

export const MOCK_TITLE = 'Как на экзамене';
export const MOCK_COUNT = 'Вопросов';
export const MOCK_MINUTES = 'Минут';
export const MOCK_NO_LIMIT = 'без времени';
export const MOCK_RULE = 'Ответы можно менять до «Завершить»; итог покажем после.';
export const mockLast = (dayText: string, correct: number, items: number) => glue(`Прошлая попытка ${dayText}: ${correct} из ${items}.`);
export const MOCK_START = 'Начать';
export const MOCK_EMPTY = 'Пока не из чего собрать попытку: в предмете нет вопросов с ключом.';
export const mockBar = (pos: number, total: number, clock: string | null) => glue(clock ? `${pos} из ${total} · ${clock}` : `${pos} из ${total}`);
export const MOCK_FINISH = 'Завершить';
export const MOCK_BACK = 'Назад';
export const MOCK_ALL = 'Все вопросы';
export const mockAllCell = (n: number, answered: boolean) => `Вопрос ${n}${answered ? ', есть ответ' : ', без ответа'}`;
export function mockFinishLine(answered: number, total: number, missing: number[]): string {
  if (missing.length === 0) return glue(`Ответили на все ${q(total)}.`);
  const list = missing.length > 1 ? `${missing.slice(0, -1).join(', ')}, ${missing[missing.length - 1]}` : String(missing[0]);
  const tail = missing.length > 1 ? 'они считаются ошибками' : 'он считается ошибкой';
  return glue(`Ответили на ${answered} из ${total}. Без ответа: ${list} — ${tail}.`);
}
export const MOCK_BACK_TO_QUESTIONS = 'Вернуться к вопросам';
export const mockResumed = (pos: number, total: number, left: string | null) =>
  glue(left ? `Попытка продолжается: ${pos} из ${total}, осталось ${left}.` : `Попытка продолжается: ${pos} из ${total}.`);
export const mockTimeOut = (answered: number, total: number) =>
  glue(`Время вышло, пока вас не было. В итог вошли ответы, которые вы успели дать: ${answered} из ${total}.`);
export const mockResultHead = (dayText: string) => glue(`${MOCK_TITLE} · ${dayText}`);
export const mockScore = (correct: number, total: number) => glue(`${correct} из ${total}`);
export const mockTime = (minutes: number, limit: number | null) =>
  glue(limit ? `Время: ${minNom(Math.max(1, minutes))} из ${limit}.` : `Время: ${minNom(Math.max(1, minutes))}.`);
/** The errors of a try; they come back on `when`, as after a «занятие» (errorsBack). */
export function mockErrors(errors: number, unanswered: number, when = 'завтра'): string {
  if (errors === 0) return 'Ошибок нет.';
  const of = unanswered > 0 ? `, из них без ответа ${unanswered}` : '';
  return glue(errors === 1 ? `Одна ошибка${of}: она вернётся ${when}.` : `Ошибки — ${errors}${of}: они вернутся ${when}.`);
}
export const MOCK_REVIEW = 'Разобрать ошибки';
export const MOCK_OFFLINE = 'Нет сети. Итог посчитан на этом устройстве, ответы уйдут, когда сеть появится.';
export const MOCK_SENDING = 'Отправляем итог…';
export const MOCK_LOADING = 'Собираем попытку…';

// ─────────────────────────────────────────────── «Сегодня» (decision 47)

export function todayFlag(days: number): string {
  if (days <= 0) return 'Экзамен сегодня';
  if (days === 1) return 'Экзамен завтра';
  return `Экзамен через ${days} ${pl(days, 'день', 'дня', 'дней')}`;
}
/** «28 октября · 960 вопросов»; the date alone while the size is not known (model.ts overviewQuestions). */
export const todayMeta = (dayText: string | null, questions: number | null) =>
  glue([dayText, questions === null ? null : q(questions)].filter(Boolean).join(SEP));
export const TODAY_LOADING = 'Считаем план на сегодня…';
