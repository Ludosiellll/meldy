// db.ts against T1's contract (CONTRACT_T1.md): the exact function and argument names, the JSON shapes of the SQL
// (bot.link_json, bot_today, bot_reminder_context …) mapped to the bot's types, the key on the right header, and errors
// that carry a code but never the URL or the key.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createDb, DbError, hhmm, minutesOf } from './db.ts';
import { setLogSink } from './log.ts';
import { AUTUMN, CID, wireOf } from './fixtures/scenario.ts';

const URL_ = 'https://abcdefghijklmnopqrst.supabase.co';
const SECRET = 'sb_secret_TEST_NOT_REAL_0123456789abcdef';
const LEGACY = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.TEST_NOT_REAL';

function fakeRest(answers: Record<string, unknown>, status: Record<string, number> = {}) {
  const calls: Array<{ fn: string; url: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const fn = url.split('/').pop() as string;
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>));
    calls.push({ fn, url, headers, body: JSON.parse(String(init?.body ?? '{}')) });
    const code = status[fn] ?? 200;
    const answer = answers[fn];
    if (code >= 400) return new Response(JSON.stringify(answer ?? { code: 'XX000', message: 'boom' }), { status: code });
    if (answer === undefined) return new Response(null, { status: 204 });
    return new Response(JSON.stringify(answer), { status: code, headers: { 'Content-Type': 'application/json' } });
  };
  return { calls, fetch };
}

const LINK = {
  linked: true, chat_id: 700100, tg_lang: 'ru', linked_at: '2026-10-10T08:00:00+00:00', blocked: false, remind_on: true, remind_at: '20:00',
  tz: 'Europe/Minsk', paused_until: '2026-10-19', asked_at: null, last_seen_at: '2026-10-16T16:30:00+00:00',
  prompt: { kind: 'time', prompt_id: 55, target_id: 777, from: 'link', at: 1_792_170_000 }, local_day: '2026-10-16', local_time: '20:00', now: 1_792_170_000,
};
const OVERVIEW = {
  v: 1, day: '2026-10-16', attached_exam_ids: [],
  containers: [{ id: CID, title: 'Осенняя сессия', exam_date: '2026-11-03', created_at: '2026-10-05T09:00:00+00:00', role: 'member', items: 960,
    items_updated_at: null, answers_today: 0, settings: null,
    subjects: [{ id: 's1', position: 1, title: 'A', exam_date: null, oral_exam_id: null, has_oral: false, keyed: 240, no_key: 0, seen: 100, two_days: 40,
      open_errors: 9, seen_today: 0, doubted: 0, stale: 2 }, { id: 's2', position: 2, title: 'B', exam_date: null, oral_exam_id: null, has_oral: false,
      keyed: 240, no_key: 0, seen: 100, two_days: 40, open_errors: 9, seen_today: 0, doubted: 0, stale: 1 }] }],
};

test('every call is POST /rest/v1/rpc/bot_* with named arguments; the new secret key on apikey only, a legacy JWT also as Bearer', async () => {
  const rest = fakeRest({ bot_update_begin: 'new' });
  await createDb({ url: `${URL_}/`, key: SECRET, fetch: rest.fetch }).updateBegin(42);
  assert.equal(rest.calls[0].url, `${URL_}/rest/v1/rpc/bot_update_begin`);
  assert.deepEqual(rest.calls[0].body, { p_update_id: 42 });
  assert.equal(rest.calls[0].headers.apikey, SECRET);
  assert.equal(rest.calls[0].headers.Authorization, undefined);
  await createDb({ url: URL_, key: LEGACY, fetch: rest.fetch }).updateBegin(43);
  assert.equal(rest.calls[1].headers.apikey, LEGACY);
  assert.equal(rest.calls[1].headers.Authorization, `Bearer ${LEGACY}`);
  const db = createDb({ url: URL_, key: SECRET, fetch: rest.fetch });
  await assert.rejects(db.rpc('telegram_link_start' as never), (e: unknown) => e instanceof DbError && e.code === 'bad_name');
  await assert.rejects(db.rpc('bot_x;drop' as never), DbError);
  assert.equal(rest.calls.length, 2, 'a refused name never leaves the function');
});

test('errors carry the code and the status, never the URL or the key', async () => {
  const rest = fakeRest({ bot_whoami: { code: '22023', message: `bad value from ${URL_} key ${SECRET}` } }, { bot_whoami: 400 });
  const db = createDb({ url: URL_, key: SECRET, fetch: rest.fetch });
  const error = await db.whoami(1).catch((e) => e) as DbError;
  assert.ok(error instanceof DbError);
  assert.equal(error.status, 400);
  assert.equal(error.code, '22023');
  const text = `${error.message} ${error.stack} ${JSON.stringify(error)}`;
  assert.ok(!text.includes(SECRET) && !text.includes('abcdefghijklmnopqrst'), text);
  const down = createDb({ url: URL_, key: SECRET, fetch: async (u: string) => { throw new TypeError(`error sending request for url (${u})`); } });
  const net = await down.status().catch((e) => e) as DbError;
  assert.equal(net.code, 'network');
  assert.ok(!String(net.stack).includes('abcdefghijklmnopqrst'));
  const slow = createDb({ url: URL_, key: SECRET, fetch: async () => { throw new DOMException('timed out', 'TimeoutError'); } });
  assert.equal((await slow.status().catch((e) => e) as DbError).code, 'timeout');
});

test('the ledger, setup, status and the beat', async () => {
  const rest = fakeRest({
    bot_update_begin: 'busy',
    bot_setup: { status: 'slow_down', retry_after: 42 },
    bot_status: { configured: true, bot_username: 'Meldyteach_bot', function_region: 'eu-central-1', last_setup_at: '2026-10-16T10:00:00+00:00',
      last_tick_at: '2026-10-16T17:00:00+00:00', last_tick: { rem_sent: 3 }, tick_mode: 'when_due', tick_threshold: 300000, flags: {},
      calls: { month: '2026-10', updates: 120, ticks: 900, total: 1020 }, ledger: { started: 0, failed: 1, done: 119 } },
  });
  const db = createDb({ url: URL_, key: SECRET, fetch: rest.fetch });
  assert.equal(await db.updateBegin(1), 'busy');
  await db.updateDone(1);
  await db.updateFailed(2, 'TelegramError:429');
  assert.deepEqual(await db.setup({ username: 'Meldyteach_bot', botId: 7, tickToken: 'x'.repeat(43), functionUrl: `${URL_}/functions/v1/telegram`, functionRegion: 'eu-central-1' }),
    { status: 'slow_down', retryAfter: 42 });
  const status = await db.status();
  assert.equal(status.functionRegion, 'eu-central-1');
  assert.equal(status.tickMode, 'when_due');
  assert.deepEqual(status.calls, { month: '2026-10', updates: 120, ticks: 900, total: 1020 });
  assert.deepEqual(status.ledger, { started: 0, failed: 1, done: 119 });
  await db.tickBeat({ rem_sent: 2 });
  assert.deepEqual(rest.calls.map((c) => [c.fn, c.body]), [
    ['bot_update_begin', { p_update_id: 1 }],
    ['bot_update_done', { p_update_id: 1 }],
    ['bot_update_failed', { p_update_id: 2, p_error: 'TelegramError:429' }],
    ['bot_setup', { p_bot_username: 'Meldyteach_bot', p_bot_id: 7, p_tick_token: 'x'.repeat(43), p_function_url: `${URL_}/functions/v1/telegram`, p_function_region: 'eu-central-1' }],
    ['bot_status', {}],
    ['bot_tick_beat', { p_stats: { rem_sent: 2 } }],
  ]);
  const bad = createDb({ url: URL_, key: SECRET, fetch: fakeRest({ bot_update_begin: 'maybe' }).fetch });
  await assert.rejects(bad.updateBegin(1), DbError);
});

test('linking and the user: claim, chat events, whoami (LINK + exams), settings (ok / invalid / unlinked)', async () => {
  const rest = fakeRest({
    bot_link_claim: { status: 'linked', replaced_chat_id: 500 },
    bot_chat_event: { status: 'ok', changed: true },
    bot_whoami: { ...LINK, exams: [{ id: CID, title: 'Осенняя сессия', exam_date: '2026-11-03', last_date: '2026-11-03', role: 'member' }], reminder_today: null },
  });
  const db = createDb({ url: URL_, key: SECRET, fetch: rest.fetch });
  assert.deepEqual(await db.linkClaim({ code: 'L0', tgUserId: 700100, chatId: 700100, lang: 'ru', messageDate: 1_792_170_000 }), { status: 'linked', replacedChatId: 500 });
  assert.deepEqual(rest.calls[0].body, { p_code: 'L0', p_tg_user_id: 700100, p_chat_id: 700100, p_lang: 'ru', p_message_date: new Date(1_792_170_000_000).toISOString() });
  await db.chatEvent(700100, 'blocked');
  assert.deepEqual(rest.calls[1].body, { p_tg_user_id: 700100, p_event: 'blocked' });
  const who = await db.whoami(700100);
  assert.deepEqual(who, {
    linked: true, tgUserId: 700100, chatId: 700100, blocked: false, remindOn: true, remindAt: 1200, tz: 'Europe/Minsk', pausedUntil: '2026-10-19',
    prompt: { kind: 'time', promptId: 55, targetId: 777, from: 'link', at: 1_792_170_000 }, today: '2026-10-16', localTime: 1200, now: 1_792_170_000_000,
    exams: [{ id: CID, title: 'Осенняя сессия', examDate: '2026-11-03', lastDate: '2026-11-03', role: 'member' }],
  });
  const off = createDb({ url: URL_, key: SECRET, fetch: fakeRest({ bot_whoami: { linked: false }, bot_link_claim: { status: 'weird' } }).fetch });
  assert.deepEqual(await off.whoami(1), { linked: false });
  assert.deepEqual(await off.linkClaim({ code: 'x', tgUserId: 1, chatId: 1, lang: null, messageDate: 0 }), { status: 'invalid', replacedChatId: null });

  for (const [answer, expected] of [
    [{ status: 'ok', link: LINK, hint: true }, 'ok'],
    [{ status: 'invalid', field: 'paused_until', reason: 'past' }, { status: 'invalid', field: 'paused_until', reason: 'past' }],
    [{ status: 'unlinked' }, { status: 'unlinked' }],
  ] as const) {
    const s = createDb({ url: URL_, key: SECRET, fetch: fakeRest({ bot_settings: answer }).fetch });
    const result = await s.settings(700100, { paused_until: '2026-10-15' });
    if (expected === 'ok') {
      assert.equal(result.status, 'ok');
      assert.equal(result.status === 'ok' && result.hint, true);
      assert.equal(result.status === 'ok' && result.link.remindAt, 1200);
    } else assert.deepEqual(result, expected);
  }
});

test('the day: bot_today (plan, overview, the open session, the day row), card events', async () => {
  const wire = wireOf([AUTUMN]);
  const session = { sid: '7k2pm9qa', chat_id: 700100, message_id: 900, container_id: CID, subject_id: 's1', kind: 'plan', local_day: '2026-10-16',
    items: ['i1', 'i2', 'i3'], retry: [0, 0, 1], cls: ['confirm', 'confirm', 'confirm'], shown: {}, shown_at: [], position: 1, pending: null, counts: {}, figure: {}, status: 'open' };
  const rest = fakeRest({
    bot_today: { linked: true, link: LINK, local_day: '2026-10-16', plan: wire, overview: OVERVIEW, session,
      day: { local_day: '2026-10-16', card_message_id: 41, card_used: false, last_message_id: null, closed_at: null } },
    bot_card_sent: { status: 'ok', local_day: '2026-10-16', prev_message_id: 41 },
  });
  const db = createDb({ url: URL_, key: SECRET, fetch: rest.fetch });
  const today = (await db.today(700100))!;
  assert.equal(today.link.tgUserId, 700100);
  assert.equal(today.now, 1_792_170_000_000);
  assert.equal(today.wire!.containers[0].id, CID);
  assert.deepEqual(today.exams, [{ id: CID, createdAt: '2026-10-05T09:00:00+00:00', keyChanges: 3, hasOral: false }]);
  assert.deepEqual(today.session, { sid: '7k2pm9qa', containerId: CID, subjectId: 's1', messageId: 900, chatId: 700100, position: 1,
    queue: [{ id: 'i1', retry: 0 }, { id: 'i2', retry: 0 }, { id: 'i3', retry: 1 }], localDay: '2026-10-16', kind: 'plan' });
  assert.deepEqual(today.day, { cardMessageId: 41, cardUsed: false, lastMessageId: null });
  assert.deepEqual(await db.cardSent(700100, 42, 'card'), { prevMessageId: 41 });
  assert.deepEqual(rest.calls[1].body, { p_tg_user_id: 700100, p_message_id: 42, p_event: 'card' });
  const off = createDb({ url: URL_, key: SECRET, fetch: fakeRest({ bot_today: { linked: false } }).fetch });
  assert.equal(await off.today(1), null);
});

// T11: the oral parts (bot_oral_inputs) — read only when an exam has an oral part, on the plan's day in the link's zone.
const ORAL_EXAM = '0fe86dc1-dc3c-482a-9b76-c06c11bc3cc5';
const oralQuestion = (n: number) => ({
  question_id: `${n}0000000-0000-4000-8000-00000000000${n}`, position: n, label: String(n), section: 1, text: `Вопрос ${n}`,
  question_hash: String(n).repeat(32), coverage: 'full', coverage_method: 'llm', coverage_reason: '', missing_note: '',
  rubric: { rubric_id: `${n}1111111-1111-4111-8111-111111111111`, built_at: '2026-10-10T10:00:00Z', coverage: 'full', coverage_note: '', materials: [],
    points: [{ id: 'p1', title: 'Определение', short: '', essential: true, source_quote: 'цитата', source_ids: [], anchors: [] }] },
});
const ORAL_INPUTS = {
  linked: true, cap: 300,
  parts: [{ container_id: CID, subject_id: 's1', exam_id: ORAL_EXAM, exam_date: '2026-11-05', questions: 2, capped: false,
    sheet: { exam_id: ORAL_EXAM, mapping_state: 'done', to_write: 0, units: 0, unwritable: 0, job: null, questions: [oralQuestion(1), oralQuestion(2)] },
    line_events: [], meta_events: [] }],
};
const ORAL_OVERVIEW = { ...OVERVIEW, containers: OVERVIEW.containers.map((c) => ({ ...c,
  subjects: c.subjects.map((s) => (s.id === 's1' ? { ...s, oral_exam_id: ORAL_EXAM, has_oral: true } : s)) })) };

test('T11: an exam with an oral part reads bot_oral_inputs once; the parts become the plan\'s oral items; none → no read', async () => {
  const wire = wireOf([AUTUMN]);
  const rest = fakeRest({ bot_today: { linked: true, link: LINK, local_day: '2026-10-16', plan: wire, overview: ORAL_OVERVIEW, session: null, day: null },
    bot_oral_inputs: ORAL_INPUTS });
  const today = (await createDb({ url: URL_, key: SECRET, fetch: rest.fetch }).today(700100))!;
  assert.deepEqual(rest.calls.map((c) => [c.fn, c.body]), [['bot_today', { p_tg_user_id: 700100 }], ['bot_oral_inputs', { p_tg_user_id: 700100 }]]);
  assert.equal(today.oralParts.length, 1);
  assert.equal(today.oralParts[0].examId, ORAL_EXAM);
  assert.equal(today.oralParts[0].examDate, '2026-11-05');
  assert.ok(today.oral.length > 0, 'the oral questions are in the plan');
  assert.deepEqual(today.oral, today.oralParts.flatMap((part) => part.items));
  assert.ok(today.oral.every((item) => item.s === 's1' && item.f !== 't'));

  const plain = fakeRest({ bot_today: { linked: true, link: LINK, local_day: '2026-10-16', plan: wire, overview: OVERVIEW, session: null, day: null } });
  const without = (await createDb({ url: URL_, key: SECRET, fetch: plain.fetch }).today(700100))!;
  assert.deepEqual(plain.calls.map((c) => c.fn), ['bot_today'], 'no oral part: no read');
  assert.deepEqual([without.oral, without.oralParts], [[], []]);
});

test('T11: a failed oral read keeps the card as before T11 and logs the error by name; the reminder context reads it too', async () => {
  const wire = wireOf([AUTUMN]);
  const lines: string[] = [];
  const restore = setLogSink((line) => lines.push(line));
  try {
    const failing = fakeRest({ bot_today: { linked: true, link: LINK, local_day: '2026-10-16', plan: wire, overview: ORAL_OVERVIEW, session: null, day: null } },
      { bot_oral_inputs: 500 });
    const today = (await createDb({ url: URL_, key: SECRET, fetch: failing.fetch }).today(700100))!;
    assert.deepEqual([today.oral, today.oralParts], [[], []]);
    assert.equal(today.wire!.containers[0].id, CID, 'the test part is still there');
    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.deepEqual([entry.route, entry.kind, entry.outcome, entry.error_name], ['webhook', 'oral_inputs', 'failed', 'DbError']);
  } finally {
    restore();
  }
  const rest = fakeRest({
    bot_reminder_context: { status: 'ok', delivery_id: 5, card: 'K1', kind: 'reminder', reason: null, chat_id: 700100, local_day: '2026-10-16',
      tz: 'Europe/Minsk', link: LINK, plan: wire, overview: ORAL_OVERVIEW },
    bot_oral_inputs: ORAL_INPUTS,
  });
  const ctx = await createDb({ url: URL_, key: SECRET, fetch: rest.fetch }).reminderContext(5);
  assert.ok(ctx.card === 'K1');
  assert.equal(ctx.today.oralParts.length, 1);
  assert.deepEqual(rest.calls.map((c) => [c.fn, c.body]), [['bot_reminder_context', { p_delivery_id: 5 }], ['bot_oral_inputs', { p_tg_user_id: 700100 }]]);
  const skip = fakeRest({ bot_reminder_context: { status: 'ok', delivery_id: 6, card: 'skip', reason: 'paused' } });
  assert.equal((await createDb({ url: URL_, key: SECRET, fetch: skip.fetch }).reminderContext(6)).card, 'skip');
  assert.deepEqual(skip.calls.map((c) => c.fn), ['bot_reminder_context']);
});

test('the tick: claims, the reminder context (K1 / K2 / skip / gone), sending, done, the way back after a 429, the night, K3', async () => {
  const wire = wireOf([AUTUMN]);
  const rest = fakeRest({
    bot_claim_reminders: [{ delivery_id: 5, chat_id: 700100, local_day: '2026-10-16', tz: 'Europe/Minsk' }],
    bot_reminder_context: { status: 'ok', delivery_id: 5, card: 'K2', kind: 'ask', reason: null, chat_id: 700100, local_day: '2026-10-16', tz: 'Europe/Minsk',
      link: LINK, plan: wire, overview: OVERVIEW },
    bot_delivery_sending: false,
    bot_delivery_done: { status: 'ok', kind: 'reminder', prev_card_message_id: 99 },
    bot_delivery_retry: true,
    bot_claim_day_close: [{ delivery_id: 6, chat_id: 700100, local_day: '2026-10-15', card_message_id: null, last_message_id: 70 }],
    bot_claim_after_date: [{ delivery_id: 7, chat_id: 700100, local_day: '2026-11-04', tz: 'Europe/Minsk', container_id: CID,
      exam: { container_id: CID, title: 'Осенняя сессия', exam_date: '2026-11-03', last_date: '2026-11-03', first_plan_day: '2026-10-09', active_days: 21,
        answers: 6480, two_days: 902, keyed: 960 } }],
  });
  const db = createDb({ url: URL_, key: SECRET, fetch: rest.fetch });
  assert.deepEqual(await db.claimReminders(50), [{ deliveryId: 5, chatId: 700100, localDay: '2026-10-16', tz: 'Europe/Minsk' }]);
  const ctx = await db.reminderContext(5);
  assert.ok(ctx.card === 'K2');
  assert.equal(ctx.today.link.tgUserId, 700100);
  assert.equal(ctx.today.wire!.items.length, 960);
  assert.equal(await db.deliverySending(5), false);
  assert.deepEqual(await db.deliveryDone(5, 'sent', 1234), { prevCardMessageId: 99 });
  assert.equal(await db.deliveryRetry(5), true);
  assert.deepEqual(await db.claimDayClose(50), [{ deliveryId: 6, chatId: 700100, localDay: '2026-10-15', cardMessageId: null, lastMessageId: 70 }]);
  assert.deepEqual(await db.claimAfterDate(50), [{ deliveryId: 7, chatId: 700100, localDay: '2026-11-04', containerId: CID,
    exam: { title: 'Осенняя сессия', examDate: '2026-11-03', lastDate: '2026-11-03', firstPlanDay: '2026-10-09', activeDays: 21, answers: 6480, twoDays: 902, keyed: 960 } }]);
  assert.deepEqual(rest.calls.map((c) => [c.fn, c.body]), [
    ['bot_claim_reminders', { p_limit: 50 }],
    ['bot_reminder_context', { p_delivery_id: 5 }],
    ['bot_delivery_sending', { p_delivery_id: 5 }],
    ['bot_delivery_done', { p_delivery_id: 5, p_status: 'sent', p_tg_message_id: 1234, p_error: null }],
    ['bot_delivery_retry', { p_delivery_id: 5, p_error: '429' }],
    ['bot_claim_day_close', { p_limit: 50 }],
    ['bot_claim_after_date', { p_limit: 50 }],
  ]);
  const gone = createDb({ url: URL_, key: SECRET, fetch: fakeRest({ bot_claim_after_date: [{ delivery_id: 8, chat_id: 700100, local_day: '2026-11-04', tz: 'Europe/Minsk', container_id: CID, exam: null }] }).fetch });
  assert.deepEqual(await gone.claimAfterDate(50), [{ deliveryId: 8, chatId: 700100, localDay: '2026-11-04', containerId: CID, exam: null }]);
  const closed = createDb({ url: URL_, key: SECRET, fetch: fakeRest({ bot_delivery_retry: false }).fetch });
  assert.equal(await closed.deliveryRetry(5), false, 'false: closed by the database (or not in sending)');
  for (const answer of [{ status: 'ok', delivery_id: 5, card: 'skip', reason: 'paused' }, { status: 'gone', delivery_id: 5, card: 'skip', reason: 'not_claimed' }]) {
    const s = createDb({ url: URL_, key: SECRET, fetch: fakeRest({ bot_reminder_context: answer }).fetch });
    assert.deepEqual(await s.reminderContext(5), { card: 'skip', deliveryId: 5, reason: answer.reason });
  }
});

test('release 47: bot_exams, bot_exam_remind, bot_exam_move — names, arguments, shapes; exam_list on /today and in the tick; K3\'s role; a move prompt', async () => {
  const LIST = [
    { container_id: CID, title: 'Осенняя сессия', exam_date: '2026-11-03', state: 'study', tg_remind: true, role: 'owner', members: 2 },
    { container_id: 'a1b2c3d4-0000-4000-8000-000000000002', title: 'Зимняя сессия', exam_date: null, state: 'no_date', tg_remind: false, role: 'member', members: null },
  ];
  const EXAMS = [
    { id: CID, title: 'Осенняя сессия', date: '2026-11-03', state: 'study', on: true, role: 'owner', members: 2 },
    { id: 'a1b2c3d4-0000-4000-8000-000000000002', title: 'Зимняя сессия', date: null, state: 'no_date', on: false, role: 'member', members: 0 },
  ];
  const rest = fakeRest({
    bot_exams: { status: 'ok', local_day: '2026-10-16', exams: LIST },
    bot_exam_remind: { status: 'ok', container_id: CID, tg_remind: false, exams: LIST },
    bot_exam_move: { status: 'ok', title: 'Осенняя сессия', for: 'me', container_id: CID, exam_date: '2026-11-03', own_exam_date: '2026-11-10', subjects: [] },
    bot_today: { linked: true, link: LINK, local_day: '2026-10-16', plan: wireOf([AUTUMN]), overview: OVERVIEW, session: null, day: null, exam_list: LIST },
    bot_claim_after_date: [{ delivery_id: 7, chat_id: 700100, local_day: '2026-11-04', tz: 'Europe/Minsk', container_id: CID,
      exam: { container_id: CID, title: 'Осенняя сессия', exam_date: '2026-11-03', last_date: '2026-11-03', first_plan_day: '2026-10-09', active_days: 21,
        answers: 6480, two_days: 902, keyed: 960, own_exam_date: null, role: 'owner', members: 2 } }],
  });
  const db = createDb({ url: URL_, key: SECRET, fetch: rest.fetch });
  assert.deepEqual(await db.exams(700100), { status: 'ok', today: '2026-10-16', exams: EXAMS });
  assert.deepEqual(await db.examRemind(700100, CID, false), { status: 'ok', today: null, exams: EXAMS });
  assert.deepEqual(await db.examMove(700100, CID, '2026-11-10', 'me'), { status: 'ok', title: 'Осенняя сессия', examDate: '2026-11-03', ownDate: '2026-11-10' });
  assert.deepEqual((await db.today(700100))!.botExams, EXAMS);
  assert.deepEqual((await db.claimAfterDate(50))[0].exam, {
    title: 'Осенняя сессия', examDate: '2026-11-03', lastDate: '2026-11-03', firstPlanDay: '2026-10-09', activeDays: 21, answers: 6480, twoDays: 902, keyed: 960,
    role: 'owner', members: 2,
  });
  assert.deepEqual(rest.calls.slice(0, 3).map((c) => [c.fn, c.body]), [
    ['bot_exams', { p_tg_user_id: 700100 }],
    ['bot_exam_remind', { p_tg_user_id: 700100, p_container_id: CID, p_on: false }],
    ['bot_exam_move', { p_tg_user_id: 700100, p_container_id: CID, p_date: '2026-11-10', p_for: 'me' }],
  ]);
  for (const [answer, expected] of [
    [{ status: 'unlinked' }, { status: 'unlinked' }], [{ status: 'gone' }, { status: 'gone' }], [{ status: 'forbidden' }, { status: 'forbidden' }],
    [{ status: 'invalid', reason: 'far' }, { status: 'invalid', reason: 'far' }],
  ] as const) {
    const m = createDb({ url: URL_, key: SECRET, fetch: fakeRest({ bot_exam_move: answer }).fetch });
    assert.deepEqual(await m.examMove(700100, CID, null, 'me'), expected);
  }
  assert.deepEqual(await createDb({ url: URL_, key: SECRET, fetch: fakeRest({ bot_exam_remind: { status: 'gone' } }).fetch }).examRemind(1, CID, true), { status: 'gone' });
  // a server before release 47: no exam_list (every exam in the plan), K3 without a role
  const old = createDb({ url: URL_, key: SECRET, fetch: fakeRest({ bot_today: { linked: true, link: LINK, local_day: '2026-10-16', plan: null, overview: OVERVIEW } }).fetch });
  assert.deepEqual((await old.today(700100))!.botExams, []);
  // a move's prompt keeps its exam (bot.links.prompt), a malformed one is dropped
  const prompted = { ...LINK, prompt: { kind: 'move', prompt_id: 56, target_id: 900, from: 'settings', at: 1_792_170_000, cid: CID } };
  const p = createDb({ url: URL_, key: SECRET, fetch: fakeRest({ bot_whoami: { ...prompted, exams: [] } }).fetch });
  const who = await p.whoami(700100);
  assert.deepEqual(who.linked && who.prompt, { kind: 'move', promptId: 56, targetId: 900, from: 'settings', at: 1_792_170_000, cid: CID });
  const bad = createDb({ url: URL_, key: SECRET, fetch: fakeRest({ bot_whoami: { ...prompted, prompt: { ...prompted.prompt, cid: 'x' }, exams: [] } }).fetch });
  const whoBad = await bad.whoami(700100);
  assert.equal(whoBad.linked && whoBad.prompt?.cid, null);
});

test('clock helpers', () => {
  assert.equal(minutesOf('20:00'), 1200);
  assert.equal(minutesOf('7:45'), 465);
  assert.equal(minutesOf('20:00:00'), 1200);
  assert.equal(minutesOf('25:00'), null);
  assert.equal(minutesOf(1200), null);
  assert.equal(hhmm(465), '07:45');
  assert.equal(hhmm(0), '00:00');
});
