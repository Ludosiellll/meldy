// /setup and /status (spec §5, §6.1, §8.1 «профиль в пределах 64/120/512, команды [a-z0-9_]{1,32}»).
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { ALLOWED_UPDATES, FUNCTION_REGION, MAX_CONNECTIONS, webhookUrl } from './setup.ts';
import { copyProblems, lintProfile } from './lint.ts';
import { PROFILE } from './words.ts';
import { harness } from './fixtures/harness.ts';
import { TEST_FUNCTION_URL, TEST_TOKEN } from './fixtures/fake_telegram.ts';

const hmac = (purpose: string) => createHmac('sha256', TEST_TOKEN).update(`meldy:${purpose}:v1`).digest('base64url');
const setupRequest = () => new Request(`${TEST_FUNCTION_URL}/setup`, { method: 'POST' });

test('the webhook is pinned to the one region constant (eu-central-1: regional invocation does not offer Stockholm)', () => {
  assert.equal(FUNCTION_REGION, 'eu-central-1');
  assert.equal(webhookUrl(TEST_FUNCTION_URL), `${TEST_FUNCTION_URL}?forceFunctionRegion=${FUNCTION_REGION}`);
  assert.equal(webhookUrl('https://abc.supabase.co/functions/v1/telegram'), 'https://abc.supabase.co/functions/v1/telegram?forceFunctionRegion=eu-central-1');
});

test('/setup: getMe → bot_setup → bot_live_setup → setWebhook → the profile → the photo; the answer holds no secret', async () => {
  const h = harness();
  h.fdb.on('bot_live_setup', () => ({ status: 'ok' }));
  const res = await h.app(setupRequest());
  assert.equal(res.status, 200);
  const text = await res.text();
  const body = JSON.parse(text);
  assert.equal(body.ok, true);
  assert.equal(body.bot, 'Meldyteach_bot');
  assert.ok(Object.values(body.steps).every((s) => s === 'ok'), text);
  for (const secret of [TEST_TOKEN, 'TEST_TOKEN_NOT_REAL', hmac('webhook'), hmac('tick'), hmac('live')]) assert.ok(!text.includes(secret));
  // The live game's token for the database's calls to /game/post and /game/sync (game.ts).
  assert.deepEqual(h.fdb.of('bot_live_setup').map((c) => c.args), [{ p_live_token: hmac('live') }]);

  assert.deepEqual(h.tg.methods(), ['getMe', 'setWebhook', 'setMyName', 'setMyDescription', 'setMyShortDescription', 'setMyCommands',
    'deleteMyCommands', 'setChatMenuButton', 'getUserProfilePhotos', 'setMyProfilePhoto']);
  assert.deepEqual(h.fdb.setups, [{ username: 'Meldyteach_bot', botId: 123456, tickToken: hmac('tick'), functionUrl: TEST_FUNCTION_URL, functionRegion: 'eu-central-1' }]);
  const webhook = h.tg.of('setWebhook')[0].params;
  assert.deepEqual(webhook, {
    url: webhookUrl(TEST_FUNCTION_URL), secret_token: hmac('webhook'), allowed_updates: ['message', 'callback_query', 'my_chat_member'], max_connections: 10,
  });
  assert.deepEqual([...ALLOWED_UPDATES], ['message', 'callback_query', 'my_chat_member']);
  assert.equal(MAX_CONNECTIONS, 10);
  assert.deepEqual(h.tg.of('setMyName')[0].params, { name: 'Meldy' });
  assert.deepEqual(h.tg.of('setMyShortDescription')[0].params, { short_description: PROFILE.shortDescription });
  assert.deepEqual(h.tg.of('setMyDescription')[0].params, { description: PROFILE.description });
  assert.deepEqual(h.tg.of('setMyCommands')[0].params, { commands: PROFILE.commands, scope: { type: 'all_private_chats' } });
  assert.deepEqual(h.tg.of('deleteMyCommands')[0].params, { scope: { type: 'default' } });
  // The menu button opens Meldy as a Mini App, for every private chat (no chat_id): «Сегодня» on the site.
  assert.deepEqual(h.tg.of('setChatMenuButton')[0].params, {
    menu_button: { type: 'web_app', text: 'Открыть Meldy', web_app: { url: 'https://ludosiel-studyforge.hf.space/tg' } },
  });
  const photo = h.tg.of('setMyProfilePhoto')[0].params;
  assert.deepEqual(photo.photo, { type: 'static', photo: 'attach://avatar' });
  assert.equal(photo.avatar.type, 'image/jpeg');
  assert.ok(photo.avatar.size > 10_000);
});

test('/setup on a database without the live game: that step failed, the rest done', async () => {
  const h = harness();
  const body = await (await h.app(setupRequest())).json();
  assert.equal(body.ok, true);
  assert.equal(body.steps.bot_live_setup, 'failed');
  assert.equal(body.steps.setWebhook, 'ok');
});

test('/setup at most once a minute: in this instance, and through bot_setup across instances', async () => {
  const h = harness();
  assert.equal((await h.app(setupRequest())).status, 200);
  assert.equal((await h.app(setupRequest())).status, 429);
  assert.equal(h.tg.of('getMe').length, 1);
  const other = harness();
  await other.fdb.db.setup({ username: 'Meldyteach_bot', botId: 1, tickToken: hmac('tick'), functionUrl: TEST_FUNCTION_URL, functionRegion: FUNCTION_REGION });
  const res = await other.app(setupRequest());
  assert.equal(res.status, 429);
  assert.deepEqual(await res.json(), { ok: false, error: 'slow_down', bot: 'Meldyteach_bot', steps: { getMe: 'ok', bot_setup: 'skipped' } });
  assert.equal(other.tg.of('setWebhook').length, 0);
  assert.equal((await other.app(new Request(`${TEST_FUNCTION_URL}/setup`))).status, 405);
});

test('/setup keeps an existing photo, reports a failing profile step and goes on; getMe failing stops it', async () => {
  const h = harness();
  h.tg.result('getUserProfilePhotos', () => ({ total_count: 1, photos: [[{ file_id: 'p' }]] }));
  h.tg.fail('setMyDescription', { kind: '400', description: 'Bad Request: description is too long' });
  const res = await h.app(setupRequest());
  assert.equal(res.status, 502);
  const body = await res.json();
  assert.equal(body.steps.setMyDescription, 'failed');
  assert.equal(body.steps.setMyShortDescription, 'ok');
  assert.equal(body.steps.setMyProfilePhoto, 'skipped');
  assert.equal(body.error, 'setMyDescription:400');
  assert.equal(h.tg.of('setMyProfilePhoto').length, 0);

  const down = harness();
  down.tg.fail('getMe', { kind: 'network' }, { kind: 'network' });
  const failed = await down.app(setupRequest());
  assert.equal(failed.status, 502);
  const text = await failed.text();
  assert.ok(!text.includes('TEST_TOKEN_NOT_REAL') && !text.includes('api.telegram.org'));
  assert.deepEqual(JSON.parse(text), { ok: false, error: 'getMe:0', steps: { getMe: 'failed' } });
});

test('/status: public, no secret; the webhook as Telegram sees it, the last tick, the calls, the region it ran in', async () => {
  const h = harness({ region: 'eu-central-1' });
  await h.tick();
  await Promise.all(h.waits.splice(0));
  h.tg.result('getWebhookInfo', () => ({
    url: webhookUrl(TEST_FUNCTION_URL), has_custom_certificate: false, pending_update_count: 2, last_error_date: 1_791_900_000,
    last_error_message: 'Wrong response from the webhook: 503 Service Unavailable', max_connections: 10, allowed_updates: ['message', 'callback_query', 'my_chat_member'],
  }));
  const res = await h.app(new Request(`${TEST_FUNCTION_URL}/status`));
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('Cache-Control'), 'no-store');
  const text = await res.text();
  for (const secret of [TEST_TOKEN, 'TEST_TOKEN_NOT_REAL', hmac('webhook'), hmac('tick')]) assert.ok(!text.includes(secret));
  const body = JSON.parse(text);
  assert.equal(body.ok, true);
  assert.equal(body.region, 'eu-central-1');
  assert.equal(body.function_region, 'eu-central-1');
  assert.equal(body.tick_mode, 'every_minute');
  assert.deepEqual(body.webhook, {
    url_ok: true, pending_update_count: 2, last_error_date: new Date(1_791_900_000_000).toISOString(),
    last_error_message: 'Wrong response from the webhook: 503 Service Unavailable', max_connections: 10, allowed_updates: ['message', 'callback_query', 'my_chat_member'],
  });
  assert.ok(typeof body.last_tick_at === 'string');
  assert.deepEqual(Object.keys(body.calls), ['month', 'updates', 'ticks', 'total']);
  assert.equal(body.calls.ticks, 1);
  h.tg.result('getWebhookInfo', () => ({ url: 'https://elsewhere.example/hook', pending_update_count: 0 }));
  const calls = h.tg.of('getWebhookInfo').length;
  assert.equal((await (await h.app(new Request(`${TEST_FUNCTION_URL}/status`))).json()).webhook.url_ok, true, 'answered from memory within 15 s');
  assert.equal(h.tg.of('getWebhookInfo').length, calls);
  h.advance(15_000);
  assert.equal((await (await h.app(new Request(`${TEST_FUNCTION_URL}/status`))).json()).webhook.url_ok, false);
  assert.equal((await h.app(new Request(`${TEST_FUNCTION_URL}/status`, { method: 'POST' }))).status, 405);
});

test('the profile: «Meldy», 81 of 120 and 388 of 512 characters, three commands, clean copy', () => {
  assert.equal(PROFILE.name, 'Meldy');
  assert.equal([...PROFILE.shortDescription].length, 81);
  assert.equal([...PROFILE.description].length, 388);
  assert.deepEqual(PROFILE.commands.map((c) => c.command), ['today', 'settings', 'help']);
  assert.deepEqual(PROFILE.commands.map((c) => c.description), ['План на сегодня', 'Время и пауза', 'Как это работает']);
  assert.deepEqual(lintProfile(PROFILE), []);
  assert.equal(PROFILE.menuButton, 'Открыть Meldy');
  assert.deepEqual(copyProblems(PROFILE.menuButton, 'menu button'), []);
});
