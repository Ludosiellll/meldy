// The outage monitor (monitor.ts; migration 20261012100000_telegram_bot_monitor.sql): off until a chat is set; the
// cadence — /api/health and /try every 5 minutes (on the 15-minute beat in the tick's saving mode), /api/health/deep
// every 30, one run per slot; an alert after two failures in a row, again at most every 6 hours, one recovery with the
// outage's length; deep health by check and code; a timeout or a network error is a failure; the budget; nothing
// secret in a message or a log line; the step never throws into the tick. Fake site, clock, database and Telegram.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMonitor, duration, monitorText, readDeep, type Say } from './monitor.ts';
import { DbError } from './db.ts';
import { visibleText } from './html.ts';
import { lintMessage } from './lint.ts';
import { setLogSink } from './log.ts';
import { STUBS, type Ctx } from './router.ts';
import { createTelegram } from './tg.ts';
import { runTick, STOP_MARGIN_MS, TICK_BUDGET_MS } from './tick.ts';
import { fakeDb } from './fixtures/fake_db.ts';
import { deepBody, fakeMonitorDb, fakeSite, SITE_URL } from './fixtures/fake_monitor.ts';
import { fakeTelegram, TEST_TOKEN } from './fixtures/fake_telegram.ts';
import * as W from './words.ts';

const LINES: string[] = [];
setLogSink((line) => {
  LINES.push(line);
});

const MIN = 60_000;
const OWNER = 700777;
/** 2026-10-12 02:50:05 UTC: a tick a few seconds into its minute. */
const T0 = Date.UTC(2026, 9, 12, 2, 50, 5);
const hhmm = (ms: number) => new Date(ms).toISOString().slice(11, 16);
const plain = (html: string) => visibleText(html).replace(/ /g, ' ');

function setup(options: { now?: number; chat?: number | null; saving?: boolean; site?: string | null; functions?: boolean } = {}) {
  let now = options.now ?? T0;
  const clock = { now: () => now, advance: (ms: number) => { now += ms; } };
  const fdb = fakeDb({ now: clock.now });
  const row = options.functions === false ? null : fakeMonitorDb(fdb, clock.now);
  if (row) {
    row.chatId = options.chat === undefined ? OWNER : options.chat;
    row.site = options.site ?? null;
    if (options.saving) row.tickMode = 'when_due';
  }
  const tg = fakeTelegram({ now: clock.now });
  const site = fakeSite(clock);
  const ctx: Ctx = {
    tg: createTelegram({ token: TEST_TOKEN, fetch: tg.fetch, wait429Sec: 0, sleep: async () => {} }),
    db: fdb.db, site: W.SITE, botUsername: W.BOT_USERNAME, now: clock.now, hourly: () => true,
  };
  const monitor = createMonitor({ fetch: site.fetch });
  /** The monitor step of one tick, with `left` ms of the tick's budget (its deadline) from now. */
  const tick = (left = TICK_BUDGET_MS - STOP_MARGIN_MS) => monitor.tick(ctx, { deadline: clock.now() + left, pace: async () => {} });
  /** `count` ticks, `everyMin` minutes apart; their numbers. */
  async function ticks(count: number, everyMin = 1) {
    const out = [];
    for (let i = 0; i < count; i += 1) {
      clock.advance(everyMin * MIN);
      out.push(await tick());
    }
    return out;
  }
  /** Every sendMessage tried (a refused one too). */
  const sent = () => tg.of('sendMessage').map((c) => c.params);
  /** The messages that went out (the fake chat keeps them), as Telegram shows them. */
  const texts = () => [...tg.messages.values()].map((m) => plain(m.text));
  /** When each path of the site was asked (UTC HH:MM). */
  const asked = (path: string) => site.calls.filter((c) => c.path === path).map((c) => hhmm(c.at));
  return { clock, fdb, row: row as NonNullable<typeof row>, tg, site, ctx, monitor, tick, ticks, sent, texts, asked };
}

test('off until a chat is set: one read of bot_monitor_state a tick, no claim, no request to the site, no message', async () => {
  const s = setup({ chat: null });
  assert.deepEqual(await s.tick(), {});
  await s.ticks(30);
  assert.equal(s.fdb.of('bot_monitor_state').length, 31);
  assert.equal(s.fdb.of('bot_monitor_claim').length + s.fdb.of('bot_monitor_save').length, 0);
  assert.equal(s.site.calls.length, 0);
  assert.equal(s.tg.calls.length, 0);
  // The owner sets the chat: the next tick checks the site.
  s.row.chatId = OWNER;
  s.clock.advance(MIN);
  assert.deepEqual(await s.tick(), { checked: 7 });
  assert.deepEqual(s.site.paths().sort(), ['/api/health', '/api/health/deep', '/try']);
  assert.equal(s.tg.calls.length, 0, 'all OK: nothing to say');
});

test('the cadence: /api/health and /try every 5 minutes, /api/health/deep every 30; one run per slot', async () => {
  const s = setup();
  await s.tick();
  await s.ticks(60);
  const fives = ['02:50', '02:55', '03:00', '03:05', '03:10', '03:15', '03:20', '03:25', '03:30', '03:35', '03:40', '03:45', '03:50'];
  assert.deepEqual(s.asked('/api/health'), fives);
  assert.deepEqual(s.asked('/try'), fives);
  assert.deepEqual(s.asked('/api/health/deep'), ['02:50', '03:00', '03:30'], 'the first tick (mid-slot), then :00 and :30');
  assert.equal(s.fdb.of('bot_monitor_state').length, 61, 'one read a tick');
  assert.equal(s.fdb.of('bot_monitor_claim').length, 13, 'a claim only when a slot is due');
  assert.deepEqual(s.fdb.of('bot_monitor_claim').slice(0, 3).map((c) => c.args), [
    { p_health_slot: '2026-10-12T02:50:00.000Z', p_deep_slot: '2026-10-12T02:30:00.000Z' },
    { p_health_slot: '2026-10-12T02:55:00.000Z', p_deep_slot: null },
    { p_health_slot: '2026-10-12T03:00:00.000Z', p_deep_slot: '2026-10-12T03:00:00.000Z' },
  ]);
  assert.ok(s.site.calls.every((c) => c.url.startsWith(`${SITE_URL}/`) && c.hasSignal), 'the bot\'s site, each request with its time limit');
});

test('saving mode (when_due): the five-minute checks on the 15-minute beat; off-beat ticks do not run them; a missed beat is taken later in its slot', async () => {
  const s = setup({ saving: true });
  await s.tick();
  await s.ticks(60); // the tick may also come off the beat when something else is due
  assert.deepEqual(s.asked('/api/health'), ['02:50', '03:00', '03:15', '03:30', '03:45']);
  assert.deepEqual(s.asked('/try'), ['02:50', '03:00', '03:15', '03:30', '03:45']);
  assert.deepEqual(s.asked('/api/health/deep'), ['02:50', '03:00', '03:30']);
  // No tick at 04:00 (the beat was missed); one at 04:07 for something due takes the slot of 04:00, once.
  s.clock.advance(17 * MIN);
  assert.equal(hhmm(s.clock.now()), '04:07');
  assert.deepEqual(await s.tick(), { checked: 7 });
  await s.ticks(1);
  assert.deepEqual(s.asked('/api/health').slice(-1), ['04:07']);
  assert.equal(s.row.healthSlot, '2026-10-12T04:00:00.000Z');
  assert.equal(s.row.deepSlot, '2026-10-12T04:00:00.000Z');
});

test('one failure says nothing; the second in a row alerts, once, with when it began (UTC); a run\'s lines are one message, with sound', async () => {
  const s = setup();
  s.site.always('/api/health', { status: 503, body: '<html><body>503 Service Unavailable</body></html>' });
  s.site.always('/try', { status: 502 });
  assert.deepEqual(await s.tick(), { checked: 7, failed: 2 });
  assert.equal(s.sent().length, 0, 'one failure: nothing');
  assert.deepEqual(s.row.checks.health, { fails: 1, since: '2026-10-12T02:50:05.000Z', alerted: null, ok: null, code: '503' });
  const [second] = await s.ticks(1, 5);
  assert.deepEqual(second, { checked: 2, failed: 2, alerts: 2, sent: 1 });
  assert.deepEqual(s.texts(), [
    'Meldy: сайт не отвечает (/api/health: 503) с 02:50 UTC.\nMeldy: не открывается пример без входа (/try: 502) с 02:50 UTC.',
  ]);
  const p = s.sent()[0];
  assert.deepEqual([p.chat_id, p.parse_mode, p.protect_content, p.disable_notification], [OWNER, 'HTML', true, false], 'an alert rings');
  assert.equal(s.row.checks.health.alerted, '2026-10-12T02:55:05.000Z');
  await s.ticks(12, 5);
  assert.equal(s.sent().length, 1, 'still down for an hour: no second message');

  // One failure, then OK: nothing at all, no recovery either.
  const one = setup();
  one.site.once('/api/health', { status: 500 });
  await one.tick();
  await one.ticks(4, 5);
  assert.equal(one.sent().length, 0);
  assert.deepEqual(one.row.checks.health, { fails: 0, since: null, alerted: null, ok: '2026-10-12T03:10:05.000Z', code: null });
});

test('while it keeps failing: again at most every 6 hours, with how long it has been down', async () => {
  const s = setup();
  s.site.always('/api/health', { kind: 'network' });
  await s.tick();
  await s.ticks(147, 5); // to 15:05
  assert.deepEqual(s.texts(), [
    'Meldy: сайт не отвечает (/api/health: network) с 02:50 UTC.',
    'Meldy: сайт не отвечает (/api/health: network) с 02:50 UTC, уже 6 ч 5 мин.',
    'Meldy: сайт не отвечает (/api/health: network) с 02:50 UTC, уже 12 ч 5 мин.',
  ]);
  assert.deepEqual(s.tg.of('sendMessage').map((c) => hhmm(c.at)), ['02:55', '08:55', '14:55']);
  assert.ok(s.sent().every((p) => p.disable_notification === false));
});

test('recovery: one message, silent, with the length of the outage; then nothing', async () => {
  const s = setup();
  s.site.always('/api/health', { status: 502 });
  await s.tick();
  await s.ticks(2, 5); // 02:55 the alert, 03:00 still down
  s.site.restore('/api/health');
  const [back] = await s.ticks(1, 5); // 03:05
  assert.deepEqual(back, { checked: 2, recoveries: 1, sent: 1 });
  assert.deepEqual(s.texts(), ['Meldy: сайт не отвечает (/api/health: 502) с 02:50 UTC.', 'Meldy: сайт снова отвечает, перерыв 15 мин.']);
  assert.equal(s.sent()[1].disable_notification, true, 'a recovery does not ring');
  await s.ticks(24, 5);
  assert.equal(s.sent().length, 2);
  assert.deepEqual(s.row.checks.health, { fails: 0, since: null, alerted: null, ok: '2026-10-12T05:05:05.000Z', code: null });
});

test('deep health: the failing checks by name with their codes, at the answer\'s checked_at; never a provider\'s text', async () => {
  const s = setup({ now: Date.UTC(2026, 9, 12, 3, 0, 5) });
  const ttsDown = { ok: false, provider: 'edge-tts', model: 'voice-x7', ms: 10007, code: 'network' };
  const groqDown = { ok: false, provider: 'Groq', model: 'model-main-x7', ms: 301, code: 'rate_limited',
    detail: 'Rate limit reached for model in organization org_01abc on tokens per day: Limit 100000, Used 99837' };
  // 03:00: the Space's answer of 02:51 (kept 10 minutes): the voice is down.
  s.site.once('/api/health/deep', { status: 200, body: deepBody({ tts: ttsDown }, { checked_at: '2026-10-12T02:51:00Z', cached: true }) });
  await s.tick();
  assert.deepEqual(s.row.checks.tts, { fails: 1, since: '2026-10-12T02:51:00.000Z', alerted: null, ok: null, code: 'network' });
  await s.ticks(5, 5); // 03:05–03:25: the five-minute checks only
  s.site.once('/api/health/deep', { status: 200, body: deepBody({ tts: ttsDown, groq: groqDown }, { checked_at: '2026-10-12T03:30:00Z' }) });
  await s.ticks(1, 5); // 03:30
  assert.deepEqual(s.texts(), ['Meldy: не работает озвучка (tts: network) с 02:51 UTC.']);
  await s.ticks(5, 5);
  s.site.once('/api/health/deep', { status: 200, body: deepBody({ groq: groqDown }, { checked_at: '2026-10-12T03:55:00Z' }) });
  await s.ticks(1, 5); // 04:00
  assert.deepEqual(s.texts().slice(1), ['Meldy: озвучка снова работает, перерыв 1 ч 4 мин.\nMeldy: не работает Groq (groq: rate_limited) с 03:30 UTC.']);
  assert.equal(s.sent()[1].disable_notification, false, 'an alert in it: it rings');
  for (const text of s.texts()) assert.ok(!/edge-tts|voice-x7|model-main-x7|Rate limit|org_01abc|10007/.test(text), text);

  // The parser alone: the four by their own ok and code; any other code text is «other»; deep itself by `ok`.
  const at = Date.UTC(2026, 9, 12, 3, 0, 5);
  const checked = Date.UTC(2026, 9, 12, 2, 55, 0);
  assert.deepEqual(readDeep(deepBody({
    tts: { ok: false, code: 'network' },
    supabase: { ok: false, code: 'Service Unavailable: upstream connect error or disconnect/reset before headers' },
    groq: { ok: false, code: null },
  }, { checked_at: '2026-10-12T02:55:00Z' }), at), {
    tts: { ok: false, at: checked, code: 'network' }, gemini: { ok: true, at: checked }, groq: { ok: false, at: checked, code: 'other' },
    supabase: { ok: false, at: checked, code: 'other' }, deep: { ok: true, at },
  });
  assert.deepEqual(readDeep(deepBody({}, { ok: false }), at).deep, { ok: false, at, code: 'not_ok' }, 'ok false, none of the four down');
  assert.deepEqual(readDeep('<html>502 Bad Gateway</html>', at), { deep: { ok: false, at, code: 'bad_json' } });
  assert.deepEqual(readDeep('{"ok": true}', at), { deep: { ok: false, at, code: 'bad_json' } }, 'no list of checks');
  for (const stamp of ['2026-10-12T01:00:00Z', '2026-10-12T03:30:00Z', 'yesterday', 1760238000]) {
    assert.equal(readDeep(deepBody({}, { checked_at: stamp }), at).tts?.at, at, `checked_at ${stamp}: the run's time`);
  }
});

test('a timeout counts as a failure: a request aborted by its time limit, and an answer later than 15 s (20 s for deep)', async () => {
  const s = setup();
  s.site.always('/api/health', { kind: 'timeout' });
  await s.tick();
  await s.ticks(1, 5);
  assert.deepEqual(s.texts(), ['Meldy: сайт не отвечает (/api/health: timeout) с 02:50 UTC.']);

  // Slow answers (the fake moves the clock): 16 s is a timeout, 14 s is not.
  const slow = setup();
  slow.site.always('/api/health', { kind: 'slow', ms: 16_000, status: 200 });
  await slow.tick();
  assert.deepEqual(slow.row.checks.health, { fails: 1, since: '2026-10-12T02:50:05.000Z', alerted: null, ok: null, code: 'timeout' });
  assert.equal(slow.row.checks.try.fails, 0, '/try answered in time');
  await slow.ticks(1, 5);
  assert.deepEqual(slow.texts(), ['Meldy: сайт не отвечает (/api/health: timeout) с 02:50 UTC.']);
  slow.site.always('/api/health', { kind: 'slow', ms: 14_000, status: 200 });
  await slow.ticks(1, 5);
  assert.deepEqual(slow.texts().slice(1), ['Meldy: сайт снова отвечает, перерыв 11 мин.'], '02:50:05 to 03:00:37');

  // deep waits up to 20 s: a run that has only deep (its slot was left for lack of budget).
  for (const [ms, code] of [[21_000, 'timeout'], [19_000, null]] as const) {
    const d = setup();
    assert.deepEqual(await d.tick(17_000), { late: 1, checked: 2 }, 'room for 15 s, not for 20');
    d.site.once('/api/health/deep', { kind: 'slow', ms, status: 200 });
    d.clock.advance(MIN);
    const stats = await d.tick();
    assert.deepEqual(d.site.paths(), ['/api/health', '/try', '/api/health/deep']);
    assert.deepEqual(stats, code ? { checked: 1, failed: 1 } : { checked: 5 }, `${ms} ms`);
    assert.equal(d.row.checks.deep.code, code);
  }
});

test('a network error, a 5xx, /try without its index-*.js bundle and a deep answer that is not JSON count as failures', async () => {
  const s = setup();
  s.site.always('/api/health', { kind: 'network' });
  s.site.always('/try', { status: 200, body: '<!DOCTYPE html><html><body>This Space is sleeping</body></html>' });
  s.site.always('/api/health/deep', { status: 503 });
  await s.tick(); // 02:50
  await s.ticks(1, 5); // 02:55
  assert.deepEqual(s.texts(), [
    'Meldy: сайт не отвечает (/api/health: network) с 02:50 UTC.\nMeldy: не открывается пример без входа (/try: no_bundle) с 02:50 UTC.',
  ]);
  await s.ticks(1, 5); // 03:00: deep's second failure
  assert.deepEqual(s.texts().slice(1), ['Meldy: не проходит проверка сервисов (/api/health/deep: 503) с 02:50 UTC.']);
  assert.deepEqual(Object.keys(s.row.checks).sort(), ['deep', 'health', 'try'], 'while deep fails, its four checks are not judged');
  s.site.always('/api/health/deep', { status: 200, body: '<html>Bad Gateway</html>' });
  await s.ticks(6, 5); // 03:30
  assert.equal(s.row.checks.deep.code, 'bad_json');
  assert.equal(s.texts().length, 2);
});

test('nothing secret in a message or a log line: no URL, host, token, key or provider text', async () => {
  const lines: string[] = [];
  const restore = setLogSink((line) => lines.push(line));
  try {
    const s = setup({ site: 'https://meldy-status.example.org' });
    const providerText = 'invalid api key sk-live-0123456789abcdef for https://api.groq.com/openai/v1?key=AIzaSyFAKE';
    s.site.always('/api/health', { kind: 'network' }); // the error's message carries the URL, as Deno's does
    s.site.always('/try', { status: 500, body: `<pre>${providerText}</pre>` });
    s.site.always('/api/health/deep', { status: 200, body: deepBody({
      groq: { ok: false, code: 'permission', detail: providerText, model: 'model-main-x9' },
      gemini: { ok: false, code: providerText, tried: [{ model: 'model-pro-x9', code: 'not_found', detail: providerText }] },
    }) });
    await s.tick();
    await s.ticks(1, 5); // 02:55: /api/health and /try down
    s.tg.fail('sendMessage', { kind: 'network' }); // a failed send is logged: its code only
    await s.ticks(1, 5); // 03:00: gemini and groq down, not sent
    await s.ticks(6, 5); // 03:30: said again
    const texts = s.sent().map((p) => p.text);
    assert.equal(texts.length, 3, 'two sent, one refused');
    assert.equal(s.texts().length, 2);
    assert.ok(s.site.calls.every((c) => c.url.startsWith('https://meldy-status.example.org/')), 'the configured site is asked');
    const secretPart = TEST_TOKEN.split(':')[1];
    for (const text of [...texts, ...lines, JSON.stringify(s.row.checks)]) {
      for (const needle of ['https://', 'meldy-status', 'example.org', 'ludosiel', secretPart, 'sk-live', 'AIza', 'api key', 'model-main-x9', 'model-pro-x9', 'groq.com']) {
        assert.ok(!text.includes(needle), `«${needle}» in ${text}`);
      }
    }
    assert.ok(lines.some((line) => JSON.parse(line).kind === 'monitor' && JSON.parse(line).error_name === 'TelegramError'), 'the failed send is logged by name');
  } finally {
    restore();
  }
  // A site with credentials, a path or plain http is not taken: the bot's own site is asked instead.
  for (const bad of ['https://user:pass@evil.example', 'https://meldy.example.org/api?token=x', 'http://meldy.example.org', 'https://localhost']) {
    const s = setup({ site: bad });
    await s.tick();
    assert.ok(s.site.calls.every((c) => c.url.startsWith(`${W.SITE}/`)), bad);
  }
});

test('a message that did not go out is said by the next run: the alert, and a recovery (with the outage up to its first OK)', async () => {
  const lines: string[] = [];
  const restore = setLogSink((line) => lines.push(line));
  const s = setup();
  try {
    s.site.always('/api/health', { status: 503 });
    await s.tick();
    s.tg.fail('sendMessage', { kind: '5xx', json: true });
    const [unsent] = await s.ticks(1, 5); // 02:55
    assert.deepEqual(unsent, { checked: 2, failed: 1, alerts: 1, unsent: 1 });
    assert.equal(s.row.checks.health.alerted, null, 'not recorded as said');
    assert.deepEqual(lines.map((line) => JSON.parse(line)), [{ route: 'tick', kind: 'monitor', outcome: 'failed', error_name: 'TelegramError', tg_code: 502 }]);
    await s.ticks(1, 5); // 03:00
    assert.deepEqual(s.texts(), ['Meldy: сайт не отвечает (/api/health: 503) с 02:50 UTC.']);
    s.site.restore('/api/health');
    s.tg.fail('sendMessage', { kind: 'network' });
    await s.ticks(1, 5); // 03:05: OK, the recovery does not go out
    assert.deepEqual(s.row.checks.health, { fails: 0, since: '2026-10-12T02:50:05.000Z', alerted: '2026-10-12T03:00:05.000Z',
      ok: '2026-10-12T03:05:05.000Z', code: '503' });
    await s.ticks(1, 5); // 03:10: said now, the outage measured to 03:05
    assert.deepEqual(s.texts().slice(-1), ['Meldy: сайт снова отвечает, перерыв 15 мин.']);
    assert.equal(s.tg.of('sendMessage').length, 4, 'two refused, two sent');
    await s.ticks(3, 5);
    assert.equal(s.texts().length, 2);
  } finally {
    restore();
  }
});

test('two ticks at once: one run, one message (the slot is claimed once)', async () => {
  const s = setup();
  s.site.always('/api/health', { status: 503 });
  await s.tick();
  s.clock.advance(5 * MIN);
  const both = await Promise.all([s.tick(), s.tick()]);
  assert.deepEqual(both.sort((a, b) => Object.keys(a).length - Object.keys(b).length), [{ busy: 1 }, { checked: 2, failed: 1, alerts: 1, sent: 1 }]);
  assert.deepEqual(s.asked('/api/health'), ['02:50', '02:55']);
  assert.equal(s.sent().length, 1);
});

test('the budget: a run starts only when its checks end before the tick\'s deadline; a later tick of the slot takes them', async () => {
  const s = setup();
  assert.deepEqual(await s.tick(10_000), { late: 1 });
  assert.equal(s.fdb.of('bot_monitor_claim').length, 0);
  assert.equal(s.site.calls.length, 0);
  s.clock.advance(MIN);
  assert.deepEqual(await s.tick(), { checked: 7 }, '02:51: the slot of 02:50, now with room');
  assert.deepEqual(s.asked('/api/health'), ['02:51']);
  // Past the deadline after the checks (an answer later than its limit): nothing is sent now; the next run says it.
  s.site.always('/api/health', { kind: 'slow', ms: 16_000, status: 200 });
  s.clock.advance(4 * MIN);
  await s.tick(); // 02:55: the first failure
  s.clock.advance(5 * MIN);
  assert.deepEqual(await s.tick(15_500), { late: 1, checked: 2, failed: 1, alerts: 1, unsent: 1 },
    '03:00: room for the five-minute checks (not for deep); 16 s spent of 15.5');
  assert.equal(s.tg.calls.length, 0);
  s.clock.advance(5 * MIN);
  await s.tick(); // 03:05: said now; deep's slot of 03:00 too
  assert.deepEqual(s.texts(), ['Meldy: сайт не отвечает (/api/health: timeout) с 02:55 UTC.']);
  assert.deepEqual(s.asked('/api/health/deep'), ['02:51', '03:05']);
});

test('the step never throws into the tick: the migration not applied yet, a failing database', async () => {
  const missing = setup({ functions: false });
  assert.deepEqual(await missing.tick(), { missing: 1 });
  assert.equal(missing.site.calls.length, 0);

  const lines: string[] = [];
  const restore = setLogSink((line) => lines.push(line));
  try {
    const s = setup();
    s.fdb.fail('bot_monitor_claim', new DbError('bot_monitor_claim', 503, ''));
    assert.deepEqual(await s.tick(), { error: 1 });
    s.fdb.fail('bot_monitor_save', new DbError('bot_monitor_save', 0, 'timeout'));
    assert.deepEqual(await s.tick(), { error: 1 }, 'the same slot again: its claim had failed');
    assert.deepEqual(lines.map((line) => JSON.parse(line)), [
      { route: 'tick', kind: 'monitor', outcome: 'failed', error_name: 'DbError' },
      { route: 'tick', kind: 'monitor', outcome: 'failed', error_name: 'DbError' },
    ]);
  } finally {
    restore();
  }
});

test('in the tick: after the other steps and before the beat, in the tick\'s numbers; a failing monitor stops nothing', async () => {
  const s = setup();
  const ports = { ...STUBS, monitor: s.monitor };
  const totals = await runTick(s.ctx, ports, { sleep: async () => {} });
  const fns = s.fdb.calls.map((c) => c.fn);
  assert.deepEqual(fns.slice(fns.indexOf('bot_flush_pending')),
    ['bot_flush_pending', 'bot_monitor_state', 'bot_monitor_claim', 'bot_monitor_save', 'bot_tick_beat']);
  assert.equal(totals.monitor_checked, 7);
  assert.equal(s.fdb.beats[0].monitor_checked, 7);
  assert.equal(totals.flush_missing, 1);
  const restore = setLogSink(() => {});
  try {
    s.fdb.fail('bot_monitor_state', new DbError('bot_monitor_state', 500, ''));
    s.clock.advance(5 * MIN);
    const next = await runTick(s.ctx, ports, { sleep: async () => {} });
    assert.equal(next.monitor_error, 1);
    assert.equal(next.flush_missing, 1);
    assert.equal(s.fdb.beats.length, 2, 'the beat is written');
  } finally {
    restore();
  }
});

test('an outage that began on another UTC day names the day', async () => {
  const s = setup({ now: Date.UTC(2026, 9, 11, 23, 55, 5) });
  s.site.always('/api/health', { status: 503 });
  await s.tick();
  await s.ticks(1, 5);
  assert.deepEqual(s.texts(), ['Meldy: сайт не отвечает (/api/health: 503) с 11 октября 23:55 UTC.']);
});

test('every line passes the linter: each check down, still and up, and a message of several lines', () => {
  const now = Date.UTC(2026, 9, 12, 9, 0, 5);
  const since = Date.UTC(2026, 9, 12, 2, 51, 0);
  const said: Say[] = [];
  for (const check of ['health', 'try', 'deep', 'tts', 'gemini', 'groq', 'supabase'] as const) {
    for (const kind of ['down', 'still', 'up'] as const) said.push({ check, kind, since, at: now, code: kind === 'up' ? null : 'http_503' });
  }
  for (const say of said) assert.deepEqual(lintMessage({ text: monitorText([say], now) }), [], `${say.check} ${say.kind}`);
  assert.deepEqual(lintMessage({ text: monitorText(said, now) }), []);
  assert.deepEqual([duration(0), duration(47 * MIN), duration(60 * MIN), duration(64 * MIN + 20_000), duration(26 * 60 * MIN)],
    ['1 мин', '47 мин', '1 ч', '1 ч 4 мин', '26 ч']);
});
