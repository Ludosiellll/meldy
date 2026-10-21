/**
 * The fake live server (docs/live/CONTRACT.md §12): the whole game in memory, behind the same `LiveApi` as the real
 * client, so the teacher's screen (W2) and the player (W3) are built before the database (W1) exists. It keeps the
 * contract's rules — the key leaves only after a question closes, states move by the server's clock — and fills the game
 * with bots. `autoHost` makes it run the game by itself, so a player screen works alone. Port of the prototype's engine
 * (meldy-notes 10_Project/Telegram_Live_Game_Spec_2026-10-20.md).
 *
 * A battle with movement rounds (`stand_every`, docs/live/MODE_MIXED.md) is played as far as a database without its
 * room goes: `mixed` and `question.stand` as the server gives them, taps refused on a movement round (`ML004 stand`, the
 * bots do not tap it), and the round closed by time 8 s after its deadline as void (nobody hits, freezes or heals),
 * as the database closes a round its room never wrote.
 */
import {
  AUTO_ADVANCE_MS,
  COUNTDOWN_MS,
  GAME_TTL_MS,
  GRACE_MS,
  MAX_PLAYERS,
  accuracyPct,
  checkLook,
  checkName,
  closeQuestion,
  defaultLook,
  hpFor,
  rank,
  standRounds,
  unlocksAfter,
  HP_PER_ANSWER,
} from './rules';
import type { CloseOutput } from './rules';
import {
  LiveError,
  type AnswerAck,
  type BossPhase,
  type CreateResult,
  type GameSource,
  type GameState,
  type Hint,
  type HostState,
  type JoinResult,
  type LiveApi,
  type Look,
  type PlayerState,
  type Review,
  type Settings,
  type TgPostResult,
  type TopRow,
  type Unchanged,
  type UnlockId,
  type Uuid,
} from './types';

export interface FakeClock {
  now(): number;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export const realClock: FakeClock = {
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

/** A clock the tests move by hand: `advance(ms)` fires the due timers in order. */
export function manualClock(start = Date.UTC(2026, 9, 21, 9, 0, 0)) {
  let now = start;
  let seq = 0;
  const timers: { at: number; seq: number; fn: () => void; dead: boolean }[] = [];
  const clock: FakeClock & { advance(ms: number): void } = {
    now: () => now,
    setTimeout(fn, ms) {
      const t = { at: now + Math.max(0, ms), seq: seq++, fn, dead: false };
      timers.push(t);
      return t;
    },
    clearTimeout(handle) {
      if (handle && typeof handle === 'object') (handle as { dead: boolean }).dead = true;
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        let next: (typeof timers)[number] | null = null;
        for (const t of timers) if (!t.dead && t.at <= end && (!next || t.at < next.at || (t.at === next.at && t.seq < next.seq))) next = t;
        if (!next) break;
        next.dead = true;
        now = next.at;
        next.fn();
      }
      now = end;
    },
  };
  return clock;
}

export interface FakeQuestion {
  text: string;
  options: string[];
  /** File index of the key. */
  key: number;
  keepOrder?: boolean;
}

/** The example exam «Осенняя сессия», subject «Базы данных»: the first question is frontend/src/data/containerExample.ts. */
export const EXAMPLE_QUESTIONS: readonly FakeQuestion[] = [
  { text: 'Какой уровень изоляции транзакций исключает фантомное чтение?', options: ['READ COMMITTED', 'REPEATABLE READ', 'SERIALIZABLE', 'READ UNCOMMITTED'], key: 2 },
  { text: 'Какая команда отменяет транзакцию?', options: ['ROLLBACK', 'COMMIT', 'SAVEPOINT', 'GRANT'], key: 0 },
  { text: 'Какая нормальная форма требует отсутствия транзитивных зависимостей?', options: ['Первая', 'Вторая', 'Третья', 'Нормальная форма Бойса — Кодда'], key: 2, keepOrder: true },
  { text: 'Какая команда относится к DDL?', options: ['SELECT', 'ALTER', 'INSERT', 'UPDATE'], key: 1 },
  { text: 'Какой оператор объединяет строки двух таблиц по условию?', options: ['UNION', 'GROUP BY', 'JOIN', 'HAVING'], key: 2 },
  { text: 'Что гарантирует буква I в ACID?', options: ['Транзакция выполняется целиком', 'Параллельные транзакции не видят изменений друг друга', 'Изменения сохраняются после сбоя', 'Данные соблюдают ограничения'], key: 1 },
];

const BOT_NAMES = ['Лена', 'Артём', 'Катя', 'Миша', 'Соня', 'Егор', 'Аня', 'Илья', 'Даша', 'Никита', 'Полина', 'Ваня', 'Маша', 'Кирилл', 'Алиса', 'Тимур', 'Вера', 'Глеб', 'Оля', 'Саша', 'Лиза', 'Макс', 'Нина'];

export interface FakeOptions {
  clock?: FakeClock;
  seed?: number;
  /** Bots in every game (default 23). */
  bots?: number;
  /** Bots answer within ~1–3 s instead of ~2–15 s. */
  fastBots?: boolean;
  /** The server runs the game itself: starts 4 s after a person joins, reveal 5 s, leaderboard 3 s. */
  autoHost?: boolean;
  /** A game with this PIN exists from the start (with autoHost, a player screen can join it alone). */
  demoPin?: string | null;
  questions?: readonly FakeQuestion[];
  /** Simulated round trip of every call; 0 resolves at once (tests). */
  latencyMs?: number;
}

interface FakePlayer {
  id: Uuid;
  name: string;
  look: Look;
  joinedAt: number;
  kicked: boolean;
  streak: number;
  best: number;
  frozen: boolean;
  dmg: number;
  right: number;
  thaws: number;
  bot: { skill: number; speed: number } | null;
  token: string | null;
}

interface GameQuestion {
  text: string;
  options: string[];
  /** Shown index of the key. */
  key: number;
  phase: BossPhase;
  opensAt: number;
  closesAt: number;
  answers: Map<Uuid, { choice: number; elapsedMs: number }>;
  closed: (CloseOutput & { rankBefore: Uuid[]; void?: boolean }) | null;
  /** A mixed game's movement round: answered in the arena (here: nobody; closed by time as void). */
  stand: boolean;
}

interface FakeGame {
  id: Uuid;
  pin: string;
  topic: string;
  hostToken: string;
  settings: Settings;
  bank: readonly FakeQuestion[];
  questions: GameQuestion[];
  state: GameState;
  stateAt: number;
  qi: number;
  rev: number;
  createdAt: number;
  hp: number;
  hpMax: number;
  phase: BossPhase;
  players: Map<Uuid, FakePlayer>;
  timers: unknown[];
  finals: Map<Uuid, UnlockId[]>;
  auto: boolean;
  /** Set at the podium (live_podium): a game the host ended before it has no final (`final` null), as on the server. */
  won: boolean | null;
}

const DEFAULT_SETTINGS: Settings = { mode: 'boss', time_s: 20, speed: true, who: 'pin', chat_names: true };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// `undefined` (kick, end) has no JSON: JSON.parse(undefined) threw, so those calls never resolved.
const clone = <T,>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

export function createFakeServer(options: FakeOptions = {}): LiveApi & {
  readonly clock: FakeClock;
  /** For tests: the game as the server holds it (key included). */
  peek(game: Uuid): FakeGame | undefined;
} {
  const clock = options.clock ?? realClock;
  const random = rng(options.seed ?? 7);
  const botCount = options.bots ?? 23;
  const latency = options.latencyMs ?? 60;
  const games = new Map<Uuid, FakeGame>();
  const listeners = new Map<string, Set<(h: Hint) => void>>();
  /** game → when its last Telegram post went (tgPost). */
  const posts = new Map<Uuid, number>();
  const POST_EVERY_MS = 60_000;
  /** A movement round the room never wrote closes by time this long after its deadline (MODE_MIXED §6). */
  const ROOM_GRACE_MS = 8000;
  let ids = 0;

  const token = () => {
    const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    let t = '';
    for (let i = 0; i < 43; i += 1) t += abc[Math.floor(random() * 64)];
    return t;
  };
  const uuid = () => {
    ids += 1;
    const hex = (ids.toString(16) + Math.floor(random() * 1e12).toString(16)).padStart(12, '0').slice(-12);
    return `00000000-0000-4000-8000-${hex}`;
  };
  const iso = (ms: number) => new Date(ms).toISOString();
  const reply = <T,>(value: T): Promise<T> =>
    latency <= 0 ? Promise.resolve(clone(value)) : new Promise((resolve) => clock.setTimeout(() => resolve(clone(value)), latency));
  const fail = (e: LiveError): Promise<never> => (latency <= 0 ? Promise.reject(e) : new Promise((_, reject) => clock.setTimeout(() => reject(e), latency)));

  function later(g: FakeGame, ms: number, fn: () => void) {
    g.timers.push(clock.setTimeout(fn, ms));
  }

  function bump(g: FakeGame) {
    g.rev += 1;
    const hint: Hint = { rev: g.rev, state: g.state };
    const set = listeners.get(g.topic);
    if (set) clock.setTimeout(() => set.forEach((fn) => fn(hint)), latency <= 0 ? 0 : latency);
  }

  function setState(g: FakeGame, state: GameState) {
    g.state = state;
    g.stateAt = clock.now();
    bump(g);
    if (state === 'reveal' || state === 'leaderboard') later(g, AUTO_ADVANCE_MS, () => settle(g));
    if (g.auto) autoStep(g);
  }

  function activePlayers(g: FakeGame, at: number) {
    return [...g.players.values()].filter((p) => !p.kicked && p.joinedAt <= at);
  }

  function shuffled(q: FakeQuestion): { options: string[]; key: number } {
    const order = q.options.map((_, i) => i);
    if (!q.keepOrder) {
      for (let i = order.length - 1; i > 0; i -= 1) {
        const j = Math.floor(random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    return { options: order.map((i) => q.options[i]), key: order.indexOf(q.key) };
  }

  /** A mixed game: the qi of its movement rounds (the database's rule, `standRounds`); null for other games. */
  function roundsOf(g: FakeGame): number[] | null {
    const every = g.settings.stand_every ?? 0;
    return g.settings.mode === 'boss' && every > 0 ? standRounds(every, g.bank.length) : null;
  }
  /** How long after the deadline a question closes by time: a movement round waits for its room (8 s). */
  const graceOf = (q: GameQuestion) => (q.stand ? ROOM_GRACE_MS : GRACE_MS);

  function startQuestion(g: FakeGame, qi: number) {
    const now = clock.now();
    if (qi === 0) {
      g.hpMax = hpFor(activePlayers(g, now).length, g.bank.length);
      g.hp = g.hpMax;
    }
    const { options: shownOptions, key } = shuffled(g.bank[qi]);
    const stand = roundsOf(g)?.includes(qi) ?? false;
    const q: GameQuestion = { text: g.bank[qi].text, options: shownOptions, key, phase: g.phase, opensAt: now + COUNTDOWN_MS, closesAt: now + COUNTDOWN_MS + g.settings.time_s * 1000, answers: new Map(), closed: null, stand };
    g.questions[qi] = q;
    g.qi = qi;
    setState(g, 'countdown');
    later(g, COUNTDOWN_MS, () => settle(g));
    later(g, COUNTDOWN_MS + g.settings.time_s * 1000 + graceOf(q) + 1, () => settle(g));
    // bots (a movement round is the room's: nobody taps it)
    for (const p of g.players.values()) {
      if (stand) break;
      if (!p.bot || p.kicked) continue;
      const right = random() < p.bot.skill;
      const T = g.settings.time_s * 1000;
      const delay = botFast() ? 300 + (1 - p.bot.speed) * 1200 + random() * 600 : 1200 + (1 - p.bot.speed) * T * 0.55 + random() * T * 0.3;
      let choice = key;
      if (!right) {
        const wrong = shownOptions.map((_, i) => i).filter((i) => i !== key);
        choice = wrong[Math.floor(random() * wrong.length)];
      }
      later(g, COUNTDOWN_MS + Math.min(delay, T - 200), () => {
        try {
          answerNow(g, p, qi, choice);
        } catch {
          /* the question closed first */
        }
      });
    }
  }
  const botFast = () => options.fastBots === true;

  /** Time-driven moves (CONTRACT §1). */
  function settle(g: FakeGame) {
    const now = clock.now();
    const q = g.questions[g.qi];
    if (g.state === 'countdown' && q && now >= q.opensAt) setState(g, 'open');
    if (g.state === 'open' && q && now > q.closesAt + graceOf(q)) closeNow(g);
    if ((g.state === 'reveal' || g.state === 'leaderboard') && now - g.stateAt >= AUTO_ADVANCE_MS) advance(g);
    if (g.state !== 'ended' && now - g.createdAt >= GAME_TTL_MS) setState(g, 'ended');
  }

  function closeNow(g: FakeGame) {
    const q = g.questions[g.qi];
    if (!q || q.closed) return;
    const ranked = rankIds(g);
    if (q.stand) {
      // no room here: the round is void (MODE_MIXED §6): nobody hits, freezes, thaws or loses a streak; no heal
      const none = activePlayers(g, Number.POSITIVE_INFINITY).map((p) => ({ id: p.id, streak: p.streak, best: p.best, frozen: p.frozen, dmg: p.dmg, right: p.right, thaws: p.thaws, active: true }));
      const outcomes = new Map(none.map((p) => [p.id, { correct: false, none: true, dmg: 0, thawed: false, frozen: p.frozen }]));
      q.closed = { players: none, outcomes, hits: [], frozenNow: [], thawed: [], counts: q.options.map(() => 0), right: 0, hp: g.hp, healed: 0, phase: g.phase, phaseChanged: null, defeated: false, rankBefore: ranked, void: true };
      setState(g, 'reveal');
      return;
    }
    const players = activePlayers(g, Number.POSITIVE_INFINITY).map((p) => ({ id: p.id, streak: p.streak, best: p.best, frozen: p.frozen, dmg: p.dmg, right: p.right, thaws: p.thaws, active: p.joinedAt <= q.opensAt }));
    const out = closeQuestion({
      players,
      answers: [...q.answers.entries()].map(([playerId, a]) => ({ playerId, choice: a.choice, elapsedMs: a.elapsedMs })),
      key: q.key,
      optionCount: q.options.length,
      timeS: g.settings.time_s,
      speedOn: g.settings.speed,
      hp: g.hp,
      hpMax: g.hpMax,
      qPhase: q.phase,
      phase: g.phase,
    });
    for (const p of out.players) Object.assign(g.players.get(p.id)!, { streak: p.streak, best: p.best, frozen: p.frozen, dmg: p.dmg, right: p.right, thaws: p.thaws });
    g.hp = out.hp;
    g.phase = out.phase;
    q.closed = { ...out, rankBefore: ranked };
    setState(g, 'reveal');
  }

  function advance(g: FakeGame) {
    const q = g.questions[g.qi];
    if (g.state === 'lobby') startQuestion(g, 0);
    else if (g.state === 'reveal') {
      if (q?.closed?.defeated || g.qi >= g.bank.length - 1) toPodium(g);
      else setState(g, 'leaderboard');
    } else if (g.state === 'leaderboard') startQuestion(g, g.qi + 1);
    else if (g.state === 'podium') setState(g, 'ended');
  }

  function toPodium(g: FakeGame) {
    const ranked = rankedPlayers(g);
    const won = g.hp === 0;
    g.won = won;
    ranked.forEach((p, i) => {
      g.finals.set(p.id, unlocksAfter({ place: i + 1, dmg: p.dmg, best: p.best, thaws: p.thaws, games: 1, wins: won ? 1 : 0 }, []));
    });
    setState(g, 'podium');
  }

  function rankedPlayers(g: FakeGame) {
    // Kicked players are out of the top, the places and the podium; their damage stays in the HP (W1, 20.10).
    return rank([...g.players.values()].filter((p) => !p.kicked).map((p) => ({ ...p, joinedAt: p.joinedAt })));
  }
  function rankIds(g: FakeGame) {
    return rankedPlayers(g).map((p) => p.id);
  }

  function top(g: FakeGame): TopRow[] {
    const now = rankIds(g);
    const before = g.questions[g.qi]?.closed?.rankBefore ?? now;
    return now.slice(0, 5).map((id, i) => {
      const p = g.players.get(id)!;
      const was = before.indexOf(id);
      return { player_id: id, name: p.name, look: p.look, dmg: p.dmg, move: was >= 0 && g.qi > 0 ? was - i : 0 };
    });
  }

  function answerNow(g: FakeGame, p: FakePlayer, qi: number, choice: number): AnswerAck {
    settle(g);
    const q = g.questions[qi];
    if (p.kicked) throw new LiveError('42501', 'kicked', 403);
    if (!q || qi !== g.qi) throw new LiveError('ML004', 'bad_qi');
    if (q.stand) throw new LiveError('ML004', 'stand');
    const now = clock.now();
    if (g.state === 'countdown' || now < q.opensAt) throw new LiveError('ML004', 'early');
    if (g.state !== 'open') throw new LiveError('ML004', now > q.closesAt ? 'late' : 'not_open');
    if (now > q.closesAt + GRACE_MS) throw new LiveError('ML004', 'late');
    if (p.joinedAt > q.opensAt) throw new LiveError('ML004', 'not_joined_yet');
    if (q.answers.has(p.id)) throw new LiveError('ML004', 'twice');
    if (!Number.isInteger(choice) || choice < 0 || choice >= q.options.length) throw new LiveError('22023', 'choice');
    const elapsedMs = Math.min(Math.max(now - q.opensAt, 0), g.settings.time_s * 1000);
    q.answers.set(p.id, { choice, elapsedMs });
    const active = activePlayers(g, q.opensAt);
    if (active.every((a) => q.answers.has(a.id))) closeNow(g);
    return { accepted: true, answered: q.answers.size, now: iso(now) };
  }

  function autoStep(g: FakeGame) {
    const s = g.state;
    if (s === 'reveal') later(g, 5000, () => g.state === 'reveal' && advance(g));
    if (s === 'leaderboard') later(g, 3000, () => g.state === 'leaderboard' && advance(g));
  }

  function addBots(g: FakeGame, count: number, spreadMs: number) {
    for (let i = 0; i < count; i += 1) {
      const name = BOT_NAMES[i % BOT_NAMES.length];
      const bot = { skill: i === 0 ? 0.95 : 0.55 + random() * 0.4, speed: i === 0 ? 0.85 : 0.35 + random() * 0.5 };
      const join = () => {
        if (g.state !== 'lobby' && g.state !== 'countdown') return;
        const id = uuid();
        g.players.set(id, { id, name, look: defaultLook(name), joinedAt: clock.now(), kicked: false, streak: 0, best: 0, frozen: false, dmg: 0, right: 0, thaws: 0, bot, token: null });
        if (g.state === 'lobby') bump(g);
      };
      if (spreadMs <= 0 || i < 6) join();
      else later(g, Math.round((i / count) * spreadMs + random() * 400), join);
    }
  }

  function newGame(settings: Settings, bank: readonly FakeQuestion[], pin?: string, auto = false): FakeGame {
    const id = uuid();
    const g: FakeGame = {
      id,
      pin: pin ?? String(100000 + Math.floor(random() * 900000)),
      topic: token().slice(0, 22),
      hostToken: token(),
      settings,
      bank,
      questions: [],
      state: 'lobby',
      stateAt: clock.now(),
      qi: -1,
      rev: 1,
      createdAt: clock.now(),
      hp: 0,
      hpMax: 0,
      phase: 0,
      players: new Map(),
      timers: [],
      finals: new Map(),
      auto,
      won: null,
    };
    games.set(id, g);
    addBots(g, botCount, options.latencyMs === 0 ? 0 : 8000);
    return g;
  }

  if (options.demoPin !== null) newGame({ ...DEFAULT_SETTINGS }, options.questions ?? EXAMPLE_QUESTIONS, options.demoPin ?? '482913', options.autoHost ?? true);

  function host(game: Uuid, hostToken: string): FakeGame {
    const g = games.get(game);
    if (!g) throw new LiveError('P0002', 'game', 404);
    if (g.hostToken !== hostToken) throw new LiveError('42501', 'host', 403);
    settle(g);
    return g;
  }
  function player(game: Uuid, tok: string): { g: FakeGame; p: FakePlayer } {
    const g = games.get(game);
    if (!g) throw new LiveError('P0002', 'game', 404);
    settle(g);
    const p = [...g.players.values()].find((x) => x.token === tok);
    if (!p) throw new LiveError('P0002', 'token', 404);
    if (p.kicked) throw new LiveError('42501', 'kicked', 403);
    return { g, p };
  }

  function questionView(g: FakeGame) {
    const q = g.questions[g.qi];
    if (!q || g.state === 'lobby' || g.state === 'podium' || g.state === 'ended') return null;
    return { qi: g.qi, text: q.text, options: q.options, opens_at: iso(q.opensAt), closes_at: iso(q.closesAt), phase: q.phase, picture: null, ...(roundsOf(g) ? { stand: q.stand } : {}) };
  }

  function base(g: FakeGame) {
    const q = g.questions[g.qi];
    const shown = g.state === 'leaderboard' || g.state === 'podium' || (g.state === 'ended' && g.won !== null);
    return {
      rev: g.rev,
      now: iso(clock.now()),
      state: g.state,
      mode: g.settings.mode,
      qi: g.qi,
      q_count: g.bank.length,
      time_s: g.settings.time_s,
      speed: g.settings.speed,
      players: [...g.players.values()].filter((p) => !p.kicked).length,
      answered: q ? q.answers.size : 0,
      question: questionView(g),
      boss: { hp: g.hp, hp_max: g.hpMax, phase: g.phase, defeated: g.hp === 0 && g.hpMax > 0 },
      top: shown ? top(g) : null,
      ...(roundsOf(g) ? { mixed: { every: g.settings.stand_every as 3 | 5 | 10, rounds: roundsOf(g)! } } : {}),
    };
  }

  /** The closed question's public part; null while it is not closed — the key is never in it before. */
  function closedPart(g: FakeGame) {
    const q = g.questions[g.qi];
    const showing = g.state === 'reveal' || g.state === 'leaderboard' || g.state === 'podium' || g.state === 'ended';
    if (!q?.closed || !showing) return null;
    return { q, c: q.closed };
  }

  function playerState(g: FakeGame, p: FakePlayer): PlayerState {
    const b = base(g);
    const ids = rankIds(g);
    const q = g.questions[g.qi];
    const cp = closedPart(g);
    const outcome = cp?.c.outcomes.get(p.id);
    const everyone = rankedPlayers(g);
    return {
      ...b,
      me: { player_id: p.id, name: p.name, look: p.look, dmg: p.dmg, streak: p.streak, best: p.best, frozen: p.frozen, place: ids.indexOf(p.id) + 1, choice: q?.answers.get(p.id)?.choice ?? null },
      result: cp
        ? {
            qi: g.qi,
            key: cp.q.key,
            counts: cp.c.counts,
            right: cp.c.right,
            healed: cp.c.healed,
            phase_changed: cp.c.phaseChanged,
            ...(roundsOf(g) ? { stand: cp.q.stand, void: cp.c.void === true } : {}),
            correct: outcome?.correct ?? false,
            none: outcome?.none ?? true,
            dmg: outcome?.dmg ?? 0,
            thawed: outcome?.thawed ?? false,
            frozen: outcome?.frozen ?? p.frozen,
          }
        : null,
      final:
        (g.state === 'podium' || g.state === 'ended') && g.won !== null
          ? {
              won: g.won,
              place: ids.indexOf(p.id) + 1,
              dmg: p.dmg,
              best: p.best,
              right: p.right,
              accuracy_pct: accuracyPct(everyone.reduce((s, x) => s + x.right, 0), everyone.length, g.qi + 1),
              unlocked_now: g.finals.get(p.id) ?? [],
            }
          : null,
      crowd: g.state === 'lobby' ? [...g.players.values()].filter((x) => x.id !== p.id && !x.kicked).slice(0, 40).map((x) => x.look) : null,
    };
  }

  function hostState(g: FakeGame): HostState {
    const b = base(g);
    const q = g.questions[g.qi];
    const cp = closedPart(g);
    const everyone = rankedPlayers(g);
    return {
      ...b,
      pin: g.pin,
      topic: g.topic,
      settings: g.settings,
      skipped: 0,
      roster: [...g.players.values()]
        .filter((p) => !p.kicked)
        .map((p) => ({ player_id: p.id, name: p.name, look: p.look, dmg: p.dmg, right: p.right, streak: p.streak, frozen: p.frozen, joined_at: iso(p.joinedAt), answered: !!q?.answers.has(p.id) })),
      answered_ids: g.state === 'open' && q ? [...q.answers.keys()] : [],
      result: cp
        ? { qi: g.qi, key: cp.q.key, counts: cp.c.counts, right: cp.c.right, healed: cp.c.healed, phase_changed: cp.c.phaseChanged, hits: cp.c.hits, frozen_now: cp.c.frozenNow, thawed: cp.c.thawed, ...(roundsOf(g) ? { stand: cp.q.stand, void: cp.c.void === true } : {}) }
        : null,
      final: (g.state === 'podium' || g.state === 'ended') && g.won !== null ? { won: g.won, accuracy_pct: accuracyPct(everyone.reduce((s, x) => s + x.right, 0), everyone.length, g.qi + 1) } : null,
    };
  }

  const api = {
    kind: 'fake' as const,
    clock,
    peek: (game: Uuid) => games.get(game),

    create(source: GameSource, settings: Settings): Promise<CreateResult> {
      if (!source || typeof source !== 'object') return fail(new LiveError('22023', 'source'));
      // A game counts as open unless it is on the podium or ended (W1, 20.10).
      const open = [...games.values()].filter((g) => g.state !== 'ended' && g.state !== 'podium' && !g.auto).length;
      if (open >= 3) return fail(new LiveError('ML009'));
      const g = newGame({ ...DEFAULT_SETTINGS, ...settings }, options.questions ?? EXAMPLE_QUESTIONS);
      return reply({ game_id: g.id, pin: g.pin, topic: g.topic, host_token: g.hostToken, q_count: g.bank.length, skipped: 0, join_url: `https://ludosiel-studyforge.hf.space/play?pin=${g.pin}`, tg_url: `https://t.me/Meldyteach_bot/play?startapp=${g.pin}` });
    },

    hostState(game: Uuid, hostToken: string, sinceRev?: number): Promise<HostState | Unchanged> {
      try {
        const g = host(game, hostToken);
        if (sinceRev === g.rev && g.state !== 'lobby' && g.state !== 'open') return reply({ rev: g.rev, now: iso(clock.now()), unchanged: true as const });
        return reply(hostState(g));
      } catch (e) {
        return fail(e as LiveError);
      }
    },

    next(game: Uuid, hostToken: string, expect: GameState): Promise<HostState> {
      try {
        const g = host(game, hostToken);
        if (g.state !== expect) throw new LiveError('ML011', g.state, 409);
        if (g.state === 'lobby' && g.players.size === 0) throw new LiveError('ML011', 'empty', 409);
        if (g.state === 'countdown' || g.state === 'open' || g.state === 'ended') throw new LiveError('ML011', g.state, 409);
        advance(g);
        return reply(hostState(g));
      } catch (e) {
        return fail(e as LiveError);
      }
    },

    kick(game: Uuid, hostToken: string, who: Uuid): Promise<void> {
      try {
        const g = host(game, hostToken);
        const p = g.players.get(who);
        if (!p) throw new LiveError('P0002', 'player', 404);
        p.kicked = true;
        bump(g);
        return reply(undefined);
      } catch (e) {
        return fail(e as LiveError);
      }
    },

    end(game: Uuid, hostToken: string): Promise<void> {
      try {
        const g = host(game, hostToken);
        g.timers.forEach((t) => clock.clearTimeout(t));
        setState(g, 'ended');
        return reply(undefined);
      } catch (e) {
        return fail(e as LiveError);
      }
    },

    /** As `live_tg_post` (W1, 20.10): «posting», one post a minute per game (ML005/post, 429 with the wait). */
    tgPost(game: Uuid, chatId: number): Promise<TgPostResult> {
      try {
        const g = games.get(game);
        if (!g) throw new LiveError('P0002', 'game', 404);
        settle(g);
        if (g.state === 'ended') throw new LiveError('ML002', 'ended');
        if (!Number.isInteger(chatId)) throw new LiveError('22023', 'chat_id');
        const now = clock.now();
        const last = posts.get(game);
        if (last !== undefined && now - last < POST_EVERY_MS) throw new LiveError('ML005', 'post', 429, Math.ceil((POST_EVERY_MS - (now - last)) / 1000));
        posts.set(game, now);
        return reply({ status: 'posting' as const });
      } catch (e) {
        return fail(e as LiveError);
      }
    },

    join(pin: string, name: string, tok: string, look: Look | null): Promise<JoinResult> {
      try {
        const g = [...games.values()].find((x) => x.pin === pin && x.state !== 'ended');
        if (!g) throw new LiveError('P0002', 'pin', 404);
        settle(g);
        if (g.state === 'ended') throw new LiveError('ML002', 'ended');
        if (clock.now() - g.createdAt > GAME_TTL_MS) throw new LiveError('ML002', 'expired');
        if (!/^[A-Za-z0-9_-]{43}$/.test(tok)) throw new LiveError('22023', 'token');
        const n = checkName(name);
        if (!n.ok) throw new LiveError('ML006', n.reason);
        const l = look ? checkLook(look) : { ok: true as const, look: defaultLook(n.name) };
        if (!l.ok) throw new LiveError('ML007', l.reason);
        let p = [...g.players.values()].find((x) => x.token === tok);
        if (!p) {
          if ([...g.players.values()].filter((x) => !x.kicked).length >= MAX_PLAYERS) throw new LiveError('ML001');
          p = { id: uuid(), name: n.name, look: l.look, joinedAt: clock.now(), kicked: false, streak: 0, best: 0, frozen: false, dmg: 0, right: 0, thaws: 0, bot: null, token: tok };
          g.players.set(p.id, p);
          // a late player adds HP for the questions not yet opened — only while the boss is alive (no revival, W1 20.10)
          if (g.hpMax > 0 && g.hp > 0) {
            const notOpened = g.bank.length - g.qi - (g.state === 'countdown' ? 0 : 1);
            const add = HP_PER_ANSWER * Math.max(0, notOpened);
            g.hpMax += add;
            g.hp += add;
          }
          bump(g);
          if (g.auto && g.state === 'lobby') later(g, 4000, () => g.state === 'lobby' && advance(g));
        }
        return reply({ game_id: g.id, player_id: p.id, topic: g.topic, state: g.state, rev: g.rev, now: iso(clock.now()), name: p.name, look: p.look, wardrobe: null });
      } catch (e) {
        return fail(e as LiveError);
      }
    },

    setLook(game: Uuid, tok: string, look: Look): Promise<Look> {
      try {
        const { g, p } = player(game, tok);
        if (g.state !== 'lobby') throw new LiveError('ML004', 'not_open');
        const l = checkLook(look);
        if (!l.ok) throw new LiveError('ML007', l.reason);
        p.look = l.look;
        bump(g);
        return reply(p.look);
      } catch (e) {
        return fail(e as LiveError);
      }
    },

    answer(game: Uuid, tok: string, qi: number, choice: number): Promise<AnswerAck> {
      try {
        const { g, p } = player(game, tok);
        return reply(answerNow(g, p, qi, choice));
      } catch (e) {
        return fail(e as LiveError);
      }
    },

    state(game: Uuid, tok: string, sinceRev?: number): Promise<PlayerState | Unchanged> {
      try {
        const { g, p } = player(game, tok);
        if (sinceRev === g.rev && g.state !== 'open') return reply({ rev: g.rev, now: iso(clock.now()), unchanged: true as const });
        return reply(playerState(g, p));
      } catch (e) {
        return fail(e as LiveError);
      }
    },

    review(game: Uuid, tok: string): Promise<Review> {
      try {
        const { g, p } = player(game, tok);
        if (g.state !== 'podium' && g.state !== 'ended') throw new LiveError('ML004', 'not_open');
        const items = g.questions
          .map((q, qi) => ({ q, qi }))
          .filter(({ q }) => q?.closed)
          .map(({ q, qi }) => {
            const choice = q.answers.get(p.id)?.choice ?? null;
            return { qi, text: q.text, options: q.options, key: q.key, choice, correct: choice === q.key, ...(q.stand ? { stand: true } : {}) };
          });
        return reply({ items });
      } catch (e) {
        return fail(e as LiveError);
      }
    },

    subscribe(topic: string, onHint: (h: Hint) => void, onLink?: (connected: boolean) => void): () => void {
      const set = listeners.get(topic) ?? new Set();
      set.add(onHint);
      listeners.set(topic, set);
      clock.setTimeout(() => onLink?.(true), 0);
      return () => {
        set.delete(onHint);
      };
    },
  };
  return api;
}
