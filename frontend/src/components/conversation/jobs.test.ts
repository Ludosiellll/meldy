import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  row: null as null | { summary_json: Record<string, unknown>; original_text: string },
  updates: [] as Array<Record<string, unknown>>,
  updatedRows: 1,
  error: null as null | { message: string },
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
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
import { isJobRunning, jobStatus, publishLines, resetJobsForTests, runJob, useLinesFeed } from './jobs';
import { ConversationError, NOT_OWNER_MESSAGE, patchSummaryJson, saveCheatsheet, saveConversationLines } from './persistence';

describe('patchSummaryJson', () => {
  beforeEach(() => {
    db.row = { summary_json: { content: 'Конспект', podcast: [{ speaker: 'Макс', text: 'Привет' }], _startTab: 'podcast' }, original_text: '' };
    db.updates = [];
    db.updatedRows = 1;
    db.error = null;
  });

  it('re-reads summary_json and changes only the given key', async () => {
    // Пока шла шпаргалка, в другой вкладке сохранили разговор: он должен остаться.
    await saveCheatsheet('m1', '# Шпаргалка');
    expect(db.updates).toEqual([
      { summary_json: { content: 'Конспект', podcast: [{ speaker: 'Макс', text: 'Привет' }], cheatsheet: '# Шпаргалка' } },
    ]);
    await saveConversationLines('m1', [{ speaker: 'Софья', text: 'Новый' }]);
    expect(db.updates[1]).toEqual({ summary_json: { content: 'Конспект', podcast: [{ speaker: 'Софья', text: 'Новый' }] } });
  });

  it('fails instead of pretending to save someone else’s material', async () => {
    db.updatedRows = 0;
    await expect(patchSummaryJson('m1', { cheatsheet: 'x' })).rejects.toThrow(NOT_OWNER_MESSAGE);
    db.updatedRows = 1;
    db.error = { message: 'network' };
    await expect(saveCheatsheet('m1', 'x')).rejects.toThrow('Не удалось сохранить шпаргалку. Попробуйте ещё раз.');
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
    }, 'Не удалось создать шпаргалку. Попробуйте ещё раз.');
    expect(jobStatus('cheatsheet', 'm1')).toEqual({ state: 'error', message: 'Не удалось создать шпаргалку. Попробуйте ещё раз.' });
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
