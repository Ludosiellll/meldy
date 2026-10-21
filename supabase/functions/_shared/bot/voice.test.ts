// Stage 5, the voice (spec §4.9, §8.1; package T10): V1–V4, the self-check and every refusal through T2's linter and
// snapshots; the whole answer on the fake database (fixtures/voice/fake_voice.ts models the SQL), the fake Space and
// Telegram's file server; nothing voice-related while the switch is off; the test token never in a log line, an error
// or a request to the Space; the ports of the site's grade, summary, payload and sheet sentence pinned to the site.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decode } from './codec.ts';
import { t, visibleText } from './html.ts';
import { lintMessage } from './lint.ts';
import { createApp, makeTap, type Ctx, type TgUpdate } from './router.ts';
import { derivedSecret } from './secrets.ts';
import { createTelegram, type TgMessage } from './tg.ts';
import * as W from './words.ts';
import { LOGS } from './fixtures/harness.ts';
import { fakeDb, type FakeDb } from './fixtures/fake_db.ts';
import { fakeTelegram, TEST_FUNCTION_URL, TEST_TOKEN } from './fixtures/fake_telegram.ts';
import { matchSnapshots, type Shot } from './fixtures/snapshot.ts';
import { CID, NOW, TG, TZ, USER } from './fixtures/scenario.ts';
import { message, press } from './fixtures/updates.ts';
import * as F from './fixtures/voice/fake_voice.ts';
import {
  attemptPayload, bridgeRefusal, changeSentence, createVoice, dbRefusal, decodeVoice, DONT_KNOW_VERDICT, encodeVoice, fragmentNumber,
  fragmentsLabel, gradeAnswer, limitLine, pointSource, refusal, selfCheck, selfDone, splitSourceId, startVoice, summaryLine, toAttempt,
  toAudio, toUnits, V, v1, v2, v3, v4, type Attempt, type ChangeSummary, type Refusal, type VoiceDeps,
} from './voice.ts';
import * as siteGrade from '../../../../frontend/src/lib/oral/oralGrade.ts';
import * as siteSummary from '../../../../frontend/src/lib/oral/answerSummary.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (path: string) => readFileSync(join(ROOT, path), 'utf8');
const plain = (text: string) => text.replace(/\u00a0/g, ' ');
const shown = (html: string) => plain(visibleText(html));
const SECRET = TEST_TOKEN.split(':')[1];
const OPEN = ['asked', 'answering', 'followup', 'ready', 'self'];

/** Everything a student's own content brings into the messages (the linter skips it). */
const USER_TEXT = [
  F.OS_TITLE, F.ANSWER_TEXT,
  ...Object.values(F.QUESTIONS).flatMap((q) => [q.text, ...q.points.flatMap((p) => [p.title, p.followup.question])]),
];

// ─────────────────────────────────────────── the stage on fakes ───────────────────────────────────────────

const DBS: FakeDb[] = [];

function setup(o: Partial<F.VoiceWorldOptions> & { sheetChange?: VoiceDeps['sheetChange'] } = {}) {
  let t = NOW;
  const now = () => t;
  const tg = fakeTelegram({ now });
  const fdb = fakeDb({ now });
  DBS.push(fdb);
  fdb.addLink({ userId: USER, tgUserId: TG });
  const world = F.voiceWorld(fdb, { now, ...o });
  const net = F.fakeVoiceNet(world, TEST_TOKEN);
  tg.result('getFile', (p) => ({ file_id: p.file_id, file_unique_id: `u-${p.file_id}`, file_size: 4096, file_path: `voice/file_${p.file_id}.oga` }));
  const voice = createVoice({ token: TEST_TOKEN, fetch: net.fetch, sheetChange: o.sheetChange });
  const api = createTelegram({ token: TEST_TOKEN, fetch: tg.fetch, sleep: async () => {}, random: () => 0.5 });
  const ctx: Ctx = { tg: api, db: fdb.db, site: F.SPACE, botUsername: W.BOT_USERNAME, now, hourly: () => true };
  const app = createApp({
    token: TEST_TOKEN, fetch: tg.fetch, db: fdb.db, functionUrl: TEST_FUNCTION_URL, waitUntil: () => undefined, now, ports: { voice },
    sleep: async () => {}, random: () => 0.5,
  });
  let nextUpdate = 91000;
  let nextMessage = 6000;

  async function post(update: TgUpdate): Promise<Response> {
    const secret = await derivedSecret(TEST_TOKEN, 'webhook');
    return app(new Request(TEST_FUNCTION_URL, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret }, body: JSON.stringify(update) }));
  }
  /** A voice from the student (through the webhook, the ledger and the router). */
  async function say(seconds: number, extra: Record<string, unknown> = {}, voiceExtra: Record<string, unknown> = {}) {
    const id = nextMessage++;
    const msg = message(undefined, { id, extra: { voice: { file_id: `A${id}`, duration: seconds, file_size: 4096, ...voiceExtra }, ...extra } as Partial<TgMessage> });
    const res = await post({ update_id: nextUpdate++, message: msg });
    return { msg, res, id };
  }
  /** A press (straight to the voice port: the router routes `v|` once its line is added, see the report). */
  async function tap(data: string, messageId: number | null = 777, chatType: 'private' | 'group' = 'private') {
    const update = press(data, { messageId: messageId ?? 777, chatType, chatId: chatType === 'group' ? -100500 : TG });
    const theTap = makeTap(api, update.callback_query!);
    await voice.press(ctx, theTap);
    return theTap;
  }
  async function typed(text: string, replyTo?: number) {
    const msg = message(text, { id: nextMessage++, replyTo: replyTo ? { message_id: replyTo, date: 1, chat: { id: TG, type: 'private' } } : undefined });
    return voice.text(ctx, msg, await fdb.db.whoami(TG));
  }
  const start = (ids: string[] = [F.Q9, F.Q10, F.Q11], examId = F.ORAL_EXAM) =>
    startVoice(ctx, { tgUserId: TG, chatId: TG, containerId: CID, subjectId: F.OS_SUBJECT, examId, subjectTitle: F.OS_TITLE, ids });
  const sent = () => tg.of('sendMessage').map((c) => c.params);
  const open = () => world.attempts.find((a) => OPEN.includes(a.phase)) ?? null;
  const answers = () => tg.of('answerCallbackQuery').map((c) => c.params.text ?? null);
  return {
    tg, fdb, world, net, voice, ctx, post, say, tap, typed, start, sent, open, answers,
    advance(ms: number) { t += ms; },
  };
}

/** The keyboard as rows of [text, data | url] with no-break spaces read as spaces. */
const rows = (markup: { inline_keyboard?: Array<Array<Record<string, string>>> } | null | undefined) =>
  (markup?.inline_keyboard ?? []).map((row) => row.map((b) => [plain(b.text), b.callback_data ?? b.url, b.style ?? ''].filter(Boolean)));

// ─────────────────────────────────────────── callback data ───────────────────────────────────────────

test('v|<aid>|<act>: 12 bytes, every press of the stage, nothing else; T2\'s codec leaves it alone', () => {
  for (const act of ['x', 's', 'c', 'r', 'y', 'k', 'u', 'd', 'n'] as const) {
    const data = encodeVoice('vq000001', act);
    assert.equal(new TextEncoder().encode(data).length, 12);
    assert.deepEqual(decodeVoice(data), { aid: 'vq000001', act });
    assert.equal(decode(data), null, 'the router\'s codec does not claim v|');
  }
  for (const bad of ['v|vq00000|c', 'v|VQ000001|c', 'v|vq000001|z', 'v|vq000001|c|1', 's|vq000001|0|x', '', null, 7]) assert.equal(decodeVoice(bad), null, String(bad));
  assert.throws(() => encodeVoice('../../x', 'c'));
});

// ─────────────────────────────────────────── the switch ───────────────────────────────────────────

test('switch off: a voice gets the router\'s own answer and nothing of the stage is sent, downloaded or charged', async () => {
  const s = setup({ on: false });
  const { res } = await s.say(30);
  assert.equal(res.status, 200);
  assert.deepEqual(s.sent().map((m) => shown(m.text)), [plain(W.BUTTONS_ONLY)], 'S6 «Здесь отвечают кнопками…», as before the stage');
  assert.equal(s.tg.of('getFile').length, 0);
  assert.equal(s.tg.of('sendChatAction').length, 0);
  assert.equal(s.net.space.length + s.net.files.length, 0);
  assert.equal(await s.start(), 'off');
  assert.equal(await s.typed('Взаимоблокировка — это…'), false);
  await s.tap(encodeVoice('vq000001', 'c'));
  await s.tap(encodeVoice('vq000001', 's'));
  await s.tap(encodeVoice('vq000001', 'n'));
  assert.equal(s.sent().length, 1, 'still only S6');
  assert.deepEqual(s.tg.methods().filter((m) => m !== 'sendMessage' && m !== 'answerCallbackQuery'), [], 'no edit, no delete, no file');
  assert.deepEqual(s.answers(), [null, null, null], 'presses only stop the spinner');
  assert.equal(s.world.used, 13, 'no unit charged');
  assert.equal(s.world.attempts.length, 0);
});

test('switch on but no open oral question: a voice and a text are not the stage\'s (S6 / the router)', async () => {
  const s = setup();
  await s.say(30);
  assert.deepEqual(s.sent().map((m) => shown(m.text)), [plain(W.BUTTONS_ONLY)]);
  assert.equal(await s.typed('Взаимоблокировка — это…'), false);
  assert.equal(s.net.space.length, 0);
});

// ─────────────────────────────────────────── the whole answer ───────────────────────────────────────────

test('V1 → V2 → V3 → V4: the spec\'s example, the price on the button, one charge, the site\'s save', async () => {
  const s = setup({ sheetChange: async () => ({ erased: 0, rubbed: 2, checked: 0, returned: 0, stayed: 1 }) });
  assert.equal(await s.start(), 'sent');
  const m1 = s.sent()[0];
  assert.equal(m1.reply_parameters, undefined, 'V1 is a new message');
  assert.equal(shown(m1.text), [
    'Операционные системы · устный вопрос · 1 из 3',
    '',
    'Вопрос 9. Взаимоблокировка: условия возникновения и способы предотвращения.',
    '',
    'Сегодня этот вопрос можно выучить. Ответьте голосовым, как на экзамене.',
    'Проверка стоит 4 единицы ИИ. Сегодня осталось 87.',
  ].join('\n'), 'V1 as in spec §4.9');
  const a = s.open()!;
  assert.deepEqual(rows(m1.reply_markup), [[['Не знаю', `v|${a.aid}|x`]], [['Проверить себя без Meldy', `v|${a.aid}|s`]]], 'V1: no blue');
  const v1Id = a.messages.v1;
  assert.ok(v1Id);

  // The first voice: a ticket, getFile, the bytes, the Space.
  const first = await s.say(60);
  assert.equal(s.tg.of('getFile')[0].params.file_id, `A${first.id}`);
  assert.deepEqual(s.net.files, [`voice/file_A${first.id}.oga`]);
  const req = s.net.space[0];
  assert.equal(req.url, `${F.SPACE}/api/bot/voice`);
  assert.deepEqual(Object.keys(req.headers).sort(), ['accept', 'content-type', 'x-meldy-ticket'], 'the ticket only: no key, no token');
  assert.equal(req.headers['content-type'], 'audio/ogg');
  assert.equal(req.bytes, 4096);
  assert.ok(s.tg.of('sendChatAction').length >= 1, '«печатает…» while the Space works');
  const m2 = s.sent()[1];
  assert.equal(m2.reply_parameters.message_id, first.id, 'V2 answers the voice');
  assert.equal(shown(m2.text), `Ваш ответ · голосом, 1:00\n${F.ANSWER_TEXT}\nМожно добавить ещё голосовое или начать заново.`);
  assert.ok(m2.text.includes('<blockquote expandable>'));
  assert.deepEqual(rows(m2.reply_markup), [[['Проверить за 4 единицы', `v|${a.aid}|c`, 'primary']], [['Сначала', `v|${a.aid}|r`]]], 'the price on the button before the check');
  assert.equal(s.world.used, 13, 'a voice costs no units');

  // A second voice edits V2: «1:42».
  s.net.script.transcribe.push({ status: 'ok', text: 'Ещё процессы держат ресурсы и ждут друг друга по кругу.' });
  await s.say(42);
  assert.equal(s.sent().length, 2, 'no new message');
  const edited = s.tg.of('editMessageText').at(-1)!.params;
  assert.equal(edited.message_id, s.open()!.messages.v2);
  assert.match(shown(edited.text), /^Ваш ответ · голосом, 1:42\n/);
  assert.match(shown(edited.text), /по кругу\.\nМожно добавить/);

  // «Проверить»: the spinner stops first, one check, V2 loses its keyboard, V3 answers the last voice.
  const before = s.tg.calls.length;
  const press1 = await s.tap(encodeVoice(a.aid, 'c'), s.open()!.messages.v2);
  assert.equal(press1.answered, true);
  assert.equal(s.tg.calls.slice(before).find((c) => c.method !== 'sendChatAction')?.method, 'answerCallbackQuery');
  const check = s.net.space.at(-1)!;
  assert.equal(check.bytes, 0, 'the check carries no audio');
  assert.equal(check.headers['content-type'], undefined);
  assert.equal(s.world.used, 17, '4 units, at the check');
  const m3 = s.sent()[2];
  assert.equal(shown(m3.text), 'Экзаменатор: Какие условия должны выполняться одновременно, чтобы возникла взаимоблокировка?');
  assert.ok(m3.text.startsWith('<b>Экзаменатор:</b> '));
  assert.equal(m3.reply_parameters.message_id, s.open()!.messages.voice);
  assert.deepEqual(rows(m3.reply_markup), [[['Не знаю', `v|${a.aid}|y`]]]);
  assert.ok(s.tg.of('editMessageReplyMarkup').some((c) => c.params.message_id === s.open()!.messages.v2 && c.params.reply_markup.inline_keyboard.length === 0));

  // The answer to the examiner's question: a voice; then the save and V4.
  const reply = await s.say(9);
  assert.equal(s.net.space.at(-1)!.status, 'ok');
  const record = s.world.records[0];
  assert.equal(record.how, 'checked');
  const site = siteGrade.gradeAnswer(
    [{ id: 'p1', essential: true, status: 'covered' }, { id: 'p2', essential: true, status: 'covered' }, { id: 'p3', essential: true, status: 'partial' }, { id: 'p4', essential: false, status: 'missing' }],
    { point_id: 'p3', status: 'covered', judgedBy: 'check' },
  );
  assert.equal(record.attempt.score, site.score);
  assert.equal(record.attempt.grade, site.grade);
  assert.deepEqual([record.attempt.score, record.attempt.grade], [71, 4]);
  assert.deepEqual(record.attempt.followup, {
    point_id: 'p3', question: 'Какие условия должны выполняться одновременно, чтобы возникла взаимоблокировка?',
    expected: 'Взаимное исключение, удержание и ожидание, отсутствие вытеснения и круговое ожидание.', status: 'covered',
    student_quote: 'Нужно, чтобы все четыре условия выполнялись одновременно.', chosen_by: 'check',
  });
  assert.equal(record.attempt.duration_seconds, 102);
  assert.equal(record.attempt.material_id, F.MAT1);
  for (const key of ['attempt_id', 'exam_question_id', 'rubric_id', 'local_date', 'input', 'make_card']) assert.ok(!(key in record.attempt), `${key} is the server's`);
  const m4 = s.sent()[3];
  assert.equal(m4.reply_parameters, undefined, 'V4 is a new message');
  assert.equal(shown(m4.text), [
    'Сами назвали 2 из 3 главных пунктов, ещё 1 — после вопроса экзаменатора.',
    'После ответа: 2 строки стёрлись наполовину, 1 не стёрлась.',
    'Списано 4 единицы, осталось 83.',
  ].join('\n'), 'V4 as in spec §4.9');
  const done = s.world.attemptOf(a.aid)!;
  assert.deepEqual(rows(m4.reply_markup), [
    [['Следующий: 2 из 3', `v|${a.aid}|n`, 'primary']],
    [['Протокол', `${F.SPACE}/exams/${F.ORAL_EXAM}/ticket?session=${done.sessionId}`]],
  ]);
  const markups = s.tg.of('editMessageReplyMarkup').map((c) => [c.params.message_id, c.params.reply_markup.inline_keyboard.length]);
  assert.ok(markups.some(([id, n]) => id === v1Id && n === 0), 'V1 loses its keyboard');
  assert.ok(markups.some(([id, n]) => id === done.messages.v3 && n === 0), 'V3 loses its keyboard');
  assert.equal(reply.res.status, 200);
  assert.equal(s.world.used, 17, 'charged once');

  // «Следующий: 2 из 3»: «Протокол» stays on V4, the next V1 is a new message.
  const v4Id = done.messages.v4!;
  await s.tap(encodeVoice(a.aid, 'n'), v4Id);
  const kept = s.tg.of('editMessageReplyMarkup').at(-1)!.params;
  assert.equal(kept.message_id, v4Id);
  assert.deepEqual(rows(kept.reply_markup), [[['Протокол', `${F.SPACE}/exams/${F.ORAL_EXAM}/ticket?session=${done.sessionId}`]]]);
  assert.match(shown(s.sent()[4].text), /^Операционные системы · устный вопрос · 2 из 3\n\nВопрос 10\. Планирование процессов/);
  assert.match(shown(s.sent()[4].text), /Сегодня осталось 83\.$/);
  // Pressed twice: the same question, nothing new.
  await s.tap(encodeVoice(a.aid, 'n'), v4Id);
  assert.equal(s.sent().length, 5);
});

test('a check without a follow-up question records at once; the answer to a question is a voice only', async () => {
  const s = setup();
  await s.start([F.Q9]);
  const a = s.open()!;
  await s.say(40);
  s.net.script.check.push({ ...F.CHECK_RESULT, ask: null });
  await s.tap(encodeVoice(a.aid, 'c'), a.messages.v2);
  const m = s.sent().at(-1)!;
  assert.equal(shown(m.text), 'Сами назвали 2 из 3 главных пунктов.\nСписано 4 единицы, осталось 83.');
  assert.deepEqual(rows(m.reply_markup).map((r) => r[0][0]), ['Протокол'], 'the last question: no «Следующий»');
  assert.equal(s.world.records[0].attempt.followup, null);
});

test('«Не знаю» under V1: the site\'s «не знаю» answer — every point missing, no units, V4 without «Списано»', async () => {
  const s = setup();
  await s.start();
  const a = s.open()!;
  await s.tap(encodeVoice(a.aid, 'x'), a.messages.v1);
  const record = s.world.records[0];
  assert.equal(record.how, 'dont_know');
  assert.equal(record.attempt.verdict, DONT_KNOW_VERDICT);
  assert.deepEqual((record.attempt.points as Array<{ status: string }>).map((p) => p.status), ['missing', 'missing', 'missing', 'missing']);
  assert.deepEqual([record.attempt.score, record.attempt.grade], [0, 2]);
  assert.equal(s.world.used, 13);
  assert.equal(shown(s.sent().at(-1)!.text), 'Сами назвали 0 из 3 главных пунктов.');
  assert.equal(s.net.space.length, 0, 'no model for «не знаю»');
});

test('«Не знаю» under V3: the follow-up is missing with a trustworthy verdict (the cap applies, as on the site)', async () => {
  const s = setup();
  await s.start();
  const a = s.open()!;
  await s.say(40);
  // p3 (main) missed and asked about, p4 named: 71 would be a 4; the unrecovered main point caps it at 3.
  const statuses: Record<string, string> = { p1: 'covered', p2: 'covered', p3: 'missing', p4: 'covered' };
  s.net.script.check.push({ ...F.CHECK_RESULT, statuses, protocol: { ...F.CHECK_RESULT.protocol, points: F.CHECK_RESULT.protocol.points.map((p) => ({ ...p, status: statuses[p.id] })) } });
  await s.tap(encodeVoice(a.aid, 'c'), s.open()!.messages.v2);
  await s.tap(encodeVoice(a.aid, 'y'), s.open()!.messages.v3);
  const record = s.world.records[0].attempt;
  const site = siteGrade.gradeAnswer(
    [{ id: 'p1', essential: true, status: 'covered' }, { id: 'p2', essential: true, status: 'covered' }, { id: 'p3', essential: true, status: 'missing' }, { id: 'p4', essential: false, status: 'covered' }],
    { point_id: 'p3', status: 'missing', judgedBy: null },
  );
  assert.deepEqual([record.score, record.grade], [site.score, site.grade]);
  assert.deepEqual([record.score, record.grade], [71, 3]);
  assert.equal(site.cap, 'essential_unrecovered');
  assert.deepEqual((record.followup as Record<string, unknown>).status, 'missing');
  assert.equal(shown(s.sent().at(-1)!.text), 'Сами назвали 2 из 3 главных пунктов.\nСписано 4 единицы, осталось 83.');
  assert.equal(s.net.space.filter((r) => r.status === 'ok').length, 2, 'one recognition, one check: the «Не знаю» button needs no model');
});

test('«Сначала»: V2 goes, the text goes, the next voice starts a new V2', async () => {
  const s = setup();
  await s.start();
  const a = s.open()!;
  await s.say(30);
  const v2Id = s.open()!.messages.v2;
  await s.tap(encodeVoice(a.aid, 'r'), v2Id);
  assert.deepEqual(s.tg.of('deleteMessage').map((c) => c.params.message_id), [v2Id]);
  assert.equal(s.open()!.phase, 'asked');
  assert.equal(s.open()!.parts.length, 0);
  await s.say(31);
  assert.equal(s.sent().length, 3, 'V1, V2, the new V2');
  assert.match(shown(s.sent()[2].text), /^Ваш ответ · голосом, 0:31\n/);
});

test('the self-check: the points in an expandable quote, sheet_peek once, the mark folds the message; nothing charged', async () => {
  const s = setup();
  await s.start();
  const a = s.open()!;
  await s.say(30);
  const v2Id = s.open()!.messages.v2;
  await s.tap(encodeVoice(a.aid, 's'), a.messages.v1);
  assert.deepEqual(s.tg.of('deleteMessage').map((c) => c.params.message_id), [v2Id], 'V2 and its text go');
  const opened = s.tg.of('editMessageText').at(-1)!.params;
  assert.equal(opened.message_id, a.messages.v1, 'V1 becomes the self-check');
  assert.equal(shown(opened.text), [
    'Операционные системы · устный вопрос · 1 из 3',
    '',
    'Вопрос 9. Взаимоблокировка: условия возникновения и способы предотвращения.',
    '',
    'Пункты из ваших лекций:',
    '1. Взаимное исключение: ресурс занят одним процессом',
    '2. Удержание и ожидание: процесс держит ресурс и ждёт другой',
    '3. Круговое ожидание: цепочка процессов ждёт друг друга',
    '4. Предотвращение: нарушить одно из условий',
    'Как вы ответили?',
  ].join('\n'));
  assert.ok(opened.text.includes('<blockquote expandable>1. '));
  assert.deepEqual(rows(opened.reply_markup), [[['Знаю', `v|${a.aid}|k`], ['Плаваю', `v|${a.aid}|u`], ['Не знаю', `v|${a.aid}|d`]]]);
  assert.equal(s.world.peeks.length, 4, 'a sheet_peek of every point, as «Показать пункты»');
  await s.tap(encodeVoice(a.aid, 's'), a.messages.v1);
  assert.equal(s.world.peeks.length, 4, 'pressed twice: once');
  await s.tap(encodeVoice(a.aid, 'u'), a.messages.v1);
  const folded = s.tg.of('editMessageText').at(-1)!.params;
  assert.equal(folded.message_id, a.messages.v1);
  assert.equal(shown(folded.text), 'Операционные системы · устный вопрос · 1 из 3\n\nОтмечено: плаваю. Отметка решает, когда повторим вопрос. Выученным он от неё не станет.');
  assert.ok(!folded.text.includes('Взаимное исключение'), 'the points do not stay in the history');
  assert.deepEqual(rows(folded.reply_markup), [[['Следующий: 2 из 3', `v|${a.aid}|n`, 'primary']]]);
  assert.deepEqual(s.world.ratings, [{ aid: a.aid, rating: 'unsure' }]);
  assert.equal(s.world.used, 13);
  assert.equal(s.world.records.length, 0, 'a self-check is not an answer');
});

test('startVoice: a question without points is skipped; an empty session, another\'s exam, T11 missing send nothing', async () => {
  const s = setup();
  assert.equal(await s.start([F.Q12, F.Q9]), 'sent');
  assert.match(shown(s.sent()[0].text), /· 2 из 2\n\nВопрос 9\./);
  assert.equal(await s.start([F.Q12]), 'empty');
  assert.equal(await s.start([F.Q9], 'f0f0c3d4-0000-4000-8000-000000000399'), 'gone');
  s.world.notReady = true;
  assert.equal(await s.start([F.Q9]), 'not_ready');
  assert.equal(s.sent().length, 1);
});

// ─────────────────────────────────────────── refusals: never a unit ───────────────────────────────────────────

test('a typed text while the question waits: the refusal with «Ответить на сайте»; an old unrelated text is not the stage\'s', async () => {
  const s = setup();
  await s.start();
  const a = s.open()!;
  assert.equal(await s.typed('Взаимоблокировка — это когда процессы ждут друг друга.'), true);
  const m = s.sent().at(-1)!;
  assert.equal(shown(m.text), V.TEXT_REFUSAL);
  assert.deepEqual(rows(m.reply_markup), [[['Ответить на сайте', `${F.SPACE}/exams/${F.ORAL_EXAM}/ticket?q=${F.Q9}&from=c:${CID}`]]]);
  s.advance(31 * 60_000);
  assert.equal(await s.typed('Привет'), false, 'half an hour later and not a reply');
  assert.equal(await s.typed('Ответ', a.messages.v1!), true, 'a reply to V1 is still meant as the answer');
  assert.equal(s.world.used, 13);
  assert.equal(s.net.space.length, 0);
});

test('refusals before the Space: forwarded, shorter than 5 s, over 20 MB, the AI limit, the ceiling, the stop', async () => {
  const cases: Array<{ name: string; o?: Partial<F.VoiceWorldOptions>; seconds?: number; extra?: Record<string, unknown>; size?: number; text: string; site: boolean }> = [
    { name: 'forwarded', extra: { forward_origin: { type: 'user', date: 1 }, forward_date: 1 }, text: V.FORWARDED, site: false },
    { name: 'shorter than 5 s', seconds: 3, text: V.TOO_SHORT, site: false },
    { name: 'over 20 MB', size: 21 * 1024 * 1024, text: V.TOO_BIG, site: false },
    { name: 'the AI limit', o: { used: 97 }, text: 'Проверки ИИ на сегодня закончились. Снова можно завтра в 3:00. Проверить себя без Meldy можно сейчас.', site: false },
    { name: 'the ceiling', o: { audioUsed: 1795 }, text: 'Голосовые на сегодня закончились, в день можно 30 минут записи. Ответить можно на сайте или завтра здесь.', site: true },
    { name: 'the shared stop', o: { audioAll: 20155 }, text: V.STOP, site: true },
  ];
  for (const c of cases) {
    const s = setup(c.o);
    await s.start();
    const { id } = await s.say(c.seconds ?? 20, c.extra ?? {}, c.size ? { file_size: c.size } : {});
    const m = s.sent().at(-1)!;
    assert.equal(shown(m.text), c.text, c.name);
    assert.equal(m.reply_parameters.message_id, id, `${c.name}: an answer to the voice`);
    assert.equal(rows(m.reply_markup).length, c.site ? 1 : 0, `${c.name}: «Ответить на сайте»`);
    assert.equal(s.tg.of('getFile').length, 0, `${c.name}: not downloaded`);
    assert.equal(s.net.space.length, 0, `${c.name}: the Space not called`);
    assert.equal(s.world.used, c.o?.used ?? 13, `${c.name}: no unit`);
    assert.equal(s.open()!.parts.length, 0);
  }
});

test('refusals from the Space: too short in words, not recognised, a failure, unreachable, too large; nothing charged', async () => {
  const cases: Array<{ name: string; answer?: Record<string, unknown>; down?: boolean; fileSize?: number; text: string }> = [
    { name: 'under 8 words', answer: { status: 'too_short', words: 3 }, text: V.TOO_SHORT },
    { name: 'no speech', answer: { status: 'not_recognized' }, text: V.NOT_RECOGNIZED },
    { name: 'recognition busy', answer: { status: 'busy' }, text: V.FAILED },
    { name: 'recognition failed', answer: { status: 'failed' }, text: V.FAILED },
    { name: 'the Space down', down: true, text: V.FAILED },
    { name: 'getFile says too big', fileSize: 25 * 1024 * 1024, text: V.TOO_BIG },
  ];
  for (const c of cases) {
    const s = setup();
    await s.start();
    if (c.answer) s.net.script.transcribe.push(c.answer);
    if (c.down) s.net.script.down = 1;
    if (c.fileSize) s.tg.result('getFile', (p) => ({ file_id: p.file_id, file_unique_id: 'u', file_size: c.fileSize, file_path: 'voice/file_big.oga' }));
    await s.say(20);
    assert.equal(shown(s.sent().at(-1)!.text), c.text, c.name);
    assert.equal(s.world.used, 13, `${c.name}: no unit`);
    assert.equal(s.open()!.parts.length, 0, `${c.name}: no text kept`);
    assert.equal(s.open()!.phase, 'asked');
  }
});

test('the AI limit at «Проверить», a failed check (units back), the Space unreachable (units back), then a check that works', async () => {
  const s = setup({ used: 94 });
  await s.start();
  const a = s.open()!;
  await s.say(30);
  s.world.used = 97;
  await s.tap(encodeVoice(a.aid, 'c'), s.open()!.messages.v2);
  let m = s.sent().at(-1)!;
  assert.match(shown(m.text), /^Проверки ИИ на сегодня закончились. Снова можно завтра в 3:00\./);
  assert.equal(m.reply_parameters.message_id, s.open()!.messages.v2);
  assert.equal(s.net.space.length, 1, 'only the recognition');
  s.world.used = 50;
  s.net.script.check.push({ status: 'failed' });
  await s.tap(encodeVoice(a.aid, 'c'), s.open()!.messages.v2);
  m = s.sent().at(-1)!;
  assert.equal(shown(m.text), plain(W.DB_DOWN_TAP));
  assert.equal(s.world.used, 50, 'the Space gave the units back');
  assert.equal(s.open()!.phase, 'answering');
  assert.equal(s.open()!.busyUntil, null, 'released');
  s.net.script.down = 1;
  await s.tap(encodeVoice(a.aid, 'c'), s.open()!.messages.v2);
  assert.equal(s.world.used, 50, 'bot_voice_release gave the units back');
  assert.equal(s.world.charges.filter((c) => !c.refunded).length, 0);
  await s.tap(encodeVoice(a.aid, 'c'), s.open()!.messages.v2);
  assert.equal(s.world.used, 54, 'one charge for the check that worked');
  assert.equal(s.open()!.phase, 'followup');
});

test('a part over 4000 characters: the site\'s «Ответ слишком длинный»; the voice is not added', async () => {
  const s = setup();
  await s.start();
  s.net.script.transcribe.push({ status: 'ok', text: 'а'.repeat(3990) });
  await s.say(300);
  s.net.script.transcribe.push({ status: 'ok', text: 'б'.repeat(50) });
  await s.say(10);
  assert.equal(shown(s.sent().at(-1)!.text), V.TOO_LONG);
  assert.equal(s.open()!.parts.length, 1);
});

test('the same voice delivered twice, a voice during a check, a double «Проверить»: one recognition, one check', async () => {
  const s = setup();
  await s.start();
  const a = s.open()!;
  const first = await s.say(30);
  // Telegram delivers the same message again under a new update id.
  const again = await s.post({ update_id: 99001, message: first.msg });
  assert.equal(again.status, 200);
  assert.equal(s.net.space.length, 1, 'recognised once');
  assert.equal(s.sent().length, 2, 'V1 and one V2');
  // A check in flight: a voice and a second press wait.
  s.world.attemptOf(a.aid)!.busyUntil = NOW + 150_000;
  await s.say(15);
  await s.tap(encodeVoice(a.aid, 'c'), s.open()!.messages.v2);
  assert.equal(s.net.space.length, 1);
  assert.equal(s.sent().length, 2);
  assert.equal(s.world.used, 13);
});

test('presses: a group chat, a forged aid, another student\'s question, an old button', async () => {
  const s = setup();
  await s.start();
  const a = s.open()!;
  const before = s.fdb.calls.length;
  await s.tap(encodeVoice(a.aid, 'c'), 1, 'group');
  assert.equal(s.fdb.calls.length, before, 'a group press reads nothing');
  await s.tap('v|zzzzzzzz|c');
  await s.tap('v|zzzzzzzz|r');
  await s.tap('v|zzzzzzzz|n');
  await s.tap('v|zzzzzzzz|k');
  assert.deepEqual(s.answers().slice(-4).map((x) => x && plain(x)), [W.OLD_BUTTON, W.OLD_BUTTON, W.OLD_BUTTON, W.OLD_BUTTON]);
  assert.equal(s.sent().length, 1);
  for (const toast of s.answers().filter((x): x is string => typeof x === 'string')) assert.deepEqual(lintMessage({ text: 'x', toasts: [toast] }), []);
});

// ─────────────────────────────────────────── the token and the logs ───────────────────────────────────────────

test('the token never reaches a log line, an error, the Space or a message; the logs carry no text, ticket or id', async () => {
  const start = LOGS.length;
  const s = setup();
  await s.start();
  const a = s.open()!;
  // The download fails with an error whose message holds the file URL (and so the token).
  s.net.fileFailures.push(`voice/file_A6000.oga`);
  await s.say(30);
  // The Space fails, then works; the check fails; Telegram fails once.
  s.net.script.down = 1;
  await s.say(31);
  await s.say(32);
  s.net.script.check.push({ status: 'failed' });
  await s.tap(encodeVoice(a.aid, 'c'), s.open()!.messages.v2);
  s.tg.fail('sendMessage', { kind: 'network' });
  await s.tap(encodeVoice(a.aid, 'c'), s.open()!.messages.v2);
  const logs = LOGS.slice(start);
  assert.ok(logs.some((line) => line.includes('download_failed') && line.includes('TypeError')), 'the download failure by name');
  assert.ok(logs.some((line) => line.includes('transcribe_unreachable')));
  const tickets = [...s.world.tickets.keys()];
  const texts = [F.ANSWER_TEXT, F.QUESTIONS[F.Q9].text, F.OS_TITLE, String(TG), USER, a.aid];
  for (const line of logs) {
    assert.ok(!line.includes(SECRET) && !line.includes('api.telegram.org'), line);
    for (const ticket of tickets) assert.ok(!line.includes(ticket), 'no ticket in a log line');
    for (const text of texts) assert.ok(!line.includes(text), `no text or id in a log line: ${line}`);
  }
  for (const req of s.net.space) {
    assert.ok(!JSON.stringify(req).includes(SECRET), 'the Space never sees the token');
    assert.ok(!('authorization' in req.headers) && !('apikey' in req.headers));
  }
  for (const call of s.tg.calls) if (call.method !== 'getFile') assert.ok(!JSON.stringify(call.params).includes(SECRET));
  assert.deepEqual(s.net.files.map((f) => f.startsWith('voice/')), s.net.files.map(() => true), 'only file paths after the token');
});

// ─────────────────────────────────────────── snapshots and the linter ───────────────────────────────────────────

const Q9 = F.QUESTIONS[F.Q9];
function attempt(over: Record<string, unknown> = {}): Attempt {
  return toAttempt({
    aid: 'vq000001', phase: 'asked', container_id: CID, subject_id: F.OS_SUBJECT, subject_title: F.OS_TITLE, exam_id: F.ORAL_EXAM, question_id: F.Q9,
    question: { text: Q9.text, label: Q9.label, position: 9, hash: Q9.hash }, n: 1, of: 3, has_next: true, rubric_id: Q9.rubricId,
    evidence_material_id: F.MAT1, points: Q9.points, materials: F.MATERIALS, parts: [{ text: F.ANSWER_TEXT, seconds: 102, message_id: 6000 }],
    seconds: 102, checked: null, followup: { point_id: 'p3', question: Q9.points[2].followup.question, expected: Q9.points[2].followup.expected },
    charged: 0, session_id: null, messages: { v1: 1000 }, busy: false, local_day: '2026-10-16', updated_at: new Date(NOW).toISOString(), ...over,
  })!;
}

test('snapshots of V1–V4, the self-check and every refusal; each passes T2\'s linter', () => {
  const a = attempt();
  const units = toUnits({ left: 87, price: 4, resets_at: '2026-10-17T00:00:00Z' });
  const audio = toAudio({ left_s: 1800, day_s: 1800, stop: false });
  const o = { site: F.SPACE, units, audio, now: NOW, tz: TZ };
  const sessionId = 'f4f4c3d4-0000-4000-8000-000000000001';
  const result = { summary: 'Сами назвали 2 из 3 главных пунктов, ещё 1 — после вопроса экзаменатора', changes: { erased: 0, rubbed: 2, checked: 0, returned: 0, stayed: 1 }, charged: 4, unitsLeft: 83, sessionId };
  const shots: Record<string, Shot> = {
    v1: v1(a, units, audio, NOW, TZ) as Shot,
    v1_limit: v1(a, toUnits({ left: 3, price: 4, resets_at: '2026-10-17T00:00:00Z' }), audio, NOW, TZ) as Shot,
    v1_stop: v1(a, units, toAudio({ left_s: 1800, day_s: 1800, stop: true }), NOW, TZ) as Shot,
    v1_ceiling: v1(a, units, toAudio({ left_s: 4, day_s: 1800, stop: false }), NOW, TZ) as Shot,
    v2: v2(a, 4) as Shot,
    v3: v3(attempt({ phase: 'followup' })) as Shot,
    v4: v4(a, result, F.SPACE) as Shot,
    v4_last_no_sheet: v4(attempt({ has_next: false, n: 3 }), { ...result, changes: null, summary: 'Сами назвали 3 из 3 главных пунктов. Ошибка в 1 пункте' }, F.SPACE) as Shot,
    v4_dont_know: v4(a, { summary: 'Сами назвали 0 из 3 главных пунктов', changes: null, charged: 0, unitsLeft: 87, sessionId }, F.SPACE) as Shot,
    self_check: selfCheck(a) as Shot,
    self_done: selfDone(a, 'unsure') as Shot,
    self_done_last: selfDone(attempt({ has_next: false, n: 3 }), 'know') as Shot,
  };
  const kinds: Refusal[] = ['text', 'too_short', 'not_recognized', 'too_long', 'limit', 'ceiling', 'stop', 'failed', 'forwarded', 'too_big'];
  for (const kind of kinds) shots[`refusal_${kind}`] = refusal(kind, a, o) as Shot;
  shots.refusal_limit_tonight = refusal('limit', a, { ...o, now: Date.UTC(2026, 9, 16, 22, 30), units: toUnits({ left: 0, price: 4, resets_at: '2026-10-17T00:00:00Z' }) }) as Shot;
  shots.check_failed = { text: t(W.DB_DOWN_TAP), keyboard: null };
  for (const [name, shot] of Object.entries(shots)) {
    assert.deepEqual(lintMessage({ text: shot.text, keyboard: shot.keyboard, chat: 'private', user: USER_TEXT, toasts: shot.toasts }), [], name);
  }
  // Spec §4.9's words where it gives them.
  assert.equal(shown(shots.refusal_text.text), 'Здесь считаем только голосовые ответы. Бот не отличит набранный текст от вставленного. Текстом можно ответить на сайте.');
  assert.equal(shown(shots.refusal_too_short.text), 'Голосовое слишком короткое. Запишите ответ ещё раз.');
  assert.equal(shown(shots.refusal_not_recognized.text), 'Не получилось разобрать речь. Запишите ещё раз ближе к телефону и без музыки рядом.');
  assert.equal(shown(shots.refusal_limit.text), 'Проверки ИИ на сегодня закончились. Снова можно завтра в 3:00. Проверить себя без Meldy можно сейчас.');
  assert.equal(shown(shots.refusal_limit_tonight.text), 'Проверки ИИ на сегодня закончились. Снова можно сегодня в 3:00. Проверить себя без Meldy можно сейчас.', 'after midnight in Minsk the reset is «сегодня»');
  assert.equal(shown(shots.self_done.text).split('\n').at(-1), 'Отмечено: плаваю. Отметка решает, когда повторим вопрос. Выученным он от неё не станет.');
  assert.equal(shown(shots.v2.text).split('\n')[0], 'Ваш ответ · голосом, 1:42');
  assert.equal(shown(shots.v4.text), 'Сами назвали 2 из 3 главных пунктов, ещё 1 — после вопроса экзаменатора.\nПосле ответа: 2 строки стёрлись наполовину, 1 не стёрлась.\nСписано 4 единицы, осталось 83.');
  for (const name of ['v1', 'v1_limit', 'v1_stop', 'v1_ceiling', 'v3', 'self_check']) {
    assert.ok(!(shots[name].keyboard ?? []).flat().some((b) => b.style === 'primary'), `${name}: no blue`);
  }
  matchSnapshots('voice', shots);
});

test('the transcript in V2 is cut at 3500 characters; a long rubric still fits Telegram\'s 4096', () => {
  const long = attempt({ parts: [{ text: 'слово '.repeat(1300), seconds: 600 }], seconds: 600 });
  const out = v2(long, 4);
  assert.ok(visibleText(out.text).length <= 4096);
  assert.ok(visibleText(out.text).includes('…'));
  const many = attempt({ points: Array.from({ length: 6 }, (_, i) => ({ ...Q9.points[0], id: `p${i + 1}`, title: 'Пункт '.repeat(20) })) });
  assert.ok(visibleText(selfCheck(many).text).length <= 4096);
});

// ─────────────────────────────────────────── the site's logic ───────────────────────────────────────────

test('gradeAnswer and summaryLine equal the site\'s oralGrade.ts and answerSummary.ts on every combination', () => {
  const statuses = ['covered', 'partial', 'missing', 'wrong', 'unrated', 'bogus'];
  const shapes = [[true, true, true, false], [false, false], [true], [true, false, true]];
  let n = 0;
  for (const shape of shapes) {
    const combos = statuses.length ** shape.length;
    for (let k = 0; k < combos; k += 1) {
      let c = k;
      const points = shape.map((essential, i) => {
        const status = statuses[c % statuses.length];
        c = Math.floor(c / statuses.length);
        return { id: `p${i + 1}`, essential, status };
      });
      const followups = [null, ...['covered', 'partial', 'missing', 'wrong'].flatMap((status) =>
        (['check', 'keywords', null] as const).map((judgedBy) => ({ point_id: `p${(k % shape.length) + 1}`, status, judgedBy })))];
      for (const followup of followups) {
        const mine = gradeAnswer(points, followup);
        const site = siteGrade.gradeAnswer(points as never, followup as never);
        assert.deepEqual([mine.score, mine.grade, mine.credits], [site.score, site.grade, site.credits], JSON.stringify({ points, followup }));
        assert.equal(summaryLine(points, followup), siteSummary.summaryLine(siteSummary.answerSummary(points, followup)), JSON.stringify({ points, followup }));
        n += 1;
      }
    }
  }
  assert.ok(n > 10000, `${n} cases`);
});

test('the save payload follows oralPersistence.ts buildAttemptPayload (the site\'s test vectors, this exam\'s rubric)', () => {
  assert.deepEqual(splitSourceId('M1:S07'), { key: 'M1', id: 'S07' });
  assert.deepEqual(splitSourceId('S07'), { key: null, id: 'S07' });
  assert.deepEqual(splitSourceId('x'), { key: null, id: '' });
  assert.equal(fragmentNumber('S07'), 7);
  assert.equal(fragmentsLabel(['S07']), 'фрагмент 7');
  assert.equal(fragmentsLabel(['M1:S12', 'M1:S13']), 'фрагменты 12, 13');
  assert.equal(fragmentsLabel([]), '');
  assert.deepEqual(pointSource({ source_ids: ['S03'] }, F.MATERIALS), { materialId: F.MAT1, sourceIds: ['S03'], label: '«Лекция 4. Взаимоблокировки», фрагмент 3' });
  assert.deepEqual(pointSource({ source_ids: ['M2:S11'] }, F.MATERIALS).label, '«Лекция 5. Управление ресурсами», фрагмент 11');
  assert.deepEqual(pointSource({ source_ids: [] }, []), { materialId: null, sourceIds: [], label: 'Лекция' });
  // The site's own shape test, on this exam: covered, partial, missing (asked, still missing), covered → 57, grade 3.
  const a = attempt({ points: Q9.points.map((p, i) => ({ ...p, essential: i < 3 })) });
  const protocol = {
    points: [
      { id: 'p1', status: 'covered', student_quote: '  ресурс занят одним процессом ', comment: 'Сказано.' },
      { id: 'p2', status: 'partial', student_quote: 'держит ресурс', comment: 'Без ожидания.' },
      { id: 'p3', status: 'missing', student_quote: '', comment: '' },
      { id: 'p4', status: 'covered', student_quote: 'нарушить условие', comment: '' },
    ],
    errors: [{ point_id: 'p2', student_quote: 'отпускает ресурс', correction: 'Процесс удерживает ресурс, пока ждёт.' }],
    verdict: 'Повторите круговое ожидание.',
  };
  const followup = { point_id: 'p3', question: 'Что такое круговое ожидание?', expected: 'Цепочка ожиданий.', status: 'missing', student_quote: 'не знаю', judged_by: 'check' as const };
  const body = attemptPayload(a, protocol, followup)!;
  assert.equal(body.score, 57);
  assert.equal(body.grade, 3);
  assert.equal(body.material_id, F.MAT1);
  assert.equal(body.duration_seconds, 102);
  assert.equal(body.confidence, null);
  assert.equal(body.verdict, 'Повторите круговое ожидание.');
  assert.deepEqual(body.points[0], {
    id: 'p1', title: 'Взаимное исключение: ресурс занят одним процессом', essential: true, status: 'covered', student_quote: 'ресурс занят одним процессом',
    comment: 'Сказано.', source_ids: ['S03'], material_id: F.MAT1, source_quote: 'Ресурс в каждый момент занят не более чем одним процессом.',
    source_label: '«Лекция 4. Взаимоблокировки», фрагмент 3', live: false, credit: 1,
  });
  assert.deepEqual([body.points[1].credit, body.points[2].credit, body.points[2].source_ids, body.points[2].source_label], [0.5, 0, ['S05', 'S06'], '«Лекция 4. Взаимоблокировки», фрагменты 5, 6']);
  assert.equal(body.points[3].material_id, F.MAT2);
  assert.deepEqual(body.followup, { point_id: 'p3', question: 'Что такое круговое ожидание?', expected: 'Цепочка ожиданий.', status: 'missing', student_quote: 'не знаю', chosen_by: 'check' });
  assert.deepEqual(body.errors, protocol.errors);
  assert.ok(JSON.stringify(body).length < 30_000, 'under bot_voice_record\'s 30 000');
  // No grade, no save (the site throws).
  assert.equal(attemptPayload(a, { points: [], errors: [], verdict: '' }, null), null);
});

test('changeSentence equals the site\'s copy.ts (its test vectors); the shared words equal the site\'s', () => {
  const none: ChangeSummary = { erased: 0, rubbed: 0, checked: 0, returned: 0, stayed: 0 };
  const vectors: Array<[ChangeSummary, string]> = [
    [{ ...none, erased: 2, rubbed: 3, returned: 1 }, 'После ответа: 2 строки стёрлись, 3 — наполовину, 1 вернулась.'],
    [{ ...none, rubbed: 3, stayed: 2 }, 'После ответа: 3 строки стёрлись наполовину, 2 не стёрлись.'],
    [{ ...none, rubbed: 1, stayed: 1 }, 'После ответа: 1 строка стёрлась наполовину, 1 не стёрлась.'],
    [{ ...none, erased: 21 }, 'После ответа: 21 строка стёрлась.'],
    [{ ...none, erased: 1, checked: 2 }, 'После ответа: 1 строка стёрлась, 2 прошли проверку.'],
    [{ ...none, checked: 1 }, 'После ответа: 1 строка прошла проверку.'],
    [none, 'После ответа строки не изменились.'],
  ];
  for (const [summary, expected] of vectors) assert.equal(plain(changeSentence(summary)), expected);
  assert.ok(changeSentence({ ...none, erased: 1, rubbed: 1 }).includes('1\u00a0—\u00a0наполовину'));
  // The site's test file holds the same vectors (a change there shows here).
  const siteTest = read('frontend/src/components/exams/sheet/copy.test.ts');
  for (const [, expected] of vectors) assert.ok(siteTest.includes(`'${expected}'`), expected);
  // The words this module shares with the site and the Space.
  const backend = read('backend/oral_api.py');
  assert.ok(backend.includes(`DONT_KNOW_VERDICT = "${DONT_KNOW_VERDICT}"`), 'oral_api.DONT_KNOW_VERDICT');
  assert.ok(read('frontend/src/lib/oral/oralApi.ts').includes(`'${DONT_KNOW_VERDICT}'`), 'oralApi.ts DONT_KNOW_VERDICT');
  assert.match(backend, new RegExp(`CHECK_TOO_LONG_DETAIL = "${V.TOO_LONG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`), 'oral_api.CHECK_TOO_LONG_DETAIL');
  assert.match(read('backend/plans.py'), /"answer":\s*4\b/, 'the price: AI_COSTS.answer = 4');
});

test('limitLine: the reset on the student\'s clock, «сегодня» after local midnight', () => {
  const reset = Date.UTC(2026, 9, 17);
  assert.equal(limitLine(reset, NOW, 'Europe/Minsk'), 'Проверки ИИ на сегодня закончились. Снова можно завтра в 3:00. Проверить себя без Meldy можно сейчас.');
  assert.match(limitLine(reset, NOW, 'Asia/Vladivostok'), /Снова можно сегодня в 10:00\./);
  assert.match(limitLine(null, NOW, 'Europe/Minsk'), /завтра в 3:00/);
});

test('the refusal maps: the database\'s and the Space\'s statuses', () => {
  assert.deepEqual(['limit', 'ceiling', 'stop', 'too_long', 'busy', 'gone', 'off', 'duplicate', 'invalid'].map(dbRefusal),
    ['limit', 'ceiling', 'stop', 'too_long', null, null, null, null, null]);
  assert.deepEqual(['too_short', 'not_recognized', 'limit', 'ceiling', 'stop', 'too_large', 'off', 'gone', 'used', 'expired', 'busy', 'failed', 'unavailable', 'unreachable', 'bad_audio'].map(bridgeRefusal),
    ['too_short', 'not_recognized', 'limit', 'ceiling', 'stop', 'too_big', null, null, 'failed', 'failed', 'failed', 'failed', 'failed', 'failed', 'failed']);
});

// ─────────────────────────────────────────── the contract with the SQL ───────────────────────────────────────────

test('every bot_voice_* call names a function of the migration with its own parameter names; the 13 are all used', () => {
  const sql = read('supabase/migrations/20261010120006_telegram_bot_voice.sql');
  const params = new Map<string, Set<string>>();
  for (const m of sql.matchAll(/create or replace function public\.(bot_voice_[a-z_]+)\(([^)]*)\)/g)) {
    params.set(m[1], new Set([...m[2].matchAll(/\b(p_[a-z_]+)\s/g)].map((p) => p[1])));
  }
  assert.equal(params.size, 13);
  const granted = /grant execute on function ([\s\S]*?)\s+to service_role;/.exec(sql)![1];
  for (const fn of params.keys()) assert.ok(granted.includes(`public.${fn}(`), `${fn} granted to the service role`);
  const used = new Set<string>();
  for (const fdb of DBS) {
    for (const call of fdb.calls) {
      if (!call.fn.startsWith('bot_voice_')) continue;
      used.add(call.fn);
      const known = params.get(call.fn) ?? new Set<string>();
      assert.ok(params.has(call.fn), `${call.fn} is in the migration`);
      for (const key of Object.keys(call.args as Record<string, unknown>)) assert.ok(known.has(key), `${call.fn}(${key})`);
    }
  }
  assert.deepEqual([...used].sort(), [...params.keys()].sort(), 'the tests exercise every function');
  const source = read('supabase/functions/_shared/bot/voice.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '');
  assert.deepEqual([...new Set([...source.matchAll(/'(bot_voice_[a-z_]+)'/g)].map((m) => m[1]))].sort(), [...params.keys()].sort(),
    'voice.ts calls these 13 and no other database function');
  assert.ok(!/['"]bot_(?!voice_)[a-z_]+['"]/.test(source), 'no function of another package');
});
