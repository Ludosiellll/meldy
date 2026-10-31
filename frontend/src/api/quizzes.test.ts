import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc }, supabaseAnonKey: 'anon-key' }));

import { ContainerApiError } from './containers';
import { createQuiz, previewAsGuest, previewQuiz, quizCompare, quizErrorText, quizResults, sendAllMistakes, sendAnswers, startQuiz } from './quizzes';
import { QUIZ_ERRORS } from '../components/quiz/copyQuiz';

beforeEach(() => rpc.mockReset());

describe('api/quizzes', () => {
  it('calls the function by its name with p_ arguments', async () => {
    rpc.mockResolvedValue({ data: { id: 'q1', code: 'abcdefghjkmn' }, error: null, status: 200 });
    const row = await createQuiz('c1', { title: 'Контрольная', item_count: 20 });
    expect(rpc).toHaveBeenCalledWith('quiz_create', { p_container_id: 'c1', p_settings: { title: 'Контрольная', item_count: 20 } });
    expect(row.code).toBe('abcdefghjkmn');
  });

  it('gives the quiz refusals their own words', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'MC014', message: 'no attempts left', details: 'attempts' }, status: 400 });
    const error = await startQuiz('abcdefghjkmn', 'Иван').catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ContainerApiError);
    expect((error as ContainerApiError).code).toBe('MC014');
    expect((error as ContainerApiError).message).toBe(QUIZ_ERRORS.MC014_attempts);
    expect(quizErrorText('MC013', 'not_yet')).toBe(QUIZ_ERRORS.MC013_not_yet);
    expect(quizErrorText('MC012', null)).toBe(QUIZ_ERRORS.MC012);
  });

  it('keeps the container mapping for the rest (a gone quiz is P0002)', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'quiz not found' }, status: 500 });
    const error = await quizResults('q1').catch((caught: unknown) => caught);
    expect((error as ContainerApiError).code).toBe('P0002');
  });

  it('says network when the request throws', async () => {
    rpc.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    const error = await sendAnswers('a1', [{ item_id: 'i1', chosen: [0] }]).catch((caught: unknown) => caught);
    expect((error as ContainerApiError).code).toBe('network');
    // supabase-js answers a lost connection with an error object and status 0
    rpc.mockImplementation(async () => ({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 }));
    const second = await sendAnswers('a1', [{ item_id: 'i1', chosen: [0] }]).catch((caught: unknown) => caught);
    expect((second as ContainerApiError).code).toBe('network');
  });

  it('drops malformed rows of lists', async () => {
    rpc.mockResolvedValue({
      data: { quiz: { id: 'q1', code: 'x' }, server_now: '2026-10-16T10:00:00Z', attempts: [{ id: 'a1' }, null, 5], items: [{ item_id: 'i1' }, {}] },
      error: null,
    });
    const results = await quizResults('q1');
    expect(results.attempts).toHaveLength(1);
    expect(results.items).toHaveLength(1);
  });

  it('refuses a body of the wrong shape', async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(previewQuiz('x')).rejects.toBeInstanceOf(ContainerApiError);
  });
});

describe('previewAsGuest (a shared computer: the device’s attempts while signed in)', () => {
  it('reads quiz_preview with the token as a visitor without an account: the anon key as the bearer', async () => {
    const preview = { status: 'open', guests: true, me: { attempts_used: 1, results: [] } };
    const setHeader = vi.fn(async () => ({ data: preview, error: null, status: 200 }));
    rpc.mockReturnValue({ setHeader });
    await expect(previewAsGuest('abcd2fghjkmn', 't'.repeat(43))).resolves.toEqual(preview);
    expect(rpc).toHaveBeenCalledWith('quiz_preview', { p_code: 'abcd2fghjkmn', p_token: 't'.repeat(43) });
    expect(setHeader).toHaveBeenCalledWith('Authorization', 'Bearer anon-key');
  });

  it('a refusal comes as ContainerApiError; the other calls keep the session (no header set)', async () => {
    rpc.mockReturnValue({ setHeader: vi.fn(async () => ({ data: null, error: { code: '42501', message: 'denied' }, status: 401 })) });
    await expect(previewAsGuest('abcd2fghjkmn', 't'.repeat(43))).rejects.toBeInstanceOf(ContainerApiError);
    const setHeader = vi.fn();
    rpc.mockReturnValue(Object.assign(Promise.resolve({ data: { status: 'open' }, error: null, status: 200 }), { setHeader }));
    await previewQuiz('abcd2fghjkmn');
    expect(setHeader).not.toHaveBeenCalled();
  });
});

describe('release 49: the mistakes in batches, the comparison by id', () => {
  const batch = (over: Record<string, unknown>) => ({
    data: { people: 0, answers: 0, again: 0, clean: 0, learned: 0, outside: 0, guests: 2, practice: false, total: 120, left: 0, next: null, ...over },
    error: null,
    status: 200,
  });

  it('calls batch after batch from where the last one stopped, sums them and says how far it got', async () => {
    rpc
      .mockResolvedValueOnce(batch({ people: 50, answers: 60, left: 70, next: 'u50' }))
      .mockResolvedValueOnce(batch({ people: 48, answers: 50, learned: 2, outside: 2, left: 20, next: 'u100' }))
      .mockResolvedValueOnce(batch({ people: 19, answers: 19, again: 1, left: 0, next: null }));
    const seen: Array<[number, number]> = [];
    const sum = await sendAllMistakes('q1', (done, total) => seen.push([done, total]));
    expect(rpc.mock.calls.map((call) => call[1])).toEqual([
      { p_quiz_id: 'q1' },
      { p_quiz_id: 'q1', p_after: 'u50' },
      { p_quiz_id: 'q1', p_after: 'u100' },
    ]);
    expect(seen).toEqual([[50, 120], [100, 120], [120, 120]]);
    expect(sum).toMatchObject({ people: 117, answers: 129, again: 1, learned: 2, outside: 2, guests: 2, total: 120, next: null });
  });

  it('a failing batch stops the loop (what went before stays sent)', async () => {
    rpc.mockResolvedValueOnce(batch({ people: 50, answers: 50, left: 70, next: 'u50' }))
      .mockResolvedValueOnce({ data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' }, status: 500 });
    await expect(sendAllMistakes('q1')).rejects.toBeInstanceOf(ContainerApiError);
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it('quiz_compare: per question by id; malformed cells left out', async () => {
    rpc.mockResolvedValue({ data: { id: 'o1', title: '9Б', attempts: 12, capped: false, items: [['i1', 12, 3], [5, 1, 1], 'x'] }, error: null, status: 200 });
    expect(await quizCompare('q1', 'o1')).toEqual({ id: 'o1', title: '9Б', attempts: 12, capped: false, items: [['i1', 12, 3]] });
    expect(rpc).toHaveBeenCalledWith('quiz_compare', { p_quiz_id: 'q1', p_other: 'o1' });
  });
});
