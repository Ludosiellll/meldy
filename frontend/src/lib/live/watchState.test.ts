import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchState } from './api';
import { LiveError, type LiveApi } from './types';
import { POLL_BUSY_STEP_MS, POLL_DONE_MS, POLL_FAST_MS } from './rules';

/* Load audit 07.11: a finished game is read every 10 s (LOAD-3); a read refused for the rate waits 3, 6, 9 s (LOAD-4). */
type S = { rev: number; state: string; players?: number };

function apiWithout(): LiveApi {
  return { subscribe: () => () => undefined } as unknown as LiveApi;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('watchState', () => {
  it('reads every second without a channel, every 10 s once the game is on its podium', async () => {
    let rev = 0;
    let state = 'open';
    const read = vi.fn(async () => ({ rev: ++rev, state }) as S);
    const stop = watchState<S>({ api: apiWithout(), topic: 't', read, onState: () => undefined });
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_FAST_MS);
    expect(read).toHaveBeenCalledTimes(2);
    state = 'podium';
    await vi.advanceTimersByTimeAsync(POLL_FAST_MS);
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(POLL_DONE_MS - 1);
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(4);
    stop();
  });

  it('backs off after 429 (3 s, then 6 s) and goes back to the pace after a read', async () => {
    let refuse = 2;
    let rev = 0;
    const read = vi.fn(async () => {
      if (refuse > 0) {
        refuse -= 1;
        throw new LiveError('unknown', null, 429);
      }
      return { rev: ++rev, state: 'open' } as S;
    });
    const onError = vi.fn();
    const stop = watchState<S>({ api: apiWithout(), topic: 't', read, onState: () => undefined, onError });
    await vi.advanceTimersByTimeAsync(0);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(POLL_BUSY_STEP_MS - 1);
    expect(read).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(read).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(2 * POLL_BUSY_STEP_MS);
    expect(read).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(POLL_FAST_MS);
    expect(read).toHaveBeenCalledTimes(4);
    expect(onError).toHaveBeenCalledTimes(2);
    stop();
  });
});
