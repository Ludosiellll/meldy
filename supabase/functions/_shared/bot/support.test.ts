// Support through the bot (support.ts; migration 20261109090100_bot_support.sql): writing — `/support`, the site's
// `/start support`, a reply to the prompt from an unlinked and a linked chat, a group, too long, not a text, the limits,
// a redelivered update; the one rule that makes a message a support message, and that such a reply is never a study
// answer; the author's chat — the one-time claim by the username's hash (any letter case, a private chat only, once),
// the queue that waits and is delivered after it, oldest first and 10 a tick; the author's reply relayed, refused by
// Telegram, to a service message, by a stranger; a deletion request and its cancel; the tick's failures; nothing of a
// person in the log. Fake Telegram, fake database (fixtures/fake_support.ts), the whole function through the harness.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { t, visibleText, WORD_JOINER } from './html.ts';
import { lintMessage } from './lint.ts';
import { STUBS, type Ctx, type TgUpdate } from './router.ts';
import {
  answer, createSupport, isSupportNotice, isSupportPrompt, noCommands, notice, ownerClaim, parseClaim, SUPPORT_LIMIT, SUPPORT_PROMPTS, type SupportRow,
} from './support.ts';
import { createTelegram, type Keyboard, type TgMessage, type TgUser } from './tg.ts';
import { runTick } from './tick.ts';
import { DbError } from './db.ts';
import { fakeDb } from './fixtures/fake_db.ts';
import { fakeSupportDb, LEASE_MS, OWNER_USERNAME, usernameHash } from './fixtures/fake_support.ts';
import { fakeTelegram, TEST_TOKEN } from './fixtures/fake_telegram.ts';
import { harness, LOGS, type Harness } from './fixtures/harness.ts';
import { NOW, TG, USER } from './fixtures/scenario.ts';
import { matchSnapshots, type Shot } from './fixtures/snapshot.ts';
import { botMessage, GROUP, message, uid } from './fixtures/updates.ts';
import * as W from './words.ts';

/** Invented Telegram ids: the author, someone with no Meldy account, a stranger. */
const OWNER = 700900;
const SENDER = 700300;
const STRANGER = 700400;
const ACCOUNT = 'c1c2c3d4-0000-4000-8000-0000000000aa';
const MIN = 60_000;
const HOUR = 60 * MIN;

const words = (html: string) => visibleText(html).replace(/\u00a0/g, ' ');
const person = (id: number, extra: Partial<TgUser> = {}): TgUser => ({ id, is_bot: false, first_name: 'Анна', language_code: 'ru', ...extra });
const owner = (extra: Partial<TgUser> = {}) => person(OWNER, { first_name: 'Автор', username: OWNER_USERNAME, ...extra });

/** A private message of `from`: a text (or none, with `extra`), maybe a reply to a message of the bot. */
function say(from: TgUser, text: string | undefined, opts: { replyTo?: TgMessage; extra?: Partial<TgMessage> } = {}): TgUpdate {
  return { update_id: uid(), message: message(text, { from: from.id, replyTo: opts.replyTo, extra: { from, ...(opts.extra ?? {}) } }) };
}

function setup(options: Parameters<typeof harness>[0] = {}) {
  const h = harness({ ...options, extraPorts: { support: createSupport() } });
  const sup = fakeSupportDb(h.fdb, () => h.now);
  const sentTo = (chatId: number) => h.tg.of('sendMessage').filter((c) => c.params.chat_id === chatId).map((c) => c.params);
  /** The bot's messages in a chat, as Telegram would hand them back in `reply_to_message` (plain text). */
  const inChat = (chatId: number) => [...h.tg.messages.values()].filter((m) => m.chatId === chatId)
    .map((m) => botMessage(m.messageId, visibleText(m.text), chatId));
  const lastIn = (chatId: number) => inChat(chatId).at(-1)!;
  /** One tick through the function; its numbers as the beat got them. */
  async function tick(): Promise<Record<string, number>> {
    await h.tick();
    await Promise.all(h.waits.splice(0));
    return h.fdb.beats.at(-1)!;
  }
  /** `/support`, then a reply to the prompt. */
  async function write(from: TgUser, text: string): Promise<void> {
    await h.post(say(from, '/support'));
    await h.post(say(from, text, { replyTo: lastIn(from.id) }));
  }
  /** The author presses «Старт»: the chat is bound. */
  const claim = () => h.post(say(owner(), '/start'));
  return { h, sup, sentTo, inChat, lastIn, tick, write, claim };
}

const rpcCalls = (h: Harness, fn: string) => h.fdb.of(fn).length;

// ─────────────────────────────────────────── words ───────────────────────────────────────────

test('every support message passes the linter and matches its snapshot', () => {
  const name = 'Анна Петрова';
  const text = 'Не открывается экзамен: пишет «нет доступа».';
  const row: SupportRow = { id: 1, kind: 'message', name, username: 'anna_p', linked: true, text };
  const shot = (label: string, html: string, user: string[] = [], keyboard: Keyboard | null = null, chat: 'private' | 'group' = 'private'): Shot => {
    const problems = lintMessage({ text: html, keyboard, user, chat });
    assert.deepEqual(problems, [], `${label}: ${problems.join('; ')}`);
    return { text: html, keyboard };
  };
  /** A sentence of words.ts as support.ts sends it. */
  const typed = (said: string) => t(said);
  const at = Date.UTC(2026, 10, 9, 9, 0);
  matchSnapshots('support', {
    prompt: shot('prompt', typed(W.SUPPORT_PROMPT)),
    sent: shot('sent', typed(W.SUPPORT_SENT)),
    text_only: shot('text_only', typed(W.SUPPORT_TEXT_ONLY)),
    too_long: shot('too_long', typed(W.SUPPORT_TOO_LONG)),
    slow_hour: shot('slow_hour', typed(W.SUPPORT_SLOW_HOUR)),
    slow_day: shot('slow_day', typed(W.SUPPORT_SLOW_DAY)),
    group: shot('group', typed(W.SUPPORT_GROUP), [], [[{ text: W.SUPPORT_WRITE, url: 'https://t.me/Meldyteach_bot?start=support' }]], 'group'),
    claimed: shot('claimed', typed(W.SUPPORT_CLAIMED)),
    notice: shot('notice', notice(row, 'Europe/Minsk'), [name, text, '@anna_p']),
    notice_no_account: shot('notice_no_account', notice({ ...row, username: null, linked: false }, 'Europe/Minsk'), [name, text]),
    deletion: shot('deletion', notice({ id: 2, kind: 'deletion', userId: ACCOUNT, at }, 'Europe/Minsk')),
    deletion_cancel: shot('deletion_cancel', notice({ id: 3, kind: 'deletion_cancel', userId: ACCOUNT, at }, 'Europe/Minsk')),
    answer: shot('answer', answer('Исправил, попробуйте ещё раз.'), ['Исправил, попробуйте ещё раз.']),
    delivered: shot('delivered', typed(W.SUPPORT_DELIVERED)),
    not_delivered: shot('not_delivered', typed(W.SUPPORT_NOT_DELIVERED)),
    service: shot('service', typed(W.SUPPORT_SERVICE)),
    gone: shot('gone', typed(W.SUPPORT_GONE)),
    reply_long: shot('reply_long', typed(W.SUPPORT_REPLY_LONG)),
  });
  assert.equal(words(notice(row, 'Europe/Minsk')),
    `Поддержка · Анна Петрова · @anna_p · аккаунт Meldy: есть\n${text}\n\nОтветьте на это сообщение, и я перешлю ответ.`);
  assert.equal(words(notice({ ...row, username: null, linked: false }, 'Europe/Minsk')).split('\n')[0], 'Поддержка · Анна Петрова · аккаунт Meldy: нет');
  assert.equal(words(notice({ id: 2, kind: 'deletion', userId: ACCOUNT, at }, 'Europe/Minsk')), `Запрос на удаление аккаунта · id ${ACCOUNT} · 9 ноября`);
  assert.equal(words(notice({ id: 3, kind: 'deletion_cancel', userId: ACCOUNT, at }, 'Europe/Minsk')), `Запрос на удаление аккаунта отменён · id ${ACCOUNT}`);
  // The day is the zone's: 22:30 UTC on the 9th is already the 10th in Minsk.
  assert.equal(words(notice({ id: 2, kind: 'deletion', userId: ACCOUNT, at: Date.UTC(2026, 10, 9, 22, 30) }, 'Europe/Minsk')).slice(-9), '10 ноября');
  assert.equal(words(answer('Да <b>нет</b> & всё')), 'Ответ автора Meldy:\nДа <b>нет</b> & всё', 'the author\'s text is escaped, not parsed');
  assert.equal(W.SUPPORT_TEXT_MAX, 2000);
  assert.ok(W.SUPPORT_TOO_LONG.includes('2\u00a0000') && W.SUPPORT_REPLY_LONG.includes('4\u00a0000'));
  assert.ok(W.HELP.includes('/support — написать в поддержку'), '/help names support in one line');
  assert.deepEqual(W.PROFILE.commands.at(-1), { command: 'support', description: 'Написать в поддержку' });
});

test('the rule: a reply to the prompt, to one of its two refusals or to an answer of the author; nothing else', () => {
  assert.deepEqual(SUPPORT_PROMPTS, [W.SUPPORT_PROMPT, W.SUPPORT_TOO_LONG, W.SUPPORT_TEXT_ONLY]);
  for (const text of SUPPORT_PROMPTS) assert.ok(isSupportPrompt(text), text);
  assert.ok(isSupportPrompt('Ответ автора Meldy:\nИсправил.'));
  for (const text of [W.SUPPORT_SENT, W.SUPPORT_SLOW_HOUR, W.SUPPORT_GROUP, W.TIME_PROMPT, W.BUTTONS_ONLY, W.SUPPORT_CLAIMED, '']) assert.ok(!isSupportPrompt(text), text);
  assert.ok(isSupportNotice('Поддержка · Анна · аккаунт Meldy: нет\nТекст'));
  assert.ok(isSupportNotice(`Запрос на удаление аккаунта · id ${ACCOUNT} · 9 ноября`));
  assert.ok(isSupportNotice(`Запрос на удаление аккаунта отменён · id ${ACCOUNT}`));
  for (const text of [W.SUPPORT_PROMPT, 'Поддержка', W.SUPPORT_CLAIMED, 'Ответ автора Meldy:\nx']) assert.ok(!isSupportNotice(text), text);
});

test('a sender\'s words in the author\'s chat: a command no tap can run, a name that is no link and no second field', () => {
  assert.equal(noCommands('нажмите /stop и /settings@Meldyteach_bot'), `нажмите /${WORD_JOINER}stop и /${WORD_JOINER}settings@Meldyteach_bot`);
  assert.equal(noCommands('/start'), `/${WORD_JOINER}start`);
  const link = 'страница https://ludosiel-studyforge.hf.space/exams/c/1 и t.me/x/y, дробь 1/2';
  assert.equal(noCommands(link), link, 'a link\'s slashes stay');
  const html = notice({ id: 1, kind: 'message', name: 'Иван · аккаунт Meldy: есть\nt.me/x @adm', username: null, linked: false, text: '<b>жирно</b> & /stop' }, 'Europe/Minsk');
  const head = words(html).split('\n')[0];
  assert.equal(head.split(' · ').length, 3, 'the name holds no «·»: Поддержка · name · аккаунт');
  assert.ok(head.endsWith(' · аккаунт Meldy: нет'));
  assert.ok(!/t\.me\/x/.test(head) && head.includes(`t.${WORD_JOINER}me/${WORD_JOINER}x`), 'the name is inert');
  assert.ok(html.includes('&lt;b&gt;жирно&lt;') && html.includes('&amp;') && !html.includes('<b>жирно'), 'the text is escaped, never parsed');
  assert.ok(html.includes(`/${WORD_JOINER}stop`));
  const long = notice({ id: 1, kind: 'message', name: 'Я'.repeat(200), username: null, linked: true, text: 'x' }, 'Europe/Minsk');
  assert.equal([...words(long).split('\n')[0]].length, 'Поддержка · '.length + 64 + ' · аккаунт Meldy: есть'.length);
  assert.equal(words(notice({ id: 1, kind: 'message', name: null, username: null, linked: true, text: 'x' }, 'Europe/Minsk')).split('\n')[0],
    'Поддержка · без имени · аккаунт Meldy: есть');
});

// ─────────────────────────────────────────── writing ───────────────────────────────────────────

test('an unlinked chat: /support → the ForceReply prompt; a text reply is kept, confirmed, and nothing else answers it', async () => {
  const s = setup();
  const anna = person(SENDER, { first_name: 'Анна', last_name: 'Петрова', username: 'anna_p' });
  await s.h.post(say(anna, '/support'));
  const prompt = s.sentTo(SENDER).at(-1)!;
  assert.equal(words(prompt.text), W.SUPPORT_PROMPT);
  assert.deepEqual(prompt.reply_markup, { force_reply: true, input_field_placeholder: W.SUPPORT_PLACEHOLDER });
  assert.equal(prompt.protect_content, true);
  assert.equal(rpcCalls(s.h, 'bot_support_add'), 0);
  assert.equal(rpcCalls(s.h, 'bot_whoami'), 0, 'the prompt needs no account');

  await s.h.post(say(anna, '  Не открывается экзамен.  ', { replyTo: s.lastIn(SENDER) }));
  assert.equal(words(s.sentTo(SENDER).at(-1)!.text), 'Передал. Ответ придёт сюда.');
  assert.equal(s.sentTo(SENDER).length, 2, 'the prompt and the confirmation: no M1');
  assert.equal(s.sup.rows.length, 1);
  const row = s.sup.rows[0];
  assert.deepEqual([row.kind, row.chatId, row.userId, row.name, row.username, row.text, row.sentAt],
    ['message', SENDER, null, 'Анна Петрова', 'anna_p', 'Не открывается экзамен.', null]);
  assert.equal(rpcCalls(s.h, 'bot_whoami'), 0);
  assert.equal(s.h.portCalls.length, 0, 'no port saw the reply');
});

test('the site\'s deep link /start support: the prompt, linked or not, and never a link code', async () => {
  const s = setup();
  await s.h.post(say(person(SENDER), '/start support'));
  assert.equal(words(s.sentTo(SENDER).at(-1)!.text), W.SUPPORT_PROMPT);
  s.h.linked();
  await s.h.post(say(person(TG), '/start support'));
  assert.equal(words(s.sentTo(TG).at(-1)!.text), W.SUPPORT_PROMPT);
  assert.ok(s.sentTo(TG).at(-1)!.reply_markup.force_reply);
  assert.equal(rpcCalls(s.h, 'bot_link_claim'), 0, 'not counted as a failed code');
  await s.h.post(say(person(SENDER), '/start Support'));
  assert.equal(rpcCalls(s.h, 'bot_link_claim'), 1, 'any other payload is a code, as before');
});

test('a linked chat: kept with its account; a support reply is never a study answer, a file, a voice or a prompt\'s answer', async () => {
  const s = setup({ sessionTakesText: true, filesTake: true });
  s.h.linked();
  const student = person(TG);
  // An open «Другое время» prompt (bot.links.prompt) and a session that takes typed answers: neither gets the reply.
  s.h.fdb.link(TG)!.prompt = { kind: 'time', promptId: 555, targetId: null, from: 'settings', at: Math.floor(s.h.now / 1000) };
  await s.h.post(say(student, '/support'));
  const prompt = s.lastIn(TG);
  await s.h.post(say(student, '19:45', { replyTo: prompt }));
  assert.equal(words(s.sentTo(TG).at(-1)!.text), W.SUPPORT_SENT);
  assert.deepEqual([s.sup.rows[0].text, s.sup.rows[0].userId], ['19:45', USER]);
  assert.equal(s.h.fdb.link(TG)!.remindAt, 20 * 60, '«19:45» did not set the time');
  assert.equal(s.h.portCalls.length, 0, 'the session port never saw the text');
  assert.equal(rpcCalls(s.h, 'bot_whoami'), 0);
  // A file and a voice note in reply to the prompt: text only; the file and voice ports are not asked.
  await s.h.post(say(student, undefined, { replyTo: prompt, extra: { document: { file_id: 'F1', file_name: 'bank.docx' } } }));
  assert.equal(words(s.sentTo(TG).at(-1)!.text), 'Пока принимаю только текст.');
  await s.h.post(say(student, undefined, { replyTo: prompt, extra: { voice: { file_id: 'V1', duration: 3 } } }));
  assert.equal(words(s.sentTo(TG).at(-1)!.text), W.SUPPORT_TEXT_ONLY);
  assert.equal(s.h.portCalls.length, 0);
  assert.equal(s.sup.rows.length, 1);
  // The same text without the reply is the session's, as before.
  await s.h.post(say(student, '32'));
  assert.deepEqual(s.h.portCalls.at(-1), { port: 'session', fn: 'text', args: ['32'] });
  assert.equal(s.sup.rows.length, 1);
});

test('a group chat: /support gets one line and a button to the private chat, once an hour; nothing is kept', async () => {
  const s = setup();
  const inGroup = (text: string, replyTo?: TgMessage): TgUpdate =>
    ({ update_id: uid(), message: message(text, { from: SENDER, chatId: GROUP, type: 'supergroup', replyTo, extra: { from: owner({ id: SENDER }) } }) });
  const first = inGroup('/support@Meldyteach_bot');
  await s.h.post(first);
  const line = s.sentTo(GROUP);
  assert.equal(line.length, 1);
  assert.equal(words(line[0].text), 'Напишите мне в личные сообщения.');
  assert.deepEqual(line[0].reply_markup.inline_keyboard, [[{ text: 'Написать в поддержку', url: 'https://t.me/Meldyteach_bot?start=support' }]]);
  assert.equal(line[0].reply_parameters.message_id, first.message!.message_id);
  await s.h.post(inGroup('/support'));
  await s.h.post(inGroup('/start@Meldyteach_bot support'));
  assert.equal(s.sentTo(GROUP).length, 1, 'once an hour per group');
  // A reply in the group to a message that reads as the prompt is the group's talk: not read, not kept.
  await s.h.post(inGroup('Не работает', botMessage(900, W.SUPPORT_PROMPT, GROUP)));
  s.h.advance(HOUR + 1);
  await s.h.post(inGroup('/support'));
  assert.equal(s.sentTo(GROUP).length, 2);
  assert.equal(s.sup.rows.length, 0);
  assert.equal(s.h.fdb.calls.filter((c) => c.fn.startsWith('bot_support')).length, 0, 'no claim from a group either');
});

test('too long: 2 001 characters are refused and not kept; 2 000 are; a reply to the refusal is a support message', async () => {
  const s = setup();
  const anna = person(SENDER);
  await s.h.post(say(anna, '/support'));
  await s.h.post(say(anna, 'я'.repeat(2001), { replyTo: s.lastIn(SENDER) }));
  const refusal = s.sentTo(SENDER).at(-1)!;
  assert.equal(words(refusal.text), 'Сообщение длиннее 2 000 знаков. Сократите его и отправьте ещё раз.');
  assert.ok(refusal.reply_markup.force_reply, 'it asks again');
  assert.equal(s.sup.rows.length, 0);
  assert.equal(rpcCalls(s.h, 'bot_support_add'), 0, 'nothing reached the database');
  await s.h.post(say(anna, '😀'.repeat(2000), { replyTo: s.lastIn(SENDER) }));
  assert.equal(words(s.sentTo(SENDER).at(-1)!.text), W.SUPPORT_SENT, '2 000 characters (code points) fit');
  assert.equal([...s.sup.rows[0].text!].length, 2000);
});

test('not a text: a photo, a sticker, a voice or a file in reply → «Пока принимаю только текст.», nothing kept; then a text is', async () => {
  const s = setup();
  const anna = person(SENDER);
  await s.h.post(say(anna, '/support'));
  for (const extra of [{ photo: [{ file_id: 'P1' }], caption: 'вот' }, { sticker: { file_id: 'S1' } }, { voice: { file_id: 'V1' } }, { document: { file_id: 'F1' } }]) {
    await s.h.post(say(anna, undefined, { replyTo: s.lastIn(SENDER), extra: extra as Partial<TgMessage> }));
    const refusal = s.sentTo(SENDER).at(-1)!;
    assert.equal(words(refusal.text), 'Пока принимаю только текст.');
    assert.ok(refusal.reply_markup.force_reply);
  }
  assert.equal(s.sup.rows.length, 0);
  assert.equal(s.h.portCalls.length, 0, 'not offered to the file or the voice port');
  await s.h.post(say(anna, 'Текстом', { replyTo: s.lastIn(SENDER) }));
  assert.equal(s.sup.rows.length, 1, 'a reply to the refusal is a support message');
});

test('the limits, counted in the database: 5 an hour and 20 a day per chat, refused politely; another chat is not held', async () => {
  const s = setup();
  const anna = person(SENDER);
  await s.h.post(say(anna, '/support'));
  const prompt = s.lastIn(SENDER);
  const send = async (n: number) => {
    await s.h.post(say(anna, `Сообщение ${n}`, { replyTo: prompt }));
    return words(s.sentTo(SENDER).at(-1)!.text);
  };
  for (let n = 1; n <= 5; n += 1) assert.equal(await send(n), W.SUPPORT_SENT);
  assert.equal(await send(6), 'За час можно отправить пять сообщений. Напишите, пожалуйста, через час.');
  assert.equal(s.sup.rows.length, 5);
  await s.write(person(STRANGER), 'Из другого чата');
  assert.equal(s.sup.rows.length, 6);
  for (let batch = 1; batch <= 3; batch += 1) {
    s.h.advance(HOUR + MIN);
    for (let n = 1; n <= 5; n += 1) assert.equal(await send(batch * 10 + n), W.SUPPORT_SENT);
  }
  s.h.advance(HOUR + MIN);
  assert.equal(await send(99), 'За сутки можно отправить двадцать сообщений. Напишите, пожалуйста, завтра.');
  assert.equal(s.sup.rows.filter((r) => r.chatId === SENDER).length, 20);
  s.h.advance(21 * HOUR);
  assert.equal(await send(100), W.SUPPORT_SENT, 'a day after the first ones');
});

test('the same update again (its confirmation failed): kept once, confirmed once', async () => {
  const s = setup();
  const anna = person(SENDER);
  await s.h.post(say(anna, '/support'));
  const update = say(anna, 'Один раз', { replyTo: s.lastIn(SENDER) });
  s.h.tg.fail('sendMessage', { kind: 'timeout' });
  assert.equal((await s.h.post(update)).status, 503, 'Telegram will bring it again');
  assert.equal(s.sup.rows.length, 1);
  s.h.advance(31_000);
  assert.equal((await s.h.post(update)).status, 200);
  assert.equal(s.sup.rows.length, 1);
  assert.equal(s.inChat(SENDER).filter((m) => words(m.text!) === W.SUPPORT_SENT).length, 1, 'one confirmation reached the chat');
});

// ─────────────────────────────────────────── the author's chat ───────────────────────────────────────────

test('the claim: the matching username in any letter case, in a private chat, once — and the update is handled as usual', async () => {
  const s = setup();
  assert.equal(s.sup.config.usernameHash, usernameHash('MELDY_OWNER_TEST'), 'the hash is of the lowercased handle');
  // A group never claims, whoever writes there; a user without a username is not even shown to the database.
  await s.h.post({ update_id: uid(), message: message('/start@Meldyteach_bot', { from: OWNER, chatId: GROUP, type: 'supergroup', extra: { from: owner() } }) });
  await s.h.post(say(person(STRANGER), '/start'));
  assert.equal(rpcCalls(s.h, 'bot_support_owner'), 0);
  // Another username: no claim; asked about once an hour per sender.
  await s.h.post(say(person(STRANGER, { username: 'meldy_owner_tes' }), '/start'));
  await s.h.post(say(person(STRANGER, { username: 'meldy_owner_tes' }), '/help'));
  assert.equal(rpcCalls(s.h, 'bot_support_owner'), 1);
  assert.equal(s.sup.config.chatId, null);
  assert.ok(!s.sentTo(STRANGER).some((p) => words(p.text) === W.SUPPORT_CLAIMED));

  await s.h.post(say(owner({ username: 'Meldy_Owner_TEST' }), '/start'));
  assert.deepEqual([s.sup.config.chatId, s.sup.config.tgUserId], [OWNER, OWNER]);
  const told = s.sentTo(OWNER).map((p) => words(p.text));
  assert.equal(told[0], 'Сюда будут приходить сообщения в поддержку Meldy. Чтобы ответить человеку, ответьте на его сообщение.');
  assert.match(told[1], /^Здесь будет план на каждый день/, '/start is still answered (M1: this Telegram has no Meldy account)');
  assert.equal(told.length, 2);

  // Bound: this instance never asks again, and the line is never said again.
  const asked = rpcCalls(s.h, 'bot_support_owner');
  await s.h.post(say(owner(), '/start'));
  await s.h.post(say(owner(), '/help'));
  await s.h.post(say(person(STRANGER, { username: OWNER_USERNAME }), '/start'));
  assert.equal(rpcCalls(s.h, 'bot_support_owner'), asked);
  assert.equal(s.h.tg.of('sendMessage').filter((c) => words(c.params.text) === W.SUPPORT_CLAIMED).length, 1, 'exactly once');
});

test('no second claim once the ids are set: whoever carries the username later gets nothing (a fresh instance asks once)', async () => {
  const s = setup();
  await s.claim();
  // A new instance of the function knows nothing yet; the username now belongs to someone else.
  const ft = fakeTelegram({ now: () => s.h.now });
  const ctx = {
    tg: createTelegram({ token: TEST_TOKEN, fetch: ft.fetch, sleep: async () => {} }), db: s.h.fdb.db, site: W.SITE, botUsername: W.BOT_USERNAME,
    now: () => s.h.now, hourly: () => true,
  } as Ctx;
  const fresh = ownerClaim(() => s.h.now);
  const taker = say(person(STRANGER, { username: OWNER_USERNAME }), '/start');
  const before = rpcCalls(s.h, 'bot_support_owner');
  await fresh(ctx, taker);
  await fresh(ctx, taker);
  await fresh(ctx, say(owner(), '/start'));
  assert.equal(rpcCalls(s.h, 'bot_support_owner'), before + 1, 'one call told the instance that a chat is bound');
  assert.equal(ft.calls.length, 0, 'nothing is said');
  assert.deepEqual([s.sup.config.chatId, s.sup.config.tgUserId], [OWNER, OWNER], 'the binding did not move');
  // A press in a private chat claims as a message does (a rebind by hand: the ids set to null).
  s.sup.config.chatId = null;
  s.sup.config.tgUserId = null;
  const again = ownerClaim(() => s.h.now);
  await again(ctx, { update_id: uid(), callback_query: { id: 'q1', from: owner(), data: 'st|time', message: botMessage(5, 'x', OWNER) } });
  assert.deepEqual([s.sup.config.chatId, s.sup.config.tgUserId], [OWNER, OWNER]);
  assert.deepEqual(ft.of('sendMessage').map((c) => [c.params.chat_id, words(c.params.text)]), [[OWNER, W.SUPPORT_CLAIMED]]);
});

test('the claim never fails an update: the database down or without the migration, the update is handled and the instance waits', async () => {
  const h = harness();
  // Without the migration (the fake database knows no bot_support_owner): quiet for ten minutes, no log line.
  const start = LOGS.length;
  await h.post(say(owner(), '/help'));
  await h.post(say(owner(), '/help'));
  assert.equal(h.tg.of('sendMessage').length, 2, '/help is answered');
  assert.equal(h.fdb.of('bot_support_owner').length, 1);
  assert.ok(!LOGS.slice(start).some((line) => line.includes('"kind":"support"')));
  h.advance(10 * MIN + 1);
  await h.post(say(owner(), '/help'));
  assert.equal(h.fdb.of('bot_support_owner').length, 2);
  // The database down: logged by name, a minute's pause, the update still answered.
  const s = setup();
  s.h.fdb.fail('bot_support_owner', new DbError('bot_support_owner', 0, 'timeout'));
  assert.equal((await s.h.post(say(owner(), '/help'))).status, 200);
  await s.h.post(say(owner(), '/help'));
  assert.equal(rpcCalls(s.h, 'bot_support_owner'), 1);
  assert.equal(s.sup.config.chatId, null);
  s.h.advance(MIN + 1);
  await s.h.post(say(owner(), '/help'));
  assert.equal(s.sup.config.chatId, OWNER, 'claimed a minute later');
  // No hash set: nobody can claim.
  const off = setup();
  off.sup.config.usernameHash = null;
  await off.h.post(say(owner(), '/start'));
  await off.h.post(say(owner(), '/start'));
  assert.equal(rpcCalls(off.h, 'bot_support_owner'), 1);
  assert.equal(off.sup.config.chatId, null);
});

test('nothing claimed: the sender is told «Передал…», the message waits; after the claim the tick delivers it, once', async () => {
  const s = setup();
  await s.write(person(SENDER, { first_name: 'Анна', username: 'anna_p' }), 'Когда будет новый экзамен?');
  assert.equal(words(s.sentTo(SENDER).at(-1)!.text), 'Передал. Ответ придёт сюда.');
  let stats = await s.tick();
  assert.equal(stats.support_waiting, 1, 'the tick\'s numbers say that one waits');
  assert.equal(stats.support_sent, undefined);
  assert.equal(s.sup.rows[0].sentAt, null);
  assert.equal(s.sentTo(OWNER).length, 0);

  await s.claim();
  stats = await s.tick();
  assert.equal(stats.support_sent, 1);
  assert.equal(stats.support_waiting, undefined);
  const got = s.sentTo(OWNER).at(-1)!;
  assert.equal(words(got.text), 'Поддержка · Анна · @anna_p · аккаунт Meldy: нет\nКогда будет новый экзамен?\n\nОтветьте на это сообщение, и я перешлю ответ.');
  assert.equal(got.disable_notification, false, 'the author\'s chat rings');
  // The one open message of the bot: the author copies a person's words or an account's id from their own chat.
  assert.equal(got.protect_content, false);
  const row = s.sup.rows[0];
  assert.deepEqual([row.sentAt !== null, row.ownerChatId, row.ownerMessageId], [true, OWNER, s.lastIn(OWNER).message_id]);
  s.h.advance(MIN);
  stats = await s.tick();
  assert.equal(stats.support_sent, undefined, 'sent once');
  assert.equal(s.sentTo(OWNER).filter((p) => words(p.text).startsWith('Поддержка')).length, 1);
});

test('the queue: oldest first, at most 10 a tick, paced; only the first of a tick rings', async () => {
  const s = setup();
  await s.claim();
  for (const [i, id] of [SENDER, STRANGER, TG].entries()) {
    await s.h.post(say(person(id), '/support'));
    const prompt = s.lastIn(id);
    for (let n = 1; n <= 4; n += 1) await s.h.post(say(person(id), `№ ${i * 4 + n}`, { replyTo: prompt }));
  }
  assert.equal(s.sup.rows.length, 12);
  const before = s.sentTo(OWNER).length;
  let stats = await s.tick();
  assert.equal(stats.support_sent, SUPPORT_LIMIT);
  const first = s.sentTo(OWNER).slice(before);
  assert.deepEqual(first.map((p) => words(p.text).split('\n')[1]), Array.from({ length: 10 }, (_, i) => `№ ${i + 1}`));
  assert.deepEqual(first.map((p) => p.disable_notification), [false, ...Array(9).fill(true)]);
  assert.deepEqual(s.h.fdb.of('bot_support_claim').at(-1)!.args, { p_limit: 10 });
  s.h.advance(MIN);
  stats = await s.tick();
  assert.equal(stats.support_sent, 2);
  assert.deepEqual(s.sentTo(OWNER).slice(before + 10).map((p) => words(p.text).split('\n')[1]), ['№ 11', '№ 12']);
  // The tick's pacer is awaited before every send.
  const d = direct();
  d.sup.config.chatId = OWNER;
  d.sup.config.tgUserId = OWNER;
  for (const id of [SENDER, STRANGER]) d.fdb.db.rpc('bot_support_add', { p_tg_user_id: id, p_chat_id: id, p_message_id: 1, p_text: 'x' });
  let paced = 0;
  assert.deepEqual(await d.port.tick(d.ctx, { deadline: d.clock.now() + 25_000, pace: async () => { paced += 1; } }), { sent: 2 });
  assert.equal(paced, 2);
});

/** The step alone, as quiz.test.ts runs its own: a clock, the fakes and the port. */
function direct() {
  let now = NOW;
  const clock = { now: () => now, advance: (ms: number) => { now += ms; } };
  const fdb = fakeDb({ now: clock.now });
  const sup = fakeSupportDb(fdb, clock.now);
  const ft = fakeTelegram({ now: clock.now });
  const ctx = {
    tg: createTelegram({ token: TEST_TOKEN, fetch: ft.fetch, wait429Sec: 0, sleep: async () => {} }), db: fdb.db, site: W.SITE,
    botUsername: W.BOT_USERNAME, now: clock.now, hourly: () => true,
  } as Ctx;
  const port = createSupport();
  const tick = (left = 25_000) => port.tick(ctx, { deadline: clock.now() + left, pace: async () => {} });
  const add = (chatId: number, text: string, messageId = sup.rows.length + 1) =>
    fdb.db.rpc('bot_support_add', { p_tg_user_id: chatId, p_chat_id: chatId, p_message_id: messageId, p_text: text, p_name: 'Анна', p_username: null });
  const bind = () => {
    sup.config.chatId = OWNER;
    sup.config.tgUserId = OWNER;
  };
  return { clock, fdb, sup, ft, ctx, port, tick, add, bind };
}

// ─────────────────────────────────────────── the author's reply ───────────────────────────────────────────

test('the author\'s reply is relayed to the sender under «Ответ автора Meldy:»; every reply is; the row is answered by the first', async () => {
  const s = setup();
  await s.claim();
  await s.write(person(SENDER), 'Не приходит план.');
  await s.tick();
  const got = s.lastIn(OWNER);
  const whoami = rpcCalls(s.h, 'bot_whoami');
  const reply = say(owner(), 'Проверьте время в /settings <сейчас>.', { replyTo: got });
  await s.h.post(reply);
  const relayed = s.sentTo(SENDER).at(-1)!;
  assert.equal(words(relayed.text), 'Ответ автора Meldy:\nПроверьте время в /settings <сейчас>.');
  assert.match(relayed.text, /&lt;сейчас&gt;/);
  assert.equal(relayed.protect_content, true);
  const confirm = s.sentTo(OWNER).at(-1)!;
  assert.equal(words(confirm.text), 'Отправлено.');
  assert.equal(confirm.reply_parameters.message_id, reply.message!.message_id);
  const answeredAt = s.sup.rows[0].answeredAt;
  assert.equal(answeredAt, s.h.now);
  assert.equal(rpcCalls(s.h, 'bot_whoami'), whoami, 'the reply is not read as anything else');

  s.h.advance(5 * MIN);
  await s.h.post(say(owner(), 'И ещё: обновите страницу.', { replyTo: got }));
  assert.equal(words(s.sentTo(SENDER).at(-1)!.text), 'Ответ автора Meldy:\nИ ещё: обновите страницу.');
  assert.equal(s.sentTo(SENDER).filter((p) => words(p.text).startsWith(W.SUPPORT_ANSWER)).length, 2, 'several replies are all delivered');
  assert.equal(s.sentTo(OWNER).filter((p) => words(p.text) === W.SUPPORT_DELIVERED).length, 2);
  assert.equal(s.sup.rows[0].answeredAt, answeredAt, 'answered by the first');

  // The sender answers the answer: a reply to «Ответ автора Meldy:» is a new support message.
  await s.h.post(say(person(SENDER), 'Спасибо, помогло.', { replyTo: s.lastIn(SENDER) }));
  assert.equal(words(s.sentTo(SENDER).at(-1)!.text), W.SUPPORT_SENT);
  assert.deepEqual(s.sup.rows.map((r) => r.text), ['Не приходит план.', 'Спасибо, помогло.']);
});

test('the sender stopped the bot: Telegram refuses, the author is told, the row is not answered', async () => {
  const s = setup();
  await s.claim();
  await s.write(person(SENDER), 'Вопрос');
  await s.tick();
  const got = s.lastIn(OWNER);
  s.h.tg.fail('sendMessage', { kind: '403' });
  assert.equal((await s.h.post(say(owner(), 'Ответ', { replyTo: got }))).status, 200);
  assert.equal(words(s.sentTo(OWNER).at(-1)!.text), 'Не доставлено: человек остановил бота.');
  assert.equal(s.sup.rows[0].answeredAt, null);
  assert.deepEqual(s.h.fdb.of('bot_chat_event').at(-1)!.args, { tgUserId: SENDER, event: 'blocked' });
  assert.equal(rpcCalls(s.h, 'bot_support_answered'), 0);
  // «chat not found» (a deleted account) reads the same.
  s.h.tg.fail('sendMessage', { kind: '400', description: 'Bad Request: chat not found' });
  await s.h.post(say(owner(), 'Ответ', { replyTo: got }));
  assert.equal(words(s.sentTo(OWNER).at(-1)!.text), W.SUPPORT_NOT_DELIVERED);
  // Started again: the next reply goes through.
  await s.h.post(say(owner(), 'Ответ', { replyTo: got }));
  assert.equal(words(s.sentTo(OWNER).at(-1)!.text), W.SUPPORT_DELIVERED);
  assert.ok(s.sup.rows[0].answeredAt !== null);
});

test('a reply that times out comes again and is relayed; a failed mark or a failed «Отправлено.» never sends the answer twice', async () => {
  const s = setup();
  await s.claim();
  await s.write(person(SENDER), 'Вопрос');
  await s.tick();
  const got = s.lastIn(OWNER);
  const relays = () => s.h.tg.of('sendMessage').filter((c) => c.params.chat_id === SENDER && words(c.params.text).startsWith(W.SUPPORT_ANSWER)).length;
  const confirmed = () => s.sentTo(OWNER).filter((p) => words(p.text) === W.SUPPORT_DELIVERED).length;
  // The relay itself times out: nobody knows whether it went out; the update fails and Telegram brings it again.
  const reply = say(owner(), 'Ответ', { replyTo: got });
  s.h.tg.fail('sendMessage', { kind: 'timeout' });
  assert.equal((await s.h.post(reply)).status, 503);
  assert.equal(confirmed(), 0);
  s.h.advance(31_000);
  assert.equal((await s.h.post(reply)).status, 200);
  assert.deepEqual([relays(), confirmed()], [2, 1], 'two tries of the relay, one «Отправлено.»');
  // The relay went out and the mark fails: the author is told, the update is done, nothing goes out again.
  s.h.fdb.fail('bot_support_answered', new DbError('bot_support_answered', 503, ''));
  const second = say(owner(), 'Ещё', { replyTo: got });
  assert.equal((await s.h.post(second)).status, 200);
  assert.deepEqual([relays(), confirmed()], [3, 2]);
  assert.equal(s.h.fdb.updates.get(second.update_id)!.status, 'done');
  // The relay went out and «Отправлено.» does not (a 429 Telegram asks to wait out): the update is done all the same.
  s.h.tg.fail('sendMessage', { kind: 'ok' }, { kind: '429', retryAfter: 60 });
  const third = say(owner(), 'И ещё', { replyTo: got });
  assert.equal((await s.h.post(third)).status, 200);
  assert.deepEqual([relays(), confirmed()], [4, 3]);
  assert.equal(s.h.fdb.updates.get(third.update_id)!.status, 'done', 'never retried: a retry would relay «И ещё» twice');
});

test('a reply to a service message, to one that is gone, with no text, too long', async () => {
  const s = setup();
  await s.claim();
  s.sup.request(ACCOUNT);
  await s.write(person(SENDER), 'Вопрос');
  await s.tick();
  const [deletion, question] = s.inChat(OWNER).slice(-2);
  await s.h.post(say(owner(), 'Удалю завтра', { replyTo: deletion }));
  assert.equal(words(s.sentTo(OWNER).at(-1)!.text), 'Это служебное сообщение, ответить на него нельзя.');
  await s.h.post(say(owner(), undefined, { replyTo: question, extra: { voice: { file_id: 'V9' } } }));
  assert.equal(words(s.sentTo(OWNER).at(-1)!.text), W.SUPPORT_TEXT_ONLY);
  await s.h.post(say(owner(), 'я'.repeat(4001), { replyTo: question }));
  assert.equal(words(s.sentTo(OWNER).at(-1)!.text), 'Ответ длиннее 4 000 знаков. Сократите его и ответьте ещё раз.');
  assert.equal(s.sentTo(SENDER).filter((p) => words(p.text).startsWith(W.SUPPORT_ANSWER)).length, 0, 'nothing was relayed');
  assert.equal(s.h.portCalls.filter((c) => c.port !== 'group' && c.port !== 'monitor').length, 0, 'the voice port is not asked');
  // After 90 days the row is gone; a reply to its message says so.
  s.sup.rows.splice(0);
  await s.h.post(say(owner(), 'Поздний ответ', { replyTo: question }));
  assert.equal(words(s.sentTo(OWNER).at(-1)!.text), 'Этого сообщения уже нет в очереди, ответ не отправлен.');
});

test('a stranger\'s reply to a message that is not theirs does nothing: only the bound Telegram in the bound chat answers', async () => {
  const s = setup();
  await s.claim();
  await s.write(person(SENDER), 'Секретный вопрос');
  await s.tick();
  const got = s.lastIn(OWNER);
  const relays = () => s.h.tg.of('sendMessage').filter((c) => words(c.params.text).startsWith(W.SUPPORT_ANSWER)).length;
  // The same message id and the same text in the stranger's own chat; the stranger even carries the author's username.
  const fake = botMessage(got.message_id, got.text!, STRANGER);
  const before = s.sentTo(STRANGER).length;
  await s.h.post(say(person(STRANGER, { username: OWNER_USERNAME }), 'Подставной ответ', { replyTo: fake }));
  assert.equal(relays(), 0);
  assert.equal(s.sup.rows[0].answeredAt, null);
  assert.deepEqual(s.h.fdb.of('bot_support_reply').at(-1)!.args, { p_tg_user_id: STRANGER, p_chat_id: STRANGER, p_message_id: got.message_id });
  const said = s.sentTo(STRANGER).slice(before).map((p) => words(p.text));
  assert.ok(!said.some((text) => [W.SUPPORT_DELIVERED, W.SUPPORT_GONE, W.SUPPORT_SERVICE, W.SUPPORT_NOT_DELIVERED].includes(text)));
  assert.match(said[0], /^Здесь будет план/, 'the router goes on as if support were not there (M1 for an unlinked chat)');
  assert.equal(said.length, 1);
  // The linked student replying to such a text gets the usual line, not support's.
  s.h.linked();
  await s.h.post(say(person(TG), 'И я', { replyTo: botMessage(got.message_id, got.text!, TG) }));
  assert.equal(relays(), 0);
  assert.equal(words(s.sentTo(TG).at(-1)!.text), W.BUTTONS_ONLY);
});

// ─────────────────────────────────────────── account deletion requests ───────────────────────────────────────────

test('a deletion request and its cancel reach the author through the same step; neither can be answered', async () => {
  const s = setup();
  await s.claim();
  s.sup.request(ACCOUNT);
  let stats = await s.tick();
  assert.equal(stats.support_sent, 1);
  assert.equal(words(s.sentTo(OWNER).at(-1)!.text), `Запрос на удаление аккаунта · id ${ACCOUNT} · 16 октября`);
  assert.match(s.sentTo(OWNER).at(-1)!.text, new RegExp(`<code>${ACCOUNT}</code>`));
  const asked = s.lastIn(OWNER);
  s.h.advance(MIN);
  s.sup.cancel(ACCOUNT);
  stats = await s.tick();
  assert.equal(stats.support_sent, 1);
  assert.equal(words(s.sentTo(OWNER).at(-1)!.text), `Запрос на удаление аккаунта отменён · id ${ACCOUNT}`);
  for (const target of [asked, s.lastIn(OWNER)]) {
    await s.h.post(say(owner(), 'Принято', { replyTo: target }));
    assert.equal(words(s.sentTo(OWNER).at(-1)!.text), W.SUPPORT_SERVICE);
  }
  assert.equal(rpcCalls(s.h, 'bot_support_answered'), 0);
  // The id goes to the author's chat only.
  for (const call of s.h.tg.of('sendMessage')) if (call.params.chat_id !== OWNER) assert.ok(!call.params.text.includes(ACCOUNT));
});

// ─────────────────────────────────────────── the tick's step ───────────────────────────────────────────

test('the step: a 429 stops it and the rows go later; a 403 leaves every row waiting; a 400 closes one row and the rest go on', async () => {
  const d = direct();
  d.bind();
  await d.add(SENDER, 'первое');
  await d.add(STRANGER, 'второе');
  d.ft.fail('sendMessage', { kind: '429', retryAfter: 30 });
  assert.deepEqual(await d.tick(), { rate_limited: 1 });
  assert.equal(d.ft.of('sendMessage').length, 1, 'the step stopped at the 429');
  d.clock.advance(30_000);
  assert.deepEqual(await d.tick(), {}, 'under the claim\'s lease: nothing is taken twice');
  d.clock.advance(LEASE_MS - 30_000);
  // The author stopped the bot: nothing is closed, nothing is lost.
  d.ft.fail('sendMessage', { kind: '403' });
  assert.deepEqual(await d.tick(), { blocked: 1 });
  assert.deepEqual(d.sup.rows.map((r) => [r.sentAt, r.error]), [[null, null], [null, null]]);
  assert.equal(d.fdb.of('bot_chat_event').length, 0);
  d.clock.advance(MIN);
  // Telegram refuses one message for good: it is closed with its code and does not hold the next.
  d.ft.fail('sendMessage', { kind: '400', description: 'Bad Request: can\'t parse entities' });
  assert.deepEqual(await d.tick(), { failed: 1, sent: 1 });
  assert.deepEqual(d.sup.rows.map((r) => [r.sentAt !== null, r.error]), [[false, 'tg_400'], [true, null]]);
  d.clock.advance(MIN);
  assert.deepEqual(await d.tick(), {});
});

test('the step: a timeout leaves the row for a later tick (at least once); past the deadline rows are left; without the migration, «missing»', async () => {
  const d = direct();
  d.bind();
  await d.add(SENDER, 'первое');
  await d.add(STRANGER, 'второе');
  const logs: string[] = LOGS;
  const start = logs.length;
  d.ft.fail('sendMessage', { kind: 'timeout' });
  assert.deepEqual(await d.tick(), { unknown: 1 });
  assert.equal(d.sup.rows[0].sentAt, null);
  d.clock.advance(MIN);
  assert.deepEqual(await d.tick(-1), { left: 2 }, 'past the deadline nothing is started');
  d.clock.advance(MIN);
  assert.deepEqual(await d.tick(), { sent: 2 });
  assert.deepEqual(d.ft.of('sendMessage').map((c) => words(c.params.text).split('\n')[1]), ['первое', 'первое', 'второе']);
  // The mark that a row went out is tried twice; when both fail the step stops and says so.
  await d.add(TG, 'третье');
  d.clock.advance(MIN);
  d.fdb.fail('bot_support_done', new DbError('bot_support_done', 0, 'timeout'));
  assert.deepEqual(await d.tick(), { sent: 1 }, 'the second try marked it');
  await d.add(TG, 'четвёртое');
  d.clock.advance(MIN);
  d.fdb.fail('bot_support_done', new DbError('bot_support_done', 0, 'timeout'), new DbError('bot_support_done', 0, 'timeout'));
  assert.deepEqual(await d.tick(), { error: 1 });
  // A row the function cannot read is closed, not sent.
  d.fdb.on('bot_support_claim', () => ({ status: 'ok', chat_id: OWNER, tz: 'Europe/Minsk', rows: [{ id: 77, kind: 'other' }, { kind: 'message' }] }));
  assert.deepEqual(await d.tick(), { bad: 1 });
  assert.deepEqual(d.fdb.of('bot_support_done').at(-1)!.args, { p_id: 77, p_error: 'bad_row' });
  for (const line of logs.slice(start)) assert.match(line, /^\{"route":"tick","outcome":"failed","kind":"support","error_name":"[A-Za-z]+"(,"tg_code":0)?\}$/);

  const bare = fakeDb({ now: d.clock.now });
  assert.deepEqual(await createSupport().tick({ ...d.ctx, db: bare.db }, { deadline: d.clock.now() + 25_000, pace: async () => {} }), { missing: 1 });
  bare.fail('bot_support_claim', new DbError('bot_support_claim', 503, ''));
  await assert.rejects(createSupport().tick({ ...d.ctx, db: bare.db }, { deadline: d.clock.now() + 25_000, pace: async () => {} }), DbError);
});

test('what the database hands is read strictly: the claim\'s rows, the chat, the zone', () => {
  assert.deepEqual(parseClaim({ status: 'no_chat', waiting: 3 }), { status: 'no_chat', waiting: 3 });
  assert.deepEqual(parseClaim(null), { status: 'no_chat', waiting: 0 });
  assert.deepEqual(parseClaim({ status: 'ok', chat_id: -5, rows: [] }), { status: 'no_chat', waiting: 0 }, 'never a group');
  const claim = parseClaim({
    status: 'ok', chat_id: OWNER, rows: [
      { id: 1, kind: 'message', name: 'Анна', username: 'not a name', linked: true, text: 'Привет' },
      { id: 2, kind: 'deletion', user_id: ACCOUNT, at: '2026-11-09T09:00:00+00:00' },
      { id: 3, kind: 'deletion_cancel', user_id: 'not-a-uuid', at: '2026-11-09T09:00:00+00:00' },
      { id: 4, kind: 'message', text: '' },
    ],
  });
  assert.deepEqual(claim, {
    status: 'ok', chatId: OWNER, tz: 'Europe/Minsk', bad: [3, 4],
    rows: [{ id: 1, kind: 'message', name: 'Анна', username: null, linked: true, text: 'Привет' }, { id: 2, kind: 'deletion', userId: ACCOUNT, at: Date.UTC(2026, 10, 9, 9) }],
  });
});

test('the step «support» runs in the tick between «flush» and «quiz», and its numbers reach the beat', async () => {
  const order: string[] = [];
  const mark = (name: string) => ({ tick: async () => { order.push(name); return { n: 1 }; } });
  const d = direct();
  const stats = await runTick(d.ctx, { ...STUBS, support: mark('support'), quiz: mark('quiz'), sweep: mark('sweep'), monitor: mark('monitor') }, { sleep: async () => {} });
  assert.deepEqual(order, ['support', 'quiz', 'sweep', 'monitor']);
  assert.equal(stats.support_n, 1);
  assert.equal(d.fdb.beats.at(-1)!.support_n, 1);
  // Without the port (a function built before support) the step does nothing.
  const without = await runTick(d.ctx, STUBS, { sleep: async () => {} });
  assert.ok(!Object.keys(without).some((key) => key.startsWith('support')));
});

test('nothing of a person reaches the log: no name, username, text or id, whatever fails', async () => {
  const start = LOGS.length;
  const s = setup();
  const anna = person(SENDER, { first_name: 'Аннабелла', last_name: 'Тайная', username: 'annabella_secret' });
  s.h.fdb.fail('bot_support_owner', new DbError('bot_support_owner', 503, ''));
  await s.h.post(say(owner(), '/start'));
  s.h.advance(2 * MIN);
  await s.claim();
  await s.h.post(say(anna, '/support'));
  s.h.fdb.fail('bot_support_add', new DbError('bot_support_add', 503, ''));
  const update = say(anna, 'Очень личный текст', { replyTo: s.lastIn(SENDER) });
  assert.equal((await s.h.post(update)).status, 503);
  s.h.advance(31_000);
  await s.h.post(update);
  s.sup.request(ACCOUNT);
  s.h.tg.fail('sendMessage', { kind: 'network' });
  await s.tick();
  s.h.advance(MIN);
  await s.tick();
  const got = s.inChat(OWNER).find((m) => m.text!.includes('Очень личный текст'))!;
  s.h.fdb.fail('bot_support_answered', new DbError('bot_support_answered', 0, 'network'));
  await s.h.post(say(owner(), 'Ответ автора с подробностями', { replyTo: got }));
  const lines = LOGS.slice(start);
  assert.ok(lines.filter((line) => line.includes('"kind":"support"')).length >= 3, 'the failures were logged');
  for (const line of lines) {
    for (const secret of ['Аннабелла', 'Тайная', 'annabella_secret', 'личный', 'подробностями', ACCOUNT, OWNER_USERNAME, String(SENDER), String(OWNER), usernameHash(OWNER_USERNAME)]) {
      assert.ok(!line.includes(secret), `${secret} in ${line}`);
    }
  }
});
