import { describe, expect, it } from 'vitest';
import type { AnswerResult, UnitState } from '../../types/container';
import { planDetail, planTitle } from '../../lib/containers/words';
import {
  addDay,
  clsOf,
  codeLike,
  dayDiff,
  errorCount,
  examFigure,
  gradeLocal,
  keyLetters,
  metaDay,
  moreNew,
  sessionHref,
  setAsideIds,
  shortNorm,
  soloSubject,
  splitStem,
  subjectPlan,
  summarize,
  tomorrowTime,
  topicNumber,
  type StudyRecord,
} from './model';
import { CONTAINER, ORAL_EXAM, SUBJECT_DB, SUBJECT_ORAL, dayPlan, dbItems, item, planInput, planItemsFor, subject, summary, unit } from './testkit/fixtures';

const plain = (text: string) => text.split(String.fromCharCode(0xa0)).join(' ');

describe('days and the meta line', () => {
  it('counts calendar days and steps them', () => {
    expect(dayDiff('2026-10-10', '2026-10-28')).toBe(18);
    expect(dayDiff('2026-10-28', '2026-10-10')).toBe(-18);
    expect(addDay('2026-10-31', 1)).toBe('2026-11-01');
    expect(dayDiff('bad', '2026-10-10')).toBeNull();
  });

  it('says one date, a span of dates, a passed exam and a missing date', () => {
    expect(plain(metaDay(['2026-10-28'], '2026-10-10').text)).toBe('28 октября, через 18 дней');
    expect(plain(metaDay(['2026-10-11'], '2026-10-10').text)).toBe('11 октября, завтра');
    expect(plain(metaDay(['2026-10-10'], '2026-10-10').text)).toBe('10 октября, сегодня');
    expect(plain(metaDay(['2026-10-25', '2026-10-28'], '2026-10-10').text)).toBe('с 25 октября по 28 октября, через 15 дней');
    const passed = metaDay(['2026-10-01'], '2026-10-10');
    expect(passed.passed).toBe(true);
    expect(plain(passed.text)).toBe('Экзамен прошёл 1 октября');
    const none = metaDay([], '2026-10-10');
    expect(none.noDate).toBe(true);
    expect(none.text).toBe('Дата не указана');
  });
});

describe('the figure and the plan card', () => {
  it('takes the plan’s figure (oral with points included), else the summary’s sums', () => {
    expect(examFigure(summary(), dayPlan())).toEqual({ twoDays: 143, total: 960, seen: 410, errors: 37 });
    expect(examFigure(summary(), null)).toEqual({ twoDays: 61 + 40 + 22 + 20, total: 240 * 3 + 236, seen: 180 + 150 + 50 + 30, errors: 21 + 9 + 4 + 3 });
  });

  it('tells a subject’s share of the day as a plan of its own, in the plan’s words', () => {
    const input = planInput({ items: planItemsFor(dbItems(), { 'q-iso': unit({ seen: 2, wrong: 1, lastDay: '2026-10-09' }) }) });
    const share = subjectPlan(dayPlan(), SUBJECT_DB, input);
    expect(share.sessions.map((session) => session.subjectId)).toEqual([SUBJECT_DB]);
    expect(share.counts).toMatchObject({ newItems: 4, reviews: 1, oral: 0, leftSec: 180 });
    expect(plain(planTitle(share))).toBe('Сегодня 5 вопросов, около 3 минут');
    expect(plain(planDetail(share))).toBe('4 новых и 1 знакомый');
    // Answered today: what is left of it.
    const later = planInput({ items: planItemsFor(dbItems(), { 'q-iso': unit({ seen: 3, lastDay: '2026-10-10' }) }) });
    expect(plain(planTitle(subjectPlan(dayPlan(), SUBJECT_DB, later)))).toBe('Сегодня осталось 5 вопросов, около 3 минут');
  });

  it('opens a one-subject exam with variants as its subject page', () => {
    expect(soloSubject(summary())).toBeNull();
    expect(soloSubject(summary({ subjects: [subject()] }))?.id).toBe(subject().id);
    expect(soloSubject(summary({ subjects: [subject({ keyed: 0, oral: { exam_id: ORAL_EXAM, questions: 40 } })] }))).toBeNull();
  });
});

describe('where a session leads', () => {
  it('sends an AI check to one ticket of the oral exam with the questions and the way back (decision 29в)', () => {
    const withOral = summary({ subjects: [...summary().subjects, subject({ id: SUBJECT_ORAL, title: 'Право', keyed: 0, oral: { exam_id: ORAL_EXAM, questions: 40 } })] });
    const href = sessionHref(CONTAINER, withOral, { subjectId: SUBJECT_ORAL, kind: 'ai_check', ids: ['a', 'b', 'c', 'd'], estSec: 450 });
    expect(href).toBe(`/exams/${ORAL_EXAM}/ticket?q=a,b,c&from=c:${CONTAINER}`);
  });

  it('opens a «занятие» of the subject, an oral self-check with its kind, and the way back to a subject page', () => {
    expect(sessionHref(CONTAINER, summary(), { subjectId: SUBJECT_DB, kind: 'answer', ids: ['x'], estSec: 30 })).toBe(`/exams/c/${CONTAINER}/study?s=${SUBJECT_DB}`);
    expect(sessionHref(CONTAINER, summary(), { subjectId: SUBJECT_DB, kind: 'self_check', ids: ['x'], estSec: 30 }, 's')).toBe(
      `/exams/c/${CONTAINER}/study?s=${SUBJECT_DB}&kind=self_check&back=s`,
    );
  });
});

describe('blocks outside the plan', () => {
  const items = Array.from({ length: 6 }, (_, i) => item({ id: `t${i}`, position: i + 1, topic: i < 4 ? 1 : 2 }));
  const states = {
    t0: unit({ seen: 1, lastDay: '2026-10-10' }),
    t1: unit({ seen: 2, wrong: 1, lastDay: '2026-10-08' }),
    t2: unit({ seen: 1, seriesAt: 1, seriesDay: '2026-10-09', lastDay: '2026-10-09' }),
    t4: unit({ seen: 3, wrong: 2, lastDay: '2026-10-07' }),
  };
  const input = planInput({ items: planItemsFor(items, states) });

  it('counts the current errors as «ошибок сейчас» does', () => {
    expect(errorCount(input, SUBJECT_DB)).toBe(2);
    expect(errorCount(input, SUBJECT_ORAL)).toBe(0);
  });

  it('takes «Ещё 20 новых» from the study engine, past the plan and past this session’s answers', () => {
    const more = moreNew(input, null);
    expect(more).toEqual({ subjectId: SUBJECT_DB, ids: ['t3', 't5'] });
    expect(moreNew(input, dayPlan({ sessions: [{ subjectId: SUBJECT_DB, kind: 'answer', ids: ['t3'], estSec: 30 }] }))?.ids).toEqual(['t5']);
    expect(moreNew(input, null, new Set(['t3', 't5']))).toBeNull();
    expect(moreNew(null, null)).toBeNull();
  });

  it('names the plan class of an answer from the state', () => {
    expect(clsOf(undefined, false)).toBe('new_floor');
    expect(clsOf(unit({ seen: 1, wrong: 1 }), false)).toBe('relearn');
    expect(clsOf(unit({ seen: 1, seriesAt: 1 }), false)).toBe('confirm');
    expect(clsOf(unit({ seen: 2, twoDaysAt: 1 }), false)).toBe('check');
    expect(clsOf(unit({ seen: 2, twoDaysAt: 1 }), true)).toBe('final');
  });

  it('finds what the student set aside: keyed questions the plan leaves out', () => {
    const bank = new Map(items.map((entry) => [entry.id, entry]));
    const fewer = planInput({ items: planItemsFor(items.slice(0, 4)) });
    expect(setAsideIds(bank, fewer)).toEqual(['t4', 't5']);
  });
});

describe('a question on the screen', () => {
  it('splits a stem into its words and its code, line by line', () => {
    const stem = 'Что выведет программа?\nint a = 7;\nint b = 2;\nConsole.WriteLine(a / b);';
    expect(splitStem(stem, true)).toEqual({ before: 'Что выведет программа?', code: 'int a = 7;\nint b = 2;\nConsole.WriteLine(a / b);', after: '' });
    expect(splitStem('Какая команда удаляет таблицу?', true).code).toBeNull();
    expect(splitStem(stem, false).code).toBeNull();
    expect(codeLike('    return x;')).toBe(true);
    expect(codeLike('Какая нормальная форма (третья) нужна?')).toBe(false);
  });

  it('grades on the device as the server does: one option, all or nothing, a short answer’s forms', () => {
    const [iso, multi, short] = dbItems();
    expect(gradeLocal(iso, { chosen: [3], text: null })).toBe(true);
    expect(gradeLocal(iso, { chosen: [2], text: null })).toBe(false);
    expect(gradeLocal(iso, { chosen: null, text: null })).toBe(false);
    expect(gradeLocal(multi, { chosen: [3, 0, 2], text: null })).toBe(true);
    expect(gradeLocal(multi, { chosen: [0, 2], text: null })).toBe(false);
    expect(gradeLocal(short, { chosen: null, text: '  rollback. ' })).toBe(true);
    expect(gradeLocal(short, { chosen: null, text: 'commit' })).toBe(false);
    expect(shortNorm('Ёлка  Зелёная.')).toBe('елка зеленая');
  });

  it('names the key by the letters as shown', () => {
    expect(keyLetters(dbItems()[0], [3, 0, 1, 2])).toEqual(['А']);
    expect(keyLetters(dbItems()[1], [0, 1, 2, 3, 4])).toEqual(['А', 'В', 'Г']);
  });

  it('reads a topic’s number from its title', () => {
    expect(topicNumber('Тема 2.12. Индексы')).toBe('2.12');
    expect(topicNumber('3.1 Модель OSI')).toBe('3.1');
    expect(topicNumber('Индексы')).toBeNull();
  });
});

describe('the end of a session', () => {
  const record = (id: string, n: number, over: Partial<StudyRecord> = {}): StudyRecord => ({ id, retry: false, correct: true, dontKnow: false, misclick: false, clientEventId: `s:${n}`, ...over });
  const saved = (step: AnswerResult['step'], state: Partial<NonNullable<AnswerResult['state']>> = {}): AnswerResult => ({
    client_event_id: null,
    status: 'saved',
    step,
    state: {
      item_rev: 1, seen: 1, right: 1, wrong: 0, last_result: 'right', first_seen_day: null, last_answer_day: null, streak_at: null, streak_day: null,
      two_days_at: null, two_days_day: null, named_at: null, checks: 0, peek_day: null, was_two_days: false, clean_ok_at: null, ...state,
    },
  });

  it('counts what moved in the figure from the server’s steps, the first try and the errors', () => {
    const records = [
      record('a', 1),
      record('b', 2),
      record('c', 3, { correct: false }),
      record('d', 4, { correct: false, misclick: true }),
      record('c', 5, { retry: true }),
      record('e', 6, { correct: false, dontKnow: true }),
    ];
    const results = new Map<string, AnswerResult>([
      ['s:1', saved('two_days')],
      ['s:2', saved('too_early', { streak_at: '2026-10-09T18:00:00Z', streak_day: '2026-10-09' })],
      ['s:3', saved('miss')],
      ['s:6', saved('miss')],
    ]);
    const before = new Map<string, UnitState | undefined>([['c', unit({ seen: 3, twoDaysAt: 1, namedAt: 1 })]]);
    const s = summarize(records, results, before, '2026-10-10', 'Europe/Minsk');
    expect(s).toMatchObject({ questions: 5, retries: 1, firstRight: 2, errors: 2, known: true, gained: 1, dropped: 1, tooEarly: 1 });
    // 18:00 UTC + 20 h = 14:00 UTC the next day = 17:00 in Minsk.
    expect(s.tooEarlyAt).toBe(Date.parse('2026-10-10T14:00:00Z'));
  });

  it('knows nothing of the figure without the server (offline)', () => {
    const s = summarize([record('a', 1)], new Map(), new Map(), '2026-10-10', 'Europe/Minsk');
    expect(s.known).toBe(false);
    expect(s.gained).toBe(0);
  });

  it('says «завтра после 17:00» for a start the day before, and only «завтра» when it falls early in the morning', () => {
    expect(tomorrowTime(Date.parse('2026-10-11T14:00:00Z'), '2026-10-10', 'Europe/Minsk')).toBe('17:00');
    expect(tomorrowTime(Date.parse('2026-10-11T01:00:00Z'), '2026-10-10', 'Europe/Minsk')).toBeNull();
  });
});
