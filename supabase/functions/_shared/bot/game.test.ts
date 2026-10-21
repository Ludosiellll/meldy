// The live game's routes (game.ts; docs/live/CONTRACT.md §9; migration 20261021090000_live_game.sql): /game/join from
// the Mini App (initData as /webapp/session checks it, the player token made here and only its sha256 sent, the
// statuses), /game/post and /game/sync from the database (x-meldy-live, 202 and the work after the response: the post
// with sound, the silent edits, a 429 skipped, the final post once), the texts' stub, and nothing secret in a log line.
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { test } from 'node:test';
import { DbError } from './db.ts';
import {
  createGame, liveTextsStub, newPlayerToken, playUrl, telegramName, toJoinAnswer, toSync, type LiveTexts,
} from './game.ts';
import { createApp, routeOf } from './router.ts';
import { PER_ADDRESS_PER_MINUTE, PER_TELEGRAM_PER_MINUTE, replayKey } from './webapp.ts';
import { LOGS } from './fixtures/harness.ts';
import { fakeDb } from './fixtures/fake_db.ts';
import { fakeTelegram, TEST_FUNCTION_URL, TEST_TOKEN } from './fixtures/fake_telegram.ts';
import { NOW, TG } from './fixtures/scenario.ts';

const SITE = 'https://ludosiel-studyforge.hf.space';
const GAME = 'a9b8c7d6-0000-4000-8000-000000000001';
const PLAYER = 'b9b8c7d6-0000-4000-8000-000000000002';
const EXAM = 'c9b8c7d6-0000-4000-8000-000000000003';
const LIVE = createHmac('sha256', TEST_TOKEN).update('meldy:live:v1').digest('base64url');
const CHAT = -1001234567890;

function signed(fields: Record<string, string>): string {
  const check = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TEST_TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return Object.entries({ ...fields, hash }).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');
}
const launch = (options: { id?: number; secondsAgo?: number; first?: string } = {}) => signed({
  query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
  user: JSON.stringify({ id: options.id ?? TG, first_name: options.first ?? 'Тимур', language_code: 'ru' }),
  auth_date: String(Math.floor(NOW / 1000) - (options.secondsAgo ?? 5)),
  start_param: '482913',
});
const hashOf = (initData: string) => new URLSearchParams(initData).get('hash') as string;

const JOINED = {
  status: 'joined', game_id: GAME, player_id: PLAYER, topic: 'Q2xzAbcdefghijklmnop12', state: 'lobby', rev: 3, now: '2026-10-16T17:00:00.000Z',
  name: 'Тимур', look: { body: 'cloud', colour: 'orange', eyes: 'round', hat: 'phones' }, wardrobe: { unlocked: [], games: 0, wins: 0 },
};

function gameHarness(options: { token?: string; texts?: LiveTexts } = {}) {
  let t = NOW;
  const now = () => t;
  const tg = fakeTelegram({ now });
  const fdb = fakeDb({ now });
  const works: Promise<unknown>[] = [];
  const game = createGame({ token: () => options.token ?? TEST_TOKEN, texts: options.texts ?? liveTextsStub, waitUntil: (w) => works.push(w), now, random: (b) => b.fill(7) });
  const app = createApp({
    token: TEST_TOKEN, fetch: tg.fetch, db: fdb.db, functionUrl: TEST_FUNCTION_URL, waitUntil: () => undefined, now,
    ports: { game }, sleep: async () => undefined, random: () => 0.5,
  });
  async function call(action: string, body: unknown, headers: Record<string, string | null> = {}, method = 'POST') {
    const h: Record<string, string> = { 'content-type': 'application/json', origin: SITE, 'x-forwarded-for': '203.0.113.7' };
    for (const [k, v] of Object.entries(headers)) {
      if (v === null) delete h[k];
      else h[k] = v;
    }
    const init: RequestInit = { method, headers: h };
    if (method !== 'GET' && method !== 'OPTIONS') init.body = typeof body === 'string' ? body : JSON.stringify(body);
    const res = await app(new Request(`${TEST_FUNCTION_URL}/game/${action}`, init));
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }
    return { status: res.status, json, text, headers: res.headers };
  }
  const fromDb = (action: 'post' | 'sync', body: unknown = { game_id: GAME }, secret: string | null = LIVE) =>
    call(action, body, { origin: null, 'x-meldy-live': secret });
  const settle = async () => {
    await Promise.all(works.splice(0));
  };
  return { app, call, fromDb, settle, tg, fdb, works, advance: (ms: number) => { t += ms; } };
}

// ─────────────────────────────────────────── routes ───────────────────────────────────────────

test('routes: /telegram/game/join, /game/post, /game/sync; nothing else under game', () => {
  assert.equal(routeOf(`${TEST_FUNCTION_URL}/game/join`), 'game_join');
  assert.equal(routeOf(`${TEST_FUNCTION_URL}/game/post/`), 'game_post');
  assert.equal(routeOf(`${TEST_FUNCTION_URL}/game/sync?forceFunctionRegion=eu-central-1`), 'game_sync');
  for (const path of ['game', 'game/other', 'game/join/x', 'game/joined']) assert.equal(routeOf(`${TEST_FUNCTION_URL}/${path}`), null, path);
});

// ─────────────────────────────────────────── /game/join ───────────────────────────────────────────

test('join: a checked launch → bot_live_join with the Telegram user, the first name, the token\'s sha256 and the launch\'s replay key', async () => {
  const h = gameHarness();
  h.fdb.on('bot_live_join', () => JOINED);
  const data = launch();
  const look = { body: 'cloud', colour: 'orange', eyes: 'round', hat: 'phones' };
  const r = await h.call('join', { init_data: data, pin: '482913', look });
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('access-control-allow-origin'), SITE);
  assert.equal(r.headers.get('cache-control'), 'no-store');
  const token = r.json.token as string;
  assert.equal(token, newPlayerToken((b) => b.fill(7)));
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  assert.deepEqual({ ...r.json, token: undefined }, { ...JOINED, token: undefined });
  const [sent] = h.fdb.of('bot_live_join').map((c) => c.args as Record<string, unknown>);
  assert.deepEqual(sent, {
    p_pin: '482913', p_tg_user_id: TG, p_name: 'Тимур', p_look: look,
    p_token_hash: createHash('sha256').update(token).digest('hex'),
    p_init_hash: await replayKey(hashOf(data)),
    p_auth_date: new Date((Math.floor(NOW / 1000) - 5) * 1000).toISOString(),
  });
  assert.ok(!JSON.stringify(sent).includes(token), 'the token itself never reaches the database');
});

test('join: a typed name wins (cut to 64 characters for the database to judge); a long Telegram name is cut to 24', async () => {
  const h = gameHarness();
  h.fdb.on('bot_live_join', () => JOINED);
  await h.call('join', { init_data: launch(), pin: '482913', name: '  Тимур Л.  ' });
  await h.call('join', { init_data: launch({ secondsAgo: 6 }), pin: '482913', name: 'Я'.repeat(80) });
  await h.call('join', { init_data: launch({ secondsAgo: 7, first: 'Константин-Александр Великолепный' }), pin: '482913' });
  const names = h.fdb.of('bot_live_join').map((c) => (c.args as Record<string, unknown>).p_name as string);
  assert.deepEqual(names, ['Тимур Л.', 'Я'.repeat(64), 'Константин-Александр Вел']);
  assert.equal(telegramName('user=%7B%22id%22%3A1%7D'), null);
});

test('join: the database\'s statuses pass through, with the reason of a refused name or look', async () => {
  const h = gameHarness();
  const answers = [{ status: 'name_refused', reason: 'rude' }, { status: 'look_refused', reason: 'locked' }, { status: 'replayed' },
    { status: 'members_only' }, { status: 'full' }, { status: 'ended' }, { status: 'kicked' }, { status: 'not_found' }, { status: 'slow_down' }];
  let i = 0;
  h.fdb.on('bot_live_join', () => answers[i++]);
  for (const want of answers) {
    const r = await h.call('join', { init_data: launch({ secondsAgo: 5 + i }), pin: '482913' });
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, want);
  }
  assert.throws(() => toJoinAnswer({ status: 'linked' }));
  assert.throws(() => toJoinAnswer({ status: 'joined', game_id: 'x' }));
});

test('join: bad, stale and foreign launches and a bad PIN never reach the database', async () => {
  const h = gameHarness();
  h.fdb.on('bot_live_join', () => JOINED);
  const data = launch();
  assert.deepEqual((await h.call('join', { init_data: data.replace(/hash=[0-9a-f]{4}/, 'hash=0000'), pin: '482913' })).json, { status: 'invalid' });
  assert.deepEqual((await h.call('join', { init_data: launch({ secondsAgo: 3601 }), pin: '482913' })).json, { status: 'stale' });
  assert.deepEqual((await h.call('join', { pin: '482913' })).json, { status: 'invalid' });
  assert.deepEqual((await h.call('join', { init_data: data, pin: '48291' })).json, { status: 'not_found' });
  assert.deepEqual((await h.call('join', { init_data: data, pin: 482913 })).json, { status: 'not_found' });
  assert.equal(h.fdb.of('bot_live_join').length, 0);
});

test('join: the site only (CORS), POST only, JSON objects up to 8 KB; no Origin is served (the /sb/ way)', async () => {
  const h = gameHarness();
  h.fdb.on('bot_live_join', () => JOINED);
  const pre = await h.call('join', null, {}, 'OPTIONS');
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.equal((await h.call('join', null, { origin: 'https://evil.example' }, 'OPTIONS')).status, 403);
  assert.equal((await h.call('join', { init_data: launch(), pin: '482913' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await h.call('join', null, {}, 'GET')).status, 405);
  assert.equal((await h.call('join', '{"init_data":', {})).status, 400);
  assert.equal((await h.call('join', '[1]', {})).status, 400);
  assert.equal((await h.call('join', { init_data: 'x'.repeat(9000), pin: '482913' })).status, 413);
  const plain = await h.call('join', { init_data: launch(), pin: '482913' }, { origin: null });
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get('access-control-allow-origin'), null);
  assert.equal(h.fdb.of('bot_live_join').length, 1);
});

test('join: 120 a minute per address and 20 signed calls a minute per Telegram user, in memory', async () => {
  const h = gameHarness();
  h.fdb.on('bot_live_join', () => JOINED);
  for (let i = 0; i < PER_TELEGRAM_PER_MINUTE; i += 1) assert.equal((await h.call('join', { init_data: launch({ secondsAgo: 5 + i }), pin: '482913' })).json.status, 'joined');
  assert.deepEqual((await h.call('join', { init_data: launch({ secondsAgo: 30 }), pin: '482913' })).json, { status: 'slow_down' });
  assert.equal(h.fdb.of('bot_live_join').length, PER_TELEGRAM_PER_MINUTE);
  for (let i = PER_TELEGRAM_PER_MINUTE + 1; i < PER_ADDRESS_PER_MINUTE; i += 1) await h.call('join', { pin: '482913' });
  assert.equal((await h.call('join', { pin: '482913' })).status, 429);
  assert.equal((await h.call('join', { pin: '482913' }, { 'x-forwarded-for': '198.51.100.4' })).status, 200);
  h.advance(60_000);
  assert.equal((await h.call('join', { pin: '482913' })).status, 200);
});

test('join: not configured → 503; a failing database → 503 with nothing else said', async () => {
  const none = gameHarness({ token: '' });
  assert.equal((await none.call('join', { init_data: launch(), pin: '482913' })).status, 503);
  const h = gameHarness();
  h.fdb.on('bot_live_join', () => {
    throw new DbError('bot_live_join', 500, 'XX000');
  });
  const r = await h.call('join', { init_data: launch(), pin: '482913' });
  assert.deepEqual([r.status, r.json], [503, { error: 'unavailable' }]);
  h.fdb.on('bot_live_join', () => ({ status: 'joined' }));
  assert.equal((await h.call('join', { init_data: launch({ secondsAgo: 9 }), pin: '482913' })).status, 503);
});

// ─────────────────────────────────────────── /game/post and /game/sync ───────────────────────────────────────────

const POST = { status: 'post', chat_id: CHAT, title: 'Осенняя <сессия>', q_count: 6, host: 'Анна & Co', pin: '482913', players: 3, direct: false };

test('post and sync: only the database\'s signed calls; POST only; a game id; 202 at once', async () => {
  const h = gameHarness();
  h.fdb.on('bot_live_post', () => ({ status: 'skip' }));
  for (const action of ['post', 'sync'] as const) {
    assert.equal((await h.fromDb(action, { game_id: GAME }, null)).status, 401);
    assert.equal((await h.fromDb(action, { game_id: GAME }, createHmac('sha256', TEST_TOKEN).update('meldy:tick:v1').digest('base64url'))).status, 401);
    assert.equal((await h.call(action, null, { 'x-meldy-live': LIVE }, 'GET')).status, 405);
    assert.equal((await h.fromDb(action, { game_id: 'x' })).status, 400);
  }
  assert.equal(h.fdb.of('bot_live_post').length + h.fdb.of('bot_live_sync').length, 0);
  assert.equal((await h.fromDb('post')).status, 202);
  await h.settle();
  assert.deepEqual(h.fdb.of('bot_live_post').map((c) => c.args), [{ p_game: GAME }]);
  assert.equal(h.tg.calls.length, 0, 'skip: nothing sent');
  assert.equal((await gameHarness({ token: '' }).fromDb('sync')).status, 503);
});

test('post: the post with sound, protected, no preview, the «Играть» button; then its message id to the database', async () => {
  const h = gameHarness();
  h.fdb.on('bot_live_post', () => POST);
  h.fdb.on('bot_live_posted', () => ({ status: 'ok' }));
  assert.equal((await h.fromDb('post')).status, 202);
  await h.settle();
  const [msg] = h.tg.of('sendMessage');
  assert.equal(msg.params.chat_id, CHAT);
  assert.equal(msg.params.disable_notification, false);
  assert.equal(msg.params.protect_content, true);
  assert.equal(msg.params.parse_mode, 'HTML');
  assert.deepEqual(msg.params.link_preview_options, { is_disabled: true });
  assert.equal(msg.params.text, '<b>Игра по тесту «Осенняя &lt;сессия&gt;»</b>\nБитва с монстром · 6 вопросов\nВедёт Анна &amp; Co · PIN 482913\nИграют 3');
  assert.deepEqual(msg.params.reply_markup, { inline_keyboard: [[{ text: 'Играть', url: 'https://t.me/Meldyteach_bot?start=play_482913', style: 'primary' }]] });
  assert.deepEqual(h.fdb.of('bot_live_posted').map((c) => c.args), [{ p_game: GAME, p_chat_id: CHAT, p_message_id: 1000 }]);
});

test('post: Telegram refuses (the bot left the group) → logged, no message id saved', async () => {
  const h = gameHarness();
  h.fdb.on('bot_live_post', () => POST);
  h.tg.fail('sendMessage', { kind: '403', description: 'Forbidden: bot was kicked from the supergroup chat' });
  const start = LOGS.length;
  await h.fromDb('post');
  await h.settle();
  assert.equal(h.fdb.of('bot_live_posted').length, 0);
  assert.ok(LOGS.slice(start).some((l) => l.includes('"kind":"post"') && l.includes('"outcome":"failed"') && l.includes('"tg_code":403')));
});

const SYNC = { status: 'edit', chat_id: CHAT, message_id: 555, state: 'countdown', players: 24, qi: 1, q_count: 6, hp_pct: 63, title: 'Осень', pin: '482913', host: null, direct: true, final: null };

test('sync: a silent edit of the same message — question i of n and the boss\'s HP; the lobby; the end without a keyboard', async () => {
  const h = gameHarness();
  let answer: Record<string, unknown> = SYNC;
  h.fdb.on('bot_live_sync', () => answer);
  await h.fromDb('sync');
  await h.settle();
  let [e] = h.tg.of('editMessageText');
  assert.deepEqual([e.params.chat_id, e.params.message_id], [CHAT, 555]);
  assert.equal(e.params.text, '<b>Игра по тесту «Осень»</b>\nБитва с монстром · 6 вопросов\nPIN 482913\nИдёт игра · вопрос 2 из 6\nИграют 24 · у Дедлайна 63 %');
  assert.deepEqual(e.params.reply_markup.inline_keyboard[0][0].url, 'https://t.me/Meldyteach_bot/play?startapp=482913');
  assert.equal(h.tg.of('sendMessage').length, 0);
  answer = { ...SYNC, state: 'lobby', qi: -1, hp_pct: null, players: 7 };
  await h.fromDb('sync');
  await h.settle();
  e = h.tg.of('editMessageText')[1];
  assert.ok(e.params.text.endsWith('\nИграют 7'));
  answer = { ...SYNC, state: 'ended' };
  await h.fromDb('sync');
  await h.settle();
  e = h.tg.of('editMessageText')[2];
  assert.ok(e.params.text.endsWith('\nИгра закончилась'));
  assert.equal(e.params.reply_markup, undefined, 'the keyboard goes');
});

test('sync: a 429 skips that edit at once (no wait); a gone message is left alone; skip sends nothing', async () => {
  const h = gameHarness();
  let answer: Record<string, unknown> = SYNC;
  h.fdb.on('bot_live_sync', () => answer);
  h.tg.fail('editMessageText', { kind: '429', retryAfter: 2 });
  const start = LOGS.length;
  await h.fromDb('sync');
  await h.settle();
  assert.equal(h.tg.of('editMessageText').length, 1, 'tried once, not again after the retry_after');
  assert.ok(LOGS.slice(start).some((l) => l.includes('"kind":"edit"') && l.includes('"outcome":"rate_limited"')));
  h.tg.fail('editMessageText', { kind: '400', description: 'Bad Request: message to edit not found' });
  await h.fromDb('sync');
  await h.settle();
  assert.equal(h.tg.of('sendMessage').length, 0);
  answer = { status: 'skip' };
  await h.fromDb('sync');
  await h.settle();
  assert.equal(h.tg.of('editMessageText').length, 2);
});

test('sync at the podium: the end edit and, once, the final post (silent) with the top three and the two buttons', async () => {
  const h = gameHarness();
  h.fdb.on('bot_live_sync', () => ({
    ...SYNC, state: 'podium', qi: 5,
    final: { won: true, top: [{ name: 'Дима <3', dmg: 724 }, { name: 'Лена', dmg: 610 }, { name: 'Артём', dmg: 590 }], accuracy_pct: 69, game_id: GAME, container_id: EXAM },
  }));
  await h.fromDb('sync');
  await h.settle();
  assert.ok(h.tg.of('editMessageText')[0].params.text.endsWith('Игра закончилась'));
  const [fin] = h.tg.of('sendMessage');
  assert.equal(fin.params.disable_notification, true);
  assert.equal(fin.params.protect_content, true);
  assert.equal(fin.params.text, '<b>Дедлайн повержен</b>\n1. Дима &lt;3 — 724\n2. Лена — 610\n3. Артём — 590\nВерных ответов 69 %. Свой разбор — у каждого в игре.');
  assert.deepEqual(fin.params.reply_markup.inline_keyboard, [[
    { text: 'Разбор', url: `https://t.me/Meldyteach_bot/play?startapp=r_${GAME.replace(/-/g, '')}` },
    { text: 'Ещё игра', url: `${SITE}/exams/c/${EXAM}` },
  ]]);
});

test('sync answers: a bad shape throws (logged), the final needs real ids; names off → no top', () => {
  assert.throws(() => toSync({ status: 'edit', chat_id: CHAT }));
  assert.throws(() => toSync({ ...SYNC, final: { won: true, top: null, accuracy_pct: 1, game_id: 'x', container_id: EXAM } }));
  const s = toSync({ ...SYNC, state: 'podium', final: { won: false, top: null, accuracy_pct: 40, game_id: GAME, container_id: EXAM } });
  assert.ok(s && s.final && s.final.top === null);
  assert.equal(liveTextsStub.final(s!.final!, { site: SITE, bot: 'Meldyteach_bot' }).text, '<b>Дедлайн победил</b>\nВерных ответов 40 %. Свой разбор — у каждого в игре.');
  assert.equal(toSync({ status: 'skip' }), null);
  assert.equal(playUrl({ site: SITE, bot: 'Meldyteach_bot' }, '100200', true), 'https://t.me/Meldyteach_bot/play?startapp=100200');
});

test('nothing secret in a log line or an answer: the bot token, the live secret, initData, the player token', async () => {
  const h = gameHarness();
  h.fdb.on('bot_live_join', () => JOINED);
  h.fdb.on('bot_live_post', () => POST);
  h.fdb.on('bot_live_posted', () => ({ status: 'ok' }));
  h.fdb.on('bot_live_sync', () => SYNC);
  const start = LOGS.length;
  const data = launch();
  const texts: string[] = [];
  const joined = await h.call('join', { init_data: data, pin: '482913' });
  texts.push((await h.fromDb('post')).text, (await h.fromDb('sync')).text, (await h.fromDb('sync', { game_id: GAME }, 'wrong')).text);
  h.tg.fail('sendMessage', { kind: 'network' });
  await h.fromDb('post');
  await h.settle();
  const logs = LOGS.slice(start);
  assert.ok(logs.length >= 4, `${logs.length} log lines`);
  for (const line of [...logs, ...texts]) {
    for (const secret of [TEST_TOKEN.split(':')[1], LIVE, hashOf(data), joined.json.token as string, 'Тимур', String(TG), GAME]) {
      assert.ok(!line.includes(secret), line);
    }
  }
});

test('the facts carry the mode of a stand game (migration 20261023090000); a battle\'s stay as they were', () => {
  const s = toSync({ ...SYNC, mode: 'stand', state: 'podium', final: { won: false, top: null, accuracy_pct: 40, game_id: GAME, container_id: EXAM, mode: 'stand' } });
  assert.equal(s?.now.mode, 'stand');
  assert.equal(s?.final?.mode, 'stand');
  const battle = toSync(SYNC);
  assert.ok(battle && !('mode' in battle.now));
});
