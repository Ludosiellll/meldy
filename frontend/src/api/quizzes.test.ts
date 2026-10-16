import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }));

import { ContainerApiError } from './containers';
import { createQuiz, previewQuiz, quizErrorText, quizResults, sendAnswers, startQuiz } from './quizzes';
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
