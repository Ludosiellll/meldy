// Security checks of spec §8.1 «Безопасность» and the brief's code rules, by reading the code itself: only
// `/rest/v1/rpc/bot_*`, no database connection string, no `console.` outside log.ts, every message through `send()`
// with protect_content, Deno-only APIs in index.ts and env.ts, imports relative `.ts` only; and the test token never in
// a log line, an error or a response, whatever fails.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createHmac } from 'node:crypto';
import { createTelegram, send, type TelegramError } from './tg.ts';
import { harness, LOGS } from './fixtures/harness.ts';
import { fakeTelegram, TEST_TOKEN } from './fixtures/fake_telegram.ts';
import { AUTUMN, NOW, TG } from './fixtures/scenario.ts';
import { press, privateText } from './fixtures/updates.ts';
import { DbError } from './db.ts';

const BOT = dirname(fileURLToPath(import.meta.url));
const FUNCTIONS = join(BOT, '..', '..');
const SELF = fileURLToPath(import.meta.url);

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? walk(path) : path.endsWith('.ts') ? [path] : [];
  });
}

const all = [...walk(BOT), join(FUNCTIONS, 'telegram', 'index.ts')];
const isTest = (path: string) => path.endsWith('.test.ts') || path.includes(join('bot', 'fixtures'));
const sources = all.filter((path) => !isTest(path));
const name = (path: string) => relative(FUNCTIONS, path);
const read = (path: string) => readFileSync(path, 'utf8');
/** The code without its comments (a comment may name what the code must not do). */
const code = (path: string) =>
  read(path).replace(/\/\*[\s\S]*?\*\//g, '').split('\n').map((line) => line.replace(/(^|\s)\/\/.*$/, '')).join('\n');

/** The functions of T1's contract, plus T5's flush called by the tick's step 7. */
const RPC_ALLOWED = new Set([
  'bot_setup', 'bot_update_begin', 'bot_update_done', 'bot_update_failed', 'bot_tick_beat', 'bot_status', 'bot_link_claim', 'bot_chat_event',
  'bot_whoami', 'bot_settings', 'bot_today', 'bot_card_sent', 'bot_claim_reminders', 'bot_reminder_context', 'bot_delivery_sending',
  'bot_delivery_done', 'bot_delivery_retry', 'bot_claim_day_close', 'bot_claim_after_date', 'bot_flush_pending',
  'bot_file_offer', 'bot_file_redeem',
  'bot_session_items', 'bot_session_start', 'bot_session_view', 'bot_session_answer', 'bot_session_resolve',
  'bot_session_finish', 'bot_session_move', 'bot_key_doubt',
  'bot_group_claim', 'bot_group_event', 'bot_group_entry', 'bot_claim_group_posts', 'bot_group_pick', 'bot_group_sending',
  'bot_group_posted', 'bot_group_answer', 'bot_group_counters', 'bot_group_counter_done', 'bot_claim_group_closes', 'bot_group_closed',
  'bot_voice_state', 'bot_voice_start', 'bot_voice_next', 'bot_voice_sent', 'bot_voice_ticket', 'bot_voice_part', 'bot_voice_restart',
  'bot_voice_checked', 'bot_voice_followup', 'bot_voice_release', 'bot_voice_record', 'bot_voice_self', 'bot_voice_rate',
  'bot_oral_inputs',
  // The Mini App (webapp.ts, migration 20261010150000_telegram_webapp.sql).
  'bot_webapp_session',
  // The outage monitor (monitor.ts, migration 20261012100000_telegram_bot_monitor.sql).
  'bot_monitor_state', 'bot_monitor_claim', 'bot_monitor_save',
  // «Экзамены» and «Перенести экзамен» (exams.ts, migration 20261018120000_exam_move_bot_exams.sql).
  'bot_exams', 'bot_exam_remind', 'bot_exam_move',
  // The live game «Битва с монстром» (game.ts, setup.ts; migration 20261021090000_live_game.sql).
  'bot_live_join', 'bot_live_post', 'bot_live_posted', 'bot_live_sync', 'bot_live_setup',
  // «Осталось выучить» (card.ts, session.ts; migration 20261021140000_learn_left.sql).
  'bot_learn_left',
  // The pictures of deleted exams and tests (sweep.ts; migration 20261103090200_picture_sweep.sql).
  'bot_picture_sweep', 'bot_picture_swept',
]);

test('data only through POST /rest/v1/rpc/bot_* (db.ts), names from the contract; no table reads', () => {
  assert.ok(sources.length >= 18);
  for (const path of sources) {
    const text = code(path);
    for (const m of text.matchAll(/\/rest\/v1\/([a-z_]*)/g)) {
      assert.equal(name(path), join('_shared', 'bot', 'db.ts'), `${name(path)} reaches PostgREST`);
      assert.equal(m[1], 'rpc', `${name(path)}: /rest/v1/${m[1]}`);
    }
    assert.ok(!/\.from\(\s*['"`]/.test(text), `${name(path)}: a table read`);
    assert.ok(!/postgres(ql)?:\/\//.test(text), `${name(path)}: a connection string`);
    for (const m of text.matchAll(/['"`](bot_[a-z_]+)['"`]/g)) assert.ok(RPC_ALLOWED.has(m[1]), `${name(path)}: ${m[1]} is not in the contract`);
  }
});

test('Supabase Auth only from webapp.ts, and only its one call: the admin magic link', () => {
  const auth = join('_shared', 'bot', 'webapp.ts');
  let seen = 0;
  for (const path of sources) {
    const text = code(path);
    if (name(path) !== auth) {
      assert.ok(!/\/auth\/v1\b/.test(text), `${name(path)} reaches Supabase Auth`);
      assert.ok(!/generate_link|generateLink/.test(text), `${name(path)} mints a sign-in`);
      continue;
    }
    // The one function that reaches Auth takes only this path, and is called only with it. No user's JWT is ever
    // checked here: the Mini App links nothing (Telegram_Mini_App_Spec_2026-10-10, «Проверка безопасности 2026-10-11»).
    const signature = /function call\(path: '([^']+)'(\s*\|[^,]*)?,/.exec(text);
    assert.ok(signature, 'webapp.ts has one typed call(path) to Auth');
    assert.equal(signature[1], 'admin/generate_link');
    assert.equal(signature[2], undefined, 'one path only');
    for (const m of text.matchAll(/\bcall\('([^']+)'/g)) {
      assert.equal(m[1], 'admin/generate_link', `call('${m[1]}')`);
      seen += 1;
    }
    assert.ok(!/\/user\b|userOfToken|bot_webapp_link/.test(text), 'no user check and no link');
    assert.ok(/\/auth\/v1`/.test(text), 'webapp.ts builds the Auth base');
    assert.ok(!/admin\/users|admin\/sessions|\/logout|\/token\b/.test(text), 'no other Auth call');
  }
  assert.equal(seen, 1, 'one call to Auth in webapp.ts');
});

test('Supabase Storage only from sweep.ts: a listing and a removal in the two picture buckets, nothing else', () => {
  const sweep = join('_shared', 'bot', 'sweep.ts');
  let seen = 0;
  for (const path of sources) {
    const text = code(path);
    if (name(path) !== sweep) {
      assert.ok(!/\/storage\/v1\b/.test(text), `${name(path)} reaches Supabase Storage`);
      continue;
    }
    seen += 1;
    assert.ok(/\/storage\/v1\/object`/.test(text), 'sweep.ts builds the object base');
    assert.ok(text.includes("SWEEP_BUCKETS = ['quiz-covers', 'test-item-images'] as const"), 'the two picture buckets only');
    const methods = [...text.matchAll(/\bstorage\('([A-Z]+)'/g)].map((m) => m[1]);
    assert.deepEqual([...new Set(methods)].sort(), ['DELETE', 'POST'], 'a listing (POST list/<bucket>) and a removal (DELETE <bucket>)');
    assert.ok(/storage\('POST', `list\/\$\{bucket\}`/.test(text) && /storage\('DELETE', bucket,/.test(text), 'no other Storage path');
  }
  assert.equal(seen, 1);
});

test('no database connection string anywhere in the function (code and tests)', () => {
  const needle = ['SUPABASE', 'DB', 'URL'].join('_');
  for (const path of [...all, ...walk(join(FUNCTIONS, '_shared', 'plan'))]) {
    if (path === SELF) continue;
    assert.ok(!read(path).includes(needle), name(path));
  }
});

test('console.* only in log.ts (code, tests and fixtures alike)', () => {
  for (const path of all) {
    if (name(path) === join('_shared', 'bot', 'log.ts') || path === SELF) continue;
    assert.ok(!/\bconsole\./.test(code(path)), name(path));
  }
});

test('every message goes through send() (tg.ts) with protect_content and no link preview; no other send method', () => {
  for (const path of sources) {
    const text = code(path);
    const sends = text.match(/['"]sendMessage['"]/g) ?? [];
    if (name(path) === join('_shared', 'bot', 'tg.ts')) assert.equal(sends.length, 1, 'one sendMessage call: send()');
    else assert.equal(sends.length, 0, `${name(path)} calls sendMessage`);
    assert.ok(!/['"](sendPhoto|sendDocument|sendVoice|sendAudio|sendVideo|sendAnimation|sendSticker|sendMediaGroup|sendPoll|forwardMessage|forwardMessages|copyMessage|copyMessages|sendRichMessage|sendMessageDraft)['"]/.test(text), name(path));
  }
  const tg = read(join(BOT, 'tg.ts'));
  const sendBody = tg.slice(tg.indexOf('export function send('), tg.indexOf('export type EditResult'));
  assert.ok(sendBody.includes('protect_content: true'));
  assert.ok(sendBody.includes('link_preview_options: { is_disabled: true }'));
});

test('Deno-only APIs stay in telegram/index.ts and env.ts; imports are relative .ts files only', () => {
  for (const path of sources) {
    const text = code(path);
    const file = name(path);
    if (/\bDeno\.(serve|env)\b/.test(text)) assert.ok([join('telegram', 'index.ts'), join('_shared', 'bot', 'env.ts')].includes(file), file);
    if (/\bEdgeRuntime\.waitUntil\b/.test(text)) assert.equal(file, join('telegram', 'index.ts'));
    for (const m of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) assert.match(m[1], /^\.\.?\/.*\.ts$/, `${file}: import ${m[1]}`);
  }
});

test('the test token never shows in a log line, an error or a response, whatever fails', async () => {
  const secretPart = TEST_TOKEN.split(':')[1];
  const derived = ['webhook', 'tick', 'live'].map((p) => createHmac('sha256', TEST_TOKEN).update(`meldy:${p}:v1`).digest('base64url'));
  const texts: string[] = [];
  const start = LOGS.length;

  // Telegram unreachable (the error's message holds the URL with the token), refusing, rate-limiting; the database down.
  const h = harness({ now: NOW + 60_000 });
  h.linked([AUTUMN]);
  h.tg.fail('sendMessage', { kind: 'network' });
  texts.push(await (await h.post(privateText('/help'))).text());
  h.tg.fail('answerCallbackQuery', { kind: 'network' }, { kind: 'network' });
  h.fdb.fail('bot_whoami', new DbError('bot_whoami', 0, 'timeout'));
  texts.push(await (await h.post(press('st|time'))).text());
  h.tg.fail('getMe', { kind: 'timeout' }, { kind: 'timeout' });
  texts.push(await (await h.app(new Request('https://abcdefghijklmnopqrst.supabase.co/functions/v1/telegram/setup', { method: 'POST' }))).text());
  h.tg.fail('getWebhookInfo', { kind: 'network' }, { kind: 'network' });
  texts.push(await (await h.app(new Request('https://abcdefghijklmnopqrst.supabase.co/functions/v1/telegram/status'))).text());
  h.tg.fail('sendMessage', { kind: 'network' });
  await h.tick();
  await Promise.all(h.waits.splice(0));

  // The client's own errors.
  const tg = fakeTelegram();
  const api = createTelegram({ token: TEST_TOKEN, fetch: tg.fetch, sleep: async () => {} });
  for (const failure of [{ kind: 'network' }, { kind: 'timeout' }, { kind: '403' }, { kind: '5xx' }] as const) {
    tg.fail('sendMessage', failure);
    const error = await send(api, { chatId: TG, text: 'x' }).catch((e) => e) as TelegramError;
    texts.push(String(error), error.message, String(error.stack), JSON.stringify(error));
  }

  const logs = LOGS.slice(start);
  assert.ok(logs.length >= 3, `${logs.length} log lines`);
  assert.ok(logs.some((line) => line.includes('TelegramError:0')), 'the network failure was logged by name');
  for (const text of [...logs, ...texts]) {
    assert.ok(!text.includes(secretPart), text);
    assert.ok(!text.includes('api.telegram.org'), text);
    for (const d of derived) assert.ok(!text.includes(d), text);
  }
});
