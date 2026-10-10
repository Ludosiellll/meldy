import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AnswerInput, Pace, PlanInputsWire, PlanItem } from '../../types/container';
import wireJson from '../../../../contracts/container/plan_inputs.json';

/**
 * Package D2 owns the day arithmetic (time.ts) and the pace blend (pace.ts); until it lands they are stubs. These
 * stand-ins keep their contracts: calendar days of a 'YYYY-MM-DD' key, the local day of a moment in a zone, and
 * one Pace per subject index.
 */
const d2 = vi.hoisted(() => ({
  paceFrom: vi.fn(),
}));
vi.mock('./time', () => ({
  addDays: (day: string, n: number) => {
    const [y, m, d] = day.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
  },
  localDay: (ms: number, tz: string) =>
    new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(ms),
}));
vi.mock('./pace', () => ({ paceFrom: d2.paceFrom }));

import { decodePlanInputs, unitFromRow, type DecodeOptions } from './planInputs';

const wire = wireJson as unknown as PlanInputsWire;
const C1 = 'f4881273-7331-4c39-96d7-f2ce4a31a1c0';
const [S1, S2, S3] = wire.subjects.map((subject) => subject.id);
const TZ = 'Europe/Minsk';
const NOW = wire.now * 1000; // 2026-12-21 18:41:30 in Minsk

function pace(tag: number): Pace {
  return { tNew: tag, tRev: 20, tWrong: 10, tRetry: 12, tSC: 60, tAC: 150, pWrong: { new: 0.5, relearn: 0.35, confirm: 0.15, check: 0.15, final: 0.2 } };
}

function options(overrides: Partial<DecodeOptions> = {}): DecodeOptions {
  return { containerId: C1, tz: TZ, now: NOW, pending: [], oral: [], ...overrides };
}

const item = (input: ReturnType<typeof decodePlanInputs>, id: string) => input.items.find((entry) => entry.id === id)!;

beforeEach(() => {
  d2.paceFrom.mockImplementation((_rows: PlanInputsWire['pace'], count: number) => Array.from({ length: count }, (_unused, index) => pace(100 + index)));
});

describe('decodePlanInputs against contracts/container/plan_inputs.json', () => {
  it('gives the container’s budget, first day, subjects with their test dates, and today', () => {
    const input = decodePlanInputs(wire, options());
    expect(input).toMatchObject({ v: 1, now: NOW, tz: TZ, containerId: C1, budgetMin: 45, firstPlanDay: '2026-12-14' });
    expect(input.subjects).toEqual([
      { id: S1, title: 'Основы программирования', date: '2027-01-12' },
      { id: S2, title: 'История Беларуси', date: '2027-01-16' },
      { id: S3, title: 'Основы программирования · билеты', date: '2027-01-20' },
    ]);
    expect(input.today).toEqual({ firstAt: 1797867065000, doneSec: 119, newDone: { [S1]: 0, [S2]: 1, [S3]: 0 } });
    expect(input.ai).toEqual({ left: 96, resetsAt: 1797897600000 });
  });

  it('turns item tuples into test plan items: subject id, topic, order, slow', () => {
    const input = decodePlanInputs(wire, options());
    expect(input.items).toHaveLength(18);
    expect(input.items.every((entry) => entry.f === 't')).toBe(true);
    expect(input.items.map((entry) => entry.id)).toEqual(wire.items.map((row) => row[0]));
    expect(input.items[0]).toMatchObject({ id: wire.items[0][0], s: S1, tp: 1, o: 1 });
    expect(input.items[0].slow).toBeUndefined();
    expect(input.items[1].slow).toBe(1); // code
    expect(input.items[14]).toMatchObject({ s: S2, tp: 1, o: 3, slow: 1 }); // several correct
    expect(input.items.filter((entry) => entry.slow === 1)).toHaveLength(wire.items.filter((row) => row[6] === 1).length);
  });

  it('turns state tuples into UnitStates: day offsets into local days, epoch seconds into ms', () => {
    const input = decodePlanInputs(wire, options());
    // [0, 3, 0, -7, 0, 0, -7, 1797264605, 1797348610, 1797867065, 1, null, 0, 1797867065]
    expect(item(input, wire.items[0][0]).u).toEqual({
      seen: 3, wrong: 0, firstDay: '2026-12-14', lastDay: '2026-12-21', seriesAt: 1797264605000, seriesDay: '2026-12-14',
      twoDaysAt: 1797348610000, namedAt: 1797867065000, checks: 1, peekDay: null, wasTwoDays: false, cleanOkAt: 1797867065000,
    });
    // [7, 4, 2, -7, 0, 1, null, null, null, null, 0, 0, 1, 1797434430]: a miss today, it was in the figure before
    expect(item(input, wire.items[7][0]).u).toEqual({
      seen: 4, wrong: 2, firstDay: '2026-12-14', lastDay: '2026-12-21', seriesAt: null, seriesDay: null, twoDaysAt: null,
      namedAt: null, checks: 0, peekDay: '2026-12-21', wasTwoDays: true, cleanOkAt: 1797434430000,
    });
    // [16, 2, 2, -6, -3, 2, …]: «Не знаю» three days ago, never a clean answer
    expect(item(input, wire.items[16][0]).u).toMatchObject({ firstDay: '2026-12-15', lastDay: '2026-12-18', peekDay: '2026-12-18', cleanOkAt: null });
  });

  it('an item without a state is new', () => {
    const input = decodePlanInputs(wire, options());
    expect(wire.states.some((row) => row[0] === 11)).toBe(false);
    expect(item(input, wire.items[11][0]).u).toEqual({
      seen: 0, wrong: 0, firstDay: null, lastDay: null, seriesAt: null, seriesDay: null, twoDaysAt: null, namedAt: null,
      checks: 0, peekDay: null, wasTwoDays: false, cleanOkAt: null,
    });
  });

  it('every state of the sample decodes to the same day the server meant', () => {
    for (const row of wire.states) {
      const unit = unitFromRow(row, wire.day);
      if (row[3] !== null) expect(unit.firstDay).toBe(new Date(Date.UTC(2026, 11, 21 + row[3])).toISOString().slice(0, 10));
      if (row[8] !== null) expect(unit.twoDaysAt).toBe(row[8] * 1000);
    }
  });

  it('takes the pace from paceFrom (package D2) per subject id', () => {
    const input = decodePlanInputs(wire, options());
    expect(d2.paceFrom).toHaveBeenCalledWith(wire.pace, 3);
    expect(input.pace).toEqual({ [S1]: pace(100), [S2]: pace(101), [S3]: pace(102) });
  });

  it('without pace rows of its own subjects the plan takes the defaults (null)', () => {
    const input = decodePlanInputs({ ...wire, pace: [], pace_day: [] }, options());
    expect(input.pace).toBeNull();
    expect(input.paceDay).toBeNull();
    expect(d2.paceFrom).not.toHaveBeenCalled();
  });

  it('gives the day as it began: the pace before today’s first answer and the day’s start of each item answered today', () => {
    const input = decodePlanInputs(wire, options());
    expect(d2.paceFrom).toHaveBeenCalledWith(wire.pace_day, 3);
    expect(input.paceDay).toEqual({ [S1]: pace(100), [S2]: pace(101), [S3]: pace(102) });
    // seven items answered today were seen before: the state each began the day with, by item id
    expect(Object.keys(input.dayStart ?? {}).sort()).toEqual([0, 3, 5, 6, 7, 8, 14].map((index) => wire.items[index][0]).sort());
    // [0, 2, 0, -7, -6, 0, -7, …]: «верно в два разных дня» since 15 December, its check due today
    expect(input.dayStart?.[wire.items[0][0]]).toEqual({
      seen: 2, wrong: 0, firstDay: '2026-12-14', lastDay: '2026-12-15', seriesAt: 1797264605000, seriesDay: '2026-12-14',
      twoDaysAt: 1797348610000, namedAt: 1797348610000, checks: 0, peekDay: null, wasTwoDays: false, cleanOkAt: 1797348610000,
    });
    // the question first answered today began it unseen: nothing to say about it
    expect(input.dayStart?.[wire.items[17][0]]).toBeUndefined();
  });

  it('an older server sends neither: the plan then freezes the day as before', () => {
    const { pace_day: _paceDay, day_start: _dayStart, ...older } = wire;
    const input = decodePlanInputs(older, options());
    expect('paceDay' in input).toBe(false);
    expect('dayStart' in input).toBe(false);
  });

  it('adds the oral questions of its own subjects', () => {
    const oral: PlanItem[] = [
      { id: 'oral-1', s: S3, f: 'o', tp: null, o: 1, l: [], m: { sc: null, rating: 0, ac: null, prepared: false } },
      { id: 'oral-x', s: 'another-subject', f: 'o', tp: null, o: 1, l: [], m: { sc: null, rating: 0, ac: null, prepared: false } },
    ];
    const input = decodePlanInputs(wire, options({ oral }));
    expect(input.items).toHaveLength(19);
    expect(input.items[18]).toBe(oral[0]);
  });

  it('refuses a container the wire does not hold', () => {
    expect(() => decodePlanInputs(wire, options({ containerId: 'missing' }))).toThrow(/no container/);
  });
});

describe('answers waiting in the offline queue count as answered today', () => {
  const pendingFor = (index: number, extra: Partial<AnswerInput> = {}): AnswerInput => ({
    client_event_id: `offline:${index}`, item_id: wire.items[index][0], chosen: 0, local_date: '2026-12-21', ms: 30_000, ...extra,
  });

  it('a new question is no longer new: today is its first and last day, and it takes one of the day’s new questions', () => {
    const input = decodePlanInputs(wire, options({ pending: [pendingFor(11)] }));
    expect(item(input, wire.items[11][0]).u).toMatchObject({ firstDay: '2026-12-21', lastDay: '2026-12-21', seen: 0 });
    expect(input.today.newDone).toEqual({ [S1]: 1, [S2]: 1, [S3]: 0 });
    expect(input.today.doneSec).toBe(119 + 30);
  });

  it('a question seen before is answered today: nothing else of its state moves (the rule runs only in SQL)', () => {
    const before = decodePlanInputs(wire, options());
    const input = decodePlanInputs(wire, options({ pending: [pendingFor(9), pendingFor(9, { client_event_id: 'offline:9b', retry: true, ms: 400_000 })] }));
    const unit = item(input, wire.items[9][0]).u!;
    expect(unit).toEqual({ ...item(before, wire.items[9][0]).u, lastDay: '2026-12-21' });
    expect(input.today.newDone).toEqual(before.today.newDone);
    // Each answer's time counts, capped at 180 s like the server's.
    expect(input.today.doneSec).toBe(119 + 30 + 180);
  });

  it('mock answers and answers to other items change nothing but the item', () => {
    const input = decodePlanInputs(wire, options({ pending: [pendingFor(12, { mode: 'mock' }), { client_event_id: 'x:1', item_id: 'unknown', chosen: 0 }] }));
    expect(item(input, wire.items[12][0]).u?.lastDay).toBe('2026-12-21');
    expect(input.today.doneSec).toBe(119);
  });

  it('a question answered only in the queue began the day in the server’s state; one the server saw today keeps the server’s start', () => {
    const before = decodePlanInputs(wire, options());
    const input = decodePlanInputs(wire, options({ pending: [pendingFor(9), pendingFor(0), pendingFor(11)] }));
    expect(input.dayStart?.[wire.items[9][0]]).toEqual(item(before, wire.items[9][0]).u);
    expect(input.dayStart?.[wire.items[0][0]]).toEqual(before.dayStart?.[wire.items[0][0]]);
    // a new question began the day unseen
    expect(input.dayStart?.[wire.items[11][0]]).toBeUndefined();
  });

  it('the decoded wire is never changed in place', () => {
    const copy = JSON.parse(JSON.stringify(wire));
    const first = decodePlanInputs(wire, options({ pending: [pendingFor(11)] }));
    expect(wire).toEqual(copy);
    const second = decodePlanInputs(wire, options());
    expect(item(second, wire.items[11][0]).u?.firstDay).toBeNull();
    expect(item(first, wire.items[11][0]).u?.firstDay).toBe('2026-12-21');
  });
});

describe('a wire of an earlier day (read before midnight, or kept on the device)', () => {
  it('keeps every state and starts today from zero', () => {
    const tomorrow = NOW + 24 * 3600 * 1000;
    const input = decodePlanInputs(wire, options({ now: tomorrow }));
    expect(input.now).toBe(tomorrow);
    expect(input.today).toEqual({ firstAt: null, doneSec: 0, newDone: { [S1]: 0, [S2]: 0, [S3]: 0 } });
    expect(item(input, wire.items[0][0]).u?.lastDay).toBe('2026-12-21');
    const pending = decodePlanInputs(wire, options({ now: tomorrow, pending: [{ client_event_id: 'offline:0', item_id: wire.items[0][0], chosen: 0, ms: 5000 }] }));
    expect(item(pending, wire.items[0][0]).u?.lastDay).toBe('2026-12-22');
    expect(pending.today.doneSec).toBe(5);
    // yesterday's day start is not today's: today began with everything the wire says; its whole pace came before
    expect(input.dayStart).toEqual({});
    expect(input.paceDay).toEqual(input.pace);
    expect(pending.dayStart).toEqual({ [wire.items[0][0]]: item(input, wire.items[0][0]).u });
  });
});
