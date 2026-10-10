// The day card (spec §4.2): every variant of K1's table, K2 and K3 — snapshots through the linter — and the rules
// behind them (the lead exam as «Сегодня» picks it, the plan's own words, the window line only on its eve).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { afterDateCard, askCard, dayCard, dayView, examList, figureLine, planInputOf, planNow, planSentence, timeText } from './card.ts';
import { decode } from './codec.ts';
import { lintMessage } from './lint.ts';
import { visibleText } from './html.ts';
import { planLine } from '../plan/words.ts';
import { AUTUMN, CID, CID2, DAY, itemId, linkOf, NOW, SUBJECT_IDS, TG, TITLE, TITLE2, todayOf } from './fixtures/scenario.ts';
import { matchSnapshots, type Shot } from './fixtures/snapshot.ts';
import type { CardResult } from './card.ts';
import type { Today } from './db.ts';

const SITE = 'https://ludosiel-studyforge.hf.space';
const at = (y: number, m: number, d: number) => Date.UTC(y, m - 1, d, 17, 0, 0); // 20:00 in Minsk

function lintCard(name: string, card: CardResult, chat: 'private' | 'group' = 'private') {
  const problems = lintMessage({ text: card.out.text, keyboard: card.out.keyboard, chat, user: card.user });
  assert.deepEqual(problems, [], `${name}: ${problems.join('; ')}`);
}

const shot = (card: CardResult): Shot => ({ text: card.out.text, keyboard: card.out.keyboard ?? null });

const sessionToday = (): Today => {
  const today = todayOf([{ ...AUTUMN, answeredToday: 44, today: { firstAt: Math.floor((NOW - 9 * 3_600_000) / 1000), doneSec: 1500 } }]);
  today.session = {
    sid: '7k2pm9qa', containerId: CID, subjectId: 'b1b2c3d4-0000-4000-8000-000000000102', messageId: 900, chatId: TG, position: 7,
    queue: Array.from({ length: 20 }, (_, i) => ({ id: itemId(0, 600 + i), retry: 0 as const })), localDay: DAY, kind: 'plan',
  };
  return today;
};

/** Every row of §4.2's table (and the reminder's form). */
function variants(): Record<string, CardResult> {
  return {
    k1_reminder: dayCard(todayOf([AUTUMN]), 'reminder', SITE),
    k1_today: dayCard(todayOf([AUTUMN]), 'today', SITE),
    k1_no_answers: dayCard(todayOf([{ id: CID, title: TITLE, date: '2026-11-03' }]), 'reminder', SITE),
    k1_answers_figure_zero: dayCard(todayOf([{ id: CID, title: TITLE, date: '2026-11-03', started: 60, errors: 5 }]), 'reminder', SITE),
    k1_part_done_resume: dayCard(sessionToday(), 'today', SITE),
    k1_skipped_yesterday: dayCard(todayOf([{ ...AUTUMN, lastDay: -2 }]), 'reminder', SITE),
    k1_eve_of_window: dayCard(todayOf([AUTUMN], {}, at(2026, 10, 29)), 'reminder', SITE),
    k1_in_window: dayCard(todayOf([AUTUMN], {}, at(2026, 10, 31)), 'reminder', SITE),
    k1_exam_eve: dayCard(todayOf([AUTUMN], {}, at(2026, 11, 2)), 'reminder', SITE),
    k1_exam_today: dayCard(todayOf([AUTUMN], {}, at(2026, 11, 3)), 'today', SITE),
    k1_done_today: dayCard(todayOf([{ id: CID, title: TITLE, date: '2026-11-03', perSubject: 10, answeredToday: 20,
      today: { firstAt: Math.floor((NOW - 3 * 3_600_000) / 1000), doneSec: 2700 } }]), 'today', SITE),
    k1_no_date: dayCard(todayOf([{ ...AUTUMN, date: null }]), 'reminder', SITE),
    k1_two_exams: dayCard(todayOf([AUTUMN, { id: CID2, title: TITLE2, date: '2027-01-12', started: 30 }]), 'reminder', SITE),
    k1_keys_fixed: dayCard(todayOf([AUTUMN], { exams: [{ id: CID, createdAt: null, keyChanges: 2, hasOral: false }] }), 'reminder', SITE),
    k1_oral_on_site: dayCard(todayOf([AUTUMN], { exams: [{ id: CID, createdAt: null, keyChanges: 0, hasOral: true }] }), 'reminder', SITE),
    k1_no_exam: dayCard(todayOf(null), 'today', SITE),
    k1_after_date: dayCard(todayOf([AUTUMN], {}, at(2026, 11, 5)), 'today', SITE),
  };
}

test('every K1 variant of §4.2 passes the linter and matches its snapshot', () => {
  const all = variants();
  const shots: Record<string, Shot> = {};
  for (const [name, card] of Object.entries(all)) {
    lintCard(name, card);
    shots[name] = shot(card);
  }
  const k2 = askCard(todayOf([AUTUMN]), linkOf());
  lintCard('k2', k2);
  shots.k2 = shot(k2);
  const k3 = afterDateCard({
    deliveryId: 1, chatId: TG, localDay: '2026-11-04', containerId: CID,
    exam: { title: TITLE, examDate: '2026-11-03', lastDate: '2026-11-03', firstPlanDay: '2026-10-09', activeDays: 21, answers: 6480, twoDays: 902, keyed: 960 },
  }, SITE);
  lintCard('k3', k3);
  shots.k3 = shot(k3);
  const list = { out: { text: all.k1_two_exams.out.text, keyboard: examList(todayOf([AUTUMN, { id: CID2, title: TITLE2, date: '2027-01-12', started: 30 }])) }, user: [TITLE, TITLE2] };
  assert.deepEqual(lintMessage({ text: list.out.text, keyboard: list.out.keyboard, user: list.user, options: [TITLE, TITLE2] }), []);
  shots.k1_exam_list = { text: list.out.text, keyboard: list.out.keyboard };
  matchSnapshots('card', shots);
});

test('K1: the first line is the plan\'s own line (words.ts), the figure line is the site\'s; a reminder rings, only K1 is sent', () => {
  const today = todayOf([AUTUMN]);
  const view = dayView(today);
  const main = view.main!;
  assert.equal(main.id, CID);
  const card = dayCard(today, 'reminder', SITE);
  const first = visibleText(card.out.text.split('\n')[0]).replace(/ /g, ' ');
  assert.equal(first, `${planLine(main.plan).replace(/ /g, ' ')}.`);
  assert.match(first, /^Сегодня около \d+ минут: /);
  assert.ok(card.out.text.startsWith('<b>'));
  assert.equal(visibleText(card.out.text.split('\n')[1]).replace(/ /g, ' '), 'Осенняя сессия · 3 ноября, через 18 дней');
  assert.equal(figureLine(main.plan).line.replace(/ /g, ' '), '143 из 960 — верно в два разных дня');
  assert.equal(card.send, true);
  assert.equal(card.state, 'study');
  const blue = card.out.keyboard!.flat().filter((b) => b.style === 'primary');
  assert.equal(blue.length, 1);
  assert.deepEqual(decode(blue[0].data), { kind: 'go', cid: CID, mode: 'p' });
  assert.match(blue[0].text, /^Начать: \d+ вопрос/);
  for (const state of ['k1_done_today', 'k1_exam_today', 'k1_no_exam', 'k1_after_date'] as const) assert.equal(variants()[state].send, false, state);
});

test('/today adds «Видели · ошибок сейчас», «Только ошибки» and «Открыть в Meldy»; the reminder does not', () => {
  const reminder = dayCard(todayOf([AUTUMN]), 'reminder', SITE);
  const today = dayCard(todayOf([AUTUMN]), 'today', SITE);
  assert.ok(!visibleText(reminder.out.text).includes('Видели'));
  assert.ok(visibleText(today.out.text).replace(/ /g, ' ').includes('Видели 410 · ошибок сейчас 37'));
  const labels = today.out.keyboard!.flat().map((b) => b.text);
  assert.deepEqual(labels.slice(1), ['Только ошибки: 37', 'Открыть в Meldy']);
  assert.deepEqual(decode(today.out.keyboard![1][0].data), { kind: 'go', cid: CID, mode: 'e' });
  assert.equal(today.out.keyboard![2][0].url, `${SITE}/exams/c/${CID}`);
});

test('the window line shows only on the eve of the final days and inside them', () => {
  const words = (card: CardResult) => visibleText(card.out.text).replace(/ /g, ' ');
  assert.ok(!words(variants().k1_reminder).includes('новых вопросов не будет'));
  assert.ok(words(variants().k1_eve_of_window).includes('С 30 октября новых вопросов не будет: последние 4 дня — только знакомые, сначала ошибки.'));
  assert.ok(words(variants().k1_in_window).includes('До экзамена 3 дня: новых нет, только знакомые.'));
  assert.ok(words(variants().k1_exam_eve).startsWith('Завтра экзамен. Сегодня около'));
  assert.ok(words(variants().k1_skipped_yesterday).startsWith('Вчера без занятий. Сегодня те же 45 минут — больше знакомых вопросов.'));
  for (const card of Object.values(variants())) assert.ok(!/вместо|сгор|повторени/i.test(words(card)));
});

test('an open session of today turns the blue into «Продолжить: 8 из 20» (s|<sid>|<pos>|c)', () => {
  const card = dayCard(sessionToday(), 'today', SITE);
  const blue = card.out.keyboard!.flat().find((b) => b.style === 'primary')!;
  assert.equal(blue.text, 'Продолжить: 8 из 20');
  assert.deepEqual(decode(blue.data), { kind: 'session', sid: '7k2pm9qa', pos: 7, act: { a: 'continue' } });
  const yesterday = sessionToday();
  yesterday.session!.localDay = '2026-10-15';
  assert.notEqual(dayCard(yesterday, 'today', SITE).out.keyboard!.flat().find((b) => b.style === 'primary')!.text, 'Продолжить: 8 из 20');
});

test('the lead exam: nearest date with work today; exam day first; a done day only when nothing has work; ties → newer', () => {
  const winterSoon = { id: CID2, title: TITLE2, date: '2026-10-25', started: 30 };
  assert.equal(dayView(todayOf([AUTUMN, winterSoon])).main!.id, CID2);
  assert.deepEqual(dayView(todayOf([AUTUMN, winterSoon])).others.map((e) => e.id), [CID]);
  const winterToday = { id: CID2, title: TITLE2, date: DAY, started: 30 };
  assert.equal(dayView(todayOf([AUTUMN, winterToday])).main!.id, CID2);
  const done = { id: CID2, title: TITLE2, date: '2026-10-20', perSubject: 10, answeredToday: 20, today: { firstAt: Math.floor((NOW - 3_600_000) / 1000), doneSec: 2700 } };
  assert.equal(dayView(todayOf([AUTUMN, done])).main!.id, CID, 'the done exam leads only when nothing else has work');
  const sameDay = todayOf([AUTUMN, { ...AUTUMN, id: CID2, title: TITLE2 }]);
  sameDay.exams = [{ id: CID, createdAt: '2026-10-01T00:00:00Z', keyChanges: 0, hasOral: false }, { id: CID2, createdAt: '2026-10-02T00:00:00Z', keyChanges: 0, hasOral: false }];
  assert.equal(dayView(sameDay).main!.id, CID2, 'ties: the newer exam');
  assert.equal(dayView(todayOf([AUTUMN, winterSoon]), CID).main!.id, CID, '«Другой экзамен» focuses');
});

test('«Другой экзамен» offers what the site\'s «Сегодня» lists: not an exam without questions (its card would say there is no plan)', () => {
  const empty = { id: CID2, title: TITLE2, date: '2026-10-25', perSubject: 0 };
  const today = todayOf([AUTUMN, empty]);
  const view = dayView(today);
  assert.equal(view.exams.find((e) => e.id === CID2)!.plan.state, 'empty');
  assert.deepEqual([view.main!.id, view.listed.map((e) => e.id)], [CID, [CID]]);
  assert.ok(!dayCard(today, 'today', SITE).out.keyboard!.flat().some((b) => b.text === 'Другой экзамен'));
  assert.equal(dayView(today, CID2).main!.id, CID, 'a stale focus on it falls back to the lead');
  const done = { id: CID2, title: TITLE2, date: '2026-10-20', perSubject: 10, answeredToday: 20, today: { firstAt: Math.floor((NOW - 3_600_000) / 1000), doneSec: 2700 } };
  assert.deepEqual(dayView(todayOf([AUTUMN, done])).listed.map((e) => e.id), [CID2, CID], 'a done day is still offered');
  assert.ok(dayCard(todayOf([AUTUMN, done]), 'today', SITE).out.keyboard!.flat().some((b) => b.text === 'Другой экзамен'));
  assert.deepEqual(dayView(todayOf([empty])).main!.plan.state, 'empty', 'alone, it is the «no plan» card');
});

test('M3\'s plan line and K2 use the same plan; K2 is silent and has one blue', () => {
  const now = planNow(todayOf([AUTUMN]));
  assert.equal(now.exam!.id, CID);
  assert.equal(now.line, planSentence(now.exam!));
  assert.deepEqual(planNow(todayOf(null)), { exam: null, line: 'В Meldy пока нет экзамена с планом на день. Загрузите вопросы — файл на каждый предмет или один на все.' });
  const k2 = askCard(todayOf([AUTUMN]), linkOf({ remindAt: 19 * 60 }));
  assert.match(visibleText(k2.out.text).replace(/ /g, ' ').split('\n')[1], /^Три дня он оставался без ответа\. До экзамена 18 дней, сегодня около \d+ минут\.$/);
  assert.equal(k2.out.keyboard![0][0].text, 'Да, в 19:00');
  assert.deepEqual(k2.out.keyboard!.flat().map((b) => b.data), ['ask|y', 'ask|p', 'ask|n']);
  assert.equal(timeText(450), '7:30');
});

test('K3: «За N дней» counts from the first plan day to the last date, answers with a no-break space between thousands', () => {
  const k3 = afterDateCard({
    deliveryId: 1, chatId: TG, localDay: '2026-11-04', containerId: CID,
    exam: { title: TITLE, examDate: '2026-11-03', lastDate: '2026-11-03', firstPlanDay: '2026-10-09', activeDays: 21, answers: 6480, twoDays: 902, keyed: 960 },
  }, SITE);
  const lines = visibleText(k3.out.text).split('\n');
  assert.equal(lines[0], 'Экзамен прошёл 3 ноября.');
  assert.equal(lines[1].replace(/ /g, ' '), 'За 26 дней — 21 с занятиями, 6 480 ответов.');
  assert.equal(lines[2].replace(/ /g, ' '), '902 из 960 — верно в два разных дня.');
  assert.equal(k3.out.keyboard![0][0].url, `${SITE}/exams/c/${CID}/settings`);
});

test('the oral seam: planInputOf passes today.oral (empty until T11) into the copied decoder, for every card', () => {
  const today = todayOf([AUTUMN]);
  assert.deepEqual(today.oral, []);
  assert.ok(planInputOf(today, CID).items.every((item) => item.f === 't'));
  const oral = Array.from({ length: 8 }, (_, i) => ({
    id: `oral-${i}`, s: SUBJECT_IDS[0], f: 'o' as const, tp: null, o: i + 1, l: [], m: { sc: null, rating: 0 as const, ac: null, prepared: true },
  }));
  const withOral = { ...today, oral };
  assert.equal(planInputOf(withOral, CID).items.filter((item) => item.f === 'o').length, 8);
  assert.equal(dayView(withOral).main!.plan.figure.inPlan, 968, 'the oral questions count in «из N»');
  const fresh = { ...todayOf([{ id: CID, title: TITLE, date: '2026-11-03' }]), oral };
  assert.ok(dayView(fresh).main!.plan.counts.oral > 0, 'a fresh exam plans new oral questions too');
  assert.match(visibleText(dayCard(fresh, 'reminder', SITE).out.text).replace(/\u00a0/g, ' '), /устн/);
  assert.throws(() => planInputOf({ ...today, wire: null }, CID));
});
