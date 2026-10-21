import { describe, expect, it } from 'vitest';
import nameCases from '../../../../contracts/live/name_cases.json';
import lookCases from '../../../../contracts/live/default_looks.json';
import { accuracyPct, checkLook, checkName, closeQuestion, damage, defaultLook, healAmount, hpFor, KIT_HATS, KIT_HATS_ON, phaseFor, rank, rightNeeded, sharedPlaces, shownPlace, unlocksAfter, type ClosePlayer } from './rules';
import { HAT_OPTIONS } from './three/look';

const P = (id: string, extra: Partial<ClosePlayer> = {}): ClosePlayer => ({ id, streak: 0, best: 0, frozen: false, dmg: 0, right: 0, thaws: 0, active: true, ...extra });

describe('damage (CONTRACT §3 reference cases)', () => {
  it('gives the contract numbers', () => {
    expect(damage(900, 20, 1)).toBe(98);
    expect(damage(0, 20, 5)).toBe(200);
    expect(damage(20000, 20, 1)).toBe(50);
    expect(damage(5000, 20, 2, false)).toBe(125);
  });
  it('caps the streak at ×2 and the time at the limit', () => {
    expect(damage(0, 20, 9)).toBe(200);
    expect(damage(99999, 10, 1)).toBe(50);
    expect(damage(-50, 10, 1)).toBe(100);
  });
});

describe('boss numbers', () => {
  it('HP, phases by thirds, heal, the right answers needed', () => {
    expect(hpFor(24, 6)).toBe(7920);
    expect(phaseFor(7920, 7920)).toBe(0);
    expect(phaseFor(5280, 7920)).toBe(1);
    expect(phaseFor(5281, 7920)).toBe(0);
    expect(phaseFor(2640, 7920)).toBe(2);
    expect(healAmount(7920)).toBe(396);
    expect(rightNeeded(24)).toBe(16);
    expect(rightNeeded(25)).toBe(17);
  });
});

describe('closeQuestion', () => {
  const base = { key: 1, optionCount: 4, timeS: 20, speedOn: true, hpMax: 1000, qPhase: 0 as const, phase: 0 as const };

  it('hits in order of time, streaks, freezes the wrong, counts the options', () => {
    const out = closeQuestion({
      ...base,
      hp: 1000,
      players: [P('a', { streak: 1 }), P('b'), P('c')],
      answers: [
        { playerId: 'b', choice: 1, elapsedMs: 2000 },
        { playerId: 'a', choice: 1, elapsedMs: 1000 },
        { playerId: 'c', choice: 3, elapsedMs: 500 },
      ],
    });
    expect(out.hits.map((h) => h.player_id)).toEqual(['a', 'b']);
    expect(out.hits[0]).toEqual({ player_id: 'a', dmg: damage(1000, 20, 2), hp_after: 1000 - damage(1000, 20, 2) });
    expect(out.counts).toEqual([0, 2, 0, 1]);
    expect(out.right).toBe(2);
    expect(out.frozenNow).toEqual(['c']);
    const c = out.players.find((p) => p.id === 'c')!;
    expect(c.frozen).toBe(true);
    expect(c.streak).toBe(0);
    expect(out.players.find((p) => p.id === 'a')!.streak).toBe(2);
  });

  it('a frozen right answer thaws without damage; no answer freezes only from phase 1', () => {
    const p0 = closeQuestion({ ...base, hp: 1000, players: [P('f', { frozen: true, streak: 0 }), P('x')], answers: [{ playerId: 'f', choice: 1, elapsedMs: 100 }] });
    expect(p0.thawed).toEqual(['f']);
    expect(p0.hits).toEqual([]);
    expect(p0.players.find((p) => p.id === 'f')).toMatchObject({ frozen: false, streak: 1, thaws: 1, dmg: 0 });
    expect(p0.outcomes.get('x')).toMatchObject({ none: true, frozen: false });
    const p1 = closeQuestion({ ...base, qPhase: 1, phase: 1, hp: 600, players: [P('x')], answers: [] });
    expect(p1.outcomes.get('x')).toMatchObject({ none: true, frozen: true });
    expect(p1.frozenNow).toEqual(['x']);
  });

  it('phase 2 heals when fewer than two thirds are right; the phase only grows', () => {
    const out = closeQuestion({ ...base, qPhase: 2, phase: 2, hp: 300, players: [P('a'), P('b'), P('c')], answers: [{ playerId: 'a', choice: 1, elapsedMs: 0 }] });
    expect(out.healed).toBe(50);
    expect(out.hp).toBe(300 - 100 + 50);
    expect(out.phase).toBe(2);
    const enough = closeQuestion({ ...base, qPhase: 2, phase: 2, hp: 300, players: [P('a'), P('b'), P('c')], answers: [{ playerId: 'a', choice: 1, elapsedMs: 0 }, { playerId: 'b', choice: 1, elapsedMs: 0 }] });
    expect(enough.healed).toBe(0);
  });

  it('the boss falls at 0 and every right answer still counts for its player', () => {
    const out = closeQuestion({ ...base, hp: 120, players: [P('a'), P('b')], answers: [{ playerId: 'a', choice: 1, elapsedMs: 0 }, { playerId: 'b', choice: 1, elapsedMs: 10 }] });
    expect(out.defeated).toBe(true);
    expect(out.hp).toBe(0);
    expect(out.hits.map((h) => h.hp_after)).toEqual([20, 0]);
    expect(out.players.find((p) => p.id === 'b')!.dmg).toBeGreaterThan(0);
    expect(out.phaseChanged).toBe(2);
  });

  it('players who joined after the question opened are not frozen for not answering', () => {
    const out = closeQuestion({ ...base, qPhase: 1, phase: 1, hp: 600, players: [P('late', { active: false })], answers: [] });
    expect(out.outcomes.has('late')).toBe(false);
  });
});

describe('ranking, unlocks, looks, names', () => {
  it('ranks by damage, then right, then best, then who joined first', () => {
    const r = rank([
      { id: 'a', dmg: 100, right: 2, best: 1, joinedAt: 5 },
      { id: 'b', dmg: 100, right: 2, best: 2, joinedAt: 9 },
      { id: 'c', dmg: 300, right: 1, best: 1, joinedAt: 9 },
      { id: 'd', dmg: 100, right: 2, best: 1, joinedAt: 1 },
    ]);
    expect(r.map((x) => x.id)).toEqual(['c', 'b', 'd', 'a']);
  });
  it('opens the parts by the rules, not twice', () => {
    expect(unlocksAfter({ place: 2, dmg: 700, best: 5, thaws: 3, games: 10, wins: 5 }, ['grad'])).toEqual(['crown', 'graphite', 'horns', 'snow']);
    expect(unlocksAfter({ place: 2, dmg: 0, best: 1, thaws: 0, games: 1, wins: 0 }, [])).toEqual([]);
  });
  it('checks looks: unknown parts and locked ones', () => {
    expect(checkLook({ body: 'cloud', colour: 'orange', eyes: 'round', hat: 'phones' }).ok).toBe(true);
    expect(checkLook({ body: 'cloud', colour: 'orange', eyes: 'round', hat: 'tophat' })).toEqual({ ok: false, reason: 'unknown_part' });
    expect(checkLook({ body: 'cloud', colour: 'orange', eyes: 'round', hat: 'crown' })).toEqual({ ok: false, reason: 'locked' });
    expect(checkLook({ body: 'cloud', colour: 'graphite', eyes: 'round', hat: 'none' }, ['graphite']).ok).toBe(true);
  });
  it('keeps the kit hats off until the database takes them (20261023090000_live_stand_phone.sql)', () => {
    // The kit's list and this one are the same three; the live SQL refuses them, so the phone must not offer them.
    expect(HAT_OPTIONS.filter((h) => !h.wardrobe).map((h) => h.id)).toEqual([...KIT_HATS]);
    expect(KIT_HATS_ON).toBe(false);
    for (const hat of KIT_HATS) expect(checkLook({ body: 'drop', colour: 'blue', eyes: 'round', hat })).toEqual({ ok: false, reason: 'unknown_part' });
  });
  it('gives the same free look for the same name', () => {
    const a = defaultLook('Дима');
    expect(defaultLook('Дима')).toEqual(a);
    expect(checkLook(a).ok).toBe(true);
    for (const n of ['Лена', 'Артём', 'Q', 'Анна Сергеевна']) expect(checkLook(defaultLook(n)).ok).toBe(true);
  });
  it('checks names: length and rude words', () => {
    expect(checkName('  Дима  ')).toEqual({ ok: true, name: 'Дима' });
    expect(checkName('').ok).toBe(false);
    expect(checkName('x'.repeat(25))).toEqual({ ok: false, reason: 'length' });
    expect(checkName('Су-ка')).toEqual({ ok: false, reason: 'rude' });
  });
});

describe('the shared cases (contracts/live: the SQL gives the same answers)', () => {
  it('names: whole words, no rude roots inside ordinary surnames', () => {
    for (const c of nameCases.cases as Array<{ name: string; ok?: string; reason?: string }>) {
      const got = checkName(c.name);
      if (c.ok !== undefined) expect(got, c.name).toEqual({ ok: true, name: c.ok });
      else expect(got, c.name).toEqual({ ok: false, reason: c.reason });
    }
  });
  it('default looks', () => {
    for (const c of lookCases.cases) expect(defaultLook(c.name), c.name).toEqual(c.look);
  });
  it('damage: the JavaScript doubles round as Math.round does (half up on the double, not on the exact fraction)', () => {
    // The exact fraction of these is k.5 + a hair; the double product lands below the half (SQL: float8, floor(x + 0.5)).
    expect(damage(8500, 10, 1)).toBe(57);
    expect(damage(720, 10, 2)).toBe(120);
    expect(accuracyPct(1, 8, 1)).toBe(13);
    expect(accuracyPct(0, 0, 3)).toBe(0);
  });
});


describe('the places shown beside a ranked list', () => {
  it('equal points share the place of the first of them («1, 2, 2, 4»), the order stays the server\'s', () => {
    expect(sharedPlaces([900, 800, 800, 700, 700])).toEqual([1, 2, 2, 4, 4]);
    expect(sharedPlaces([500, 500, 500])).toEqual([1, 1, 1]);
    expect(sharedPlaces([3, 2, 1])).toEqual([1, 2, 3]);
    expect(sharedPlaces([])).toEqual([]);
  });

  it('the own place: its row in the five, a tie that goes on past the five, else the server\'s place', () => {
    const top = [900, 800, 800, 700, 700].map((points, i) => ({ id: `p${i}`, points }));
    expect(shownPlace(top, { id: 'p2', points: 800, place: 3 })).toBe(2);
    expect(shownPlace(top, { id: 'me', points: 700, place: 7 })).toBe(4);
    expect(shownPlace(top, { id: 'me', points: 650, place: 6 })).toBe(6);
    expect(shownPlace(null, { id: 'me', points: 650, place: 6 })).toBe(6);
    // a short list holds everyone: no tie past it
    expect(shownPlace([{ id: 'a', points: 620 }], { id: 'me', points: 620, place: 4 })).toBe(4);
  });
});
