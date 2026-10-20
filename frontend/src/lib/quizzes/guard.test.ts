import { describe, expect, it } from 'vitest';
import {
  ATTEMPT_MAX,
  BATCH_MAX,
  COUNTED,
  Episodes,
  GuardQueue,
  guardKey,
  guardRetryDelay,
  levelOf,
  limitOf,
  looksSplit,
  MERGE_MS,
  newEventId,
  overLimit,
  RELOAD_GRACE_MS,
  SIGNAL_GAP_MS,
  splitQueries,
  type GuardEvent,
  type KeyStore,
} from './guard';

const T0 = Date.parse('2026-10-20T10:00:00.000Z');
const ids = () => {
  let n = 0;
  return () => `e${++n}`;
};

function memory(): KeyStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('Episodes: one time away is one event', () => {
  it('opens on the first signal and closes with the duration under the same id', () => {
    const episodes = new Episodes({ makeId: ids() });
    const open = episodes.away('blur', T0, 3);
    expect(open).toEqual({ id: 'e1', kind: 'blur', at: '2026-10-20T10:00:00.000Z', q: 3, ms: null });
    expect(episodes.isAway).toBe(true);
    const closed = episodes.back(T0 + 12_400);
    expect(closed).toEqual({ id: 'e1', kind: 'blur', at: '2026-10-20T10:00:00.000Z', q: 3, ms: 12_400 });
    expect(episodes.opened).toBe(1);
    expect(episodes.lastMs).toBe(12_400);
  });

  it('an app switch (blur, then hidden, freeze and pagehide) is one episode of kind hidden', () => {
    const episodes = new Episodes({ makeId: ids() });
    expect(episodes.away('blur', T0, 1)?.kind).toBe('blur');
    expect(episodes.away('hidden', T0 + 80, 1)).toEqual({ id: 'e1', kind: 'hidden', at: '2026-10-20T10:00:00.000Z', q: 1, ms: null });
    // freeze and pagehide say hidden again: nothing new
    expect(episodes.away('hidden', T0 + 200, 1)).toBeNull();
    // a weaker signal inside the episode changes nothing
    expect(episodes.away('blur', T0 + 300, 1)).toBeNull();
    expect(episodes.away('fullscreen', T0 + 400, 1)).toBeNull();
    expect(episodes.back(T0 + 5000)?.kind).toBe('hidden');
    expect(episodes.opened).toBe(1);
  });

  it('a call, the lock screen or a notification: one count, however many signals', () => {
    const episodes = new Episodes({ makeId: ids() });
    episodes.away('blur', T0, 2); // the heads-up call takes the focus
    episodes.away('hidden', T0 + 900, 2); // the call's screen hides the page
    episodes.back(T0 + 60_000);
    expect(episodes.opened).toBe(1);
  });

  it('a signal soon after the return belongs to the same episode (no second count)', () => {
    const episodes = new Episodes({ makeId: ids() });
    episodes.away('hidden', T0, 1);
    episodes.back(T0 + 3000);
    // fullscreen ends a moment after the page came back: the same time away, weaker, nothing to send
    expect(episodes.away('fullscreen', T0 + 3000 + MERGE_MS - 1, 1)).toBeNull();
    expect(episodes.isAway).toBe(true);
    expect(episodes.opened).toBe(1);
    // closing again gives the same id with the whole duration
    expect(episodes.back(T0 + 9000)).toMatchObject({ id: 'e1', kind: 'hidden', ms: 9000 });
  });

  it('a stronger signal soon after the return makes the same episode stronger', () => {
    const episodes = new Episodes({ makeId: ids() });
    episodes.away('blur', T0, 1);
    episodes.back(T0 + 1000);
    expect(episodes.away('hidden', T0 + 1500, 1)).toMatchObject({ id: 'e1', kind: 'hidden', ms: null });
    expect(episodes.opened).toBe(1);
  });

  it('a signal later than MERGE_MS after the return is a new episode', () => {
    const episodes = new Episodes({ makeId: ids() });
    episodes.away('blur', T0, 1);
    episodes.back(T0 + 1000);
    expect(episodes.away('blur', T0 + 1000 + MERGE_MS + 1, 2)).toMatchObject({ id: 'e2', kind: 'blur', q: 2 });
    expect(episodes.opened).toBe(2);
  });

  it('back without an open episode says nothing', () => {
    const episodes = new Episodes({ makeId: ids() });
    expect(episodes.back(T0)).toBeNull();
    expect(episodes.lastMs).toBeNull();
  });

  it('copies and pastes: one event per SIGNAL_GAP_MS of a kind, never counted', () => {
    const episodes = new Episodes({ makeId: ids() });
    expect(episodes.signal('copy', T0, 4)).toEqual({ id: 'e1', kind: 'copy', at: '2026-10-20T10:00:00.000Z', q: 4, ms: null });
    expect(episodes.signal('copy', T0 + SIGNAL_GAP_MS - 1, 4)).toBeNull();
    expect(episodes.signal('paste', T0 + 10, 4)?.kind).toBe('paste');
    expect(episodes.signal('copy', T0 + SIGNAL_GAP_MS, 4)?.id).toBe('e3');
    expect(episodes.opened).toBe(0);
    expect(COUNTED.has('copy')).toBe(false);
    expect(COUNTED.has('paste')).toBe(false);
    expect(COUNTED.has('reload')).toBe(false);
    expect([...COUNTED].sort()).toEqual(['blur', 'fullscreen', 'hidden', 'split']);
  });

  it('a duration is capped at a day (the server refuses more)', () => {
    const episodes = new Episodes({ makeId: ids() });
    episodes.away('hidden', T0, null);
    expect(episodes.back(T0 + 3 * 86_400_000)?.ms).toBe(86_400_000);
  });
});

describe('the strict limit', () => {
  it('ends the attempt at the limit, only on the strict level', () => {
    expect(overLimit('strict', 2, 3)).toBe(false);
    expect(overLimit('strict', 3, 3)).toBe(true);
    expect(overLimit('strict', 4, 3)).toBe(true);
    expect(overLimit('normal', 99, 3)).toBe(false);
    expect(overLimit('off', 99, 3)).toBe(false);
  });

  it('reads the level and the limit as the server names them', () => {
    expect(levelOf('strict')).toBe('strict');
    expect(levelOf('normal')).toBe('normal');
    expect(levelOf(undefined)).toBe('off');
    expect(levelOf('max')).toBe('off');
    expect(limitOf(5)).toBe(5);
    expect(limitOf(0)).toBe(3);
    expect(limitOf(21)).toBe(3);
    expect(limitOf('3')).toBe(3);
    expect(limitOf(2.5)).toBe(3);
  });
});

describe('split screen and floating windows', () => {
  const base = { width: 412, height: 780 };
  it('a narrower or lower window than at the start', () => {
    expect(looksSplit({ width: 412, height: 780 }, base, false)).toBe(false);
    // the top half of a split screen in portrait
    expect(looksSplit({ width: 412, height: 380 }, base, false)).toBe(true);
    // side by side
    expect(looksSplit({ width: 206, height: 780 }, base, false)).toBe(true);
    // a floating window
    expect(looksSplit({ width: 280, height: 420 }, base, false)).toBe(true);
    // the address bar hiding and showing
    expect(looksSplit({ width: 412, height: 724 }, base, false)).toBe(false);
  });

  it('does not trust the height alone while a text field has the focus (the keyboard)', () => {
    expect(looksSplit({ width: 412, height: 380 }, base, true)).toBe(false);
    expect(looksSplit({ width: 206, height: 380 }, base, true)).toBe(true);
  });

  it('nothing without a size at the start', () => {
    expect(looksSplit({ width: 100, height: 100 }, { width: 0, height: 0 }, false)).toBe(false);
  });

  it('gives the media queries of the same thresholds', () => {
    expect(splitQueries(base)).toEqual({ width: '(max-width: 308px)', height: '(max-height: 467px)' });
    expect(splitQueries({ width: 1532, height: 734 })).toEqual({ width: '(max-width: 1148px)', height: '(max-height: 439px)' });
  });
});

describe('GuardQueue: kept on the device until the server has it', () => {
  const event = (id: string, kind: GuardEvent['kind'] = 'blur', ms: number | null = null): GuardEvent => ({
    id,
    kind,
    at: '2026-10-20T10:00:00.000Z',
    q: 1,
    ms,
  });

  it('keeps the latest version of an id and survives a reload', () => {
    const store = memory();
    const queue = new GuardQueue('att-1', store);
    queue.put(event('a'));
    queue.put(event('a', 'hidden', 4000));
    queue.put(event('b', 'copy'));
    expect(queue.size).toBe(2);
    const again = new GuardQueue('att-1', store);
    expect(again.batch().events).toEqual([event('a', 'hidden', 4000), event('b', 'copy')]);
    expect(store.data.has(guardKey('att-1'))).toBe(true);
  });

  it('ack drops what was sent unless a newer version came meanwhile', () => {
    const store = memory();
    const queue = new GuardQueue('att-1', store);
    queue.put(event('a'));
    queue.put(event('b'));
    const sent = queue.batch();
    queue.put(event('a', 'hidden', 900)); // the return, while the send was on its way
    queue.ack(sent.versions);
    expect(queue.batch().events).toEqual([event('a', 'hidden', 900)]);
    queue.ack(queue.batch().versions);
    expect(queue.size).toBe(0);
    expect(store.data.has(guardKey('att-1'))).toBe(false);
  });

  it('a batch is at most BATCH_MAX, oldest first', () => {
    const queue = new GuardQueue('att-2', memory());
    for (let i = 0; i < BATCH_MAX + 7; i += 1) queue.put(event(`x${i}`, 'copy'));
    const batch = queue.batch();
    expect(batch.events).toHaveLength(BATCH_MAX);
    expect(batch.events[0].id).toBe('x0');
    queue.ack(batch.versions);
    expect(queue.size).toBe(7);
    expect(ATTEMPT_MAX).toBe(500);
  });

  it('drop forgets a refused batch', () => {
    const queue = new GuardQueue('att-3', memory());
    queue.put(event('a'));
    queue.drop(queue.batch().versions);
    expect(queue.size).toBe(0);
  });

  it('ignores an unreadable or foreign copy', () => {
    const store = memory();
    store.setItem(guardKey('att-4'), '{not json');
    expect(new GuardQueue('att-4', store).size).toBe(0);
    store.setItem(guardKey('att-5'), JSON.stringify([event('ok'), { id: 'bad id', kind: 'blur', at: 'x', q: null, ms: null }, { id: 'k', kind: 'gemini' }]));
    expect(new GuardQueue('att-5', store).batch().events.map((e) => e.id)).toEqual(['ok']);
  });

  it('settleUnload: the reload\'s own time away goes, an older open one stays with its duration, closed ones stay', () => {
    const store = memory();
    const queue = new GuardQueue('att-7', store);
    const at = (ms: number) => new Date(T0 + ms).toISOString();
    queue.put({ id: 'reload', kind: 'hidden', at: at(0), q: 1, ms: null });
    queue.put({ id: 'gone', kind: 'hidden', at: at(-60_000), q: 2, ms: null });
    queue.put({ id: 'closed', kind: 'blur', at: at(-90_000), q: 1, ms: 3000 });
    queue.put({ id: 'copy', kind: 'copy', at: at(-1000), q: 1, ms: null });
    expect(queue.settleUnload(T0 + RELOAD_GRACE_MS - 1)).toBe(1);
    const left = new GuardQueue('att-7', store).batch().events;
    expect(left.map((e) => e.id).sort()).toEqual(['closed', 'copy', 'gone']);
    expect(left.find((e) => e.id === 'gone')?.ms).toBe(60_000 + RELOAD_GRACE_MS - 1);
    expect(left.find((e) => e.id === 'closed')?.ms).toBe(3000);
  });

  it('works without storage (the events still go now)', () => {
    const queue = new GuardQueue('att-6', null);
    queue.put(event('a'));
    expect(queue.size).toBe(1);
  });
});

describe('ids and retries', () => {
  it('ids fit the server rule and differ', () => {
    const a = newEventId(T0, () => 0.5);
    const b = newEventId(T0, () => 0.5);
    expect(a).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
    expect(a).not.toBe(b);
  });

  it('waits longer after each failure, then repeats the last', () => {
    expect(guardRetryDelay(1)).toBe(2000);
    expect(guardRetryDelay(2)).toBe(5000);
    expect(guardRetryDelay(9)).toBe(30000);
  });
});
