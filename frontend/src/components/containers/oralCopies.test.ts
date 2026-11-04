import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import summaryJson from '../../../../contracts/container/summary.json';
import type { ContainerSummary } from '../../types/container';

const api = vi.hoisted(() => ({ oralSync: vi.fn() }));
vi.mock('../../api/containers', () => ({ oralSync: api.oralSync }));

import { askedRecently, markOralAsked, missingOral, ORAL_COPIES, resetOralCopiesForTests, useOralCopies } from './oralCopies';

const SUMMARY = summaryJson as unknown as ContainerSummary;
// A member whose copy of the oral subject never came (the link had closed before the oral-sync of the join).
const ORAL_SUBJECT = SUMMARY.subjects.find((subject) => subject.oral)!;
const MEMBER: ContainerSummary = {
  ...SUMMARY,
  role: 'member',
  owner: null,
  subjects: SUMMARY.subjects.map((subject) => (subject.id === ORAL_SUBJECT.id ? { ...subject, oral: { exam_id: null, questions: 0 } } : subject)),
};

beforeEach(() => {
  resetOralCopiesForTests();
  api.oralSync.mockReset();
});
afterEach(() => cleanup());

describe('a member’s oral subjects without a copy (audit of 04.11)', () => {
  it('only a member’s oral subject without their copy is missing', () => {
    expect(missingOral(MEMBER).map((subject) => subject.id)).toEqual([ORAL_SUBJECT.id]);
    expect(missingOral(SUMMARY)).toEqual([]);
    expect(missingOral({ ...MEMBER, subjects: SUMMARY.subjects })).toEqual([]);
  });

  it('the page asks for the copy once; a copy made reads the exam again', async () => {
    api.oralSync.mockResolvedValue({ container_id: MEMBER.id, oral: [{ subject_id: ORAL_SUBJECT.id, status: 'copied', exam_id: 'e-1' }] });
    const reload = vi.fn();
    const { result, rerender } = renderHook(({ summary }) => useOralCopies(summary, reload), { initialProps: { summary: MEMBER } });
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(api.oralSync).toHaveBeenCalledWith(MEMBER.id);
    expect(result.current.closed).toEqual([]);
    // The page reads its summary again: the copy is there, nothing is asked twice.
    rerender({ summary: { ...MEMBER, subjects: SUMMARY.subjects } });
    expect(api.oralSync).toHaveBeenCalledTimes(1);
  });

  it('every link shut: the subject is named and the way on is said, with no loop of calls', async () => {
    api.oralSync.mockResolvedValue({ container_id: MEMBER.id, oral: [{ subject_id: ORAL_SUBJECT.id, status: 'closed' }] });
    const reload = vi.fn();
    const { result, rerender } = renderHook(({ summary }) => useOralCopies(summary, reload), { initialProps: { summary: MEMBER } });
    await waitFor(() => expect(result.current.closed).toEqual([ORAL_SUBJECT.title]));
    expect(result.current.line).toBe(ORAL_COPIES.closed([ORAL_SUBJECT.title]));
    expect(reload).not.toHaveBeenCalled();
    rerender({ summary: { ...MEMBER } });
    expect(api.oralSync).toHaveBeenCalledTimes(1);
  });

  it('the author, or a member with every copy, asks nothing; a failure says nothing', async () => {
    renderHook(() => useOralCopies(SUMMARY, vi.fn()));
    renderHook(() => useOralCopies({ ...MEMBER, subjects: SUMMARY.subjects }, vi.fn()));
    expect(api.oralSync).not.toHaveBeenCalled();
    api.oralSync.mockRejectedValue(new Error('network'));
    const { result } = renderHook(() => useOralCopies(MEMBER, vi.fn()));
    await waitFor(() => expect(api.oralSync).toHaveBeenCalledTimes(1));
    expect(result.current.line).toBeNull();
  });

  it('a join that just asked (/g/<code>) counts: the exam page does not ask again at once (review of 04.11)', async () => {
    expect(askedRecently(MEMBER.id)).toBe(false);
    markOralAsked(MEMBER.id);
    expect(askedRecently(MEMBER.id)).toBe(true);
    renderHook(() => useOralCopies(MEMBER, vi.fn()));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(api.oralSync).not.toHaveBeenCalled();
  });

  it('the words: one subject by name, several by count', () => {
    expect(ORAL_COPIES.closed(['Сети'])).toBe('Устные вопросы по предмету «Сети» не пришли: ссылка экзамена больше не работает. Попросите автора открыть её снова.');
    expect(ORAL_COPIES.closed(['Сети', 'Базы'])).toBe('Устные вопросы по 2\u00a0предметам не пришли: ссылка экзамена больше не работает. Попросите автора открыть её снова.');
  });
});
