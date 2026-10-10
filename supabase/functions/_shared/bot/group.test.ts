// The group chat (spec §4.6 G1–G4, §6.5, §6.6 steps 1, 2 and 4; §8.1 «Беседа»; CONTRACT_T7.md) through the whole
// function: webhook → ledger → router → group.ts, and the minute tick, on T2's fake Telegram and fake database with a
// model of T7's functions. Run: node --experimental-strip-types --test supabase/functions/_shared/bot/group.test.ts
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { pickGroupQuestion } from '../plan/group.ts';
import { optionOrder, pinnedLast } from '../plan/session.ts';
import { DbError } from './db.ts';
import * as G from './group.ts';
import { esc, t, visibleLength, visibleText } from './html.ts';
import { lintMessage } from './lint.ts';
import { derivedSecret } from './secrets.ts';
import type { Keyboard } from './tg.ts';
import { TEST_FUNCTION_URL, TEST_TOKEN } from './fixtures/fake_telegram.ts';
import { matchSnapshots, type Shot } from './fixtures/snapshot.ts';
import { groupCommand, member, migrate, press, privateText } from './fixtures/updates.ts';
import {
  ACID, AT_1201, AT_2101, AUTHOR, CID, CODE, CONTEXT, counts, DAY, DHCP, GROUP, ITEMS, LONG, MEMBER, only, OSI, OUTPUT, OUTSIDER, OVERRIDE, STRANGER,
} from './fixtures/group/exam.ts';
import type { FakeItem } from './fixtures/group/fake_group.ts';
import { groupHarness, LOGS, type GroupHarness } from './fixtures/group/harness.ts';
import {
  ASKED_AFTER, CREATE, CSHARP, HTTP, LOOP_C, LOOP_SH, LS, MONGO, PING, PIPE, ROUTES, SCRIPT, SHEBANG, SQL, TABLE, TRY_CATCH,
  WORDS, WORDS_AFTER,
} from './fixtures/stems.ts';
import * as W from './words.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const MIN = 60_000;
const POST = 2560; // the model's first post id: «1z4» in base 36
const SUPERGROUP = -1009999999999;
const plain = (text: string) => text.replace(/[\u00a0\u2002]/g, ' ');
const words = (html: string) => plain(visibleText(html));
type Params = Record<string, any>;
const sends = (h: GroupHarness): Params[] => h.tg.of('sendMessage').map((c) => c.params);
const toChat = (h: GroupHarness, chatId: number) => sends(h).filter((p) => p.chat_id === chatId);
const edits = (h: GroupHarness): Params[] => h.tg.of('editMessageText').map((c) => c.params);
/** The last callback answer, its text with plain spaces (the bot glues its words with no-break spaces). */
const lastAnswer = (h: GroupHarness): Params => {
  const params = { ...h.tg.of('answerCallbackQuery').at(-1)!.params };
  if (typeof params.text === 'string') params.text = plain(params.text);
  return params;
};
/** Messages that went out (the fake records failed attempts too). */
const delivered = (h: GroupHarness, chatId: number) => [...h.tg.messages.values()].filter((m) => m.chatId === chatId);
const shownOf = (it: FakeItem, postId = POST) => optionOrder(it.options.length, it.keepOrder === true, pinnedLast(it.options), `g:${postId}`);
/** The button index of an option in the post's order. */
const buttonOf = (it: FakeItem, text: string, postId = POST) => shownOf(it, postId).findIndex((i) => it.options[i] === text);
const keyButton = (it: FakeItem, postId = POST) => shownOf(it, postId).indexOf(it.correct);
const data = (i: number, postId = POST) => `g|${postId.toString(36)}|${i}`;
const keyboardOf = (markup: Params | undefined): Keyboard =>
  (markup?.inline_keyboard ?? []).map((row: Params[]) => row.map((b) => (b.url ? { text: String(b.text), url: String(b.url) } : { text: String(b.text), data: String(b.callback_data) })));

/** The group bound to «Осенняя сессия» with `it` the one question worth posting; one tick at 12:01 posts it. */
async function posted(h: GroupHarness, it: FakeItem = DHCP) {
  h.exam.counts = only(it);
  if (!h.fg.groups.has(GROUP)) h.fg.bind(GROUP, h.exam);
  const stats = await h.tick();
  return { stats, post: h.fg.posts.at(-1)!, params: sends(h).at(-1)! };
}

/** A press on the post's button `i` by Telegram user `from` (in the group, on the post's message). */
async function tap(h: GroupHarness, i: number, from: number, opts: { postId?: number; chatId?: number; chatType?: 'group' | 'supergroup' | 'private'; messageId?: number } = {}) {
  const post = h.fg.post(opts.postId ?? POST);
  const res = await h.post(press(data(i, opts.postId ?? POST), { from, chatId: opts.chatId ?? GROUP, chatType: opts.chatType ?? 'supergroup', messageId: opts.messageId ?? post?.messageId ?? 1000 }));
  assert.equal(res.status, 200);
  return lastAnswer(h);
}

/** A group message: T2's linter in a group (no blue button) and no word of the key. */
function lintGroup(text: string, keyboard: Keyboard | null, it: FakeItem) {
  const problems = lintMessage({ text, keyboard, chat: 'group', user: [it.subject, it.stem, ...it.stem.split('\n'), ...it.options], options: it.options });
  assert.deepEqual(problems, [], problems.join('; '));
  assert.doesNotMatch(words(text), /В файле|✓|Верно|Неверно/, 'no key in the chat');
  for (const button of (keyboard ?? []).flat()) assert.equal(button.style, undefined, 'no blue or red button in a group');
}

function lintPrivate(text: string, keyboard: Keyboard | null, user: string[] = []) {
  const problems = lintMessage({ text, keyboard, chat: 'private', user });
  assert.deepEqual(problems, [], problems.join('; '));
}

// ─────────────────────────────────────────── the pick (§8.1 «выбор через group.ts на фикстурах сводки») ───────────────────────────────────────────

test('the pick goes through the copied group.ts on the summary: every rank in turn, and the exclusions', async () => {
  const cases: Array<{ name: string; counts: ReturnType<typeof counts>[]; recent?: Array<[FakeItem, number]>; want: FakeItem | null }> = [
    { name: 'confirmable first', counts: [counts(DHCP, { confirmable: 3, unseen: 1 }), counts(ACID, { relearn: 9, due: 4, unseen: 11 })], want: DHCP },
    { name: 'then mistakes and due checks', counts: [counts(DHCP, { relearn: 1, due: 1, unseen: 11 }), counts(ACID, { relearn: 3, due: 2 })], want: ACID },
    { name: 'then not yesterday\'s topic', counts: [counts(CONTEXT, { relearn: 2, unseen: 9 }), counts(DHCP, { relearn: 2, unseen: 1 }), counts(OSI, { blocked: true })], recent: [[OSI, 1]], want: DHCP },
    { name: 'then the most who have not seen it', counts: [counts(DHCP, { unseen: 4 }), counts(ACID, { unseen: 7 })], want: ACID },
    { name: 'never blocked, never fewer than 2 people', counts: [counts(DHCP, { confirmable: 9, blocked: true }), counts(ACID, { confirmable: 8, members: 1 }), counts(OUTPUT, { confirmable: 1 })], want: OUTPUT },
    { name: 'never one posted in the last 14 days', counts: [counts(DHCP, { confirmable: 9 }), counts(ACID, { confirmable: 1 })], recent: [[DHCP, 5]], want: ACID },
    { name: 'posted 15 days ago it may come again', counts: [counts(DHCP, { confirmable: 9 }), counts(ACID, { confirmable: 1 })], recent: [[DHCP, 15]], want: DHCP },
    { name: 'nothing to post: no post today', counts: ITEMS.map((x) => counts(x, { blocked: true })), want: null },
  ];
  for (const c of cases) {
    const h = groupHarness();
    h.exam.counts = c.counts;
    h.fg.bind(GROUP, h.exam);
    for (const [it, ago] of c.recent ?? []) h.fg.pastPost(GROUP, h.fg.daysBefore(DAY, ago), it.id, 3);
    const stats = await h.tick();
    // What the claim handed over is the GroupInput as it is; the pick is the copied module's.
    const claimed = h.fg.posts.find((p) => p.localDay === DAY)!;
    const input = { day: DAY, items: c.counts, recent: (c.recent ?? []).map(([it, ago]) => ({ rev: it.id, day: h.fg.daysBefore(DAY, ago) })), minGapDays: 14 };
    assert.equal(pickGroupQuestion(input)?.rev ?? null, c.want?.id ?? null, `${c.name}: the copied pick`);
    assert.deepEqual(h.fdb.of('bot_group_pick').map((x) => (x.args as Params).p_rev), [c.want?.id ?? null], `${c.name}: bot_group_pick got it`);
    if (c.want) {
      assert.equal(stats.posts_posted, 1, c.name);
      assert.deepEqual([claimed.status, claimed.itemId], ['open', c.want.id], c.name);
      assert.match(words(sends(h)[0].text), new RegExp(`^Вопрос дня · ${c.want.subject}`), c.name);
    } else {
      assert.equal(stats.posts_none, 1, c.name);
      assert.deepEqual([claimed.status, claimed.error], ['failed', 'none'], c.name);
      assert.equal(sends(h).length, 0, c.name);
    }
  }
});

// ─────────────────────────────────────────── G2: the post ───────────────────────────────────────────

test('G2: one silent post with protect_content, the buttons in the shown order, «Заниматься в Meldy» → start=g<chat>; no blue, no key', async () => {
  const h = groupHarness();
  const { stats, post, params } = await posted(h);
  assert.equal(stats.posts_posted, 1);
  assert.equal(params.chat_id, GROUP);
  assert.equal(params.disable_notification, true, 'without sound');
  assert.equal(params.protect_content, true);
  assert.deepEqual(params.link_preview_options, { is_disabled: true });
  assert.equal(params.parse_mode, 'HTML');
  assert.equal(words(params.text), 'Вопрос дня · Компьютерные сети\n\nКакой протокол выдаёт устройству IP-адрес при подключении к сети?');
  const shown = shownOf(DHCP);
  assert.deepEqual(h.fdb.of('bot_group_sending').map((x) => (x.args as Params).p_shown), [shown], 'the order goes to the database before the send');
  const keyboard = keyboardOf(params.reply_markup);
  assert.deepEqual(keyboard.slice(0, -1).map((row) => row.map((b) => b.text)), shown.map((i) => [DHCP.options[i]]), 'one option a row, in the shown order');
  assert.deepEqual(keyboard.slice(0, -1).map((row) => row[0].data), shown.map((_, i) => data(i)));
  assert.deepEqual(keyboard.at(-1), [{ text: 'Заниматься в Meldy', url: `https://t.me/Meldyteach_bot?start=g${GROUP}` }]);
  lintGroup(params.text, keyboard, DHCP);
  assert.deepEqual([post.status, post.messageId, post.shown], ['open', 1000, shown]);
  assert.deepEqual(h.fdb.of('bot_group_posted').map((x) => x.args), [{ p_post_id: POST, p_status: 'sent', p_tg_message_id: 1000, p_error: null }]);
  // a minute later and the rest of the day: no second post
  h.advance(MIN);
  await h.tick();
  h.advance(2 * 60 * MIN);
  await h.tick();
  assert.equal(sends(h).length, 1);
});

test('G2 letters (Z2, Z3): long options, code options, 6 options in rows of 4, keep_order; code in the question as <pre>', async () => {
  const h = groupHarness();
  const acid = (await posted(h, ACID)).params;
  const order = shownOf(ACID);
  const lines = words(acid.text).split('\n');
  assert.deepEqual(lines.slice(0, 4), ['Вопрос дня · Базы данных', '', 'Что гарантирует изолированность — буква I в ACID?', '']);
  assert.deepEqual(lines.slice(4), order.map((i, k) => `${G.LETTERS[k]} ${ACID.options[i]}`));
  assert.match(acid.text, /<b>А<\/b>\u2002/, 'a bold letter and U+2002, as Z2');
  assert.deepEqual(keyboardOf(acid.reply_markup).map((row) => row.map((b) => b.text)), [['А', 'Б', 'В', 'Г'], ['Заниматься в Meldy']]);
  lintGroup(acid.text, keyboardOf(acid.reply_markup), ACID);

  const views: Array<[FakeItem, (text: string, keyboard: string[][]) => void]> = [
    [OVERRIDE, (text, keyboard) => {
      assert.match(text, /<b>А<\/b>\u2002<code>(public|private) [^<]*<\/code>/, 'code options: letters in <code>');
      assert.deepEqual(keyboard, [['А', 'Б', 'В', 'Г'], ['Заниматься в Meldy']]);
    }],
    [OUTPUT, (text, keyboard) => {
      assert.match(text, /Что выведет программа\?\n<pre><code class="language-csharp">int x = 7;\nint y = x\+\+ \+ \+\+x;\nConsole\.WriteLine\(y\);<\/code><\/pre>$/);
      assert.deepEqual(keyboard.slice(0, -1).map((r) => r.length), [1, 1, 1, 1], 'short options stay buttons under a code question');
    }],
    [CONTEXT, (_text, keyboard) => assert.deepEqual(keyboard, [['А', 'Б', 'В', 'Г'], ['Д', 'Е'], ['Заниматься в Meldy']])],
    [OSI, (text, keyboard) => {
      assert.deepEqual(words(text).split('\n').slice(-4), ['А Канальный', 'Б Сетевой', 'В Транспортный', 'Г Сеансовый'], 'keep_order: the file\'s order, as letters');
      assert.deepEqual(keyboard, [['А', 'Б', 'В', 'Г'], ['Заниматься в Meldy']]);
    }],
  ];
  for (const [it, check] of views) {
    const k = groupHarness();
    const { params } = await posted(k, it);
    check(params.text, keyboardOf(params.reply_markup).map((row) => row.map((b) => b.text)));
    lintGroup(params.text, keyboardOf(params.reply_markup), it);
  }
});

test('the chat never shows the key: posts, counters and closes are the same whatever the key is', async () => {
  const run = async (correct: number) => {
    const h = groupHarness();
    h.exam.items = h.exam.items.map((it) => (it.id === DHCP.id ? { ...it, correct } : it));
    await posted(h);
    await tap(h, 0, MEMBER.tg);
    await h.tick();
    h.set(AT_2101);
    await h.tick();
    return { sent: sends(h).map((p) => [p.text, JSON.stringify(p.reply_markup)]), edited: edits(h).map((p) => [p.text, JSON.stringify(p.reply_markup ?? null)]) };
  };
  const a = await run(1);
  const b = await run(3);
  assert.equal(a.edited.length, 2, 'a counter and a close');
  assert.deepEqual(a, b);
});

test('G2 split as on the site (stemParts): SQL without the flag, a command and its output, a table, C — the question, then its code in <pre>', async () => {
  const cases: FakeItem[] = [
    { ...ACID, id: 'f1f2c3d4-0000-4000-8000-000000000091', stem: SQL, code: false },
    { ...DHCP, id: 'f1f2c3d4-0000-4000-8000-000000000092', stem: PING, code: true },
    { ...CONTEXT, id: 'f1f2c3d4-0000-4000-8000-000000000093', stem: SHEBANG, code: false },
    { ...ACID, id: 'f1f2c3d4-0000-4000-8000-000000000094', stem: TABLE, code: false },
    { ...OUTPUT, id: 'f1f2c3d4-0000-4000-8000-000000000095', stem: CSHARP, code: false },
  ];
  for (const it of cases) {
    const h = groupHarness();
    h.exam.items = [...h.exam.items, it];
    h.exam.counts = [counts(it, { confirmable: 3 })];
    h.fg.bind(GROUP, h.exam);
    assert.equal((await h.tick()).posts_posted, 1, it.stem);
    const params = sends(h).at(-1)!;
    const [first, ...rest] = it.stem.split('\n');
    assert.ok(params.text.includes(`</b>\n\n${t(first)}\n<pre><code class="language-csharp">${esc(rest.join('\n'))}</code></pre>`), params.text);
    lintGroup(params.text, keyboardOf(params.reply_markup), it);
  }
});

test('T7\'s 1500 characters still fit one post: the split changes the markup, never the characters the post shows', () => {
  const view = (stem: string, code: boolean, options = ACID.options) => ({ postId: POST, chatId: GROUP, subject: ACID.subject, stem, options, code, keepOrder: false });
  const letters = (options: string[]) => options.map((o, k) => `${G.LETTERS[k]} ${o}`);
  const stems = [SQL, CREATE, PIPE, SCRIPT, SHEBANG, LOOP_SH, LS, PING, TABLE, ROUTES, HTTP, CSHARP, LOOP_C, TRY_CATCH, MONGO, ASKED_AFTER, WORDS_AFTER, ...WORDS];
  for (const stem of stems) {
    for (const code of [true, false]) {
      const text = G.postText(view(stem, code), G.GW.closedAnswered(3));
      assert.equal(words(text), [`Вопрос дня · ${ACID.subject}`, '', stem, '', ...letters(ACID.options), '', 'Вопрос закрыт. Ответили 3.'].join('\n'), `${stem} (flag ${code})`);
    }
  }
  // The longest question the database offers (bot.group_item_ok): stem and options 1500 characters together, the
  // question in code, 8 options by letter, and the longest last line.
  const options = Array.from({ length: 8 }, (_, k) => `Строки, где course <> ${k + 1}, по возрастанию name`);
  const head = `${SQL}\n-- `;
  const long = `${head}${'x'.repeat(1500 - [...head].length - options.join('').length)}`;
  assert.equal([...long].length + options.join('').length, 1500);
  const post = view(long, false, options);
  assert.ok(G.postable(post));
  assert.ok(G.postText(post).includes('<pre><code class="language-csharp">SELECT *\nFROM Students\nWHERE course = 2;\n-- xxx'));
  assert.ok(visibleLength(G.postText(post, G.GW.closedAnswered(99999))) < 1700, 'far below Telegram\'s 4096');
});

// ─────────────────────────────────────────── G3: presses ───────────────────────────────────────────

test('G3: a member right → the line «Верно.» and one tgq row with bot_group; wrong → the window with the key', async () => {
  const h = groupHarness();
  await posted(h);
  const right = await tap(h, keyButton(DHCP), MEMBER.tg);
  assert.deepEqual([right.text, right.show_alert], ['Верно.', undefined]);
  assert.deepEqual(h.fg.records, [{ clientEventId: `tgq:${POST}:${MEMBER.tg}`, userId: MEMBER.userId, itemId: DHCP.id, chosen: 1, source: 'bot_group', correct: true, shownOrder: shownOf(DHCP) }]);
  const wrong = await tap(h, buttonOf(DHCP, 'ARP'), AUTHOR.tg);
  assert.deepEqual([wrong.text, wrong.show_alert], ['Неверно. В файле — DHCP. Вопрос вернётся в ваших занятиях завтра.', true]);
  assert.equal(h.fg.records.length, 2, 'the author is in the exam too');
  const call = h.fdb.of('bot_group_answer').at(-1)!.args as Params;
  assert.deepEqual(call, { p_post_id: POST, p_tg_user_id: AUTHOR.tg, p_shown: buttonOf(DHCP, 'ARP'), p_chat_id: GROUP, p_message_id: 1000 });
  assert.equal(h.tg.of('editMessageText').length, 0, 'a press never edits the post: the counter is the tick\'s');
});

test('G3: «Верно» on the two_days step names the new figure', async () => {
  const h = groupHarness();
  await posted(h);
  h.fg.twoDays.set(MEMBER.tg, { twoDays: 144, inPlan: 960 });
  const reply = await tap(h, keyButton(DHCP), MEMBER.tg);
  assert.equal(reply.text, 'Верно. Теперь 144 из 960 — верно в два разных дня.');
  assert.equal(reply.show_alert, undefined);
});

test('G3: not linked, and linked but not in the exam: only the counter; the windows say so', async () => {
  const h = groupHarness();
  await posted(h);
  assert.equal((await tap(h, keyButton(DHCP), STRANGER.tg)).text, 'Верно.');
  const stranger = await tap(h, buttonOf(DHCP, 'DNS'), STRANGER.tg + 1);
  assert.deepEqual([stranger.text, stranger.show_alert], ['Неверно. В файле — DHCP. Чтобы такие ответы шли в план Meldy, подключите Telegram в профиле.', true]);
  assert.equal((await tap(h, keyButton(DHCP), OUTSIDER.tg)).text, 'Верно.');
  const h2 = groupHarness();
  await posted(h2);
  const outsider = await tap(h2, buttonOf(DHCP, 'NAT'), OUTSIDER.tg);
  assert.deepEqual([outsider.text, outsider.show_alert], ['Неверно. В файле — DHCP.', true]);
  assert.equal(h.fg.records.length + h2.fg.records.length, 0, 'nothing in anyone\'s count');
  assert.equal(h.fg.post(POST)!.answered, 3, 'every first press is counted');
});

test('G3: a repeated tap → «Вы уже ответили: …» with the first choice; nothing new is written or counted', async () => {
  const h = groupHarness();
  await posted(h);
  await tap(h, buttonOf(DHCP, 'ARP'), MEMBER.tg);
  const again = await tap(h, keyButton(DHCP), MEMBER.tg);
  assert.deepEqual([again.text, again.show_alert], ['Вы уже ответили: ARP. В файле — DHCP.', true]);
  assert.equal(h.fg.records.length, 1);
  assert.equal(h.fg.records[0].correct, false, 'the first press stays');
  assert.equal(h.fg.post(POST)!.answered, 1);
});

test('G3: a closed post, another chat, a button that is not there, garbage and a private chat → «Вопрос закрыт.» with no key', async () => {
  const h = groupHarness();
  await posted(h);
  const other = await tap(h, 0, MEMBER.tg, { chatId: -100555 });
  assert.deepEqual([other.text, other.show_alert], ['Вопрос закрыт.', undefined]);
  assert.equal((await tap(h, 6, MEMBER.tg)).text, 'Вопрос закрыт.', 'no such button');
  const calls = h.fdb.of('bot_group_answer').length;
  assert.equal((await tap(h, 0, MEMBER.tg, { chatType: 'private', chatId: MEMBER.tg })).text, 'Вопрос закрыт.');
  await h.post(press('g|zzzzzzzzzzzzz|0', { from: MEMBER.tg, chatId: GROUP, chatType: 'supergroup' }));
  assert.equal(lastAnswer(h).text, 'Вопрос закрыт.');
  assert.equal(h.fdb.of('bot_group_answer').length, calls, 'a private chat or an impossible id never reaches the database');
  h.set(AT_2101);
  const late = await tap(h, keyButton(DHCP), AUTHOR.tg);
  assert.deepEqual([late.text, late.show_alert], ['Вопрос закрыт.', undefined]);
  await h.tick();
  assert.equal((await tap(h, keyButton(DHCP), OUTSIDER.tg)).text, 'Вопрос закрыт.');
  assert.equal(h.fg.records.length, 0);
});

test('G3 windows stay within 200 characters: a long option is cut with «…»', async () => {
  const h = groupHarness();
  await posted(h, LONG);
  const order = shownOf(LONG);
  const wrong = order.indexOf(1);
  const unlinked = await tap(h, wrong, STRANGER.tg);
  assert.equal(unlinked.show_alert, true);
  assert.ok([...unlinked.text].length <= 200, `${[...unlinked.text].length}`);
  assert.match(unlinked.text, /^Неверно\. В файле — Каждый неключевой атрибут .+[а-яё]… Чтобы такие ответы шли в план Meldy, подключите Telegram в профиле\.$/);
  const again = await tap(h, order.indexOf(0), STRANGER.tg);
  assert.ok([...again.text].length <= 200, `${[...again.text].length}`);
  assert.match(again.text, /^Вы уже ответили: Каждое значение атрибута .+[а-яё]… В файле — Каждый неключевой атрибут .+[а-яё]…$/);
  const member = await tap(h, wrong, MEMBER.tg);
  assert.ok([...member.text].length <= 200);
  assert.match(member.text, /[а-яё]… Вопрос вернётся в ваших занятиях завтра\.$/);
});

test('a database failure on a press: the line «Meldy сейчас не отвечает…» and 200; Telegram does not retry it', async () => {
  const h = groupHarness();
  await posted(h);
  h.fdb.fail('bot_group_answer', new DbError('bot_group_answer', 503, ''));
  const res = await h.post(press(data(0), { from: MEMBER.tg, chatId: GROUP, chatType: 'supergroup', messageId: 1000 }));
  assert.equal(res.status, 200);
  assert.equal(lastAnswer(h).text, W.DB_DOWN_TAP);
  assert.equal(h.fg.post(POST)!.answered, 0);
});

// ─────────────────────────────────────────── step 4: «Ответили N» ───────────────────────────────────────────

test('«Ответили N.» by an edit with the same keyboard, at most once a minute', async () => {
  const h = groupHarness();
  const { params } = await posted(h);
  await tap(h, 0, MEMBER.tg);
  await tap(h, 1, STRANGER.tg);
  const first = await h.tick();
  assert.equal(first.count_shown, 1);
  const edit = edits(h)[0];
  assert.deepEqual([edit.chat_id, edit.message_id], [GROUP, 1000]);
  assert.equal(words(edit.text), `${words(params.text)}\n\nОтветили 2.`);
  assert.deepEqual(edit.reply_markup, params.reply_markup, 'the buttons stay');
  lintGroup(edit.text, keyboardOf(edit.reply_markup), DHCP);
  await tap(h, 2, OUTSIDER.tg);
  h.advance(30_000);
  await h.tick();
  assert.equal(edits(h).length, 1, 'not again within the minute');
  h.advance(30_000);
  await h.tick();
  assert.equal(edits(h).length, 2);
  assert.match(words(edits(h)[1].text), /\n\nОтветили 3\.$/);
  h.advance(5 * MIN);
  await h.tick();
  assert.equal(edits(h).length, 2, 'no new press, no edit');
  const times = h.tg.of('editMessageText').map((c) => c.at);
  assert.ok(times[1] - times[0] >= MIN);
  assert.deepEqual(h.fdb.of('bot_group_counter_done').map((x) => x.args), [
    { p_post_id: POST, p_answered: 2, p_status: 'shown' }, { p_post_id: POST, p_answered: 3, p_status: 'shown' },
  ]);
});

test('a counter edit of a deleted post → gone (no more edits); a failed edit is tried a minute later', async () => {
  const h = groupHarness();
  await posted(h);
  await tap(h, 0, MEMBER.tg);
  h.tg.fail('editMessageText', { kind: '5xx', json: true }, { kind: '5xx', json: true });
  const failed = await h.tick();
  assert.equal(failed.count_failed, 1);
  h.advance(MIN);
  h.tg.fail('editMessageText', { kind: '429', retryAfter: 9 });
  const limited = await h.tick();
  assert.equal(limited.count_rate_limited, 1);
  h.advance(MIN);
  h.tg.fail('editMessageText', { kind: '400', description: 'Bad Request: message to edit not found' });
  const gone = await h.tick();
  assert.equal(gone.count_gone, 1);
  assert.equal(h.fg.post(POST)!.messageId, null);
  await tap(h, 1, OUTSIDER.tg);
  h.advance(MIN);
  await h.tick();
  assert.equal(h.tg.of('editMessageText').length, 4, 'nothing after gone');
});

// ─────────────────────────────────────────── step 1: the 21:00 close ───────────────────────────────────────────

test('21:00: the keyboard comes off and the last line is «Вопрос закрыт. Ответили N.» — once', async () => {
  const h = groupHarness();
  const { params } = await posted(h);
  await tap(h, 0, MEMBER.tg);
  await tap(h, 1, AUTHOR.tg);
  await tap(h, 2, STRANGER.tg);
  h.set(AT_2101 - 2 * MIN); // 20:59: still open
  await h.tick();
  const before = edits(h).length;
  h.set(AT_2101);
  const stats = await h.tick();
  assert.equal(stats.close_closed, 1);
  const close = edits(h).at(-1)!;
  assert.equal(edits(h).length, before + 1);
  assert.equal(words(close.text), `${words(params.text)}\n\nВопрос закрыт. Ответили 3.`);
  assert.equal(close.reply_markup, undefined, 'no keyboard: the buttons come off');
  lintGroup(close.text, null, DHCP);
  assert.equal(h.fg.post(POST)!.status, 'closed');
  h.advance(11 * MIN);
  await h.tick();
  assert.equal(edits(h).length, before + 1, 'one close per post');
});

test('nobody answered: «Вопрос закрыт.»; a deleted question: only the keyboard comes off; 429 → retry later', async () => {
  const h = groupHarness();
  const { params } = await posted(h);
  h.set(AT_2101);
  h.tg.fail('editMessageText', { kind: '429', retryAfter: 7 });
  const limited = await h.tick();
  assert.equal(limited.close_rate_limited, 1);
  assert.equal(h.fg.post(POST)!.status, 'open');
  h.advance(11 * MIN);
  await h.tick();
  assert.equal(words(edits(h).at(-1)!.text), `${words(params.text)}\n\nВопрос закрыт.`);
  assert.equal(h.fg.post(POST)!.status, 'closed');

  // The author deleted the question: the row lost it (on delete set null) → the claim closes it silently.
  const k = groupHarness();
  await posted(k);
  k.set(AT_2101);
  k.fg.post(POST)!.itemId = null;
  await k.tick();
  assert.equal(k.tg.calls.filter((c) => c.method.startsWith('edit')).length, 0);
  assert.equal(k.fg.post(POST)!.status, 'closed', 'closed by the claim, silently');
  const d = groupHarness();
  await posted(d);
  d.set(AT_2101);
  d.exam.items = d.exam.items.filter((it) => it.id !== DHCP.id);
  await d.tick();
  assert.equal(d.tg.calls.filter((c) => c.method.startsWith('edit')).length, 0);
  assert.equal(d.fg.post(POST)!.status, 'closed');
  // Defensive: a claim row without a VIEW (CONTRACT_T7 says it never comes) only takes the keyboard off.
  const v = groupHarness();
  await posted(v);
  v.set(AT_2101);
  v.fdb.on('bot_claim_group_closes', () => [{ post_id: POST, chat_id: GROUP, tg_message_id: 1000, answered: 0, view: null }]);
  v.fdb.on('bot_group_counters', () => [{ post_id: POST, chat_id: GROUP, tg_message_id: 1000, answered: 2, view: null }]);
  await v.tick();
  assert.equal(v.tg.of('editMessageText').length, 0);
  assert.deepEqual(v.tg.of('editMessageReplyMarkup').map((c) => c.params), [{ chat_id: GROUP, message_id: 1000, reply_markup: { inline_keyboard: [] } }]);
  assert.deepEqual(v.fdb.of('bot_group_closed').map((x) => x.args), [{ p_post_id: POST, p_status: 'closed' }]);
  assert.deepEqual(v.fdb.of('bot_group_counter_done').map((x) => x.args), [{ p_post_id: POST, p_answered: 2, p_status: 'failed' }]);
});

// ─────────────────────────────────────────── step 2: at most once, failures ───────────────────────────────────────────

test('two ticks at once → one post; a timeout after the send → unknown, never a second post', async () => {
  const h = groupHarness();
  h.exam.counts = only(DHCP);
  h.fg.bind(GROUP, h.exam);
  const tick = async () => h.app(new Request(`${TEST_FUNCTION_URL}/tick`, { method: 'POST', headers: { 'x-meldy-tick': await derivedSecret(TEST_TOKEN, 'tick') } }));
  await Promise.all([tick(), tick()]);
  await Promise.all(h.waits.splice(0));
  assert.equal(sends(h).length, 1);

  const k = groupHarness();
  k.tg.fail('sendMessage', { kind: 'timeout' });
  const stats = (await posted(k)).stats;
  assert.equal(stats.posts_unknown, 1);
  assert.equal(k.fg.post(POST)!.status, 'unknown');
  for (const later of [11, 30, 90]) {
    k.set(AT_1201 + later * MIN);
    await k.tick();
  }
  assert.equal(k.tg.of('sendMessage').length, 1, 'one attempt only');
  // It was in the chat after all: the first press brings its message id back, the counter and the close can edit it.
  await tap(k, 0, MEMBER.tg, { messageId: 1000 });
  assert.deepEqual([k.fg.post(POST)!.status, k.fg.post(POST)!.messageId], ['open', 1000]);
});

test('the database fails right after the send: the row stays in sending → unknown, never a second post; a press gives the id back', async () => {
  const h = groupHarness();
  h.fdb.fail('bot_group_posted', new DbError('bot_group_posted', 503, ''));
  const stats = (await posted(h)).stats;
  assert.equal(stats.posts_error, 1, 'the step failed after the send');
  assert.equal(delivered(h, GROUP).length, 1);
  assert.equal(h.fg.post(POST)!.status, 'sending');
  for (const later of [11, 40]) {
    h.set(AT_1201 + later * MIN);
    await h.tick();
  }
  assert.equal(h.fg.post(POST)!.status, 'unknown');
  assert.equal(h.tg.of('sendMessage').length, 1, 'never sent again');
  const reply = await tap(h, keyButton(DHCP), MEMBER.tg, { messageId: 1000 });
  assert.equal(reply.text, 'Верно.');
  assert.deepEqual([h.fg.post(POST)!.status, h.fg.post(POST)!.messageId], ['open', 1000]);
  h.advance(MIN);
  await h.tick();
  assert.match(words(edits(h).at(-1)!.text), /\n\nОтветили 1\.$/, 'the counter edits it after all');
});

test('429 → retry in 10 minutes and the step stops; 403 → the group is unbound; migrate_to_chat_id → it moves and posts there', async () => {
  const h = groupHarness();
  h.tg.fail('sendMessage', { kind: '429', retryAfter: 9 });
  const first = (await posted(h)).stats;
  assert.equal(first.posts_rate_limited, 1);
  assert.equal(h.fg.post(POST)!.status, 'claimed');
  h.advance(11 * MIN);
  const second = await h.tick();
  assert.equal(second.posts_posted, 1);
  assert.equal(h.fg.post(POST)!.status, 'open');

  const k = groupHarness();
  k.tg.fail('sendMessage', { kind: '403', description: 'Forbidden: bot was kicked from the supergroup chat' });
  const kicked = (await posted(k)).stats;
  assert.equal(kicked.posts_failed, 1);
  assert.notEqual(k.fg.groups.get(GROUP)!.leftAt, null);
  assert.deepEqual(k.fdb.of('bot_group_event').map((x) => x.args), [{ p_chat_id: GROUP, p_event: 'kicked', p_new_chat_id: null }]);
  k.set(AT_1201 + 24 * 60 * MIN);
  await k.tick();
  assert.equal(k.tg.of('sendMessage').length, 1, 'no post to a group the bot left');

  const m = groupHarness();
  m.tg.fail('sendMessage', { kind: 'migrate', to: SUPERGROUP });
  const moved = (await posted(m)).stats;
  assert.equal(moved.posts_migrated, 1);
  assert.deepEqual(m.fdb.of('bot_group_event').map((x) => x.args), [{ p_chat_id: GROUP, p_event: 'migrated', p_new_chat_id: SUPERGROUP }]);
  m.advance(11 * MIN);
  await m.tick();
  const there = sends(m).at(-1)!;
  assert.equal(there.chat_id, SUPERGROUP);
  assert.match(JSON.stringify(there.reply_markup), new RegExp(`start=g${SUPERGROUP}`));
});

test('no post: before the hour, 3 hours late, on the exam day, after the date, after the link ended, when turned off', async () => {
  const at = (h: GroupHarness, hour: number, minute: number) => h.set(Date.UTC(2026, 9, 16, hour - 3, minute));
  const early = groupHarness();
  early.fg.bind(GROUP, early.exam);
  at(early, 11, 59);
  await early.tick();
  at(early, 15, 0);
  await early.tick();
  assert.equal(sends(early).length, 0, 'the window is 12:00–15:00');
  const evening = groupHarness();
  evening.fg.bind(GROUP, evening.exam, { postHour: 18 });
  at(evening, 20, 0);
  await evening.tick();
  assert.equal(sends(evening).length, 0, 'never at 20:00 or later');
  at(evening, 19, 59);
  await evening.tick();
  assert.equal(sends(evening).length, 1);

  for (const [name, change] of [
    ['the exam day', (h: GroupHarness) => { h.exam.examDate = DAY; }],
    ['after the date', (h: GroupHarness) => { h.exam.examDate = '2026-10-15'; }],
    ['the link ended', (h: GroupHarness) => { h.exam.linkActive = false; }],
    ['turned off', (h: GroupHarness) => { h.fg.groups.get(GROUP)!.offAt = AT_1201 - MIN; }],
  ] as const) {
    const h = groupHarness();
    h.fg.bind(GROUP, h.exam);
    change(h);
    await h.tick();
    assert.equal(sends(h).length, 0, name);
  }
});

// ─────────────────────────────────────────── 5 empty → off + G4 once ───────────────────────────────────────────

test('5 posts in a row without answers → no more posts and one G4 to the author (silent, «Открыть в Meldy»)', async () => {
  const h = groupHarness();
  h.exam.counts = only(DHCP);
  h.fg.bind(GROUP, h.exam);
  for (let ago = 5; ago >= 1; ago -= 1) h.fg.pastPost(GROUP, h.fg.daysBefore(DAY, ago), ACID.id, 0);
  const stats = await h.tick();
  assert.equal(stats.posts_g4, 1);
  assert.equal(toChat(h, GROUP).length, 0, 'no post');
  const g4 = toChat(h, AUTHOR.tg);
  assert.equal(g4.length, 1);
  assert.equal(words(g4[0].text), 'В беседе «3-ПО» пять дней подряд никто не ответил на вопрос дня — бот перестал его присылать. Включить снова можно на сайте, в «Пригласить группу».');
  assert.deepEqual([g4[0].disable_notification, g4[0].protect_content], [true, true]);
  assert.deepEqual(keyboardOf(g4[0].reply_markup), [[{ text: 'Открыть в Meldy', url: `https://ludosiel-studyforge.hf.space/exams/c/${CID}/settings?invite=1` }]]);
  lintPrivate(g4[0].text, keyboardOf(g4[0].reply_markup), ['3-ПО']);
  const notice = h.fdb.deliveries.find((d) => d.kind === 'notice')!;
  assert.deepEqual([notice.status, notice.ref, notice.messageId], ['sent', `g4:${GROUP}`, 1000]);
  assert.equal(h.fg.groups.get(GROUP)!.offReason, 'empty');
  for (const later of [MIN, 11 * MIN, 24 * 60 * MIN]) {
    h.advance(later);
    await h.tick();
  }
  assert.equal(sends(h).length, 1, 'G4 once, and nothing more');
});

test('G4 hit by a 429: back through bot_delivery_retry, the step stops; a later tick sends it, once', async () => {
  const h = groupHarness();
  // T1's bot_delivery_retry for a notice: back to claimed while the link is on and tries remain (T2's fake applies the
  // reminder window to every kind but the night's close; the SQL does not).
  h.fdb.db.deliveryRetry = async (id: number, error = '429') => {
    h.fdb.calls.push({ fn: 'bot_delivery_retry', args: { id, error } });
    const d = h.fdb.deliveries.find((x) => x.id === id);
    if (!d || d.status !== 'sending') return false;
    d.status = d.attempts < 3 ? 'claimed' : 'failed';
    d.claimedAt = h.now;
    return d.status === 'claimed';
  };
  h.exam.counts = only(DHCP);
  h.fg.bind(GROUP, h.exam);
  for (let ago = 5; ago >= 1; ago -= 1) h.fg.pastPost(GROUP, h.fg.daysBefore(DAY, ago), ACID.id, 0);
  h.tg.fail('sendMessage', { kind: '429', retryAfter: 30 });
  const first = await h.tick();
  assert.deepEqual([first.posts_rate_limited, first.posts_g4_requeued], [1, 1]);
  assert.deepEqual(h.fdb.of('bot_delivery_retry').map((x) => (x.args as Params).error), ['429']);
  assert.deepEqual(h.fdb.of('bot_delivery_done'), [], 'not closed as failed');
  assert.equal(delivered(h, AUTHOR.tg).length, 0);
  h.advance(11 * MIN);
  const second = await h.tick();
  assert.equal(second.posts_g4, 1);
  assert.equal(delivered(h, AUTHOR.tg).length, 1);
  h.advance(11 * MIN);
  await h.tick();
  assert.equal(delivered(h, AUTHOR.tg).length, 1, 'once');
});

test('the group steps share the tick\'s pacer: posts to several chats at most 25 a second', async () => {
  const h = groupHarness();
  h.exam.counts = only(DHCP);
  const chats = [GROUP, -1002, -1003, -1004];
  for (const chat of chats) h.fg.bind(chat, h.exam);
  const stats = await h.tick();
  assert.equal(stats.posts_posted, 4);
  const times = h.tg.of('sendMessage').map((c) => c.at);
  for (let i = 1; i < times.length; i += 1) assert.ok(times[i] - times[i - 1] >= 40, `${times[i] - times[i - 1]} ms`);
  assert.deepEqual(sends(h).map((p) => p.chat_id).sort(), [...chats].sort());
});

test('4 empty posts and one answered: the post goes out as usual', async () => {
  const h = groupHarness();
  h.exam.counts = only(DHCP);
  h.fg.bind(GROUP, h.exam);
  for (let ago = 5; ago >= 1; ago -= 1) h.fg.pastPost(GROUP, h.fg.daysBefore(DAY, ago), ACID.id, ago === 3 ? 1 : 0);
  await h.tick();
  assert.deepEqual(sends(h).map((p) => p.chat_id), [GROUP]);
});

// ─────────────────────────────────────────── binding: /start@bot G<code> (G1) ───────────────────────────────────────────

test('G1: the author\'s code → G1 in the group (silent, no buttons) and the private line; the code is used', async () => {
  const h = groupHarness();
  h.fg.addCode(CODE, h.exam, { postHour: 12 });
  const update = groupCommand(`/start@Meldyteach_bot ${CODE}`, AUTHOR.tg);
  assert.equal((await h.post(update)).status, 200);
  const claim = h.fdb.of('bot_group_claim')[0].args as Params;
  assert.deepEqual(claim, { p_code: CODE, p_chat_id: GROUP, p_chat_type: 'supergroup', p_title: '3-ПО', p_from_tg_user_id: AUTHOR.tg, p_message_date: new Date(update.message!.date * 1000).toISOString() });
  const [g1, line] = sends(h);
  assert.equal(g1.chat_id, GROUP);
  assert.equal(words(g1.text), 'Вопрос дня из экзамена «Осенняя сессия»\nРаз в день, в 12:00, без звука — один вопрос. Что вы нажали и ответ из файла видите только вы.\nПереписку бот не читает. Убрать вопрос дня — удалить бота из беседы.');
  assert.match(plain(g1.text), /^<b>Вопрос дня из экзамена «Осенняя сессия»<\/b>\n/);
  assert.deepEqual([g1.disable_notification, g1.protect_content, g1.reply_markup], [true, true, undefined]);
  assert.equal(line.chat_id, AUTHOR.tg);
  assert.equal(words(line.text), 'Беседа «3-ПО» подключена: вопрос дня — каждый день в 12:00. Час и отключение — на сайте, в «Пригласить группу».');
  assert.equal(h.tg.of('leaveChat').length, 0);
  assert.equal(h.fg.groups.get(GROUP)!.postHour, 12);
  // Another chat with the same code: used → the bot leaves it quietly, the author hears why.
  const other = { ...groupCommand(`/start@Meldyteach_bot ${CODE}`, AUTHOR.tg) };
  other.message!.chat = { id: -100777, type: 'group', title: 'Чужая' };
  await h.post(other);
  assert.deepEqual(h.tg.of('leaveChat').map((c) => c.params), [{ chat_id: -100777 }]);
  assert.equal(words(sends(h).at(-1)!.text), 'Ссылка устарела. На сайте нажмите «Подключить беседу» ещё раз.');
});

test('G1 at least once: G1 failed → Telegram retries the update → the same code is `again` → G1 goes out', async () => {
  const h = groupHarness();
  h.fg.addCode(CODE, h.exam);
  h.tg.fail('sendMessage', { kind: '5xx', json: true });
  const update = groupCommand(`/start@Meldyteach_bot ${CODE}`, AUTHOR.tg);
  assert.equal((await h.post(update)).status, 503, 'a transient failure: Telegram will retry');
  h.advance(40_000);
  assert.equal((await h.post(update)).status, 200);
  assert.equal(toChat(h, GROUP).length, 2, 'one failed attempt, then G1');
  assert.equal(delivered(h, GROUP).length, 1, 'G1 once in the chat');
  assert.equal(delivered(h, AUTHOR.tg).length, 1);
  assert.equal(h.tg.of('leaveChat').length, 0);
});

test('refusals: someone else\'s Telegram, expired, no group link, garbage — the bot leaves quietly; only a linked sender hears why', async () => {
  const run = async (from: number, setup: (h: GroupHarness) => void, code = CODE) => {
    const h = groupHarness();
    h.fg.addCode(`G${'7e'.repeat(16)}`, h.exam);
    setup(h);
    await h.post(groupCommand(`/start@Meldyteach_bot ${code}`, from));
    return { left: h.tg.of('leaveChat').map((c) => c.params.chat_id), said: sends(h).map((p) => [p.chat_id, words(p.text)]) };
  };
  assert.deepEqual(await run(MEMBER.tg, () => undefined), { left: [GROUP], said: [[MEMBER.tg, 'Подключить беседу может только автор экзамена.']] });
  assert.deepEqual(await run(STRANGER.tg, () => undefined), { left: [GROUP], said: [] }, 'not linked: nobody to tell');
  assert.deepEqual(await run(AUTHOR.tg, (h) => h.advance(61 * MIN)), { left: [GROUP], said: [[AUTHOR.tg, 'Ссылка устарела. На сайте нажмите «Подключить беседу» ещё раз.']] });
  assert.deepEqual(await run(AUTHOR.tg, (h) => { h.exam.linkActive = false; }), { left: [GROUP], said: [[AUTHOR.tg, 'Ссылка устарела. На сайте нажмите «Подключить беседу» ещё раз.']] });
  assert.deepEqual(await run(AUTHOR.tg, () => undefined, `G${'00'.repeat(16)}`), { left: [GROUP], said: [] }, 'an unknown code: no word');
  // A chat already bound to an exam: a refused code never takes the bot out of it.
  assert.deepEqual(await run(MEMBER.tg, (h) => h.fg.bind(GROUP, h.exam)), { left: [], said: [[MEMBER.tg, 'Подключить беседу может только автор экзамена.']] });
});

test('my_chat_member in a group: added or made admin → silence and nothing stored; left / kicked → unbound; migrate → moved', async () => {
  const h = groupHarness();
  await h.post(member({ id: GROUP, type: 'supergroup' }, 'left', 'member'));
  await h.post(member({ id: GROUP, type: 'supergroup' }, 'member', 'administrator'));
  assert.equal(h.fdb.of('bot_group_event').length, 0);
  assert.equal(h.tg.calls.length, 0, 'a bot added without a code says nothing');
  h.fg.bind(GROUP, h.exam);
  await h.post(member({ id: GROUP, type: 'supergroup' }, 'member', 'kicked'));
  assert.notEqual(h.fg.groups.get(GROUP)!.leftAt, null);
  await h.tick();
  assert.equal(sends(h).length, 0, 'unbound: no post');

  const k = groupHarness();
  k.fg.bind(GROUP, k.exam);
  await k.post(member({ id: GROUP, type: 'supergroup' }, 'administrator', 'left'));
  assert.deepEqual(k.fdb.of('bot_group_event').map((x) => x.args), [{ p_chat_id: GROUP, p_event: 'left', p_new_chat_id: null }]);

  const m = groupHarness();
  m.exam.counts = only(DHCP);
  m.fg.bind(-4001, m.exam);
  await m.post(migrate());
  assert.deepEqual(m.fdb.of('bot_group_event').map((x) => x.args), [{ p_chat_id: -4001, p_event: 'migrated', p_new_chat_id: GROUP }]);
  await m.tick();
  assert.deepEqual(sends(m).map((p) => p.chat_id), [GROUP], 'the post goes to the supergroup');
});

// ─────────────────────────────────────────── «Заниматься в Meldy»: /start g<chat> ───────────────────────────────────────────

test('/start g<chat>: a member or the author → K1 of that exam; linked, not in it → «Экзамен «…»»; not linked → M1', async () => {
  const h = groupHarness();
  h.fg.bind(GROUP, h.exam);
  const start = privateText(`/start g${GROUP}`, { from: MEMBER.tg });
  await h.post(start);
  assert.deepEqual(h.fdb.of('bot_group_entry').map((x) => x.args), [{ p_tg_user_id: MEMBER.tg, p_chat_id: GROUP }]);
  const k1 = sends(h).at(-1)!;
  assert.equal(k1.chat_id, MEMBER.tg);
  assert.match(words(k1.text), /^Сегодня около \d+ минут: .+\nОсенняя сессия · 3 ноября, через 18 дней/);
  assert.deepEqual(h.tg.of('deleteMessage').map((c) => c.params.message_id), [start.message!.message_id], 'the typed command goes, as /today');
  await h.post(privateText(`/start g${GROUP}`, { from: AUTHOR.tg }));
  assert.match(words(sends(h).at(-1)!.text), /Осенняя сессия · 3 ноября/);

  await h.post(privateText(`/start g${GROUP}`, { from: OUTSIDER.tg }));
  const card = sends(h).at(-1)!;
  assert.match(card.text, /^<b>Экзамен «Осенняя сессия»<\/b>\n/);
  assert.equal(words(card.text), 'Экзамен «Осенняя сессия»\nОн приходит по ссылке группы — её даёт автор экзамена. Войдите по ней на сайте, и план появится здесь.');
  lintPrivate(card.text, null, ['Осенняя сессия']);

  await h.post(privateText(`/start g${GROUP}`, { from: STRANGER.tg }));
  assert.match(words(sends(h).at(-1)!.text), /^Здесь будет план на каждый день/, 'M1');
  assert.equal(h.fdb.of('bot_group_entry').length, 3, 'not linked: no group lookup');

  await h.post(privateText('/start g-100123', { from: OUTSIDER.tg }));
  assert.match(words(sends(h).at(-1)!.text), /Зимняя сессия/, 'a chat that is not bound: a plain /start (K1)');
});

// ─────────────────────────────────────────── snapshots and the linter ───────────────────────────────────────────

const view = (it: FakeItem, postId = POST): G.PostView => ({
  postId, chatId: GROUP, subject: it.subject, stem: it.stem, options: shownOf(it, postId).map((i) => it.options[i]), code: it.code === true, keepOrder: it.keepOrder === true,
});

test('snapshots of G1–G4 and every G3 reply, each through T2\'s linter (in a group: no blue button, no key)', () => {
  const shots: Record<string, Shot> = {};
  const group = (name: string, out: { text: string; keyboard?: Keyboard | null }, it: FakeItem) => {
    lintGroup(out.text, out.keyboard ?? null, it);
    shots[name] = { text: out.text, keyboard: out.keyboard ?? null };
  };
  const privateShot = (name: string, out: { text: string; keyboard?: Keyboard | null }, user: string[] = []) => {
    lintPrivate(out.text, out.keyboard ?? null, user);
    shots[name] = { text: out.text, keyboard: out.keyboard ?? null };
  };
  group('G1', G.g1('Осенняя сессия', 12), { ...DHCP, subject: 'Осенняя сессия' });
  privateShot('G1_owner', G.ownerLine('3-ПО', 12), ['3-ПО']);
  privateShot('G1_owner_untitled', G.ownerLine(null, 9));
  privateShot('G1_refused_foreign', G.refusal('foreign')!);
  privateShot('G1_refused_expired', G.refusal('expired')!);
  assert.equal(G.refusal('invalid'), null);
  assert.equal(G.refusal('slow_down'), null);
  for (const [name, it] of [['G2_buttons', DHCP], ['G2_letters', ACID], ['G2_code_options', OVERRIDE], ['G2_code_question', OUTPUT], ['G2_six', CONTEXT], ['G2_keep_order', OSI]] as const) {
    group(name, G.postOut(view(it), 'Meldyteach_bot'), it);
  }
  group('G2_counter', G.postOut(view(DHCP), 'Meldyteach_bot', { answered: 14 }), DHCP);
  group('G2_closed', G.postOut(view(DHCP), 'Meldyteach_bot', { answered: 21, closed: true }), DHCP);
  group('G2_closed_empty', G.postOut(view(ACID), 'Meldyteach_bot', { closed: true }), ACID);
  privateShot('G4', G.g4('3-ПО', CID, W.SITE), ['3-ПО']);
  privateShot('G4_untitled', G.g4(null, CID, W.SITE));
  privateShot('not_member', G.notMemberCard('Осенняя сессия'), ['Осенняя сессия']);

  const answered = (who: 'member' | 'unlinked' | 'outsider', correct: boolean, extra: Partial<Extract<G.AnswerResult, { status: 'answered' }>> = {}): G.AnswerResult =>
    ({ status: 'answered', who, correct, choice: correct ? 'DHCP' : 'ARP', key: 'DHCP', recorded: who === 'member', core: who === 'member' ? 'saved' : null, step: correct ? 'start' : 'miss', figure: null, ...extra });
  const replies: Record<string, G.AnswerResult> = {
    member_right: answered('member', true),
    member_two_days: answered('member', true, { step: 'two_days', figure: { twoDays: 144, inPlan: 960 } }),
    member_wrong: answered('member', false),
    member_refused_by_core: answered('member', false, { recorded: false, core: 'stale' }),
    unlinked_right: answered('unlinked', true),
    unlinked_wrong: answered('unlinked', false),
    outsider_right: answered('outsider', true),
    outsider_wrong: answered('outsider', false),
    repeat: { status: 'repeat', correct: false, choice: 'ARP', key: 'DHCP' },
    closed: { status: 'closed', reason: 'time' },
    invalid: { status: 'invalid', reason: 'chat' },
    long_unlinked: { ...answered('unlinked', false), choice: LONG.options[1], key: LONG.options[0] } as G.AnswerResult,
    long_repeat: { status: 'repeat', correct: false, choice: LONG.options[1], key: LONG.options[0] },
  };
  for (const [name, answer] of Object.entries(replies)) {
    const reply = G.g3(answer);
    const showsKey = plain(reply.text).includes('В файле');
    assert.equal(reply.alert, showsKey, `${name}: a window exactly when it shows the key`);
    assert.ok([...reply.text].length <= 200, `${name}: ${[...reply.text].length}`);
    const problems = lintMessage({ text: 'Вопрос дня', toasts: [reply.text], user: [...DHCP.options, ...LONG.options] });
    assert.deepEqual(problems, [], `${name}: ${problems.join('; ')}`);
    shots[`G3_${name}`] = { text: '', keyboard: null, toasts: [`${reply.alert ? 'window' : 'line'}: ${reply.text}`] };
  }
  assert.equal(plain(G.g3(replies.member_refused_by_core).text), 'Неверно. В файле — DHCP.', 'not recorded: no promise of a return');
  matchSnapshots('../group/snapshots', shots);
});

test('the texts T7 returns are raw: < > & are escaped in every message and stay as they are in buttons and windows', async () => {
  const RAW: FakeItem = { ...DHCP, id: 'f1f2c3d4-0000-4000-8000-000000000099', subject: 'Базы <данных> & SQL', stem: 'Что вернёт запрос <select> & <b>?', options: ['<b>x</b>', 'a & b', 'x > y', '1 < 2'], correct: 1 };
  const h = groupHarness();
  h.exam.title = 'Осенняя & <сессия>';
  h.exam.items = [...h.exam.items, RAW];
  h.fg.addCode(CODE, h.exam);
  const cmd = groupCommand(`/start@Meldyteach_bot ${CODE}`, AUTHOR.tg);
  cmd.message!.chat.title = '3-ПО <script>';
  await h.post(cmd);
  h.exam.counts = [counts(RAW, { confirmable: 3 })];
  await h.tick();
  const params = sends(h).at(-1)!;
  await tap(h, shownOf(RAW).indexOf(3), STRANGER.tg);
  const toast = lastAnswer(h);
  assert.equal(toast.text, 'Неверно. В файле — a & b. Чтобы такие ответы шли в план Meldy, подключите Telegram в профиле.', 'a window is plain text');
  await h.tick();
  h.set(AT_2101);
  await h.tick();
  const texts = [...sends(h).map((p) => p.text as string), ...edits(h).map((p) => p.text as string)];
  assert.equal(texts.length, 5, 'G1, the owner\'s line, the post, the counter, the close');
  for (const text of texts) {
    assert.deepEqual(lintMessage({ text, user: ['3-ПО <script>', 'Осенняя & <сессия>', RAW.subject, RAW.stem, ...RAW.options] }).filter((p) => /unescaped|tag|entity|closes|unclosed/.test(p)), [], text);
  }
  assert.match(words(texts[0]), /^Вопрос дня из экзамена «Осенняя & <сессия>»/);
  assert.match(words(texts[1]), /^Беседа «3-ПО <script>» подключена/);
  assert.match(texts[2], /&lt;данных&gt; &amp; SQL/);
  assert.equal(words(params.text).split('\n')[2], 'Что вернёт запрос <select> & <b>?');
  assert.deepEqual(keyboardOf(params.reply_markup).slice(0, -1).map((row) => row[0].text).sort(), [...RAW.options].sort(), 'button labels are plain text');
  const letters = G.postText({ postId: POST, chatId: GROUP, subject: RAW.subject, stem: RAW.stem, options: ['<b>Длинный вариант & не меньше 24 знаков</b>', 'b'], code: false, keepOrder: false });
  assert.match(letters, /<b>А<\/b>\u2002&lt;b&gt;Длинный вариант &amp; не/);
  assert.match(plain(G.g4('3-ПО <script>', CID, W.SITE).text), /«3-ПО &lt;script&gt;»/);
  assert.match(G.notMemberCard('Осенняя & <сессия>').text, /^<b>Экзамен «Осенняя &amp; &lt;сессия&gt;»<\/b>/);
});

test('every Russian string of group.ts follows the copy rules (forbidden words, «!», emoji, capitals)', async () => {
  const sample = Object.values(G.GW).map((v) => (typeof v === 'function' ? (v as (...a: unknown[]) => string)('Х', 12) : v));
  for (const text of sample) {
    const problems = lintMessage({ text: String(text).replace(/[<>&]/g, ' '), toasts: [String(text)], user: ['Х'] });
    assert.deepEqual(problems.filter((p) => !/plain space/.test(p)), [], `${text}: ${problems.join('; ')}`);
  }
});

// ─────────────────────────────────────────── security greps ───────────────────────────────────────────

const OWN = [join(HERE, 'group.ts'), join(HERE, 'group.test.ts'), ...readdirSync(join(HERE, 'fixtures/group')).filter((f) => f.endsWith('.ts')).map((f) => join(HERE, 'fixtures/group', f))];

test('security: data only through rpc/bot_*, no database URL, no console, every send through send(), no table reads', () => {
  for (const file of OWN) {
    const source = readFileSync(file, 'utf8');
    const name = file.slice(HERE.length + 1);
    assert.doesNotMatch(source, new RegExp(`${['SUPABASE', 'DB', 'URL'].join('_')}|postgres(ql)?://`), `${name}: no database connection string`);
    assert.doesNotMatch(source, /\bconsole\./, `${name}: console only in log.ts`);
    assert.doesNotMatch(source, /\/rest\/v1\/(?!rpc\/bot_)/, `${name}: no table reads`);
    assert.doesNotMatch(source, /\bDeno\./, `${name}: Deno only in index.ts and env.ts`);
  }
  const group = readFileSync(join(HERE, 'group.ts'), 'utf8');
  assert.doesNotMatch(group, /['"]sendMessage['"]/, 'group.ts posts only through send()');
  assert.doesNotMatch(group, /\bfetch\(/, 'group.ts has no own HTTP');
  const rpcs = [...group.matchAll(/db\.rpc(?:<[^>]*>)?\('([a-z_]+)'/g)].map((m) => m[1]);
  assert.ok(rpcs.length >= 12);
  assert.ok(rpcs.every((fn) => /^bot_/.test(fn)), rpcs.join(', '));
  // The key never comes from a view: group.ts reads `correct` only from a press's own answer.
  assert.deepEqual([...group.matchAll(/\b(r|raw)\.correct\b/g)].map((m) => m[0]), ['r.correct', 'r.correct']);
});

test('the fake token never appears in a log line or an error, and no log line names a chat, a user or a text', async () => {
  const h = groupHarness();
  h.fg.addCode(CODE, h.exam);
  await h.post(groupCommand(`/start@Meldyteach_bot ${CODE}`, AUTHOR.tg));
  h.tg.fail('sendMessage', { kind: 'network' });
  await posted(h);
  await tap(h, 0, MEMBER.tg);
  h.fdb.fail('bot_group_answer', new DbError('bot_group_answer', 0, 'network'));
  await tap(h, 1, OUTSIDER.tg);
  const secret = TEST_TOKEN.split(':')[1];
  for (const line of LOGS) {
    assert.ok(!line.includes(secret), line);
    for (const id of [String(GROUP).slice(1), String(AUTHOR.tg), String(MEMBER.tg), String(OUTSIDER.tg)]) assert.ok(!line.includes(id), `${line} names ${id}`);
    assert.doesNotMatch(line, /[а-яё]/i, `${line}: no text`);
  }
  assert.ok(LOGS.some((line) => /"route":"tick"/.test(line)));
});
