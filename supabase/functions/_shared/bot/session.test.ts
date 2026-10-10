// The «занятие» in chat through the whole function (spec §4.3, §4.4, §4.8, §8.1 «Занятие»): the fake Telegram, T2's
// fake database and the fake of T5's session functions. Seed and order, repeats, keep_order, «все перечисленные»,
// masks, the short answer, pending → «Дальше» / «Нажали не туда?» / doubt / «Закончить» / flush, double taps, 4096,
// «message to edit not found», the records and «Продолжить», the failures of §4.8.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { visibleText } from './html.ts';
import { lintMessage } from './lint.ts';
import { DbError } from './db.ts';
import { createTelegram } from './tg.ts';
import type { Ctx, Tap } from './router.ts';
import { examOf } from './today.ts';
import { createSession, newSid, remark, toReply } from './session.ts';
import { buildSession } from '../plan/session.ts';
import { shownOrder } from './question.ts';
import { EDIT_NOT_FOUND, DELETE_NOT_FOUND, TEST_TOKEN } from './fixtures/fake_telegram.ts';
import { ALL_LISTED, IPV4_BITS, KEEP_ORDER, PRIVATE_IP, tooLong } from './fixtures/session/bank.ts';
import { LOGS, seeded, sessionHarness, type SessionHarness } from './fixtures/session/harness.ts';
import { CID, DAY, NOW, TG, USER } from './fixtures/scenario.ts';
import * as W from './words.ts';

/** The visible words; no-break spaces and the letter's U+2002 read as spaces. */
const words = (html: string | undefined) => visibleText(html ?? '').replace(/[\u00a0\u2002]/g, ' ');
const MIN = 60_000;

/** A linked student pressing «Начать» on the day card (message 900). */
async function started(options: Parameters<typeof sessionHarness>[0] = {}, prepare?: (h: SessionHarness) => Promise<void> | void) {
  const h = sessionHarness(options);
  h.linked();
  if (prepare) await prepare(h);
  const card = h.card(900);
  await h.press(`go|${CID}|p`, card);
  const row = () => h.fs.sessions.get(sid) ?? h.fs.open(USER)!;
  const sid = h.fs.open(USER)!.sid;
  /** The shown index of the key at a position (the bank's key through the stored order). */
  const key = (pos = row().position) => {
    const r = row();
    const item = h.fs.bank.get(r.items[pos])!;
    return r.shown[pos].o.findIndex((f) => item.correct.includes(f));
  };
  const wrong = (pos = row().position) => (key(pos) + 1) % row().shown[pos].o.length;
  const at = (act: string, pos = row().position) => h.press(`s|${sid}|${pos}|${act}`, card);
  return { h, card, sid, row, key, wrong, at };
}

/** The questions of the next plan block become `spec` (before «Начать», so their orders are computed from them). */
async function everyQuestion(h: SessionHarness, spec: Parameters<SessionHarness['fs']['put']>[1]) {
  const today = await h.fdb.db.today(TG);
  const exam = examOf(today!, CID)!;
  const first = exam.plan.sessions.find((s) => s.kind === 'answer')!;
  for (const id of first.ids) h.fs.put(id, spec);
}

/** Every message the bot sent or edited passes the linter (the bank's words are the student's own). */
function lintAll(h: SessionHarness) {
  const user = [...h.fs.bank.values()].flatMap((i) => [i.stem, ...i.options, ...(i.topicTitle ? [i.topicTitle] : []), ...i.answers]);
  user.push('Компьютерные сети', 'Базы данных', 'Операционные системы', 'Основы программирования', 'Осенняя сессия', '23', 'ТРИДЦАТЬ  ДВА');
  for (const call of [...h.tg.of('sendMessage'), ...h.tg.of('editMessageText')]) {
    const keyboard = (call.params.reply_markup?.inline_keyboard ?? []).map((r: Array<Record<string, string>>) => r.map((b) => ({ text: b.text, data: b.callback_data, url: b.url, style: b.style as 'primary' | undefined })));
    const options = keyboard.flat().map((b: { text: string }) => b.text.replace(/^✓ /, '')).filter((t: string) => user.includes(t));
    const problems = lintMessage({ text: call.params.text, keyboard, chat: 'private', user, options });
    assert.deepEqual(problems, [], `${call.method}: ${problems.join('; ')}\n${words(call.params.text)}`);
  }
}

test('«Начать»: the card is marked used first; the queue is buildSession seeded by the sid; every order is optionOrder at <sid>:<pos>', async () => {
  const h = sessionHarness();
  h.linked();
  const card = h.card(900);
  h.fdb.calls.length = 0;
  await h.press(`go|${CID}|p`, card);
  const fns = h.fdb.calls.map((c) => c.fn);
  assert.deepEqual(fns, ['bot_update_begin', 'bot_card_sent', 'bot_today', 'bot_session_items', 'bot_session_start', 'bot_update_done']);
  assert.deepEqual(h.fdb.of('bot_card_sent')[0].args, { tgUserId: TG, messageId: card, event: 'used' });
  const startArgs = h.fs.of('bot_session_start')[0].args as Record<string, any>;
  const sid = newSid(seeded(7));
  assert.equal(startArgs.p_sid, sid, 'the sid drawn by the function is the seed');
  assert.equal(startArgs.p_message_id, card);
  assert.equal(startArgs.p_kind, 'plan');
  assert.deepEqual(startArgs.p_figure, { in_plan: 960, two_days: 143 });
  const today = await h.fdb.db.today(TG);
  const exam = examOf(today!, CID)!;
  const first = exam.plan.sessions.find((s) => s.kind === 'answer')!;
  const queue = buildSession(exam.plan, first.subjectId, 'answer', [], sid);
  assert.deepEqual(startArgs.p_queue.map((e: { id: string }) => e.id), queue.map((e) => e.id));
  startArgs.p_queue.forEach((e: { id: string; shown: number[]; cls: string }, pos: number) => {
    assert.deepEqual(e.shown, shownOrder(h.fs.bank.get(e.id)!.options, false, sid, pos), `the order at ${pos}`);
    assert.ok(['relearn', 'confirm', 'new_floor', 'check', 'final'].includes(e.cls), e.cls);
  });
  // The card became the first question (one edit), the press answered first and silently.
  assert.deepEqual(h.tg.methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.equal(h.toasts()[0], '');
  assert.match(words(h.message(card)!.text), /^Компьютерные сети · 1 из 20\n\n/);
  assert.equal(h.tg.calls[1].params.message_id, card);
  // The same seed again gives the same session: the order does not depend on the device or the run.
  const again = sessionHarness();
  again.linked();
  await again.press(`go|${CID}|p`, again.card(900));
  assert.deepEqual(again.fs.of('bot_session_start')[0].args.p_queue, startArgs.p_queue);
  lintAll(h);
});

test('Z6: a right answer — «Верно.» and one edit straight to the next question; recorded at once as tg:<sid>:<pos>', async () => {
  const s = await started();
  s.h.tg.reset();
  await s.at(String(s.key()), 0);
  assert.deepEqual(s.h.tg.methods(), ['answerCallbackQuery', 'editMessageText']);
  assert.equal(s.h.toasts()[0], 'Верно.');
  assert.match(words(s.h.message(s.card)!.text), /^Компьютерные сети · 2 из 20/);
  assert.deepEqual(s.h.fs.answers.map((a) => [a.cid, a.step, a.source, a.correct]), [[`tg:${s.sid}:0`, 'start', 'bot', true]]);
  // On the step two_days the line names the figure in the plan's words.
  s.h.fs.steps.set(s.row().items[1], { step: 'two_days' });
  await s.at(String(s.key()), 1);
  assert.equal(s.h.toasts().at(-1), 'Верно. Теперь 144 из 960 — верно в два разных дня.');
  lintAll(s.h);
});

test('Z7 → «Дальше»: nothing is recorded before it; then the miss, and the question comes back 3–5 later with a new order', async () => {
  const s = await started();
  await s.at(String(s.wrong(0)), 0);
  assert.equal(s.h.fs.answers.length, 0, 'a wrong answer waits for «Дальше»');
  const review = words(s.h.message(s.card)!.text);
  assert.match(review, /В файле — Первый \d+\nВаш ответ — /);
  assert.match(review, /Неверно\. Вернётся через пару вопросов и завтра\./);
  assert.deepEqual(s.h.labels(s.card), [['Дальше'], ['Нажали не туда?'], ['Сомневаюсь в ключе']]);
  const id = s.row().items[0];
  s.h.fs.calls.length = 0;
  await s.at('n', 0);
  // One resolve without a queue (the database asks for one: a miss that comes back), one with afterAnswer's queue.
  const resolves = s.h.fs.of('bot_session_resolve');
  assert.equal(resolves.length, 2);
  assert.equal(resolves[0].args.p_queue, null);
  const queue = resolves[1].args.p_queue as Array<{ id: string; retry: number; shown?: number[] }>;
  const at = queue.findIndex((e, i) => i > 0 && e.id === id);
  assert.ok(at >= 3 && at <= 5, `back at ${at}`);
  assert.equal(queue[at].retry, 1);
  assert.deepEqual(queue[at].shown, shownOrder(s.h.fs.bank.get(id)!.options, false, s.sid, at), 'the repeat\'s own order (seed <sid>:<its pos>)');
  assert.deepEqual(s.h.fs.answers.map((a) => [a.cid, a.step]), [[`tg:${s.sid}:0`, 'miss']]);
  assert.match(words(s.h.message(s.card)!.text), /^Компьютерные сети · 2 из 20/);
  // At the repeat: «повтор — не в счёт»; wrong again → back once more; the third time «Вернётся завтра.» and no queue.
  for (let pos = 1; pos < at; pos += 1) await s.at(String(s.key(pos)), pos);
  assert.match(words(s.h.message(s.card)!.text), /· повтор — не в счёт\n/);
  await s.at(String(s.wrong(at)), at);
  assert.match(words(s.h.message(s.card)!.text), /Неверно\. Вернётся через пару вопросов и завтра\./);
  await s.at('n', at);
  const again = s.row().items.findIndex((x, i) => i > at && x === id);
  assert.equal(s.row().retry[again], 2);
  for (let pos = at + 1; pos < again; pos += 1) await s.at(String(s.key(pos)), pos);
  await s.at(String(s.wrong(again)), again);
  assert.match(words(s.h.message(s.card)!.text), /Неверно\. Вернётся завтра\./, 'the second repeat does not come back');
  s.h.fs.calls.length = 0;
  await s.at('n', again);
  assert.equal(s.h.fs.of('bot_session_resolve').length, 1, 'no queue needed after two repeats');
  assert.equal(s.row().items.filter((x) => x === id).length, 3, 'at most twice');
  lintAll(s.h);
});

test('«Нажали не туда?» (Z9): recorded with misclick, the question stays; «Дальше» goes on with the queue as it was', async () => {
  const s = await started();
  await s.at(String(s.wrong(0)), 0);
  const length = s.row().items.length;
  await s.at('m', 0);
  assert.deepEqual(s.h.fs.answers.map((a) => [a.cid, a.step, a.misclick]), [[`tg:${s.sid}:0`, 'misclick', true]]);
  const text = words(s.h.message(s.card)!.text);
  assert.match(text, /Отменили: ошибку не считаем\. Ответ вы уже видели — вопрос вернётся завтра\./);
  assert.ok(!text.includes('Ваш ответ'));
  assert.deepEqual(s.h.labels(s.card), [['Дальше']]);
  s.h.fs.calls.length = 0;
  await s.at('n', 0);
  assert.equal(s.h.fs.of('bot_session_resolve').length, 1, 'a misclick needs no queue');
  assert.equal(s.row().items.length, length, 'nothing comes back');
  assert.equal(s.row().position, 1);
  // «Не знаю» → «Нажали не туда?» is offered too (decision 16).
  await s.at('x', 1);
  assert.deepEqual(s.h.labels(s.card), [['Дальше'], ['Нажали не туда?'], ['Сомневаюсь в ключе']]);
  assert.ok(!words(s.h.message(s.card)!.text).includes('Неверно'));
  lintAll(s.h);
});

test('«Сомневаюсь в ключе» (Z11): the question under the review, nothing written; «Отмена» back; «Отметить» records and sets it aside', async () => {
  const s = await started();
  await s.at(String(s.wrong(0)), 0);
  const writes = () => s.h.fs.calls.filter((c) => c.fn !== 'bot_session_view').length;
  const before = writes();
  await s.at('d', 0);
  assert.equal(writes(), before, '«Сомневаюсь в ключе» only reads');
  assert.match(words(s.h.message(s.card)!.text), /Сомневаетесь в ключе к № \d+\? Автор экзамена увидит/);
  assert.deepEqual(s.h.labels(s.card), [['Отметить'], ['Отмена']]);
  await s.at('b', 0);
  assert.match(words(s.h.message(s.card)!.text), /Неверно\. Вернётся через пару вопросов и завтра\./);
  await s.at('d', 0);
  await s.at('D', 0);
  assert.deepEqual(s.h.fs.answers.map((a) => [a.cid, a.step]), [[`tg:${s.sid}:0`, 'miss']]);
  assert.equal(s.h.fs.doubts.length, 1);
  assert.match(words(s.h.message(s.card)!.text), /Отложено\. Когда автор ответит, вопрос вернётся в занятия\./);
  const id = s.row().items[0];
  await s.at('n', 0);
  assert.ok(!s.row().items.slice(1).includes(id), 'a doubted question does not come back in this session');
  assert.equal(s.row().counts.doubted, 1);
  lintAll(s.h);
});

test('«Закончить» (I2): a waiting answer is recorded as given; «Продолжить: n из 20» today, in the same message', async () => {
  const s = await started();
  await s.at(String(s.key(0)), 0);
  await s.at(String(s.wrong(1)), 1);
  s.h.advance(3 * MIN);
  await s.at('f', 1);
  assert.deepEqual(s.h.fs.answers.map((a) => [a.cid, a.step]), [[`tg:${s.sid}:0`, 'start'], [`tg:${s.sid}:1`, 'miss']]);
  const text = words(s.h.message(s.card)!.text);
  assert.match(text, /^Компьютерные сети: 2 вопроса за 3 минуты\nВерно 1 · неверно 1\nОшибки вернутся завтра\./);
  assert.deepEqual(s.h.labels(s.card), [['Продолжить: 3 из 20']]);
  assert.deepEqual(s.h.datas(s.card), [[`s|${s.sid}|2|c`]]);
  assert.equal((s.h.fdb.of('bot_card_sent').at(-1)!.args as { event: string }).event, 'last');
  // «Продолжить» in the same message: the question again, nothing deleted.
  s.h.tg.reset();
  await s.h.press(`s|${s.sid}|2|c`, s.card);
  assert.match(words(s.h.message(s.card)!.text), /^Компьютерные сети · 3 из 20/);
  assert.ok(!s.h.tg.methods().includes('deleteMessage'));
  lintAll(s.h);
});

test('«Закончить» before any answer: the session is abandoned and the card comes back', async () => {
  const s = await started();
  await s.at('f', 0);
  assert.equal(s.h.fs.sessions.get(s.sid)!.status, 'abandoned');
  assert.match(words(s.h.message(s.card)!.text), /^Сегодня около \d+ минут/);
  assert.match(s.h.labels(s.card)[0][0], /^Начать: 20 вопросов/);
});

test('the tick\'s flush (30 minutes): the waiting answer is recorded as given; «Нажали не туда?» is gone, «Дальше» still repeats it', async () => {
  const s = await started();
  await s.at(String(s.wrong(0)), 0);
  s.h.advance(31 * MIN);
  await s.h.tick();
  assert.deepEqual(s.h.fs.answers.map((a) => [a.cid, a.step]), [[`tg:${s.sid}:0`, 'miss']]);
  await s.at('m', 0);
  assert.deepEqual(s.h.labels(s.card), [['Дальше'], ['Сомневаюсь в ключе']], 'recorded: the review again, without «Нажали не туда?»');
  assert.equal(s.h.fs.answers.length, 1);
  await s.at('n', 0);
  assert.equal(s.row().retry.filter((r) => r === 1).length, 1, 'the miss comes back');
  assert.equal(s.row().position, 1);
});

test('double taps: the first press wins (a second option on the review is ignored; a second right tap changes nothing)', async () => {
  const s = await started();
  const wrong = s.wrong(0);
  await s.at(String(wrong), 0);
  const review = s.h.message(s.card)!.text;
  await s.at(String(s.key(0)), 0);
  assert.equal(s.h.message(s.card)!.text, review, 'repeat: the first answer stands');
  assert.equal(s.h.toasts().at(-1), '');
  await s.at('n', 0);
  await s.at('n', 0);
  assert.equal(s.row().position, 1, 'a second «Дальше» is an old position: nothing moves');
  const key = s.key(1);
  await s.at(String(key), 1);
  await s.at(String(key), 1);
  assert.equal(s.h.fs.answers.filter((a) => a.cid === `tg:${s.sid}:1`).length, 1);
  assert.equal(s.row().position, 2);
  assert.match(words(s.h.message(s.card)!.text), /^Компьютерные сети · 3 из 20/);
});

test('«Повторить» after a lost reply: the same data again finds the answer recorded (old + answer) and shows where the session is', async () => {
  const s = await started();
  await s.at(String(s.key(0)), 0);
  s.h.tg.reset();
  await s.at(String(s.key(0) === 0 ? 1 : 0), 0);
  assert.deepEqual(s.h.toasts(), ['Верно.'], 'the first attempt was recorded: «Верно.»');
  assert.match(words(s.h.message(s.card)!.text), /^Компьютерные сети · 2 из 20/);
  assert.equal(s.h.fs.answers.length, 1);
});

test('keep_order and «все перечисленные»: letters in the file\'s order; a shuffle keeps «Все перечисленные» last', async () => {
  const s = await started({}, (h) => everyQuestion(h, KEEP_ORDER));
  assert.ok(s.row().shown.every((cell) => cell.o.join() === '0,1,2,3'));
  assert.match(words(s.h.message(s.card)!.text), /А Канальный\nБ Сетевой\nВ Транспортный\nГ Все перечисленные/);
  assert.deepEqual(s.h.labels(s.card)[0], ['А', 'Б', 'В', 'Г']);
  const t = await started({}, (h) => everyQuestion(h, ALL_LISTED));
  assert.ok(t.row().shown.every((cell) => cell.o[3] === 2), '«Все перечисленные» (file index 2) is last everywhere');
  assert.ok(new Set(t.row().shown.map((cell) => cell.o.join())).size > 1, 'the rest is shuffled');
});

test('Z4: marks change only the keyboard (no answer written), «Ответить» with none marked is a line, all or nothing', async () => {
  const s = await started({}, (h) => everyQuestion(h, PRIVATE_IP));
  const o = s.row().shown[0].o;
  const shownOf = (file: number) => o.indexOf(file);
  const keyMask = [0, 1, 2].reduce((m, f) => m | (1 << shownOf(f)), 0);
  s.h.tg.reset();
  await s.at(`t${1 << shownOf(1)}`, 0);
  assert.deepEqual(s.h.tg.methods(), ['answerCallbackQuery', 'editMessageReplyMarkup']);
  assert.equal(s.h.fs.answers.length, 0);
  assert.ok(s.h.fs.calls.every((c) => c.fn === 'bot_session_items' || c.fn === 'bot_session_start' || c.fn === 'bot_session_view'), 'only reads');
  assert.ok(s.h.labels(s.card).flat().includes('✓ 172.20.1.1'));
  s.h.tg.reset();
  s.h.fdb.calls.length = 0;
  await s.at('a0', 0);
  assert.deepEqual(s.h.toasts(), ['Отметьте хотя бы один вариант.']);
  assert.deepEqual(s.h.fdb.calls.map((c) => c.fn), ['bot_update_begin', 'bot_update_done'], 'no session call');
  await s.at(`a${keyMask}`, 0);
  assert.equal(s.h.toasts().at(-1), 'Верно: все 3.');
  const partial = [0, 2].reduce((m, f) => m | (1 << s.row().shown[1].o.indexOf(f)), 0);
  await s.at(`a${partial}`, 1);
  const text = words(s.h.message(s.card)!.text);
  assert.match(text, /В файле верны: .+\nВаш ответ: /);
  assert.equal(s.h.fs.answers.length, 1);
  lintAll(s.h);
});

test('Z4 without a database call when the press carries its keyboard (remark)', async () => {
  const s = await started({}, (h) => everyQuestion(h, PRIVATE_IP));
  const markup = { inline_keyboard: s.h.message(s.card)!.markup.inline_keyboard };
  const ctx: Ctx = { tg: createTelegram({ token: TEST_TOKEN, fetch: s.h.tg.fetch }), db: s.h.fdb.db, site: W.SITE, botUsername: W.BOT_USERNAME, now: () => s.h.now, hourly: () => true };
  const tap = { id: 'q1', tgUserId: TG, chatId: TG, messageId: s.card, chatType: 'private', data: `s|${s.sid}|0|t2`, answered: false,
    async answer() { this.answered = true; }, markup } as Tap & { markup: unknown };
  s.h.fdb.calls.length = 0;
  s.h.tg.reset();
  await s.h.port.press(ctx, tap, { kind: 'session', sid: s.sid, pos: 0, act: { a: 'toggle', mask: 2 } });
  assert.equal(s.h.fdb.calls.length, 0, 'no database call');
  assert.deepEqual(s.h.tg.methods(), ['editMessageReplyMarkup']);
  const rows = s.h.tg.calls[0].params.reply_markup.inline_keyboard;
  assert.equal(rows[1][0].text.startsWith('✓ '), true);
  assert.equal(rows[1][0].callback_data, `s|${s.sid}|0|t0`);
  assert.equal(rows[4][0].callback_data, `s|${s.sid}|0|a2`);
  assert.equal(remark(null, s.sid, 0, 2), null);
});

test('Z5: a typed short answer — the message deleted, the result an edit with «Дальше»; the normalisation shown; S6 otherwise', async () => {
  const s = await started({}, (h) => everyQuestion(h, IPV4_BITS));
  const { messageId } = await s.h.type('ТРИДЦАТЬ  ДВА');
  assert.ok(s.h.tg.of('deleteMessage').some((c) => c.params.message_id === messageId));
  assert.match(words(s.h.message(s.card)!.text), /Верно: тридцать два\./);
  assert.deepEqual(s.h.labels(s.card), [['Дальше']]);
  assert.equal(s.h.fs.answers.length, 1);
  await s.at('n', 0);
  assert.match(words(s.h.message(s.card)!.text), /^Компьютерные сети · 2 из 20\n\nСколько бит в адресе IPv4\?\nНапишите ответ сообщением\./);
  await s.h.type('23');
  const wrong = words(s.h.message(s.card)!.text);
  assert.match(wrong, /В файле — 32\nВаш ответ — 23/);
  assert.deepEqual(s.h.labels(s.card), [['Дальше'], ['Сомневаюсь в ключе']], 'a typed answer is not a press: no «Нажали не туда?»');
  // A second message while the result waits is not an answer: S6 (once an hour).
  s.h.tg.reset();
  await s.h.type('32');
  assert.equal(words(s.h.tg.of('sendMessage')[0]?.params.text), W.BUTTONS_ONLY);
  assert.equal(s.h.fs.answers.length, 1);
  lintAll(s.h);
});

test('4096: a question over the limit is left to the site (skip), the next one comes, the record names it', async () => {
  const s = await started({}, async (h) => {
    const today = await h.fdb.db.today(TG);
    const exam = examOf(today!, CID)!;
    const sid = newSid(seeded(7));
    const queue = buildSession(exam.plan, exam.plan.sessions.find((x) => x.kind === 'answer')!.subjectId, 'answer', [], sid);
    h.fs.put(queue[1].id, tooLong());
  });
  await s.at(String(s.key(0)), 0);
  assert.deepEqual(s.h.fs.of('bot_session_resolve').map((c) => c.args.p_action), ['skip']);
  assert.equal(s.row().position, 2);
  assert.match(words(s.h.message(s.card)!.text), /^Компьютерные сети · 3 из 20/);
  await s.at('f', 2);
  assert.match(words(s.h.message(s.card)!.text), /1 вопрос — только на сайте: он не помещается в сообщение Telegram\./);
  lintAll(s.h);
});

test('«message to edit not found»: the same screen as a new message, and the session follows it (bot_session_move)', async () => {
  const s = await started();
  s.h.tg.fail('editMessageText', { kind: '400', description: EDIT_NOT_FOUND });
  s.h.fs.calls.length = 0;
  await s.at(String(s.key(0)), 0);
  const sent = s.h.tg.of('sendMessage');
  assert.equal(sent.length, 1);
  assert.match(words(sent[0].params.text), /^Компьютерные сети · 2 из 20/);
  const moved = s.h.fs.of('bot_session_move');
  assert.equal(moved.length, 1);
  const newId = s.row().messageId!;
  assert.notEqual(newId, s.card);
  assert.equal(moved[0].args.p_message_id, newId);
  assert.equal(sent[0].params.protect_content, true);
});

test('I1: the last answer turns the message into the record; «Готово» takes the keyboard off without a database call', async () => {
  const s = await started();
  for (let pos = 0; pos < 20; pos += 1) {
    s.h.advance(20_000);
    await s.at(String(s.key(pos)), pos);
  }
  const text = words(s.h.message(s.card)!.text);
  assert.match(text, /^Компьютерные сети: 20 вопросов за 7 минут\nВерно 20\n/);
  assert.equal(s.h.fs.sessions.get(s.sid)!.status, 'finished');
  const labels = s.h.labels(s.card);
  assert.equal(labels.at(-1)![0], 'Готово');
  assert.match(labels[0][0], /^(Ещё \d+ вопрос|Дальше: )/);
  assert.equal((s.h.fdb.of('bot_card_sent').at(-1)!.args as { event: string }).event, 'last');
  s.h.fdb.calls.length = 0;
  s.h.tg.reset();
  await s.h.press(`s|${s.sid}|20|g`, s.card);
  assert.deepEqual(s.h.fdb.calls.map((c) => c.fn), ['bot_update_begin', 'bot_update_done']);
  assert.deepEqual(s.h.tg.methods(), ['answerCallbackQuery', 'editMessageReplyMarkup']);
  assert.deepEqual(s.h.tg.calls[1].params.reply_markup, { inline_keyboard: [] });
  lintAll(s.h);
});

test('«Ещё 20 вопросов» on a record: a new message (the session moves there), the record loses its keyboard and stays', async () => {
  const s = await started();
  for (let pos = 0; pos < 20; pos += 1) await s.at(String(s.key(pos)), pos);
  const record = s.h.message(s.card)!.text;
  const next = s.h.datas(s.card)[0][0];
  assert.match(next, /^go\|/);
  s.h.tg.reset();
  s.h.fs.calls.length = 0;
  await s.h.press(next, s.card);
  assert.equal(s.h.message(s.card)!.text, record, 'the record stays as it was');
  assert.deepEqual(s.h.tg.of('editMessageReplyMarkup').map((c) => [c.params.message_id, c.params.reply_markup]), [[s.card, { inline_keyboard: [] }]]);
  const sent = s.h.tg.of('sendMessage');
  assert.equal(sent.length, 1);
  assert.match(words(sent[0].params.text), /· 1 из \d+\n/);
  const open = s.h.fs.open(USER)!;
  assert.notEqual(open.sid, s.sid);
  assert.equal(s.h.fs.of('bot_session_start')[0].args.p_message_id, null);
  assert.equal(open.messageId, s.h.tg.calls.find((c) => c.method === 'sendMessage') && sent[0] ? open.messageId : -1);
  assert.deepEqual(s.h.fs.of('bot_session_move').map((c) => c.args.p_message_id), [open.messageId]);
  // The same button again (a double tap): nothing new starts, the session just begun stays.
  await s.h.press(next, s.card);
  assert.equal(s.h.fs.of('bot_session_start').length, 1);
  assert.equal(s.h.fs.open(USER)!.sid, open.sid);
});

test('I3: /today shows «Продолжить: n из 20»; the press moves the session under it and deletes the old message', async () => {
  const s = await started();
  await s.at(String(s.key(0)), 0);
  await s.at(String(s.key(1)), 1);
  s.h.tg.reset();
  await s.h.post({ update_id: 777001, message: { message_id: 950, date: Math.floor(s.h.now / 1000), chat: { id: TG, type: 'private' }, from: { id: TG, is_bot: false }, text: '/today' } });
  const cardMessage = s.h.tg.of('sendMessage')[0];
  const keyboard = cardMessage.params.reply_markup.inline_keyboard;
  const resume = keyboard.flat().find((b: { text: string }) => b.text.startsWith('Продолжить'));
  assert.equal(resume.text, 'Продолжить: 3 из 20');
  const todayCard = s.h.tg.messages ? [...s.h.tg.messages.values()].find((m) => m.text === cardMessage.params.text)!.messageId : 0;
  s.h.fdb.calls.length = 0;
  s.h.tg.reset();
  await s.h.press(resume.callback_data, todayCard);
  assert.deepEqual(s.h.fdb.calls.filter((c) => c.fn === 'bot_card_sent').map((c) => c.args), [{ tgUserId: TG, messageId: todayCard, event: 'used' }]);
  assert.equal(s.h.fdb.calls[1].fn, 'bot_card_sent', 'marked used first');
  assert.match(words(s.h.message(todayCard)!.text), /^Компьютерные сети · 3 из 20/);
  assert.deepEqual(s.h.tg.of('deleteMessage').map((c) => c.params.message_id), [s.card]);
  assert.equal(s.row().messageId, todayCard);
  // The old message cannot be deleted: it says where the session went.
  await s.at(String(s.key(2)), 2);
  await s.h.post({ update_id: 777002, message: { message_id: 951, date: Math.floor(s.h.now / 1000), chat: { id: TG, type: 'private' }, from: { id: TG, is_bot: false }, text: '/today' } });
  const second = s.h.tg.of('sendMessage').at(-1)!;
  const secondId = [...s.h.tg.messages.values()].find((m) => m.text === second.params.text)!.messageId;
  const resume2 = second.params.reply_markup.inline_keyboard.flat().find((b: { text: string }) => b.text.startsWith('Продолжить'));
  s.h.tg.fail('deleteMessage', { kind: '400', description: DELETE_NOT_FOUND }, { kind: '400', description: DELETE_NOT_FOUND });
  await s.h.press(resume2.callback_data, secondId);
  assert.equal(words(s.h.message(todayCard)!.text), 'Занятие продолжено ниже.');
  assert.equal(s.h.message(todayCard)!.markup, null);
  lintAll(s.h);
});

test('«Продолжить» after midnight: «Это занятие уже закончено.» and the keyboard comes off', async () => {
  const s = await started();
  await s.at(String(s.key(0)), 0);
  await s.at('f', 1);
  s.h.set(Date.UTC(2026, 9, 17, 9, 0, 0));
  s.h.tg.reset();
  await s.h.press(`s|${s.sid}|1|c`, s.card);
  assert.deepEqual(s.h.toasts(), [W.SESSION_OVER]);
  assert.deepEqual(s.h.tg.of('editMessageReplyMarkup').map((c) => c.params.reply_markup), [{ inline_keyboard: [] }]);
  assert.equal(s.h.fs.sessions.get(s.sid)!.status, 'abandoned');
});

test('one open session: «Начать» on a new card closes the one in another message, which keeps its record without keys or buttons', async () => {
  const s = await started();
  await s.at(String(s.wrong(0)), 0);
  const second = s.h.card(901);
  await s.h.press(`go|${CID}|p`, second);
  const old = s.h.fs.sessions.get(s.sid)!;
  assert.equal(old.status, 'abandoned');
  assert.deepEqual(s.h.fs.answers.map((a) => [a.cid, a.step]), [[`tg:${s.sid}:0`, 'miss']], 'its waiting answer recorded as given');
  const text = words(s.h.message(s.card)!.text);
  assert.match(text, /^Компьютерные сети: 1 вопрос за 1 минуту\nНеверно 1/);
  assert.ok(!/В файле/.test(text), 'no key stays in the chat');
  assert.equal(s.h.message(s.card)!.markup, null);
  assert.match(words(s.h.message(second)!.text), /· 1 из 20/);
  lintAll(s.h);
});

test('§4.8: stale (the key changed meanwhile) and gone — a line and the next question; nothing recorded', async () => {
  const s = await started();
  s.h.fs.bumpRev(s.row().items[0]);
  await s.at(String(s.key(0)), 0);
  assert.equal(s.h.toasts().at(-1), W.KEY_STALE);
  assert.match(words(s.h.message(s.card)!.text), /^Компьютерные сети · 2 из 20/);
  s.h.fs.remove(s.row().items[1]);
  await s.at('0', 1);
  assert.equal(s.h.toasts().at(-1), W.ITEM_GONE);
  assert.equal(s.h.fs.answers.length, 0);
  assert.equal(s.row().position, 2);
});

test('§4.8: another session\'s button, an older message, a finished session, the exam gone, Telegram unlinked', async () => {
  const s = await started();
  await s.h.press('s|zzzzzzzz|0|0', s.card);
  assert.equal(s.h.toasts().at(-1), W.OLD_BUTTON);
  await s.h.press(`s|${s.sid}|5|0`, 333);
  assert.equal(s.h.toasts().at(-1), W.OLD_BUTTON, 'an old position from another message');
  s.h.fs.role(USER, CID, null);
  await s.at(String(s.key(0)), 0);
  assert.equal(words(s.h.message(s.card)!.text), 'Экзамен «Осенняя сессия» больше недоступен — занятие закрыто.');
  await s.h.press(`s|${s.sid}|0|0`, s.card);
  assert.equal(s.h.toasts().at(-1), W.SESSION_OVER);
  s.h.fdb.link(TG)!.unlinkedAt = s.h.now;
  await s.h.press(`s|${s.sid}|0|0`, s.card);
  assert.equal(s.h.toasts().at(-1), W.NOT_LINKED);
});

test('§4.8: the database fails — the line the first time; the next time the edit with «Повторить» (the same data), which then records once', async () => {
  const s = await started();
  const key = s.key(0);
  const data = `s|${s.sid}|0|${key}`;
  s.h.fdb.fail('bot_session_answer', new DbError('bot_session_answer', 503, ''), new DbError('bot_session_answer', 503, ''));
  await s.h.press(data, s.card);
  assert.equal(s.h.toasts().at(-1), W.DB_DOWN_TAP);
  await s.h.press(data, s.card);
  assert.equal(words(s.h.message(s.card)!.text), `Компьютерные сети · 1 из 20\n${W.DB_DOWN_AGAIN}`);
  assert.deepEqual(s.h.datas(s.card), [[data]]);
  assert.deepEqual(s.h.labels(s.card), [[W.RETRY]]);
  await s.h.press(data, s.card);
  assert.equal(s.h.toasts().at(-1), 'Верно.');
  assert.deepEqual(s.h.fs.answers.map((a) => a.cid), [`tg:${s.sid}:0`]);
  assert.match(words(s.h.message(s.card)!.text), /^Компьютерные сети · 2 из 20/);
  assert.ok(LOGS.every((line) => !line.includes(TEST_TOKEN.split(':')[1])));
});

test('nothing to start (the day is done): the card as it stands', async () => {
  const h = sessionHarness();
  h.linked([{ id: CID, title: 'Осенняя сессия', date: '2026-11-03', perSubject: 10, answeredToday: 40, today: { firstAt: Math.floor((NOW - 3 * 3_600_000) / 1000), doneSec: 2700 } }]);
  const card = h.card(900);
  await h.press(`go|${CID}|p`, card);
  assert.equal(h.fs.of('bot_session_start').length, 0);
  assert.match(words(h.message(card)!.text), /^На сегодня всё/);
});

test('«Только ошибки» (go|<cid>|e) and «Ещё 20 новых» (go|<cid>|x) start their own kind of session', async () => {
  const h = sessionHarness();
  h.linked();
  await h.press(`go|${CID}|e`, h.card(900));
  const errors = h.fs.open(USER)!;
  assert.equal(errors.kind, 'errors');
  assert.ok(errors.cls.every((c) => c === 'free'));
  const done = sessionHarness();
  done.linked([{ id: CID, title: 'Осенняя сессия', date: '2026-11-03', perSubject: 60, answeredToday: 20, today: { firstAt: Math.floor((NOW - 3 * 3_600_000) / 1000), doneSec: 2700 } }]);
  await done.press(`go|${CID}|x`, done.card(900));
  const extra = done.fs.open(USER)!;
  assert.equal(extra.kind, 'extra');
  assert.equal(extra.items.length, 20);
  assert.ok(extra.cls.every((c) => c === 'new_fill'));
});

test('a question that reaches the rule: «Верно. Теперь 144 из 960 — …» and the record «В счёт вошёл 1 вопрос: теперь 144 из 960.»', async () => {
  const s = await started();
  s.h.fs.steps.set(s.row().items[0], { step: 'two_days' });
  await s.at(String(s.key(0)), 0);
  await s.at('f', 1);
  assert.match(words(s.h.message(s.card)!.text), /В счёт вошёл 1 вопрос: теперь 144 из 960\./);
});

test('Z12: the author sees «Ключ неверный?» — a link to «Ключи» on this question — instead of «Сомневаюсь в ключе»', async () => {
  const s = await started({}, (h) => h.fs.role(USER, CID, 'owner'));
  await s.at(String(s.wrong(0)), 0);
  const last = s.h.message(s.card)!.markup.inline_keyboard.at(-1)[0];
  assert.equal(last.text, 'Ключ неверный?');
  const item = s.h.fs.bank.get(s.row().items[0])!;
  assert.equal(last.url, `${W.SITE}/exams/c/${CID}/keys?s=${item.subjectId}&no=${item.fileNo}`);
});

test('the shapes of CONTRACT_T5 read as the function needs them (statuses, the review, the figure)', () => {
  const r = toReply({
    status: 'ok', answer: { status: 'saved', correct: true, dont_know: false, step: 'two_days', figure: { in_plan: 960, two_days: 143, now: 144 } },
    session: {
      sid: '7k2pm9qa', kind: 'plan', status: 'open', container_id: CID, subject_id: 's', exam_title: 'Осенняя сессия', subject_title: 'Базы данных',
      role: 'member', local_day: DAY, position: 3, length: 20, queue: [{ id: 'a', retry: 0 }, { id: 'b', retry: 1 }], answered: true, chat_id: TG,
      message_id: 900, counts: { questions: 3, right: 2, wrong: 1, dont_know: 0, misclick: 0, retries: 0, skipped: 0, gone: 0, stale: 0, doubted: 0 },
      figure: { in_plan: 960, two_days: 143, now: 144, gained: 1, dropped: 0, started: 2, too_early: 1, too_early_states: [{ streak_at: '2026-10-15T20:00:00Z', streak_day: '2026-10-15', peek_day: null }] },
      created_at: '2026-10-16T16:50:00Z', now: '2026-10-16T17:00:00Z',
    },
    view: {
      pos: 3, item_id: 'i', rev: 2, kind: 'single', code: false, keep_order: false, stem: 'Вопрос?', options: ['Б', 'А'], order: [1, 0], file_no: '', number: 7,
      topic: 1, topic_title: 'Тема 1', retry: 1,
      review: { correct: false, dont_know: false, choice: [0], text: null, key: [1], answers: [], recorded: false, misclick: false, doubt: false, status: null, step: null, key_source: 'manual', key_changed_at: '2026-10-16T08:00:00Z' },
    },
  });
  assert.equal(r.status, 'ok');
  assert.equal(r.answer!.figure!.now, 144);
  assert.equal(r.session!.counts.gained, 1);
  assert.equal(r.session!.counts.tooEarly, 1);
  assert.equal(r.session!.figure.tooEarlyStates[0].streakDay, '2026-10-15');
  assert.equal(r.session!.createdAt, Date.parse('2026-10-16T16:50:00Z'));
  assert.equal(r.view!.item.keySource, 'manual');
  assert.equal(r.view!.item.keyChangedAt, '2026-10-16T08:00:00Z');
  assert.deepEqual(r.view!.order, [1, 0]);
  assert.equal(r.view!.retry, 1);
  assert.equal(toReply({ status: 'weird' }).status, 'invalid');
  assert.equal(toReply({ status: 'unavailable', exam_title: 'Осенняя сессия' }).examTitle, 'Осенняя сессия');
  assert.equal(newSid(() => 0.9999999).length, 8);
  assert.match(newSid(), /^[0-9a-z]{8}$/);
  assert.notEqual(createSession(), createSession());
});
