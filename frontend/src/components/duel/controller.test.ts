/**
 * «Дуэль»: the seat's controller (components/duel/controller.ts) against a scripted server — the move to the next round
 * after a reload and after a poll (both pressed «Ещё раз»), the polls by the stage and the route (1 s timed, 3 s on the
 * /sb proxy, the call exactly when something is due), the back-off on a 429, a full link with and without a session,
 * the seat taken over elsewhere, «unchanged».
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveError } from '../../lib/live/types';
import type { DuelApi, DuelState, DuelUnchanged } from '../../lib/duel/types';
import type { Route } from '../../lib/duel/rules';
import { dropDuelToken } from '../../lib/duel/token';
import { DuelController } from './controller';
import { DU } from './copy';

const CODE = 'abcdefghjkmn';
const NEXT = 'npqrstvwxyz2';
const TOKEN = 'T'.repeat(43);
const look = { body: 'round', colour: 'blue', eyes: 'round', hat: 'none' } as const;
const iso = (ms: number) => new Date(Date.now() + ms).toISOString();

function makeState(patch: { stage?: DuelState['duel']['stage']; question?: DuelState['question']; rematch?: DuelState['rematch']; rev?: number; final?: DuelState['final'] } = {}): DuelState {
  const stage = patch.stage ?? 'play';
  return {
    now: iso(0),
    rev: patch.rev ?? 5,
    duel: { code: CODE, title: 'Базы данных', q_count: 4, time_s: 20, speed: true, stage, qi: stage === 'lobby' ? -1 : 0, round: 1, path: `/d/${CODE}`, url: `https://x/d/${CODE}`, expires_at: null, wait_until: null },
    me: { seat: 1, name: 'Аня', look: { ...look }, dmg: 0, right: 0, streak: 0, best: 0, frozen: false, ready: true, next: false, rematch: !!patch.rematch?.me },
    other: { seat: 2, name: 'Боря', look: { ...look }, dmg: 0, right: 0, streak: 0, frozen: false, ready: true, present: true, answered: false, next: false, rematch: !!patch.rematch?.other },
    question:
      patch.question !== undefined
        ? patch.question
        : stage === 'play'
          ? { qi: 0, text: 'Вопрос', options: ['a', 'b'], shown_at: iso(-4000), opens_at: iso(-1000), closes_at: iso(19000) }
          : null,
    answer: null,
    result: null,
    track: [],
    final: patch.final ?? (stage === 'final' ? { reason: 'done', ended_at: iso(0), winner: 'me' } : null),
    rematch: patch.rematch ?? (stage === 'final' ? { me: false, other: false, code: null, round: 2, possible: true } : null),
    match: { round: 1, me: 0, other: 0, draws: 0 },
  };
}

function api(over: Partial<DuelApi> = {}): DuelApi & { state: ReturnType<typeof vi.fn> } {
  const refuse = () => Promise.reject(new LiveError('unknown'));
  return {
    kind: 'fake',
    create: vi.fn(refuse),
    info: vi.fn(refuse),
    join: vi.fn(refuse),
    state: vi.fn(refuse),
    ready: vi.fn(refuse),
    answer: vi.fn(refuse),
    next: vi.fn(refuse),
    rematch: vi.fn(refuse),
    review: vi.fn(refuse),
    practice: vi.fn(refuse),
    ...over,
  } as DuelApi & { state: ReturnType<typeof vi.fn> };
}

async function settle() {
  for (let i = 0; i < 8; i += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.clear();
  // the token module keeps a page's tokens in memory too (a private window): none from the test before
  dropDuelToken(CODE);
  dropDuelToken(NEXT);
});
afterEach(() => {
  vi.useRealTimers();
});

describe('the next round', () => {
  it('a reload after both pressed «Ещё раз» lands on the new duel (the check runs on the start too)', async () => {
    window.localStorage.setItem(`meldy.duel.${CODE}`, TOKEN);
    const a = api({ state: vi.fn(async () => makeState({ stage: 'final', rematch: { me: true, other: true, code: NEXT, round: 2, possible: true } })) });
    const moveTo = vi.fn();
    const ctl = new DuelController({ api: a, moveTo });
    await ctl.start(CODE);
    expect(moveTo).toHaveBeenCalledWith(NEXT);
    expect(window.localStorage.getItem(`meldy.duel.${NEXT}`)).toBe(TOKEN);
    expect(ctl.getSnapshot().moving).toBe(NEXT);
    // no poll of the old duel after the move
    await vi.advanceTimersByTimeAsync(10_000);
    expect(a.state).toHaveBeenCalledTimes(1);
    ctl.dispose();
  });

  it('the one who pressed first moves when a poll brings the code', async () => {
    window.localStorage.setItem(`meldy.duel.${CODE}`, TOKEN);
    let call = 0;
    const a = api({
      state: vi.fn(async () => {
        call += 1;
        return call === 1
          ? makeState({ stage: 'final', rematch: { me: true, other: false, code: null, round: 2, possible: true } })
          : makeState({ stage: 'final', rev: 9, rematch: { me: true, other: true, code: NEXT, round: 2, possible: true } });
      }),
    });
    const moveTo = vi.fn();
    const ctl = new DuelController({ api: a, moveTo, route: () => 'direct' });
    await ctl.start(CODE);
    expect(moveTo).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(3000);
    expect(moveTo).toHaveBeenCalledWith(NEXT);
    ctl.dispose();
  });

  it('only the seat that pressed moves: a code without the own press is not followed', async () => {
    window.localStorage.setItem(`meldy.duel.${CODE}`, TOKEN);
    const a = api({ state: vi.fn(async () => makeState({ stage: 'final', rematch: { me: false, other: true, code: NEXT, round: 2, possible: true } })) });
    const moveTo = vi.fn();
    const ctl = new DuelController({ api: a, moveTo });
    await ctl.start(CODE);
    expect(moveTo).not.toHaveBeenCalled();
    ctl.dispose();
  });
});

describe('the polls', () => {
  async function seatedOn(route: Route, question?: DuelState['question']) {
    window.localStorage.setItem(`meldy.duel.${CODE}`, TOKEN);
    const unchanged: DuelUnchanged = { unchanged: true, rev: 5, now: iso(0), stage: 'play', other: { present: true } };
    let first = true;
    const a = api({
      state: vi.fn(async () => {
        if (first) {
          first = false;
          return makeState({ question });
        }
        return { ...unchanged, now: iso(0) };
      }),
    });
    const ctl = new DuelController({ api: a, route: () => route });
    await ctl.start(CODE);
    return { a, ctl };
  }

  it('every second while a question runs on the direct route', async () => {
    const { a, ctl } = await seatedOn('direct');
    await vi.advanceTimersByTimeAsync(999);
    expect(a.state).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.state).toHaveBeenCalledTimes(2);
    expect(a.state.mock.calls[1]).toEqual([CODE, TOKEN, 5]);
    ctl.dispose();
  });

  it('about every 3 s on the /sb route', async () => {
    const { a, ctl } = await seatedOn('proxy');
    await vi.advanceTimersByTimeAsync(2999);
    expect(a.state).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.state).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3000);
    expect(a.state).toHaveBeenCalledTimes(3);
    ctl.dispose();
  });

  it('on the /sb route still a call exactly when the server says the time is up', async () => {
    const { a, ctl } = await seatedOn('proxy', { qi: 0, text: 'Вопрос', options: ['a', 'b'], shown_at: iso(-4000), opens_at: iso(-1000), closes_at: iso(500) });
    // the end of the time and its 1.5 s of grace, by the server's clock, and 150 ms more
    await vi.advanceTimersByTimeAsync(2100);
    expect(a.state).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(100);
    expect(a.state).toHaveBeenCalledTimes(2);
    ctl.dispose();
  });

  it('the lobby every 1.5 s, the end every 3 s', async () => {
    window.localStorage.setItem(`meldy.duel.${CODE}`, TOKEN);
    const a = api({ state: vi.fn(async () => makeState({ stage: 'lobby' })) });
    const ctl = new DuelController({ api: a, route: () => 'direct' });
    await ctl.start(CODE);
    await vi.advanceTimersByTimeAsync(1500);
    expect(a.state).toHaveBeenCalledTimes(2);
    ctl.dispose();
    const b = api({ state: vi.fn(async () => makeState({ stage: 'final' })) });
    const ctl2 = new DuelController({ api: b, route: () => 'direct' });
    await ctl2.start(CODE);
    await vi.advanceTimersByTimeAsync(2999);
    expect(b.state).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(b.state).toHaveBeenCalledTimes(2);
    ctl2.dispose();
  });

  it('a 429 backs off 3 s, then 6 s; a good answer brings the pace back', async () => {
    window.localStorage.setItem(`meldy.duel.${CODE}`, TOKEN);
    let call = 0;
    const a = api({
      state: vi.fn(async () => {
        call += 1;
        if (call === 1) return makeState();
        if (call === 2 || call === 3) throw new LiveError('unknown', null, 429);
        return { unchanged: true, rev: 5, now: iso(0), stage: 'play', other: { present: true } } as DuelUnchanged;
      }),
    });
    const ctl = new DuelController({ api: a, route: () => 'direct' });
    await ctl.start(CODE);
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.state).toHaveBeenCalledTimes(2);
    expect(ctl.getSnapshot().backoff).toBe(1);
    await vi.advanceTimersByTimeAsync(2999);
    expect(a.state).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.state).toHaveBeenCalledTimes(3);
    expect(ctl.getSnapshot().backoff).toBe(2);
    await vi.advanceTimersByTimeAsync(5999);
    expect(a.state).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(a.state).toHaveBeenCalledTimes(4);
    expect(ctl.getSnapshot().backoff).toBe(0);
    await vi.advanceTimersByTimeAsync(1000);
    expect(a.state).toHaveBeenCalledTimes(5);
    ctl.dispose();
  });

  it('«unchanged» keeps the state and brings the presence of the other seat', async () => {
    window.localStorage.setItem(`meldy.duel.${CODE}`, TOKEN);
    let call = 0;
    const st = makeState();
    const a = api({
      state: vi.fn(async () => {
        call += 1;
        return call === 1 ? st : ({ unchanged: true, rev: 5, now: iso(0), stage: 'play', other: { present: false } } as DuelUnchanged);
      }),
    });
    const ctl = new DuelController({ api: a, route: () => 'direct' });
    await ctl.start(CODE);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctl.getSnapshot().state).toBe(st);
    expect(ctl.getSnapshot().otherPresent).toBe(false);
    ctl.dispose();
  });

  it('the seat taken over on another device: the token goes, the page says so', async () => {
    window.localStorage.setItem(`meldy.duel.${CODE}`, TOKEN);
    let call = 0;
    const a = api({
      state: vi.fn(async () => {
        call += 1;
        if (call === 1) return makeState();
        throw new LiveError('P0002', 'token', 404);
      }),
    });
    const ctl = new DuelController({ api: a, route: () => 'direct' });
    await ctl.start(CODE);
    await vi.advanceTimersByTimeAsync(1000);
    expect(ctl.getSnapshot().step).toBe('gone');
    expect(ctl.getSnapshot().gone).toEqual(DU.gone.other);
    expect(window.localStorage.getItem(`meldy.duel.${CODE}`)).toBeNull();
    ctl.dispose();
  });
});

describe('a link whose seats look full', () => {
  const fullInfo = { code: CODE, title: 'Базы данных', q_count: 4, time_s: 20, speed: true, stage: 'lobby' as const, round: 1, players: [], full: true };

  it('signed in: the server is asked for the seat of this account first', async () => {
    const a = api({ info: vi.fn(async () => fullInfo), join: vi.fn(async () => makeState({ stage: 'lobby' })) });
    const ctl = new DuelController({ api: a, signedIn: () => true });
    await ctl.start(CODE);
    expect(a.join).toHaveBeenCalledTimes(1);
    expect(ctl.getSnapshot().step).toBe('duel');
    expect(window.localStorage.getItem(`meldy.duel.${CODE}`)).toMatch(/^[A-Za-z0-9_-]{43}$/);
    ctl.dispose();
  });

  it('signed in and refused: «Места заняты»', async () => {
    const a = api({ info: vi.fn(async () => fullInfo), join: vi.fn(async () => Promise.reject(new LiveError('ML001', 'full'))) });
    const ctl = new DuelController({ api: a, signedIn: () => true });
    await ctl.start(CODE);
    expect(ctl.getSnapshot().step).toBe('full');
    expect(window.localStorage.getItem(`meldy.duel.${CODE}`)).toBeNull();
    ctl.dispose();
  });

  it('a guest: «Места заняты» without a try', async () => {
    const a = api({ info: vi.fn(async () => fullInfo) });
    const ctl = new DuelController({ api: a, signedIn: () => false });
    await ctl.start(CODE);
    expect(a.join).not.toHaveBeenCalled();
    expect(ctl.getSnapshot().step).toBe('full');
    ctl.dispose();
  });

  it('a free seat: the invite', async () => {
    await settle();
    const a = api({ info: vi.fn(async () => ({ ...fullInfo, full: false, players: [{ seat: 1 as const, name: 'Аня', look: { ...look } }] })) });
    const ctl = new DuelController({ api: a });
    await ctl.start(CODE);
    expect(ctl.getSnapshot().step).toBe('intro');
    ctl.dispose();
  });
});
