// The tick's step «sweep» (sweep.ts; migration 20261103090200_picture_sweep.sql): the queued folders of deleted exams and
// tests are listed in both buckets through the Storage API with the service key and their pictures removed; a folder
// found empty in both leaves the queue; only UUID folders the database gave, only the two buckets; the tick's deadline;
// a failing folder is counted and logged by status, never by path; the step in the tick, between «flush» and
// «monitor»; without the migration, «missing». Fake database, fake storage, fake clock.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DbError } from './db.ts';
import { setLogSink } from './log.ts';
import { STUBS, type Ctx } from './router.ts';
import { runTick } from './tick.ts';
import { createSweep, LIST_PAGE, SWEEP_BUCKETS, SWEEP_FOLDERS } from './sweep.ts';
import { fakeDb } from './fixtures/fake_db.ts';

const URL_ = 'https://abcdefghijklmnopqrst.supabase.co';
const KEY = 'sb_secret_test_key_never_logged';
const A = '11111111-2222-4333-8444-555555555555';
const B = '66666666-7777-4888-9999-aaaaaaaaaaaa';
const PIC = (n: number) => `${String(n).padStart(64, 'a')}.png`;

/** A fake Storage API: its buckets' objects, every call it got, statuses it is told to fail with. */
function fakeStorage(objects: Record<string, string[]> = {}) {
  const store = new Map(Object.entries(objects).map(([bucket, paths]) => [bucket, new Set(paths)]));
  const calls: Array<{ method: string; path: string; headers: Record<string, string>; body: Record<string, unknown> }> = [];
  const fail: Record<string, number> = {};
  const fetch = async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    assert.ok(url.pathname.startsWith('/storage/v1/object/'), url.pathname);
    const path = url.pathname.slice('/storage/v1/object/'.length);
    const body = JSON.parse(String(init.body ?? '{}'));
    calls.push({ method: String(init.method), path, headers: init.headers as Record<string, string>, body });
    if (fail[path]) return new Response(JSON.stringify({ message: `nope ${path}` }), { status: fail[path] });
    if (init.method === 'POST' && path.startsWith('list/')) {
      const bucket = path.slice('list/'.length);
      const names = [...(store.get(bucket) ?? [])].filter((p) => p.startsWith(`${body.prefix}/`)).map((p) => p.slice(String(body.prefix).length + 1)).sort();
      const page = names.slice(body.offset, body.offset + body.limit).map((name) => ({ id: `id-${name}`, name, metadata: {} }));
      return new Response(JSON.stringify(page), { status: 200 });
    }
    if (init.method === 'DELETE') {
      const set = store.get(path) ?? new Set<string>();
      const removed = (body.prefixes as string[]).filter((p) => set.delete(p)).map((name) => ({ name, bucket_id: path }));
      return new Response(JSON.stringify(removed), { status: 200 });
    }
    return new Response('{}', { status: 400 });
  };
  return { fetch, calls, store, fail };
}

function setup(options: { queue?: string[]; objects?: Record<string, string[]>; functions?: boolean } = {}) {
  let now = Date.UTC(2026, 10, 3, 9, 0, 0);
  const clock = { now: () => now, advance: (ms: number) => { now += ms; } };
  const fdb = fakeDb({ now: clock.now });
  const queue = new Set(options.queue ?? []);
  const taken: number[] = [];
  if (options.functions !== false) {
    fdb.on('bot_picture_sweep', (args: Record<string, unknown>) => {
      taken.push(Number(args.p_limit));
      return { folders: [...queue].slice(0, Number(args.p_limit)), queued: queue.size };
    });
    fdb.on('bot_picture_swept', (args: Record<string, unknown>) => ({ done: queue.delete(String(args.p_container)) }));
  }
  const storage = fakeStorage(options.objects);
  const ctx = { db: fdb.db, now: clock.now } as unknown as Ctx;
  const sweep = createSweep({ url: `${URL_}/`, key: KEY, fetch: storage.fetch });
  const tick = (left = 25_000) => sweep.tick(ctx, { deadline: clock.now() + left, pace: async () => {} });
  return { clock, fdb, queue, taken, storage, ctx, sweep, tick };
}

test('a deleted test: its pictures go from both buckets; the next tick finds the folder empty and clears it', async () => {
  const s = setup({
    queue: [A],
    objects: { 'quiz-covers': [`${A}/${PIC(1)}`, `${A}/${PIC(2)}`, `${B}/${PIC(3)}`], 'test-item-images': [`${A}/${PIC(4)}`] },
  });
  assert.deepEqual(await s.tick(), { taken: 1, removed: 3 });
  assert.deepEqual([...s.storage.store.get('quiz-covers')!], [`${B}/${PIC(3)}`], 'another folder is left as it is');
  assert.deepEqual([...s.storage.store.get('test-item-images')!], []);
  assert.deepEqual(s.taken, [SWEEP_FOLDERS]);
  assert.ok(s.queue.has(A), 'not cleared before it is seen empty');
  // Every call: the two buckets only, the folder's own names only, the service key as the database gets it.
  for (const call of s.storage.calls) {
    assert.ok(['list/quiz-covers', 'list/test-item-images', ...SWEEP_BUCKETS].includes(call.path), call.path);
    assert.equal(call.headers.apikey, KEY);
    assert.equal(call.headers.Authorization, undefined, 'a new secret key goes on apikey only');
    if (call.method === 'DELETE') for (const p of call.body.prefixes as string[]) assert.ok(p.startsWith(`${A}/`), p);
    else assert.equal(call.body.prefix, A);
  }
  assert.deepEqual(await s.tick(), { taken: 1, emptied: 1 });
  assert.equal(s.queue.size, 0);
  assert.deepEqual(await s.tick(), { taken: 0 });
});

test('a folder of more than a page: listed page by page, removed a page a call', async () => {
  const many = Array.from({ length: LIST_PAGE + 30 }, (_, i) => `${A}/${PIC(i + 1)}`);
  const s = setup({ queue: [A], objects: { 'quiz-covers': many } });
  assert.deepEqual(await s.tick(), { taken: 1, removed: LIST_PAGE + 30 });
  const deletes = s.storage.calls.filter((c) => c.method === 'DELETE');
  assert.deepEqual(deletes.map((c) => (c.body.prefixes as string[]).length), [LIST_PAGE, 30]);
  assert.deepEqual(s.storage.calls.filter((c) => c.path === 'list/quiz-covers').map((c) => c.body.offset), [0, LIST_PAGE]);
});

test('only UUID folders, only what the database gave; a legacy service key also goes as the bearer', async () => {
  const s = setup({ objects: { 'quiz-covers': [`${A}/${PIC(1)}`] } });
  s.fdb.on('bot_picture_sweep', () => ({ folders: ['', '..', 'not-a-uuid', `${A}/../x`, B.toUpperCase(), 42, null], queued: 7 }));
  assert.deepEqual(await s.tick(), { taken: 0 });
  assert.equal(s.storage.calls.length, 0);
  const legacy = fakeStorage({ 'quiz-covers': [`${A}/${PIC(1)}`] });
  const fdb = fakeDb({ now: () => 0 });
  fdb.on('bot_picture_sweep', () => ({ folders: [A], queued: 1 }));
  const ctx = { db: fdb.db, now: () => 0 } as unknown as Ctx;
  await createSweep({ url: URL_, key: 'eyJhbGciOiJIUzI1NiJ9.e30.sig', fetch: legacy.fetch }).tick(ctx, { deadline: 1, pace: async () => {} });
  assert.equal(legacy.calls[0].headers.Authorization, 'Bearer eyJhbGciOiJIUzI1NiJ9.e30.sig');
});

test('storage refuses a folder: counted and logged by status only, the folder stays queued, the next one goes on', async () => {
  const lines: string[] = [];
  const restore = setLogSink((line) => {
    lines.push(line);
  });
  try {
    const s = setup({ queue: [A, B], objects: { 'quiz-covers': [`${A}/${PIC(1)}`, `${B}/${PIC(2)}`] } });
    s.storage.fail['quiz-covers'] = 503;
    assert.deepEqual(await s.tick(), { taken: 2, failed: 2 });
    assert.ok(s.queue.has(A) && s.queue.has(B));
    delete s.storage.fail['quiz-covers'];
    s.storage.fail['list/test-item-images'] = 500;
    assert.deepEqual(await s.tick(), { taken: 2, removed: 2, failed: 2 });
    assert.equal(lines.length, 4);
    for (const line of lines) {
      const entry = JSON.parse(line);
      assert.deepEqual({ ...entry, error_name: undefined }, { route: 'tick', kind: 'sweep', outcome: 'failed', error_name: undefined });
      assert.match(entry.error_name, /^storage_(503|500)$/);
      assert.ok(!line.includes(A) && !line.includes(KEY) && !line.includes('supabase.co'), line);
    }
  } finally {
    restore();
  }
});

test('nothing starts after the tick\'s deadline; without the migration the step says «missing»', async () => {
  const s = setup({ queue: [A, B], objects: { 'quiz-covers': [`${A}/${PIC(1)}`] } });
  assert.deepEqual(await s.tick(-1), { taken: 2, left: 2 });
  assert.equal(s.storage.calls.length, 0);
  const none = setup({ functions: false });
  none.fdb.fail('bot_picture_sweep', new DbError('bot_picture_sweep', 404, 'PGRST202'));
  assert.deepEqual(await none.tick(), { missing: 1 });
});

test('in the tick: after «flush», before «monitor» and the beat, in the tick\'s numbers; without the port, nothing', async () => {
  const s = setup({ queue: [A], objects: { 'test-item-images': [`${A}/${PIC(1)}`] } });
  const ctx = { ...s.ctx, tg: {}, site: 'https://example.test', botUsername: 'bot', hourly: () => true } as unknown as Ctx;
  const totals = await runTick(ctx, { ...STUBS, sweep: s.sweep }, { sleep: async () => {} });
  const fns = s.fdb.calls.map((c) => c.fn);
  assert.deepEqual(fns.slice(fns.indexOf('bot_flush_pending')), ['bot_flush_pending', 'bot_picture_sweep', 'bot_tick_beat']);
  assert.equal(totals.sweep_removed, 1);
  assert.equal(totals.sweep_taken, 1);
  const plain = setup({ queue: [A] });
  const without = await runTick({ ...ctx, db: plain.fdb.db } as unknown as Ctx, STUBS, { sleep: async () => {} });
  assert.ok(!plain.fdb.calls.some((c) => c.fn === 'bot_picture_sweep'));
  assert.equal(Object.keys(without).filter((k) => k.startsWith('sweep_')).length, 0);
});
