import { describe, expect, it } from 'vitest';
import summaryJson from '../../../../../contracts/container/summary.json';
import type { ContainerSummary } from '../../../types/container';
import { byNewest, canExtend, extendedEnd, lastExamDay, linkState, localDayOf, type ExamLink } from './links';

const SUMMARY = summaryJson as unknown as ContainerSummary;
const DAY = 86_400_000;
const NOW = Date.parse('2026-11-04T10:00:00Z');
const LINK: ExamLink = { id: 'l1', created_at: '2026-10-14T10:00:00Z', expires_at: '2027-02-11T17:03:59Z', revoked_at: null, members: 19, max_members: 60, oral: 0 };
const dated = (exam: string | null, subjects: Array<string | null>): ContainerSummary => ({
  ...SUMMARY,
  exam_date: exam,
  own_exam_date: null,
  author_exam_date: exam,
  subjects: SUMMARY.subjects.slice(0, subjects.length).map((subject, index) => ({ ...subject, exam_date: subjects[index] })),
});

describe('the links of an exam (20261107090200)', () => {
  it('a link is open until it is closed or its end passes', () => {
    expect(linkState(LINK, NOW)).toBe('open');
    expect(linkState({ ...LINK, expires_at: null }, NOW)).toBe('open');
    expect(linkState({ ...LINK, expires_at: '2026-11-04T10:00:00Z' }, NOW)).toBe('expired');
    expect(linkState({ ...LINK, revoked_at: '2026-11-03T14:21:08Z', expires_at: '2026-11-01T00:00:00Z' }, NOW)).toBe('revoked');
  });

  it('newest first', () => {
    const older = { ...LINK, id: 'l0', created_at: '2026-10-01T10:00:00Z' };
    expect(byNewest([older, LINK]).map((link) => link.id)).toEqual(['l1', 'l0']);
  });

  it('the end of «Продлить»: the later of 120 days and 30 days after the last date of the exam and its subjects', () => {
    expect(extendedEnd(dated('2026-11-09', ['2026-11-09', null]), NOW)).toBe(NOW + 120 * DAY);
    expect(extendedEnd(dated(null, [null, null]), NOW)).toBe(NOW + 120 * DAY);
    expect(extendedEnd(dated('2026-11-09', ['2027-06-01', null]), NOW)).toBe(Date.parse('2027-07-01T00:00:00Z'));
    expect(lastExamDay(dated('2027-01-12', ['2027-01-20', '2027-01-16']))).toBe('2027-01-20');
    // With the author's own date the summary's dates are that one: only the exam's common date counts.
    expect(lastExamDay({ ...dated('2027-05-01', ['2027-05-01']), own_exam_date: '2027-05-01', author_exam_date: '2027-01-12' })).toBe('2027-01-12');
  });

  it('«Продлить» only for an open link it moves by a day or more', () => {
    const summary = dated('2026-11-09', ['2026-11-09', null]);
    expect(canExtend({ ...LINK, expires_at: new Date(NOW + 5 * DAY).toISOString() }, summary, NOW)).toBe(true);
    expect(canExtend({ ...LINK, expires_at: new Date(NOW + 119.5 * DAY).toISOString() }, summary, NOW)).toBe(false);
    // The owner's links of 04.11 end on 11 February: 120 days from 4 November is later.
    expect(canExtend(LINK, summary, NOW)).toBe(true);
    expect(canExtend({ ...LINK, expires_at: '2099-01-01T00:00:00Z' }, summary, NOW)).toBe(false);
    expect(canExtend({ ...LINK, expires_at: null }, summary, NOW)).toBe(false);
    expect(canExtend({ ...LINK, revoked_at: '2026-11-03T14:21:08Z' }, summary, NOW)).toBe(false);
  });

  it('the local day of a moment; nothing for a missing or broken one', () => {
    expect(localDayOf('2026-10-14T10:00:00Z')).toMatch(/^2026-10-1[45]$/);
    expect(localDayOf(null)).toBeNull();
    expect(localDayOf('вчера')).toBeNull();
  });
});
