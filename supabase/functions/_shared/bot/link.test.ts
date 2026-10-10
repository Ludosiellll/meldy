// Linking (spec §4.1): every message M1–M6 as a snapshot through the linter; times typed into M4; the prompt rules.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { planNow } from './card.ts';
import { lintMessage } from './lint.ts';
import { m1, m2, m3, m5, m6, openPrompt, parseTime, promptOf, timeKeyboard, TIME_PROMPTS } from './link.ts';
import { t } from './html.ts';
import type { Out } from './tg.ts';
import { AUTUMN, CID, linkOf, NOW, TITLE, todayOf } from './fixtures/scenario.ts';
import { matchSnapshots, type Shot } from './fixtures/snapshot.ts';
import * as W from './words.ts';

const SITE = 'https://ludosiel-studyforge.hf.space';

function check(name: string, out: Out, user: string[] = []): Shot {
  const problems = lintMessage({ text: out.text, keyboard: out.keyboard, user });
  assert.deepEqual(problems, [], `${name}: ${problems.join('; ')}`);
  return { text: out.text, keyboard: out.keyboard ?? null };
}

test('every message of §4.1 passes the linter and matches its snapshot', () => {
  const done = todayOf([{ id: CID, title: TITLE, date: '2026-11-03', perSubject: 10, answeredToday: 20, today: { firstAt: Math.floor((NOW - 3_600_000) / 1000), doneSec: 2700 } }]);
  const prompt = (text: string): Out => ({ text: t(text), keyboard: null });
  const shots: Record<string, Shot> = {
    m1: check('m1', m1(SITE)),
    m2: check('m2', m2({ title: TITLE, date: '2026-11-03' }, 20 * 60), [TITLE]),
    m2_no_exam: check('m2_no_exam', m2(null, 20 * 60)),
    m3: check('m3', m3(SITE, 20 * 60, planNow(todayOf([AUTUMN]))), [TITLE]),
    m3_no_exam: check('m3_no_exam', m3(SITE, 20 * 60, planNow(todayOf(null)))),
    m3_done: check('m3_done', m3(SITE, 21 * 60, planNow(done)), [TITLE]),
    m4_prompt: check('m4_prompt', prompt(W.TIME_PROMPT)),
    m4_bad: check('m4_bad', prompt(W.TIME_BAD)),
    m4_range: check('m4_range', prompt(W.TIME_RANGE)),
    m5_used: check('m5_used', m5('used', SITE)!),
    m5_expired: check('m5_expired', m5('expired', SITE)!),
    m5_invalid: check('m5_invalid', m5('invalid', SITE)!),
    m5_slow_down: check('m5_slow_down', m5('slow_down', SITE)!),
    m6: check('m6', m6()),
  };
  assert.equal(m5('private_only', SITE), null);
  matchSnapshots('link', shots);
});

test('M1 and M5 lead to the profile; M2 has no blue (the choice is the step), M3 has «Начать»', () => {
  assert.equal(m1(SITE).keyboard![0][0].url, `${SITE}/profile#telegram`);
  assert.equal(m1(SITE).keyboard![0][0].style, 'primary');
  assert.equal(m5('used', SITE)!.keyboard![0][0].style, undefined);
  assert.ok(m2(null, 1200).keyboard!.flat().every((b) => !b.style));
  assert.deepEqual(timeKeyboard('link').flat().map((b) => b.text), ['7:30', '19:00', '20:00', '21:00', 'Другое время']);
  assert.deepEqual(timeKeyboard('settings').flat().map((b) => b.data), ['t|0730|s', 't|1900|s', 't|2000|s', 't|2100|s', 't|other|s']);
  const start = m3(SITE, 1200, planNow(todayOf([AUTUMN]))).keyboard![0][0];
  assert.equal(start.data, `go|${CID}|p`);
  assert.equal(start.style, 'primary');
  assert.equal(m3(SITE, 1200, planNow(todayOf(null))).keyboard![0][0].url, `${SITE}/exams/import`);
});

test('a typed time: «19:45», «7.45», «0745», «7 45», «9»; not «25:99», «12:60», «утром»', () => {
  const cases: Array<[string, number | null]> = [
    ['19:45', 19 * 60 + 45], ['7:45', 7 * 60 + 45], ['7.45', 7 * 60 + 45], ['0745', 7 * 60 + 45], ['7 45', 7 * 60 + 45], [' 9 ', 9 * 60],
    ['21-30', 21 * 60 + 30], ['25:99', null], ['12:60', null], ['24:00', null], ['утром', null], ['7:5', null], ['', null], ['19:45:10', null],
  ];
  for (const [text, minutes] of cases) assert.equal(parseTime(text), minutes, text);
  assert.ok(W.TIME_MIN === 7 * 60 && W.TIME_MAX === 22 * 60 + 59);
});

test('prompts: a reply to the stored prompt takes its target; another prompt has none; plain text only within the hour', () => {
  const stored = { kind: 'time' as const, promptId: 55, targetId: 777, from: 'link' as const, at: Math.floor(NOW / 1000) };
  const link = linkOf({ prompt: stored });
  assert.deepEqual(promptOf(link, 'time', 55), stored);
  assert.deepEqual(promptOf(link, 'time', 56), { kind: 'time', promptId: 56, targetId: null, from: 'settings', at: null });
  assert.deepEqual(promptOf(link, 'date', 55), { kind: 'date', promptId: 55, targetId: null, from: 'settings', at: null });
  assert.deepEqual(openPrompt(link, NOW + 59 * 60_000), stored);
  assert.equal(openPrompt(link, NOW + 61 * 60_000), null);
  assert.equal(openPrompt(linkOf(), NOW), null);
  assert.deepEqual([...TIME_PROMPTS], [W.TIME_PROMPT, W.TIME_BAD, W.TIME_RANGE]);
});
