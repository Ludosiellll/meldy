/**
 * What the reel shows (since 2026-10-10: the exam container). One invented session, «Осенняя сессия»: four subjects of
 * 240 questions — «Экономика», «Право» and «Базы данных» with options and the key taken from the file, «Философия»
 * oral — the exam on Friday 30 October, study days Monday to Saturday, 45 minutes a day. The questions are made up (no
 * real exam bank). Every line on the stage is the app's own: the import page (containers/copyImport.ts), the plan
 * (lib/containers/words.ts), the «занятие» and its end (containers/copy.ts), «Пригласить группу», and the bot's words
 * (supabase/functions/_shared/bot; chapters.test.ts holds the reel to them). No figures about users: only the product.
 */
import type { DayPlan, LocalDay } from '../../types/container';
import * as copy from '../containers/copy';
import { IMPORT, INVITE, KEY_WORDS, MEMBERS } from '../containers/copyImport';
import { addDays, daysBetween, isStudyDay, weekday } from '../../lib/containers/time';
import { dayText, figureLines, glue as countOf, nextStudyDayWord, planDetail, planLine, planTitle, startLabel } from '../../lib/containers/words';

// ---------------------------------------------------------------------------------------------
// The session

export const EXAM_TITLE = 'Осенняя сессия';
/** The exam's date: a Friday. */
export const EXAM_DAY: LocalDay = '2026-10-30';
/** Study days Monday to Saturday (settings.study_weekdays: Monday = 1 … Sunday = 64). */
export const STUDY_DAYS = 63;
export const MINUTES_A_DAY = 45;

export interface Subject {
  title: string;
  /** Questions with options (the key from the file). */
  test: number;
  /** Open questions, answered aloud or in writing. */
  oral: number;
  /** How the file marks the key (copyImport KEY_WORDS). */
  key?: keyof typeof KEY_WORDS;
  file: string;
}

export const SUBJECTS: readonly Subject[] = [
  { title: 'Экономика', test: 240, oral: 0, key: 'bold', file: 'Экономика.docx' },
  { title: 'Право', test: 240, oral: 0, key: 'key_column', file: 'Право.xlsx' },
  { title: 'Базы данных', test: 240, oral: 0, key: 'gift', file: 'Базы данных.gift' },
  { title: 'Философия', test: 0, oral: 240, file: 'Философия.txt' },
];

export const QUESTIONS_TOTAL = SUBJECTS.reduce((sum, subject) => sum + subject.test + subject.oral, 0);

// ---------------------------------------------------------------------------------------------
// 2 · The chaos: the session before Meldy

export interface FloatingCard {
  kind: 'question' | 'file' | 'date';
  title: string;
  meta: string;
  x: number;
  y: number;
  scale: number;
  rotate: number;
  /** 0 = far (small, soft), 1 = middle (sharp), 2 = near (big, soft). */
  depth: 0 | 1 | 2;
}

/** Files and questions of the four subjects, scattered around «С чего начать?» (positions as the approved reel). */
export const CHAOS_CARDS: FloatingCard[] = [
  { kind: 'question', title: 'Эластичность спроса', meta: 'Экономика · вопрос 14', x: 330, y: 200, scale: 0.95, rotate: -6, depth: 1 },
  { kind: 'file', title: 'Право — вопросы.xlsx', meta: '240 вопросов', x: 760, y: 150, scale: 0.72, rotate: 4, depth: 0 },
  { kind: 'date', title: '30 октября', meta: 'Экзамен', x: 1190, y: 175, scale: 0.86, rotate: -3, depth: 1 },
  { kind: 'question', title: 'Источники права', meta: 'Право · вопрос 22', x: 1600, y: 225, scale: 1.04, rotate: 7, depth: 1 },
  { kind: 'file', title: 'Лекция 4 — Кант.pdf', meta: '38 страниц', x: 150, y: 540, scale: 0.78, rotate: 5, depth: 0 },
  { kind: 'file', title: 'Базы данных.gift', meta: '240 вопросов', x: 1780, y: 580, scale: 0.82, rotate: -8, depth: 0 },
  { kind: 'question', title: 'Нормальные формы', meta: 'Базы данных · вопрос 3', x: 430, y: 880, scale: 1.08, rotate: -4, depth: 1 },
  { kind: 'file', title: 'Философия — билеты.txt', meta: '240 вопросов', x: 930, y: 965, scale: 0.74, rotate: 6, depth: 0 },
  { kind: 'question', title: 'Категорический императив', meta: 'Философия · вопрос 12', x: 1390, y: 890, scale: 1.0, rotate: -5, depth: 1 },
  { kind: 'question', title: 'Транзакции', meta: 'Базы данных · вопрос 57', x: 1850, y: 800, scale: 1.32, rotate: 9, depth: 2 },
  { kind: 'question', title: 'Правоспособность', meta: 'Право · вопрос 8', x: 70, y: 770, scale: 1.36, rotate: -10, depth: 2 },
  { kind: 'file', title: 'Экономика.docx', meta: '240 вопросов', x: 600, y: 420, scale: 0.56, rotate: -2, depth: 0 },
  { kind: 'question', title: 'Эмпиризм', meta: 'Философия · вопрос 17', x: 1370, y: 410, scale: 0.6, rotate: 3, depth: 0 },
  { kind: 'question', title: 'Инфляция', meta: 'Экономика · вопрос 5', x: 985, y: 300, scale: 0.5, rotate: -6, depth: 0 },
  { kind: 'file', title: 'Вопросы к экзамену.docx', meta: '240 вопросов', x: 1890, y: 340, scale: 1.4, rotate: -12, depth: 2 },
  { kind: 'question', title: 'Первичный ключ', meta: 'Базы данных · вопрос 40', x: 50, y: 390, scale: 1.22, rotate: 8, depth: 2 },
  { kind: 'question', title: 'Конституция', meta: 'Право · вопрос 26', x: 760, y: 735, scale: 0.6, rotate: 5, depth: 0 },
  { kind: 'date', title: '27 октября', meta: 'Экзамен', x: 1230, y: 730, scale: 0.64, rotate: -4, depth: 0 },
];

/** The chaos's two lines: the size of the session and its days, then the question (the plan chapter's 18 days). */
export const CHAOS_LINES = [`${QUESTIONS_TOTAL} вопросов. 18 дней.`, 'С чего начать?'] as const;

// ---------------------------------------------------------------------------------------------
// 01 · «Вопросы»: the import page (copyImport.ts IMPORT, KEY_WORDS)

/** A subject's line in the import preview, as SubjectRows.tsx rowMeta writes it: «240 вопросов · ключ жирным». */
export function subjectMeta(subject: Subject): string {
  const parts: string[] = [];
  if (subject.test > 0) {
    parts.push(IMPORT.rowTest(subject.test));
    parts.push(subject.key ? KEY_WORDS[subject.key] : IMPORT.rowNoKey);
  }
  if (subject.oral > 0) parts.push(subject.test > 0 ? IMPORT.rowOralTail(subject.oral) : IMPORT.rowOral(subject.oral));
  return parts.join(' · ');
}

export const IMPORT_WORDS = {
  title: IMPORT.title,
  lede: IMPORT.lede,
  dropTitle: IMPORT.dropTitle,
  dropLede: IMPORT.dropLede,
  dropping: IMPORT.dropping,
  pick: IMPORT.pick,
  formats: IMPORT.formats,
  sideTitle: IMPORT.sideTitle,
  side: IMPORT.side,
  reading: IMPORT.reading(SUBJECTS.length),
  readingWait: IMPORT.readingWait,
  found: IMPORT.found(SUBJECTS.length, QUESTIONS_TOTAL),
  save: IMPORT.save,
  /** The import side's own sentence: Meldy takes the key from the file and never makes one up. */
  noAi: 'Ключей ИИ не придумывает.',
} as const;

// ---------------------------------------------------------------------------------------------
// 02 · «План»: the days to the exam (lib/containers/words.ts)

/** «Today» of the plan chapter: Monday 12 October, 18 days before the exam. */
export const PLAN_TODAY: LocalDay = '2026-10-12';
/** The final days: no new questions, only the known ones, mistakes first (the plan's window). */
export const WINDOW_FROM: LocalDay = '2026-10-27';

/** A plan for the reel's words: only what planTitle / planLine read is set. */
function samplePlan(newItems: number, reviews: number, minutes: number, figure: DayPlan['figure']): DayPlan {
  const sec = minutes * 60;
  return {
    day: PLAN_TODAY,
    state: 'study',
    sessions: [],
    counts: { newItems, reviews, oral: 0, aiChecks: 0, estSec: sec, leftSec: sec, doneSec: 0 },
    postponed: {},
    coverage: { unseen: 0, floor: 0, lastNewDay: null, seenByDateEst: 0, neededMin: 0 },
    window: { from: WINDOW_FROM, days: 3, inWindow: false },
    units: null,
    figure,
    perSubject: [],
    next: null,
    firstCountDay: null,
    lines: [],
  };
}

/** The figure: «верно в два разных дня» out of the questions in the plan, before the «занятие» of chapter 03. */
export const FIGURE_BEFORE = 143;
export const TODAY_PLAN = samplePlan(60, 30, MINUTES_A_DAY, { inPlan: QUESTIONS_TOTAL, twoDays: FIGURE_BEFORE, seen: 318, errors: 21, selfKnow: 0 });

export interface PlanDay {
  day: LocalDay;
  kind: 'study' | 'off' | 'window' | 'exam';
  /** Questions of the day (none on a day off and on the exam's day). */
  questions: number;
}

/** Questions a day: what 45 minutes hold, a little more on some days (the plan spreads the rest). */
const PER_DAY = [90, 95, 90, 95, 90, 90];

/** Every day from today to the exam: study days, Sundays off, the final days, the exam. */
export const PLAN_DAYS: PlanDay[] = Array.from({ length: daysBetween(PLAN_TODAY, EXAM_DAY) + 1 }, (_, index) => {
  const day = addDays(PLAN_TODAY, index);
  if (day === EXAM_DAY) return { day, kind: 'exam', questions: 0 };
  if (!isStudyDay(day, STUDY_DAYS)) return { day, kind: 'off', questions: 0 };
  if (day >= WINDOW_FROM) return { day, kind: 'window', questions: 60 };
  return { day, kind: 'study', questions: PER_DAY[weekday(day) % PER_DAY.length] };
});

const WEEKDAY_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

export const PLAN_WORDS = {
  /** «До экзамена 18 дней» (the plan's own «До экзамена N дней», words.ts window_in, without its tail). */
  head: `До экзамена ${countOf(daysBetween(PLAN_TODAY, EXAM_DAY), 'день', 'дня', 'дней')}.`,
  /** «Сегодня 90 вопросов, около 45 минут». */
  title: planTitle(TODAY_PLAN),
  /** «Сегодня около 45 минут: 60 новых и 30 знакомых». */
  line: planLine(TODAY_PLAN),
  /** The plan card's muted line, as ExamView writes it: «60 новых и 30 знакомых. », then «План по дням». */
  detail: `${copy.glue(planDetail(TODAY_PLAN))}. `,
  /** «Начать: 20 вопросов, около 10 минут» (a session is 20 questions). */
  start: startLabel(20, 10, null),
  byDays: copy.PLAN_BY_DAYS,
  studyDays: copy.studyDaysRow(STUDY_DAYS),
  minutes: copy.daysMinutesRow(MINUTES_A_DAY),
  /** The exam's meta: «30 октября, через 18 дней». */
  examDay: copy.examDay(dayText(EXAM_DAY), daysBetween(PLAN_TODAY, EXAM_DAY)),
  weekday: (day: LocalDay) => WEEKDAY_SHORT[weekday(day)],
  date: (day: LocalDay) => dayText(day),
  /** A day's tile: «90» and «вопросов», «около 45 минут». */
  questionsWord: (n: number) => copy.pl(n, 'вопрос', 'вопроса', 'вопросов'),
  minutes45: `около ${MINUTES_A_DAY} минут`,
  off: 'выходной',
  window: 'только знакомые',
  exam: 'экзамен',
} as const;

// ---------------------------------------------------------------------------------------------
// 03 · «Занятие»: a session of «Экономика», 20 questions (copy.ts)

/** The day of the session: a Saturday, so a mistake comes back on Monday (Sunday is not a study day). */
export const SESSION_DAY: LocalDay = '2026-10-17';
export const COMES_BACK = nextStudyDayWord(SESSION_DAY, STUDY_DAYS);

export interface SessionQuestion {
  n: number;
  stem: string;
  /** In the order shown, with the screen's letters. */
  options: readonly string[];
  /** Index of the key (the answer in the file). */
  key: number;
  /** Index the student taps. */
  chosen: number;
}

export const SESSION_SUBJECT = SUBJECTS[0].title;
export const SESSION_SIZE = 20;

export const SESSION_QUESTIONS: readonly SessionQuestion[] = [
  {
    n: 7,
    stem: 'Что показывает эластичность спроса по цене?',
    options: [
      'Как меняется цена, когда растёт спрос',
      'На сколько процентов изменится спрос, если цена изменится на 1 %',
      'Как доход покупателя влияет на спрос',
      'Сколько товара продаётся по рыночной цене',
    ],
    key: 1,
    chosen: 1,
  },
  {
    n: 8,
    stem: 'Что относится к постоянным издержкам фирмы?',
    options: ['Оплата сырья', 'Аренда помещения', 'Сдельная оплата труда', 'Расходы на упаковку'],
    key: 1,
    chosen: 0,
  },
];

/** What the session ends with: 20 questions, 2 of them wrong, the figure up by 4. */
export const SESSION_END = { questions: 20, retries: 2, minutes: 11, firstRight: 18, errors: 2, gained: 4, left: 70, leftMinutes: 35 } as const;
export const FIGURE_AFTER_FIRST = FIGURE_BEFORE + 1;
export const FIGURE_AFTER = FIGURE_BEFORE + SESSION_END.gained;

export const SESSION_WORDS = {
  bar: (n: number) => copy.glue(`${SESSION_SUBJECT} · ${copy.counter(n, SESSION_SIZE)}`),
  finish: copy.FINISH,
  close: copy.END_EXIT,
  next: copy.NEXT,
  letters: copy.OPTION_LETTERS,
  tagRight: copy.TAG_RIGHT,
  tagFile: copy.TAG_FILE,
  tagYours: copy.TAG_YOURS,
  right: copy.VERDICT_RIGHT,
  /** «Неверно. В файле — Аренда помещения. Вернётся через пару вопросов и в понедельник.» */
  wrong: copy.verdictWrong([SESSION_QUESTIONS[1].options[SESSION_QUESTIONS[1].key]], true, COMES_BACK),
  /** The figure's words: «из 960», «верно в два разных дня» (words.ts figureLines). */
  figure: figureLines({ inPlan: QUESTIONS_TOTAL, twoDays: FIGURE_BEFORE, seen: 1, errors: 0, selfKnow: 0 }, null),
  /** The end: [«Теперь », «147 из 960», « — верно в два разных дня»]. */
  endHead: copy.nowFigureParts(FIGURE_AFTER, QUESTIONS_TOTAL),
  endText: [
    `${copy.sessionTime(SESSION_END.questions, SESSION_END.retries, SESSION_END.minutes)}.`,
    copy.firstRight(SESSION_END.firstRight, SESSION_END.questions),
    copy.errorsBack(SESSION_END.errors, COMES_BACK),
  ].join(' '),
  endLeft: copy.leftToday(SESSION_END.left, SESSION_END.leftMinutes),
  endMore: copy.moreQuestions(SESSION_SIZE),
  done: copy.DONE,
} as const;

// ---------------------------------------------------------------------------------------------
// 04 · «Шпаргалка»: an oral answer of «Философия» and the cheat sheet (scenes/hints)

export const ORAL_SUBJECT = SUBJECTS[3].title;

export interface OralPoint {
  text: string;
  /** A main point (a dot) or a detail (a dash). */
  main: boolean;
  /** The answer's word after which the point is named (none: not named). */
  namedAfter: number | null;
}

/** The oral question and the student's answer, word by word. */
export const ORAL = {
  number: 12,
  question: 'Категорический императив Канта.',
  answer:
    'Это безусловное требование разума: поступай так, чтобы правило твоего поступка могло стать всеобщим законом. И человек для другого — всегда цель, а не только средство.',
  /** The words of the answer the check matched to a point (highlighted as it names them). */
  matched: [
    [12, 13],
    [19, 20, 21, 22, 23, 24],
  ] as readonly (readonly number[])[],
  points: [
    { text: 'поступать так, чтобы правило стало всеобщим законом', main: true, namedAfter: 13 },
    { text: 'человек — всегда цель, а не только средство', main: true, namedAfter: 24 },
    { text: 'императив безусловен, в отличие от гипотетического', main: false, namedAfter: null },
  ] as readonly OralPoint[],
};

export const ORAL_WORDS = {
  context: copy.glue(`${ORAL_SUBJECT} · ${copy.ORAL_TAG}`),
  number: copy.oralNumber(String(ORAL.number)),
  points: copy.POINTS_TITLE,
} as const;

// ---------------------------------------------------------------------------------------------
// 05 · «Группа»: one link and the bot

/** The members who came in by the link. */
export const GROUP_MEMBERS = 24;
/** The day of the bot's plan: Monday 19 October (no plan on a Sunday: it is not a study day). */
export const BOT_DAY: LocalDay = '2026-10-19';
export const BOT_TIME = '20:00';

export const GROUP_WORDS = {
  /** The landing's «Одна ссылка на всю группу» (two lines) and the invite's own «Прогресс у каждого свой». */
  head: ['Одна ссылка', 'на всю группу.'],
  note: 'Прогресс у каждого свой.',
  /** The site's Telegram card (TelegramCard.tsx TELEGRAM_COPY.title, aboutPhone). */
  botHead: ['План на день', 'в Telegram.'],
  botNote: 'План на день и вопросы — по 20 за раз.',
  title: INVITE.title,
  lede: INVITE.lede(SUBJECTS.length, QUESTIONS_TOTAL),
  linkLabel: INVITE.linkLabel,
  link: '…/g/k4Rm7Qx2',
  textLabel: INVITE.textLabel,
  /** «Готовимся вместе в Meldy: «Осенняя сессия», 4 предмета, 960 вопросов. Ссылка: …» */
  message: INVITE.message(EXAM_TITLE, SUBJECTS.length, QUESTIONS_TOTAL, '…/g/k4Rm7Qx2'),
  copy: INVITE.copy,
  copied: INVITE.copied,
  /** «В экзамене 24 участника» as the count runs. */
  inExam: (n: number) => MEMBERS.inExam(n, true),
  who: MEMBERS.title,
} as const;

/** The day card the bot sends at 20:00 (bot/card.ts dayCard, mode reminder), and the first question of the session. */
export const BOT = {
  name: 'Meldy',
  /** What Telegram says under a bot's name. */
  status: 'бот',
  day: BOT_DAY,
  time: BOT_TIME,
  /** bot/card.ts planSentence: the plan line with a period. */
  plan: `${planLine({ ...TODAY_PLAN, day: BOT_DAY })}.`,
  /** bot/words.ts examLine(title, dateWhen(date, daysLeft)). */
  exam: `${EXAM_TITLE} · ${dayText(EXAM_DAY)}, через ${countOf(daysBetween(BOT_DAY, EXAM_DAY), 'день', 'дня', 'дней')}`,
  /** bot/card.ts figureLine: «147 из 960 — верно в два разных дня». */
  figure: `${FIGURE_AFTER} из ${QUESTIONS_TOTAL} — ${copy.TWO_DAYS}`,
  /** The blue button: words.ts startLabel without minutes, as the bot writes it. */
  start: startLabel(SESSION_SIZE, null, null),
  /** bot/words.ts ORAL_IN_MELDY: oral questions are planned on the site. */
  oral: 'Устные — в Meldy',
  question: {
    /** bot/render.ts headerText. */
    header: `${SESSION_SUBJECT} · 1 из ${SESSION_SIZE}`,
    stem: 'Какая форма рынка, если продавец один?',
    options: ['Монополия', 'Олигополия', 'Совершенная конкуренция', 'Монополистическая конкуренция'],
    key: 0,
    /** bot/render.ts S.dontKnow, S.finish. */
    dontKnow: 'Не знаю',
    finish: 'Закончить',
    next: { header: `${SESSION_SUBJECT} · 2 из ${SESSION_SIZE}`, stem: 'Что такое альтернативные издержки?' },
  },
  /** bot/render.ts rightToast on the step that counts: «Верно. Теперь 148 из 960 — верно в два разных дня.» */
  toast: `Верно. Теперь ${FIGURE_AFTER + 1} из ${QUESTIONS_TOTAL} — ${copy.TWO_DAYS}.`,
} as const;
