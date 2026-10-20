// The live game's bot texts (live.ts; docs/live/CONTRACT.md §9): the group post, its edits, the final post as the
// `LiveTexts` game.ts sends; the private chat's answer to /start play_<PIN> and r_<game>; and both through the whole
// function (game.ts's /game/post and /game/sync with these texts, the router's /start hook).
// Run: node --experimental-strip-types --test supabase/functions/_shared/bot/live.test.ts
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { createGame, type LiveFinal, type LiveNow, type LivePost } from './game.ts';
import {
  gameKey, liveEdit, liveFinal, livePost, liveTexts, miniAppUrl, parseLiveStart, playPrivate, playUrl, reviewPrivate, reviewUrl,
} from './live.ts';
import { lintMessage } from './lint.ts';
import { visibleText } from './html.ts';
import { createApp } from './router.ts';
import { inlineMarkup, type Out } from './tg.ts';
import { harness } from './fixtures/harness.ts';
import { fakeDb } from './fixtures/fake_db.ts';
import { fakeTelegram, TEST_FUNCTION_URL, TEST_TOKEN } from './fixtures/fake_telegram.ts';
import { NOW, TG } from './fixtures/scenario.ts';
import { privateText } from './fixtures/updates.ts';
import { SITE } from './words.ts';

const GAME = '0a1b2c3d-4e5f-4a6b-8c7d-0123456789ab';
const KEY = '0a1b2c3d4e5f4a6b8c7d0123456789ab';
const EXAM = 'c9b8c7d6-0000-4000-8000-000000000003';
const LINKS = { site: SITE, bot: 'Meldyteach_bot' };
const POST: LivePost = { title: 'Базы данных', qCount: 6, host: 'Анна Сергеевна', pin: '482913', players: 9, direct: true };
const NOW_Q: LiveNow = { ...POST, state: 'countdown', qi: 1, players: 24, hpPct: 63 };
const FINAL: LiveFinal = { won: true, top: [{ name: 'Лена', dmg: 779 }, { name: 'Дима', dmg: 724 }, { name: 'Вера', dmg: 592 }], accuracyPct: 69, gameId: GAME, containerId: EXAM, direct: true };
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
  assert.equal(playUrl('482913', true, 'OtherBot'), 'https://t.me/OtherBot/play?startapp=482913');
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
  const out = livePost(POST, LINKS);
  assert.deepEqual(words(out), ['Игра по тесту «Базы данных»', 'Битва с монстром · 6 вопросов', 'Ведёт Анна Сергеевна · PIN 482 913', 'Играют 9']);
  assert.match(out.text, /^<b>Игра по тесту «Базы данных»<\/b>\n/);
  assert.deepEqual(out.keyboard, [[{ text: 'Играть', url: 'https://t.me/Meldyteach_bot/play?startapp=482913', style: 'primary' }]]);
  assert.deepEqual(inlineMarkup(out.keyboard ?? []), { inline_keyboard: [[{ text: 'Играть', url: 'https://t.me/Meldyteach_bot/play?startapp=482913', style: 'primary' }]] });
  assert.deepEqual(lint(out, 'group', ['Базы данных', 'Анна Сергеевна']), []);
  // No host: the line is the PIN alone. The private chat's link while the direct link is off (tg_url follows it).
  const noHost = livePost({ ...POST, host: '  ', direct: false, players: 0 }, LINKS);
  assert.equal(words(noHost)[2], 'PIN 482 913');
  assert.equal(words(noHost)[3], 'Играют 0');
  assert.equal(noHost.keyboard?.[0][0].url, 'https://t.me/Meldyteach_bot?start=play_482913');
  assert.equal(livePost({ ...POST, host: null }, LINKS).text.split('\n')[2], 'PIN 482 913');
  // The count's word follows the number.
  assert.equal(words(livePost({ ...POST, qCount: 3 }, LINKS))[1], 'Битва с монстром · 3 вопроса');
  assert.equal(words(livePost({ ...POST, qCount: 21 }, LINKS))[1], 'Битва с монстром · 21 вопрос');
  // No-break spaces where a line must not break (the site's glue).
  assert.match(out.text, /6 вопросов/);
});

test('the post escapes what the author typed', () => {
  const out = livePost({ ...POST, title: 'SQL <b> & «JOIN»', host: 'Анна <script>' }, LINKS);
  assert.match(out.text, /SQL &lt;b&gt; &amp; «JOIN»/);
  assert.match(out.text, /Анна &lt;script&gt;/);
  assert.deepEqual(lint(out, 'group', ['SQL <b> & «JOIN»', 'Анна <script>']), []);
});

test('edits: the lobby count, the question with the boss\'s HP, the end without the keyboard', () => {
  const lobby = liveEdit({ ...NOW_Q, state: 'lobby', qi: -1, hpPct: null, players: 22 }, LINKS);
  assert.equal(words(lobby)[3], 'Играют 22');
  assert.ok(lobby.keyboard);
  const q = liveEdit(NOW_Q, LINKS);
  assert.deepEqual(words(q), ['Игра по тесту «Базы данных»', 'Битва с монстром · 6 вопросов', 'Идёт игра · вопрос 2 из 6', 'Играют 24 · у Дедлайна 63 %']);
  assert.ok(q.keyboard, '«Играть» stays: a late player can still join');
  assert.deepEqual(lint(q, 'group', ['Базы данных']), []);
  for (const state of ['open', 'reveal', 'leaderboard'] as const) assert.equal(words(liveEdit({ ...NOW_Q, state }, LINKS))[2], 'Идёт игра · вопрос 2 из 6');
  // Before the first question's HP is known, no HP.
  assert.equal(words(liveEdit({ ...NOW_Q, qi: 0, hpPct: null }, LINKS))[3], 'Играют 24');
  for (const state of ['podium', 'ended'] as const) {
    const end = liveEdit({ ...NOW_Q, state }, LINKS);
    assert.deepEqual(words(end), ['Игра по тесту «Базы данных»', 'Битва с монстром · 6 вопросов', 'Игра закончилась']);
    assert.equal(end.keyboard, null);
    assert.deepEqual(lint(end, 'group', ['Базы данных']), []);
  }
});

test('the final post: the top three when given, accuracy, «Разбор» and «Ещё игра»', () => {
  const named = liveFinal(FINAL, LINKS);
  assert.deepEqual(words(named), ['Дедлайн повержен', '1. Лена — 779', '2. Дима — 724', '3. Вера — 592', 'Верных ответов 69 %. Свой разбор — у каждого в игре.']);
  assert.deepEqual(named.keyboard, [[{ text: 'Разбор', url: `https://t.me/Meldyteach_bot/play?startapp=r_${KEY}` }, { text: 'Ещё игра', url: `${SITE}/exams/c/${EXAM}` }]]);
  assert.deepEqual(lint(named, 'group', ['Лена', 'Дима', 'Вера']), []);
  const quiet = liveFinal({ ...FINAL, top: null, direct: false, won: false }, LINKS);
  assert.deepEqual(words(quiet), ['Дедлайн победил', 'Верных ответов 69 %. Свой разбор — у каждого в игре.']);
  assert.equal(quiet.keyboard?.[0][0].url, `https://t.me/Meldyteach_bot?start=r_${KEY}`);
  assert.deepEqual(lint(quiet, 'group'), []);
  // A player's name is escaped and never read as markup; never more than three.
  const odd = liveFinal({ ...FINAL, top: [{ name: '<i>Хакер</i>', dmg: 100.4 }, ...(FINAL.top ?? []), { name: 'Пятый', dmg: 1 }] }, LINKS);
  assert.match(odd.text, /1\. &lt;i&gt;Хакер&lt;\/i&gt; — 100/);
  assert.equal(words(odd).length, 5);
});

test('no keys and no per-question correctness ever reach the chat', () => {
  const all = [livePost(POST, LINKS), liveEdit(NOW_Q, LINKS), liveEdit({ ...NOW_Q, state: 'ended' }, LINKS), liveFinal({ ...FINAL, top: [] }, LINKS)];
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

test('through the function: game.ts posts, edits and closes with these texts', async () => {
  const tg = fakeTelegram({ now: () => NOW });
  const fdb = fakeDb({ now: () => NOW });
  const works: Promise<unknown>[] = [];
  const game = createGame({ token: () => TEST_TOKEN, texts: liveTexts, waitUntil: (w) => works.push(w), now: () => NOW });
  const app = createApp({ token: TEST_TOKEN, fetch: tg.fetch, db: fdb.db, functionUrl: TEST_FUNCTION_URL, waitUntil: () => undefined, now: () => NOW, ports: { game }, sleep: async () => undefined, random: () => 0.5 });
  const live = createHmac('sha256', TEST_TOKEN).update('meldy:live:v1').digest('base64url');
  const fromDb = async (action: 'post' | 'sync') => {
    const res = await app(new Request(`${TEST_FUNCTION_URL}/game/${action}`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-meldy-live': live }, body: JSON.stringify({ game_id: GAME }) }));
    await Promise.all(works.splice(0));
    return res.status;
  };
  const CHAT = -1001234567890;
  fdb.on('bot_live_post', () => ({ status: 'post', chat_id: CHAT, title: 'Базы данных', q_count: 6, host: 'Анна Сергеевна', pin: '482913', players: 3, direct: false }));
  fdb.on('bot_live_posted', () => ({ status: 'ok' }));
  assert.equal(await fromDb('post'), 202);
  const [post] = tg.of('sendMessage');
  assert.equal(post.params.text, livePost({ ...POST, players: 3, direct: false }, LINKS).text);
  assert.equal(post.params.disable_notification, false, 'the post rings');
  assert.deepEqual(post.params.reply_markup, { inline_keyboard: [[{ text: 'Играть', url: 'https://t.me/Meldyteach_bot?start=play_482913', style: 'primary' }]] });

  const sync = { status: 'edit', chat_id: CHAT, message_id: 555, state: 'countdown', players: 24, qi: 1, q_count: 6, hp_pct: 63, title: 'Базы данных', pin: '482913', host: null, direct: true, final: null };
  let answer: Record<string, unknown> = sync;
  fdb.on('bot_live_sync', () => answer);
  await fromDb('sync');
  const [edit] = tg.of('editMessageText');
  assert.deepEqual(plain(edit.params.text).split('\n').slice(2), ['Идёт игра · вопрос 2 из 6', 'Играют 24 · у Дедлайна 63 %']);
  answer = { ...sync, state: 'podium', qi: 5, final: { won: true, top: [{ name: 'Лена', dmg: 779 }], accuracy_pct: 69, game_id: GAME, container_id: EXAM } };
  await fromDb('sync');
  const end = tg.of('editMessageText')[1];
  assert.ok(plain(end.params.text).endsWith('Игра закончилась'));
  assert.equal(end.params.reply_markup, undefined);
  const fin = tg.of('sendMessage')[1];
  assert.deepEqual(plain(fin.params.text).split('\n'), ['Дедлайн повержен', '1. Лена — 779', 'Верных ответов 69 %. Свой разбор — у каждого в игре.']);
  assert.equal(fin.params.disable_notification, true);
});
