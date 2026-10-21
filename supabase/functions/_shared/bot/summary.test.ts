// The end of a «занятие» (spec §4.4 I1, I2): the record from the session's counts and the plan's own lines, through
// the linter; plurals; the buttons of what comes next.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decode } from './codec.ts';
import { visibleText } from './html.ts';
import { lintMessage } from './lint.ts';
import {
  droppedLine, emptyCounts, errorsLine, gainedLine, nextLabels, scoreLine, skippedLine, summaryOut, timeLine, tooEarlyLine,
  type RestOfDay, type SessionCounts, type SummaryInput,
} from './summary.ts';
import { matchSnapshots, type Shot } from './fixtures/session/snapshot.ts';
import { CID } from './fixtures/scenario.ts';

const SID = '7k2pm9qa';
const words = (html: string) => visibleText(html).replace(/\u00a0/g, ' ');
const go = (mode: 'p' | 'e' | 'x') => `go|${CID}|${mode}`;

const counts = (c: Partial<SessionCounts>): SessionCounts => ({ ...emptyCounts(), ...c });
const rest = (r: Partial<RestOfDay>): RestOfDay => ({ line: '', extra: [], next: null, moreNew: null, link: null, ...r });

/** I1 of the spec: «Базы данных: 20 вопросов и 6 повторов за 11 минут» … «Сегодня осталось 70 вопросов, около 35 минут.» */
const I1: SummaryInput = {
  sid: SID, pos: 26, subject: 'Базы данных',
  counts: counts({ questions: 20, right: 13, wrong: 5, dontKnow: 2, retries: 6, gained: 4 }),
  questions: 20, minutes: 11, end: 'done', figure: { twoDays: 147, inPlan: 960 }, firstCount: null, tooEarlyAt: null,
  rest: rest({ line: 'Сегодня осталось 70 вопросов, около 35 минут.', next: { label: 'Дальше: Компьютерные сети', data: go('p') } }),
  resume: null,
};

function check(name: string, input: SummaryInput, user: string[] = []): Shot {
  const out = summaryOut(input);
  const problems = lintMessage({ text: out.text, keyboard: out.keyboard, chat: 'private', user: [input.subject, ...user] });
  assert.deepEqual(problems, [], `${name}: ${problems.join('; ')}`);
  return { text: out.text, keyboard: out.keyboard ?? null };
}

test('every record (I1, I2 and their lines by occasion) passes the linter and matches its snapshot', () => {
  const longName = 'Операционные системы и сети передачи данных';
  const shots: Record<string, Shot> = {
    i1_next_subject: check('i1', I1),
    i1_more_same_subject: check('i1s', { ...I1, rest: rest({ line: I1.rest.line, next: { label: 'Ещё 20 вопросов', data: go('p') } }) }),
    i1_next_long_subject: check('i1l', { ...I1, rest: rest({ line: I1.rest.line, ...(() => { const l = nextLabels(false, longName, 20); return { next: { label: l.label, data: go('p') }, extra: [l.line as string] }; })() }) }, [longName]),
    i1_dropped: check('i1d', { ...I1, counts: counts({ ...I1.counts, dropped: 2 }) }),
    i1_not_moved: check('i1n', { ...I1, counts: counts({ ...I1.counts, gained: 0, started: 6 }) }),
    i1_first_count: check('i1f', { ...I1, counts: counts({ ...I1.counts, gained: 0, started: 6 }), figure: { twoDays: 0, inPlan: 960 }, firstCount: 'Ответьте верно ещё раз завтра после 17:00, и первые вопросы будут выучены' }),
    i1_too_early: check('i1t', { ...I1, counts: counts({ questions: 20, right: 20, tooEarly: 3 }), tooEarlyAt: '19:00', rest: rest({ line: 'На сегодня всё: 112 вопросов за 50 минут.' }) }),
    i1_skipped: check('i1k', { ...I1, counts: counts({ ...I1.counts, skipped: 1 }) }),
    i1_day_done: check('i1x', { ...I1, rest: rest({ line: 'На сегодня всё: 90 вопросов за 45 минут. Ещё 20 новых можно пройти сейчас. Тогда завтра их будет меньше.', moreNew: { label: 'Ещё 20 новых', data: go('x') } }) }),
    i1_oral_left: check('i1o', { ...I1, rest: rest({ line: 'Сегодня осталось 6 вопросов, около 10 минут.', link: { label: 'Устные на сайте', url: `https://ludosiel-studyforge.hf.space/exams/c/${CID}` } }) }),
    i2_stopped: check('i2', {
      sid: SID, pos: 7, subject: 'Базы данных', counts: counts({ questions: 7, right: 5, wrong: 2 }), questions: 7, minutes: 3, end: 'stopped',
      figure: { twoDays: 143, inPlan: 960 }, firstCount: null, tooEarlyAt: null, rest: rest({ line: 'Сегодня осталось 83 вопроса, около 40 минут.' }),
      resume: { n: 8, of: 20 },
    }),
  };
  matchSnapshots('summary', shots);
});

test('I1 reads as the spec\'s example, the figure in the plan\'s words; «Дальше: <предмет>» is the one blue, «Готово» takes the keyboard off', () => {
  const out = summaryOut(I1);
  assert.equal(words(out.text), [
    'Базы данных: 20 вопросов и 6 повторов за 11 минут',
    '13 верно, 5 неверно, 2 не знали',
    'Ошибки повторили. Завтра повторим их ещё раз.',
    'Выучено ещё 4 вопроса. Всего 147 из 960.',
    '',
    'Сегодня осталось 70 вопросов, около 35 минут.',
  ].join('\n'));
  assert.ok(out.text.startsWith('<b>Базы данных: 20'));
  assert.deepEqual(out.keyboard!.map((r) => r.map((b) => [b.text, b.data, b.style ?? ''])), [
    [['Дальше: Компьютерные сети', go('p'), 'primary']], [['Готово', `s|${SID}|26|g`, '']],
  ]);
  assert.deepEqual(decode(out.keyboard![1][0].data), { kind: 'session', sid: SID, pos: 26, act: { a: 'done' } });
});

test('I2: «Закончить» — the mistakes come back tomorrow, «Продолжить: 8 из 20» (s|<sid>|<pos>|c) only', () => {
  const out = summaryOut({ ...I1, end: 'stopped', pos: 7, counts: counts({ questions: 7, right: 5, wrong: 2 }), questions: 7, minutes: 3, figure: null,
    rest: rest({ line: 'Сегодня осталось 83 вопроса, около 40 минут.' }), resume: { n: 8, of: 20 } });
  assert.equal(words(out.text), 'Базы данных: 7 вопросов за 3 минуты\n5 верно, 2 неверно\nОшибки повторим завтра.\n\nСегодня осталось 83 вопроса, около 40 минут.');
  assert.deepEqual(out.keyboard, [[{ text: 'Продолжить: 8 из 20', data: `s|${SID}|7|c`, style: 'primary' }]]);
  const noResume = summaryOut({ ...I1, end: 'stopped', resume: null });
  assert.deepEqual(noResume.keyboard!.map((r) => r.map((b) => b.text)), [['Готово']]);
});

test('before a day off the record names the next study day (`back`), through the linter; every day it is the record as it was', () => {
  const input: SummaryInput = { ...I1, counts: counts({ ...I1.counts, tooEarly: 2 }), back: 'в понедельник' };
  const out = summaryOut(input);
  assert.deepEqual(lintMessage({ text: out.text, keyboard: out.keyboard, chat: 'private', user: [input.subject] }), []);
  const text = words(out.text);
  assert.match(text, /\nОшибки повторили\. В понедельник повторим их ещё раз\.\n/);
  assert.match(text, /\n2 вопроса ещё не выучены, с прошлого верного ответа не прошло 20 часов. Ответьте ещё раз в понедельник\.\n/);
  assert.ok(out.text.includes('в\u00a0понедельник'), 'the preposition keeps its word');
  const stopped = summaryOut({ ...input, end: 'stopped', counts: counts({ questions: 7, right: 5, wrong: 2 }), back: 'во вторник' });
  assert.match(words(stopped.text), /\nОшибки повторим во вторник\.\n/);
  assert.deepEqual(summaryOut({ ...I1, back: 'завтра' }), summaryOut(I1));
});

test('I1 with more today: «Открыть занятие» (the Mini App) between the blue and «Готово»; never on I2 or a finished day', () => {
  const app = { label: 'Открыть занятие', webApp: `https://ludosiel-studyforge.hf.space/tg?c=${CID}` };
  const out = summaryOut({ ...I1, rest: { ...I1.rest, app } });
  assert.deepEqual(out.keyboard!.map((row) => row.map((b) => b.text)), [['Дальше: Компьютерные сети'], ['Открыть занятие'], ['Готово']]);
  assert.deepEqual(out.keyboard![1][0], { text: 'Открыть занятие', webApp: app.webApp });
  assert.deepEqual(lintMessage({ text: out.text, keyboard: out.keyboard, chat: 'private', user: [I1.subject] }), []);
  const stopped = summaryOut({ ...I1, end: 'stopped', resume: { n: 8, of: 20 }, rest: { ...I1.rest, app } });
  assert.ok(stopped.keyboard!.flat().every((b) => b.webApp === undefined));
  const finished = summaryOut({ ...I1, rest: rest({ line: 'На сегодня всё.', moreNew: { label: 'Ещё 20 новых', data: go('x') }, app }) });
  assert.ok(finished.keyboard!.flat().every((b) => b.webApp === undefined));
});

test('the day done: [[Готово]] and «Ещё 20 новых» (go|<cid>|x); nothing next: [[Готово]] alone', () => {
  const done = summaryOut({ ...I1, rest: rest({ line: 'На сегодня всё.', moreNew: { label: 'Ещё 20 новых', data: go('x') } }) });
  assert.deepEqual(done.keyboard!.map((r) => r.map((b) => [b.text, b.style ?? ''])), [[['Готово', 'primary']], [['Ещё 20 новых', '']]]);
  const nothing = summaryOut({ ...I1, rest: rest({ line: '' }) });
  assert.deepEqual(nothing.keyboard!.map((r) => r.map((b) => b.text)), [['Готово']]);
  assert.ok(!words(nothing.text).endsWith('\n'), 'no empty line without the plan\'s line');
});

test('the lines and their plurals', () => {
  assert.equal(timeLine(20, 6, 11).replace(/\u00a0/g, ' '), '20 вопросов и 6 повторов за 11 минут');
  assert.equal(timeLine(1, 1, 1).replace(/\u00a0/g, ' '), '1 вопрос и 1 повтор за 1 минуту');
  assert.equal(timeLine(7, 0, 3).replace(/\u00a0/g, ' '), '7 вопросов за 3 минуты');
  assert.equal(timeLine(22, 2, 0).replace(/\u00a0/g, ' '), '22 вопроса и 2 повтора за 1 минуту');
  assert.equal(scoreLine(counts({ right: 13, wrong: 5, dontKnow: 2 })), '13 верно, 5 неверно, 2 не знали');
  assert.equal(scoreLine(counts({ wrong: 3 })), '3 неверно');
  assert.equal(scoreLine(counts({})), null);
  assert.equal(errorsLine(counts({ wrong: 1, retries: 1 }), 'done'), 'Ошибки повторили. Завтра повторим их ещё раз.');
  assert.equal(errorsLine(counts({ wrong: 1 }), 'stopped'), 'Ошибки повторим завтра.');
  assert.equal(errorsLine(counts({ right: 3 }), 'done'), null);
  assert.equal(gainedLine(1, { twoDays: 144, inPlan: 960 }).replace(/\u00a0/g, ' '), 'Выучен ещё 1 вопрос. Всего 144 из 960.');
  assert.equal(gainedLine(21, { twoDays: 164, inPlan: 960 }).replace(/\u00a0/g, ' '), 'Выучен ещё 21 вопрос. Всего 164 из 960.');
  assert.equal(droppedLine(1).replace(/\u00a0/g, ' '), '1 выученный вопрос снова с ошибкой. Его нужно выучить заново.');
  assert.equal(droppedLine(2).replace(/\u00a0/g, ' '), '2 выученных вопроса снова с ошибкой. Их нужно выучить заново.');
  assert.equal(tooEarlyLine(3, '19:00').replace(/\u00a0/g, ' '), '3 вопроса ещё не выучены, с прошлого верного ответа не прошло 20 часов. Ответьте ещё раз после 19:00.');
  assert.equal(tooEarlyLine(1, null).replace(/\u00a0/g, ' '), '1 вопрос ещё не выучен, с прошлого верного ответа не прошло 20 часов. Ответьте ещё раз завтра.');
  // Before a day off (the record's `back`): the next study day; «завтра» is the same line as above.
  assert.equal(errorsLine(counts({ wrong: 1, retries: 1 }), 'done', 'в воскресенье'), 'Ошибки повторили. В воскресенье повторим их ещё раз.');
  assert.equal(errorsLine(counts({ dontKnow: 2 }), 'stopped', 'в понедельник'), 'Ошибки повторим в понедельник.');
  assert.equal(errorsLine(counts({ wrong: 1 }), 'stopped', '16 октября'), 'Ошибки повторим 16 октября.');
  assert.equal(errorsLine(counts({ wrong: 1, retries: 1 }), 'done', 'завтра'), errorsLine(counts({ wrong: 1, retries: 1 }), 'done'));
  assert.equal(tooEarlyLine(1, null, 'в понедельник').replace(/\u00a0/g, ' '), '1 вопрос ещё не выучен, с прошлого верного ответа не прошло 20 часов. Ответьте ещё раз в понедельник.');
  assert.equal(tooEarlyLine(3, '19:00', 'в понедельник'), tooEarlyLine(3, '19:00'), 'later today the time wins');
  assert.equal(skippedLine(1).replace(/\u00a0/g, ' '), '1 вопрос можно решить только на сайте, он не помещается в сообщение Telegram.');
  assert.equal(skippedLine(3).replace(/\u00a0/g, ' '), '3 вопроса можно решить только на сайте, они не помещаются в сообщение Telegram.');
});

test('«Дальше: <предмет>» up to 26 characters, else «Дальше: 20 вопросов» and the subject named in the text', () => {
  assert.deepEqual(nextLabels(false, 'Компьютерные сети', 20), { label: 'Дальше: Компьютерные сети', line: null });
  const long = nextLabels(false, 'Операционные системы и сети передачи данных', 20);
  assert.equal(long.label.replace(/\u00a0/g, ' '), 'Дальше: 20 вопросов');
  assert.equal(long.line, 'Дальше: Операционные системы и сети передачи данных.');
  assert.equal(nextLabels(true, 'Базы данных', 12).label.replace(/\u00a0/g, ' '), 'Ещё 12 вопросов');
  assert.ok([...nextLabels(false, 'x'.repeat(18), 20).label].length <= 26);
});

test('a record without a question answered (all left to the site) names the subject only', () => {
  const out = summaryOut({ ...I1, counts: counts({ skipped: 2 }), questions: 0 });
  assert.equal(words(out.text).split('\n')[0], 'Базы данных');
  assert.ok(words(out.text).includes('2 вопроса можно решить только на сайте, они не помещаются в сообщение Telegram.'));
});
