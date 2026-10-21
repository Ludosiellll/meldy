/**
 * The example exam the landing and the sign-in reels show (an illustration, no student's data): «Осенняя сессия» —
 * four subjects with options (three of 240 questions, one of 228) and the oral «Микроэкономика» of /try (12 questions):
 * 960 questions, one plan for the day. The subjects are those of the screens' own test data
 * (components/containers/testkit/fixtures.ts).
 *
 * Every line is the screens' own words: the plan's from lib/containers/words.ts (called here, with the example's
 * dates), the exam page's, «Сегодня»'s, the import's and «Пригласить группу»'s written out — containerExample.test.ts
 * holds them to components/containers/copy.ts and copyImport.ts, which this file does not import (the landing stays
 * light).
 */
import { addDays, type LocalDay } from '../lib/containers/time';
import { dayRowText, dayText, lineText } from '../lib/containers/words';

export const EXAM_TITLE = 'Осенняя сессия';
/** Days from «today» to the exam, in every picture. */
export const DAYS_LEFT = 18;
/** Minutes a day the plan asks for, and what today holds: new, familiar and oral questions. */
export const MINUTES = 45;
export const TODAY = { newItems: 30, reviews: 56, oral: 4 } as const;

export interface ExampleSubject {
  title: string;
  questions: number;
  /** Answered right on two different days. */
  twoDays: number;
  /** Seen at least once. */
  seen: number;
  /** Today's questions of the subject. */
  today: number;
  /** How the file marks the key (import's KEY_WORDS); none for an oral subject. */
  key?: string;
  oral?: boolean;
}

export const SUBJECTS: readonly ExampleSubject[] = [
  { title: 'Программирование на C#', questions: 240, twoDays: 61, seen: 150, today: 24, key: 'ключ жирным' },
  { title: 'Базы данных', questions: 240, twoDays: 40, seen: 120, today: 22, key: 'ключ жирным' },
  { title: 'Компьютерные сети', questions: 240, twoDays: 22, seen: 80, today: 23, key: 'ключ подчёркиванием' },
  { title: 'Операционные системы', questions: 228, twoDays: 17, seen: 52, today: 17, key: 'ключ жирным' },
  { title: 'Микроэкономика', questions: 12, twoDays: 3, seen: 8, today: 4, oral: true },
];

export const QUESTIONS = SUBJECTS.reduce((sum, subject) => sum + subject.questions, 0);
export const TWO_DAYS = SUBJECTS.reduce((sum, subject) => sum + subject.twoDays, 0);
export const TODAY_QUESTIONS = TODAY.newItems + TODAY.reviews + TODAY.oral;
/** Seen at least once, and wrong in the last answer (the figure's small line). */
export const SEEN = SUBJECTS.reduce((sum, subject) => sum + subject.seen, 0);
export const ERRORS = 37;

const NB = ' ';

/** «5 предметов», «960 вопросов» (the numbers of this example only). */
const SUBJECTS_WORD = `${SUBJECTS.length}${NB}предметов`;
const QUESTIONS_WORD = `${QUESTIONS}${NB}вопросов`;

/** The «⋯» first subject of today's session: the blue pill names it (two or more subjects at work). */
export const START_SUBJECT = SUBJECTS[1];

/** The words of the example on a given day (`today`, the student's local day). */
export function exampleWords(today: LocalDay) {
  const exam = addDays(today, DAYS_LEFT);
  const examText = dayText(exam);
  const windowFrom = addDays(exam, -3);
  return {
    exam,
    /** The exam page's meta (copy.metaLine with copy.examDay): «28 октября, через 18 дней · 5 предметов, 960 вопросов». */
    meta: `${examText}, через ${DAYS_LEFT}${NB}дней${NB}· ${SUBJECTS_WORD}, ${QUESTIONS_WORD}`,
    /** «Сегодня»'s flag and meta (copy.todayFlag, copy.todayMeta). */
    flag: `Экзамен через ${DAYS_LEFT} дней`,
    todayMeta: `${examText}${NB}· ${QUESTIONS_WORD}`,
    /** The plan card (words.planTitle, words.planDetail). */
    planTitle: `Сегодня ${TODAY_QUESTIONS}${NB}вопросов, около ${MINUTES}${NB}минут`,
    planDetail: `${TODAY.newItems}${NB}новых, ${TODAY.reviews}${NB}знакомых и ${TODAY.oral}${NB}устных`,
    /** What the minutes reach by the date (words.lineText 'need'). */
    need: lineText({ key: 'need', n: [QUESTIONS, MINUTES], day: exam }),
    /** «План по дням» (words.dayRowText): the study days, the final days, the exam. */
    days: [
      dayRowText({ from: today, to: addDays(windowFrom, -1), kind: 'study', minutes: MINUTES, oral: true }),
      dayRowText({ from: windowFrom, to: addDays(exam, -1), kind: 'window', minutes: null, oral: true }),
      dayRowText({ from: exam, to: exam, kind: 'exam', minutes: null }),
    ],
  };
}

/** The blue pill of the day (copy.startSubject). */
export const START_LABEL = `Начать: ${START_SUBJECT.title}, ${START_SUBJECT.today}${NB}вопроса`;
/** The figure (words.figureLines) and its small line. */
export const FIGURE = { big: String(TWO_DAYS), of: `из ${QUESTIONS}`, label: 'выучено', under: `Видели ${SEEN} · ${ERRORS} ошибок` };

/** A subject's row on the exam page (copy.subjectRowTest / copy.subjectRowOral, one date for the whole exam). */
export function subjectRow(subject: ExampleSubject): string {
  const parts = [`видели ${subject.seen} из ${subject.questions}`, `выучено ${subject.twoDays}`, `сегодня ${subject.today}`];
  return (subject.oral ? ['устный', ...parts] : parts).map((part) => part.replace(/ /g, NB)).join(`${NB}· `);
}

/** The import's words (copyImport IMPORT): the title, the lede, what was found, a subject's line. */
export const IMPORT_WORDS = {
  title: 'Новый экзамен',
  lede: 'Один общий файл или по файлу на предмет.',
  drop: 'Загрузите вопросы',
  dropLede: 'Перетащите сюда файлы, по одному на предмет или один на все.',
  found: `Нашли ${SUBJECTS_WORD} и ${QUESTIONS_WORD}`,
  reading: `Читаем 1${NB}файл`,
  file: 'Осенняя сессия.docx',
} as const;

/** The title of the exam page's days (copy.PLAN_BY_DAYS). */
export const PLAN_LABEL = 'План по дням';

/** «240 вопросов · ключ жирным», «12 устных вопросов» (SubjectRows rowMeta). */
export function importRow(subject: ExampleSubject): string {
  return subject.oral ? `${subject.questions}${NB}устных вопросов` : `${subject.questions}${NB}вопросов · ${subject.key}`;
}

/** One question of today's session (an example of a question with options), answered wrong. */
export const SESSION = {
  subject: START_SUBJECT.title,
  /** The session's counter (copy.counter) and the question's place in the file (copy.fileNo). */
  counter: `12${NB}из${NB}${START_SUBJECT.today}`,
  context: `${START_SUBJECT.title} · №${NB}134`,
  stem: 'Какой уровень изоляции транзакций исключает фантомное чтение?',
  options: ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE', 'READ UNCOMMITTED'],
  key: 2,
  chosen: 1,
  /** copy.verdictWrong(['SERIALIZABLE'], true). */
  verdict: `Неверно. В${NB}файле${NB}— SERIALIZABLE. Повторим через пару вопросов и${NB}завтра.`,
  yours: 'Ваш ответ',
  inFile: 'В файле',
  finish: 'Закончить',
  next: 'Дальше',
} as const;

/** «Пригласить группу» (copyImport INVITE) for this exam. */
export const INVITE_WORDS = {
  title: 'Пригласить группу',
  lede: `По ссылке каждый получит весь экзамен: ${SUBJECTS_WORD}, ${QUESTIONS_WORD}. Прогресс у каждого свой, а исправленный вами ключ придёт всем.`,
  linkLabel: 'Ссылка для группы',
  copy: 'Скопировать',
  copied: 'Скопировано',
  textLabel: 'Текст для беседы группы',
  /** The text for the group's chat, before its link. */
  lead: `Готовимся вместе в Meldy: «${EXAM_TITLE}», ${SUBJECTS_WORD}, ${QUESTIONS_WORD}.`,
  message: (url: string) => `Готовимся вместе в Meldy: «${EXAM_TITLE}», ${SUBJECTS_WORD}, ${QUESTIONS_WORD}. Ссылка: ${url}`,
} as const;

/** The Telegram card (components/telegram/TelegramCard): the plan of the day in a chat. */
export const TELEGRAM_WORDS = {
  title: 'План на день в Telegram',
  about: 'Раз в день бот пришлёт план на сегодня. Вопросы экзамена можно решать прямо в чате, по 20 за раз.',
} as const;

/** The student's local day now, 'YYYY-MM-DD'. */
export function localToday(now: Date = new Date()): LocalDay {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
