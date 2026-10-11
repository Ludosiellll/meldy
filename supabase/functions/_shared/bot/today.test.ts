// The plan side of a «занятие» (spec §4.3, §4.4): what a start takes (the copied buildSession / freeSession / extraNew,
// seeded by the sid), what the record offers next, all through T2's seam (card.ts dayView).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dayView, planSentence } from './card.ts';
import { decode } from './codec.ts';
import {
  answeredToday, clsOf, comesBackText, errorsSubject, examOf, firstCountText, kindOfMode, modeOfKind, pickBlock, restOfDay,
} from './today.ts';
import { buildSession } from '../plan/session.ts';
import { emptyState } from '../plan/rule.ts';
import { AUTUMN, CID, CID2, NOW, SUBJECT_IDS, SUBJECTS, TITLE2, todayOf } from './fixtures/scenario.ts';

const SITE = 'https://ludosiel-studyforge.hf.space';
const H = 3_600_000;
const unit = (u: Partial<ReturnType<typeof emptyState>>) => ({ ...emptyState(), ...u });

test('the plan\'s block (go|<cid>|p): the first block with options, 20 of one subject, seeded by the sid — the copied buildSession', () => {
  const exam = examOf(todayOf([AUTUMN]), CID)!;
  assert.ok(exam);
  const first = exam.plan.sessions.find((s) => s.kind === 'answer')!;
  const a = pickBlock(exam, 'p', '7k2pm9qa')!;
  assert.equal(a.kind, 'plan');
  assert.equal(a.subjectId, first.subjectId);
  assert.equal(a.subjectTitle, SUBJECTS[SUBJECT_IDS.indexOf(first.subjectId)]);
  assert.equal(a.queue.length, 20);
  assert.ok(a.queue.every((e) => e.retry === 0));
  assert.deepEqual(a.queue, buildSession(exam.plan, first.subjectId, 'answer', [...answeredToday(exam.input, exam.plan.day)], '7k2pm9qa'));
  assert.deepEqual(pickBlock(exam, 'p', '7k2pm9qa')!.queue, a.queue, 'the same sid, the same queue');
  const b = pickBlock(exam, 'p', 'abcdefgh')!;
  assert.deepEqual([...b.queue.map((e) => e.id)].sort(), [...a.queue.map((e) => e.id)].sort(), 'the same questions');
  assert.notDeepEqual(b.queue.map((e) => e.id), a.queue.map((e) => e.id), 'in another order');
  assert.equal(a.cls.length, a.queue.length);
  const units = new Map(exam.input.items.map((i) => [i.id, i.u]));
  assert.deepEqual(a.cls, a.queue.map((e) => clsOf(units.get(e.id), exam.plan.window.inWindow)));
});

test('«Только ошибки» (go|<cid>|e): open errors of the first subject that has some, not answered today; class «free»', () => {
  const exam = examOf(todayOf([AUTUMN]), CID)!;
  const block = pickBlock(exam, 'e', '7k2pm9qa')!;
  assert.equal(block.kind, 'errors');
  const items = new Map(exam.input.items.map((i) => [i.id, i]));
  assert.ok(block.queue.length > 0 && block.queue.length <= 20);
  for (const e of block.queue) {
    const u = items.get(e.id)!.u!;
    assert.ok(u.wrong > 0 && u.seriesAt === null && u.twoDaysAt === null, 'an open error');
    assert.equal(items.get(e.id)!.s, block.subjectId);
  }
  assert.ok(block.cls.every((c) => c === 'free'));
  assert.equal(errorsSubject(exam, new Set()), block.subjectId);
  const none = examOf(todayOf([{ id: CID, title: 'Осенняя сессия', date: '2026-11-03', started: 30 }]), CID)!;
  assert.equal(pickBlock(none, 'e', '7k2pm9qa'), null, 'no errors: nothing to start');
});

test('«Ещё 20 новых» (go|<cid>|x): the copied extraNew past today\'s plan, in a seeded order; class «new_fill»', () => {
  const done = todayOf([{ id: CID, title: 'Осенняя сессия', date: '2026-11-03', perSubject: 60, answeredToday: 20, today: { firstAt: Math.floor((NOW - 3 * H) / 1000), doneSec: 2700 } }]);
  const exam = examOf(done, CID)!;
  assert.ok(exam.plan.state === 'done' || exam.plan.state === 'nothing', exam.plan.state);
  const block = pickBlock(exam, 'x', '7k2pm9qa')!;
  assert.equal(block.kind, 'extra');
  assert.equal(block.queue.length, 20);
  assert.ok(block.cls.every((c) => c === 'new_fill'));
  const planned = new Set(exam.plan.sessions.flatMap((s) => s.ids));
  assert.ok(block.queue.every((e) => !planned.has(e.id)));
  assert.notDeepEqual(pickBlock(exam, 'x', 'abcdefgh')!.queue.map((e) => e.id), block.queue.map((e) => e.id));
  assert.equal(kindOfMode('x'), 'extra');
  assert.equal(modeOfKind('errors'), 'e');
});

test('the rest of the day: the plan\'s sentence; «Ещё N вопросов» in the same subject, «Дальше: <предмет>» in another', () => {
  const today = todayOf([{ ...AUTUMN, answeredToday: 44, today: { firstAt: Math.floor((NOW - 9 * H) / 1000), doneSec: 1500 } }]);
  const exam = examOf(today, CID)!;
  const first = exam.plan.sessions.find((s) => s.kind === 'answer')!;
  const same = restOfDay(exam, { subjectId: first.subjectId, kind: 'plan' }, SITE);
  assert.equal(same.line, planSentence(exam));
  assert.match(same.line.replace(/\u00a0/g, ' '), /^Сегодня осталось \d+ вопрос/);
  assert.match(same.next!.label.replace(/\u00a0/g, ' '), /^Ещё \d+ вопрос/);
  assert.deepEqual(decode(same.next!.data), { kind: 'go', cid: CID, mode: 'p' });
  const other = restOfDay(exam, { subjectId: 'another-subject', kind: 'plan' }, SITE);
  assert.equal(other.next!.label, `Дальше: ${SUBJECTS[SUBJECT_IDS.indexOf(first.subjectId)]}`);
  assert.equal(other.moreNew, null);
});

test('the rest of the day offers the same day in the Mini App only while there is a next block', () => {
  const today = todayOf([{ ...AUTUMN, answeredToday: 44, today: { firstAt: Math.floor((NOW - 9 * H) / 1000), doneSec: 1500 } }]);
  const exam = examOf(today, CID)!;
  const r = restOfDay(exam, { subjectId: exam.plan.sessions.find((s) => s.kind === 'answer')!.subjectId, kind: 'plan' }, SITE);
  assert.ok(r.next);
  assert.deepEqual(r.app, { label: 'Открыть занятие', webApp: `${SITE}/tg?c=${CID}` });
  const done = todayOf([{ id: CID, title: 'Осенняя сессия', date: '2026-11-03', perSubject: 60, answeredToday: 20, today: { firstAt: Math.floor((NOW - 3 * H) / 1000), doneSec: 2700 } }]);
  const finished = restOfDay(examOf(done, CID)!, { subjectId: SUBJECT_IDS[0], kind: 'plan' }, SITE);
  assert.equal(finished.next, null);
  assert.equal(finished.app ?? null, null);
});

test('the rest of the day when it is done: «На сегодня всё…» with «Ещё 20 новых» (go|<cid>|x)', () => {
  const done = todayOf([{ id: CID, title: 'Осенняя сессия', date: '2026-11-03', perSubject: 60, answeredToday: 20, today: { firstAt: Math.floor((NOW - 3 * H) / 1000), doneSec: 2700 } }]);
  const exam = examOf(done, CID)!;
  const r = restOfDay(exam, { subjectId: SUBJECT_IDS[0], kind: 'plan' }, SITE);
  assert.equal(r.next, null);
  assert.equal(r.moreNew!.label.replace(/\u00a0/g, ' '), 'Ещё 20 новых');
  assert.deepEqual(decode(r.moreNew!.data), { kind: 'go', cid: CID, mode: 'x' });
  assert.match(r.line.replace(/\u00a0/g, ' '), /^На сегодня всё.* Ещё 20 новых сейчас — завтра их будет меньше\.$/);
});

test('the rest of a day off after «Ещё 20 новых»: «На сегодня всё…», «Ещё 20 новых» again, no «завтра» when tomorrow is off too', () => {
  // Пн–Чт: Friday 16 October and the weekend are days off; 20 new answered today anyway.
  const off = todayOf([{ id: CID, title: 'Осенняя сессия', date: '2026-11-03', perSubject: 60, answeredToday: 20, weekdays: 15,
    today: { firstAt: Math.floor((NOW - 3 * H) / 1000), doneSec: 600 } }]);
  const exam = examOf(off, CID)!;
  assert.equal(exam.plan.state, 'done');
  assert.ok(exam.plan.lines.some((l) => l.key === 'day_off'));
  const r = restOfDay(exam, { subjectId: SUBJECT_IDS[0], kind: 'extra' }, SITE);
  assert.equal(r.next, null);
  assert.equal(r.moreNew!.label.replace(/\u00a0/g, ' '), 'Ещё 20 новых');
  assert.match(r.line.replace(/\u00a0/g, ' '), /^На сегодня всё: 20 вопросов за 10 минут\.$/);
});

test('after errors, more errors of that subject first («Ещё N вопросов» → go|<cid>|e)', () => {
  const exam = examOf(todayOf([AUTUMN]), CID)!;
  const subject = errorsSubject(exam, new Set())!;
  const r = restOfDay(exam, { subjectId: subject, kind: 'errors' }, SITE);
  assert.deepEqual(decode(r.next!.data), { kind: 'go', cid: CID, mode: 'e' });
  assert.match(r.next!.label.replace(/\u00a0/g, ' '), /^Ещё \d+ вопрос/);
});

test('an exam that is not the user\'s any more: no plan lines; examOf goes through dayView', () => {
  const today = todayOf([AUTUMN, { id: CID2, title: TITLE2, date: '2027-01-12', started: 30 }]);
  assert.equal(examOf(today, CID2)!.title, TITLE2);
  assert.equal(examOf(today, 'a1b2c3d4-0000-4000-8000-00000000ffff'), null);
  assert.deepEqual(restOfDay(null, { subjectId: '', kind: 'plan' }, SITE), { line: '', extra: [], next: null, moreNew: null, link: null });
  assert.equal(dayView(today).exams.length, 2);
});

test('while the figure is 0, the plan\'s own «Первые войдут в счёт…» line', () => {
  const zero = examOf(todayOf([{ id: CID, title: 'Осенняя сессия', date: '2026-11-03', started: 60, errors: 5 }]), CID)!;
  assert.match((firstCountText(zero) ?? '').replace(/\u00a0/g, ' '), /^Первые войдут в счёт /);
  assert.equal(firstCountText(examOf(todayOf([AUTUMN]), CID)), null, 'the figure is not 0');
});

test('what the record says comes back: «завтра», or the exam\'s next study day when tomorrow is a day off', () => {
  // Friday 16 October: every day «завтра»; Saturday off — Sunday; the weekend off — Monday; Fridays only — a week ahead.
  const on = (weekdays: number) => comesBackText(examOf(todayOf([{ ...AUTUMN, weekdays }]), CID));
  assert.equal(comesBackText(examOf(todayOf([AUTUMN]), CID)), 'завтра');
  assert.equal(on(127), 'завтра');
  assert.equal(on(127 - 32), 'в воскресенье');
  assert.equal(on(31), 'в понедельник');
  assert.equal(on(16).replace(/\u00a0/g, ' '), '23 октября');
  assert.equal(comesBackText(null), 'завтра', 'without the exam');
});

test('answeredToday and clsOf: the site\'s model.ts rules', () => {
  assert.equal(clsOf(undefined, false), 'new_floor');
  assert.equal(clsOf(unit({ seen: 1, wrong: 1 }), false), 'relearn');
  assert.equal(clsOf(unit({ seen: 1, seriesAt: 1 }), false), 'confirm');
  assert.equal(clsOf(unit({ seen: 2, twoDaysAt: 1 }), false), 'check');
  assert.equal(clsOf(unit({ seen: 2, twoDaysAt: 1 }), true), 'final');
  const today = todayOf([{ ...AUTUMN, answeredToday: 8 }]);
  const exam = examOf(today, CID)!;
  assert.equal(answeredToday(exam.input, exam.plan.day).size, 8);
});
