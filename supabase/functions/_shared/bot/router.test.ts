// The router (spec §6.1, §8.1 «Вход и журнал», «Фикстуры»): the HTTP routes and every update the function gets.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseCommand, routeOf, updateKind } from './router.ts';
import { derivedSecret } from './secrets.ts';
import { typo, visibleText } from './html.ts';
import { harness } from './fixtures/harness.ts';
import { TEST_TOKEN } from './fixtures/fake_telegram.ts';
import { CID, DAY, TG, USER } from './fixtures/scenario.ts';
import { botMessage, channelPost, document, edited, GROUP, groupCommand, member, migrate, OTHER_TG, press, privateText, voice } from './fixtures/updates.ts';
import * as W from './words.ts';

const CODE = `L${'a1'.repeat(16)}`;
const words = (text: string) => visibleText(text).replace(/ /g, ' ');
const sent = (h: ReturnType<typeof harness>) => h.tg.of('sendMessage').map((c) => c.params);
const lastSent = (h: ReturnType<typeof harness>) => sent(h).at(-1)!;

test('routes: /telegram, /telegram/tick, /setup, /status, /file; anything else is 404', () => {
  assert.equal(routeOf('https://x.supabase.co/functions/v1/telegram?forceFunctionRegion=eu-central-1'), 'webhook');
  assert.equal(routeOf('https://x.supabase.co/telegram'), 'webhook');
  assert.equal(routeOf('https://x.supabase.co/telegram/tick?forceFunctionRegion=eu-central-1'), 'tick');
  assert.equal(routeOf('https://x.supabase.co/functions/v1/telegram/setup/'), 'setup');
  assert.equal(routeOf('https://x.supabase.co/telegram/status'), 'status');
  assert.equal(routeOf('https://x.supabase.co/telegram/file?t=abc'), 'file');
  assert.equal(routeOf('https://x.supabase.co/telegram/other'), null);
  assert.equal(routeOf('https://x.supabase.co/tg-health'), null);
});

test('the webhook: 401 without the header and with a foreign one, nothing touched; 405 on GET; 404 elsewhere', async () => {
  const h = harness();
  assert.equal((await h.post(privateText('/start'), null)).status, 401);
  assert.equal((await h.post(privateText('/start'), 'x'.repeat(43))).status, 401);
  assert.equal((await h.post(privateText('/start'), await derivedSecret(TEST_TOKEN, 'tick'))).status, 401, 'the tick secret is not the webhook secret');
  assert.equal(h.fdb.calls.length, 0);
  assert.equal(h.tg.calls.length, 0);
  assert.equal((await h.app(new Request('https://x.supabase.co/functions/v1/telegram'))).status, 405);
  assert.equal((await h.app(new Request('https://x.supabase.co/functions/v1/nothing', { method: 'POST' }))).status, 404);
  assert.equal((await h.post('{not json')).status, 200);
  assert.equal((await h.post(JSON.stringify({ hello: 1 }))).status, 200);
  assert.equal(h.fdb.calls.length, 0);
});

test('the tick: 401 without or with a wrong x-meldy-tick, 202 with it and the work handed to waitUntil', async () => {
  const h = harness();
  assert.equal((await h.tick(null)).status, 401);
  assert.equal((await h.tick(await derivedSecret(TEST_TOKEN, 'webhook'))).status, 401);
  assert.equal(h.waits.length, 0);
  const res = await h.tick();
  assert.equal(res.status, 202);
  assert.equal(h.waits.length, 1);
  await Promise.all(h.waits);
  assert.equal(h.fdb.of('bot_tick_beat').length, 1);
});

test('update kinds: edited messages and channel posts are ignored without a database call', async () => {
  const h = harness();
  assert.equal(updateKind(edited()), 'ignored');
  assert.equal(updateKind(channelPost()), 'ignored');
  assert.equal((await h.post(edited())).status, 200);
  assert.equal((await h.post(channelPost())).status, 200);
  assert.equal(h.fdb.calls.length, 0);
  assert.equal(h.tg.calls.length, 0);
});

test('commands: parsing, the bot\'s own @name, another bot\'s command is not ours', () => {
  assert.deepEqual(parseCommand('/start L0', 'Meldyteach_bot'), { name: 'start', payload: 'L0' });
  assert.deepEqual(parseCommand('/start@Meldyteach_bot G1', 'Meldyteach_bot'), { name: 'start', payload: 'G1' });
  assert.deepEqual(parseCommand('/TODAY', 'Meldyteach_bot'), { name: 'today', payload: '' });
  assert.equal(parseCommand('/start@other_bot', 'Meldyteach_bot'), null);
  assert.equal(parseCommand('hello /start', 'Meldyteach_bot'), null);
});

test('/start without a code: not linked → M1; linked → the card (K1) and the typed command goes away', async () => {
  const h = harness();
  const msg = privateText('/start');
  await h.post(msg);
  assert.match(words(lastSent(h).text), /^Здесь будет план на каждый день/);
  assert.equal(lastSent(h).reply_markup.inline_keyboard[0][0].url, 'https://ludosiel-studyforge.hf.space/profile#telegram');
  h.linked();
  const again = privateText('/start');
  await h.post(again);
  assert.match(words(lastSent(h).text), /^Сегодня около \d+ минут/);
  assert.deepEqual(h.tg.of('deleteMessage').map((c) => c.params.message_id), [again.message!.message_id]);
  assert.deepEqual(h.fdb.of('bot_card_sent').map((c) => (c.args as { event: string }).event), ['card']);
});

test('/start L<code>: M2, the code message deleted; the same code again → M2 again; used / expired / garbage → M5; slow_down', async () => {
  const h = harness();
  h.fdb.addCode(CODE, USER);
  h.fdb.setUser(USER, { wire: null });
  const msg = privateText(`/start ${CODE}`);
  await h.post(msg);
  const claim = h.fdb.of('bot_link_claim')[0].args as { messageDate: number; chatId: number };
  assert.equal(claim.chatId, TG);
  assert.equal(words(lastSent(h).text), `${W.M2_TITLE}\n${W.NO_EXAM}\n\n${W.m2Time('20:00')}`);
  assert.deepEqual(lastSent(h).reply_markup.inline_keyboard.map((r: Array<{ text: string; callback_data: string }>) => r.map((b) => b.callback_data)),
    [['t|0730', 't|1900', 't|2000', 't|2100'], ['t|other']]);
  assert.deepEqual(h.tg.of('deleteMessage').map((c) => c.params.message_id), [msg.message!.message_id]);

  await h.post(privateText(`/start ${CODE}`));
  assert.equal(words(lastSent(h).text).split('\n')[0], W.M2_TITLE, 'the same code from the same Telegram: linked again');

  await h.post(privateText(`/start ${CODE}`, { from: OTHER_TG }));
  assert.equal(words(lastSent(h).text), W.LINK_USED);
  assert.equal(lastSent(h).reply_markup.inline_keyboard[0][0].text, W.OPEN_PROFILE);

  const late = `L${'b2'.repeat(16)}`;
  h.fdb.addCode(late, USER, { ttlMs: 60_000 });
  h.advance(120_000);
  await h.post(privateText(`/start ${late}`, { from: OTHER_TG, date: Math.floor(h.now / 1000) }));
  assert.equal(words(lastSent(h).text), W.LINK_EXPIRED);

  await h.post(privateText('/start hello', { from: OTHER_TG }));
  assert.equal(words(lastSent(h).text), W.LINK_INVALID);
  for (let i = 0; i < 9; i += 1) await h.post(privateText(`/start L${String(i).repeat(32)}`, { from: OTHER_TG }));
  await h.post(privateText(`/start ${'L'.padEnd(33, 'c')}`, { from: OTHER_TG }));
  assert.equal(words(lastSent(h).text), W.LINK_SLOW);
  assert.equal(lastSent(h).reply_markup, undefined);
});

test('a code judged by the message date: a late delivery of an early message still links', async () => {
  const h = harness();
  h.fdb.addCode(CODE, USER, { ttlMs: 60_000 });
  const msg = privateText(`/start ${CODE}`, { date: Math.floor(h.now / 1000) + 30 });
  h.advance(10 * 60_000);
  await h.post(msg);
  assert.equal(words(lastSent(h).text).split('\n')[0], W.M2_TITLE);
});

test('M6: the account\'s earlier Telegram chat hears once that the plan moved', async () => {
  const h = harness();
  h.fdb.addLink({ userId: USER, tgUserId: OTHER_TG });
  h.fdb.addCode(CODE, USER);
  await h.post(privateText(`/start ${CODE}`));
  const toOld = sent(h).filter((p) => p.chat_id === OTHER_TG);
  assert.equal(toOld.length, 1);
  assert.equal(words(toOld[0].text), W.LINK_MOVED);
  assert.equal(toOld[0].protect_content, true);
});

test('a link code or a stray command in a group: silence, nothing stored; G<code> goes to the group port', async () => {
  const h = harness();
  h.fdb.addCode(CODE, USER);
  await h.post(groupCommand(`/start@Meldyteach_bot ${CODE}`));
  await h.post(groupCommand('/today@Meldyteach_bot'));
  await h.post(groupCommand('просто разговор'));
  assert.equal(h.tg.calls.length, 0);
  assert.equal(h.fdb.of('bot_link_claim').length, 0);
  await h.post(groupCommand(`/start@Meldyteach_bot G${'d4'.repeat(16)}`));
  assert.deepEqual(h.portCalls.at(-1), { port: 'group', fn: 'startGroup', args: [GROUP, `G${'d4'.repeat(16)}`] });
  await h.post(migrate());
  assert.deepEqual(h.portCalls.at(-1), { port: 'group', fn: 'migrate', args: [-4001, GROUP] });
});

test('/today, /settings, /help, /stop', async () => {
  const h = harness();
  await h.post(privateText('/help'));
  assert.ok(words(lastSent(h).text).startsWith(`${W.HELP_TITLE}\n${W.HELP[0]}`));
  await h.post(privateText('/today'));
  assert.match(words(lastSent(h).text), /^Здесь будет план/, 'not linked: M1');
  h.linked();
  await h.post(privateText('/today'));
  const first = lastSent(h);
  assert.match(words(first.text), /^Сегодня около/);
  assert.equal(first.disable_notification, true, '/today is silent; only the tick\'s card rings');
  const firstId = h.tg.of('sendMessage').length + 999;
  await h.post(privateText('/today'));
  assert.ok(h.tg.of('deleteMessage').some((c) => c.params.message_id === firstId), 'the earlier unused card is deleted');
  await h.post(privateText('/settings'));
  assert.equal(words(lastSent(h).text), `${W.SETTINGS_TITLE}\nПлан на день — в 20:00 по Минску.\nЭкзамен — «Осенняя сессия», 3 ноября.`);
  await h.post(privateText('/stop'));
  assert.equal(words(lastSent(h).text), W.UNLINKED_DONE);
  assert.equal(h.fdb.link(TG), null);
  await h.post(privateText('/stop'));
  assert.equal(words(lastSent(h).text), W.UNLINKED_DONE, '/stop when not linked says the same');
});

test('text outside a question: S6 once an hour (stamped in the database); unlinked → M1 once an hour', async () => {
  const h = harness();
  await h.post(privateText('привет'));
  await h.post(privateText('ещё'));
  assert.equal(sent(h).length, 1);
  assert.match(words(lastSent(h).text), /^Здесь будет план/);
  h.linked();
  await h.post(privateText('что тут'));
  await h.post(privateText('алло'));
  await h.post(privateText('/unknown'));
  assert.equal(sent(h).filter((p) => words(p.text) === W.BUTTONS_ONLY).length, 1);
  h.advance(3_600_001);
  await h.post(privateText('снова'));
  assert.equal(sent(h).filter((p) => words(p.text) === W.BUTTONS_ONLY).length, 2);
});

test('a short answer typed during a session goes to the session port, not S6', async () => {
  const h = harness({ sessionTakesText: true });
  h.linked();
  await h.post(privateText('32'));
  assert.deepEqual(h.portCalls.at(-1), { port: 'session', fn: 'text', args: ['32'] });
  assert.equal(sent(h).length, 0);
});

test('M2 → M3: a quick time sets it and the same message becomes M3 with «Начать»', async () => {
  const h = harness();
  h.linked();
  h.tg.seed(TG, 777, 'M2');
  await h.post(press('t|1930'));
  assert.deepEqual((h.fdb.of('bot_settings')[0].args as { patch: unknown }).patch, { remind_at: '19:30' });
  const editCall = h.tg.of('editMessageText').at(-1)!.params;
  assert.equal(editCall.message_id, 777);
  assert.match(words(editCall.text), /^Готово: план на день — в 19:30\.\nСегодня около \d+ минут: .+\n\nВремя и пауза — \/settings$/);
  assert.equal(editCall.reply_markup.inline_keyboard[0][0].callback_data, `go|${CID}|p`);
  assert.equal(h.tg.of('answerCallbackQuery').length, 1);
});

test('M4: «Другое время» → a ForceReply prompt kept in the database; «19:45» sets it, «25:99» and «23:30» ask again', async () => {
  const h = harness();
  h.linked();
  h.tg.seed(TG, 777, 'M2');
  await h.post(press('t|other'));
  const prompt = lastSent(h);
  assert.equal(words(prompt.text), W.TIME_PROMPT);
  assert.deepEqual(prompt.reply_markup, { force_reply: true, input_field_placeholder: W.TIME_PLACEHOLDER });
  const promptId = h.tg.of('sendMessage').length + 999;
  assert.deepEqual(h.fdb.link(TG)!.prompt, { kind: 'time', promptId, targetId: 777, from: 'link', at: Math.floor(h.now / 1000) });

  await h.post(privateText('25:99', { replyTo: botMessage(promptId, prompt.text) }));
  const bad = lastSent(h);
  assert.equal(words(bad.text), W.TIME_BAD);
  assert.ok(h.tg.of('deleteMessage').some((c) => c.params.message_id === promptId), 'the old prompt is deleted');
  const badId = h.tg.of('sendMessage').length + 999;
  assert.equal(h.fdb.link(TG)!.prompt!.promptId, badId);

  await h.post(privateText('23:30', { replyTo: botMessage(badId, bad.text) }));
  assert.equal(words(lastSent(h).text), W.TIME_RANGE);
  const rangeId = h.tg.of('sendMessage').length + 999;

  await h.post(privateText('19:45', { replyTo: botMessage(rangeId, lastSent(h).text) }));
  const m3 = h.tg.of('editMessageText').at(-1)!.params;
  assert.equal(m3.message_id, 777, 'M2 is edited into M3');
  assert.match(words(m3.text), /^Готово: план на день — в 19:45\./);
  assert.equal(h.fdb.link(TG)!.prompt, null);
  assert.equal(h.fdb.link(TG)!.remindAt, 19 * 60 + 45);
});

test('a prompt answered without «reply» within the hour still counts; after an hour plain text is S6', async () => {
  const h = harness();
  h.linked();
  await h.post(press('st|time', { messageId: 778 }));
  h.tg.seed(TG, 778, 'S2');
  await h.post(press('t|other|s', { messageId: 778 }));
  await h.post(privateText('8:15'));
  assert.equal(h.fdb.link(TG)!.remindAt, 8 * 60 + 15);
  assert.match(words(h.tg.of('editMessageText').at(-1)!.params.text), /^Настройки\nПлан на день — в 8:15 по Минску\./);
  await h.post(press('t|other|s', { messageId: 778 }));
  h.advance(3_600_001);
  await h.post(privateText('9:00'));
  assert.equal(words(lastSent(h).text), W.BUTTONS_ONLY);
});

test('S1–S4 and K2 presses (§6.5): time, pause, a date by prompt, unpause, unlink, K2 answers', async () => {
  const h = harness();
  h.linked();
  h.tg.seed(TG, 777, 'S1');
  const edits = () => h.tg.of('editMessageText').map((c) => words(c.params.text));
  await h.post(press('st|time'));
  assert.equal(edits().at(-1), W.S2_TITLE);
  await h.post(press('t|0730|s'));
  assert.match(edits().at(-1)!, /^Настройки\nПлан на день — в 7:30 по Минску\./);
  await h.post(press('st|pause'));
  assert.equal(edits().at(-1), `${W.S3_TITLE}\n${W.S3_BODY}`);
  await h.post(press('p|1'));
  assert.equal(edits().at(-1), `Пауза до завтра.\nЗавтра план снова придёт в 7:30. Заниматься можно и раньше — /today.`);
  assert.equal(h.fdb.link(TG)!.pausedUntil, '2026-10-17');
  await h.post(press('p|mon'));
  assert.equal(edits().at(-1), `Пауза до понедельника, 19 октября.\nВ понедельник план снова придёт в 7:30. Заниматься можно и раньше — /today.`);
  await h.post(press('p|off'));
  assert.equal(edits().at(-1), 'Пауза снята: план придёт завтра в 7:30.', '20:00 is past the 7:30 window');
  await h.post(press('p|date'));
  const promptId = h.tg.of('sendMessage').length + 999;
  for (const [reply, expected] of [['32.13', W.DATE_BAD], ['10.10', W.DATE_PAST], ['20.11', W.dateAfterExam('2026-11-03')]] as const) {
    const current = h.fdb.link(TG)!.prompt!.promptId;
    await h.post(privateText(reply, { replyTo: botMessage(current, lastSent(h).text) }));
    assert.equal(words(lastSent(h).text), words(expected), reply);
  }
  assert.ok(promptId > 0);
  const current = h.fdb.link(TG)!.prompt!.promptId;
  await h.post(privateText('25.10', { replyTo: botMessage(current, lastSent(h).text) }));
  assert.equal(edits().at(-1), 'Пауза до воскресенья, 25 октября.\nВ воскресенье, 25 октября, план снова придёт в 7:30. Заниматься можно и раньше — /today.');
  assert.equal(h.fdb.link(TG)!.pausedUntil, '2026-10-25');

  const patch = () => (h.fdb.of('bot_settings').at(-1)!.args as { patch: unknown }).patch;
  await h.post(press('ask|y'));
  assert.equal(edits().at(-1), 'Хорошо: план — каждый день в 7:30.');
  assert.deepEqual(patch(), { ask: 'yes' });
  await h.post(press('ask|p'));
  assert.equal(edits().at(-1), `${W.S3_TITLE}\n${W.S3_BODY}`);
  assert.deepEqual(patch(), { ask: 'pause' });
  await h.post(press('ask|n'));
  assert.equal(edits().at(-1), W.K2_NO_DONE);
  assert.deepEqual(patch(), { ask: 'stop', remind_on: false });
  assert.equal(h.fdb.link(TG)!.remindOn, false);

  await h.post(press('st|off'));
  assert.equal(edits().at(-1), `${W.S4_TITLE}\n${W.S4_BODY}`);
  assert.equal(h.tg.of('editMessageText').at(-1)!.params.reply_markup.inline_keyboard[0][0].style, 'danger');
  await h.post(press('st|back'));
  assert.match(edits().at(-1)!, /^Настройки\nПлан на день сейчас не приходит/);
  await h.post(press('off|y'));
  assert.equal(edits().at(-1), W.UNLINKED_DONE);
  await h.post(press('st|time'));
  assert.equal(h.tg.of('answerCallbackQuery').at(-1)!.params.text, typo(W.NOT_LINKED));
});

test('«Другой экзамен»: the keyboard becomes the list; an exam from it becomes the card', async () => {
  const h = harness();
  h.linked([{ id: CID, title: 'Осенняя сессия', date: '2026-11-03', started: 30 }, { id: 'a1b2c3d4-0000-4000-8000-000000000002', title: 'Зимняя сессия', date: '2027-01-12', started: 10 }]);
  h.tg.seed(TG, 777, 'K1');
  await h.post(press('ex|l'));
  const list = h.tg.of('editMessageReplyMarkup').at(-1)!.params.reply_markup.inline_keyboard;
  assert.deepEqual(list.map((r: Array<{ text: string }>) => r[0].text), ['Осенняя сессия', 'Зимняя сессия', '‹ Назад']);
  await h.post(press('ex|a1b2c3d4-0000-4000-8000-000000000002'));
  assert.match(words(h.tg.of('editMessageText').at(-1)!.params.text).split('\n')[1], /^Зимняя сессия · 12 января/);
});

// ── release 47: «Экзамены» and «Перенести экзамен» ─────────────────────────────────────────────────────────────────────
const WINTER = { id: 'a1b2c3d4-0000-4000-8000-000000000002', title: 'Зимняя сессия', date: '2026-12-20', started: 10 };
const AUTUMN30 = { id: CID, title: 'Осенняя сессия', date: '2026-11-03', started: 30 };
const lastEdit = (h: ReturnType<typeof harness>) => h.tg.of('editMessageText').at(-1)!.params;
const rowsOf = (params: { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> } }) =>
  params.reply_markup.inline_keyboard.map((r) => r.map((b) => [b.text, b.callback_data]));

test('«Экзамены» from S1: the list, a press takes an exam out of the plan, «‹ Назад» is S1; the card then leaves it out', async () => {
  const h = harness();
  h.linked([AUTUMN30, WINTER]);
  h.tg.seed(TG, 777, 'S1');
  await h.post(privateText('/today'));
  assert.ok(words(lastSent(h).text).includes('Ещё сегодня: «Зимняя сессия»'), 'both exams in the plan');
  await h.post(press('xl|s'));
  assert.equal(words(lastEdit(h).text), 'Какие экзамены присылать\nОтметьте экзамены, по которым приходит план на день. Можно несколько.');
  assert.deepEqual(rowsOf(lastEdit(h)), [
    [['✓ Осенняя сессия', `xr|${CID}|0|s`]], [['✓ Зимняя сессия', `xr|${WINTER.id}|0|s`]], [['‹ Назад', 'st|back']],
  ]);
  await h.post(press(`xr|${WINTER.id}|0|s`));
  assert.deepEqual(h.fdb.of('bot_exam_remind').map((c) => c.args), [{ tgUserId: TG, containerId: WINTER.id, on: false }]);
  assert.deepEqual(rowsOf(lastEdit(h))[1], [['— Зимняя сессия', `xr|${WINTER.id}|1|s`]]);
  await h.post(press('st|back'));
  assert.equal(words(lastEdit(h).text), `${W.SETTINGS_TITLE}\nПлан на день — в 20:00 по Минску.\nЭкзамен — «Осенняя сессия», 3 ноября.`);
  assert.deepEqual(rowsOf(lastEdit(h)).map((r) => r.map((b) => b[1])), [['st|time', 'st|pause'], ['xl|s'], ['st|off']]);
  await h.post(privateText('/today'));
  assert.ok(!words(lastSent(h).text).includes('Зимняя сессия'), 'out of the plan: not on the card');
  // both out: /today says so; the tick sends nothing
  await h.post(press(`xr|${CID}|0|s`));
  await h.post(privateText('/today'));
  assert.equal(words(lastSent(h).text), W.NO_EXAM_CHOSEN);
  assert.deepEqual(lastSent(h).reply_markup.inline_keyboard[0][0].callback_data, 'xl|c');
});

test('«Экзамены» from the card: «‹ Назад» (xc) draws the day card again; a press on an exam that is gone says so', async () => {
  const h = harness();
  h.linked([AUTUMN30, WINTER]);
  h.tg.seed(TG, 777, 'K1');
  await h.post(press('xl|c'));
  assert.equal(rowsOf(lastEdit(h)).at(-1)![0][1], 'xc');
  await h.post(press('xc'));
  assert.match(words(lastEdit(h).text), /^.+\nОсенняя сессия · 3 ноября/);
  await h.post(press(`xr|a1b2c3d4-0000-4000-8000-000000000009|0|c`));
  assert.equal(h.tg.of('answerCallbackQuery').at(-1)!.params.text, typo(W.EXAM_GONE));
});

test('«Перенести на неделю» from K3 by a member: for themselves, 7 days from the link\'s day; the answer in place of K3', async () => {
  const h = harness();
  h.linked([AUTUMN30]);
  h.tg.seed(TG, 777, 'K3');
  await h.post(press(`mv|${CID}|7`));
  assert.deepEqual(h.fdb.moves, [{ userId: USER, containerId: CID, date: '2026-10-23', forWhom: 'me' }]);
  assert.equal(lastEdit(h).message_id, 777);
  assert.equal(words(lastEdit(h).text), 'Экзамен «Осенняя сессия» перенесён на 23 октября. План пересчитан.');
  assert.deepEqual(rowsOf(lastEdit(h)), [[['План на сегодня', 'xc']]]);
  // the owner of an exam without members: for everyone, two weeks
  const o = harness();
  o.linked([{ ...AUTUMN30, role: 'owner' }]);
  await o.post(press(`mv|${CID}|14`));
  assert.deepEqual(o.fdb.moves, [{ userId: USER, containerId: CID, date: '2026-10-30', forWhom: 'all' }]);
});

test('the author of an exam with members chooses «Для всех участников» / «Только для меня»; a member cannot move it for everyone', async () => {
  const h = harness();
  h.linked([{ ...AUTUMN30, role: 'owner', members: 2 }]);
  await h.post(press(`mv|${CID}|7`));
  assert.equal(h.fdb.moves.length, 0);
  assert.equal(words(lastEdit(h).text), 'Перенести «Осенняя сессия» на 23 октября?\nВ экзамене есть участники. Новая дата может быть у всех или только у вас.');
  assert.deepEqual(rowsOf(lastEdit(h)), [[['Для всех участников', `mf|${CID}|20261023|a`]], [['Только для меня', `mf|${CID}|20261023|m`]]]);
  await h.post(press(`mf|${CID}|20261023|m`));
  assert.deepEqual(h.fdb.moves, [{ userId: USER, containerId: CID, date: '2026-10-23', forWhom: 'me' }]);
  assert.equal(words(lastEdit(h).text), 'Экзамен «Осенняя сессия» перенесён на 23 октября. План пересчитан.');
  const m = harness();
  m.linked([AUTUMN30]);
  await m.post(press(`mf|${CID}|20261023|a`));
  assert.equal(m.tg.of('answerCallbackQuery').at(-1)!.params.text, typo(W.MOVE_ONLY_OWNER));
  assert.equal(m.fdb.moves.length, 0);
  await m.post(press(`mf|${CID}|20261001|m`));
  assert.equal(m.tg.of('answerCallbackQuery').at(-1)!.params.text, typo(W.MOVE_PAST));
});

test('the exam-day card: «Перенести экзамен» opens the choices in place of its keyboard, «‹ Назад» to the exam\'s card', async () => {
  const h = harness({ now: Date.UTC(2026, 10, 3, 17, 0) });
  h.linked([AUTUMN30]);
  await h.post(privateText('/today'));
  const card = lastSent(h);
  assert.equal(words(card.text).split('\n')[0], 'Сегодня экзамен.');
  assert.ok(card.reply_markup.inline_keyboard.flat().some((b: { callback_data?: string }) => b.callback_data === `mv|${CID}|o`));
  await h.post(press(`mv|${CID}|o`));
  assert.deepEqual(h.tg.of('editMessageReplyMarkup').at(-1)!.params.reply_markup.inline_keyboard.map((r: Array<{ callback_data: string }>) => r.map((b) => b.callback_data)),
    [[`mv|${CID}|7`], [`mv|${CID}|14`, `mv|${CID}|d`], [`ex|${CID}`]]);
  assert.equal(h.fdb.moves.length, 0);
});

test('«Другая дата»: a ForceReply kept with the exam; a past, a far or no date asks again; a date moves it and the answer replaces K3', async () => {
  const h = harness();
  h.linked([AUTUMN30]);
  h.tg.seed(TG, 777, 'K3');
  await h.post(press(`mv|${CID}|d`));
  const prompt = lastSent(h);
  assert.equal(words(prompt.text), W.MOVE_PROMPT);
  assert.deepEqual(prompt.reply_markup, { force_reply: true, input_field_placeholder: W.DATE_PLACEHOLDER });
  const stored = h.fdb.link(TG)!.prompt!;
  assert.deepEqual([stored.kind, stored.targetId, stored.from], ['move', 777, 'settings']);
  for (const [reply, expected] of [['10.10', W.MOVE_PAST], ['завтра', W.MOVE_BAD], ['10.11.2029', W.MOVE_FAR]] as const) {
    const current = h.fdb.link(TG)!.prompt!.promptId;
    await h.post(privateText(reply, { replyTo: botMessage(current, lastSent(h).text) }));
    assert.equal(words(lastSent(h).text), expected, reply);
    assert.ok(h.tg.of('deleteMessage').some((c) => c.params.message_id === current), 'the old prompt goes');
  }
  assert.equal(h.fdb.moves.length, 0);
  const current = h.fdb.link(TG)!.prompt!.promptId;
  await h.post(privateText('25.10', { replyTo: botMessage(current, lastSent(h).text) }));
  assert.deepEqual(h.fdb.moves, [{ userId: USER, containerId: CID, date: '2026-10-25', forWhom: 'me' }]);
  assert.equal(lastEdit(h).message_id, 777);
  assert.equal(words(lastEdit(h).text), 'Экзамен «Осенняя сессия» перенесён на 25 октября. План пересчитан.');
  assert.equal(h.fdb.link(TG)!.prompt, null, 'the prompt is closed');
  // plain text within the hour answers it too
  await h.post(press(`mv|${CID}|d`));
  await h.post(privateText('1 ноября'));
  assert.deepEqual(h.fdb.moves.at(-1), { userId: USER, containerId: CID, date: '2026-11-01', forWhom: 'me' });
});

test('session and group presses go to their ports; garbage only stops the spinner; old messages get a new one', async () => {
  const h = harness();
  h.linked();
  await h.post(press('s|7k2pm9qa|3|1'));
  assert.deepEqual(h.portCalls.at(-1), { port: 'session', fn: 'press', args: [{ kind: 'session', sid: '7k2pm9qa', pos: 3, act: { a: 'option', i: 1 } }] });
  await h.post(press(`go|${CID}|e`));
  assert.deepEqual(h.portCalls.at(-1), { port: 'session', fn: 'start', args: [{ containerId: CID, mode: 'e' }] });
  await h.post(press('g|1z4|2', { from: OTHER_TG, chatId: GROUP, chatType: 'supergroup' }));
  assert.deepEqual(h.portCalls.at(-1), { port: 'group', fn: 'press', args: [{ kind: 'group', post: '1z4', i: 2 }] });
  const before = h.portCalls.length;
  await h.post(press('s|../etc/p|1|1'));
  await h.post(press('st|time', { chatId: GROUP, chatType: 'supergroup' }));
  assert.equal(h.portCalls.length, before);
  assert.deepEqual(h.tg.of('answerCallbackQuery').slice(-2).map((c) => c.params.text), [undefined, undefined]);
  await h.post(press('st|time', { inaccessible: true }));
  assert.equal(words(lastSent(h).text), W.S2_TITLE, 'a message Telegram no longer gives: the screen comes anew');
});

test('my_chat_member: private kicked → blocked, member → unblocked; groups go to the group port', async () => {
  const h = harness();
  h.linked();
  await h.post(member({ id: TG, type: 'private' }, 'member', 'kicked'));
  assert.ok(h.fdb.link(TG)!.blockedAt !== null);
  await h.post(member({ id: TG, type: 'private' }, 'kicked', 'member'));
  assert.equal(h.fdb.link(TG)!.blockedAt, null);
  assert.deepEqual(h.fdb.of('bot_chat_event').map((c) => (c.args as { event: string }).event), ['blocked', 'unblocked']);
  for (const [oldS, newS] of [['left', 'member'], ['member', 'left'], ['member', 'kicked'], ['member', 'administrator']]) {
    await h.post(member({ id: GROUP, type: 'supergroup' }, oldS, newS));
    assert.deepEqual(h.portCalls.at(-1), { port: 'group', fn: 'member', args: [GROUP, newS] });
  }
});

test('a document and a voice note go to their ports; unclaimed, a linked user gets S6', async () => {
  const h = harness();
  h.linked();
  await h.post(document());
  assert.deepEqual(h.portCalls.at(-1), { port: 'files', fn: 'document', args: ['Банк_БД_2026.docx'] });
  assert.equal(words(lastSent(h).text), W.BUTTONS_ONLY);
  await h.post(voice());
  assert.deepEqual(h.portCalls.at(-1), { port: 'voice', fn: 'voice', args: [] });
  const res = await h.app(new Request('https://x.supabase.co/functions/v1/telegram/file?t=abc'));
  assert.equal(res.status, 200);
  assert.deepEqual(h.portCalls.at(-1), { port: 'files', fn: 'http', args: [] });
});

test('a v|… press goes to the voice port; typed text reaches it only after the time and date prompts', async () => {
  const h = harness();
  h.linked();
  await h.post(press('v|a1b2c3d4|chk'));
  assert.deepEqual(h.portCalls.at(-1), { port: 'voice', fn: 'press', args: ['v|a1b2c3d4|chk'] });
  await h.post(privateText('мой ответ'));
  assert.deepEqual(h.portCalls.at(-1), { port: 'voice', fn: 'text', args: [] });
  assert.equal(words(lastSent(h).text), W.BUTTONS_ONLY, 'the voice port said no: S6');
  await h.post(press('st|time', { messageId: 778 }));
  h.tg.seed(TG, 778, 'S2');
  await h.post(press('t|other|s', { messageId: 778 }));
  const asked = h.portCalls.filter((c) => c.port === 'voice').length;
  await h.post(privateText('8:15'));
  assert.equal(h.fdb.link(TG)!.remindAt, 8 * 60 + 15, 'a typed «8:15» answers the open time prompt');
  assert.equal(h.portCalls.filter((c) => c.port === 'voice').length, asked, 'the voice port is not asked');
});

test('the same update_id twice: handled once (the ledger says done)', async () => {
  const h = harness();
  h.linked();
  const update = privateText('/settings');
  assert.equal((await h.post(update)).status, 200);
  assert.equal((await h.post(update)).status, 200);
  assert.equal(sent(h).length, 1);
  assert.equal(h.fdb.updates.get(update.update_id)!.status, 'done');
});

test('with the stub ports (before T6/T8 merge) presses still get an answer and groups stay silent', async () => {
  const h = harness({ ports: 'stubs' });
  h.linked();
  await h.post(press(`go|${CID}|p`));
  await h.post(press('s|7k2pm9qa|0|n'));
  assert.equal(h.tg.of('answerCallbackQuery').length, 2);
  await h.post(groupCommand(`/start@Meldyteach_bot G${'d4'.repeat(16)}`));
  await h.post(member({ id: GROUP, type: 'supergroup' }, 'left', 'member'));
  assert.equal(sent(h).length, 0);
  assert.equal((await h.app(new Request('https://x.supabase.co/telegram/file?t=1'))).status, 404);
  assert.equal(DAY, '2026-10-16');
});
