// The tick (spec §6.6, §8.1 «Напоминания»): the rules of the day card, at most once (two ticks at once, a crash after
// sending), 429 → bot_delivery_retry and the step stops, 403 blocks, at most 25 sends a second, the night's close, K3,
// the flush, the beat.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pacer, runTick } from './tick.ts';
import { DbError } from './db.ts';
import { setLogSink } from './log.ts';
import { visibleText } from './html.ts';
import { harness, type Harness } from './fixtures/harness.ts';
import { AUTUMN, CID, NOW, wireOf } from './fixtures/scenario.ts';
import * as W from './words.ts';

const AT_2001 = NOW + 60_000; // 20:01 in Minsk
const words = (text: string) => visibleText(text).replace(/ /g, ' ');

let nextStudent = 0;

/** n students linked with the same exam, due at 20:00 (none seen in the last 30 minutes). */
function students(h: Harness, n: number, spec = AUTUMN) {
  const rows = [];
  for (let k = 0; k < n; k += 1) {
    const i = nextStudent++;
    const userId = `c1c2c3d4-0000-4000-8000-${String(100 + i).padStart(12, '0')}`;
    const row = h.fdb.addLink({ userId, tgUserId: 800000 + i });
    h.fdb.setUser(userId, { wire: wireOf([spec], NOW) });
    rows.push(row);
  }
  return rows;
}

async function tickNow(h: Harness) {
  const res = await h.tick();
  assert.equal(res.status, 202);
  const all = await Promise.all(h.waits.splice(0));
  return all.at(-1) as Record<string, number>;
}

test('K1 at the chosen time: with sound, protect_content, the card of the copied plan; recorded as today\'s card', async () => {
  const h = harness({ now: AT_2001 });
  const [row] = students(h, 1);
  const stats = await tickNow(h);
  const sends = h.tg.of('sendMessage');
  assert.equal(sends.length, 1);
  const p = sends[0].params;
  assert.equal(p.chat_id, row.chatId);
  assert.equal(p.disable_notification, false, 'the day card is the one sound');
  assert.equal(p.protect_content, true);
  assert.match(words(p.text), /^Сегодня около \d+ минут: .+\nОсенняя сессия · 3 ноября, через 18 дней\n143 из 960 — верно в два разных дня$/);
  assert.equal(p.reply_markup.inline_keyboard[0][0].callback_data, `go|${CID}|p`);
  assert.equal(h.fdb.deliveries[0].status, 'sent');
  assert.equal(h.fdb.days.get(`${row.id}|2026-10-16`)!.cardMessageId, 1000);
  assert.equal(stats.rem_sent, 1);
  assert.equal(h.fdb.beats.length, 1);
  assert.equal(h.fdb.beats[0].rem_sent, 1);
  // a minute later: nothing more today
  h.advance(60_000);
  await tickNow(h);
  assert.equal(h.tg.of('sendMessage').length, 1);
});

test('no card when the plan is done, has nothing, it is a day off or the exam day: the row is closed as skipped with that word', async () => {
  for (const [name, spec, now, word] of [
    ['done', { id: CID, title: 'Осенняя сессия', date: '2026-11-03', perSubject: 10, answeredToday: 20, today: { firstAt: Math.floor((NOW - 3_600_000) / 1000), doneSec: 2700 } }, AT_2001, 'done'],
    ['exam day', AUTUMN, Date.UTC(2026, 10, 3, 17, 1), 'exam_today'],
    // Пн–Чт (study_weekdays 15): Friday is a day off — the reminder waits for a study day
    ['day off', { ...AUTUMN, weekdays: 15 }, AT_2001, 'day_off'],
  ] as const) {
    const h = harness({ now });
    const userId = 'c1c2c3d4-0000-4000-8000-000000000555';
    h.fdb.addLink({ userId, tgUserId: 800555 });
    h.fdb.setUser(userId, { wire: wireOf([spec], now) });
    const stats = await tickNow(h);
    assert.equal(h.tg.of('sendMessage').length, 0, name);
    assert.equal(h.fdb.deliveries[0].status, 'skipped');
    assert.equal(h.fdb.deliveries[0].error, word);
    assert.equal(stats[`rem_skip_${word}`], 1);
  }
});

test('the window: not before the chosen time, not 3 h late, not at 23:00; paused or off → no claim', async () => {
  const h = harness({ now: NOW - 60_000 }); // 19:59
  students(h, 1);
  await tickNow(h);
  assert.equal(h.fdb.deliveries.length, 0);
  h.set(NOW + 3 * 3_600_000 + 60_000); // 23:01
  await tickNow(h);
  assert.equal(h.fdb.deliveries.length, 0);
  const p = harness({ now: AT_2001 });
  const [paused] = students(p, 1);
  paused.pausedUntil = '2026-10-17';
  const [off] = students(p, 1);
  off.remindOn = false;
  await tickNow(p);
  assert.equal(p.fdb.deliveries.length, 0);
});

test('two ticks at once (Promise.all) → one card', async () => {
  const h = harness({ now: AT_2001 });
  students(h, 3);
  await Promise.all([h.tick(), h.tick()]);
  await Promise.all(h.waits.splice(0));
  assert.equal(h.tg.of('sendMessage').length, 3);
  assert.equal(new Set(h.tg.of('sendMessage').map((c) => c.params.chat_id)).size, 3);
});

test('a crash after the send (timeout) leaves the row in sending → unknown; it is never sent again', async () => {
  const h = harness({ now: AT_2001 });
  students(h, 1);
  h.tg.fail('sendMessage', { kind: 'timeout' });
  const stats = await tickNow(h);
  assert.equal(stats.rem_unknown, 1);
  assert.equal(h.fdb.deliveries[0].status, 'sending');
  h.advance(11 * 60_000);
  await tickNow(h);
  assert.equal(h.fdb.deliveries[0].status, 'unknown');
  assert.equal(h.tg.of('sendMessage').length, 1, 'one attempt only');
});

test('a row claimed but never tried (the function died first) is taken again after 10 minutes', async () => {
  const h = harness({ now: AT_2001 });
  students(h, 1);
  await h.fdb.db.claimReminders(50); // a tick that died right after its claim
  h.advance(5 * 60_000);
  await tickNow(h);
  assert.equal(h.tg.of('sendMessage').length, 0);
  h.advance(6 * 60_000);
  await tickNow(h);
  assert.equal(h.tg.of('sendMessage').length, 1);
  assert.equal(h.fdb.deliveries[0].attempts, 2);
});

test('429 stops the step (the row goes back, the rest stay claimed for a later tick); 403 marks the chat blocked', async () => {
  const h = harness({ now: AT_2001 });
  const rows = students(h, 3);
  h.tg.fail('sendMessage', { kind: '403' });
  const first = await tickNow(h);
  assert.equal(first.rem_blocked, 1);
  assert.ok(rows[0].blockedAt !== null);
  assert.equal(h.fdb.deliveries[0].status, 'failed');
  assert.equal(first.rem_sent, 2);

  const r = harness({ now: AT_2001 });
  students(r, 3);
  r.tg.fail('sendMessage', { kind: '429', retryAfter: 5 });
  const stats = await tickNow(r);
  assert.equal(stats.rem_rate_limited, 1);
  assert.equal(r.tg.of('sendMessage').length, 1, 'the step stopped at the 429');
  assert.deepEqual(r.fdb.deliveries.map((d) => d.status), ['claimed', 'claimed', 'claimed']);
  r.advance(11 * 60_000);
  await tickNow(r);
  assert.deepEqual(r.fdb.deliveries.map((d) => d.status), ['sent', 'sent', 'sent']);
});

test('429 on the card: bot_delivery_retry, never failed — true puts it back and a later tick sends it; false (no try left) is the end', async () => {
  const h = harness({ now: AT_2001 });
  students(h, 1);
  const tryOnce = async () => {
    h.tg.fail('sendMessage', { kind: '429', retryAfter: 5 });
    return tickNow(h);
  };
  const first = await tryOnce();
  assert.deepEqual([first.rem_rate_limited, first.rem_requeued, first.rem_not_requeued], [1, 1, undefined]);
  const d = h.fdb.deliveries[0];
  assert.deepEqual([d.status, d.error, d.attempts], ['claimed', '429', 1]);
  assert.deepEqual(h.fdb.of('bot_delivery_retry').map((c) => c.args), [{ deliveryId: d.id, error: '429' }]);
  assert.equal(h.fdb.of('bot_delivery_done').length, 0, 'not closed as failed: the database decides');
  h.advance(5 * 60_000);
  await tickNow(h);
  assert.equal(h.tg.of('sendMessage').length, 1, 'not again within 10 minutes');

  h.advance(6 * 60_000);
  assert.equal((await tryOnce()).rem_requeued, 1, 'the second try: back again');
  assert.deepEqual([d.status, d.attempts], ['claimed', 2]);
  h.advance(11 * 60_000);
  const third = await tryOnce();
  assert.deepEqual([third.rem_rate_limited, third.rem_requeued, third.rem_not_requeued], [1, undefined, 1]);
  assert.deepEqual([d.status, d.error, d.attempts], ['failed', '429', 3], 'false: closed by the database, nothing else to call');
  assert.equal(h.fdb.of('bot_delivery_done').length, 0);
  h.advance(11 * 60_000);
  await tickNow(h);
  assert.equal(h.tg.of('sendMessage').length, 3, 'never a fourth try');
});

test('a 429 on the card that is sent later: one card, the same delivery, with sound', async () => {
  const h = harness({ now: AT_2001 });
  const [row] = students(h, 1);
  h.tg.fail('sendMessage', { kind: '429', retryAfter: 5 });
  await tickNow(h);
  h.advance(11 * 60_000);
  const later = await tickNow(h);
  assert.equal(later.rem_sent, 1);
  assert.equal(h.fdb.deliveries.length, 1);
  assert.deepEqual([h.fdb.deliveries[0].status, h.fdb.deliveries[0].attempts], ['sent', 2]);
  const sent = h.tg.of('sendMessage').at(-1)!.params;
  assert.deepEqual([sent.chat_id, sent.disable_notification], [row.chatId, false]);
});

test('at most 25 sends a second', async () => {
  const h = harness({ now: AT_2001 });
  students(h, 30);
  await tickNow(h);
  const times = h.tg.of('sendMessage').map((c) => c.at);
  assert.equal(times.length, 30);
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i] - times[i - 1] >= 40, `${times[i] - times[i - 1]} ms`);
  for (let i = 25; i < times.length; i += 1) assert.ok(times[i] - times[i - 25] >= 1000, 'no 26 sends within a second');
  const waits: number[] = [];
  let clock = 0;
  const pace = pacer(() => clock, async (ms) => { waits.push(ms); clock += ms; });
  await pace();
  await pace();
  clock += 100;
  await pace();
  assert.deepEqual(waits, [40]);
});

test('K2 instead of the fourth ignored card (silent, one blue); then silence until the student comes back', async () => {
  const h = harness({ now: AT_2001 });
  const [row] = students(h, 1);
  for (const day of ['2026-10-13', '2026-10-14', '2026-10-15']) {
    h.fdb.deliveries.push({ id: 900 + Number(day.slice(-2)), kind: 'reminder', chatId: row.chatId, linkId: row.id, localDay: day, ref: null,
      status: 'sent', attempts: 1, claimedAt: Date.parse(`${day}T17:00:00Z`), sentAt: Date.parse(`${day}T17:00:00Z`), messageId: 1, error: null });
  }
  const stats = await tickNow(h);
  assert.equal(stats.rem_asked, 1);
  const p = h.tg.of('sendMessage')[0].params;
  assert.equal(p.disable_notification, true);
  assert.equal(words(p.text).split('\n')[0], W.K2_TITLE);
  assert.deepEqual(p.reply_markup.inline_keyboard.flat().map((b: { callback_data: string }) => b.callback_data), ['ask|y', 'ask|p', 'ask|n']);
  assert.ok(row.askedAt !== null);
  h.advance(24 * 3_600_000);
  const next = await tickNow(h);
  assert.equal(next.rem_skip_silent, 1);
  assert.equal(h.tg.of('sendMessage').length, 1);
});

test('the night\'s close: the unused card goes, the last summary loses its keyboard, once', async () => {
  const h = harness({ now: Date.UTC(2026, 9, 17, 5, 0) }); // 8:00 on the 17th
  const [row] = students(h, 1);
  row.remindAt = 21 * 60; // no reminder in this test
  h.fdb.addDay(row.id, '2026-10-16', { cardMessageId: 501, lastMessageId: 502 });
  const used = students(h, 1)[0];
  used.remindAt = 21 * 60;
  h.fdb.addDay(used.id, '2026-10-16', { cardMessageId: 601, cardUsed: true, lastMessageId: 602 });
  const stats = await tickNow(h);
  assert.deepEqual(h.tg.of('deleteMessage').map((c) => c.params.message_id), [501]);
  assert.deepEqual(h.tg.of('editMessageReplyMarkup').map((c) => [c.params.message_id, c.params.reply_markup]), [[502, { inline_keyboard: [] }], [602, { inline_keyboard: [] }]]);
  assert.equal(stats.night_closed, 2);
  await tickNow(h);
  assert.equal(h.tg.of('deleteMessage').length, 1, 'once');
});

test('the night\'s close after a 429: bot_delivery_retry, the step stops; a later tick finishes it (deleting again is harmless)', async () => {
  const h = harness({ now: Date.UTC(2026, 9, 17, 5, 0) }); // 8:00 on the 17th
  const rows = students(h, 2);
  rows.forEach((row, i) => {
    row.remindAt = 21 * 60; // no reminder in this test
    h.fdb.addDay(row.id, '2026-10-16', { cardMessageId: 501 + 100 * i, lastMessageId: 502 + 100 * i });
  });
  h.tg.fail('deleteMessage', { kind: '429', retryAfter: 3 });
  const first = await tickNow(h);
  assert.deepEqual([first.night_rate_limited, first.night_requeued, first.night_failed], [1, 1, undefined]);
  assert.equal(h.tg.of('editMessageReplyMarkup').length, 0, 'the step stopped at the 429');
  const closes = h.fdb.deliveries.filter((d) => d.kind === 'day_close');
  assert.deepEqual(closes.map((d) => [d.status, d.error]), [['claimed', '429'], ['claimed', null]]);
  assert.equal(h.fdb.of('bot_delivery_done').length, 0);

  h.advance(11 * 60_000);
  const second = await tickNow(h);
  assert.equal(second.night_closed, 2);
  assert.deepEqual(closes.map((d) => d.status), ['sent', 'sent']);
  assert.deepEqual(h.tg.of('deleteMessage').map((c) => c.params.message_id), [501, 501, 601]);
  assert.deepEqual(h.tg.of('editMessageReplyMarkup').map((c) => c.params.message_id), [502, 602]);
});

test('the night\'s close on its last try: a 429 on the keyboard → bot_delivery_retry false, closed by the database', async () => {
  const at = Date.UTC(2026, 9, 17, 5, 0);
  const h = harness({ now: at });
  const [row] = students(h, 1);
  row.remindAt = 21 * 60;
  h.fdb.addDay(row.id, '2026-10-16', { cardMessageId: 501, lastMessageId: 502 });
  h.fdb.deliveries.push({ id: 950, kind: 'day_close', chatId: row.chatId, linkId: row.id, localDay: '2026-10-16', ref: null,
    status: 'claimed', attempts: 2, claimedAt: at - 11 * 60_000, sentAt: null, messageId: null, error: '429' });
  h.tg.fail('editMessageReplyMarkup', { kind: '429', retryAfter: 3 });
  const stats = await tickNow(h);
  assert.deepEqual([stats.night_deleted, stats.night_rate_limited, stats.night_not_requeued], [1, 1, 1]);
  const close = h.fdb.deliveries.find((d) => d.id === 950)!;
  assert.deepEqual([close.status, close.error, close.attempts], ['failed', '429', 3]);
  assert.deepEqual(h.fdb.of('bot_delivery_retry').map((c) => c.args), [{ deliveryId: 950, error: '429' }]);
  assert.equal(h.fdb.of('bot_delivery_done').length, 0);
});

test('K3 after a 429: back in the queue, sent by a later tick, once', async () => {
  const h = harness({ now: Date.UTC(2026, 10, 4, 17, 1) });
  const [row] = students(h, 1);
  h.fdb.addAfterDate(row.id, CID, { title: 'Осенняя сессия', examDate: '2026-11-03', lastDate: '2026-11-03', firstPlanDay: '2026-10-09', activeDays: 21, answers: 6480, twoDays: 902, keyed: 960 });
  h.tg.fail('sendMessage', { kind: '429', retryAfter: 5 });
  const first = await tickNow(h);
  assert.deepEqual([first.k3_rate_limited, first.k3_requeued], [1, 1]);
  const k3 = h.fdb.deliveries.find((d) => d.kind === 'after_date')!;
  assert.deepEqual([k3.status, k3.error], ['claimed', '429']);
  h.advance(11 * 60_000);
  const second = await tickNow(h);
  assert.equal(second.k3_sent, 1);
  assert.deepEqual([k3.status, k3.attempts], ['sent', 2]);
  const sends = h.tg.of('sendMessage').filter((c) => words(c.params.text).startsWith('Экзамен прошёл'));
  assert.equal(sends.length, 2, 'the refused one and the one that went out');
  assert.equal(sends[1].params.disable_notification, true);
  h.advance(11 * 60_000);
  await tickNow(h);
  assert.equal(h.tg.of('sendMessage').filter((c) => words(c.params.text).startsWith('Экзамен прошёл')).length, 2);
});

test('K3 after the date: silent, the last word about that exam, once', async () => {
  const h = harness({ now: Date.UTC(2026, 10, 4, 17, 1) });
  const [row] = students(h, 1);
  h.fdb.addAfterDate(row.id, CID, { title: 'Осенняя сессия', examDate: '2026-11-03', lastDate: '2026-11-03', firstPlanDay: '2026-10-09', activeDays: 21, answers: 6480, twoDays: 902, keyed: 960 });
  await tickNow(h);
  const k3 = h.tg.of('sendMessage').map((c) => c.params).find((p) => words(p.text).startsWith('Экзамен прошёл'))!;
  assert.equal(k3.disable_notification, true);
  assert.equal(words(k3.text), 'Экзамен прошёл 3 ноября.\nЗа 26 дней — 21 с занятиями, 6 480 ответов.\n902 из 960 — верно в два разных дня.\n\nПо этому экзамену бот больше не напишет. Экзамен и счёт остаются в Meldy.');
  h.advance(60_000);
  await tickNow(h);
  assert.equal(h.tg.of('sendMessage').filter((c) => words(c.params.text).startsWith('Экзамен прошёл')).length, 1);
});

test('K3 of an exam deleted meanwhile (exam null): closed as skipped «gone», nothing sent', async () => {
  const h = harness({ now: Date.UTC(2026, 10, 4, 17, 1) });
  const [row] = students(h, 1);
  row.remindAt = 21 * 60;
  h.fdb.addAfterDate(row.id, CID, null);
  const stats = await tickNow(h);
  assert.equal(stats.k3_skip_gone, 1);
  assert.equal(h.tg.of('sendMessage').length, 0);
  const k3 = h.fdb.deliveries.find((d) => d.kind === 'after_date')!;
  assert.deepEqual([k3.status, k3.error], ['skipped', 'gone']);
});

test('K3 of an exam with no keyed question: closed as skipped «empty» — the bot never planned it, «0 из 0» says nothing', async () => {
  const h = harness({ now: Date.UTC(2026, 10, 4, 17, 1) });
  const [row] = students(h, 1);
  row.remindAt = 21 * 60;
  h.fdb.addAfterDate(row.id, CID, { title: 'Летняя сессия', examDate: '2026-11-03', lastDate: '2026-11-03', firstPlanDay: '2026-11-03', activeDays: 0, answers: 0, twoDays: 0, keyed: 0 });
  const stats = await tickNow(h);
  assert.equal(stats.k3_skip_empty, 1);
  assert.equal(h.tg.of('sendMessage').length, 0);
  const k3 = h.fdb.deliveries.find((d) => d.kind === 'after_date')!;
  assert.deepEqual([k3.status, k3.error], ['skipped', 'empty']);
});

test('the flush of pending answers (T5) runs when the function exists; a failing step never stops the others', async () => {
  const h = harness({ now: AT_2001 });
  students(h, 1);
  h.fdb.fail('bot_claim_day_close', new DbError('bot_claim_day_close', 503, ''));
  const lines: string[] = [];
  const restore = setLogSink((line) => lines.push(line));
  const stats = await tickNow(h).finally(restore);
  assert.deepEqual(JSON.parse(lines[0]), { route: 'tick', outcome: 'failed', kind: 'night', error_name: 'DbError' });
  assert.equal(stats.night_error, 1);
  assert.equal(stats.flush_missing, 1);
  assert.equal(stats.rem_sent, 1);
  assert.equal(h.fdb.beats.length, 1);
  h.fdb.on('bot_flush_pending', () => 4);
  const next = await tickNow(h);
  assert.equal(next.flush_flushed, 4);
  assert.deepEqual(h.portCalls.filter((c) => c.port === 'group').map((c) => c.fn), ['closePosts', 'sendPosts', 'counters', 'closePosts', 'sendPosts', 'counters']);
});

test('the tick never marks a user as seen (no bot_whoami / bot_settings / bot_today / bot_card_sent)', async () => {
  const h = harness({ now: AT_2001 });
  students(h, 2);
  await tickNow(h);
  for (const fn of ['bot_whoami', 'bot_settings', 'bot_today', 'bot_card_sent']) assert.equal(h.fdb.of(fn).length, 0, fn);
});

test('a tick past its time budget leaves the rest claimed for the next one', async () => {
  const h = harness({ now: AT_2001 });
  students(h, 3);
  const ctxNow = { value: AT_2001 };
  const stats = await runTick(
    { tg: { call: async () => ({ message_id: 1 }), upload: async () => ({}), with: () => { throw new Error('x'); } } as never, db: h.fdb.db, site: W.SITE,
      botUsername: W.BOT_USERNAME, now: () => (ctxNow.value += 30_000), hourly: () => true },
    { session: {} as never, group: { closePosts: async () => ({}), sendPosts: async () => ({}), counters: async () => ({}) } as never, files: {} as never, voice: {} as never },
    { sleep: async () => {} },
  );
  assert.equal(stats.rem_claimed, 3);
  assert.equal(stats.rem_left, 3);
  assert.deepEqual(h.fdb.deliveries.map((d) => d.status), ['claimed', 'claimed', 'claimed']);
});
