/**
 * The reveal's film (director.ts): one clear moment — the key first, then one number counts the class's damage up and
 * flies into the bar (the bar drains once, at the blow), the three who hit hardest are named under the bar, and only
 * then, one after another, the ice, the heal or the phase banner. Played in jsdom with fake timers (the Web Animations
 * API is absent there: the timers and the store still run, which is what is checked).
 */
import { act, cleanup, render, screen } from '@testing-library/react';
import { createRef, type RefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defaultLook } from '../../../lib/live/rules';
import type { Hit, HostState, RosterRow } from '../../../lib/live/types';
import { BossView, FxDefs, HpBar, UnderBar } from './Arena';
import { Crowd } from './Crowd';
import { Director, FILM, filmPlan, strikeOf, type BannerSpec, type Cue } from './director';
import { syncRest } from './HostScreen';
import { arenaSlots } from './layout';
import { StageStore } from './stageStore';

const NAMES = ['Лена', 'Артём', 'Катя', 'Миша', 'Соня', 'Егор', 'Аня', 'Илья', 'Даша', 'Никита', 'Полина', 'Ваня'];

function roster(n = NAMES.length): RosterRow[] {
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

function state(rows: RosterRow[], hits: Hit[], extra: Partial<HostState['result'] & object> = {}, hpMax = rows.length * 6 * 55): HostState {
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
    question: { qi: 0, text: 'Какая команда отменяет транзакцию?', options: ['ROLLBACK', 'COMMIT'], opens_at: '', closes_at: '', phase: 0, picture: null },
    boss: { hp, hp_max: hpMax, phase: 0, defeated: hp === 0 },
    top: null,
    pin: '482913',
    topic: 't',
    settings: { mode: 'boss', time_s: 20, speed: true, who: 'pin', chat_names: false },
    skipped: 0,
    roster: rows,
    answered_ids: [],
    result: { qi: 0, key: 0, counts: [hits.length, 0], right: hits.length, healed: 0, phase_changed: null, hits, frozen_now: [], thawed: [], ...extra },
    final: null,
  };
}

function Stage({ store, rows, fx, defs }: { store: StageStore; rows: RosterRow[]; fx: RefObject<HTMLDivElement>; defs: RefObject<HTMLDivElement> }) {
  const slots = arenaSlots(rows.length, 1600);
  const places = new Map(rows.map((r, i) => [r.player_id, { x: slots[i].x, y: slots[i].y, size: slots[i].size, hidden: false, name: true, nameW: slots[i].nameW, i }]));
  return (
    <div>
      <HpBar store={store} width={1600} enter={false} />
      <UnderBar store={store} width={1600} />
      <BossView store={store} width={1600} enter={false} />
      <Crowd view="battle" rows={rows} places={places} store={store} onPick={null} first={null} />
      <div ref={fx} />
      <FxDefs defsRef={defs} />
    </div>
  );
}

function setup(rows = roster()) {
  const store = new StageStore();
  const fx = createRef<HTMLDivElement>();
  const defs = createRef<HTMLDivElement>();
  syncRest(store, { ...state(rows, []), state: 'open', result: null });
  const view = render(<Stage store={store} rows={rows} fx={fx} defs={defs} />);
  const slots = arenaSlots(rows.length, 1600);
  const slotMap = new Map(rows.map((r, i) => [r.player_id, slots[i]]));
  const banners: { at: number; b: BannerSpec }[] = [];
  const cues: { at: number; cue: Cue }[] = [];
  const t0 = Date.now();
  const director = new Director({
    store,
    fx: () => fx.current,
    defs: () => defs.current,
    slotOf: (id) => slotMap.get(id) ?? null,
    colourOf: () => 'blue',
    width: () => 1600,
    banner: (b) => banners.push({ at: Date.now() - t0, b }),
    cue: (cue) => cues.push({ at: Date.now() - t0, cue }),
  });
  return { store, view, director, fx, banners, cues, t0 };
}

const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

function hitsFor(rows: RosterRow[], dmg: number[], hpMax: number): Hit[] {
  let hp = hpMax;
  return dmg.map((d, i) => {
    hp = Math.max(0, hp - d);
    return { player_id: rows[i].player_id, dmg: d, hp_after: hp };
  });
}

beforeEach(() => {
  vi.useFakeTimers({ now: Date.UTC(2026, 9, 21, 9, 0, 0) });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('the reveal, one moment at a time', () => {
  it('the three who hit hardest, faster first on a tie; the hits after the kill do not count', () => {
    const rows = roster(6);
    const hits = hitsFor(rows, [90, 120, 120, 80, 150, 200], 700);
    // 700 − 90 − 120 − 120 − 80 − 150 = 140, the sixth (200) kills; nothing after it would count
    const s = state(rows, [...hits, { player_id: 'late', dmg: 999, hp_after: 0 }]);
    const strike = strikeOf(s)!;
    expect(strike.total).toBe(760);
    expect(strike.top.map((r) => [r.name, r.dmg])).toEqual([
      ['Егор', 200],
      ['Соня', 150],
      ['Артём', 120],
    ]);
    // a kicked player (not in the roster) is not named; nobody right: no strike
    const kicked = strikeOf({ ...s, roster: rows.filter((r) => r.name !== 'Егор') })!;
    expect(kicked.top.map((r) => r.name)).toEqual(['Соня', 'Артём', 'Катя']);
    expect(strikeOf(state(rows, []))).toBeNull();
  });

  it('plans the parts so nothing overlaps, within ~3.5 s', () => {
    const drawn = () => true;
    const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);
    const hits = (n: number) => ids(n).map((id, i) => ({ player_id: id, dmg: 100, hp_after: 10_000 - (i + 1) * 100 }));
    const base = { thawed: [], frozen_now: [], healed: 0, phase_changed: null };
    // 20 right: the stars, the blow; then nothing else
    const plain = filmPlan({ ...base, hits: hits(20) }, false, drawn);
    expect(plain.impact).toBeGreaterThan(FILM.starsAt + FILM.fly);
    expect(plain.end).toBeLessThanOrEqual(2600);
    // with ice and a phase change: the ice after the blow, the banner after the last shard
    const full = filmPlan({ ...base, hits: hits(16), frozen_now: ids(24).slice(16), phase_changed: 1 }, false, drawn);
    expect(full.counter!).toBeGreaterThan(full.impact!);
    expect(full.banner!).toBeGreaterThanOrEqual(full.counter! + FILM.shardsAfter + FILM.shardsSpread + FILM.shardFly);
    expect(full.banner! + FILM.bannerMs).toBeLessThanOrEqual(3900);
    // nobody right: no blow, the ice comes early
    const none = filmPlan({ ...base, hits: [], frozen_now: ids(5) }, false, drawn);
    expect(none.impact).toBeNull();
    expect(none.counter).toBe(FILM.emptyAt);
    // the kill: the defeat after the blow, nothing else
    const kill = filmPlan({ ...base, hits: [...hits(3), { player_id: 'k', dmg: 100, hp_after: 0 }, { player_id: 'x', dmg: 100, hp_after: 0 }] }, true, drawn);
    expect(kill.hits).toHaveLength(4);
    expect(kill.defeat!).toBeGreaterThan(kill.impact!);
    expect(kill.counter).toBeNull();
    expect(kill.banner).toBeNull();
  });

  it('plays it: the bar drains once, at the blow; the three are named after it; one number, no pile of tags', async () => {
    const rows = roster();
    const hpMax = rows.length * 6 * 55;
    const hits = hitsFor(rows, [98, 95, 92, 90, 88, 86, 84, 82], hpMax);
    const s = state(rows, hits, { frozen_now: [rows[10].player_id, rows[11].player_id], phase_changed: 1 }, hpMax);
    const { store, director, fx, banners, cues } = setup(rows);
    const plan = filmPlan(s.result!, false, () => true);
    let done = false;
    act(() => director.reveal(s, () => (done = true)));
    const meter = () => screen.getByRole('meter', { name: 'Дедлайн' });
    await advance(plan.impact! - 50);
    expect(meter()).toHaveAttribute('aria-valuenow', String(hpMax)); // nothing drained before the blow
    expect(screen.queryByRole('list', { name: 'Больше всех урона за вопрос' })).toBeNull();
    // one number over the monster, counted up to the total
    const totals = fx.current!.querySelectorAll('.lvh-total');
    expect(totals).toHaveLength(1);
    expect(totals[0].textContent).toBe('−715');
    expect(fx.current!.querySelectorAll('.lv-dmg')).toHaveLength(0);
    expect(cues.filter((c) => c.cue === 'land')).toHaveLength(8);
    await advance(50 + FILM.topAfter + 10);
    expect(meter()).toHaveAttribute('aria-valuenow', String(hpMax - 715));
    expect(fx.current!.querySelectorAll('.lvh-total')).toHaveLength(0);
    const named = screen.getByRole('list', { name: 'Больше всех урона за вопрос' });
    expect(named.textContent?.replace(/ /g, ' ')).toBe('Лена−98Артём−95Катя−92');
    expect(cues.find((c) => c.cue === 'impact')!.at).toBe(plan.impact);
    // then the ice, then the banner — after the last shard
    await advance(plan.end - plan.impact! + 50);
    expect(cues.find((c) => c.cue === 'freeze')!.at).toBe(plan.counter);
    expect(banners).toHaveLength(1);
    expect(banners[0].b.title).toBe('Дедлайн злится');
    expect(banners[0].at).toBe(plan.banner);
    expect(store.char(rows[10].player_id).frozen).toBe(true);
    expect(done).toBe(true);
    // the reveal at rest keeps the three named (and a reload draws them too)
    act(() => syncRest(store, s));
    expect(screen.getByRole('list', { name: 'Больше всех урона за вопрос' })).toBeInTheDocument();
    act(() => syncRest(store, { ...s, state: 'leaderboard', boss: { ...s.boss, phase: 1 } }));
    expect(screen.queryByRole('list', { name: 'Больше всех урона за вопрос' })).toBeNull();
    expect(screen.getByText('Злится: замораживает и тех, кто не ответил')).toBeInTheDocument();
  });
});
