/**
 * Render budget of the teacher's screen: a hit re-renders the character it touches and the HP bar — never the crowd,
 * never a character's drawing, never the monster's layers; a poll that changed nothing renders no character. Counted
 * like React DevTools does: a hook installed before React loads walks the fibers of every commit and notes which
 * components ran (same method as the smoothness audit's inpage.js).
 */
import { act, cleanup, render } from '@testing-library/react';
import { createRef, type RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HostState, RosterRow } from '../../../lib/live/types';
import { defaultLook } from '../../../lib/live/rules';
import { BossView, FxDefs, HpBar } from './Arena';
import { Crowd } from './Crowd';
import { Director } from './director';
import { syncRest } from './HostScreen';
import { shareState } from './useHostGame';
import { arenaSlots } from './layout';
import { StageStore } from './stageStore';

type Counts = Record<string, number>;

const commits = vi.hoisted(() => {
  const list: Counts[] = [];
  const FN_TAGS = new Set([0, 1, 11, 15]); // function, class, forwardRef, simple memo (a memo with a compare: its inner function)
  type Fiber = { tag: number; type: unknown; flags: number; alternate: Fiber | null; child: Fiber | null; sibling: Fiber | null };
  // The transform renames a memo's inner function («CrowdChar2»): the digits go.
  const nameOf = (f: Fiber): string => {
    const t = f.type as { displayName?: string; name?: string; render?: { name?: string }; type?: { name?: string } } | null;
    let n = '?';
    if (typeof t === 'function') n = (t as { displayName?: string; name?: string }).displayName || (t as { name?: string }).name || '?';
    else if (t && typeof t === 'object') n = t.render?.name || t.type?.name || t.displayName || '?';
    return n.replace(/\d+$/, '');
  };
  const renderers = new Map<number, unknown>();
  (globalThis as unknown as Record<string, unknown>).__REACT_DEVTOOLS_GLOBAL_HOOK__ = {
    renderers,
    supportsFiber: true,
    isDisabled: false,
    inject(r: unknown) {
      renderers.set(1, r);
      return 1;
    },
    checkDCE() {},
    onScheduleFiberRoot() {},
    onCommitFiberUnmount() {},
    onPostCommitFiberRoot() {},
    setStrictMode() {},
    onCommitFiberRoot(_id: number, root: { current: Fiber }) {
      const comps: Counts = {};
      const stack: Fiber[] = [root.current];
      while (stack.length) {
        const f = stack.pop()!;
        const prev = f.alternate;
        if (FN_TAGS.has(f.tag) && (!prev || (f.flags & 1) === 1)) comps[nameOf(f)] = (comps[nameOf(f)] ?? 0) + 1;
        if (prev && f.child === prev.child) continue; // a subtree that bailed out did not render
        for (let c = f.child; c; c = c.sibling) stack.push(c);
      }
      list.push(comps);
    },
  };
  return list;
});

function sum(list: Counts[]): Counts {
  const out: Counts = {};
  for (const c of list) for (const [k, v] of Object.entries(c)) out[k] = (out[k] ?? 0) + v;
  return out;
}
const total = (c: Counts) => Object.values(c).reduce((a, b) => a + b, 0);

const NAMES = ['Лена', 'Артём', 'Катя', 'Миша', 'Соня', 'Егор', 'Аня', 'Илья', 'Даша', 'Никита', 'Полина', 'Ваня', 'Маша', 'Кирилл', 'Алиса', 'Тимур', 'Вера', 'Глеб', 'Оля', 'Саша', 'Лиза', 'Макс', 'Нина', 'Дима'];

function roster(n = 24): RosterRow[] {
  return NAMES.slice(0, n).map((name, i) => ({
    player_id: `p${String(i).padStart(2, '0')}`,
    name,
    look: defaultLook(name),
    dmg: 0,
    right: 0,
    streak: 0,
    frozen: false,
    joined_at: new Date(Date.UTC(2026, 9, 21, 9, 0, i)).toISOString(),
    answered: false,
  }));
}

function revealState(rows: RosterRow[], hits: { player_id: string; dmg: number; hp_after: number }[]): HostState {
  const hpMax = rows.length * 6 * 55;
  const hp = hits.length ? hits[hits.length - 1].hp_after : hpMax;
  return {
    rev: 9,
    now: new Date().toISOString(),
    state: 'reveal',
    mode: 'boss',
    qi: 0,
    q_count: 6,
    time_s: 20,
    speed: true,
    players: rows.length,
    answered: rows.length,
    question: { qi: 0, text: 'Какая команда отменяет транзакцию?', options: ['ROLLBACK', 'COMMIT', 'SAVEPOINT', 'GRANT'], opens_at: '', closes_at: '', phase: 0, picture: null },
    boss: { hp, hp_max: hpMax, phase: 0, defeated: false },
    top: null,
    pin: '482913',
    topic: 't',
    settings: { mode: 'boss', time_s: 20, speed: true, who: 'pin', chat_names: false },
    skipped: 0,
    roster: rows,
    answered_ids: [],
    result: { qi: 0, key: 0, counts: [hits.length, 0, 0, 0], right: hits.length, healed: 0, phase_changed: null, hits, frozen_now: [], thawed: [] },
    final: null,
  };
}

function Arena({ store, rows, fx, defs }: { store: StageStore; rows: RosterRow[]; fx: RefObject<HTMLDivElement>; defs: RefObject<HTMLDivElement> }) {
  const slots = arenaSlots(rows.length, 1600);
  const places = new Map(rows.map((r, i) => [r.player_id, { x: slots[i].x, y: slots[i].y, size: slots[i].size, hidden: false, name: true, nameW: slots[i].nameW, i }]));
  return (
    <div>
      <HpBar store={store} width={1600} enter={false} />
      <BossView store={store} width={1600} enter={false} />
      <Crowd view="battle" rows={rows} places={places} store={store} onPick={null} first={null} />
      <div ref={fx} />
      <FxDefs defsRef={defs} />
    </div>
  );
}

function setup(n = 24) {
  const rows = roster(n);
  const store = new StageStore();
  const fx = createRef<HTMLDivElement>();
  const defs = createRef<HTMLDivElement>();
  const start = revealState(rows, []);
  syncRest(store, { ...start, state: 'open', result: null });
  const view = render(<Arena store={store} rows={rows} fx={fx} defs={defs} />);
  const slots = arenaSlots(rows.length, 1600);
  const slotMap = new Map(rows.map((r, i) => [r.player_id, slots[i]]));
  const director = new Director({
    store,
    fx: () => fx.current,
    defs: () => defs.current,
    slotOf: (id) => slotMap.get(id) ?? null,
    colourOf: (id) => rows.find((r) => r.player_id === id)?.look.colour ?? 'blue',
    width: () => 1600,
    banner: () => {},
  });
  return { rows, store, view, director, fx, defs };
}

async function play(director: Director, s: HostState, store: StageStore) {
  commits.length = 0;
  let done = false;
  act(() => {
    director.reveal(s, () => {
      syncRest(store, s);
      done = true;
    });
  });
  for (let i = 0; i < 200 && !done; i += 1) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(50);
    });
  }
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(done).toBe(true);
  return sum(commits);
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('render budget of the teacher screen', () => {
  it('the hook sees React commits (the measurement works)', () => {
    commits.length = 0;
    setup();
    expect(commits.length).toBeGreaterThan(0);
    const c = sum(commits);
    expect(c.CrowdChar).toBe(24);
    expect(c.Drawing).toBe(24);
  });

  it('one hit re-renders at most 9 components: the hitter twice, the HP bar, the monster on and off — no drawing, no crowd', async () => {
    const { rows, store, director } = setup();
    const hpMax = rows.length * 6 * 55;
    const s = revealState(rows, [{ player_id: rows[5].player_id, dmg: 98, hp_after: hpMax - 98 }]);
    const c = await play(director, s, store);
    expect(c.CrowdChar ?? 0).toBeLessThanOrEqual(2); // happy, then back to idle — one character
    expect(c.Character ?? 0).toBeLessThanOrEqual(2);
    expect(c.HpBar ?? 0).toBe(1);
    expect(c.BossView ?? 0).toBeLessThanOrEqual(2); // hurt on, hurt off (BossView + Boss each)
    expect(c.Drawing ?? 0).toBe(0);
    expect((c.Body ?? 0) + (c.Face ?? 0) + (c.Bells ?? 0)).toBe(0);
    expect(total(c)).toBeLessThanOrEqual(9);
    expect(store.getHp().hp).toBe(hpMax - 98);
  });

  it('24 hits: each hitter renders twice at most, the drawings never', async () => {
    const { rows, store, director } = setup();
    let hp = rows.length * 6 * 55;
    const hits = rows.map((r) => {
      hp -= 100;
      return { player_id: r.player_id, dmg: 100, hp_after: hp };
    });
    const c = await play(director, revealState(rows, hits), store);
    expect(c.CrowdChar).toBeLessThanOrEqual(48);
    expect(c.Drawing ?? 0).toBe(0);
    expect(c.HpBar).toBeLessThanOrEqual(24);
    expect(c.BossView ?? 0).toBeLessThanOrEqual(2);
    // every further hit of a burst: the hitter (twice, with its drawing untouched) and the bar
    expect(total(c)).toBeLessThanOrEqual(9 + 23 * 5);
    expect(store.getHp().hp).toBe(hp);
  });

  it('a poll that changed nothing renders no character; new but equal looks do not either', () => {
    const { rows, store, view, fx, defs } = setup();
    const before = revealState(rows, []);
    const same = shareState(before, JSON.parse(JSON.stringify(before)) as HostState);
    expect(same).toBe(before);
    commits.length = 0;
    const copy = JSON.parse(JSON.stringify(rows)) as RosterRow[];
    view.rerender(<Arena store={store} rows={copy} fx={fx} defs={defs} />);
    const c = sum(commits);
    expect(c.CrowdChar ?? 0).toBe(0);
    expect(c.Character ?? 0).toBe(0);
  });

  it('the crowd re-placed (a kick, the walk to the podium) moves characters without redrawing one', () => {
    const { rows, store, view, fx, defs } = setup();
    commits.length = 0;
    const fewer = (JSON.parse(JSON.stringify(rows)) as RosterRow[]).slice(1);
    view.rerender(<Arena store={store} rows={fewer} fx={fx} defs={defs} />);
    const c = sum(commits);
    expect(c.CrowdChar).toBeGreaterThan(0);
    expect(c.Drawing ?? 0).toBe(0);
    expect((c.Eyes ?? 0) + (c.Mouth ?? 0) + (c.Base ?? 0) + (c.Hat ?? 0)).toBe(0);
  });

  it('a new answer during the question re-renders nothing (the hop is a Web Animation)', () => {
    const { rows, store, director } = setup();
    commits.length = 0;
    act(() => director.hops([rows[3].player_id, rows[7].player_id]));
    act(() => {
      vi.advanceTimersByTime(500);
    });
    expect(total(sum(commits))).toBe(0);
    expect(store.char(rows[3].player_id).face).toBe('idle');
  });
});
