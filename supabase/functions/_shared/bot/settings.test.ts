// Settings, pause, help (spec §4.5) and the failure lines (§4.8): snapshots through the linter; dates typed into
// the pause prompt; the pause buttons' days.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { lintMessage } from './lint.ts';
import { comesToday, isDatePrompt, k2No, k2Yes, parseDate, pauseDay, pausedScreen, s1, s2, s3, s4, s5, s6, unlinkedScreen, unpausedScreen } from './settings.ts';
import { t, b, lines, visibleText } from './html.ts';
import type { Out } from './tg.ts';
import { AUTUMN, botExamsOf, CID2, linkOf, TITLE, TITLE2 } from './fixtures/scenario.ts';
import { matchSnapshots, type Shot } from './fixtures/snapshot.ts';
import * as W from './words.ts';

const SITE = 'https://ludosiel-studyforge.hf.space';
const EXAM = { title: TITLE, date: '2026-11-03' };
const WINTER = { id: CID2, title: TITLE2, date: '2026-12-20' };
const ONE = botExamsOf([AUTUMN]);
const TWO = botExamsOf([AUTUMN, WINTER]);

function check(name: string, out: Out, user: string[] = [], toasts?: string[]): Shot {
  const problems = lintMessage({ text: out.text, keyboard: out.keyboard, user, toasts });
  assert.deepEqual(problems, [], `${name}: ${problems.join('; ')}`);
  return toasts ? { text: out.text, keyboard: out.keyboard ?? null, toasts } : { text: out.text, keyboard: out.keyboard ?? null };
}

test('every message of §4.5 passes the linter and matches its snapshot', () => {
  const link = linkOf();
  const prompt = (text: string): Out => ({ text: t(text), keyboard: null });
  const shots: Record<string, Shot> = {
    // Release 47: S1 has «Экзамены» when the user has an exam (s1, s1_paused, s1_off gained that row).
    s1: check('s1', s1(link, EXAM, ONE), [TITLE]),
    s1_paused: check('s1_paused', s1(linkOf({ pausedUntil: '2026-10-19' }), EXAM, ONE), [TITLE]),
    s1_off: check('s1_off', s1(linkOf({ remindOn: false }), EXAM, ONE), [TITLE]),
    s1_no_exam: check('s1_no_exam', s1(linkOf({ tz: 'America/Lima' }), null)),
    s1_two_exams: check('s1_two_exams', s1(link, EXAM, TWO), [TITLE, TITLE2]),
    s1_none_chosen: check('s1_none_chosen', s1(link, null, TWO.map((e) => ({ ...e, on: false }))), [TITLE, TITLE2]),
    s2: check('s2', s2()),
    s3: check('s3', s3()),
    s3_until_tomorrow: check('s3_until_tomorrow', pausedScreen(link, '2026-10-17')),
    s3_until_monday: check('s3_until_monday', pausedScreen(link, '2026-10-19')),
    s3_until_date: check('s3_until_date', pausedScreen(link, '2026-10-25')),
    s3_prompt: check('s3_prompt', prompt(W.DATE_PROMPT)),
    s3_bad: check('s3_bad', prompt(W.DATE_BAD)),
    s3_past: check('s3_past', prompt(W.DATE_PAST)),
    s3_after_exam: check('s3_after_exam', prompt(W.dateAfterExam('2026-11-03'))),
    s3_unpaused_today: check('s3_unpaused_today', unpausedScreen(linkOf({ localTime: 18 * 60 }))),
    s3_unpaused_tomorrow: check('s3_unpaused_tomorrow', unpausedScreen(linkOf({ localTime: 23 * 60 + 10 }))),
    s4: check('s4', s4()),
    s4_done: check('s4_done', unlinkedScreen(SITE)),
    s5: check('s5', s5()),
    s6: check('s6', s6()),
    k2_yes: check('k2_yes', k2Yes(link)),
    k2_no: check('k2_no', k2No()),
  };
  matchSnapshots('settings', shots);
});

test('the lines of §4.8 (presses that fail, old buttons) pass the toast rules; «Повторить» is the one blue', () => {
  const toasts = [W.DB_DOWN_TAP, W.OLD_BUTTON, W.SESSION_OVER, W.KEY_STALE, W.ITEM_GONE, W.NOT_LINKED];
  const shots: Record<string, Shot> = {
    toasts: check('toasts', { text: t('Базы данных · 8 из 20'), keyboard: null }, [], toasts),
    db_down_again: check('db_down_again', { text: lines(t('Базы данных · 8 из 20'), t(W.DB_DOWN_AGAIN)), keyboard: [[{ text: W.RETRY, data: 's|7k2pm9qa|8|1', style: 'primary' }]] }),
    exam_gone: check('exam_gone', { text: t(W.examGone(TITLE)), keyboard: null }, [TITLE]),
  };
  for (const toast of toasts) assert.ok([...toast].length <= 200);
  matchSnapshots('failures', shots);
  assert.equal(b('x'), '<b>x</b>');
});

test('S1 (release 47): the exams in the plan; «Экзамены» under the time and the pause', () => {
  const words = (out: Out) => visibleText(out.text).replace(/ /g, ' ').split('\n');
  assert.equal(words(s1(linkOf(), EXAM, ONE))[2], 'Экзамен «Осенняя сессия», 3 ноября.');
  assert.equal(words(s1(linkOf(), EXAM, TWO))[2], 'Экзамены в плане: «Осенняя сессия», «Зимняя сессия».');
  assert.equal(words(s1(linkOf(), EXAM, [TWO[0], { ...TWO[1], on: false }]))[2], 'Экзамен «Осенняя сессия», 3 ноября.', 'one of two in the plan');
  assert.equal(words(s1(linkOf(), null, TWO.map((e) => ({ ...e, on: false }))))[2], 'Ни один экзамен не выбран, поэтому план не приходит.');
  // passed exams are not «in the plan»; without a current one the lead exam's line stays
  const passed = TWO.map((e) => ({ ...e, state: 'after' as const }));
  assert.equal(words(s1(linkOf(), null, passed))[2], W.NO_EXAM);
  assert.deepEqual(s1(linkOf(), EXAM, ONE).keyboard!.map((r) => r.map((b) => b.data)), [['st|time', 'st|pause'], ['xl|s'], ['st|off']]);
  assert.deepEqual(s1(linkOf(), null).keyboard!.map((r) => r.map((b) => b.data)), [['st|time', 'st|pause'], ['st|off']], 'no exam: no «Экзамены»');
});

test('S1: the time by city for frequent zones, the IANA name otherwise; «Снять паузу» in place of «Пауза»', () => {
  assert.match(s1(linkOf(), EXAM).text, /по Минску/);
  assert.match(s1(linkOf({ tz: 'Asia/Vladivostok' }), EXAM).text, /по Владивостоку/);
  assert.match(s1(linkOf({ tz: 'America/Lima' }), EXAM).text, /\(America\/Lima\)/);
  assert.deepEqual(s1(linkOf(), EXAM).keyboard![0].map((x) => x.data), ['st|time', 'st|pause']);
  assert.deepEqual(s1(linkOf({ pausedUntil: '2026-10-19' }), EXAM).keyboard![0].map((x) => [x.text, x.data]), [['Время', 'st|time'], ['Снять паузу', 'p|off']]);
  assert.match(s1(linkOf({ pausedUntil: '2026-10-19' }), EXAM).text, /Пауза до понедельника, 19 октября\./);
});

test('pause buttons: until tomorrow, for 3 days, until Monday (next week on a Monday)', () => {
  assert.equal(pauseDay('1', '2026-10-16'), '2026-10-17');
  assert.equal(pauseDay('3', '2026-10-16'), '2026-10-19');
  assert.equal(pauseDay('mon', '2026-10-16'), '2026-10-19');
  assert.equal(pauseDay('mon', '2026-10-18'), '2026-10-19');
  assert.equal(pauseDay('mon', '2026-10-19'), '2026-10-26');
});

test('a typed date: «25.10», «25.10.2026», «25/10/26», «25-10», «25 10», «25 октября»; the year rolls over in winter', () => {
  const today = '2026-10-16';
  const cases: Array<[string, string | null]> = [
    ['25.10', '2026-10-25'], ['25.10.2026', '2026-10-25'], ['25/10/26', '2026-10-25'], ['25-10', '2026-10-25'], ['25 10', '2026-10-25'],
    ['25 октября', '2026-10-25'], ['3 ноября', '2026-11-03'], ['1 мая', '2026-05-01'], ['10.10', '2026-10-10'], ['05.01', '2027-01-05'],
    ['31.02', null], ['32.13', null], ['завтра', null], ['25', null], ['', null], ['25 смарта', null],
  ];
  for (const [text, day] of cases) assert.equal(parseDate(text, today), day, text);
  assert.equal(parseDate('05.01', '2026-12-20'), '2027-01-05');
  assert.equal(parseDate('29.02', '2027-10-16'), '2028-02-29', 'no 29 February in 2027: the next one');
});

test('unpausing: the card can still come today until the 3-hour window or 23:00 ends', () => {
  assert.equal(comesToday(linkOf({ remindAt: 20 * 60, localTime: 19 * 60 })), true);
  assert.equal(comesToday(linkOf({ remindAt: 20 * 60, localTime: 22 * 60 + 59 })), true);
  assert.equal(comesToday(linkOf({ remindAt: 20 * 60, localTime: 23 * 60 })), false);
  assert.equal(comesToday(linkOf({ remindAt: 7 * 60 + 30, localTime: 10 * 60 + 30 })), false);
});

test('the date prompts are recognised by their text', () => {
  assert.ok(isDatePrompt(W.DATE_PROMPT));
  assert.ok(isDatePrompt(W.DATE_BAD));
  assert.ok(isDatePrompt(W.DATE_PAST));
  assert.ok(isDatePrompt(W.dateAfterExam('2026-11-03').replace(/ /g, ' ')));
  assert.ok(!isDatePrompt(W.TIME_PROMPT));
});
