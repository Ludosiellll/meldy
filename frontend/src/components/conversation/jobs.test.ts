import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  row: null as null | { summary_json: Record<string, unknown>; original_text: string },
  updates: [] as Array<Record<string, unknown>>,
  updatedRows: 1,
  error: null as null | { message: string },
  /** The auth listener the job registry subscribed (onAuthStateChange). */
  auth: null as null | ((event: string) => void),
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    auth: {
      onAuthStateChange: (listener: (event: string) => void) => {
        db.auth = listener;
        return { data: { subscription: { unsubscribe: () => undefined } } };
      },
    },
    from: () => ({
      select: () => ({ eq: () => ({ single: async () => ({ data: JSON.parse(JSON.stringify(db.row)), error: null }) }) }),
      update: (payload: Record<string, unknown>) => ({
        eq: () => ({
          select: async () => {
            if (db.error) return { data: null, error: db.error };
            if (db.updatedRows > 0) db.updates.push(JSON.parse(JSON.stringify(payload)));
            return { data: Array.from({ length: db.updatedRows }, () => ({ id: 'm1' })), error: null };
          },
        }),
      }),
    }),
  },
}));

import { renderHook } from '@testing-library/react';
import { cancelJobs, checkJob, isJobRunning, JOB_TIMEOUT_MESSAGE, JOB_TIMEOUT_MS, jobStatus, publishLines, resetJobsForTests, runJob, useLinesFeed } from './jobs';
import { ConversationError, NOT_OWNER_MESSAGE, patchSummaryJson, postJson, saveCheatsheet, saveConversationLines } from './persistence';

describe('patchSummaryJson', () => {
  beforeEach(() => {
    db.row = { summary_json: { content: 'Конспект', podcast: [{ speaker: 'Макс', text: 'Привет' }], _startTab: 'podcast' }, original_text: '' };
    db.updates = [];
    db.updatedRows = 1;
    db.error = null;
  });

  it('re-reads summary_json and changes only the given key', async () => {
    // Пока шла выжимка, в другой вкладке сохранили разговор: он должен остаться.
    await saveCheatsheet('m1', '# Выжимка');
    expect(db.updates).toEqual([
      { summary_json: { content: 'Конспект', podcast: [{ speaker: 'Макс', text: 'Привет' }], cheatsheet: '# Выжимка' } },
    ]);
    await saveConversationLines('m1', [{ speaker: 'Софья', text: 'Новый' }]);
    expect(db.updates[1]).toEqual({ summary_json: { content: 'Конспект', podcast: [{ speaker: 'Софья', text: 'Новый' }] } });
  });

  it('fails instead of pretending to save someone else’s material', async () => {
    db.updatedRows = 0;
    await expect(patchSummaryJson('m1', { cheatsheet: 'x' })).rejects.toThrow(NOT_OWNER_MESSAGE);
    db.updatedRows = 1;
    db.error = { message: 'network' };
    await expect(saveCheatsheet('m1', 'x')).rejects.toThrow('Не удалось сохранить выжимку. Попробуйте ещё раз.');
  });
});

describe('postJson', () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer = (status: number, body: unknown) =>
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })));

  it('tells a spent day from a busy service', async () => {
    answer(429, { detail: 'Дневной лимит ИИ на сегодня исчерпан.', code: 'ai_limit', used: 100, limit: 100 });
    await expect(postJson('/api/podcast/generate', {})).rejects.toThrow(/^Дневной лимит ИИ на сегодня исчерпан\. Он обновится в /);
    answer(429, { detail: 'Too many requests' });
    await expect(postJson('/api/podcast/generate', {})).rejects.toThrow('Сервис сейчас занят. Подождите минуту и попробуйте ещё раз.');
  });
});

describe('job registry', () => {
  beforeEach(() => resetJobsForTests());
  afterEach(() => {
    vi.useRealTimers();
    resetJobsForTests();
  });

  it('runs one job per material and kind, and reports when it really began', async () => {
    let finish!: () => void;
    const task = vi.fn(async (begin: () => void) => {
      begin();
      await new Promise<void>(resolve => {
        finish = resolve;
      });
    });
    const first = runJob('visuals', 'm1', task, 'Ошибка');
    expect(jobStatus('visuals', 'm1')).toEqual({ state: 'working' });
    expect(isJobRunning('visuals', 'm1')).toBe(true);
    await runJob('visuals', 'm1', task, 'Ошибка');
    expect(task).toHaveBeenCalledTimes(1);
    expect(jobStatus('visuals', 'm2')).toEqual({ state: 'idle' });
    finish();
    await first;
    expect(jobStatus('visuals', 'm1')).toEqual({ state: 'idle' });
    expect(isJobRunning('visuals', 'm1')).toBe(false);
  });

  it('keeps the previous state when the user declines the energy charge', async () => {
    await runJob('create', 'm1', async () => {
      throw new ConversationError('Сервис сейчас занят.');
    }, 'Ошибка');
    expect(jobStatus('create', 'm1')).toEqual({ state: 'error', message: 'Сервис сейчас занят.' });
    await runJob('create', 'm1', async () => undefined, 'Ошибка');
    expect(jobStatus('create', 'm1')).toEqual({ state: 'error', message: 'Сервис сейчас занят.' });
  });

  it('turns unknown errors into the fallback text and forgets them after a while', async () => {
    vi.useFakeTimers();
    await runJob('cheatsheet', 'm1', async begin => {
      begin();
      throw new Error('secret provider detail');
    }, 'Не удалось создать выжимку. Попробуйте ещё раз.');
    expect(jobStatus('cheatsheet', 'm1')).toEqual({ state: 'error', message: 'Не удалось создать выжимку. Попробуйте ещё раз.' });
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(jobStatus('cheatsheet', 'm1')).toEqual({ state: 'idle' });
  });

  it('publishes finished lines only to the open players of the same material', () => {
    const onFirst = vi.fn();
    const onOther = vi.fn();
    const first = renderHook(() => useLinesFeed('m1', onFirst));
    renderHook(() => useLinesFeed('m2', onOther));
    publishLines('m1', [{ speaker: 'Макс', text: 'Готово' }]);
    expect(onFirst).toHaveBeenCalledWith([{ speaker: 'Макс', text: 'Готово' }]);
    expect(onOther).not.toHaveBeenCalled();
    first.unmount();
    publishLines('m1', []);
    expect(onFirst).toHaveBeenCalledTimes(1);
  });
});

describe('stopping a job (debt: background jobs were never cancelled, no AbortController)', () => {
  beforeEach(() => resetJobsForTests());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    resetJobsForTests();
  });

  /** A server that answers only when told; the request's signal is kept. */
  function heldServer() {
    const held = { signal: null as AbortSignal | null, answer: (_body: unknown) => undefined as void };
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise<Response>((resolve, reject) => {
            held.signal = init.signal ?? null;
            init.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
            held.answer = (body: unknown) => resolve(new Response(JSON.stringify(body), { status: 200 }));
          }),
      ),
    );
    return held;
  }

  it('the lecture deleted: its job’s request is aborted, nothing is saved, no error; another lecture’s goes on', async () => {
    const held = heldServer();
    const saved: string[] = [];
    const job = (id: string) =>
      runJob('create', id, async (begin, signal) => {
        begin();
        await postJson('/api/podcast/generate', {}, signal);
        checkJob(signal);
        saved.push(id);
      }, 'Ошибка');
    const first = job('m1');
    await vi.waitFor(() => expect(held.signal).not.toBeNull());
    const firstSignal = held.signal as AbortSignal;
    cancelJobs('m2');
    expect(firstSignal.aborted).toBe(false);
    cancelJobs('m1');
    expect(firstSignal.aborted).toBe(true);
    await first;
    expect(saved).toEqual([]);
    expect(jobStatus('create', 'm1')).toEqual({ state: 'idle' });
    expect(isJobRunning('create', 'm1')).toBe(false);
  });

  it('an answer that came while the lecture was being deleted is not saved either', async () => {
    const held = heldServer();
    const saved: string[] = [];
    const run = runJob('visuals', 'm1', async (begin, signal) => {
      begin();
      const payload = postJson('/api/podcast/visuals', {}, signal);
      held.answer({ visuals: [] });
      await payload;
      cancelJobs('m1');
      checkJob(signal);
      saved.push('m1');
    }, 'Ошибка');
    await vi.waitFor(() => expect(held.signal).not.toBeNull());
    await run;
    expect(saved).toEqual([]);
    expect(jobStatus('visuals', 'm1')).toEqual({ state: 'idle' });
  });

  it('a request the server never answers stops after the deadline: «Сервер не ответил», the button is free again', async () => {
    vi.useFakeTimers();
    const held = heldServer();
    const run = runJob('cheatsheet', 'm1', async (begin, signal) => {
      begin();
      await postJson('/api/quick-prep', {}, signal);
    }, 'Ошибка');
    await vi.advanceTimersByTimeAsync(JOB_TIMEOUT_MS - 1);
    expect(jobStatus('cheatsheet', 'm1')).toEqual({ state: 'working' });
    await vi.advanceTimersByTimeAsync(1);
    await run;
    expect(held.signal?.aborted).toBe(true);
    expect(jobStatus('cheatsheet', 'm1')).toEqual({ state: 'error', message: JOB_TIMEOUT_MESSAGE });
    expect(isJobRunning('cheatsheet', 'm1')).toBe(false);
  });

  it('signing out stops every job quietly', async () => {
    const held = heldServer();
    const run = runJob('create', 'm1', async (begin, signal) => {
      begin();
      await postJson('/api/podcast/generate', {}, signal);
    }, 'Ошибка');
    await vi.waitFor(() => expect(held.signal).not.toBeNull());
    db.auth?.('TOKEN_REFRESHED');
    expect(held.signal?.aborted).toBe(false);
    db.auth?.('SIGNED_OUT');
    await run;
    expect(held.signal?.aborted).toBe(true);
    expect(jobStatus('create', 'm1')).toEqual({ state: 'idle' });
  });

  it('postJson: an aborted request is the job’s stop, not «нет связи»', async () => {
    heldServer();
    const controller = new AbortController();
    const request = postJson('/api/podcast/generate', {}, controller.signal);
    const reason = new Error('stopped');
    controller.abort(reason);
    await expect(request).rejects.toBe(reason);
  });
});
