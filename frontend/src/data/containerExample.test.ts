import { describe, expect, it } from 'vitest';
import * as copy from '../components/containers/copy';
import { IMPORT, INVITE, KEY_WORDS } from '../components/containers/copyImport';
import { TELEGRAM_COPY } from '../components/telegram/TelegramCard';
import { SUBJECT_CS, SUBJECT_DB, SUBJECT_NET, SUBJECT_OS, fourSubjects } from '../components/containers/testkit/fixtures';
import { dayText, figureLines, planDetail, planTitle, startLabel } from '../lib/containers/words';
import type { DayPlan } from '../types/container';
import {
  DAYS_LEFT,
  ERRORS,
  EXAM_TITLE,
  FIGURE,
  IMPORT_WORDS,
  INVITE_WORDS,
  MINUTES,
  PLAN_LABEL,
  QUESTIONS,
  SEEN,
  SESSION,
  START_LABEL,
  START_SUBJECT,
  SUBJECTS,
  TELEGRAM_WORDS,
  TODAY,
  TODAY_QUESTIONS,
  TWO_DAYS,
  exampleWords,
  importRow,
  localToday,
  subjectRow,
} from './containerExample';

/** A day's plan with the example's counts (only what the plan's words read). */
const plan = {
  state: 'study',
  counts: { newItems: TODAY.newItems, reviews: TODAY.reviews, oral: TODAY.oral, estSec: MINUTES * 60, leftSec: MINUTES * 60 },
  lines: [],
  sessions: [],
} as unknown as DayPlan;

describe('the example exam of the landing and the sign-in reels', () => {
  it('is 960 questions in five subjects: the screens\' own test subjects and the oral example of /try', () => {
    expect(QUESTIONS).toBe(960);
    expect(SUBJECTS).toHaveLength(5);
    expect(TODAY_QUESTIONS).toBe(SUBJECTS.reduce((sum, subject) => sum + subject.today, 0));
    expect(TWO_DAYS).toBe(143);
    const fixtures = new Map(fourSubjects().map((subject) => [subject.id, subject.title]));
    expect(SUBJECTS.slice(0, 4).map((subject) => subject.title)).toEqual([SUBJECT_CS, SUBJECT_DB, SUBJECT_NET, SUBJECT_OS].map((id) => fixtures.get(id)));
    expect(SUBJECTS[4]).toMatchObject({ title: 'Микроэкономика', questions: 12, oral: true });
    expect(EXAM_TITLE).toBe('Осенняя сессия');
  });

  it('says the exam page\'s and «Сегодня»\'s lines word for word', () => {
    const today = '2026-10-10';
    const words = exampleWords(today);
    expect(words.exam).toBe('2026-10-28');
    expect(words.meta).toBe(copy.metaLine(copy.examDay(dayText(words.exam), DAYS_LEFT), QUESTIONS, SUBJECTS.length));
    expect(words.flag).toBe(copy.todayFlag(DAYS_LEFT));
    expect(words.todayMeta).toBe(copy.todayMeta(dayText(words.exam), QUESTIONS));
    expect(words.planTitle).toBe(planTitle(plan));
    expect(words.planDetail).toBe(planDetail(plan));
    expect(words.need).toBe(`Чтобы пройти все 960 вопросов к 28 октября, нужно около 45 минут в день.`);
    expect(words.days).toEqual([
      '10–24 октября — около 45 минут в день, с устными',
      '25–27 октября — только знакомые, с устными, сначала ошибки',
      '28 октября — экзамен',
    ]);
    expect(START_LABEL).toBe(copy.startSubject(START_SUBJECT.title, START_SUBJECT.today));
    // One subject at work would read «Начать: 22 вопроса»: the example has five.
    expect(startLabel(START_SUBJECT.today, null, null)).toContain(`${START_SUBJECT.today}`);
    const figure = figureLines({ twoDays: TWO_DAYS, inPlan: QUESTIONS, seen: SEEN, errors: ERRORS } as DayPlan['figure'], null);
    expect(FIGURE).toEqual({ big: figure.big, of: figure.of, label: figure.label, under: figure.under });
  });

  it('writes each subject\'s row as the exam page does', () => {
    for (const subject of SUBJECTS) {
      const row = subject.oral
        ? copy.subjectRowOral({ twoDays: subject.twoDays, seen: subject.seen, inPlan: subject.questions, questions: subject.questions, today: subject.today, dateText: null })
        : copy.subjectRowTest({ twoDays: subject.twoDays, keyed: subject.questions, seen: subject.seen, today: subject.today, dateText: null, passed: false });
      expect(subjectRow(subject)).toBe(row);
    }
  });

  it('says the import\'s words', () => {
    expect(IMPORT_WORDS).toMatchObject({ title: IMPORT.title, lede: IMPORT.lede, drop: IMPORT.dropTitle, dropLede: IMPORT.dropLede });
    expect(IMPORT_WORDS.found).toBe(IMPORT.found(SUBJECTS.length, QUESTIONS));
    expect(IMPORT_WORDS.reading).toBe(IMPORT.reading(1));
    expect(PLAN_LABEL).toBe(copy.PLAN_BY_DAYS);
    expect(importRow(SUBJECTS[0])).toBe(`${IMPORT.rowTest(240)} · ${KEY_WORDS.bold}`);
    expect(importRow(SUBJECTS[2])).toBe(`${IMPORT.rowTest(240)} · ${KEY_WORDS.underline}`);
    expect(importRow(SUBJECTS[4])).toBe(IMPORT.rowOral(12));
  });

  it('answers one question of the session wrong, in the session\'s words', () => {
    expect(SESSION.counter).toBe(copy.counter(12, START_SUBJECT.today));
    expect(SESSION.context).toBe([START_SUBJECT.title, copy.fileNo('134')].join(' · '));
    expect(SESSION.verdict).toBe(copy.verdictWrong([SESSION.options[SESSION.key]], true));
    expect([SESSION.yours, SESSION.inFile, SESSION.finish, SESSION.next]).toEqual([copy.TAG_YOURS, copy.TAG_FILE, copy.FINISH, copy.NEXT]);
  });

  it('invites the group and offers the plan in Telegram in their own words', () => {
    expect(INVITE_WORDS).toMatchObject({ title: INVITE.title, linkLabel: INVITE.linkLabel, copy: INVITE.copy, copied: INVITE.copied, textLabel: INVITE.textLabel });
    expect(INVITE_WORDS.lede).toBe(INVITE.lede(SUBJECTS.length, QUESTIONS));
    expect(INVITE_WORDS.message('…/g/…')).toBe(INVITE.message(EXAM_TITLE, SUBJECTS.length, QUESTIONS, '…/g/…'));
    expect(INVITE_WORDS.message('…/g/…')).toBe(`${INVITE_WORDS.lead} Ссылка: …/g/…`);
    expect(TELEGRAM_WORDS).toEqual({ title: TELEGRAM_COPY.title, about: TELEGRAM_COPY.about });
  });

  it('takes «today» as the student\'s local day', () => {
    expect(localToday(new Date(2026, 9, 10, 23, 30))).toBe('2026-10-10');
    expect(localToday(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
  });
});
