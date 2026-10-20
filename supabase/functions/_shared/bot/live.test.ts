// The live game's messages (live.ts; docs/live/CONTRACT.md §9): the group post, its edits, the final post, the private
// chat's answer to /start play_<PIN> and r_<game>, the edit cadence; and the /start hook through the whole function.
// Run: node --experimental-strip-types --test supabase/functions/_shared/bot/live.test.ts
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  EDIT_GAP_MS,
  LOBBY_GAP_MS,
  gameKey,
  hpPct,
  liveEdit,
  liveFinal,
  livePost,
  liveText,
  miniAppUrl,
  parseLiveStart,
  planEdit,
  playPrivate,
  playUrl,
  reviewPrivate,
  reviewUrl,
  statusOf,
  type LiveGameInfo,
} from './live.ts';
import { lintMessage } from './lint.ts';
import { visibleText } from './html.ts';
import { inlineMarkup, type Out } from './tg.ts';
import { harness } from './fixtures/harness.ts';
import { privateText } from './fixtures/updates.ts';
import { TG } from './fixtures/scenario.ts';
import { SITE } from './words.ts';

const GAME = '0a1b2c3d-4e5f-4a6b-8c7d-0123456789ab';
const KEY = '0a1b2c3d4e5f4a6b8c7d0123456789ab';
const BASE: LiveGameInfo = { gameId: GAME, pin: '482913', title: 'Базы данных', qCount: 6, host: 'Анна Сергеевна', chatNames: true, direct: true };
const plain = (html: string) => visibleText(html).replace(/[  ]/g, ' ');
const words = (out: Out) => plain(out.text).split('\n');

/**
 * The linter with the two exceptions the contract makes on purpose (CONTRACT §9): «Игра по тесту «…»» names the test
 * (the bot's own words otherwise never say «тест»), and the group post's «Играть» is the one blue button of a group.
 * Everything else of the linter holds.
 */
function lint(out: Out, chat: 'private' | 'group', user: string[] = []): string[] {
  return lintMessage({ text: out.text, keyboard: out.keyboard, chat, user }).filter(
    (p) => !/forbidden ««тест» for the exam»/.test(p) && !(chat === 'group' && p === 'a blue button in a group'),
  );
}

test('links: the direct Mini App link, or the private chat until the owner\'s @BotFather step', () => {
  assert.equal(playUrl('482913', true), 'https://t.me/Meldyteach_bot/play?startapp=482913');
  assert.equal(playUrl('482913', false), 'https://t.me/Meldyteach_bot?start=play_482913');
  assert.equal(reviewUrl(GAME, true), `https://t.me/Meldyteach_bot/play?startapp=r_${KEY}`);
  assert.equal(reviewUrl(GAME, false), `https://t.me/Meldyteach_bot?start=r_${KEY}`);
  assert.equal(gameKey(GAME.toUpperCase()), KEY);
  assert.equal(miniAppUrl(SITE, { pin: '482913' }), `${SITE}/tg/play?pin=482913`);
  assert.equal(miniAppUrl(SITE, { review: GAME }), `${SITE}/tg/play?r=${KEY}`);
  assert.throws(() => playUrl('48291', true));
  assert.throws(() => playUrl('48291a', true));
  assert.throws(() => reviewUrl('not-a-game', true));
  // Telegram's start parameter: 1–64 of A–Z a–z 0–9 _ -.
  for (const url of [playUrl('482913', false), reviewUrl(GAME, false), reviewUrl(GAME, true)]) {
    const param = new URL(url).searchParams.get('start') ?? new URL(url).searchParams.get('startapp');
    assert.match(param ?? '', /^[A-Za-z0-9_-]{1,64}$/);
  }
});

test('the post: title, mode and count, host and PIN, players; one URL button «Играть»', () => {
  const out = livePost(BASE, 9);
  assert.deepEqual(words(out), ['Игра по тесту «Базы данных»', 'Битва с монстром · 6 вопросов', 'Ведёт Анна Сергеевна · PIN 482 913', 'Играют 9']);
  assert.match(out.text, /^<b>Игра по\u00a0тесту «Базы данных»<\/b>\n/);
  assert.deepEqual(out.keyboard, [[{ text: 'Играть', url: 'https://t.me/Meldyteach_bot/play?startapp=482913', style: 'primary' }]]);
  assert.deepEqual(inlineMarkup(out.keyboard ?? []), { inline_keyboard: [[{ text: 'Играть', url: 'https://t.me/Meldyteach_bot/play?startapp=482913', style: 'primary' }]] });
  assert.deepEqual(lint(out, 'group', ['Базы данных', 'Анна Сергеевна']), []);
  // No host: the line is the PIN alone. The fallback link while the direct link is off.
  const noHost = livePost({ ...BASE, host: '  ', direct: false });
  assert.equal(words(noHost)[2], 'PIN 482 913');
  assert.equal(words(noHost)[3], 'Играют 0');
  assert.equal(noHost.keyboard?.[0][0].url, 'https://t.me/Meldyteach_bot?start=play_482913');
  // The count's word follows the number.
  assert.equal(words(livePost({ ...BASE, qCount: 3 }))[1], 'Битва с монстром · 3 вопроса');
  assert.equal(words(livePost({ ...BASE, qCount: 21 }))[1], 'Битва с монстром · 21 вопрос');
  // No-break spaces where a line must not break (the site's glue).
  assert.match(out.text, /6 вопросов/);
  assert.match(out.text, /PIN 482 913/);
});

test('the post escapes what the author typed', () => {
  const out = livePost({ ...BASE, title: 'SQL <b> & «JOIN»', host: 'Анна <script>' });
  assert.match(out.text, /SQL &lt;b&gt; &amp; «JOIN»/);
  assert.match(out.text, /Анна &lt;script&gt;/);
  assert.deepEqual(lint(out, 'group', ['SQL <b> & «JOIN»', 'Анна <script>']), []);
});

test('edits: the lobby count, the question with the boss\'s HP, the end without the keyboard', () => {
  const lobby = liveEdit(BASE, { state: 'lobby', players: 22 });
  assert.equal(words(lobby)[3], 'Играют 22');
  assert.ok(lobby.keyboard);
  const q = liveEdit(BASE, { state: 'question', qi: 1, players: 24, hpPct: 63 });
  assert.deepEqual(words(q), ['Игра по тесту «Базы данных»', 'Битва с монстром · 6 вопросов', 'Идёт игра · вопрос 2 из 6', 'Играют 24 · у Дедлайна 63 %']);
  assert.ok(q.keyboard, '«Играть» stays: a late player can still join');
  assert.deepEqual(lint(q, 'group', ['Базы данных']), []);
  const end = liveEdit(BASE, { state: 'ended' });
  assert.deepEqual(words(end), ['Игра по тесту «Базы данных»', 'Битва с монстром · 6 вопросов', 'Игра закончилась']);
  assert.equal(end.keyboard, null);
  assert.deepEqual(lint(end, 'group', ['Базы данных']), []);
});

test('the final post: the top three only with chat_names, accuracy, «Разбор» and «Ещё игра»', () => {
  const final = { won: true, top: [{ name: 'Лена', dmg: 779 }, { name: 'Дима', dmg: 724 }, { name: 'Вера', dmg: 592 }, { name: 'Олег', dmg: 500 }], accuracyPct: 69, examUrl: `${SITE}/exams/c/1` };
  const named = liveFinal(BASE, final);
  assert.deepEqual(words(named), ['Дедлайн повержен', '1. Лена — 779', '2. Дима — 724', '3. Вера — 592', 'Верных ответов 69 %. Свой разбор — у каждого в игре.']);
  assert.deepEqual(named.keyboard, [[{ text: 'Разбор', url: `https://t.me/Meldyteach_bot/play?startapp=r_${KEY}` }, { text: 'Ещё игра', url: `${SITE}/exams/c/1` }]]);
  assert.deepEqual(lint(named, 'group', ['Лена', 'Дима', 'Вера']), []);
  const quiet = liveFinal({ ...BASE, chatNames: false, direct: false }, { ...final, won: false });
  assert.deepEqual(words(quiet), ['Дедлайн победил', 'Верных ответов 69 %. Свой разбор — у каждого в игре.']);
  assert.equal(quiet.keyboard?.[0][0].url, `https://t.me/Meldyteach_bot?start=r_${KEY}`);
  assert.deepEqual(lint(quiet, 'group'), []);
  // A player's name is escaped and never read as markup.
  const odd = liveFinal(BASE, { ...final, top: [{ name: '<i>Хакер</i>', dmg: 100.4 }] });
  assert.match(odd.text, /1\. &lt;i&gt;Хакер&lt;\/i&gt; — 100/);
});

test('no keys and no per-question correctness ever reach the chat', () => {
  const all = [
    livePost(BASE, 3),
    liveEdit(BASE, { state: 'question', qi: 0, players: 3, hpPct: 100 }),
    liveEdit(BASE, { state: 'ended' }),
    liveFinal(BASE, { won: true, top: [], accuracyPct: 50, examUrl: SITE }),
  ];
  for (const out of all) assert.doesNotMatch(plain(out.text), /верный ответ|ключ|SERIALIZABLE|ROLLBACK|вариант [А-Г]/i);
});

test('/start payloads: play_<PIN> and r_<game>; other payloads are not the game\'s', () => {
  assert.deepEqual(parseLiveStart('play_482913'), { kind: 'play', pin: '482913' });
  assert.deepEqual(parseLiveStart(`r_${KEY}`), { kind: 'review', gameId: GAME });
  for (const other of ['', 'play_48291', 'play_4829130', 'play_48291a', `r_${KEY}0`, `r_${KEY.toUpperCase()}`, 'L0123456789abcdef0123456789abcdef', 'g42', 'G0001']) {
    assert.equal(parseLiveStart(other), null, other);
  }
});

test('the private chat\'s buttons: web_app «Играть» / «Разбор» to /tg/play', () => {
  const play = playPrivate('482913', SITE);
  assert.deepEqual(words(play), ['Битва с монстром · PIN 482 913', 'Нажмите «Играть»: игра откроется здесь, в Telegram.']);
  assert.deepEqual(play.keyboard, [[{ text: 'Играть', webApp: `${SITE}/tg/play?pin=482913`, style: 'primary' }]]);
  assert.deepEqual(lintMessage({ text: play.text, keyboard: play.keyboard, chat: 'private' }), []);
  const review = reviewPrivate(GAME, SITE);
  assert.deepEqual(review.keyboard, [[{ text: 'Разбор', webApp: `${SITE}/tg/play?r=${KEY}`, style: 'primary' }]]);
  assert.deepEqual(lintMessage({ text: review.text, keyboard: review.keyboard, chat: 'private' }), []);
});

test('the cadence: countdown and reveal edit, open and leaderboard do not; 3 s between edits, 5 s in the lobby', () => {
  const f = { qi: 2, players: 24, hp: 2600, hpMax: 7920 };
  assert.deepEqual(statusOf('countdown', f), { state: 'question', qi: 2, players: 24, hpPct: 33 });
  assert.deepEqual(statusOf('reveal', f), { state: 'question', qi: 2, players: 24, hpPct: 33 });
  assert.equal(statusOf('open', f), null);
  assert.equal(statusOf('leaderboard', f), null);
  assert.deepEqual(statusOf('lobby', f), { state: 'lobby', players: 24 });
  assert.deepEqual(statusOf('podium', f), { state: 'ended' });
  assert.deepEqual(statusOf('ended', f), { state: 'ended' });

  const t0 = 1_000_000;
  const text = (s: ReturnType<typeof statusOf>) => (s ? liveText(BASE, s) : null);
  const q = statusOf('countdown', f);
  assert.deepEqual(planEdit({ at: null, text: null }, q, text(q), t0), { send: true, waitMs: 0 });
  assert.deepEqual(planEdit({ at: t0, text: 'x' }, q, text(q), t0 + EDIT_GAP_MS - 1), { send: false, reason: 'soon' });
  assert.deepEqual(planEdit({ at: t0, text: 'x' }, q, text(q), t0 + EDIT_GAP_MS), { send: true, waitMs: 0 });
  assert.deepEqual(planEdit({ at: t0, text: text(q) }, q, text(q), t0 + 60_000), { send: false, reason: 'same' });
  assert.deepEqual(planEdit({ at: t0, text: 'x' }, null, null, t0 + 60_000), { send: false, reason: 'state' });
  const lobby = statusOf('lobby', f);
  assert.deepEqual(planEdit({ at: t0, text: 'x' }, lobby, text(lobby), t0 + EDIT_GAP_MS), { send: false, reason: 'soon' });
  assert.deepEqual(planEdit({ at: t0, text: 'x' }, lobby, text(lobby), t0 + LOBBY_GAP_MS), { send: true, waitMs: 0 });
  // The end always goes out: after the rest of the gap when it came too soon.
  const end = statusOf('podium', f);
  assert.deepEqual(planEdit({ at: t0, text: 'x' }, end, text(end), t0 + 1200), { send: true, waitMs: EDIT_GAP_MS - 1200 });
  assert.deepEqual(planEdit({ at: t0, text: 'x' }, end, text(end), t0 + 9000), { send: true, waitMs: 0 });
});

test('the boss\'s HP share: whole percent, 1 % while alive, 0 when defeated', () => {
  assert.equal(hpPct(7920, 7920), 100);
  assert.equal(hpPct(4992, 7920), 63);
  assert.equal(hpPct(10, 7920), 1);
  assert.equal(hpPct(0, 7920), 0);
  assert.equal(hpPct(5, 0), 0);
  assert.equal(hpPct(9000, 7920), 100);
});

test('through the function: /start play_<PIN> answers with the web_app button, linked or not, and claims no link', async () => {
  const h = harness();
  const res = await h.post(privateText('/start play_482913'));
  assert.equal(res.status, 200);
  const sent = h.tg.of('sendMessage').map((c) => c.params);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].chat_id, TG);
  assert.equal(sent[0].protect_content, true);
  assert.deepEqual(sent[0].reply_markup, { inline_keyboard: [[{ text: 'Играть', web_app: { url: `${SITE}/tg/play?pin=482913` }, style: 'primary' }]] });
  assert.equal(h.fdb.of('bot_link_claim').length, 0, 'the payload is never a link code');

  const r = await h.post(privateText(`/start r_${KEY}`));
  assert.equal(r.status, 200);
  const last = h.tg.of('sendMessage').map((c) => c.params).at(-1);
  assert.deepEqual(last?.reply_markup, { inline_keyboard: [[{ text: 'Разбор', web_app: { url: `${SITE}/tg/play?r=${KEY}` }, style: 'primary' }]] });
  assert.equal(h.fdb.of('bot_link_claim').length, 0);

  // Another payload still goes to the link claim as before.
  await h.post(privateText('/start L0123456789abcdef0123456789abcdef'));
  assert.equal(h.fdb.of('bot_link_claim').length, 1);
});
