// The update ledger (spec decision 6, §8.1 «Вход и журнал»): new / retry / done / busy, done only after success;
// a failed message → 503 when a retry can help, a failed press → «Meldy сейчас не отвечает…» and 200; the engineer's
// «seen first» test (a /start <code> lost on a retry) passes now.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { failureName, transient } from './ledger.ts';
import { DbError } from './db.ts';
import { setLogSink } from './log.ts';
import { TelegramError } from './tg.ts';
import { typo, visibleText } from './html.ts';
import { harness } from './fixtures/harness.ts';
import { TG, USER } from './fixtures/scenario.ts';
import { press, privateText } from './fixtures/updates.ts';
import * as W from './words.ts';

const CODE = `L${'e5'.repeat(16)}`;
const words = (text: string) => visibleText(text).replace(/ /g, ' ');

test('new → handled → done; done and busy → 200 without handling; after the 30 s lease a retry runs again', async () => {
  const h = harness();
  h.linked();
  const update = privateText('/help');
  assert.equal((await h.post(update)).status, 200);
  assert.equal(h.fdb.updates.get(update.update_id)!.status, 'done');
  assert.equal((await h.post(update)).status, 200);
  assert.equal(h.tg.of('sendMessage').length, 1, 'done: not again');

  const busy = privateText('/help');
  await h.fdb.db.updateBegin(busy.update_id); // another worker began it and is still on it
  assert.equal((await h.post(busy)).status, 200);
  assert.equal(h.tg.of('sendMessage').length, 1, 'busy: the other worker answers');
  h.advance(31_000);
  assert.equal((await h.post(busy)).status, 200);
  assert.equal(h.tg.of('sendMessage').length, 2, 'the lease ran out: retry');
});

test('«seen first» is fixed: a /start <code> whose claim times out answers 503, and Telegram\'s retry links', async () => {
  const h = harness();
  h.fdb.addCode(CODE, USER);
  h.fdb.fail('bot_link_claim', new DbError('bot_link_claim', 0, 'timeout'));
  const update = privateText(`/start ${CODE}`);
  assert.equal((await h.post(update)).status, 503);
  assert.equal(h.fdb.updates.get(update.update_id)!.status, 'failed');
  assert.equal(h.fdb.updates.get(update.update_id)!.error, 'DbError:0');
  assert.equal(h.tg.of('sendMessage').length, 0);
  h.advance(2_000);
  assert.equal((await h.post(update)).status, 200);
  assert.equal(words(h.tg.of('sendMessage')[0].params.text).split('\n')[0], W.M2_TITLE);
  assert.ok(h.fdb.link(TG), 'linked on the retry');
  assert.equal(h.fdb.updates.get(update.update_id)!.status, 'done');
});

test('a deterministic failure of a message (a 4xx, a bug) → 200 and failed: no 24-hour retry loop', async () => {
  const h = harness();
  h.linked();
  h.fdb.fail('bot_today', new TypeError('bug'));
  const update = privateText('/today');
  assert.equal((await h.post(update)).status, 200);
  assert.equal(h.fdb.updates.get(update.update_id)!.status, 'failed');
  assert.equal(h.fdb.updates.get(update.update_id)!.error, 'TypeError');
  h.fdb.fail('bot_whoami', new DbError('bot_whoami', 400, '22023'));
  assert.equal((await h.post(privateText('/settings'))).status, 200);
  h.tg.fail('sendMessage', { kind: '400', description: 'Bad Request: chat not found' });
  assert.equal((await h.post(privateText('/help'))).status, 200);
});

test('a message that failed on a transient error → 503: the database down, Telegram 5xx, a long 429', async () => {
  const h = harness();
  h.linked();
  h.fdb.fail('bot_whoami', new DbError('bot_whoami', 503, ''));
  assert.equal((await h.post(privateText('/settings'))).status, 503);
  h.tg.fail('sendMessage', { kind: '5xx' });
  assert.equal((await h.post(privateText('/help'))).status, 503);
  h.tg.fail('sendMessage', { kind: '429', retryAfter: 30 });
  assert.equal((await h.post(privateText('/help'))).status, 503);
  h.tg.fail('sendMessage', { kind: '429', retryAfter: 2 });
  assert.equal((await h.post(privateText('/help'))).status, 200, 'a short 429 is waited out (3 s at most)');
  h.fdb.fail('bot_update_begin', new DbError('bot_update_begin', 0, 'network'));
  assert.equal((await h.post(privateText('/help'))).status, 503, 'the ledger itself down: Telegram retries');
});

test('a press whose work fails, or whose ledger fails: the line «Meldy сейчас не отвечает…» and 200', async () => {
  const h = harness();
  h.linked();
  h.fdb.fail('bot_whoami', new DbError('bot_whoami', 0, 'timeout'));
  assert.equal((await h.post(press('st|time'))).status, 200);
  assert.equal(h.tg.of('answerCallbackQuery').at(-1)!.params.text, typo(W.DB_DOWN_TAP));
  h.fdb.fail('bot_update_begin', new DbError('bot_update_begin', 0, 'timeout'));
  assert.equal((await h.post(press('st|time'))).status, 200);
  assert.equal(h.tg.of('answerCallbackQuery').at(-1)!.params.text, typo(W.DB_DOWN_TAP));
  // Answered first, failed later (the edit): the press is not answered twice.
  h.tg.fail('editMessageText', { kind: '403' });
  const before = h.tg.of('answerCallbackQuery').length;
  assert.equal((await h.post(press('st|time'))).status, 200);
  assert.equal(h.tg.of('answerCallbackQuery').length, before + 1);
});

test('one log line per update with its outcome; nothing of the user in it', async () => {
  const h = harness();
  h.linked();
  const lines: string[] = [];
  const restore = setLogSink((line) => lines.push(line));
  try {
    await h.post(privateText('Меня зовут Иван, мой код L1234'));
    await h.post(press('st|time'));
    h.fdb.fail('bot_whoami', new DbError('bot_whoami', 0, 'timeout'));
    await h.post(privateText('/settings'));
  } finally {
    restore();
  }
  assert.equal(lines.length, 3);
  const parsed = lines.map((l) => JSON.parse(l));
  assert.deepEqual(parsed.map((p) => [p.route, p.kind, p.outcome]), [['webhook', 'message', 'ok'], ['webhook', 'callback', 'ok'], ['webhook', 'message', 'failed']]);
  assert.equal(parsed[2].error_name, 'DbError:0');
  for (const line of lines) assert.ok(!/Иван|L1234|700100|Meldy/.test(line), line);
});

test('transient and failureName', () => {
  assert.equal(transient(new DbError('f', 0, 'timeout')), true);
  assert.equal(transient(new DbError('f', 503, '')), true);
  assert.equal(transient(new DbError('f', 400, '22023')), false);
  assert.equal(transient(new DbError('f', 404, 'PGRST202')), false);
  assert.equal(transient(new TelegramError('sendMessage', 0, 'timeout', 'timeout')), true);
  assert.equal(transient(new TelegramError('sendMessage', 429, 'x', 'api', 30)), true);
  assert.equal(transient(new TelegramError('sendMessage', 502, 'x', 'api')), true);
  assert.equal(transient(new TelegramError('sendMessage', 403, 'x', 'api')), false);
  assert.equal(transient(new TypeError('x')), false);
  assert.equal(failureName(new TelegramError('sendMessage', 429, 'x', 'api')), 'TelegramError:429');
  assert.equal(failureName(new DbError('f', 503, '')), 'DbError:503');
  assert.equal(failureName(new RangeError('x')), 'RangeError');
});
