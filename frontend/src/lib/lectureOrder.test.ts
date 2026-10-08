import { describe, expect, it } from 'vitest';
import { orderExamLectures } from './lectureOrder';

const created: Record<string, string> = {
  rel: '2026-09-01T10:00:00Z',
  sql: '2026-09-03T10:00:00Z',
  norm: '2026-09-05T10:00:00Z',
};
const createdAtOf = (id: string) => created[id];

describe('the order of an exam’s lectures (finding LIB-7)', () => {
  it('goes by the time a lecture was added to the exam', () => {
    const links = [
      { id: 'norm', addedAt: '2026-10-01T12:00:00Z' },
      { id: 'rel', addedAt: '2026-10-01T10:00:00Z' },
      { id: 'sql', addedAt: '2026-10-01T11:00:00Z' },
    ];
    expect(orderExamLectures(links, createdAtOf).map((link) => link.id)).toEqual(['rel', 'sql', 'norm']);
  });

  it('puts lectures added together in the order they were uploaded, whatever order the rows came in', () => {
    const together = '2026-10-01T10:00:00Z';
    const links = [
      { id: 'norm', addedAt: together },
      { id: 'sql', addedAt: together },
      { id: 'rel', addedAt: together },
    ];
    expect(orderExamLectures(links, createdAtOf).map((link) => link.id)).toEqual(['rel', 'sql', 'norm']);
    expect(orderExamLectures([...links].reverse(), createdAtOf).map((link) => link.id)).toEqual(['rel', 'sql', 'norm']);
  });

  it('keeps the order it was given when nothing else tells the lectures apart, and each lecture once', () => {
    const links = [{ id: 'b' }, { id: 'a', addedAt: 'не дата' }, { id: 'b', addedAt: '2026-10-01T10:00:00Z' }, { id: 'c', addedAt: null }];
    const ordered = orderExamLectures(links, () => undefined);
    expect(ordered.map((link) => link.id)).toEqual(['b', 'a', 'c']);
    // The first link of a lecture is the one kept, and the list it was given stays as it was.
    expect(ordered[0]).toBe(links[0]);
    expect(links.map((link) => link.id)).toEqual(['b', 'a', 'b', 'c']);
  });
});
