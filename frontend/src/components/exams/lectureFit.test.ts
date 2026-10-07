import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { LectureFit } from '../../api/exams';

const mocks = vi.hoisted(() => ({ fetchLectureFit: vi.fn() }));

vi.mock('../../lib/supabase', () => ({ supabase: {} }));
vi.mock('../../api/exams', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../api/exams')>();
  return { ...actual, fetchLectureFit: mocks.fetchLectureFit };
});

import {
  FIT_DEBOUNCE_MS,
  FIT_METHOD,
  FIT_TICK_HINT,
  fitCountText,
  fitQuestions,
  fitSummary,
  fitView,
  groupFitText,
  notCheckedText,
  questionList,
  unmatchedLines,
  useLectureFit,
  type FitQuestion,
} from './lectureFit';
import type { PreviewState } from './previewModel';

function fitResult(questions: string[][], skipped: LectureFit['skipped'] = []): LectureFit {
  const lectures = new Map<string, number[]>();
  questions.forEach((ids, index) => {
    for (const id of ids) lectures.set(id, [...(lectures.get(id) ?? []), index]);
  });
  return {
    questions,
    lectures,
    unmatched: questions.map((ids, index) => (ids.length === 0 ? index : -1)).filter((index) => index >= 0),
    skipped,
  };
}

describe('lectureFit: what is asked and what is shown', () => {
  it('asks about the questions with text, each with the number the list shows', () => {
    const state: PreviewState = {
      rows: [
        { key: 's', id: null, kind: 'section', label: '', text: 'Раздел 1', flags: [] },
        { key: 'a', id: null, kind: 'question', label: '9.', text: '  Программное   обеспечение ', flags: [] },
        { key: 'b', id: null, kind: 'question', label: '9', text: 'Системы счисления', flags: [] },
        { key: 'c', id: null, kind: 'question', label: '', text: 'аб', flags: [] },
        { key: 'd', id: null, kind: 'question', label: '', text: 'Магистраль', flags: [] },
      ],
      tickets: [],
    };
    expect(fitQuestions(state)).toEqual([
      { text: 'Программное обеспечение', number: '9' },
      { text: 'Системы счисления', number: '9' },
      { text: 'Магистраль', number: '4' },
    ]);
  });

  it('counts the fitting lectures in the picker order, names the questions without one once each', () => {
    const snapshot = {
      result: fitResult([['m2', 'm1'], [], ['m1'], [], ['m3']], [{ id: 'm9', reason: 'limit' }, { id: 'm8', reason: 'no_text' }]),
      numbers: ['1', '9', '3', '9', '5'],
    };
    const view = fitView(snapshot, ['m1', 'm2', 'm4', 'm9']);
    expect(Array.from(view.counts.entries())).toEqual([
      ['m1', 2],
      ['m2', 1],
    ]);
    expect(view.fitting).toEqual(['m1', 'm2']); // m3 is no longer in the list
    expect(view.unmatched).toEqual(['9']);
    expect(view.total).toBe(5);
    expect(view.strong).toBe(true);
    expect(view.notChecked).toBe(1);
    expect(fitView({ result: fitResult([['m1'], ['m2'], []]), numbers: ['1', '2', '3'] }, ['m1', 'm2']).strong).toBe(false);
  });

  it('says it in plain Russian', () => {
    expect([1, 2, 5, 11, 21, 22].map(fitCountText)).toEqual([
      'подходит к 1 вопросу',
      'подходит к 2 вопросам',
      'подходит к 5 вопросам',
      'подходит к 11 вопросам',
      'подходит к 21 вопросу',
      'подходит к 22 вопросам',
    ]);
    expect([1, 3, 5].map(groupFitText)).toEqual(['подходит 1 лекция', 'подходят 3 лекции', 'подходят 5 лекций']);
    expect(fitSummary(4)).toBe('К вопросам списка подходят 4 лекции.');
    expect(fitSummary(1)).toBe('К вопросам списка подходит 1 лекция.');
    expect(fitSummary(0)).toBe('Ни одна лекция не подходит к вопросам списка.');
    expect(FIT_METHOD).toBe('Meldy подбирает лекции по совпадению слов в вопросах и лекциях, без ИИ. Точнее покажет сверка.');
    expect(FIT_TICK_HINT).toBe('Отмечены лекции, которые подходят к вопросам списка. Лишние снимите, нужные отметьте.');
    expect(questionList(['9'])).toBe('вопрос 9');
    expect(questionList(['3', '7', '12'])).toBe('вопросы 3, 7 и 12');
    expect(questionList(Array.from({ length: 15 }, (_, index) => String(index + 1)))).toBe('вопросы 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 и ещё 3');
    expect(unmatchedLines([], 5)).toBeNull();
    expect(unmatchedLines(['9'], 18)).toEqual({
      lead: 'Без подходящей лекции: вопрос 9.',
      advice: 'Если лекция по нему есть, добавьте её — иначе сверка отметит, что его нет в лекциях.',
    });
    expect(unmatchedLines(['3', '7', '12'], 18)?.lead).toBe('Без подходящей лекции: вопросы 3, 7 и 12.');
    expect(unmatchedLines(['3', '7', '12'], 18)?.advice).toBe('Если лекции по ним есть, добавьте их — иначе сверка отметит, что их нет в лекциях.');
    expect(unmatchedLines(['1', '2'], 2)?.lead).toBe('Ни к одному вопросу не нашлось подходящей лекции.');
    expect(notCheckedText(3)).toBe('3 старые лекции не проверены: в библиотеке слишком много текста.');
    expect(notCheckedText(1)).toBe('1 старая лекция не проверена: в библиотеке слишком много текста.');
  });
});

describe('useLectureFit: debounced, the latest list wins, the last answer stays on screen', () => {
  const ask = (texts: string[]): FitQuestion[] => texts.map((text, index) => ({ text, number: String(index + 1) }));

  beforeEach(() => {
    vi.useFakeTimers();
    mocks.fetchLectureFit.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('asks once the list stops changing, with the latest questions, and cancels the older request', async () => {
    mocks.fetchLectureFit.mockImplementation(async (input: { questions: string[] }) => fitResult(input.questions.map(() => ['m1'])));
    const { result, rerender } = renderHook(({ questions, ids }) => useLectureFit(questions, ids, true), {
      initialProps: { questions: ask(['Инфляция']), ids: ['m1'] },
    });
    expect(result.current.status).toBe('loading');
    await act(async () => {
      vi.advanceTimersByTime(FIT_DEBOUNCE_MS - 100);
    });
    expect(mocks.fetchLectureFit).not.toHaveBeenCalled();
    // Another edit within the pause starts the wait again: one request, with the edited list.
    rerender({ questions: ask(['Инфляция', 'Безработица']), ids: ['m1'] });
    await act(async () => {
      vi.advanceTimersByTime(FIT_DEBOUNCE_MS - 100);
    });
    expect(mocks.fetchLectureFit).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    expect(mocks.fetchLectureFit).toHaveBeenCalledTimes(1);
    expect(mocks.fetchLectureFit.mock.calls[0][0]).toEqual({ questions: ['Инфляция', 'Безработица'], materialIds: ['m1'] });
    expect(result.current.status).toBe('ready');
    expect(result.current.snapshot?.numbers).toEqual(['1', '2']);

    // A newer list: the old answer stays while the new one loads; the request in flight is cancelled by the next one.
    let release: (value: LectureFit) => void = () => {};
    mocks.fetchLectureFit.mockImplementationOnce(
      (_input: unknown, signal: AbortSignal) =>
        new Promise<LectureFit>((resolve, reject) => {
          release = resolve;
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    rerender({ questions: ask(['Инфляция']), ids: ['m1'] });
    await act(async () => {
      vi.advanceTimersByTime(FIT_DEBOUNCE_MS);
    });
    expect(result.current.status).toBe('loading');
    expect(result.current.snapshot?.numbers).toEqual(['1', '2']);
    const firstSignal = mocks.fetchLectureFit.mock.calls[1][1] as AbortSignal;
    rerender({ questions: ask(['Инфляция', 'Кривая Филлипса']), ids: ['m1', 'm2'] });
    expect(firstSignal.aborted).toBe(true);
    release(fitResult([['m1']]));
    await act(async () => {
      vi.advanceTimersByTime(FIT_DEBOUNCE_MS);
    });
    expect(mocks.fetchLectureFit).toHaveBeenCalledTimes(3);
    expect(result.current.snapshot?.numbers).toEqual(['1', '2']);
    expect(result.current.snapshot?.result.questions).toEqual([['m1'], ['m1']]);
  });

  it('keeps the last answer when a newer request fails, retries on demand, forgets it when switched off', async () => {
    mocks.fetchLectureFit.mockResolvedValueOnce(fitResult([['m1']]));
    const { result, rerender } = renderHook(({ questions, enabled }) => useLectureFit(questions, ['m1'], enabled), {
      initialProps: { questions: ask(['Инфляция']), enabled: true },
    });
    await act(async () => {
      vi.advanceTimersByTime(FIT_DEBOUNCE_MS);
    });
    expect(result.current.status).toBe('ready');

    mocks.fetchLectureFit.mockRejectedValueOnce(new Error('429'));
    rerender({ questions: ask(['Инфляция и безработица']), enabled: true });
    await act(async () => {
      vi.advanceTimersByTime(FIT_DEBOUNCE_MS);
    });
    expect(result.current.status).toBe('error');
    expect(result.current.snapshot?.result.questions).toEqual([['m1']]);

    mocks.fetchLectureFit.mockResolvedValueOnce(fitResult([[]]));
    act(() => result.current.retry());
    // «Повторить» does not wait for the pause.
    await act(async () => {
      vi.advanceTimersByTime(0);
    });
    expect(mocks.fetchLectureFit).toHaveBeenCalledTimes(3);
    expect(result.current.status).toBe('ready');
    expect(result.current.snapshot?.result.unmatched).toEqual([0]);

    rerender({ questions: ask(['Инфляция и безработица']), enabled: false });
    expect(result.current.status).toBe('idle');
    expect(result.current.snapshot).toBeNull();
    await act(async () => {
      vi.advanceTimersByTime(FIT_DEBOUNCE_MS * 2);
    });
    expect(mocks.fetchLectureFit).toHaveBeenCalledTimes(3);
  });

  it('asks nothing without questions or without lectures', async () => {
    const { result, rerender } = renderHook(({ questions, ids }) => useLectureFit(questions, ids, true), {
      initialProps: { questions: [] as FitQuestion[], ids: ['m1'] },
    });
    rerender({ questions: ask(['Инфляция']), ids: [] });
    await act(async () => {
      vi.advanceTimersByTime(FIT_DEBOUNCE_MS * 2);
    });
    expect(mocks.fetchLectureFit).not.toHaveBeenCalled();
    expect(result.current.status).toBe('idle');
  });
});
