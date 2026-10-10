// The whole function with the real group port (group.ts) in a test: createApp with T2's fake Telegram and fake
// database, the group's database model (fake_group.ts) on top, and a clock the fake sleep moves forward.
// `post(update)` is a webhook request with the right secret; `tick()` runs a whole minute tick to its end.
import assert from 'node:assert/strict';
import { createGroup } from '../../group.ts';
import { setLogSink } from '../../log.ts';
import { createApp, type TgUpdate } from '../../router.ts';
import { derivedSecret } from '../../secrets.ts';
import { fakeDb } from '../fake_db.ts';
import { fakeTelegram, TEST_FUNCTION_URL, TEST_TOKEN } from '../fake_telegram.ts';
import { AUTUMN, wireOf } from '../scenario.ts';
import { AT_1201, AUTHOR, autumn, MEMBER, OUTSIDER, WINTER_ID } from './exam.ts';
import { fakeGroup } from './fake_group.ts';
import type { FakeExam } from './fake_group.ts';

/** Every log line written while the group's tests run (the console stays quiet). */
export const LOGS: string[] = [];
setLogSink((line) => {
  LOGS.push(line);
});

export function groupHarness(options: { now?: number; exam?: Partial<FakeExam>; bound?: boolean } = {}) {
  let t = options.now ?? AT_1201;
  const now = () => t;
  const tg = fakeTelegram({ now });
  const fdb = fakeDb({ now });
  const fg = fakeGroup(fdb, { now });
  const waits: Promise<unknown>[] = [];
  const sleep = async (ms: number) => {
    t += ms;
  };
  const port = createGroup({ sleep });
  const app = createApp({
    token: TEST_TOKEN,
    fetch: tg.fetch,
    db: fdb.db,
    functionUrl: TEST_FUNCTION_URL,
    waitUntil: (work) => waits.push(work),
    now,
    ports: { group: port },
    sleep,
    random: () => 0.5,
  });

  // The people: the author and a member of «Осенняя сессия», a linked student of another exam; the stranger is not linked.
  // Their own day cards are off: the tick's reminders stay out of the group's tests.
  fdb.addLink({ userId: AUTHOR.userId, tgUserId: AUTHOR.tg, remindOn: false });
  fdb.addLink({ userId: MEMBER.userId, tgUserId: MEMBER.tg, remindOn: false });
  fdb.addLink({ userId: OUTSIDER.userId, tgUserId: OUTSIDER.tg, remindOn: false });
  fdb.setUser(AUTHOR.userId, { wire: wireOf([{ ...AUTUMN, role: 'owner' }], t), exams: [{ id: AUTUMN.id }] });
  fdb.setUser(MEMBER.userId, { wire: wireOf([AUTUMN], t), exams: [{ id: AUTUMN.id }] });
  fdb.setUser(OUTSIDER.userId, { wire: wireOf([{ id: WINTER_ID, title: 'Зимняя сессия', date: '2026-12-20' }], t), exams: [{ id: WINTER_ID }] });
  const exam = fg.addExam(autumn(options.exam ?? {}));

  async function post(update: TgUpdate): Promise<Response> {
    const headers = { 'Content-Type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': await derivedSecret(TEST_TOKEN, 'webhook') };
    return app(new Request(`${TEST_FUNCTION_URL}?forceFunctionRegion=eu-central-1`, { method: 'POST', headers, body: JSON.stringify(update) }));
  }

  /** One tick to its end: its numbers (the beat). */
  async function tick(): Promise<Record<string, number>> {
    const res = await app(new Request(`${TEST_FUNCTION_URL}/tick`, { method: 'POST', headers: { 'x-meldy-tick': await derivedSecret(TEST_TOKEN, 'tick') } }));
    assert.equal(res.status, 202);
    const all = await Promise.all(waits.splice(0));
    return all.at(-1) as Record<string, number>;
  }

  return {
    tg, fdb, fg, app, port, post, tick, exam, waits,
    get now() { return t; },
    advance(ms: number) { t += ms; },
    set(ms: number) { t = ms; },
  };
}

export type GroupHarness = ReturnType<typeof groupHarness>;
