// The whole function in a test: createApp with the fake Telegram, the fake database, recording ports and a clock that
// the fake sleep moves forward. `post(update)` sends a webhook request with the right (or a given) secret header.
import { setLogSink } from '../log.ts';
import { createApp, type Ports, type TgUpdate } from '../router.ts';
import { derivedSecret } from '../secrets.ts';
import { fakeDb } from './fake_db.ts';
import { fakeTelegram, TEST_FUNCTION_URL, TEST_TOKEN } from './fake_telegram.ts';
import { AUTUMN, NOW, TG, USER, wireOf, type ExamSpec } from './scenario.ts';

/** Every log line written while a test file that uses the harness runs (the console stays quiet). */
export const LOGS: string[] = [];
setLogSink((line) => {
  LOGS.push(line);
});

export interface PortCall { port: string; fn: string; args: unknown[] }

/** Ports that record every call; the session port can be told to take short answers. */
export function recordingPorts(calls: PortCall[], options: { sessionTakesText?: boolean; filesTake?: boolean } = {}): Ports {
  const rec = (port: string, fn: string, args: unknown[]) => calls.push({ port, fn, args });
  return {
    session: {
      async start(_ctx, tap, go) {
        rec('session', 'start', [go]);
        await tap.answer();
      },
      async press(_ctx, tap, cb) {
        rec('session', 'press', [cb]);
        await tap.answer();
      },
      async text(_ctx, msg) {
        rec('session', 'text', [msg.text]);
        return options.sessionTakesText === true;
      },
    },
    group: {
      async startGroup(_ctx, msg, code) { rec('group', 'startGroup', [msg.chat.id, code]); },
      async privateStart(_ctx, _msg, payload) {
        rec('group', 'privateStart', [payload]);
        return false;
      },
      async press(_ctx, tap, cb) {
        rec('group', 'press', [cb]);
        await tap.answer();
      },
      async member(_ctx, update) { rec('group', 'member', [update.chat.id, update.new_chat_member.status]); },
      async migrate(_ctx, from, to) { rec('group', 'migrate', [from, to]); },
      async closePosts() { rec('group', 'closePosts', []); return { closed: 0 }; },
      async sendPosts() { rec('group', 'sendPosts', []); return { posted: 0 }; },
      async counters() { rec('group', 'counters', []); return { counted: 0 }; },
    },
    files: {
      async document(_ctx, msg) {
        rec('files', 'document', [msg.document?.file_name]);
        return options.filesTake === true;
      },
      async http() {
        rec('files', 'http', []);
        return new Response('file', { status: 200 });
      },
    },
    voice: {
      async voice() {
        rec('voice', 'voice', []);
        return false;
      },
    },
  };
}

export function harness(options: { now?: number; ports?: 'stubs' | 'record'; sessionTakesText?: boolean; filesTake?: boolean; region?: string | null } = {}) {
  let t = options.now ?? NOW;
  const now = () => t;
  const tg = fakeTelegram({ now, webhookUrl: `${TEST_FUNCTION_URL}?forceFunctionRegion=eu-central-1` });
  const fdb = fakeDb({ now });
  const portCalls: PortCall[] = [];
  const waits: Promise<unknown>[] = [];
  const sleeps: number[] = [];
  const app = createApp({
    token: TEST_TOKEN,
    fetch: tg.fetch,
    db: fdb.db,
    functionUrl: TEST_FUNCTION_URL,
    region: options.region === undefined ? 'eu-central-1' : options.region,
    waitUntil: (work) => waits.push(work),
    now,
    ports: options.ports === 'stubs' ? undefined : recordingPorts(portCalls, options),
    sleep: async (ms) => {
      sleeps.push(ms);
      t += ms;
    },
    random: () => 0.5,
  });

  async function post(update: TgUpdate | string, header?: string | null): Promise<Response> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const secret = header === undefined ? await derivedSecret(TEST_TOKEN, 'webhook') : header;
    if (secret !== null) headers['X-Telegram-Bot-Api-Secret-Token'] = secret;
    return app(new Request(`${TEST_FUNCTION_URL}?forceFunctionRegion=eu-central-1`, { method: 'POST', headers, body: typeof update === 'string' ? update : JSON.stringify(update) }));
  }

  async function tick(header?: string | null): Promise<Response> {
    const headers: Record<string, string> = {};
    const secret = header === undefined ? await derivedSecret(TEST_TOKEN, 'tick') : header;
    if (secret !== null) headers['x-meldy-tick'] = secret;
    return app(new Request(`${TEST_FUNCTION_URL}/tick?forceFunctionRegion=eu-central-1`, { method: 'POST', headers }));
  }

  /** The linked student of the spec's example with the given exams (default: «Осенняя сессия»). */
  function linked(specs: ExamSpec[] = [AUTUMN], link: Parameters<typeof fdb.addLink>[0] = { userId: USER, tgUserId: TG }) {
    const row = fdb.addLink(link);
    fdb.setUser(link.userId, { wire: wireOf(specs, t), exams: specs.map((s, i) => ({ id: s.id, createdAt: `2026-10-0${i + 1}T10:00:00Z` })) });
    return row;
  }

  return {
    tg, fdb, app, post, tick, waits, sleeps, portCalls, linked,
    get now() { return t; },
    advance(ms: number) { t += ms; },
    set(ms: number) { t = ms; },
  };
}

export type Harness = ReturnType<typeof harness>;
