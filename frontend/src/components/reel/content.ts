/**
 * What the reel shows. Every fact comes from the example «Микроэкономика» (/try: data/example): its
 * department list, its lecture fragments, its answer points, the examiner's follow-up. The counts of
 * the lecture check are the editor's own fit (backend/lecture_fit.py run on this example): «подходит к 4
 * вопросам» for the lecture «Эластичность спроса», and the two questions no lecture fits. Only the
 * student's words are written for the film: a spoken answer that names the points by their key words.
 */
import { EXAMPLE_EXAM, EXAMPLE_QUESTIONS, lectureOf, type ExampleQuestion } from '../../data/example';

const question = (number: number): ExampleQuestion => {
  const found = EXAMPLE_QUESTIONS.find((item) => item.number === number);
  if (!found) throw new Error(`The example has no question ${number}`);
  return found;
};

/** The department's list: the heading and the twelve questions, in their order. */
export const LIST_TITLE = EXAMPLE_EXAM.sheetTitle;
export const LIST = EXAMPLE_QUESTIONS.map((item) => ({ number: item.number, text: item.text }));
/** The editor's line after the list is read («Распознано N вопросов»). */
export const RECOGNIZED = `Распознано ${LIST.length} вопросов`;

/** The question of the ticket: the one lecture-backed question with four answer points. */
const FOCUS = question(7);
export const FOCUS_NUMBER = FOCUS.number;
export const FOCUS_TEXT = FOCUS.text;

/** The lecture that fits the focus question, with the fragment the mark quotes. */
const LECTURE = lectureOf(FOCUS.lecture ?? 'M2');
const FRAGMENT = FOCUS.evidence.find((item) => item.lecture === LECTURE.key && item.fragment === 'S05') ?? FOCUS.evidence[0];
export const SLIP = {
  lecture: LECTURE.title,
  caption: `Лекция «${LECTURE.title}» · фрагмент ${Number(FRAGMENT.fragment.slice(1))}`,
  quote: FRAGMENT.quote,
  /** The editor's hint on the lecture, and its button: the questions this lecture fits. */
  fit: 4,
  /** The questions no lecture of the student's fits (the editor's line). */
  unmatched: [11, 12] as const,
};
export const FIT_HINT = `подходит к ${SLIP.fit} вопросам`;
export const FIT_BUTTON = `Отметить подходящие (${SLIP.fit})`;
export const UNMATCHED_LINE = `Без подходящей лекции: вопросы ${SLIP.unmatched.join(' и ')}.`;

/** The answer points of the focus question, in their order: the cheat sheet writes each one as its short line. */
export const POINTS = FOCUS.points.map((point) => ({ short: point.short, essential: point.essential }));
/** The examiner's follow-up for each point (the point's own question of the example). */
export const FOLLOWUPS = FOCUS.points.map((point) => point.followup.question);

/** The first answer names point 0; the examiner's question brings point 2 out, named after it. */
const NAMED_IN_ANSWER: readonly number[] = [0];
const NAMED_AFTER_QUESTION: readonly number[] = [2];

export const TICKET = {
  label: 'Билет',
  question: FOCUS_TEXT,
  /** The student's and the examiner's turns, in order; each word is typed at its own moment. */
  turns: [
    {
      speaker: 'student' as const,
      text: 'Выручка продавца — это цена, умноженная на количество проданного товара.',
      at: 20200,
      wordMs: 420,
    },
    {
      speaker: 'examiner' as const,
      text: FOLLOWUPS[2],
      at: 25300,
      wordMs: 330,
    },
    {
      speaker: 'student' as const,
      text: 'Если спрос неэластичный, повысить цену: выручка вырастет.',
      at: 28600,
      wordMs: 420,
    },
  ],
  /**
   * Point index → [turn, word]: the word of the student's turn after which the point is named, the
   * word that completes its key-word groups (anchors of the example). Point 0 is named in the first
   * answer; point 2 is named after the examiner's question (the third turn).
   */
  namedAfterWord: { 0: [0, 7], 2: [2, 3] } as Record<number, readonly [number, number]>,
  /** Points named in the answer itself, and the one named only after the examiner's question. */
  namedInAnswer: NAMED_IN_ANSWER,
  namedAfterQuestion: NAMED_AFTER_QUESTION,
  /** Points the answer does not name at all. */
  notNamed: [1, 3] as readonly number[],
  /** The count of the editor: named points out of all points (the answer and the question name two of four). */
  countLine: `По ключевым словам: ${NAMED_IN_ANSWER.length + NAMED_AFTER_QUESTION.length} из ${POINTS.length}`,
  /** The same count on two lines, large: the label, then the numbers. */
  countHead: 'По ключевым словам:',
  countTail: `${NAMED_IN_ANSWER.length + NAMED_AFTER_QUESTION.length} из ${POINTS.length}`,
  countFine: 'итог — после ответа',
  examinerLabel: 'Экзаменатор',
  /** The label over the student's turns, beside the voice wave: «Отвечать голосом» (the app's button). */
  voiceLabel: 'Отвечать голосом',
};

/** The moment of a word of a turn (ms): the word appears in the transcript at this time. */
export function wordAt(turnIndex: number, word: number): number {
  const turn = TICKET.turns[turnIndex];
  return turn.at + word * turn.wordMs;
}

/** The moment a point is named (the word appears) and the lag of the rub after it (ms). */
export const RUB_LAG = 60;

export function namedAt(point: number): number {
  const at = TICKET.namedAfterWord[point];
  if (!at) throw new Error(`Point ${point} is not named in the answer`);
  return wordAt(at[0], at[1]);
}

/** The dates the cheat sheet writes in its corner: the answer's day, then the next answers' days. */
export const DAYS = {
  first: '7 окт.',
  second: '8 окт.',
  third: '10 окт.',
};

/** The notes the sheet writes under a line (the exam page's words; the copy tests keep them to the app). */
export const NOTES = {
  afterQuestion: 'назван только после вопроса экзаменатора',
  notNamed: 'пункт не назван',
  returned: 'была стёрта · пункт не назван',
};

/** The rest of the copy: the group, the day of the question, the reminder (the app's own words). */
export const GROUP = {
  statement: 'Каждый однокурсник получит свою копию экзамена',
  copyLabel: 'У каждого будет своя копия',
  questionOfDay: 'Вопрос дня',
  remind: 'Напоминать каждый день',
  reminderTime: 'Напоминание в 20:00',
};

/**
 * The statements of the chapters, line by line (the app's own sentences, or plain facts about the app):
 * one message per chapter, set at 88 units on the 1920 × 1080 stage.
 */
export const STATEMENTS = {
  list: [RECOGNIZED],
  lectures: ['Ответы — цитатами из ваших лекций'],
  sheet: ['Пункты ответа — под каждым вопросом'],
  oral: ['Билет — вслух, с переспросом'],
  days: ['Строки стирают только ответы', 'в разные дни'],
  group: ['Каждый однокурсник получит', 'свою копию экзамена'],
};

/** The one line left on the paper at the end: the first point's own short line, written by hand. */
export const END_LINE = POINTS[0].short;
