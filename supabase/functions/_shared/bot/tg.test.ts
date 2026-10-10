import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  answer, createTelegram, edit, editKeyboard, editOrSend, IDEMPOTENT, inlineMarkup, isBlocked, isChatGone, isMessageGone,
  isNotModified, isQueryTooOld, remove, send, TelegramError,
} from './tg.ts';
import { BLOCKED, DELETE_NOT_FOUND, EDIT_NOT_FOUND, fakeSleep, fakeTelegram, QUERY_TOO_OLD, TEST_TOKEN } from './fixtures/fake_telegram.ts';

function client(wait429Sec?: number) {
  const tg = fakeTelegram();
  const s = fakeSleep();
  const api = createTelegram({ token: TEST_TOKEN, fetch: tg.fetch, sleep: s.sleep, random: () => 0.5, wait429Sec });
  return { tg, api, waits: s.waits };
}

/** Everything an error could show: message, stack, JSON, string form. */
function leakText(error: unknown): string {
  const e = error as Error;
  return [String(e), e.message, e.stack ?? '', JSON.stringify(e), JSON.stringify((e as TelegramError).description ?? '')].join('\n');
}

test('a call posts JSON to the method and returns the result', async () => {
  const { tg, api } = client();
  const me = await api.call<{ username: string }>('getMe');
  assert.equal(me.username, 'Meldyteach_bot');
  assert.deepEqual(tg.methods(), ['getMe']);
});

test('TelegramError carries code and description but never the URL or the token', async () => {
  const { tg, api } = client();
  tg.fail('sendMessage', { kind: '403' });
  const error = await api.call('sendMessage', { chat_id: 1, text: 'x' }).catch((e) => e);
  assert.ok(error instanceof TelegramError);
  assert.equal(error.code, 403);
  assert.equal(error.description, BLOCKED);
  assert.equal(error.name, 'TelegramError');
  assert.ok(isBlocked(error));
  const text = leakText(error);
  assert.ok(!text.includes(TEST_TOKEN) && !text.includes('TEST_TOKEN_NOT_REAL') && !text.includes('api.telegram.org'), text);

  tg.fail('getMe', { kind: 'network' }, { kind: 'network' });
  const network = await api.call('getMe').catch((e) => e);
  assert.ok(network instanceof TelegramError);
  assert.equal(network.code, 0);
  assert.equal(network.failure, 'network');
  assert.ok(!leakText(network).includes('TEST_TOKEN_NOT_REAL'));
  assert.ok(!leakText(network).includes('api.telegram.org'));
});

test('one jittered retry, only for idempotent methods, after a timeout, an abort, a network error or a 5xx', async () => {
  for (const failure of [{ kind: 'timeout' }, { kind: 'abort' }, { kind: 'network' }, { kind: '5xx' }, { kind: '5xx', json: true }] as const) {
    const { tg, api, waits } = client();
    tg.fail('editMessageText', failure);
    await api.call('editMessageText', { chat_id: 1, message_id: 2, text: 'a' });
    assert.equal(tg.of('editMessageText').length, 2, failure.kind);
    assert.equal(waits.length, 1);
    assert.ok(waits[0] >= 150 && waits[0] <= 650, `jitter ${waits[0]}`);

    const s = client();
    s.tg.fail('sendMessage', failure);
    const error = await s.api.call('sendMessage', { chat_id: 1, text: 'a' }).catch((e) => e);
    assert.ok(error instanceof TelegramError, failure.kind);
    assert.equal(s.tg.of('sendMessage').length, 1, `sendMessage is never repeated blindly (${failure.kind})`);
  }
  // only one retry
  const { tg, api } = client();
  tg.fail('answerCallbackQuery', { kind: 'timeout' }, { kind: 'timeout' });
  await assert.rejects(api.call('answerCallbackQuery', { callback_query_id: 'q' }), TelegramError);
  assert.equal(tg.of('answerCallbackQuery').length, 2);
  // a 4xx is never retried
  tg.fail('deleteMessage', { kind: '400', description: DELETE_NOT_FOUND });
  await assert.rejects(api.call('deleteMessage', { chat_id: 1, message_id: 1 }));
  assert.equal(tg.of('deleteMessage').length, 1);
  for (const method of ['getMe', 'setWebhook', 'getFile', 'answerCallbackQuery', 'editMessageText', 'editMessageReplyMarkup', 'deleteMessage']) {
    assert.ok(IDEMPOTENT.has(method), method);
  }
  for (const method of ['sendMessage', 'setMyProfilePhoto', 'sendPhoto']) assert.ok(!IDEMPOTENT.has(method), method);
});

test('429: an interactive call waits retry_after up to 3 s once; longer, or in the tick, it stops', async () => {
  const short = client();
  short.tg.fail('sendMessage', { kind: '429', retryAfter: 2 });
  await short.api.call('sendMessage', { chat_id: 1, text: 'a' });
  assert.deepEqual(short.waits, [2000]);
  assert.equal(short.tg.of('sendMessage').length, 2, 'a 429 was not sent, so even sendMessage may go again');

  const long = client();
  long.tg.fail('sendMessage', { kind: '429', retryAfter: 7 });
  const error = (await long.api.call('sendMessage', { chat_id: 1, text: 'a' }).catch((e) => e)) as TelegramError;
  assert.equal(error.code, 429);
  assert.equal(error.retryAfter, 7);
  assert.equal(long.tg.of('sendMessage').length, 1);

  const tick = client(0);
  tick.tg.fail('sendMessage', { kind: '429', retryAfter: 1 });
  await assert.rejects(tick.api.call('sendMessage', { chat_id: 1, text: 'a' }));
  assert.equal(tick.waits.length, 0);
  const again = tick.api.with({ wait429Sec: 3 });
  tick.tg.fail('sendMessage', { kind: '429', retryAfter: 1 }, { kind: '429', retryAfter: 1 });
  await assert.rejects(again.call('sendMessage', { chat_id: 1, text: 'a' }), 'waits once only');
});

test('send(): protect_content, no link preview, HTML, silent unless it is the day card', async () => {
  const { tg, api } = client();
  await send(api, { chatId: 42, text: '<b>Привет</b>', keyboard: [[{ text: 'Начать', data: 'go|x|p', style: 'primary' }]] });
  await send(api, { chatId: 42, text: 'Карточка', sound: true });
  await send(api, { chatId: 42, text: 'Напишите время, например 7:45.', forceReply: { placeholder: 'Например, 7:45' }, replyTo: 9 });
  const [first, card, prompt] = tg.of('sendMessage').map((c) => c.params);
  for (const p of [first, card, prompt]) {
    assert.equal(p.protect_content, true);
    assert.deepEqual(p.link_preview_options, { is_disabled: true });
    assert.equal(p.parse_mode, 'HTML');
  }
  assert.equal(first.disable_notification, true);
  assert.equal(card.disable_notification, false);
  assert.deepEqual(first.reply_markup, { inline_keyboard: [[{ text: 'Начать', callback_data: 'go|x|p', style: 'primary' }]] });
  assert.equal(card.reply_markup, undefined);
  assert.deepEqual(prompt.reply_markup, { force_reply: true, input_field_placeholder: 'Например, 7:45' });
  assert.deepEqual(prompt.reply_parameters, { message_id: 9, allow_sending_without_reply: true });
});

test('edits: «not modified» is success, «not found» asks for a new message, the keyboard can be removed', async () => {
  const { tg, api } = client();
  tg.seed(5, 77, 'old', null);
  assert.equal(await edit(api, { chatId: 5, messageId: 77, text: 'new' }), 'ok');
  assert.equal(await edit(api, { chatId: 5, messageId: 77, text: 'new' }), 'same');
  tg.fail('editMessageText', { kind: '400', description: EDIT_NOT_FOUND });
  assert.equal(await edit(api, { chatId: 5, messageId: 78, text: 'x' }), 'gone');
  tg.fail('editMessageText', { kind: '403' });
  await assert.rejects(edit(api, { chatId: 5, messageId: 77, text: 'y' }));

  tg.fail('editMessageText', { kind: '400', description: EDIT_NOT_FOUND });
  const id = await editOrSend(api, { chatId: 5, messageId: 79, text: 'again', keyboard: [[{ text: 'Дальше', data: 'n' }]] });
  assert.ok(id >= 1000);
  assert.equal(tg.of('sendMessage').at(-1)!.params.protect_content, true);

  assert.equal(await editKeyboard(api, { chatId: 5, messageId: 77, keyboard: null }), 'ok');
  assert.deepEqual(tg.of('editMessageReplyMarkup').at(-1)!.params.reply_markup, { inline_keyboard: [] });
});

test('answer() and remove() never throw: «query is too old» and «message to delete not found» are skipped', async () => {
  const { tg, api } = client();
  tg.fail('answerCallbackQuery', { kind: '400', description: QUERY_TOO_OLD });
  assert.equal(await answer(api, { id: 'q1', text: 'Верно.' }), false);
  assert.equal(await answer(api, { id: 'q2', text: 'Неверно.', alert: true }), true);
  assert.deepEqual(tg.of('answerCallbackQuery').at(-1)!.params, { callback_query_id: 'q2', text: 'Неверно.', show_alert: true });
  tg.fail('deleteMessage', { kind: '400', description: DELETE_NOT_FOUND });
  assert.equal(await remove(api, 1, 2), false);
  assert.equal(await remove(api, 1, 3), true);
  assert.equal(await remove(api, 1, null), false);
});

test('error classifiers', () => {
  const e = (code: number, description: string) => new TelegramError('m', code, description, 'api');
  assert.ok(isNotModified(e(400, 'Bad Request: message is not modified: specified new message content')));
  assert.ok(isMessageGone(e(400, EDIT_NOT_FOUND)));
  assert.ok(isMessageGone(e(400, "Bad Request: message can't be edited")));
  assert.ok(isMessageGone(e(400, DELETE_NOT_FOUND)));
  assert.ok(isQueryTooOld(e(400, QUERY_TOO_OLD)));
  assert.ok(isChatGone(e(400, 'Bad Request: chat not found')));
  assert.ok(!isNotModified(e(403, 'message is not modified')));
  const migrated = new TelegramError('sendMessage', 400, 'Bad Request: group chat was upgraded to a supergroup chat', 'api', undefined, -1001234);
  assert.equal(migrated.migrateTo, -1001234);
});

test('upload(): multipart with JSON fields, never repeated after a timeout', async () => {
  const { tg, api } = client();
  await api.upload('setMyProfilePhoto', { photo: { type: 'static', photo: 'attach://avatar' } },
    { avatar: { name: 'avatar.jpg', type: 'image/jpeg', bytes: new Uint8Array([0xff, 0xd8, 0xff, 0xd9]) } });
  const call = tg.of('setMyProfilePhoto')[0];
  assert.deepEqual(call.params.photo, { type: 'static', photo: 'attach://avatar' });
  assert.deepEqual(call.params.avatar, { file: 'avatar.jpg', type: 'image/jpeg', size: 4 });
  tg.fail('setMyProfilePhoto', { kind: 'timeout' });
  await assert.rejects(api.upload('setMyProfilePhoto', { photo: { type: 'static', photo: 'attach://avatar' } },
    { avatar: { name: 'a.jpg', type: 'image/jpeg', bytes: new Uint8Array([1]) } }));
  assert.equal(tg.of('setMyProfilePhoto').length, 2);
});

test('inlineMarkup maps data, url and style', () => {
  assert.deepEqual(inlineMarkup([[{ text: 'A', data: 'x' }, { text: 'B', url: 'https://e.example/', style: 'primary' }]]), {
    inline_keyboard: [[{ text: 'A', callback_data: 'x' }, { text: 'B', url: 'https://e.example/', style: 'primary' }]],
  });
});
