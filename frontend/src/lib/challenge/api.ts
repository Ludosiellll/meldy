/**
 * «Соревнование в своё время»: the client of the challenge_* RPCs (docs/live/CHALLENGE.md) and an in-page fake with the
 * same rules (lib/challenge/rules.ts) for the screens' tests and `?fake=1`. Errors are the live game's LiveError, read
 * from the body's `code` (lib/live/real.ts liveError): P0002 404, ML00x 400/429, 28000 401, 42501 403.
 */
import { supabase } from '../supabase';
import { liveError } from '../live/real';
import { liveShare } from '../live/rules';
import { LiveError, type AnswerInput, type Look, type PracticeResult, type Review, type ReviewItem } from '../live/types';
import { checkLook, checkName, defaultLook } from '../live/rules';
import { READY_MS, GRACE_MS, board as boardOf, freshRun, placeOf, scoreAnswer, type RunNumbers } from './rules';
import type {
  Board,
  ChallengeApi,
  ChallengeInfo,
  ChallengeResults,
  ChallengeSettings,
  CreateChallengeResult,
  MineItem,
  RunResult,
  RunState,
} from './types';
import type { GameSource } from '../live/types';

async function rpc<T>(name: string, args: Record<string, unknown>): Promise<T> {
  let result: { data: unknown; error: unknown; status?: number };
  try {
    result = await supabase.rpc(name, args);
  } catch (error) {
    const kind = error instanceof Error ? error.name : '';
    throw new LiveError(kind === 'TypeError' || kind === 'AbortError' ? 'network' : 'unknown', null, 0);
  }
  if (result.error) throw liveError(result.error, typeof result.status === 'number' ? result.status : 0);
  return result.data as T;
}

export function createRealChallengeApi(): ChallengeApi {
  return {
    kind: 'real',
    create: (source, settings) => rpc<CreateChallengeResult>('challenge_create', { p_source: source, p_settings: settings }),
    close: (challenge) => rpc<ChallengeInfo>('challenge_close', { p_challenge: challenge }),
    remove: async (challenge, run) => {
      await rpc('challenge_remove', { p_challenge: challenge, p_run: run });
    },
    results: (challenge) => rpc<ChallengeResults>('challenge_results', { p_challenge: challenge }),
    mine: async (container) => (await rpc<{ items: MineItem[] }>('challenges_mine', { p_container: container ?? null })).items,
    info: (code) => rpc<ChallengeInfo>('challenge_info', { p_code: code }),
    join: (code, name, token, look) => rpc<RunState>('challenge_join', { p_code: code, p_name: name, p_token: token, p_look: look }),
    state: (code, token) => rpc<RunState>('challenge_state', { p_code: code, p_token: token }),
    next: (code, token, qi) => rpc<RunState>('challenge_next', { p_code: code, p_token: token, p_qi: qi }),
    answer: (code, token, qi, answer) => rpc<RunState>('challenge_answer', { p_code: code, p_token: token, p_qi: qi, p_answer: answer }),
    board: (code, token) => rpc<Board>('challenge_board', { p_code: code, p_token: token ?? null }),
    review: (code, token) => rpc<Review>('challenge_review', { p_code: code, p_token: token }),
    practice: (code, token) => rpc<PracticeResult>('challenge_practice', { p_code: code, p_token: token }),
  };
}

// ─────────────────────────────────────────── the fake ───────────────────────────────────────────

export interface FakeQuestion {
  text: string;
  kind?: 'multiple' | 'short' | 'number';
  options: string[];
  key: number;
  keys?: number[];
  forms?: string[];
  tolerance?: number | null;
  unit?: string | null;
  explanation?: string;
}

/** The fake's test: one of each kind the challenge plays. */
export const FAKE_QUESTIONS: readonly FakeQuestion[] = [
  {
    text: 'Какая команда отменяет транзакцию?',
    options: ['ROLLBACK', 'COMMIT', 'SAVEPOINT', 'GRANT'],
    key: 0,
    explanation: 'ROLLBACK отменяет все изменения с начала транзакции. COMMIT их сохраняет.',
  },
  {
    text: 'Какие команды относятся к DML?',
    kind: 'multiple',
    options: ['INSERT', 'CREATE', 'UPDATE', 'DROP'],
    key: 0,
    keys: [0, 2],
    explanation: 'DML меняет данные: INSERT, UPDATE, DELETE. CREATE и DROP меняют схему, это DDL.',
  },
  {
    text: 'Как называется язык запросов к реляционным базам данных? Ответ — аббревиатура.',
    kind: 'short',
    options: [],
    key: -1,
    forms: ['SQL'],
    explanation: 'SQL — Structured Query Language.',
  },
  {
    text: 'Сколько байт в килобайте по стандарту IEC (кибибайт)?',
    kind: 'number',
    options: [],
    key: -1,
    forms: ['1024'],
    tolerance: 0,
    unit: 'байт',
  },
  {
    text: 'Что гарантирует буква I в ACID?',
    options: ['Транзакция выполняется целиком', 'Параллельные транзакции не мешают друг другу', 'Изменения сохраняются после сбоя', 'Данные соблюдают ограничения'],
    key: 1,
    explanation: 'I — isolation, изоляция.',
  },
];

interface FakeAnswer {
  qi: number;
  openedAt: number;
  opensAt: number;
  closesAt: number;
  phase: 0 | 1 | 2;
  at: number | null;
  choice?: number;
  picks?: number[];
  typed?: string;
  result: RunResult | null;
}

interface FakeRun {
  id: string;
  token: string;
  name: string;
  look: Look;
  qi: number;
  numbers: RunNumbers;
  answers: FakeAnswer[];
  finishedAt: number | null;
  removed: boolean;
  joinedAt: number;
}

interface FakeChallenge {
  id: string;
  code: string;
  title: string;
  containerId: string;
  questions: FakeQuestion[];
  timeS: number;
  speed: boolean;
  calm: boolean;
  deadline: number;
  closedAt: number | null;
  createdAt: number;
  runs: FakeRun[];
}

export interface FakeChallengeOptions {
  /** The clock (ms); Date.now by default. */
  now?: () => number;
  questions?: readonly FakeQuestion[];
  /** Finished runs of other people already on the table: [name, points, right, time ms]. */
  others?: ReadonlyArray<[string, number, number, number]>;
  /** The reading time before the answers open (READY_MS; the tests take 0). */
  readyMs?: number;
}

const iso = (ms: number) => new Date(ms).toISOString();
const norm = (s: string) => s.trim().toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').replace(/\.$/, '');
const numberOf = (s: string) => {
  const t = s.replace(/\s/g, '').replace(',', '.').replace('−', '-').replace(/[^0-9.+-].*$/, '');
  return /^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(t) ? Number(t) : NaN;
};

/** The in-page challenge server: one demo challenge (code `demxchamp123`), the battle's rules for one player. */
export function createFakeChallengeApi(options: FakeChallengeOptions = {}): ChallengeApi {
  const now = options.now ?? (() => Date.now());
  const readyMs = options.readyMs ?? READY_MS;
  let seq = 0;
  const id = (p: string) => `00000000-0000-4000-8000-${p}${String(++seq).padStart(12 - p.length, '0')}`;
  const challenges: FakeChallenge[] = [];
  const make = (title: string, code: string, questions: readonly FakeQuestion[], s: { timeS: number; speed: boolean; calm: boolean; deadline: number }): FakeChallenge => {
    const c: FakeChallenge = {
      id: id('c'),
      code,
      title,
      containerId: '00000000-0000-4000-8000-00000000c001',
      questions: questions.map((q) => ({ ...q })),
      timeS: s.timeS,
      speed: s.calm ? false : s.speed,
      calm: s.calm,
      deadline: s.deadline,
      closedAt: null,
      createdAt: now(),
      runs: [],
    };
    challenges.push(c);
    return c;
  };
  const demo = make('Базы данных', 'demxchamp123', options.questions ?? FAKE_QUESTIONS, { timeS: 20, speed: true, calm: false, deadline: now() + 3 * 24 * 3600 * 1000 });
  (options.others ?? [
    ['Аня', 512, 5, 38000],
    ['Тимур', 437, 4, 52000],
    ['Вера', 298, 3, 61000],
  ]).forEach(([name, dmg, right, timeMs], i) => {
    demo.runs.push({
      id: id('r'),
      token: `other-${i}`,
      name,
      look: defaultLook(name),
      qi: demo.questions.length - 1,
      numbers: { ...freshRun(demo.questions.length), dmg, right, timeMs },
      answers: [],
      finishedAt: now() - (i + 1) * 3600_000,
      removed: false,
      joinedAt: now() - (i + 2) * 3600_000,
    });
  });

  const over = (c: FakeChallenge) => c.closedAt !== null || now() >= c.deadline;
  const finished = (c: FakeChallenge) => c.runs.filter((r) => r.finishedAt !== null && !r.removed);
  const infoOf = (c: FakeChallenge): ChallengeInfo => ({
    code: c.code,
    title: c.title,
    q_count: c.questions.length,
    time_s: c.timeS,
    speed: c.speed,
    ...(c.calm ? { calm: true as const } : {}),
    deadline: iso(c.deadline),
    state: over(c) ? 'over' : 'open',
    over: c.closedAt !== null && c.closedAt < c.deadline ? 'closed' : now() >= c.deadline ? 'deadline' : null,
    finished: finished(c).length,
    playing: c.runs.filter((r) => r.finishedAt === null && !r.removed && r.qi >= 0).length,
  });
  const byCode = (code: string): FakeChallenge => {
    const c = challenges.find((x) => x.code === code);
    if (!c) throw new LiveError('P0002', 'code', 404);
    return c;
  };
  const runOf = (c: FakeChallenge, token: string): FakeRun => {
    const r = c.runs.find((x) => x.token === token);
    if (!r) throw new LiveError('P0002', 'token', 404);
    if (r.removed) throw new LiveError('42501', 'removed', 403);
    settle(c, r);
    return r;
  };
  const shareOf = (q: FakeQuestion, a: AnswerInput): number => {
    if ('picks' in a) return liveShare(a.picks, q.keys ?? [q.key]);
    if ('choice' in a) return (q.keys ?? [q.key]).includes(a.choice) ? 1 : 0;
    if (q.kind === 'number') {
      const v = numberOf(a.text);
      return (q.forms ?? []).some((f) => Math.abs(Number(f) - v) <= (q.tolerance ?? 0) + 1e-9) ? 1 : 0;
    }
    return (q.forms ?? []).some((f) => norm(f) === norm(a.text)) ? 1 : 0;
  };
  const grade = (c: FakeChallenge, r: FakeRun, a: FakeAnswer, input: AnswerInput | null, at: number) => {
    const q = c.questions[a.qi];
    const scored = scoreAnswer(r.numbers, input ? { share: shareOf(q, input), elapsedMs: at - a.opensAt } : null, a.phase, {
      timeS: c.timeS,
      speed: c.speed,
      calm: c.calm,
    });
    r.numbers = scored.run;
    const share = input ? shareOf(q, input) : 0;
    a.at = input ? at : null;
    if (input && 'picks' in input) a.picks = input.picks;
    else if (input && 'choice' in input) a.choice = input.choice;
    else if (input && 'text' in input) a.typed = input.text.trim();
    a.result = {
      qi: a.qi,
      key: q.key,
      ...(q.kind === 'multiple' ? { keys: q.keys, share } : {}),
      ...(q.kind === 'short' ? { forms: q.forms } : {}),
      ...(q.kind === 'number' ? { forms: q.forms, tolerance: q.tolerance ?? null, unit: q.unit ?? null } : {}),
      correct: scored.result.correct,
      none: !input,
      dmg: scored.result.dmg,
      thawed: scored.result.thawed,
      frozen: scored.result.frozen,
      healed: scored.result.healed,
      phase_changed: scored.result.phaseChanged,
      elapsed_ms: input ? Math.min(Math.max(at - a.opensAt, 0), c.timeS * 1000) : null,
      ...(q.explanation ? { explanation: q.explanation } : {}),
    };
  };
  const settle = (c: FakeChallenge, r: FakeRun) => {
    if (r.finishedAt !== null || r.qi < 0) return;
    const a = r.answers[r.qi];
    if (a && !a.result && now() > a.closesAt + GRACE_MS) grade(c, r, a, null, a.closesAt);
    if (a?.result && (r.qi >= c.questions.length - 1 || over(c))) r.finishedAt = a.at ?? Math.min(now(), a.closesAt + GRACE_MS);
  };
  const stateOf = (c: FakeChallenge, r: FakeRun): RunState => {
    const q = r.qi >= 0 ? c.questions[r.qi] : null;
    const a = r.qi >= 0 ? r.answers[r.qi] : null;
    const fin = finished(c).map((x) => ({ dmg: x.numbers.dmg, right: x.numbers.right, timeMs: x.numbers.timeMs }));
    return {
      now: iso(now()),
      challenge: infoOf(c),
      run: {
        name: r.name,
        look: r.look,
        qi: r.qi,
        dmg: r.numbers.dmg,
        right: r.numbers.right,
        streak: r.numbers.streak,
        best: r.numbers.best,
        frozen: r.numbers.frozen,
        time_ms: r.numbers.timeMs,
        boss: { hp: r.numbers.hp, hp_max: r.numbers.hpMax, phase: r.numbers.phase, defeated: r.numbers.hp === 0 },
        finished: r.finishedAt !== null,
        place: r.finishedAt !== null && !r.removed ? placeOf({ dmg: r.numbers.dmg, right: r.numbers.right, timeMs: r.numbers.timeMs }, fin) : null,
      },
      question:
        q && a
          ? {
              qi: r.qi,
              text: q.text,
              options: q.options,
              opens_at: iso(a.opensAt),
              closes_at: iso(a.closesAt),
              phase: a.phase,
              ...(q.kind === 'multiple' ? { kind: 'multiple' as const, multi: (q.keys ?? []).length } : {}),
              ...(q.kind === 'short' ? { kind: 'short' as const } : {}),
              ...(q.kind === 'number' ? { kind: 'number' as const, unit: q.unit ?? null } : {}),
            }
          : null,
      answer:
        a && a.at !== null
          ? { ...(a.picks ? { picks: a.picks } : a.typed !== undefined ? { typed: a.typed } : { choice: a.choice }), elapsed_ms: a.result?.elapsed_ms ?? null }
          : null,
      result: a?.result ?? null,
    };
  };

  return {
    kind: 'fake',
    async create(_source: GameSource, settings: ChallengeSettings) {
      const deadline = Date.parse(settings.deadline);
      if (!Number.isFinite(deadline) || deadline < now() + 5 * 60_000) throw new LiveError('22023', 'deadline');
      const code = `demo${String(challenges.length).padStart(8, '0')}`.replace(/[ilou]/g, 'x');
      const c = make('Базы данных', code, options.questions ?? FAKE_QUESTIONS, { timeS: settings.time_s, speed: settings.speed, calm: !!settings.calm, deadline });
      return { challenge_id: c.id, code: c.code, path: `/s/${c.code}`, url: `${window.location.origin}/s/${c.code}`, q_count: c.questions.length, skipped: 0, deadline: iso(c.deadline) };
    },
    async close(challenge) {
      const c = challenges.find((x) => x.id === challenge);
      if (!c) throw new LiveError('P0002', 'challenge', 404);
      if (!over(c)) c.closedAt = now();
      return infoOf(c);
    },
    async remove(challenge, run) {
      const c = challenges.find((x) => x.id === challenge);
      const r = c?.runs.find((x) => x.id === run);
      if (!r) throw new LiveError('P0002', 'run', 404);
      r.removed = true;
    },
    async results(challenge) {
      const c = challenges.find((x) => x.id === challenge);
      if (!c) throw new LiveError('P0002', 'challenge', 404);
      c.runs.forEach((r) => settle(c, r));
      const fin = finished(c).map((x) => ({ dmg: x.numbers.dmg, right: x.numbers.right, timeMs: x.numbers.timeMs }));
      const runs = c.runs
        .slice()
        .sort((a, b) => Number(a.removed) - Number(b.removed) || Number(a.finishedAt === null) - Number(b.finishedAt === null) || b.numbers.dmg - a.numbers.dmg || b.numbers.right - a.numbers.right || a.numbers.timeMs - b.numbers.timeMs)
        .map((r) => ({
          run_id: r.id,
          place: r.finishedAt !== null && !r.removed ? placeOf({ dmg: r.numbers.dmg, right: r.numbers.right, timeMs: r.numbers.timeMs }, fin) : null,
          name: r.name,
          look: r.look,
          dmg: r.numbers.dmg,
          right: r.numbers.right,
          time_ms: r.numbers.timeMs,
          answered: r.answers.filter((a) => a.result).length || (r.finishedAt !== null ? c.questions.length : 0),
          joined_at: iso(r.joinedAt),
          finished_at: r.finishedAt !== null ? iso(r.finishedAt) : null,
          removed: r.removed,
        }));
      return {
        ...infoOf(c),
        challenge_id: c.id,
        container_id: c.containerId,
        quiz_id: null,
        skipped: 0,
        path: `/s/${c.code}`,
        url: `${window.location.origin}/s/${c.code}`,
        created_at: iso(c.createdAt),
        closed_at: c.closedAt !== null ? iso(c.closedAt) : null,
        runs,
        questions: c.questions.map((q, qi) => {
          const graded = c.runs.filter((r) => !r.removed).map((r) => r.answers[qi]?.result).filter((x): x is RunResult => !!x);
          return {
            qi,
            text: q.text,
            kind: q.kind ?? 'single',
            answered: graded.length,
            right: graded.filter((x) => x.correct).length,
            partial: graded.filter((x) => !x.correct && (x.share ?? 0) > 0).length,
          };
        }),
      };
    },
    async mine() {
      return challenges.map((c) => {
        const top = boardOf(finished(c).map((r) => ({ id: r.id, dmg: r.numbers.dmg, right: r.numbers.right, timeMs: r.numbers.timeMs, finishedAt: r.finishedAt ?? 0, r })))[0];
        return {
          ...infoOf(c),
          challenge_id: c.id,
          container_id: c.containerId,
          path: `/s/${c.code}`,
          created_at: iso(c.createdAt),
          leader: top ? { name: top.r.name, look: top.r.look, dmg: top.r.numbers.dmg } : null,
        };
      });
    },
    async info(code) {
      return { ...infoOf(byCode(code)), now: iso(now()) };
    },
    async join(code, name, token, look) {
      const c = byCode(code);
      const old = c.runs.find((r) => r.token === token);
      if (old) {
        if (old.removed) throw new LiveError('42501', 'removed', 403);
        settle(c, old);
        return stateOf(c, old);
      }
      if (over(c)) throw new LiveError('ML002', c.closedAt !== null && c.closedAt < c.deadline ? 'closed' : 'deadline');
      if (c.runs.filter((r) => !r.removed).length >= 300) throw new LiveError('ML001');
      const checked = checkName(name);
      if (!checked.ok) throw new LiveError('ML006', checked.reason);
      const l = look ? checkLook(look, []) : null;
      if (l && !l.ok) throw new LiveError('ML007', l.reason);
      const r: FakeRun = {
        id: id('r'),
        token,
        name: checked.name,
        look: l && l.ok ? l.look : defaultLook(checked.name),
        qi: -1,
        numbers: freshRun(c.questions.length),
        answers: [],
        finishedAt: null,
        removed: false,
        joinedAt: now(),
      };
      c.runs.push(r);
      return stateOf(c, r);
    },
    async state(code, token) {
      const c = byCode(code);
      return stateOf(c, runOf(c, token));
    },
    async next(code, token, qi) {
      const c = byCode(code);
      const r = runOf(c, token);
      if (r.finishedAt !== null || (qi === r.qi && r.qi >= 0)) return stateOf(c, r);
      if (qi !== r.qi + 1 || qi >= c.questions.length) throw new LiveError('ML004', 'bad_qi');
      if (r.qi >= 0 && !r.answers[r.qi]?.result) throw new LiveError('ML004', 'not_done');
      if (over(c)) {
        if (r.qi < 0) throw new LiveError('ML002', c.closedAt !== null ? 'closed' : 'deadline');
        r.finishedAt = now();
        return stateOf(c, r);
      }
      const t = now();
      r.answers[qi] = { qi, openedAt: t, opensAt: t + readyMs, closesAt: t + readyMs + c.timeS * 1000, phase: r.numbers.phase, at: null, result: null };
      r.qi = qi;
      return stateOf(c, r);
    },
    async answer(code, token, qi, input) {
      const c = byCode(code);
      const r = runOf(c, token);
      if (r.qi < 0 || qi !== r.qi) throw new LiveError('ML004', 'bad_qi');
      const a = r.answers[qi];
      if (a.result) throw new LiveError('ML004', a.at === null ? 'late' : 'twice');
      const t = now();
      if (t < a.opensAt) throw new LiveError('ML004', 'early');
      if (t > a.closesAt + GRACE_MS) throw new LiveError('ML004', 'late');
      const q = c.questions[qi];
      const typed = 'text' in input;
      if (typed !== (q.kind === 'short' || q.kind === 'number')) throw new LiveError('ML004', 'kind');
      grade(c, r, a, q.kind === 'multiple' && 'choice' in input ? { picks: [input.choice] } : input, t);
      settle(c, r);
      return stateOf(c, r);
    },
    async board(code, token) {
      const c = byCode(code);
      c.runs.forEach((r) => settle(c, r));
      const rows = boardOf(finished(c).map((r) => ({ id: r.id, dmg: r.numbers.dmg, right: r.numbers.right, timeMs: r.numbers.timeMs, finishedAt: r.finishedAt ?? 0, r })));
      const me = token ? c.runs.find((r) => r.token === token && !r.removed) : undefined;
      return {
        now: iso(now()),
        challenge: infoOf(c),
        top: rows.map((x) => ({ place: x.place, name: x.r.name, look: x.r.look, dmg: x.dmg, right: x.right, time_ms: x.timeMs, ...(me && x.r === me ? { me: true as const } : {}) })),
        me: me
          ? {
              place: me.finishedAt !== null ? placeOf({ dmg: me.numbers.dmg, right: me.numbers.right, timeMs: me.numbers.timeMs }, finished(c).map((x) => ({ dmg: x.numbers.dmg, right: x.numbers.right, timeMs: x.numbers.timeMs }))) : null,
              name: me.name,
              look: me.look,
              dmg: me.numbers.dmg,
              right: me.numbers.right,
              time_ms: me.numbers.timeMs,
              finished: me.finishedAt !== null,
            }
          : null,
      };
    },
    async review(code, token) {
      const c = byCode(code);
      const r = runOf(c, token);
      if (r.finishedAt === null) throw new LiveError('ML004', 'not_done');
      const items: ReviewItem[] = r.answers
        .filter((a) => a.result)
        .map((a) => {
          const q = c.questions[a.qi];
          return {
            qi: a.qi,
            text: q.text,
            options: q.options,
            key: q.key,
            choice: a.choice ?? null,
            correct: !!a.result?.correct,
            ...(q.kind === 'multiple' ? { kind: 'multiple' as const, keys: q.keys, picks: a.picks ?? null, share: a.result?.share ?? 0 } : {}),
            ...(q.kind === 'short' ? { kind: 'short' as const, forms: q.forms, typed: a.typed ?? null } : {}),
            ...(q.kind === 'number' ? { kind: 'number' as const, forms: q.forms, tolerance: q.tolerance ?? null, unit: q.unit ?? null, typed: a.typed ?? null } : {}),
            ...(q.explanation ? { explanation: q.explanation } : {}),
          };
        });
      return { items };
    },
    async practice() {
      throw new LiveError('28000', null, 401);
    },
  };
}

// ─────────────────────────────────────────── which one ───────────────────────────────────────────

let instance: ChallengeApi | null = null;

/**
 * Under the tests nothing may leave the machine: until a test sets its own (setChallengeApi), every call is refused as
 * a lost network, so the lists on «Игры» and the test's page stay hidden in the other pages' tests.
 */
function inertChallengeApi(): ChallengeApi {
  const refuse = () => Promise.reject(new LiveError('network', null, 0));
  return {
    kind: 'fake',
    create: refuse, close: refuse, remove: refuse, results: refuse, mine: refuse, info: refuse, join: refuse, state: refuse,
    next: refuse, answer: refuse, board: refuse, review: refuse, practice: refuse,
  };
}

/** The app-wide challenge API: the fake with `?fake=1` (or `localStorage['meldy.live.fake'] = '1'`), else the real one. */
export function challengeApi(): ChallengeApi {
  if (!instance && import.meta.env.MODE === 'test') instance = inertChallengeApi();
  if (!instance) {
    let fake = false;
    try {
      fake =
        import.meta.env.VITE_LIVE_FAKE === '1' ||
        new URLSearchParams(window.location.search).get('fake') === '1' ||
        window.localStorage.getItem('meldy.live.fake') === '1';
    } catch {
      fake = false;
    }
    instance = fake ? createFakeChallengeApi() : createRealChallengeApi();
  }
  return instance;
}

/** Tests: start over with another server (null: the default again — inert under the tests). */
export function setChallengeApi(api: ChallengeApi | null): void {
  instance = api;
}
