import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { after, test } from 'node:test';
import { DbError } from './db.ts';
import {
  anySignal, arrivalOf, cleanMime, cleanName, contentType, createFiles, disposition, f1, fallbackName, FileStreamError, filePathUrl, files as defaultFiles,
  MAX_BYTES, notADocument, notLinked, shownName, sizeText, toOffer, toRedeemed, tooBig,
} from './files.ts';
import { NBSP } from './html.ts';
import { lintMessage } from './lint.ts';
import { setLogSink } from './log.ts';
import { matchSnapshots } from './fixtures/snapshot.ts';
import { createApp, type Ctx } from './router.ts';
import { derivedSecret } from './secrets.ts';
import { createTelegram, type Keyboard, type TgMessage } from './tg.ts';
import * as W from './words.ts';
import { fakeDb } from './fixtures/fake_db.ts';
import { fakeFileServer, fakeFileStore, syntheticBytes } from './fixtures/fake_files.ts';
import { fakeTelegram, TEST_FUNCTION_URL, TEST_TOKEN } from './fixtures/fake_telegram.ts';
import { NOW, TG, USER } from './fixtures/scenario.ts';

// Every log line of this file: none may carry the token, a URL, a ticket, a file token, a name or an id (spec §6.7).
const logLines: string[] = [];
const restoreLog = setLogSink((line) => logLines.push(line));
after(() => restoreLog());
/** Everything a response showed the outside (status, headers, a text body): checked for leaks at the end. */
const shown: string[] = [];
const secrets = new Set<string>();

const n = (s: string) => s.replace(/~/g, NBSP);
const sha = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const NAME = 'Банк_БД_2026.docx';
const FILE_ID = 'BQACAgIAAxkBAAIBc2Zm_test-file_1';
const BYTES = syntheticBytes(1258291);
const OTHER_TG = 700999;
let nextUpdate = 81000;
let nextMessage = 300;

function harness(deps: { headersTimeoutMs?: number; totalTimeoutMs?: number; token?: () => string } = {}) {
  let clock = NOW;
  const now = () => clock;
  const tg = fakeTelegram({ now });
  const fake = fakeDb({ now });
  const store = fakeFileStore(fake, { now });
  const server = fakeFileServer(tg, { 'documents/file_12.docx': BYTES, 'documents/file_13.xlsx': syntheticBytes(2048, 3) });
  tg.result('getFile', (p) => ({
    file_id: p.file_id, file_unique_id: 'AgADxyz', file_size: BYTES.length,
    file_path: p.file_id === 'BQACAgIAAxkBAAIBc2Zm_test-file_2' ? 'documents/file_13.xlsx' : 'documents/file_12.docx',
  }));
  const port = createFiles({ token: deps.token ?? (() => TEST_TOKEN), fetch: server.fetch, headersTimeoutMs: deps.headersTimeoutMs ?? 300,
    totalTimeoutMs: deps.totalTimeoutMs ?? 2000 });
  const app = createApp({
    token: TEST_TOKEN, fetch: server.fetch, db: fake.db, functionUrl: TEST_FUNCTION_URL, waitUntil: () => undefined, now,
    ports: { files: port }, sleep: async () => undefined, random: () => 0.5,
  });
  fake.addLink({ userId: USER, tgUserId: TG });
  const ctx: Ctx = {
    tg: createTelegram({ token: TEST_TOKEN, fetch: server.fetch, sleep: async () => undefined, random: () => 0.5 }),
    db: fake.db, site: W.SITE, botUsername: W.BOT_USERNAME, now, hourly: () => true,
  };
  return { tg, fake, store, server, port, app, ctx, now, pass(ms: number) { clock += ms; } };
}
type Harness = ReturnType<typeof harness>;

function message(fields: Record<string, unknown>, from = TG): TgMessage {
  return { message_id: nextMessage++, date: Math.floor(NOW / 1000), chat: { id: from, type: 'private' }, from: { id: from, is_bot: false, language_code: 'ru' }, ...fields } as TgMessage;
}
const document = (over: Record<string, unknown> = {}) =>
  ({ document: { file_id: FILE_ID, file_unique_id: 'AgADxyz', file_name: NAME, mime_type: DOCX, file_size: 1258291, ...over } });

async function webhook(h: Harness, msg: TgMessage): Promise<number> {
  const secret = await derivedSecret(TEST_TOKEN, 'webhook');
  const res = await h.app(new Request(TEST_FUNCTION_URL, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-telegram-bot-api-secret-token': secret },
    body: JSON.stringify({ update_id: nextUpdate++, message: msg }),
  }));
  return res.status;
}

/** GET /telegram/file?t=… as the site's import sends it (or with another Origin / none / another method). */
async function getFile(h: Harness, token: string, init: { origin?: string | null; method?: string } = {}) {
  const origin = init.origin === undefined ? W.SITE : init.origin;
  const res = await h.app(new Request(`${TEST_FUNCTION_URL}/file?t=${token}&forceFunctionRegion=eu-central-1`, {
    method: init.method ?? 'GET', headers: origin ? { origin } : {},
  }));
  shown.push(`${res.status} ${JSON.stringify([...res.headers.entries()])}`);
  return res;
}
const errorOf = async (res: Response) => {
  const body = await res.text();
  shown.push(body);
  return (JSON.parse(body) as { error: string }).error;
};

const sent = (h: Harness) => h.tg.of('sendMessage').map((c) => c.params);
const buttonsOf = (params: Record<string, any>): Keyboard => params.reply_markup?.inline_keyboard ?? [];
function ticketOf(params: Record<string, any>): string {
  const url = String(buttonsOf(params)[0]?.[0]?.url ?? '');
  const m = /\?tg=(F[0-9a-f]{32})$/.exec(url);
  assert.ok(m, `F1's button: ${url}`);
  secrets.add(m[1]);
  return m[1];
}
function takeToken(h: Harness, ticket: string): string {
  const taken = h.store.take(USER, ticket);
  assert.equal(taken.status, 'ok', JSON.stringify(taken));
  secrets.add(String(taken.token));
  return String(taken.token);
}
/** F1 through the webhook, the site's take: the token for the file route. */
async function offered(h: Harness, over: Record<string, unknown> = {}): Promise<{ ticket: string; token: string }> {
  assert.equal(await webhook(h, message(document(over))), 200);
  const ticket = ticketOf(sent(h).at(-1)!);
  return { ticket, token: takeToken(h, ticket) };
}
const lastLog = () => JSON.parse(logLines.at(-1) as string) as Record<string, unknown>;

// ─────────────────────────────────────────── the messages ───────────────────────────────────────────

test('F1 and the refusals of §4.7: text and keyboard as the spec draws them, through the linter', () => {
  const ticket = `F${'0a'.repeat(16)}`;
  const shots = {
    f1: f1(W.SITE, { name: NAME, size: 1258291, ticket }),
    f1_no_size: f1(W.SITE, { name: 'Сети.txt', size: null, ticket }),
    not_linked: notLinked(W.SITE),
    too_big: tooBig(W.SITE),
    not_a_document: notADocument(),
  };
  assert.deepEqual(shots.f1, {
    text: n('<b>Банк_БД_2026.docx</b>~· 1,2~МБ\nОткройте его в~загрузке Meldy: там видно, как отмечены ответы, и~можно проверить вопросы.'),
    keyboard: [[{ text: 'Открыть в Meldy', url: `https://ludosiel-studyforge.hf.space/exams/import?tg=${ticket}`, style: 'primary' }]],
  });
  assert.equal(shots.f1_no_size.text, n('<b>Сети.txt</b>\nОткройте его в~загрузке Meldy: там видно, как отмечены ответы, и~можно проверить вопросы.'));
  assert.deepEqual(shots.not_linked, {
    text: n('Чтобы открыть файл в~Meldy, сначала подключите Telegram в~профиле. Потом перешлите файл ещё раз.'),
    keyboard: [[{ text: 'Открыть профиль Meldy', url: 'https://ludosiel-studyforge.hf.space/profile#telegram' }]],
  });
  assert.deepEqual(shots.too_big, {
    text: n('Файл больше 20~МБ~— бот не~может его скачать. Загрузите его на~сайте.'),
    keyboard: [[{ text: 'Загрузить на сайте', url: 'https://ludosiel-studyforge.hf.space/exams/import' }]],
  });
  assert.deepEqual(shots.not_a_document, {
    text: n('Сюда можно переслать файл с~вопросами~— Word, Excel или TXT. План на~сегодня~— /today.'),
    keyboard: null,
  });
  // A long name is shortened in the middle, its extension kept.
  const long = 'Банк_БД_2026_осенняя_сессия_все_предметы_и_темы_с_ответами_версия_окончательная.docx';
  const f1Long = f1(W.SITE, { name: long, size: 20 * 1024 * 1024, ticket });
  assert.ok(f1Long.text.startsWith(`<b>${shownName(long)}</b>`) && shownName(long).endsWith('….docx') && [...shownName(long)].length === 64, f1Long.text);
  const all = { ...shots, f1_long_name: f1Long };
  for (const [name, out] of Object.entries(all)) {
    assert.deepEqual(lintMessage({ text: out.text, keyboard: out.keyboard, chat: 'private', user: [NAME, 'Сети.txt', shownName(long)] }), [], name);
  }
  matchSnapshots('files', Object.fromEntries(Object.entries(all).map(([name, out]) => [name, { text: out.text, keyboard: out.keyboard ?? null }])));
  // The name is the user's: escaped, never formatted.
  assert.ok(f1(W.SITE, { name: 'a<b>&"c".txt', size: null, ticket }).text.startsWith('<b>a&lt;b&gt;&amp;&quot;c&quot;.txt</b>'));
});

test('size, name, type and path helpers', () => {
  assert.equal(sizeText(1258291), n('1,2~МБ'));
  assert.equal(sizeText(20 * 1024 * 1024), n('20~МБ'));
  assert.equal(sizeText(340 * 1024), n('340~КБ'));
  assert.equal(sizeText(1000 * 1024), n('1~МБ'));
  assert.equal(sizeText(100), n('1~КБ'));
  assert.equal(cleanName('  Банк\tБД\n2026‮xcod.docx​  '), 'Банк БД 2026xcod.docx');
  assert.equal(cleanName('‮‏'), null);
  assert.equal(cleanName(undefined), null);
  assert.equal([...(cleanName('я'.repeat(300)) as string)].length, 255);
  assert.equal(cleanMime(' Text/Plain '), 'text/plain');
  assert.equal(cleanMime('not a type'), null);
  assert.equal(contentType(DOCX), DOCX);
  assert.equal(contentType('text/html'), 'application/octet-stream');
  assert.equal(contentType(null), 'application/octet-stream');
  assert.equal(fallbackName(DOCX), 'Файл.docx');
  assert.equal(fallbackName('image/png'), 'Файл');
  assert.equal(disposition('Банк "БД" 2026.docx'),
    'attachment; filename="____ ____ 2026.docx"; filename*=UTF-8\'\'%D0%91%D0%B0%D0%BD%D0%BA%20%22%D0%91%D0%94%22%202026.docx');
  assert.equal(filePathUrl('documents/file_12.docx'), 'documents/file_12.docx');
  assert.equal(filePathUrl('documents/файл 1.docx'), 'documents/%D1%84%D0%B0%D0%B9%D0%BB%201.docx');
  for (const bad of ['../x', 'documents/../../x', '/etc/x', 'a//b', 'a\\b', 'a?b', '', 7, null]) assert.equal(filePathUrl(bad), null, String(bad));
  assert.deepEqual(toOffer({ status: 'unlinked' }), { status: 'unlinked' });
  assert.throws(() => toOffer({ status: 'ok', ticket: 'nope' }), TypeError);
  assert.deepEqual(toRedeemed({ status: 'gone?' }), { status: 'invalid' });
  assert.deepEqual(toRedeemed({ status: 'ok', file_id: 'a b' }), { status: 'invalid' });
});

test('what came: a document, another file (GIFs too), or nothing for this package', () => {
  assert.equal(arrivalOf(message(document())), 'document');
  assert.equal(arrivalOf(message({ document: { file_id: 'x' }, animation: { file_id: 'x' } })), 'other');
  for (const field of ['photo', 'video', 'audio', 'video_note']) assert.equal(arrivalOf(message({ [field]: [{ file_id: 'x' }] })), 'other', field);
  for (const fields of [{ text: 'привет' }, { voice: { file_id: 'v' } }, { sticker: { file_id: 's' } }, { contact: {} }]) {
    assert.equal(arrivalOf(message(fields)), null, JSON.stringify(fields));
  }
});

// ─────────────────────────────────────────── F1 through the webhook ───────────────────────────────────────────

test('a linked student forwards a document → F1 as a reply, the ticket in the button; only its hash is kept', async () => {
  const h = harness();
  const msg = message(document());
  assert.equal(await webhook(h, msg), 200);
  const calls = sent(h);
  assert.equal(calls.length, 1);
  const p = calls[0];
  const ticket = ticketOf(p);
  assert.equal(p.chat_id, TG);
  assert.deepEqual(p.reply_parameters, { message_id: msg.message_id, allow_sending_without_reply: true });
  assert.equal(p.protect_content, true);
  assert.deepEqual(p.link_preview_options, { is_disabled: true });
  assert.equal(p.disable_notification, true);
  assert.equal(p.parse_mode, 'HTML');
  assert.equal(p.text, f1(W.SITE, { name: NAME, size: 1258291, ticket }).text);
  assert.deepEqual(buttonsOf(p), [[{ text: 'Открыть в Meldy', url: `${W.SITE}/exams/import?tg=${ticket}`, style: 'primary' }]]);
  assert.deepEqual(h.fake.of('bot_file_offer').map((c) => c.args), [{ p_tg_user_id: TG, p_file_id: FILE_ID, p_name: NAME, p_size: 1258291, p_mime: DOCX }]);
  const row = h.store.rowOf(ticket);
  assert.ok(row && row.ticketHash === sha(ticket) && row.userId === USER && row.fileId === FILE_ID && row.tokenHash === null);
  assert.ok(![...h.store.rows.values()].some((r) => JSON.stringify(r).includes(ticket.slice(1))), 'the ticket itself is not stored');
  assert.deepEqual(lastLog(), { route: 'webhook', outcome: 'ok', update_id: nextUpdate - 1, kind: 'message', ms: 0 });
});

test('a document without a name or size: «Файл.docx» from its type, no size in the line', async () => {
  const h = harness();
  assert.equal(await webhook(h, message(document({ file_name: undefined, file_size: undefined }))), 200);
  const p = sent(h)[0];
  assert.equal(p.text, f1(W.SITE, { name: 'Файл.docx', size: null, ticket: ticketOf(p) }).text);
  assert.deepEqual(h.fake.of('bot_file_offer')[0].args, { p_tg_user_id: TG, p_file_id: FILE_ID, p_name: 'Файл.docx', p_size: null, p_mime: DOCX });
});

test('not linked: the refusal with «Открыть профиль Meldy», no ticket', async () => {
  const h = harness();
  const msg = message(document(), OTHER_TG);
  assert.equal(await webhook(h, msg), 200);
  assert.deepEqual(sent(h).map((p) => [p.chat_id, p.text, buttonsOf(p), p.reply_parameters.message_id]),
    [[OTHER_TG, notLinked(W.SITE).text, notLinked(W.SITE).keyboard, msg.message_id]]);
  assert.equal(h.fake.of('bot_file_offer').length, 0);
});

test('over 20 MB: the refusal with «Загрузить на сайте», no ticket; exactly 20 MB gets F1', async () => {
  const h = harness();
  assert.equal(await webhook(h, message(document({ file_size: MAX_BYTES + 1 }))), 200);
  assert.deepEqual(sent(h).map((p) => [p.text, buttonsOf(p)]), [[tooBig(W.SITE).text, tooBig(W.SITE).keyboard]]);
  assert.equal(h.fake.of('bot_file_offer').length, 0);
  assert.equal(await webhook(h, message(document({ file_size: MAX_BYTES }))), 200);
  assert.ok(ticketOf(sent(h)[1]));
  assert.equal(h.fake.of('bot_file_offer')[0].args.p_size, MAX_BYTES);
});

test('the offer\'s own statuses (the link ended meanwhile, the second size check) answer the same refusals', async () => {
  const h = harness();
  h.fake.on('bot_file_offer', () => ({ status: 'unlinked' }));
  assert.equal(await webhook(h, message(document())), 200);
  h.fake.on('bot_file_offer', () => ({ status: 'too_big' }));
  assert.equal(await webhook(h, message(document())), 200);
  assert.deepEqual(sent(h).map((p) => p.text), [notLinked(W.SITE).text, tooBig(W.SITE).text]);
});

test('not a document: a GIF through the webhook, a photo, video, audio or round video → the refusal; unlinked → the router', async () => {
  const h = harness();
  // A GIF arrives with `document` too, so today's router passes it here.
  assert.equal(await webhook(h, message({ ...document({ file_name: 'смешно.mp4', mime_type: 'video/mp4' }), animation: { file_id: 'CgACAgIAAxkBAAIBg' } })), 200);
  assert.deepEqual(sent(h).map((p) => [p.text, p.reply_markup ?? null]), [[notADocument().text, null]]);
  assert.equal(h.fake.of('bot_file_offer').length, 0);
  // The other media reach files.document() once the router passes them on (see the report): answered here.
  const who = await h.fake.db.whoami(TG);
  for (const field of ['photo', 'video', 'audio', 'video_note']) {
    assert.equal(await h.port.document(h.ctx, message({ [field]: [{ file_id: 'AgACAgIAAxkBAAIBh' }] }), who), true, field);
  }
  assert.equal(sent(h).length, 5);
  assert.ok(sent(h).every((p) => p.text === notADocument().text));
  // An unlinked chat's photo is the router's (M1, once an hour); text, voice and stickers too.
  assert.equal(await h.port.document(h.ctx, message({ photo: [{ file_id: 'p' }] }, OTHER_TG), { linked: false }), false);
  for (const fields of [{ text: 'привет' }, { voice: { file_id: 'v' } }, { sticker: { file_id: 's' } }]) {
    assert.equal(await h.port.document(h.ctx, message(fields), who), false, JSON.stringify(fields));
  }
  assert.equal(sent(h).length, 5);
});

test('an album: a refusal is said once, every document gets its own F1', async () => {
  const h = harness();
  const who = await h.fake.db.whoami(TG);
  for (let i = 0; i < 3; i += 1) assert.equal(await h.port.document(h.ctx, message({ photo: [{ file_id: `p${i}` }], media_group_id: '13460817461183592' }), who), true);
  assert.equal(sent(h).length, 1);
  for (let i = 0; i < 3; i += 1) assert.equal(await h.port.document(h.ctx, message({ ...document(), media_group_id: '13460817461183593' }), who), true);
  const tickets = sent(h).slice(1).map(ticketOf);
  assert.equal(new Set(tickets).size, 3);
  for (let i = 0; i < 3; i += 1) {
    assert.equal(await h.port.document(h.ctx, message({ ...document(), media_group_id: '13460817461183594' }, OTHER_TG), { linked: false }), true);
  }
  assert.deepEqual(sent(h).slice(4).map((p) => p.text), [notLinked(W.SITE).text]);
  // The same album an hour later is a new answer (the memory lasts ten minutes).
  h.pass(11 * 60_000);
  assert.equal(await h.port.document(h.ctx, message({ photo: [{ file_id: 'p9' }], media_group_id: '13460817461183592' }), who), true);
  assert.equal(sent(h).length, 6);
});

test('the database fails on the offer → 503 (Telegram retries the update), nothing sent; the retry answers F1', async () => {
  const h = harness();
  h.fake.fail('bot_file_offer', new DbError('bot_file_offer', 0, 'network'));
  const msg = message(document());
  const secret = await derivedSecret(TEST_TOKEN, 'webhook');
  const update = JSON.stringify({ update_id: 99001, message: msg });
  const post = () => h.app(new Request(TEST_FUNCTION_URL, { method: 'POST', headers: { 'x-telegram-bot-api-secret-token': secret }, body: update }));
  assert.equal((await post()).status, 503);
  assert.equal(sent(h).length, 0);
  assert.equal(lastLog().error_name, 'DbError:0');
  h.pass(31_000);
  assert.equal((await post()).status, 200);
  assert.equal(sent(h).length, 1);
  ticketOf(sent(h)[0]);
});

// ─────────────────────────────────────────── GET /telegram/file ───────────────────────────────────────────

test('the site takes the ticket and gets the file: the bytes, the name and type, no cache, CORS for the site', async () => {
  const h = harness();
  const { token } = await offered(h);
  const res = await getFile(h, token);
  assert.equal(res.status, 200);
  const body = new Uint8Array(await res.arrayBuffer());
  assert.equal(body.length, BYTES.length);
  assert.ok(Buffer.from(body).equals(Buffer.from(BYTES)), 'the same bytes');
  const header = (name: string) => res.headers.get(name);
  assert.equal(header('content-type'), DOCX);
  assert.equal(header('content-disposition'), disposition(NAME));
  assert.ok(header('content-disposition')!.includes("filename*=UTF-8''%D0%91%D0%B0%D0%BD%D0%BA_%D0%91%D0%94_2026.docx"));
  assert.equal(header('content-length'), String(BYTES.length));
  assert.equal(header('cache-control'), 'no-store');
  for (const kept of ['etag', 'last-modified', 'expires', 'age', 'pragma']) assert.equal(header(kept), null, kept);
  assert.equal(header('x-content-type-options'), 'nosniff');
  assert.equal(header('content-security-policy'), "default-src 'none'; sandbox");
  assert.equal(header('access-control-allow-origin'), 'https://ludosiel-studyforge.hf.space');
  assert.equal(header('access-control-expose-headers'), 'Content-Disposition, Content-Length');
  assert.equal(header('access-control-allow-credentials'), null);
  assert.equal(header('vary'), 'Origin');
  assert.deepEqual(h.tg.of('getFile').map((c) => c.params), [{ file_id: FILE_ID }]);
  // The token went to Telegram's file server, and only there.
  assert.deepEqual(h.server.downloads, [`https://api.telegram.org/file/bot${TEST_TOKEN}/documents/file_12.docx`]);
  assert.deepEqual(Object.keys(lastLog()).sort(), ['ms', 'outcome', 'route']);
  assert.deepEqual([lastLog().route, lastLog().outcome], ['file', 'ok']);
});

test('the token works once: the second request is refused, and the ticket no longer opens (spec §8.3 step 9)', async () => {
  const h = harness();
  const { ticket, token } = await offered(h);
  assert.equal((await getFile(h, token)).status, 200);
  const again = await getFile(h, token);
  assert.equal(again.status, 410);
  assert.equal(await errorOf(again), 'used');
  assert.equal(again.headers.get('access-control-allow-origin'), W.SITE, 'the site can read why');
  assert.equal(again.headers.get('cache-control'), 'no-store');
  assert.deepEqual(h.store.take(USER, ticket), { status: 'used' });
  assert.equal(h.tg.of('getFile').length, 1);
  assert.equal(h.server.downloads.length, 1);
  assert.deepEqual([lastLog().route, lastLog().outcome], ['file', 'used']);
});

test('expired: the token after its 60 seconds, the ticket after its 30 minutes; a second take replaces the token', async () => {
  const h = harness();
  const first = await offered(h);
  h.pass(61_000);
  const late = await getFile(h, first.token);
  assert.equal(late.status, 410);
  assert.equal(await errorOf(late), 'expired');
  // The ticket is still good: a new take, a new token; the first one is then unknown.
  const fresh = takeToken(h, first.ticket);
  const replaced = takeToken(h, first.ticket);
  assert.equal(await errorOf(await getFile(h, fresh)), 'invalid');
  assert.equal((await getFile(h, replaced)).status, 200);
  const second = await offered(h, { file_id: 'BQACAgIAAxkBAAIBc2Zm_test-file_2', file_name: 'Сети.xlsx', mime_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', file_size: 2048 });
  h.pass(31 * 60_000);
  assert.deepEqual(h.store.take(USER, second.ticket), { status: 'expired' });
  assert.deepEqual(h.store.take('c1c2c3d4-0000-4000-8000-000000000002', second.ticket), { status: 'other_user' });
  assert.equal(h.tg.of('getFile').length, 1);
});

test('CORS: the site\'s preflight; another origin is refused before the token is touched; no origin is served without CORS', async () => {
  const h = harness();
  const { token } = await offered(h);
  const pre = await getFile(h, token, { method: 'OPTIONS' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers.get('access-control-allow-origin'), W.SITE);
  assert.equal(pre.headers.get('access-control-allow-methods'), 'GET, OPTIONS');
  assert.equal(pre.headers.get('access-control-allow-headers'), 'authorization, x-client-info, apikey, content-type, x-region');
  assert.equal(pre.headers.get('access-control-max-age'), '600');
  const preEvil = await getFile(h, token, { method: 'OPTIONS', origin: 'https://evil.example' });
  assert.equal(preEvil.status, 403);
  assert.equal(preEvil.headers.get('access-control-allow-origin'), null);
  for (const origin of ['https://evil.example', 'https://ludosiel-studyforge.hf.space.evil.example', 'http://ludosiel-studyforge.hf.space', 'null']) {
    const res = await getFile(h, token, { origin });
    assert.equal(res.status, 403, origin);
    assert.equal(res.headers.get('access-control-allow-origin'), null, origin);
    assert.equal(await errorOf(res), 'origin');
  }
  assert.equal(h.fake.of('bot_file_redeem').length, 0, 'no foreign origin reached the token');
  const plain = await getFile(h, token, { origin: null });
  assert.equal(plain.status, 200);
  assert.equal(plain.headers.get('access-control-allow-origin'), null);
  assert.equal((await plain.arrayBuffer()).byteLength, BYTES.length);
});

test('bad requests: another method → 405; a malformed token → 400 without a database call', async () => {
  const h = harness();
  const post = await getFile(h, 'a'.repeat(64), { method: 'POST' });
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('allow'), 'GET, OPTIONS');
  for (const token of ['', 'abc', 'A'.repeat(64), `${'a'.repeat(63)}g`, 'a'.repeat(65), `F${'a'.repeat(32)}`]) {
    const res = await getFile(h, token);
    assert.equal(res.status, 400, token);
    assert.equal(await errorOf(res), 'bad_token');
  }
  assert.equal(h.fake.of('bot_file_redeem').length, 0);
  assert.equal(await errorOf(await getFile(h, 'b'.repeat(64))), 'invalid');
});

test('the database fails → 503; Telegram fails → 413 / 502 / 504; the file server fails → 502 / 504', async () => {
  const h = harness({ headersTimeoutMs: 40 });
  // The database.
  let next = await offered(h);
  h.fake.fail('bot_file_redeem', new DbError('bot_file_redeem', 503, ''));
  let res = await getFile(h, next.token);
  assert.deepEqual([res.status, await errorOf(res)], [503, 'unavailable']);
  assert.deepEqual([lastLog().outcome, lastLog().error_name], ['failed', 'DbError']);
  // getFile: too big (no size in the update), down, timing out; the token is spent each time.
  const cases: Array<[Parameters<Harness['tg']['fail']>[1], number, string, string]> = [
    [{ kind: '400', description: 'Bad Request: file is too big' }, 413, 'too_big', 'too_big'],
    [{ kind: '400', description: 'Bad Request: wrong file_id or the file is temporarily unavailable' }, 502, 'telegram', 'failed'],
    [{ kind: 'network' }, 502, 'telegram', 'failed'],
    [{ kind: 'timeout' }, 504, 'timeout', 'timeout'],
  ];
  for (const [failure, status, error, outcome] of cases) {
    next = await offered(h);
    // A 4xx is not retried; a network error or a timeout is, once (getFile is idempotent).
    h.tg.fail('getFile', ...(failure.kind === '400' ? [failure] : [failure, failure]));
    res = await getFile(h, next.token);
    assert.deepEqual([res.status, await errorOf(res)], [status, error], JSON.stringify(failure));
    assert.equal(lastLog().outcome, outcome);
    assert.equal(lastLog().error_name, 'TelegramError');
    assert.equal(await errorOf(await getFile(h, next.token)), 'used', 'a failed fetch still spends the token');
  }
  // No file path in getFile's answer.
  next = await offered(h);
  h.tg.result('getFile', () => ({ file_id: FILE_ID, file_unique_id: 'AgADxyz' }));
  res = await getFile(h, next.token);
  assert.deepEqual([res.status, await errorOf(res)], [502, 'telegram']);
  h.tg.result('getFile', (p) => ({ file_id: p.file_id, file_unique_id: 'AgADxyz', file_path: 'documents/file_12.docx' }));
  // The file server: 404, 500, a network error whose message holds the URL, no headers in time.
  for (const [failure, status, error] of [['404', 502, 'telegram'], ['500', 502, 'telegram'], ['network', 502, 'telegram'], ['hang', 504, 'timeout']] as const) {
    next = await offered(h);
    h.server.fail(failure);
    res = await getFile(h, next.token);
    assert.deepEqual([res.status, await errorOf(res)], [status, error], failure);
    assert.equal(res.headers.get('access-control-allow-origin'), W.SITE);
  }
  assert.equal(h.server.downloads.length, 4);
});

test('the stream breaks halfway or stalls: the client gets a FileStreamError, never the upstream error; one log line', async () => {
  const h = harness({ totalTimeoutMs: 80 });
  for (const [failure, outcome, name] of [['cut', 'failed', 'TypeError'], ['slow_body', 'timeout', 'TimeoutError']] as const) {
    const { token } = await offered(h);
    h.server.fail(failure);
    const res = await getFile(h, token);
    assert.equal(res.status, 200, 'the headers went out before the break');
    const linesBefore = logLines.length;
    // AbortSignal.timeout does not hold Node's event loop (nor Deno's): keep it alive while the stall runs out.
    const alive = setInterval(() => undefined, 20);
    const error = await res.arrayBuffer().then(() => null, (e: unknown) => e).finally(() => clearInterval(alive));
    assert.ok(error, 'reading the body fails');
    const text = `${String(error)} ${(error as Error).message} ${(error as Error).stack ?? ''} ${String((error as { cause?: unknown }).cause ?? '')}`;
    shown.push(text);
    assert.ok(error instanceof FileStreamError || (error as { cause?: unknown }).cause instanceof FileStreamError || /the file stream from Telegram broke/.test(text), text);
    assert.equal(logLines.length, linesBefore + 1, 'the request\'s one line, when the stream ended');
    assert.deepEqual([lastLog().outcome, lastLog().error_name], [outcome, name]);
  }
});

test('anySignal: the native AbortSignal.any, or the same by hand on an older runtime', () => {
  const a = new AbortController();
  const b = new AbortController();
  const both = anySignal([a.signal, b.signal]);
  b.abort(new DOMException('late', 'TimeoutError'));
  assert.ok(both.aborted);
  assert.equal((both.reason as DOMException).name, 'TimeoutError');
  const saved = (AbortSignal as unknown as { any?: unknown }).any;
  try {
    (AbortSignal as unknown as { any?: unknown }).any = undefined;
    const c = new AbortController();
    const d = new AbortController();
    const byHand = anySignal([c.signal, d.signal]);
    assert.ok(!byHand.aborted);
    c.abort(new DOMException('first', 'AbortError'));
    assert.ok(byHand.aborted);
    assert.equal((byHand.reason as DOMException).name, 'AbortError');
    const done = new AbortController();
    done.abort();
    assert.ok(anySignal([done.signal, new AbortController().signal]).aborted);
  } finally {
    (AbortSignal as unknown as { any?: unknown }).any = saved;
  }
});

test('the client leaves mid-file: logged as cancelled, the upstream body is cancelled', async () => {
  const h = harness();
  const { token } = await offered(h);
  const res = await getFile(h, token);
  const reader = res.body!.getReader();
  await reader.read();
  await reader.cancel();
  assert.deepEqual([lastLog().route, lastLog().outcome], ['file', 'cancelled']);
});

test('no bot token: 503 not_configured before anything else; the default port reads it through env.ts (none under Node)', async () => {
  const h = harness({ token: () => '' });
  const { token } = await offered(h);
  const res = await getFile(h, token);
  assert.deepEqual([res.status, await errorOf(res)], [503, 'not_configured']);
  assert.equal(h.fake.of('bot_file_redeem').length, 0, 'the token is not spent');
  const viaDefault = await defaultFiles.http(new Request(`${TEST_FUNCTION_URL}/file?t=${token}`, { headers: { origin: W.SITE } }), h.ctx);
  assert.deepEqual([viaDefault.status, await errorOf(viaDefault)], [503, 'not_configured']);
  // The default port answers documents without the token (the offer needs only the database).
  assert.equal(await defaultFiles.document(h.ctx, message(document()), await h.fake.db.whoami(TG)), true);
  ticketOf(sent(h).at(-1)!);
});

// ─────────────────────────────────────────── secrets and code rules ───────────────────────────────────────────

test('the token, the tickets and the file tokens never appear in a log line, a response or an error', () => {
  assert.ok(logLines.length > 40, `${logLines.length} log lines`);
  assert.ok(secrets.size > 20);
  const forbidden = [TEST_TOKEN, 'TEST_TOKEN_NOT_REAL', 'api.telegram.org', '/file/bot', NAME, FILE_ID, String(TG), String(OTHER_TG), USER, ...secrets];
  for (const line of [...logLines, ...shown]) {
    for (const word of forbidden) assert.ok(!line.includes(word), `«${word}» in: ${line}`);
  }
  for (const line of logLines) {
    const entry = JSON.parse(line) as Record<string, unknown>;
    assert.ok(['webhook', 'file'].includes(String(entry.route)), line);
    assert.deepEqual(Object.keys(entry).filter((k) => !['route', 'outcome', 'update_id', 'kind', 'ms', 'error_name', 'tg_code'].includes(k)), [], line);
  }
});

test('files.ts: no console, no table or REST access but rpc, no database URL, no Deno, every message through send()', () => {
  const source = readFileSync(new URL('./files.ts', import.meta.url), 'utf8');
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
  assert.ok(!/console\./.test(code), 'console');
  assert.ok(!code.includes(['SUPABASE', 'DB', 'URL'].join('_')) && !/postgres(ql)?:\/\//.test(code), 'a database connection string');
  assert.ok(!/rest\/v1|\.from\(/.test(code), 'table access');
  assert.ok(!/Deno\./.test(code), 'Deno');
  assert.ok(!/'sendMessage'|"sendMessage"|editMessage/.test(code), 'messages only through send()');
  assert.ok(!/api\.telegram\.org/.test(code), 'the host comes from tg.ts');
  assert.deepEqual([...code.matchAll(/rpc\('([a-z_]+)'/g)].map((m) => m[1]).sort(), ['bot_file_offer', 'bot_file_redeem']);
});
