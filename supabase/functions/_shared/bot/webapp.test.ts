// The Mini App's sign-in (webapp.ts; meldy-notes 10_Project/Telegram_Mini_App_Spec_2026-10-10.md §3, §4, §7):
// Telegram's initData check against a reference HMAC written here with node:crypto from the docs' recipe (valid,
// tampered, stale, from the future, replayed, another bot's), both routes through createApp with a fake database that
// keeps bot_webapp_session / bot_webapp_link's rules, the Auth admin client's requests, CORS, the limits, and the
// rule that no token, initData, JWT, e-mail or id reaches a log line or an error.
import assert from 'node:assert/strict';
import { createHash, createHmac } from 'node:crypto';
import { test } from 'node:test';
import { DbError } from './db.ts';
import { createApp, routeOf } from './router.ts';
import {
  AuthError, BODY_MAX, checkInitData, createAuthAdmin, createWebApp, dataCheckString, MAX_AGE_SEC, PER_ADDRESS_PER_MINUTE,
  PER_TELEGRAM_PER_MINUTE, replayKey, type AuthAdmin,
} from './webapp.ts';
import { LOGS } from './fixtures/harness.ts';
import { fakeDb } from './fixtures/fake_db.ts';
import { fakeTelegram, TEST_FUNCTION_URL, TEST_TOKEN } from './fixtures/fake_telegram.ts';
import { AUTUMN, NOW, TG, USER, wireOf } from './fixtures/scenario.ts';

const SITE = 'https://ludosiel-studyforge.hf.space';
const OTHER_USER = 'd1d2d3d4-0000-4000-8000-000000000002';
const OTHER_TG = 700200;
const JWT_OK = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyIn0.c2lnbmF0dXJlLW9r';
const JWT_OTHER = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJvdGhlciJ9.c2lnbmF0dXJlLW90';
const JWT_SIGNED_OUT = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJnb25lIn0.c2lnbmF0dXJlLWdv';
const EMAIL = 'student@example.test';
const HASHED = 'b'.repeat(56);
const HOUR = 3_600_000;

// ─────────────────────────────────────────── the reference signer (Telegram's docs, node:crypto) ───────────────────────────────────────────

/** initData as Telegram builds it: the fields URL-encoded, `hash` = hex(HMAC(HMAC("WebAppData", token), data-check-string)). */
function signed(fields: Record<string, string>, options: { token?: string; order?: string[] } = {}): string {
  const token = options.token ?? TEST_TOKEN;
  const check = Object.entries(fields).map(([k, v]) => `${k}=${v}`).sort().join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  const all: Record<string, string> = { ...fields, hash };
  const keys = options.order ?? Object.keys(all);
  return keys.map((k) => `${encodeURIComponent(k)}=${encodeURIComponent(all[k])}`).join('&');
}

const userJson = (id = TG, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ id, first_name: 'Студент', language_code: 'ru', allows_write_to_pm: true, ...extra });

/** A launch from the menu button, `secondsAgo` before NOW, with Bot API 8.0's `signature` field. */
function launch(options: { id?: number; secondsAgo?: number; at?: number; user?: string; extra?: Record<string, string>; token?: string } = {}) {
  const authDate = options.at ?? Math.floor(NOW / 1000) - (options.secondsAgo ?? 5);
  return signed({
    query_id: 'AAHdF6IQAAAAAN0XohDhrOrc',
    user: options.user ?? userJson(options.id ?? TG),
    auth_date: String(authDate),
    signature: 'c2lnbmF0dXJlLW9mLXRoZS1kYXRhLWZvci10aGlyZC1wYXJ0aWVz',
    ...(options.extra ?? {}),
  }, { token: options.token });
}

const hashOf = (initData: string) => new URLSearchParams(initData).get('hash') as string;

// ─────────────────────────────────────────── initData ───────────────────────────────────────────

test('a valid initData: the user, the language, write access and start_param', async () => {
  const data = launch({ extra: { start_param: 'a1b2c3d4-0000-4000-8000-000000000001', chat_type: 'sender', chat_instance: '-8410348' } });
  const check = await checkInitData(data, TEST_TOKEN, NOW);
  assert.ok(check.ok, JSON.stringify(check));
  assert.deepEqual(check.data.user, { id: TG, languageCode: 'ru', allowsWriteToPm: true });
  assert.equal(check.data.startParam, 'a1b2c3d4-0000-4000-8000-000000000001');
  assert.equal(check.data.authDate, Math.floor(NOW / 1000) - 5);
  assert.equal(check.data.hash, hashOf(data));
});

test('the data-check-string: every field but hash, `key=value`, sorted, joined by a line feed; signature stays in', () => {
  assert.equal(
    dataCheckString([['user', '{"id":1}'], ['hash', 'x'], ['auth_date', '1'], ['signature', 's'], ['query_id', 'q']]),
    'auth_date=1\nquery_id=q\nsignature=s\nuser={"id":1}',
  );
});

test('tampered: a field, the hash, the signature, another bot\'s token, an upper-case hash', async () => {
  const data = launch();
  const params = new URLSearchParams(data);
  const changed = (key: string, value: string) => {
    const copy = new URLSearchParams(params);
    copy.set(key, value);
    return copy.toString();
  };
  // Another user id under the same hash: the HMAC no longer matches.
  assert.deepEqual(await checkInitData(changed('user', userJson(OTHER_TG)), TEST_TOKEN, NOW), { ok: false, reason: 'bad_hash' });
  const hash = hashOf(data);
  const flipped = `${hash.slice(0, -1)}${hash.endsWith('0') ? '1' : '0'}`;
  assert.deepEqual(await checkInitData(changed('hash', flipped), TEST_TOKEN, NOW), { ok: false, reason: 'bad_hash' });
  assert.deepEqual(await checkInitData(changed('signature', 'b3RoZXI'), TEST_TOKEN, NOW), { ok: false, reason: 'bad_hash' });
  assert.deepEqual(await checkInitData(changed('auth_date', String(Math.floor(NOW / 1000))), TEST_TOKEN, NOW), { ok: false, reason: 'bad_hash' });
  assert.deepEqual(await checkInitData(launch({ token: '999999:ANOTHER_BOT_TOKEN_xxxxxxxxxxxxxxxxxxxxx' }), TEST_TOKEN, NOW), { ok: false, reason: 'bad_hash' });
  assert.deepEqual(await checkInitData(changed('hash', hash.toUpperCase()), TEST_TOKEN, NOW), { ok: false, reason: 'bad_hash' });
  // A field added after signing.
  assert.deepEqual(await checkInitData(`${data}&start_param=evil`, TEST_TOKEN, NOW), { ok: false, reason: 'bad_hash' });
});

test('malformed: empty, too long, no hash, a repeated key, no user, a bot, a broken id', async () => {
  assert.deepEqual(await checkInitData('', TEST_TOKEN, NOW), { ok: false, reason: 'empty' });
  assert.deepEqual(await checkInitData(undefined, TEST_TOKEN, NOW), { ok: false, reason: 'empty' });
  assert.deepEqual(await checkInitData(`${launch()}&x=${'a'.repeat(5000)}`, TEST_TOKEN, NOW), { ok: false, reason: 'too_long' });
  const noHash = launch().replace(/&?hash=[0-9a-f]{64}/, '');
  assert.deepEqual(await checkInitData(noHash, TEST_TOKEN, NOW), { ok: false, reason: 'no_hash' });
  assert.deepEqual(await checkInitData(`${launch()}&auth_date=1`, TEST_TOKEN, NOW), { ok: false, reason: 'malformed' });
  const at = String(Math.floor(NOW / 1000));
  assert.deepEqual(await checkInitData(signed({ auth_date: at }), TEST_TOKEN, NOW), { ok: false, reason: 'no_user' });
  assert.deepEqual(await checkInitData(signed({ auth_date: at, user: 'not json' }), TEST_TOKEN, NOW), { ok: false, reason: 'no_user' });
  assert.deepEqual(await checkInitData(signed({ auth_date: at, user: '{"id":"700100"}' }), TEST_TOKEN, NOW), { ok: false, reason: 'no_user' });
  assert.deepEqual(await checkInitData(signed({ auth_date: at, user: '{"id":1.5}' }), TEST_TOKEN, NOW), { ok: false, reason: 'no_user' });
  assert.deepEqual(await checkInitData(signed({ auth_date: at, user: '{"id":5,"is_bot":true}' }), TEST_TOKEN, NOW), { ok: false, reason: 'no_user' });
  assert.deepEqual(await checkInitData(signed({ auth_date: 'yesterday', user: userJson() }), TEST_TOKEN, NOW), { ok: false, reason: 'malformed' });
  await assert.rejects(() => checkInitData(launch(), '', NOW), /no bot token/);
});

test('stale and future: an hour old at most, a minute ahead at most (signed data only)', async () => {
  assert.equal((await checkInitData(launch({ secondsAgo: MAX_AGE_SEC }), TEST_TOKEN, NOW)).ok, true);
  assert.deepEqual(await checkInitData(launch({ secondsAgo: MAX_AGE_SEC + 1 }), TEST_TOKEN, NOW), { ok: false, reason: 'stale' });
  assert.deepEqual(await checkInitData(launch({ secondsAgo: 30 * 86_400 }), TEST_TOKEN, NOW), { ok: false, reason: 'stale' });
  assert.equal((await checkInitData(launch({ secondsAgo: -60 }), TEST_TOKEN, NOW)).ok, true);
  assert.deepEqual(await checkInitData(launch({ secondsAgo: -61 }), TEST_TOKEN, NOW), { ok: false, reason: 'future' });
  // An old date under a forged hash is «bad_hash», not «stale»: nothing of unsigned data is judged.
  const forged = new URLSearchParams(launch({ secondsAgo: MAX_AGE_SEC + 100 }));
  forged.set('hash', '0'.repeat(64));
  assert.deepEqual(await checkInitData(forged.toString(), TEST_TOKEN, NOW), { ok: false, reason: 'bad_hash' });
});

test('the order of the fields and «+» for a space do not change the check or the replay key', async () => {
  const fields = { auth_date: String(Math.floor(NOW / 1000)), user: userJson(TG, { first_name: 'Анна Мария' }), query_id: 'Q1' };
  const a = signed(fields, { order: ['auth_date', 'user', 'query_id', 'hash'] });
  const b = signed(fields, { order: ['hash', 'query_id', 'user', 'auth_date'] });
  const ca = await checkInitData(a, TEST_TOKEN, NOW);
  const cb = await checkInitData(b, TEST_TOKEN, NOW);
  assert.ok(ca.ok && cb.ok);
  assert.equal(await replayKey(ca.data.hash), await replayKey(cb.data.hash));
  assert.equal((await checkInitData(a.replace(/%20/g, '+'), TEST_TOKEN, NOW)).ok, true);
  const key = await replayKey(ca.data.hash);
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.equal(key, createHash('sha256').update(ca.data.hash).digest('hex'));
  assert.notEqual(key, ca.data.hash);
});

// ─────────────────────────────────────────── the routes, with a fake database ───────────────────────────────────────────

interface Use { tg: number; userId: string | null; at: number }

/** bot_webapp_session / bot_webapp_link as the migration has them (20261010150000_telegram_webapp.sql). */
function installWebappDb(fdb: ReturnType<typeof fakeDb>, now: () => number, emails: Map<string, string>) {
  const uses = new Map<string, Use>();
  const active = (tg: number) => fdb.links.find((l) => l.unlinkedAt === null && l.tgUserId === tg) ?? null;
  const activeOfUser = (user: string) => fdb.links.find((l) => l.unlinkedAt === null && l.userId === user) ?? null;
  const count = (purpose: string, pick: (u: Use) => boolean) =>
    [...uses.entries()].filter(([k, u]) => k.endsWith(`|${purpose}`) && pick(u) && u.at > now() - HOUR).length;
  fdb.on('bot_webapp_session', (args) => {
    const tg = Number(args.p_tg_user_id);
    const hash = String(args.p_init_hash);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.ok(!Number.isNaN(Date.parse(String(args.p_auth_date))));
    if (count('session', (u) => u.tg === tg) >= 30) return { status: 'slow_down' };
    const key = `${hash}|session`;
    if (uses.has(key)) return { status: 'replayed' };
    uses.set(key, { tg, userId: null, at: now() });
    const link = active(tg);
    if (!link) return { status: 'unlinked' };
    const email = emails.get(link.userId);
    return email ? { status: 'linked', user_id: link.userId, email } : { status: 'no_email' };
  });
  fdb.on('bot_webapp_link', (args) => {
    const tg = Number(args.p_tg_user_id);
    const user = String(args.p_user_id);
    const key = `${String(args.p_init_hash)}|link`;
    if (count('link', (u) => u.tg === tg) >= 10 || count('link', (u) => u.userId === user) >= 10) return { status: 'slow_down' };
    const earlier = uses.get(key);
    if (earlier) {
      const same = active(tg);
      return earlier.userId === user && same && same.userId === user ? { status: 'linked', again: true, replaced_chat_id: null } : { status: 'replayed' };
    }
    uses.set(key, { tg, userId: user, at: now() });
    const theirs = active(tg);
    if (theirs && theirs.userId !== user) return { status: 'linked_elsewhere' };
    if (theirs) return { status: 'linked', again: true, replaced_chat_id: null };
    const mine = activeOfUser(user);
    let replaced: number | null = null;
    if (mine) {
      mine.unlinkedAt = now();
      replaced = mine.chatId;
    }
    fdb.addLink({ userId: user, tgUserId: tg, tz: typeof args.p_tz === 'string' ? args.p_tz : 'Europe/Minsk' });
    return { status: 'linked', again: false, replaced_chat_id: replaced };
  });
  return uses;
}

function fakeAuth() {
  const minted: string[] = [];
  const checked: string[] = [];
  const failures: { mint: Error | null; user: Error | null } = { mint: null, user: null };
  const tokens = new Map<string, string>([[JWT_OK, USER], [JWT_OTHER, OTHER_USER]]);
  const auth: AuthAdmin = {
    async magicLinkHash(email) {
      if (failures.mint) throw failures.mint;
      minted.push(email);
      return HASHED;
    },
    async userOfToken(jwt) {
      checked.push(jwt);
      if (failures.user) throw failures.user;
      const id = tokens.get(jwt);
      return id ? { id } : null;
    },
  };
  return { auth, minted, checked, failures };
}

function webHarness(options: { token?: string; auth?: 'none' } = {}) {
  let t = NOW;
  const now = () => t;
  const tg = fakeTelegram({ now });
  const fdb = fakeDb({ now });
  const emails = new Map<string, string>([[USER, EMAIL], [OTHER_USER, 'other@example.test']]);
  const uses = installWebappDb(fdb, now, emails);
  const fa = fakeAuth();
  const webapp = createWebApp({ token: () => options.token ?? TEST_TOKEN, auth: options.auth === 'none' ? null : fa.auth, now });
  const app = createApp({
    token: TEST_TOKEN, fetch: tg.fetch, db: fdb.db, functionUrl: TEST_FUNCTION_URL, waitUntil: () => undefined, now,
    ports: { webapp }, sleep: async () => undefined, random: () => 0.5,
  });
  async function call(action: 'session' | 'link', body: unknown, headers: Record<string, string | null> = {}): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
    const h: Record<string, string> = { 'content-type': 'application/json', origin: SITE, 'x-forwarded-for': '203.0.113.7' };
    for (const [k, v] of Object.entries(headers)) {
      if (v === null) delete h[k];
      else h[k] = v;
    }
    const res = await app(new Request(`${TEST_FUNCTION_URL}/webapp/${action}`, { method: 'POST', headers: h, body: typeof body === 'string' ? body : JSON.stringify(body) }));
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = {};
    }
    return { status: res.status, json, text };
  }
  function linked(user = USER, tgUserId = TG) {
    const row = fdb.addLink({ userId: user, tgUserId });
    fdb.setUser(user, { wire: wireOf([AUTUMN], t), exams: [{ id: AUTUMN.id, createdAt: '2026-10-01T10:00:00Z' }] });
    return row;
  }
  return { app, call, tg, fdb, fa, uses, emails, linked, advance: (ms: number) => { t += ms; }, get now() { return t; } };
}

test('routes: /telegram/webapp/session and /webapp/link, nothing else under webapp', () => {
  assert.equal(routeOf(`${TEST_FUNCTION_URL}/webapp/session`), 'webapp_session');
  assert.equal(routeOf(`${TEST_FUNCTION_URL}/webapp/link/`), 'webapp_link');
  assert.equal(routeOf('https://x.supabase.co/telegram/webapp/session?forceFunctionRegion=eu-central-1'), 'webapp_session');
  assert.equal(routeOf(`${TEST_FUNCTION_URL}/webapp`), null);
  assert.equal(routeOf(`${TEST_FUNCTION_URL}/webapp/other`), null);
});

test('session, unlinked Telegram: «unlinked», one use stored by sha256(hash), no sign-in minted', async () => {
  const h = webHarness();
  const data = launch();
  const r = await h.call('session', { init_data: data });
  assert.deepEqual([r.status, r.json], [200, { status: 'unlinked' }]);
  const rpc = h.fdb.of('bot_webapp_session');
  assert.equal(rpc.length, 1);
  const args = rpc[0].args as Record<string, unknown>;
  assert.equal(args.p_tg_user_id, TG);
  assert.equal(args.p_init_hash, createHash('sha256').update(hashOf(data)).digest('hex'));
  assert.notEqual(args.p_init_hash, hashOf(data));
  assert.equal(args.p_auth_date, new Date((Math.floor(NOW / 1000) - 5) * 1000).toISOString());
  assert.deepEqual(h.fa.minted, []);
});

test('session, linked: a one-time token_hash for verifyOtp; only that leaves the function', async () => {
  const h = webHarness();
  h.linked();
  const r = await h.call('session', { init_data: launch() });
  assert.deepEqual([r.status, r.json], [200, { status: 'linked', token_hash: HASHED }]);
  assert.deepEqual(h.fa.minted, [EMAIL]);
  assert.ok(!r.text.includes(EMAIL) && !r.text.includes(USER) && !r.text.includes(String(TG)));
});

test('session, linked and already signed in as that account here: nothing is minted', async () => {
  const h = webHarness();
  h.linked();
  const same = await h.call('session', { init_data: launch({ secondsAgo: 9 }), have: USER.toUpperCase() });
  assert.deepEqual(same.json, { status: 'linked', same: true });
  const other = await h.call('session', { init_data: launch({ secondsAgo: 8 }), have: OTHER_USER });
  assert.deepEqual(other.json, { status: 'linked', token_hash: HASHED });
  const junk = await h.call('session', { init_data: launch({ secondsAgo: 7 }), have: 'not-a-uuid' });
  assert.deepEqual(junk.json, { status: 'linked', token_hash: HASHED });
  assert.equal(h.fa.minted.length, 2);
});

test('session, replayed: the same initData a second time — even reordered — gets «replayed» and no second token', async () => {
  const h = webHarness();
  h.linked();
  const data = launch();
  assert.equal((await h.call('session', { init_data: data })).json.status, 'linked');
  assert.deepEqual((await h.call('session', { init_data: data })).json, { status: 'replayed' });
  const reordered = new URLSearchParams([...new URLSearchParams(data)].reverse()).toString();
  assert.deepEqual((await h.call('session', { init_data: reordered })).json, { status: 'replayed' });
  assert.equal(h.fa.minted.length, 1);
  // A new launch (new auth_date, new hash) is a new use.
  assert.equal((await h.call('session', { init_data: launch({ secondsAgo: 2 }) })).json.status, 'linked');
});

test('session: stale, from the future and tampered data never reach the database', async () => {
  const h = webHarness();
  h.linked();
  assert.deepEqual((await h.call('session', { init_data: launch({ secondsAgo: 3601 }) })).json, { status: 'stale' });
  assert.deepEqual((await h.call('session', { init_data: launch({ secondsAgo: -120 }) })).json, { status: 'stale' });
  const tampered = new URLSearchParams(launch());
  tampered.set('user', userJson(OTHER_TG));
  assert.deepEqual((await h.call('session', { init_data: tampered.toString() })).json, { status: 'invalid' });
  assert.deepEqual((await h.call('session', { init_data: 42 })).json, { status: 'invalid' });
  assert.deepEqual((await h.call('session', {})).json, { status: 'invalid' });
  assert.equal(h.fdb.of('bot_webapp_session').length, 0);
  assert.deepEqual(h.fa.minted, []);
});

test('session: the database\'s brake (slow_down), an account without e-mail, Auth down', async () => {
  const h = webHarness();
  h.linked();
  for (let i = 0; i < 30; i += 1) h.uses.set(`${String(i).padStart(64, '0')}|session`, { tg: TG, userId: null, at: h.now - 60_000 });
  assert.deepEqual((await h.call('session', { init_data: launch() })).json, { status: 'slow_down' });

  const e = webHarness();
  e.linked();
  e.emails.delete(USER);
  assert.deepEqual((await e.call('session', { init_data: launch() })).json, { status: 'unavailable' });

  const a = webHarness();
  a.linked();
  a.fa.failures.mint = new AuthError(500);
  const start = LOGS.length;
  assert.deepEqual((await a.call('session', { init_data: launch() })).json, { status: 'unavailable' });
  assert.ok(LOGS.slice(start).some((line) => line.includes('"kind":"magic_link"') && line.includes('AuthError')));
});

test('link: a signed-in account and a valid initData → linked, the zone from the browser, M2 in the chat', async () => {
  const h = webHarness();
  h.fdb.setUser(USER, { wire: wireOf([AUTUMN], NOW), exams: [{ id: AUTUMN.id, createdAt: '2026-10-01T10:00:00Z' }] });
  const r = await h.call('link', { init_data: launch(), tz: 'Europe/Moscow' }, { authorization: `Bearer ${JWT_OK}` });
  assert.deepEqual([r.status, r.json], [200, { status: 'linked' }]);
  assert.deepEqual(h.fa.checked, [JWT_OK]);
  const row = h.fdb.links.find((l) => l.unlinkedAt === null && l.tgUserId === TG);
  assert.ok(row);
  assert.equal(row.userId, USER);
  assert.equal(row.chatId, TG);
  assert.equal(row.tz, 'Europe/Moscow');
  const args = h.fdb.of('bot_webapp_link')[0].args as Record<string, unknown>;
  assert.deepEqual([args.p_user_id, args.p_lang, args.p_tz], [USER, 'ru', 'Europe/Moscow']);
  const sent = h.tg.of('sendMessage');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].params.chat_id, TG);
  assert.ok(String(sent[0].params.text).replace(/\u00a0/g, ' ').startsWith('<b>Telegram подключён к Meldy.</b>'));
  assert.equal(sent[0].params.protect_content, true);
});

test('link: Telegram does not let the bot write first → linked, no message; the account\'s old Telegram gets M6', async () => {
  const h = webHarness();
  h.linked(USER, OTHER_TG);
  const quiet = launch({ user: userJson(TG, { allows_write_to_pm: false }) });
  const r = await h.call('link', { init_data: quiet }, { authorization: `Bearer ${JWT_OK}` });
  assert.equal(r.json.status, 'linked');
  const sent = h.tg.of('sendMessage');
  assert.deepEqual(sent.map((c) => c.params.chat_id), [OTHER_TG]);
  assert.ok(String(sent[0].params.text).replace(/\u00a0/g, ' ').includes('Meldy подключили к другому Telegram'));
  assert.ok(h.fdb.links.find((l) => l.tgUserId === OTHER_TG)!.unlinkedAt !== null);
});

test('link: no JWT, a broken one, a signed-out one → «signed_out» before the database', async () => {
  const h = webHarness();
  assert.deepEqual((await h.call('link', { init_data: launch() })).json, { status: 'signed_out' });
  assert.deepEqual((await h.call('link', { init_data: launch() }, { authorization: 'Bearer not-a-jwt' })).json, { status: 'signed_out' });
  assert.deepEqual((await h.call('link', { init_data: launch() }, { authorization: `Bearer ${JWT_SIGNED_OUT}` })).json, { status: 'signed_out' });
  assert.equal(h.fdb.of('bot_webapp_link').length, 0);
  h.fa.failures.user = new AuthError(0, 'network');
  assert.deepEqual((await h.call('link', { init_data: launch() }, { authorization: `Bearer ${JWT_OK}` })).json, { status: 'unavailable' });
});

test('link: a Telegram already linked to another account is not taken over («linked_elsewhere»)', async () => {
  const h = webHarness();
  h.linked(OTHER_USER, TG);
  const r = await h.call('link', { init_data: launch() }, { authorization: `Bearer ${JWT_OK}` });
  assert.deepEqual(r.json, { status: 'linked_elsewhere' });
  assert.equal(h.fdb.links.filter((l) => l.unlinkedAt === null && l.tgUserId === TG)[0].userId, OTHER_USER);
  assert.equal(h.tg.of('sendMessage').length, 0);
});

test('link, replayed: the same pair again is «linked» without a second M2; another account with that initData is refused', async () => {
  const h = webHarness();
  const data = launch();
  assert.equal((await h.call('link', { init_data: data }, { authorization: `Bearer ${JWT_OK}` })).json.status, 'linked');
  assert.equal((await h.call('link', { init_data: data }, { authorization: `Bearer ${JWT_OK}` })).json.status, 'linked');
  assert.deepEqual((await h.call('link', { init_data: data }, { authorization: `Bearer ${JWT_OTHER}` })).json, { status: 'replayed' });
  assert.equal(h.tg.of('sendMessage').length, 1);
  assert.equal(h.fdb.links.filter((l) => l.unlinkedAt === null && l.tgUserId === TG)[0].userId, USER);
});

test('link: stale and tampered initData are refused before Auth is asked', async () => {
  const h = webHarness();
  assert.deepEqual((await h.call('link', { init_data: launch({ secondsAgo: 4000 }) }, { authorization: `Bearer ${JWT_OK}` })).json, { status: 'stale' });
  const tampered = new URLSearchParams(launch());
  tampered.set('auth_date', String(Math.floor(NOW / 1000)));
  assert.deepEqual((await h.call('link', { init_data: tampered.toString() }, { authorization: `Bearer ${JWT_OK}` })).json, { status: 'invalid' });
  assert.deepEqual(h.fa.checked, []);
});

test('the site only: CORS for its origin, a preflight, 403 for another origin before anything, no Origin served', async () => {
  const h = webHarness();
  const pre = await h.app(new Request(`${TEST_FUNCTION_URL}/webapp/session`, { method: 'OPTIONS', headers: { origin: SITE } }));
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), SITE);
  assert.match(pre.headers.get('access-control-allow-headers') ?? '', /authorization/);
  assert.match(pre.headers.get('access-control-allow-methods') ?? '', /POST/);
  const evilPre = await h.app(new Request(`${TEST_FUNCTION_URL}/webapp/session`, { method: 'OPTIONS', headers: { origin: 'https://evil.example' } }));
  assert.equal(evilPre.status, 403);
  const evil = await h.call('session', { init_data: launch() }, { origin: 'https://evil.example' });
  assert.equal(evil.status, 403);
  assert.equal(h.fdb.of('bot_webapp_session').length, 0);
  const ok = await h.call('session', { init_data: launch() });
  assert.equal(ok.status, 200);
  const proxied = await h.call('session', { init_data: launch({ secondsAgo: 3 }) }, { origin: null });
  assert.equal(proxied.status, 200);
  const get = await h.app(new Request(`${TEST_FUNCTION_URL}/webapp/session`, { headers: { origin: SITE } }));
  assert.equal(get.status, 405);
  assert.equal(get.headers.get('allow'), 'POST, OPTIONS');
  const res = await h.app(new Request(`${TEST_FUNCTION_URL}/webapp/session`, { method: 'POST', headers: { origin: SITE }, body: JSON.stringify({ init_data: launch({ secondsAgo: 1 }) }) }));
  assert.equal(res.headers.get('cache-control'), 'no-store');
  assert.equal(res.headers.get('access-control-allow-origin'), SITE);
});

test('the body: JSON objects only, at most 8 KB', async () => {
  const h = webHarness();
  assert.equal((await h.call('session', 'not json')).status, 400);
  assert.equal((await h.call('session', '[1,2]')).status, 400);
  assert.equal((await h.call('session', { init_data: 'x'.repeat(BODY_MAX) })).status, 413);
});

test('the limit in memory per address: 120 a minute, another address unaffected, a minute later again', async () => {
  const h = webHarness();
  assert.equal(PER_ADDRESS_PER_MINUTE, 120);
  for (let i = 0; i < PER_ADDRESS_PER_MINUTE; i += 1) assert.equal((await h.call('session', 'x')).status, 400);
  assert.deepEqual([(await h.call('session', 'x')).status], [429]);
  assert.equal((await h.call('session', 'x', { 'x-forwarded-for': '198.51.100.9, 10.0.0.1' })).status, 400);
  h.advance(60_001);
  assert.equal((await h.call('session', 'x')).status, 400);
});

test('the limit in memory per Telegram user: 20 signed calls a minute, then «slow_down» before the database', async () => {
  const h = webHarness();
  h.linked();
  for (let i = 0; i < PER_TELEGRAM_PER_MINUTE; i += 1) {
    const r = await h.call('session', { init_data: launch({ secondsAgo: 100 + i }) }, { 'x-forwarded-for': `198.51.100.${i}` });
    assert.equal(r.json.status, 'linked');
  }
  assert.deepEqual((await h.call('session', { init_data: launch({ secondsAgo: 300 }) })).json, { status: 'slow_down' });
  assert.equal(h.fdb.of('bot_webapp_session').length, PER_TELEGRAM_PER_MINUTE);
  // Another Telegram user is not slowed by it.
  assert.equal((await h.call('session', { init_data: launch({ id: OTHER_TG, secondsAgo: 301 }) })).json.status, 'unlinked');
});

test('not configured (no token, no Auth) and a database that fails: 503, nothing else said', async () => {
  assert.equal((await webHarness({ token: '' }).call('session', { init_data: launch() })).status, 503);
  assert.equal((await webHarness({ auth: 'none' }).call('session', { init_data: launch() })).status, 503);
  const h = webHarness();
  h.fdb.fail('bot_webapp_session', new DbError('bot_webapp_session', 503, 'PGRST000'));
  const r = await h.call('session', { init_data: launch() });
  assert.deepEqual([r.status, r.json], [503, { error: 'unavailable' }]);
});

test('no secret, initData, JWT, e-mail or id in a log line or an error, whatever happens', async () => {
  const start = LOGS.length;
  const texts: string[] = [];
  const h = webHarness();
  h.linked(OTHER_USER, OTHER_TG);
  const data = launch();
  texts.push((await h.call('session', { init_data: data })).text);
  texts.push((await h.call('session', { init_data: data })).text);
  texts.push((await h.call('link', { init_data: data }, { authorization: `Bearer ${JWT_OK}` })).text);
  h.fa.failures.mint = new AuthError(500);
  texts.push((await h.call('session', { init_data: launch({ id: OTHER_TG, secondsAgo: 2 }) })).text);
  // A third Telegram for the other account: M2 to it and M6 to its old chat both fail on the network (the token is in
  // the URL of such an error).
  h.tg.fail('sendMessage', { kind: 'network' }, { kind: 'network' });
  texts.push((await h.call('link', { init_data: launch({ id: 700300, secondsAgo: 4 }) }, { authorization: `Bearer ${JWT_OTHER}` })).text);
  h.fdb.fail('bot_webapp_link', new DbError('bot_webapp_link', 0, 'timeout'));
  texts.push((await h.call('link', { init_data: launch({ secondsAgo: 6 }) }, { authorization: `Bearer ${JWT_OK}` })).text);
  const logs = LOGS.slice(start);
  assert.ok(logs.some((line) => line.includes('"kind":"link_m2"') && line.includes('TelegramError')), logs.join('\n'));
  assert.ok(logs.some((line) => line.includes('"kind":"link_m6"')));
  assert.ok(logs.some((line) => line.includes('DbError')));
  assert.ok(logs.every((line) => JSON.parse(line).route === 'webapp'));
  const secrets = [TEST_TOKEN.split(':')[1], data, hashOf(data), JWT_OK, JWT_OTHER, EMAIL, 'other@example.test', USER, OTHER_USER, String(TG), String(OTHER_TG),
    '700300', HASHED, encodeURIComponent(userJson()), 'api.telegram.org'];
  for (const text of [...logs, ...texts]) for (const secret of secrets) assert.ok(!text.includes(secret), `${secret.slice(0, 12)}… in ${text}`);
});

// ─────────────────────────────────────────── the Auth admin client ───────────────────────────────────────────

function authFetch(answers: Array<{ status: number; body?: unknown } | Error>) {
  const requests: Array<{ url: string; method: string; headers: Record<string, string>; body: unknown }> = [];
  const fetch = async (url: string, init?: RequestInit) => {
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries((init?.headers ?? {}) as Record<string, string>)) headers[k.toLowerCase()] = v;
    requests.push({ url, method: init?.method ?? 'GET', headers, body: typeof init?.body === 'string' ? JSON.parse(init.body) : null });
    const next = answers.shift();
    if (!next) throw new Error('no answer');
    if (next instanceof Error) throw next;
    return Response.json(next.body ?? {}, { status: next.status });
  };
  return { fetch, requests };
}

test('Auth: generate_link with the legacy key on both headers, only hashed_token taken; the new key on apikey only', async () => {
  const legacyKey = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2VydmljZQ';
  const f = authFetch([{ status: 200, body: { id: USER, email: EMAIL, action_link: 'https://x/verify?token=SECRET', email_otp: '123456', hashed_token: HASHED, verification_type: 'magiclink' } }]);
  const auth = createAuthAdmin({ url: 'https://abc.supabase.co/', key: legacyKey, fetch: f.fetch });
  assert.equal(await auth.magicLinkHash(EMAIL), HASHED);
  assert.equal(f.requests[0].url, 'https://abc.supabase.co/auth/v1/admin/generate_link');
  assert.equal(f.requests[0].method, 'POST');
  assert.deepEqual(f.requests[0].body, { type: 'magiclink', email: EMAIL });
  assert.equal(f.requests[0].headers.apikey, legacyKey);
  assert.equal(f.requests[0].headers.authorization, `Bearer ${legacyKey}`);

  const n = authFetch([{ status: 200, body: { hashed_token: HASHED } }]);
  await createAuthAdmin({ url: 'https://abc.supabase.co', key: 'sb_secret_abcdefghijklmnopqrstuv_12345678', fetch: n.fetch }).magicLinkHash(EMAIL);
  assert.equal(n.requests[0].headers.apikey, 'sb_secret_abcdefghijklmnopqrstuv_12345678');
  assert.equal(n.requests[0].headers.authorization, undefined);
});

test('Auth: generate_link failures are AuthError with a status and no URL, key or body', async () => {
  const key = 'sb_secret_abcdefghijklmnopqrstuv_12345678';
  for (const [answer, status] of [[{ status: 422, body: { msg: 'User not found' } }, 422], [{ status: 200, body: { hashed_token: 'short' } }, 200],
    [new TypeError('error sending request for url (https://abc.supabase.co/auth/v1/admin/generate_link)'), 0]] as const) {
    const f = authFetch([answer as { status: number; body?: unknown } | Error]);
    const error = await createAuthAdmin({ url: 'https://abc.supabase.co', key, fetch: f.fetch }).magicLinkHash(EMAIL).catch((e) => e);
    assert.ok(error instanceof AuthError);
    assert.equal(error.status, status);
    for (const text of [error.message, String(error.stack), JSON.stringify(error)]) {
      assert.ok(!text.includes('supabase.co') && !text.includes(key) && !text.includes(EMAIL), text);
    }
  }
});

test('Auth: the user of a JWT — 200 an account, 401/403 none, an anonymous one none, 500 an error', async () => {
  const key = 'sb_secret_abcdefghijklmnopqrstuv_12345678';
  const f = authFetch([{ status: 200, body: { id: USER.toUpperCase(), email: EMAIL } }, { status: 401 }, { status: 403, body: { code: 'session_not_found' } },
    { status: 200, body: { id: USER, is_anonymous: true } }, { status: 500 }]);
  const auth = createAuthAdmin({ url: 'https://abc.supabase.co', key, fetch: f.fetch });
  assert.deepEqual(await auth.userOfToken(JWT_OK), { id: USER });
  assert.equal(f.requests[0].url, 'https://abc.supabase.co/auth/v1/user');
  assert.equal(f.requests[0].method, 'GET');
  assert.equal(f.requests[0].headers.authorization, `Bearer ${JWT_OK}`);
  assert.equal(f.requests[0].headers.apikey, key);
  assert.equal(await auth.userOfToken(JWT_OK), null);
  assert.equal(await auth.userOfToken(JWT_OK), null);
  assert.equal(await auth.userOfToken(JWT_OK), null);
  await assert.rejects(() => auth.userOfToken(JWT_OK), AuthError);
});
