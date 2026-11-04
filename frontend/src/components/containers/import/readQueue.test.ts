import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ parseBank: vi.fn(), parseBankAi: vi.fn() }));
vi.mock('../../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/containers')>()),
  parseBank: api.parseBank,
  parseBankAi: api.parseBankAi,
}));
vi.mock('../../../api/exams', () => ({ parseQuestionList: vi.fn(), examErrorMessage: (_error: unknown, fallback: string) => fallback }));

import { ContainerApiError } from '../../../api/containers';
import type { BankParseResult } from '../../../types/container';
import { PARSE_ERRORS } from '../copyImport';
import { readBankQueued, ReadError } from './readFiles';
import { createReadQueue, READ_GIVE_UP_MS, retryAfterMs, Throttled } from './readQueue';

const MINUTE = 60_000;
const parsed = (name: string) => ({ items: [], stats: { items: 0 }, name }) as unknown as BankParseResult;

/** The server as bank_api.py limits it, at `perMinute` a minute (fixed windows); a refusal names the window's end. */
function fakeServer(perMinute: number, retryAfter = true) {
  let windowStart = Date.now();
  let used = 0;
  const calls: string[] = [];
  api.parseBank.mockImplementation(async (input: { file?: File }) => {
    const name = input.file?.name ?? 'text';
    await Promise.resolve();
    const now = Date.now();
    if (now - windowStart >= MINUTE) {
      windowStart = now;
      used = 0;
    }
    calls.push(name);
    if (used >= perMinute) {
      const seconds = Math.ceil((windowStart + MINUTE - now) / 1000);
      throw new ContainerApiError('http_429', PARSE_ERRORS.rate_limited, { status: 429, detail: 'Много', retryAfter: retryAfter ? String(seconds) : null });
    }
    used += 1;
    return parsed(name);
  });
  return calls;
}

function batch(count: number, onEvent: (event: string) => void = () => undefined) {
  const queue = createReadQueue({ concurrency: 2 });
  const read: string[] = [];
  const failed: string[] = [];
  const waits: Array<[string, number]> = [];
  const names = Array.from({ length: count }, (_, at) => `Вариант_${at + 1}.docx`);
  for (const name of names) {
    const file = new File(['x'], name);
    queue.push({
      attempt: async () => {
        const { result } = await readBankQueued({ file, format: 'auto' });
        read.push((result as unknown as { name: string }).name);
        onEvent(`read ${name}`);
      },
      onWait: (until) => waits.push([name, Math.round((until - Date.now()) / 1000)]),
      onGiveUp: () => failed.push(name),
    });
  }
  return { queue, names, read, failed, waits };
}

beforeEach(() => {
  vi.useFakeTimers({ now: new Date('2026-11-04T09:00:00Z') });
  api.parseBank.mockReset();
});
afterEach(() => vi.useRealTimers());

describe('reading a batch of files against the server’s limit (owner, 2026-11-04)', () => {
  it('24 files where the server refuses after 10 a minute: all 24 are read, none fails, in their order', async () => {
    const calls = fakeServer(10);
    const { queue, names, read, failed, waits } = batch(24);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveLength(10);
    expect(waits.length).toBeGreaterThan(0);
    expect(waits.every(([, seconds]) => seconds >= 1 && seconds <= 60)).toBe(true);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(read).toHaveLength(20);
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(read).toEqual(names);
    expect(failed).toEqual([]);
    expect(queue.size()).toBe(0);
    // a refused file is tried again before the files behind it: at most the two in flight are refused each minute
    expect(calls.length).toBeLessThanOrEqual(24 + 4);
  });

  it('without Retry-After the queue waits about 20 seconds and goes on by itself', async () => {
    fakeServer(1, false);
    const { read, waits } = batch(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveLength(1);
    expect(waits[0]).toEqual(['Вариант_2.docx', 20]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(read).toHaveLength(1); // the server's minute is not over: refused again, waits again
    await vi.advanceTimersByTimeAsync(MINUTE);
    expect(read).toEqual(['Вариант_1.docx', 'Вариант_2.docx']);
  });

  it('refused again and again for about three minutes, a file fails with the usual line and its retry', async () => {
    api.parseBank.mockRejectedValue(new ContainerApiError('http_429', 'Много', { status: 429, retryAfter: '30' }));
    const { failed, read } = batch(1);
    await vi.advanceTimersByTimeAsync(READ_GIVE_UP_MS - 31_000);
    expect(failed).toEqual([]);
    await vi.advanceTimersByTimeAsync(31_000);
    expect(failed).toEqual(['Вариант_1.docx']);
    expect(read).toEqual([]);
    expect(api.parseBank.mock.calls.length).toBeGreaterThanOrEqual(6);
  });

  it('another failure is the job’s own: the queue does not wait for it', async () => {
    const queue = createReadQueue({ concurrency: 1 });
    const done: string[] = [];
    queue.push({ attempt: async () => { throw new Error('boom'); } });
    queue.push({ attempt: async () => { done.push('second'); } });
    await vi.advanceTimersByTimeAsync(0);
    expect(done).toEqual(['second']);
  });

  it('a 429 reaches the queue as Throttled with the server’s wait; other errors stay ReadError', async () => {
    api.parseBank.mockRejectedValueOnce(new ContainerApiError('http_429', 'Много', { status: 429, retryAfter: '17' }));
    await expect(readBankQueued({ text: 'x', format: 'auto' })).rejects.toEqual(new Throttled(17_000));
    api.parseBank.mockRejectedValueOnce(new ContainerApiError('no_items', 'Не нашли вопросов.', { status: 422, detail: 'Не нашли вопросов.' }));
    await expect(readBankQueued({ text: 'x', format: 'auto' })).rejects.toBeInstanceOf(ReadError);
  });

  it('reads Retry-After as seconds or an HTTP date', () => {
    expect(retryAfterMs('20')).toBe(20_000);
    expect(retryAfterMs(null)).toBeNull();
    expect(retryAfterMs('soon')).toBeNull();
    const at = Date.parse('2026-11-04T09:00:00Z');
    expect(retryAfterMs('Wed, 04 Nov 2026 09:00:30 GMT', at)).toBe(30_000);
  });
});
