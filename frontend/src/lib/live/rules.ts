/**
 * The numbers of «Битва с монстром» (docs/live/CONTRACT.md §2–§3, §10). Pure functions: the fake server uses them and the
 * SQL of W1 must give the same results (rules.test.ts holds the reference cases).
 */
import type { BodyId, BossPhase, ColourId, EyesId, HatId, Hit, Look, UnlockId } from './types';

export const COUNTDOWN_MS = 3000;
export const GRACE_MS = 1500;
export const AUTO_ADVANCE_MS = 30_000;
export const GAME_TTL_MS = 3 * 60 * 60 * 1000;
export const HP_PER_ANSWER = 55;
export const BASE_DAMAGE = 100;
export const HEAL_SHARE = 0.05;
export const MAX_PLAYERS = 300;
export const MAX_OPEN_GAMES = 3;
export const NAME_MAX = 24;
export const POLL_FAST_MS = 1000;
export const POLL_SLOW_MS = 5000;
export const POLL_ONLY_ABOVE = 80;

export const BODIES: readonly BodyId[] = ['round', 'square', 'drop', 'bean', 'cloud'];
export const COLOURS: readonly ColourId[] = ['blue', 'yellow', 'green', 'pink', 'sky', 'orange', 'violet', 'teal', 'graphite', 'snow'];
export const EYES: readonly EyesId[] = ['round', 'dots', 'one', 'sleepy', 'glasses'];
export const HATS: readonly HatId[] = ['none', 'cap', 'beanie', 'phones', 'flower', 'antenna', 'bow', 'crown', 'grad', 'horns'];
export const LOCKED: ReadonlySet<string> = new Set<UnlockId>(['graphite', 'snow', 'crown', 'grad', 'horns']);
/**
 * The hats the 3D kit draws beyond the wardrobe (docs/live/KIT_3D.md §3: колпак, пропеллер, цилиндр), free once the
 * database takes them: migration 20261023090000_live_stand_phone.sql adds them to `live_look_check`. Until that
 * migration is applied the server refuses them (ML007 unknown_part), so KIT_HATS_ON stays false and no screen offers
 * them; `checkLook` above mirrors the SQL that is live. Turning it on also needs the battle's art to draw them
 * (components/live/art/parts.ts), because a look carries over between games.
 */
export const KIT_HATS: readonly string[] = ['party', 'propeller', 'tophat'];
export const KIT_HATS_ON = false;

/** `round(100 × speed × mult)`; `streakAfter` counts this answer (1 for the first right answer in a row). */
export function damage(elapsedMs: number, timeS: number, streakAfter: number, speedOn = true): number {
  const limit = timeS * 1000;
  const share = speedOn ? 0.5 + 0.5 * Math.max(0, 1 - Math.min(Math.max(elapsedMs, 0), limit) / limit) : 1;
  const mult = 1 + 0.25 * Math.min(Math.max(streakAfter - 1, 0), 4);
  return Math.round(BASE_DAMAGE * share * mult);
}

export function hpFor(players: number, questions: number): number {
  return players * questions * HP_PER_ANSWER;
}

/** The phase the HP points to (the boss never goes back: take the max with the current one). */
export function phaseFor(hp: number, hpMax: number): BossPhase {
  if (hp * 3 <= hpMax) return 2;
  if (hp * 3 <= hpMax * 2) return 1;
  return 0;
}

export function healAmount(hpMax: number): number {
  return Math.round(hpMax * HEAL_SHARE);
}

/** Right answers the class needs in phase 2 to stop the heal. */
export function rightNeeded(activePlayers: number): number {
  return Math.ceil((activePlayers * 2) / 3);
}

export interface ClosePlayer {
  id: string;
  streak: number;
  best: number;
  frozen: boolean;
  dmg: number;
  right: number;
  thaws: number;
  /** Joined before the question opened and not kicked. */
  active: boolean;
}

export interface CloseAnswer {
  playerId: string;
  choice: number;
  elapsedMs: number;
}

export interface CloseInput {
  players: ClosePlayer[];
  answers: CloseAnswer[];
  key: number;
  optionCount: number;
  timeS: number;
  speedOn: boolean;
  hp: number;
  hpMax: number;
  /** The phase the question opened with. */
  qPhase: BossPhase;
  /** The boss's phase now (only grows). */
  phase: BossPhase;
}

export interface PlayerOutcome {
  correct: boolean;
  none: boolean;
  dmg: number;
  thawed: boolean;
  frozen: boolean;
}

export interface CloseOutput {
  players: ClosePlayer[];
  outcomes: Map<string, PlayerOutcome>;
  hits: Hit[];
  frozenNow: string[];
  thawed: string[];
  counts: number[];
  right: number;
  hp: number;
  healed: number;
  phase: BossPhase;
  phaseChanged: BossPhase | null;
  defeated: boolean;
}

/** Closing one question (CONTRACT §3): streaks, freezes and thaws, hits in order of time, heal, phase. */
export function closeQuestion(input: CloseInput): CloseOutput {
  const players = input.players.map((p) => ({ ...p }));
  const byId = new Map(players.map((p) => [p.id, p]));
  const outcomes = new Map<string, PlayerOutcome>();
  const counts = Array.from({ length: input.optionCount }, () => 0);
  const hits: Hit[] = [];
  const frozenNow: string[] = [];
  const thawed: string[] = [];
  let hp = input.hp;
  let right = 0;
  const ordered = input.answers
    .filter((a) => byId.has(a.playerId))
    .slice()
    .sort((a, b) => a.elapsedMs - b.elapsedMs || (a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0));
  const answered = new Set<string>();
  for (const a of ordered) {
    const p = byId.get(a.playerId)!;
    answered.add(p.id);
    if (a.choice >= 0 && a.choice < counts.length) counts[a.choice] += 1;
    if (a.choice === input.key) {
      right += 1;
      p.right += 1;
      if (p.frozen) {
        p.frozen = false;
        p.streak = 1;
        p.thaws += 1;
        p.best = Math.max(p.best, p.streak);
        thawed.push(p.id);
        outcomes.set(p.id, { correct: true, none: false, dmg: 0, thawed: true, frozen: false });
        continue;
      }
      p.streak += 1;
      p.best = Math.max(p.best, p.streak);
      const dmg = damage(a.elapsedMs, input.timeS, p.streak, input.speedOn);
      p.dmg += dmg;
      hp = Math.max(0, hp - dmg);
      hits.push({ player_id: p.id, dmg, hp_after: hp });
      outcomes.set(p.id, { correct: true, none: false, dmg, thawed: false, frozen: false });
    } else {
      p.streak = 0;
      if (!p.frozen) frozenNow.push(p.id);
      p.frozen = true;
      outcomes.set(p.id, { correct: false, none: false, dmg: 0, thawed: false, frozen: true });
    }
  }
  for (const p of players) {
    if (answered.has(p.id) || !p.active) continue;
    p.streak = 0;
    if (input.qPhase >= 1) {
      if (!p.frozen) frozenNow.push(p.id);
      p.frozen = true;
    }
    outcomes.set(p.id, { correct: false, none: true, dmg: 0, thawed: false, frozen: p.frozen });
  }
  const active = players.filter((p) => p.active).length;
  let healed = 0;
  if (input.qPhase === 2 && hp > 0 && right < rightNeeded(active)) {
    healed = Math.min(healAmount(input.hpMax), input.hpMax - hp);
    hp += healed;
  }
  const phase = Math.max(input.phase, phaseFor(hp, input.hpMax)) as BossPhase;
  return {
    players,
    outcomes,
    hits,
    frozenNow,
    thawed,
    counts,
    right,
    hp,
    healed,
    phase,
    phaseChanged: phase > input.phase ? phase : null,
    defeated: hp === 0,
  };
}

export interface RankRow {
  id: string;
  dmg: number;
  right: number;
  best: number;
  joinedAt: number;
}

/** dmg desc, right desc, best desc, joined_at asc. */
export function rank<T extends RankRow>(rows: readonly T[]): T[] {
  return rows.slice().sort((a, b) => b.dmg - a.dmg || b.right - a.right || b.best - a.best || a.joinedAt - b.joinedAt);
}

export function accuracyPct(rightTotal: number, players: number, asked: number): number {
  return players * asked === 0 ? 0 : Math.round((100 * rightTotal) / (players * asked));
}

export interface UnlockFacts {
  place: number;
  dmg: number;
  best: number;
  thaws: number;
  /** After this game. */
  games: number;
  wins: number;
}

/** The parts this game opens, not already open. */
export function unlocksAfter(facts: UnlockFacts, already: readonly UnlockId[]): UnlockId[] {
  const got: UnlockId[] = [];
  if (facts.place <= 3 && facts.dmg > 0) got.push('crown');
  if (facts.best >= 5) got.push('graphite');
  if (facts.thaws >= 3) got.push('horns');
  if (facts.games >= 10) got.push('grad');
  if (facts.wins >= 5) got.push('snow');
  return got.filter((u) => !already.includes(u));
}

export type LookCheck = { ok: true; look: Look } | { ok: false; reason: 'unknown_part' | 'locked' };

export function checkLook(raw: unknown, unlocked: readonly string[] = []): LookCheck {
  if (typeof raw !== 'object' || raw === null) return { ok: false, reason: 'unknown_part' };
  const r = raw as Record<string, unknown>;
  const ok = BODIES.includes(r.body as BodyId) && COLOURS.includes(r.colour as ColourId) && EYES.includes(r.eyes as EyesId) && HATS.includes(r.hat as HatId);
  if (!ok) return { ok: false, reason: 'unknown_part' };
  const look: Look = { body: r.body as BodyId, colour: r.colour as ColourId, eyes: r.eyes as EyesId, hat: r.hat as HatId };
  for (const part of [look.colour, look.hat]) if (LOCKED.has(part) && !unlocked.includes(part)) return { ok: false, reason: 'locked' };
  return { ok: true, look };
}

/** A free look picked from the name (the same name gives the same look on every device). */
export function defaultLook(name: string): Look {
  const hash = (text: string) => {
    let h = 2166136261;
    for (const ch of text) h = Math.imul(h ^ ch.codePointAt(0)!, 16777619) >>> 0;
    return h;
  };
  const free = <T extends string>(list: readonly T[]) => list.filter((x) => !LOCKED.has(x));
  const pick = <T,>(list: readonly T[], part: string) => list[hash(`${part}|${name}`) % list.length];
  return { body: pick(BODIES, 'body'), colour: pick(free(COLOURS), 'colour'), eyes: pick(EYES, 'eyes'), hat: pick(free(HATS), 'hat') };
}

/**
 * The rude-word filter, word by word (the SQL `meldy_private.live_name_rude` is the same rule; both are checked against
 * contracts/live/name_cases.json). A word is a run between spaces with everything but letters taken out («Су-ка» →
 * «сука»), checked twice: as typed (lower case) and with the Latin look-alikes read as Cyrillic («cyka» → «сука»). Rude:
 * a root anywhere in the word (`RUDE_ANY`), a root at the word's start after at most one prefix (`RUDE_START`), or the
 * whole word (`RUDE_WORDS`). Roots inside ordinary surnames no longer count: Сукачев, Ребане, Хуерта, Мудашев,
 * Скипидаров, Shitikov, Dickens.
 */
export const RUDE_ANY: readonly string[] = ['хуй', 'хуё', 'пизд', 'бляд', 'блят', 'fuck'];
export const RUDE_PREFIXES: readonly string[] = ['', 'за', 'вы', 'на', 'от', 'по', 'при', 'раз', 'рас', 'до', 'у', 'о', 'об', 'съ', 'объ', 'отъ', 'подъ', 'въ', 'изъ', 'разъ', 'пере', 'недо'];
export const RUDE_START: readonly string[] = ['ебат', 'ебан', 'ебал', 'ебу', 'ебл', 'ёб', 'хуя', 'пидор', 'пидар', 'пидр', 'мудак', 'мудил', 'залуп', 'гандон', 'гондон', 'bitch', 'cunt'];
export const RUDE_WORDS: readonly string[] = ['сука', 'суки', 'суку', 'суке', 'сукой', 'сучка', 'сучара', 'бля', 'блядь', 'хер', 'нахер', 'похер', 'жопа', 'говно', 'shit', 'shitty', 'bullshit', 'ass', 'asshole'];
/** Latin letters and digits that read as Cyrillic ones. */
const LOOKALIKE: Readonly<Record<string, string>> = { a: 'а', c: 'с', e: 'е', h: 'н', k: 'к', m: 'м', o: 'о', p: 'р', t: 'т', x: 'х', y: 'у', '0': 'о', '3': 'з' };

function rudeWord(word: string): boolean {
  return (
    RUDE_ANY.some((root) => word.includes(root)) ||
    RUDE_PREFIXES.some((prefix) => RUDE_START.some((root) => word.startsWith(prefix + root))) ||
    RUDE_WORDS.includes(word)
  );
}

/** True when a word of the (already normalised) name is rude. */
export function nameIsRude(name: string): boolean {
  return name
    .toLowerCase()
    .split(' ')
    .some((token) => {
      const typed = token.replace(/[^a-zа-яё]/g, '');
      const cyrillic = [...token].map((ch) => LOOKALIKE[ch] ?? ch).join('').replace(/[^a-zа-яё]/g, '');
      return (typed !== '' && rudeWord(typed)) || (cyrillic !== '' && rudeWord(cyrillic));
    });
}

export type NameCheck = { ok: true; name: string } | { ok: false; reason: 'length' | 'rude' };

export function checkName(raw: string): NameCheck {
  const name = raw.replace(/\s+/g, ' ').trim();
  if ([...name].length < 1 || [...name].length > NAME_MAX) return { ok: false, reason: 'length' };
  if (nameIsRude(name)) return { ok: false, reason: 'rude' };
  return { ok: true, name };
}
