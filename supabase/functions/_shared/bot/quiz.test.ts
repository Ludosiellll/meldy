// The tick's step «quiz» (quiz.ts; migration 20261105090100_quiz_telegram.sql): the authors' quiz messages — a finish,
// a digest, the close summary — and the quiz's link into a bound group chat; the participants' names escaped; T1's
// at-most-once (sending → sent; a 429 back to claimed and the step stops; a 400/403 failed, a blocked author marked);
// the tick's deadline; without the migration, «missing»; the step in the tick between «flush» and «sweep».
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { inert, visibleLength, visibleText, WORD_JOINER } from './html.ts';
import { setLogSink } from './log.ts';
import { createQuizNotices, NAME_MAX, parseRows, QUIZ_LIMIT, QW, render, TEXT_MAX, type QuizRow } from './quiz.ts';
import { STUBS, type Ctx } from './router.ts';
import { createTelegram } from './tg.ts';
import { runTick } from './tick.ts';
import { fakeDb } from './fixtures/fake_db.ts';
import { fakeTelegram, TEST_TOKEN } from './fixtures/fake_telegram.ts';

const SITE = 'https://ludosiel-studyforge.hf.space';
const QUIZ = '7a3e7c1e-1d2b-4c5e-9f0a-1b2c3d4e5f60';
const EXAM = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';
const words = (html: string) => visibleText(html).replace(/\u00a0/g, ' ');
const base = { quiz_id: QUIZ, container_id: EXAM, title: 'Контрольная <9А>', pass_percent: 60 };

function setup(options: { functions?: boolean } = {}) {
  let now = Date.UTC(2026, 10, 5, 9, 0, 0);
  const clock = { now: () => now, advance: (ms: number) => { now += ms; } };
  const fdb = fakeDb({ now: clock.now });
  const author = fdb.addLink({ userId: 'aaaaaaaa-0000-4000-8000-000000000001', tgUserId: 7001 });
  const ft = fakeTelegram({ now: clock.now });
  const tg = createTelegram({ token: TEST_TOKEN, fetch: ft.fetch, wait429Sec: 0, sleep: async () => {} });
  let queued: Array<Record<string, unknown>> = [];
  let nextId = 500;
  /** A message the database hands: a claimed delivery of the author's link (a group's chat for a share). */
  const due = (row: Record<string, unknown>, chatId = author.chatId) => {
    const id = nextId++;
    fdb.deliveries.push({ id, kind: 'notice', chatId, linkId: author.id, localDay: '2026-11-05', ref: `qz:${id}`, status: 'claimed',
      attempts: 1, claimedAt: now, sentAt: null, messageId: null, error: null });
    queued.push({ ...base, delivery_id: id, chat_id: chatId, ...row });
    return id;
  };
  const asked: number[] = [];
  if (options.functions !== false) {
    fdb.on('bot_quiz_notices', (args: Record<string, unknown>) => {
      asked.push(Number(args.p_limit));
      const rows = queued;
      queued = [];
      return { rows };
    });
  }
  const ctx = { tg, db: fdb.db, site: SITE, now: clock.now } as unknown as Ctx;
  const quiz = createQuizNotices();
  const tick = (left = 25_000) => quiz.tick(ctx, { deadline: clock.now() + left, pace: async () => {} });
  return { clock, fdb, ft, author, due, asked, ctx, quiz, tick };
}

const one = { kind: 'one', name: 'Иванов <Иван>', score: 17, max: 20 };
const digest = {
  kind: 'digest',
  people: [{ name: 'Борисов Глеб', score: 15, max: 20 }, { name: 'Вера', score: 16.5, max: 20 }],
  count: 4,
  done: 24,
};
const close = { kind: 'close', people: 24, avg_percent: 71, passed: 18, hardest: [{ no: '7', percent: 20 }, { no: '3', percent: 35 }] };
const share = { kind: 'share', code: 'k7m2p9q4r8st', closes_at: '2026-11-07T17:59:00Z', item_count: 20, time_limit_s: 1800, guests: true, tz: 'Europe/Minsk' };

test('a finish: the quiz, the name as typed (escaped) and the score, «Результаты» to the results page', async () => {
  const s = setup();
  const id = s.due(one);
  assert.deepEqual(await s.tick(), { one: 1 });
  assert.deepEqual(s.asked, [QUIZ_LIMIT]);
  const [call] = s.ft.of('sendMessage');
  assert.equal(call.params.chat_id, 7001);
  assert.equal(call.params.disable_notification, true, 'silent');
  assert.equal(call.params.protect_content, true);
  assert.match(call.params.text, /&lt;Иван&gt;/, 'the name is escaped');
  assert.equal(words(call.params.text), 'Контрольная «Контрольная <9А>»\nНовая работа: Иванов <Иван> — 17 из 20 (85 %).');
  assert.deepEqual(call.params.reply_markup.inline_keyboard, [[{ text: QW.results, url: `${SITE}/exams/c/${EXAM}/quizzes/${QUIZ}` }]]);
  const d = s.fdb.deliveries.find((x) => x.id === id)!;
  assert.equal(d.status, 'sent');
  assert.equal(d.messageId, 1000);
});

test('a digest: the new names and scores, «и ещё N», how many in all', async () => {
  const s = setup();
  s.due(digest);
  assert.deepEqual(await s.tick(), { digest: 1 });
  assert.equal(words(s.ft.of('sendMessage')[0].params.text), [
    'Контрольная «Контрольная <9А>»',
    'Новые работы: 4.',
    'Борисов Глеб — 15 из 20',
    'Вера — 16,5 из 20',
    'и ещё 2',
    '',
    'Всего сдали: 24.',
  ].join('\n'));
});

test('the close: people, the average, the pass mark, the hardest questions; «Разбор вопросов»', async () => {
  const s = setup();
  s.due(close);
  s.due({ kind: 'close', people: 0, avg_percent: null, passed: null, hardest: [] });
  assert.deepEqual(await s.tick(), { close: 2 });
  const [first, second] = s.ft.of('sendMessage');
  assert.equal(words(first.params.text), [
    'Контрольная «Контрольная <9А>» закрыта',
    'Сдали: 24 человека. Средний результат — 71 %.',
    'Набрали проходной балл: 18 из 24.',
    'Труднее всего: № 7 — 20 %, № 3 — 35 %.',
  ].join('\n'));
  assert.equal(first.params.reply_markup.inline_keyboard[0][0].url, `${SITE}/exams/c/${EXAM}/quizzes/${QUIZ}?tab=questions`);
  assert.equal(words(second.params.text), 'Контрольная «Контрольная <9А>» закрыта\nНикто не сдал.');
});

test('the share: into the group chat, the questions, the timer and the deadline in the group\'s zone, «Открыть контрольную»', async () => {
  const s = setup();
  s.due(share, -100500);
  assert.deepEqual(await s.tick(), { share: 1 });
  const [call] = s.ft.of('sendMessage');
  assert.equal(call.params.chat_id, -100500);
  assert.equal(words(call.params.text), [
    'Контрольная «Контрольная <9А>»',
    '20 вопросов · 30 минут · до 7 ноября, 20:59',
    QW.guests,
  ].join('\n'));
  assert.deepEqual(call.params.reply_markup.inline_keyboard, [[{ text: QW.open, url: `${SITE}/k/k7m2p9q4r8st` }]]);
});

test('a 429: the row goes back to claimed and the step stops; the next row waits for a later tick', async () => {
  const s = setup();
  const first = s.due(one);
  const second = s.due(digest);
  s.ft.fail('sendMessage', { kind: '429', retryAfter: 30 });
  assert.deepEqual(await s.tick(), { rate_limited: 1, requeued: 1 });
  assert.equal(s.fdb.deliveries.find((x) => x.id === first)!.status, 'claimed');
  assert.equal(s.fdb.deliveries.find((x) => x.id === second)!.status, 'claimed', 'not tried');
  assert.equal(s.ft.of('sendMessage').length, 1);
});

test('the author blocked the bot: failed, the link marked; a group that refuses: failed, no link touched', async () => {
  const s = setup();
  // the group first: once the author's link is blocked, T1 sends nothing more on it
  const group = s.due(share, -100500);
  const mine = s.due(one);
  s.ft.fail('sendMessage', { kind: '403', description: 'Forbidden: bot was kicked from the supergroup chat' }, { kind: '403' });
  assert.deepEqual(await s.tick(), { failed: 2 });
  assert.equal(s.fdb.deliveries.find((x) => x.id === mine)!.status, 'failed');
  assert.equal(s.fdb.deliveries.find((x) => x.id === group)!.status, 'failed');
  assert.deepEqual(s.fdb.of('bot_chat_event').map((c) => c.args), [{ tgUserId: 7001, event: 'blocked' }], 'only the private chat');
  assert.ok(s.fdb.link(7001)!.blockedAt !== null);
});

test('a timeout: left in sending (it becomes unknown), never sent again; a row another tick took is skipped', async () => {
  const s = setup();
  const id = s.due(one);
  s.ft.fail('sendMessage', { kind: 'timeout' });
  assert.deepEqual(await s.tick(), { unknown: 1 });
  assert.equal(s.fdb.deliveries.find((x) => x.id === id)!.status, 'sending');
  // the same row handed again (a second tick at once): bot_delivery_sending refuses it
  s.due(one);
  s.fdb.deliveries.at(-1)!.status = 'sending';
  assert.deepEqual(await s.tick(), { taken: 1 });
});

test('past the tick\'s deadline: the rows stay claimed for the next hand-out; malformed rows are counted, never sent', async () => {
  const s = setup();
  const id = s.due(one);
  assert.deepEqual(await s.tick(-1), { left: 1 });
  assert.equal(s.fdb.deliveries.find((x) => x.id === id)!.status, 'claimed');
  assert.equal(s.ft.of('sendMessage').length, 0);
  const parsed = parseRows({ rows: [{ kind: 'one' }, { ...base, delivery_id: 1, chat_id: 2, kind: 'share', code: 'BAD' }, { ...base, delivery_id: 3, chat_id: 4, kind: 'what' }] });
  assert.deepEqual(parsed, { rows: [], bad: 3 });
  assert.deepEqual(parseRows(null), { rows: [], bad: 0 });
});

test('without the migration: «missing», nothing sent', async () => {
  const s = setup({ functions: false });
  assert.deepEqual(await s.tick(), { missing: 1 });
  assert.equal(s.ft.of('sendMessage').length, 0);
});

test('the words: an empty name reads «Участник», scores with a comma, no timer and no deadline left out', () => {
  const row = (r: Record<string, unknown>) => parseRows({ rows: [{ ...base, delivery_id: 1, chat_id: 1, ...r }] }).rows[0] as QuizRow;
  assert.equal(words(render(row({ ...one, name: '  ', score: 7.25, max: 8 }), SITE).text).split('\n')[1], 'Новая работа: Участник — 7,25 из 8 (91 %).');
  assert.equal(words(render(row({ ...share, closes_at: null, time_limit_s: null, guests: false, item_count: 1 }), SITE).text), 'Контрольная «Контрольная <9А>»\n1 вопрос');
});

test('in the tick: the step «quiz» runs between «flush» and «sweep», its numbers under quiz_', async () => {
  const s = setup();
  s.due(one);
  const order: string[] = [];
  const lines: string[] = [];
  const restore = setLogSink((line) => lines.push(line));
  try {
    const totals = await runTick(s.ctx, {
      ...STUBS,
      quiz: { tick: async (ctx, tools) => { order.push('quiz'); return s.quiz.tick(ctx, tools); } },
      sweep: { tick: async () => { order.push('sweep'); return {}; } },
      monitor: { tick: async () => { order.push('monitor'); return {}; } },
    });
    assert.deepEqual(order, ['quiz', 'sweep', 'monitor']);
    assert.equal(totals.quiz_one, 1);
  } finally {
    restore();
  }
  assert.ok(!lines.some((line) => line.includes('Иванов')), 'no name in the log');
});

test('a name that looks like a link, a mention or a command is never one in the author\'s chat (inert, in html.ts)', async () => {
  const names = ['t.me/evil_bot', '@evil_bot', 'https://evil.example/x', '#скидка', '/start', 'mail@evil.example', '+79991234567', '$BTC'];
  for (const name of names) {
    const out = inert(name);
    assert.equal(out.replaceAll(WORD_JOINER, ''), name, 'reads the same');
    assert.doesNotMatch(out, /[@#$/:][^\u2060]/u, `${name}: a sign without a joiner after it`);
    assert.doesNotMatch(out, /\.[^\s.\u2060]/u, `${name}: a dot glued to a word`);
    assert.doesNotMatch(out, /\d{4}/u, `${name}: four digits in a row`);
  }
  assert.equal(inert('Иванов Иван'), 'Иванов Иван', 'an ordinary name is left as it is');
  const s = setup();
  s.due({ kind: 'one', name: 't.me/evil_bot @evil_bot', score: 1, max: 2 });
  s.due({ kind: 'digest', people: [{ name: '/start', score: 1, max: 2 }], count: 1, done: 3 });
  await s.tick();
  for (const call of s.ft.of('sendMessage')) {
    assert.doesNotMatch(visibleText(call.params.text), /t\.me\/|@evil|\/start/u, 'no live pattern in the message');
    assert.equal(call.params.reply_markup.inline_keyboard.length, 1, 'the only link is the results button');
  }
});

test('the close of a big class says the average comes from the latest finishes (kept with the summary)', async () => {
  const s = setup();
  s.due({ kind: 'close', people: 1000, avg_percent: 64, passed: 150, sample: 200, hardest: [{ no: '7', percent: 20 }] });
  await s.tick();
  assert.equal(words(s.ft.of('sendMessage')[0].params.text), [
    'Контрольная «Контрольная <9А>» закрыта',
    'Сдали: 1000 человек. Средний результат — 64 %.',
    'Набрали проходной балл: 150 из 200.',
    'Труднее всего: № 7 — 20 %.',
    'Средний результат, проходной балл и трудные вопросы — по последним работам 200 человек.',
  ].join('\n'));
});

test('a name made inert stays short, and a digest never passes Telegram\'s 4096 characters (review 2026-11-05)', () => {
  const row = (r: Record<string, unknown>) => parseRows({ rows: [{ ...base, delivery_id: 1, chat_id: 1, ...r }] }).rows[0] as QuizRow;
  const at80 = '@'.repeat(80);
  const one = words(render(row({ kind: 'one', name: at80, score: 1, max: 2 }), SITE).text).split('\n')[1];
  const name = one.slice('Новая работа: '.length, one.indexOf(' — '));
  assert.ok([...name].length <= NAME_MAX, `${[...name].length} characters`);
  assert.ok(name.endsWith('…'));
  // 30 such names and a long title: the list stops where the message would pass the limit, the rest is «и ещё N»
  const people = Array.from({ length: 30 }, (_, i) => ({ name: `${at80}${i}`, score: 1, max: 2 }));
  const out = render(row({ kind: 'digest', title: 'Я'.repeat(120), people, count: 200, done: 240 }), SITE);
  assert.ok(visibleLength(out.text) <= TEXT_MAX, `${visibleLength(out.text)} characters`);
  assert.ok(visibleLength(out.text) <= 4096);
  const text = words(out.text);
  const listed = text.split('\n').filter((line) => line.startsWith('@')).length;
  assert.ok(listed > 0 && listed <= 30);
  assert.ok(text.includes(QW.more(200 - listed)), 'the rest as «и ещё N»');
  // ordinary names: all 30 shown, as before
  const plain = render(row({ kind: 'digest', people: people.map((p, i) => ({ ...p, name: `Ученик ${i}` })), count: 30, done: 30 }), SITE);
  assert.equal(words(plain.text).split('\n').filter((line) => line.startsWith('Ученик')).length, 30);
});

