// The whole function with the real session port (session.ts) for the session's tests: T2's fake Telegram and fake
// database, the fake of T5's session functions over a synthetic bank («Осенняя сессия» of fixtures/scenario.ts), and
// a clock the tests move. Session ids come from a seeded generator, so every run builds the same queues and orders.
import { LOGS } from '../harness.ts';
import { createApp, type TgUpdate } from '../../router.ts';
import { derivedSecret } from '../../secrets.ts';
import { createSession, type SessionOptions } from '../../session.ts';
import { FUNCTION_REGION, webhookUrl } from '../../setup.ts';
import { fakeDb } from '../fake_db.ts';
import { fakeTelegram, TEST_FUNCTION_URL, TEST_TOKEN } from '../fake_telegram.ts';
import { AUTUMN, NOW, TG, USER, wireOf, type ExamSpec } from '../scenario.ts';
import { press as pressUpdate, privateText } from '../updates.ts';
import { fakeSessions } from './fake_sessions.ts';

export { LOGS };

/** A seeded generator in [0, 1) (mulberry32): the session ids of a test are the same on every run. */
export function seeded(seed = 7): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sessionHarness(options: { now?: number; seed?: number; session?: SessionOptions } = {}) {
  let t = options.now ?? NOW;
  const now = () => t;
  const tg = fakeTelegram({ now });
  const fdb = fakeDb({ now });
  const fs = fakeSessions(fdb, { now });
  const port = createSession({ random: seeded(options.seed ?? 7), ...(options.session ?? {}) });
  const waits: Promise<unknown>[] = [];
  const app = createApp({
    token: TEST_TOKEN,
    fetch: tg.fetch,
    db: fdb.db,
    functionUrl: TEST_FUNCTION_URL,
    region: FUNCTION_REGION,
    waitUntil: (work) => waits.push(work),
    now,
    ports: { session: port },
    sleep: async (ms) => {
      t += ms;
    },
    random: () => 0.5,
  });

  async function post(update: TgUpdate): Promise<Response> {
    const secret = await derivedSecret(TEST_TOKEN, 'webhook');
    return app(new Request(webhookUrl(TEST_FUNCTION_URL), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': secret },
      body: JSON.stringify(update),
    }));
  }

  /** The minute tick (POST /telegram/tick with its header); resolves when its work is done. */
  async function tick(): Promise<void> {
    const secret = await derivedSecret(TEST_TOKEN, 'tick');
    await app(new Request(`${TEST_FUNCTION_URL}/tick?forceFunctionRegion=${FUNCTION_REGION}`, { method: 'POST', headers: { 'x-meldy-tick': secret } }));
    await Promise.all(waits.splice(0));
  }

  /** The linked student of the spec's example with the given exams; every planned item is a question of the bank. */
  function linked(specs: ExamSpec[] = [AUTUMN]) {
    const row = fdb.addLink({ userId: USER, tgUserId: TG });
    const wire = wireOf(specs, t);
    fdb.setUser(USER, { wire, exams: specs.map((s, i) => ({ id: s.id, createdAt: `2026-10-0${i + 1}T10:00:00Z` })), session: null });
    fs.fromWire(wire);
    return row;
  }

  /** A card the bot sent earlier (the message «Начать» is pressed on). */
  function card(messageId: number, text = 'Карточка дня') {
    tg.seed(TG, messageId, text, null);
    return messageId;
  }

  /** A button pressed on a message (`data` as the button carries it). */
  async function press(data: string, messageId: number, extra: { markup?: unknown } = {}): Promise<Response> {
    const update = pressUpdate(data, { messageId });
    if (extra.markup !== undefined && update.callback_query?.message) (update.callback_query.message as { reply_markup?: unknown }).reply_markup = extra.markup;
    return post(update);
  }

  async function type(text: string): Promise<{ res: Response; messageId: number }> {
    const update = privateText(text);
    const res = await post(update);
    return { res, messageId: update.message!.message_id };
  }

  /** The text and the keyboard of a message in the fake chat. */
  function message(messageId: number) {
    return tg.messages.get(`${TG}:${messageId}`) ?? null;
  }

  /** The callback_data of the buttons of a message, row by row. */
  function datas(messageId: number): string[][] {
    const m = message(messageId);
    return (m?.markup?.inline_keyboard ?? []).map((row: Array<{ callback_data?: string; url?: string; web_app?: { url?: string } }>) => row.map((b) => b.callback_data ?? b.url ?? b.web_app?.url ?? ''));
  }

  /** Button labels, row by row (no-break spaces read as spaces). */
  function labels(messageId: number): string[][] {
    const m = message(messageId);
    return (m?.markup?.inline_keyboard ?? []).map((row: Array<{ text: string }>) => row.map((b) => b.text.replace(/\u00a0/g, ' ')));
  }

  /** The answerCallbackQuery texts, in order ('' for a silent answer; no-break spaces read as spaces). */
  function toasts(): string[] {
    return tg.of('answerCallbackQuery').map((c) => String(c.params.text ?? '').replace(/\u00a0/g, ' '));
  }

  return {
    tg, fdb, fs, app, post, tick, linked, card, press, type, message, datas, labels, toasts, waits, port,
    get now() { return t; },
    advance(ms: number) { t += ms; },
    set(ms: number) { t = ms; },
  };
}

export type SessionHarness = ReturnType<typeof sessionHarness>;
export { AUTUMN, NOW, TG, USER };
