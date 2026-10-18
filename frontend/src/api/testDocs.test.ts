import { beforeEach, describe, expect, it, vi } from 'vitest';

const rpc = vi.hoisted(() => vi.fn());
vi.mock('../lib/supabase', () => ({ supabase: { rpc }, supabaseAnonKey: 'anon-key' }));

import { ContainerApiError } from './containers';
import { STALE_CODE, STALE_TEXT, fetchTestDoc, isStale, refusedRule, saveTestDoc } from './testDocs';
import { emptyDoc } from '../lib/studio/doc';

const EXAM = '11111111-2222-4333-8444-555555555555';

beforeEach(() => rpc.mockReset());

describe('api/testDocs: test_doc_get', () => {
  it('asks by the exam and gives the stored page as it came, with its revision', async () => {
    const doc = { v: 1, title: 'Химия', extra: 'kept as stored' };
    rpc.mockResolvedValue({ data: { container_id: EXAM, doc, rev: 3, updated_at: '2026-10-18T10:00:00Z' }, error: null, status: 200 });
    const row = await fetchTestDoc(EXAM);
    expect(rpc).toHaveBeenCalledWith('test_doc_get', { p_container_id: EXAM });
    expect(row).toEqual({ container_id: EXAM, doc, rev: 3, updated_at: '2026-10-18T10:00:00Z' });
  });

  it('null: the exam has no page yet', async () => {
    rpc.mockResolvedValue({ data: null, error: null, status: 200 });
    await expect(fetchTestDoc(EXAM)).resolves.toBeNull();
  });

  it('refuses a body of the wrong shape (no doc, a revision that is not a whole number from 1)', async () => {
    rpc.mockResolvedValue({ data: { rev: 1 }, error: null });
    await expect(fetchTestDoc(EXAM)).rejects.toBeInstanceOf(ContainerApiError);
    rpc.mockResolvedValue({ data: { doc: {}, rev: 0 }, error: null });
    await expect(fetchTestDoc(EXAM)).rejects.toBeInstanceOf(ContainerApiError);
    rpc.mockResolvedValue({ data: [], error: null });
    await expect(fetchTestDoc(EXAM)).rejects.toBeInstanceOf(ContainerApiError);
  });

  it('an exam that is not the caller’s is P0002', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: 'P0002', message: 'container not found', details: 'container' }, status: 500 });
    const error = await fetchTestDoc(EXAM).catch((caught: unknown) => caught);
    expect((error as ContainerApiError).code).toBe('P0002');
  });
});

describe('api/testDocs: test_doc_save', () => {
  it('sends the page with the revision it was read at and gives the new one', async () => {
    const doc = emptyDoc('Химия');
    rpc.mockResolvedValue({ data: { rev: 1, updated_at: '2026-10-18T10:00:01Z' }, error: null, status: 200 });
    await expect(saveTestDoc(EXAM, doc, 0)).resolves.toEqual({ rev: 1, updated_at: '2026-10-18T10:00:01Z' });
    expect(rpc).toHaveBeenCalledWith('test_doc_save', { p_container_id: EXAM, p_doc: doc, p_rev: 0 });
  });

  it('MC020: another tab saved first — its own words, isStale', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: STALE_CODE, message: 'stale', details: 'stale' }, status: 400 });
    const error = await saveTestDoc(EXAM, emptyDoc('Химия'), 2).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ContainerApiError);
    expect((error as ContainerApiError).code).toBe(STALE_CODE);
    expect((error as ContainerApiError).message).toBe(STALE_TEXT);
    expect(isStale(error)).toBe(true);
    expect(refusedRule(error)).toBeNull();
  });

  it('22023: the rule the server named', async () => {
    rpc.mockResolvedValue({ data: null, error: { code: '22023', message: 'invalid document', details: 'block:3:text' }, status: 400 });
    const error = await saveTestDoc(EXAM, emptyDoc('Химия'), 1).catch((caught: unknown) => caught);
    expect(refusedRule(error)).toBe('block:3:text');
    expect(isStale(error)).toBe(false);
  });

  it('says network when the request throws or comes back with no answer', async () => {
    rpc.mockImplementation(async () => {
      throw new TypeError('Failed to fetch');
    });
    const first = await saveTestDoc(EXAM, emptyDoc('Химия'), 1).catch((caught: unknown) => caught);
    expect((first as ContainerApiError).code).toBe('network');
    rpc.mockImplementation(async () => ({ data: null, error: { message: 'TypeError: Failed to fetch', code: '' }, status: 0 }));
    const second = await saveTestDoc(EXAM, emptyDoc('Химия'), 1).catch((caught: unknown) => caught);
    expect((second as ContainerApiError).code).toBe('network');
  });

  it('refuses an answer without a revision', async () => {
    rpc.mockResolvedValue({ data: { updated_at: 'x' }, error: null });
    await expect(saveTestDoc(EXAM, emptyDoc('Химия'), 1)).rejects.toBeInstanceOf(ContainerApiError);
  });
});
