import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ quizAnalysis: vi.fn() }));
vi.mock('../../api/quizzes', () => api);

import { ANALYSIS_DEBOUNCE_MS, useQuizAnalysis } from './useQuizAnalysis';

/** Release 49, review 2026-11-05: a class finishing together must not re-grade the quiz at every 5-second poll. */
const empty = { quiz_id: 'q', server_now: '', items: [], attempts: [], others: [] };
beforeEach(() => {
  vi.useFakeTimers();
  api.quizAnalysis.mockReset().mockResolvedValue(empty);
});
afterEach(() => vi.useRealTimers());

const flush = () => act(async () => {
  await Promise.resolve();
});

describe('useQuizAnalysis', () => {
  it('reads at once the first time, then waits for a quiet spell after the finishes change', async () => {
    const { result, rerender } = renderHook(({ stamp }) => useQuizAnalysis('q', stamp), { initialProps: { stamp: '1:a' } });
    await flush();
    expect(api.quizAnalysis).toHaveBeenCalledTimes(1);
    expect(result.current.analysis).toEqual(empty);
    rerender({ stamp: '2:b' });
    await act(async () => {
      vi.advanceTimersByTime(5_000);
    });
    rerender({ stamp: '3:c' });
    await act(async () => {
      vi.advanceTimersByTime(ANALYSIS_DEBOUNCE_MS - 1);
    });
    expect(api.quizAnalysis).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    await flush();
    expect(api.quizAnalysis).toHaveBeenCalledTimes(2);
  });

  it('reload reads at once; nothing is read while nobody has finished', async () => {
    const { result, rerender } = renderHook(({ stamp }) => useQuizAnalysis('q', stamp), { initialProps: { stamp: '' } });
    await flush();
    expect(api.quizAnalysis).not.toHaveBeenCalled();
    rerender({ stamp: '1:a' });
    await flush();
    expect(api.quizAnalysis).toHaveBeenCalledTimes(1);
    act(() => result.current.reload());
    await flush();
    expect(api.quizAnalysis).toHaveBeenCalledTimes(2);
  });
});
