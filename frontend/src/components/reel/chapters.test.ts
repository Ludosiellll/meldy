import { describe, expect, it } from 'vitest';
import botWordsSource from '../../../../supabase/functions/_shared/bot/words.ts?raw';
import botRenderSource from '../../../../supabase/functions/_shared/bot/render.ts?raw';
import botCardSource from '../../../../supabase/functions/_shared/bot/card.ts?raw';
import telegramCardSource from '../telegram/TelegramCard.tsx?raw';
import introSource from './scenes/Intro.tsx?raw';
import chaosSource from './scenes/Chaos.tsx?raw';
import brandSource from './scenes/Brand.tsx?raw';
import outroSource from './scenes/Outro.tsx?raw';
import hintsSource from './scenes/Hints.tsx?raw';
import sessionSource from './scenes/Session.tsx?raw';
import * as copy from '../containers/copy';
import { IMPORT, INVITE, KEY_WORDS, MEMBERS } from '../containers/copyImport';
import { dayRowText, startLabel } from '../../lib/containers/words';
import {
  BOT,
  CHAOS_LINES,
  COMES_BACK,
  EXAM_DAY,
  FIGURE_AFTER,
  FIGURE_AFTER_FIRST,
  FIGURE_BEFORE,
  GROUP_MEMBERS,
  GROUP_WORDS,
  IMPORT_WORDS,
  ORAL,
  PLAN_DAYS,
  PLAN_TODAY,
  PLAN_WORDS,
  QUESTIONS_TOTAL,
  SESSION_QUESTIONS,
  SESSION_WORDS,
  SUBJECTS,
  subjectMeta,
} from './content';
import { ROW_AT, SAVE_AT, foundAt } from './scenes/Questions';
import { PAN, START_AT, stripAt } from './scenes/Plan';
import { END_AT, TAP_RIGHT, TAP_WRONG, figureAt, questionAt } from './scenes/Session';
import { COPY_AT, OPTION_TAP, PLAN_MSG_AT, START_TAP, membersAt } from './scenes/Group';
import {
  FIRST_AT,
  LAPSE_AT,
  LAPSE_MS,
  LIST,
  MAP,
  MOVE_MS,
  NAMED_AT,
  SECOND_AT,
  SECOND_DAY_AT,
  SHEET_AT,
  TOTAL_LINES,
  countsAt,
  dayLabel,
  firstIndex,
  lineAt,
  mapAt,
  wordAt,
} from './scenes/hints/model';
import { sceneWindow } from './timeline';

const plain = (text: string) => text.replace(/ /g, ' ');
const length = (id: Parameters<typeof sceneWindow>[0]) => sceneWindow(id).to - sceneWindow(id).from;

describe('the session the reel tells', () => {
  it('is four subjects of 240 questions: three with the key from the file, one oral — 960 in all', () => {
    expect(SUBJECTS.map((subject) => subject.title)).toEqual(['Экономика', 'Право', 'Базы данных', 'Философия']);
    expect(SUBJECTS.every((subject) => subject.test + subject.oral === 240)).toBe(true);
    expect(QUESTIONS_TOTAL).toBe(960);
    expect(SUBJECTS.filter((subject) => subject.oral > 0).map((subject) => subject.title)).toEqual(['Философия']);
    // The files are the formats the import reads without AI: DOCX, XLSX, GIFT, TXT.
    expect(SUBJECTS.map((subject) => subject.file.split('.').pop())).toEqual(['docx', 'xlsx', 'gift', 'txt']);
    expect(CHAOS_LINES).toEqual(['960 вопросов. 18 дней.', 'С чего начать?']);
  });
});

describe('01 «Вопросы»: the import page in its own words', () => {
  it('says what the import page says: the card to drop files on, the reading, what it found', () => {
    expect(IMPORT_WORDS.title).toBe(IMPORT.title);
    expect(IMPORT_WORDS.dropTitle).toBe('Загрузите вопросы');
    expect(IMPORT_WORDS.dropping).toBe(IMPORT.dropping);
    expect(plain(IMPORT_WORDS.reading)).toBe('Читаем 4 файла');
    expect(plain(IMPORT_WORDS.found)).toBe('Нашли 4 предмета и 960 вопросов');
    // «Ключей ИИ не придумывает» is the import's own sentence.
    expect(IMPORT.side.join(' ')).toContain(IMPORT_WORDS.noAi.replace(/\.$/, ''));
  });

  it('lists each subject as the preview does: the count and how the file marks the key, or the oral questions', () => {
    expect(SUBJECTS.map((subject) => plain(subjectMeta(subject)))).toEqual([
      '240 вопросов · ключ жирным',
      '240 вопросов · ключ в столбце',
      '240 вопросов · ключ из разметки',
      '240 устных вопросов',
    ]);
    expect(KEY_WORDS.bold).toBe('ключ жирным');
  });

  it('counts the files in as they are read, to 960 before «Сохранить» is pressed', () => {
    for (let i = 1; i < ROW_AT.length; i += 1) expect(ROW_AT[i]).toBeGreaterThan(ROW_AT[i - 1]);
    expect(foundAt(0)).toBe(0);
    // Read and counted a second after the last file comes in; then more than a second to read it before the click.
    const counted = ROW_AT[ROW_AT.length - 1] + 1000;
    expect(Math.round(foundAt(counted))).toBe(960);
    expect(SAVE_AT - counted).toBeGreaterThanOrEqual(1000);
    expect(SAVE_AT).toBeLessThan(length('questions') - 400);
  });
});

describe('02 «План»: the days to the exam', () => {
  it('runs from today, 18 days before the exam, to the exam: study days Monday to Saturday, Sundays off, the final days', () => {
    expect(PLAN_DAYS[0].day).toBe(PLAN_TODAY);
    expect(PLAN_DAYS[PLAN_DAYS.length - 1]).toEqual({ day: EXAM_DAY, kind: 'exam', questions: 0 });
    expect(plain(PLAN_WORDS.head)).toBe('До экзамена 18 дней.');
    expect(PLAN_DAYS.filter((day) => day.kind === 'off').map((day) => day.day)).toEqual(['2026-10-18', '2026-10-25']);
    expect(PLAN_DAYS.filter((day) => day.kind === 'window').map((day) => day.day)).toEqual(['2026-10-27', '2026-10-28', '2026-10-29']);
    expect(PLAN_WORDS.studyDays).toBe('Дни занятий: Пн–Сб');
    expect(plain(PLAN_WORDS.minutes)).toBe('Время в день: 45 минут');
  });

  it('says today in the plan\'s own words, and the day rows are the plan\'s', () => {
    expect(plain(PLAN_WORDS.title)).toBe('Сегодня 90 вопросов, около 45 минут');
    expect(plain(PLAN_WORDS.line)).toBe('Сегодня около 45 минут: 60 новых и 30 знакомых');
    expect(plain(PLAN_WORDS.start)).toBe(plain(startLabel(20, 10, null)));
    // A tile says what «План по дням» says of a study day.
    expect(plain(dayRowText({ from: PLAN_TODAY, to: PLAN_TODAY, kind: 'study', minutes: 45 }))).toBe(`12 октября — ${PLAN_WORDS.minutes45}`);
  });

  it('shows the exam\'s day before it goes back to today and «Начать» is pressed', () => {
    expect(PAN).toBeGreaterThan(0);
    expect(Math.max(...Array.from({ length: 60 }, (_, i) => stripAt(i * 100)))).toBeCloseTo(PAN, 0);
    expect(stripAt(START_AT)).toBe(0);
  });
});

describe('03 «Занятие»: the app\'s room and its words', () => {
  it('answers in the room\'s words: the key from the file, a mistake that comes back on the next study day', () => {
    expect(COMES_BACK).toBe('в понедельник');
    expect(plain(SESSION_WORDS.bar(7))).toBe('Экономика · 7 из 20');
    expect(SESSION_WORDS.right).toBe('Верно.');
    expect(plain(SESSION_WORDS.wrong)).toBe('Неверно. В файле — Аренда помещения. Вернётся через пару вопросов и в понедельник.');
    expect(SESSION_WORDS.wrong).toBe(copy.verdictWrong(['Аренда помещения'], true, 'в понедельник'));
    expect([SESSION_WORDS.tagRight, SESSION_WORDS.tagFile, SESSION_WORDS.tagYours]).toEqual(['Верно', 'В файле', 'Ваш ответ']);
    const [right, wrong] = SESSION_QUESTIONS;
    expect(right.chosen).toBe(right.key);
    expect(wrong.chosen).not.toBe(wrong.key);
  });

  it('moves the one figure when a right answer counts, and ends as the end of a session does', () => {
    expect(figureAt(0)).toBe(FIGURE_BEFORE);
    expect(Math.round(figureAt(TAP_WRONG))).toBe(FIGURE_AFTER_FIRST);
    expect(Math.round(figureAt(length('session')))).toBe(FIGURE_AFTER);
    expect(plain(SESSION_WORDS.endHead.join(''))).toBe(`Теперь ${FIGURE_AFTER} из 960 — верно в два разных дня`);
    expect(plain(SESSION_WORDS.endText)).toBe('20 вопросов и 2 повтора за 11 минут. Верно с первого раза — 18 из 20. 2 ошибки вернутся в понедельник.');
    expect(plain(SESSION_WORDS.endLeft)).toBe('Сегодня осталось 70 вопросов, около 35 минут.');
    expect(questionAt(TAP_RIGHT)).toBe(7);
    expect(questionAt(TAP_WRONG)).toBe(8);
    expect(questionAt(END_AT)).toBe(20);
  });

  it('has no stamp, no grade and no «Засчитано»', () => {
    for (const source of [sessionSource, hintsSource]) expect(source).not.toMatch(/Засчитано|Проверено|mr-stamp|makeBurst/);
  });
});

describe('04 «Шпаргалка»: the answer aloud and the sheet that empties', () => {
  it('names two main points in the answer; the sheet\'s question 12 has those points as its lines', () => {
    const words = ORAL.answer.split(' ');
    expect(NAMED_AT.filter((at) => at !== null)).toHaveLength(2);
    for (const at of NAMED_AT) if (at !== null) expect(at).toBeLessThan(SHEET_AT);
    for (const phrase of ORAL.matched) for (const index of phrase) expect(index).toBeLessThan(words.length);
    expect(wordAt(words.length - 1)).toBeLessThan(SHEET_AT);
    const question = LIST.find((item) => item.number === ORAL.number)!;
    expect(question.lines.map((line) => line.text)).toEqual(ORAL.points.map((point) => point.text));
  });

  it('fades the named lines on the answer\'s day and erases them on another day; a line not named stays', () => {
    const first = firstIndex(ORAL.number);
    const named = [0, 1].map((line) => MAP[first + line]);
    for (const [line, entry] of named.entries()) {
      expect(lineAt(entry.story, FIRST_AT - 1, line).state).toBe('left');
      expect(lineAt(entry.story, SECOND_DAY_AT, line).state).toBe('half');
      expect(lineAt(entry.story, SECOND_AT + 400 + MOVE_MS, line).state).toBe('gone');
    }
    expect(lineAt(MAP[first + 2].story, SECOND_AT + 400 + MOVE_MS, 2).state).toBe('left');
    expect(plain(dayLabel(0))).toBe('Вт, 13 октября');
    expect(plain(dayLabel(SECOND_DAY_AT))).toBe('Чт, 15 октября');
    expect(plain(dayLabel(LAPSE_AT + LAPSE_MS))).toBe('Чт, 29 октября');
  });

  it('only ever moves a line forward, and leaves about a sixth of the sheet by the exam\'s eve', () => {
    const order = { left: 0, half: 1, gone: 2 } as const;
    let before = mapAt(0);
    for (let l = 100; l <= length('sheet'); l += 100) {
      const now = mapAt(l);
      now.forEach((frame, index) => expect(order[frame.state]).toBeGreaterThanOrEqual(order[before[index].state]));
      before = now;
    }
    const start = countsAt(0);
    const end = countsAt(length('sheet'));
    expect(start.left + start.gone).toBe(TOTAL_LINES);
    expect(start.left).toBeGreaterThan(TOTAL_LINES * 0.75);
    expect(end.left).toBeGreaterThan(TOTAL_LINES * 0.1);
    expect(end.left).toBeLessThan(TOTAL_LINES * 0.25);
    // The count stays a three-digit number (the rolling count keeps its width).
    expect(end.left).toBeGreaterThanOrEqual(100);
    // The answer on another day erases exactly question 12's two named lines.
    expect(countsAt(SECOND_AT + 160 + MOVE_MS).left).toBe(start.left - 2);
  });
});

describe('05 «Группа»: one link, and the bot in its own words', () => {
  it('invites in the invite\'s words and counts the group in', () => {
    expect(GROUP_WORDS.title).toBe('Пригласить группу');
    expect(plain(GROUP_WORDS.lede)).toBe('По ссылке каждый получит весь экзамен: 4 предмета, 960 вопросов. Прогресс у каждого свой, а исправленный вами ключ придёт всем.');
    expect(GROUP_WORDS.message).toBe(INVITE.message('Осенняя сессия', 4, 960, GROUP_WORDS.link));
    expect(plain(GROUP_WORDS.inExam(GROUP_MEMBERS))).toBe('В экзамене 24 участника');
    expect(GROUP_WORDS.inExam(24)).toBe(MEMBERS.inExam(24, true));
    expect(membersAt(COPY_AT)).toBe(0);
    expect(membersAt(PLAN_MSG_AT)).toBe(GROUP_MEMBERS);
    // The site's Telegram card says it so.
    expect(telegramCardSource).toContain(`title: '${GROUP_WORDS.botHead.join(' ').replace(/\.$/, '')}'`);
    expect(telegramCardSource).toContain(`aboutPhone: '${GROUP_WORDS.botNote}'`);
  });

  it('writes the bot\'s plan at 20:00 and its question as the bot does', () => {
    expect(BOT.time).toBe('20:00');
    expect(plain(BOT.plan)).toBe('Сегодня около 45 минут: 60 новых и 30 знакомых.');
    expect(plain(BOT.exam)).toBe('Осенняя сессия · 30 октября, через 11 дней');
    expect(BOT.figure).toBe(`${FIGURE_AFTER} из 960 — верно в два разных дня`);
    expect(plain(BOT.start)).toBe('Начать: 20 вопросов');
    expect(BOT.start).toBe(startLabel(20, null, null));
    // The bot's own sources: the plan card, the oral button, the question's buttons and header, the right answer.
    expect(botWordsSource).toContain(`ORAL_IN_MELDY = '${BOT.oral}'`);
    expect(botWordsSource).toContain('export const examLine = (title: string, when: string | null) => `${title} · ${when ?? NO_DATE}`;');
    expect(botWordsSource).toContain("return `${dayText(date)}, через ${glue(daysLeft, 'день', 'дня', 'дней')}`;");
    expect(botWordsSource).toContain('Здесь будет план на каждый день и вопросы вашего экзамена — по 20 за раз');
    expect(botCardSource).toContain('startLabel(first.ids.length, null, null)');
    expect(botCardSource).toContain("line: `${words.big} ${words.of} — ${words.label}`");
    expect(botRenderSource).toContain(`dontKnow: '${BOT.question.dontKnow}'`);
    expect(botRenderSource).toContain(`finish: '${BOT.question.finish}'`);
    expect(botRenderSource).toContain('return `${oneLine(v.subject)} · ${v.n} из ${v.of}');
    expect(botRenderSource).toContain('return `${head} Теперь ${words.big} ${words.of} — ${words.label}.`;');
    expect(BOT.toast).toBe(`Верно. Теперь ${FIGURE_AFTER + 1} из 960 — верно в два разных дня.`);
    expect(PLAN_MSG_AT).toBeLessThan(START_TAP);
    expect(START_TAP).toBeLessThan(OPTION_TAP);
    expect(OPTION_TAP + 600).toBeLessThan(length('group'));
  });
});

describe('the look the owner asked for', () => {
  it('has no coloured particles: only white on the dark opening and ink on paper (the yellow dot is the brand)', () => {
    for (const source of [introSource, chaosSource, brandSource, outroSource]) {
      for (const call of source.match(/makeBurst\([^)]*\)/g) ?? []) expect(call).not.toMatch(/#(F4C45B|2869DD|A9C8F7|3F9A5A|8ACB97)/i);
    }
    expect(hintsSource).not.toMatch(/makeBurst|drawBurst|confetti/i);
  });

  it('keeps the plan\'s words for the day off and the study days', () => {
    expect(copy.studyDaysRow(63)).toBe(PLAN_WORDS.studyDays);
  });
});
