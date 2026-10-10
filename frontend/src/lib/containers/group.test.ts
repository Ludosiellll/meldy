import { describe, expect, it } from 'vitest';
import { GROUP_MIN_MEMBERS, pickGroupQuestion, type GroupItemCounts } from './group.ts';

const base = { members: 12, confirmable: 0, relearn: 0, due: 0, unseen: 0, blocked: false };
const items: GroupItemCounts[] = [
  { ...base, rev: 'a', label: '12', topic: 1, confirmable: 5, relearn: 1 },
  { ...base, rev: 'b', label: '37', topic: 2, confirmable: 7 },
  { ...base, rev: 'c', label: '40', topic: 2, confirmable: 9, blocked: true },
  { ...base, rev: 'd', label: '51', topic: 3, relearn: 6, due: 2 },
];
const day = '2026-10-14';

describe('«Вопрос дня» (Concept 2 §3.15)', () => {
  it('picks what the most members can turn into «верно в два разных дня» today; never a blocked item', () => {
    const p = pickGroupQuestion({ day, items, recent: [], minGapDays: 14 });
    expect(p).toEqual({ rev: 'b', label: '37', reason: 'confirm', confirmable: 7, relearn: 0, due: 0, members: 12 });
  });

  it('skips items posted within minGapDays; an older post is fine again', () => {
    expect(pickGroupQuestion({ day, items, recent: [{ rev: 'b', day: '2026-10-05' }], minGapDays: 14 })?.rev).toBe('a');
    expect(pickGroupQuestion({ day, items, recent: [{ rev: 'b', day: '2026-09-29' }], minGapDays: 14 })?.rev).toBe('b');
  });

  it('then mistakes and due checks', () => {
    const p = pickGroupQuestion({ day, items: items.map((i) => ({ ...i, confirmable: 0 })), recent: [], minGapDays: 14 });
    expect(p?.rev).toBe('d');
    expect(p?.reason).toBe('relearn');
    const due = pickGroupQuestion({ day, items: [{ ...base, rev: 'e', label: '1', topic: 1, due: 3 }], recent: [], minGapDays: 14 });
    expect(due?.reason).toBe('due');
  });

  it('then not the same topic as the last post', () => {
    const tie: GroupItemCounts[] = [
      { ...base, rev: 'x', label: '1', topic: 1, relearn: 2 },
      { ...base, rev: 'y', label: '2', topic: 2, relearn: 2 },
      { ...base, rev: 'old', label: '3', topic: 1 },
    ];
    expect(pickGroupQuestion({ day, items: tie, recent: [{ rev: 'old', day: '2026-10-13' }], minGapDays: 14 })?.rev).toBe('y');
    const flipped = tie.map((i) => (i.rev === 'old' ? { ...i, topic: 2 } : i));
    expect(pickGroupQuestion({ day, items: flipped, recent: [{ rev: 'old', day: '2026-10-13' }], minGapDays: 14 })?.rev).toBe('x');
  });

  it('then the most members who have not seen it, then a stable hash of (rev, day)', () => {
    const fresh: GroupItemCounts[] = [
      { ...base, rev: 'p', label: '1', topic: null, unseen: 4 },
      { ...base, rev: 'q', label: '2', topic: null, unseen: 9 },
    ];
    expect(pickGroupQuestion({ day, items: fresh, recent: [], minGapDays: 14 })?.rev).toBe('q');
    const same: GroupItemCounts[] = Array.from({ length: 10 }, (_, i) => ({ ...base, rev: `r${i}`, label: String(i), topic: null, unseen: 3 }));
    const first = pickGroupQuestion({ day, items: same, recent: [], minGapDays: 14 });
    expect(pickGroupQuestion({ day, items: [...same].reverse(), recent: [], minGapDays: 14 })).toEqual(first);
    expect(first?.reason).toBe('new');
    const days = new Set(['2026-10-15', '2026-10-16', '2026-10-17', '2026-10-18', '2026-10-19']
      .map((d) => pickGroupQuestion({ day: d, items: same, recent: [], minGapDays: 14 })?.rev));
    expect(days.size).toBeGreaterThan(1);
  });

  it('needs at least two members, and returns null when nothing fits', () => {
    expect(GROUP_MIN_MEMBERS).toBe(2);
    expect(pickGroupQuestion({ day, items: [{ ...base, rev: 'z', label: '1', topic: 1, members: 1, confirmable: 1 }], recent: [], minGapDays: 14 })).toBeNull();
    expect(pickGroupQuestion({ day, items: [], recent: [], minGapDays: 14 })).toBeNull();
  });
});
