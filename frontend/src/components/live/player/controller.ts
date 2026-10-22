/**
 * The player's side of «Битва с монстром» (docs/live/CONTRACT.md), without React: PIN (checked at once) → character →
 * join → the game by the server's state (watchState: Realtime hints + polling) → final → review. The screens render its
 * snapshot (useSyncExternalStore); every change makes a new snapshot object.
 *
 * - Time is the server's: the answer buttons open at `opens_at` on the server clock, estimated from every response's
 *   `now` (watchState's median offset). The server still decides.
 * - An answer shows at once (optimistic); a refusal says why; a lost network retries until the question closes. The
 *   seconds shown with the damage are the server's (the answer's ack), never the tap's.
 * - A player who joined while a question was open sits that question out (CONTRACT §2: the server refuses it): the
 *   buttons say so from the start instead of failing a tap.
 * - The token stays on the device (platform.ts): a reload finds the game by its PIN in this tab and goes on with it.
 * - The Realtime channel: a phone left on 1 s polling (the channel never joined, or lost) subscribes again after a while
 *   and when the browser is back online.
 */
import { newLiveToken, watchState } from '../../../lib/live/api';
import { GRACE_MS, LOCKED, checkLook, checkName, defaultLook } from '../../../lib/live/rules';
import {
  LiveError,
  isUnchanged,
  pinRefusal,
  type BodyId,
  type ColourId,
  type EyesId,
  type GameMode,
  type HatId,
  type JoinResult,
  type LiveApi,
  type Look,
  type PlayerState,
  type Review,
  type UnlockId,
} from '../../../lib/live/types';
import { errorText } from './copy';
import { readStore, writeStore, TOKEN_RE, type PlayerPlatform } from './platform';

export type Step = 'pin' | 'builder' | 'joining' | 'game' | 'review' | 'gone';
export type Part = 'body' | 'colour' | 'eyes' | 'hat';

export interface Pick {
  qi: number;
  /** Shown index. */
  choice: number;
  status: 'sending' | 'accepted' | 'retrying' | 'late';
  /**
   * Opening → the answer's arrival on the server's clock (the ack's `now`), ms: the time the damage was counted with.
   * null until the ack comes, and when it never does (a reload, a lost ack): then no seconds are shown.
   */
  elapsedMs: number | null;
  /** The answer's place in the class's order (the ack's count, this answer included); null when unknown. */
  order: number | null;
}

export interface PlayerSnapshot {
  step: Step;
  pin: string;
  name: string;
  look: Look;
  /** The parts this player has opened (the wardrobe; a web guest has none). */
  unlocked: readonly UnlockId[];
  /** The builder before joining, or from the lobby (then «Готово» saves the look). */
  builderFrom: 'join' | 'lobby';
  busy: boolean;
  /** Under the form: why the last step failed. */
  error: string | null;
  /** A passing line (a locked part, the game started while building …). */
  notice: string | null;
  /** The part the last locked tap was about (the builder's note names it). */
  lockedTap: { part: Part; id: string } | null;
  game: { id: string; topic: string; playerId: string } | null;
  /** A web guest: nothing of the wardrobe is kept. */
  guest: boolean;
  state: PlayerState | null;
  pick: Pick | null;
  /** «Ответили N»: the larger of the answer's ack and the last state. */
  answered: number | null;
  link: 'ok' | 'lost';
  /** Server clock − this device's clock, ms. */
  offsetMs: number;
  /** The question these figures belong to. */
  turnQi: number;
  /** The boss's HP when this question closed (the reveal animates from it to the state's HP). */
  hpFrom: number | null;
  /** The player was frozen when this question opened. */
  frozenBefore: boolean;
  /** The question this player joined during: the server takes no answer to it (CONTRACT §2), the next one counts. */
  lateQi: number | null;
  review: Review | null;
  reviewError: string | null;
  /** Review opened from a link (Telegram `r_<game>`): no game screen behind it. */
  reviewOnly: boolean;
  /** Why the game cannot go on: a heading and a line (kicked, the game gone). */
  gone: { title: string; text: string } | null;
  /**
   * The game's mode before the server says it: a link's `mode=stand` (the projector's QR) or a game of this PIN met
   * before in this tab. «Встань на ответ» then shows its own character picker before the join. After the join the
   * state's `mode` decides.
   */
  modeHint: GameMode | null;
}

/** A game this tab joined (sessionStorage): enough to go on after a reload. */
interface Kept {
  topic: string;
  playerId: string;
  guest: boolean;
  /** The server's time of the join (ms), when this tab made the player: later questions only. */
  joinedAt?: number | null;
}

export interface ControllerOptions {
  api: LiveApi;
  platform: PlayerPlatform;
  /** Where cached looks are kept apart (`web`, `tg.<id>`). */
  profile: string;
}

const PIN_RE = /^\d{6}$/;
const GAME_KEY = (gameId: string) => `meldy.live.game.${gameId}`;
const PIN_KEY = (pin: string) => `meldy.live.pin.${pin}`;
const LOOK_KEY = (profile: string) => `meldy.live.look.${profile}`;
const NAME_KEY = (profile: string) => `meldy.live.name.${profile}`;
const MODE_KEY = (pin: string) => `meldy.live.mode.${pin}`;
/** A join refused for the rate (ML005): tries again after ~3 s, up to 4 times. */
const JOIN_RETRIES = 4;
const JOIN_WAIT_MS = 3000;
const UNLOCKED_KEY = (profile: string) => `meldy.live.unlocked.${profile}`;
const UNLOCK_IDS: readonly UnlockId[] = ['graphite', 'snow', 'crown', 'grad', 'horns'];
/** No word from the channel for this long (or a lost one): subscribe again; the wait doubles up to RELINK_MAX_MS. */
const RELINK_MS = 20_000;
const RELINK_MAX_MS = 120_000;
/** Between the old channel's leave and the new subscribe: a channel of the same topic still leaving would come back. */
const RELINK_GAP_MS = 1500;

function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function sameLook(a: Look, b: Look): boolean {
  return a.body === b.body && a.colour === b.colour && a.eyes === b.eyes && a.hat === b.hat;
}

/** A cached or given look with every locked part this player has not opened swapped for the name's free one. */
export function usableLook(raw: unknown, unlocked: readonly string[], name: string): Look {
  const base = defaultLook(name || 'Игрок');
  const check = checkLook(raw, unlocked);
  if (check.ok) return check.look;
  const any = checkLook(raw, [...LOCKED]);
  if (!any.ok) return base;
  const look = { ...any.look };
  if (LOCKED.has(look.colour) && !unlocked.includes(look.colour)) look.colour = base.colour;
  if (LOCKED.has(look.hat) && !unlocked.includes(look.hat)) look.hat = base.hat;
  return look;
}

/** The screen of a game that cannot go on. Kicked: CONTRACT §11 (the damage stays in the class's total). */
export function goneOf(e: LiveError, pin: string | null, mode: GameMode = 'boss'): { title: string; text: string } {
  if (e.code === '42501' && e.detail === 'kicked') {
    if (mode === 'stand') return { title: 'Ведущий убрал вас из игры', text: 'В другую игру можно войти по PIN.' };
    return { title: 'Ведущий убрал вас из игры', text: 'Урон, который вы нанесли, остался в общем счёте класса. В другую игру можно войти по PIN.' };
  }
  return { title: 'Игра недоступна', text: errorText(e, pin) };
}

/** How many of the game's questions closed (a game the host ended: `result` is there when its last one closed). */
export function closedOf(st: PlayerState): number {
  if (st.qi < 0) return 0;
  return st.result && st.result.qi === st.qi ? st.qi + 1 : st.qi;
}

export class PlayerController {
  private s: PlayerSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly api: LiveApi;
  private readonly platform: PlayerPlatform;
  private readonly profile: string;
  private token: string | null = null;
  private stopWatch: (() => void) | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private lookTouched = false;
  private kicking = false;
  private disposed = false;
  /** Each start() and dispose() moves it on: a start's late answers see they are stale. */
  private gen = 0;
  /** The question whose end already has its read scheduled (one per question, not one per poll). */
  private closeReadFor = -1;
  /** The server's time of this player's join (ms), when this tab made the player; null when unknown (a rejoin). */
  private joinedAt: number | null = null;
  /** The channel's last word: joined (true), lost or refused (false), nothing yet (null) — and since when. */
  private linked: boolean | null = null;
  private linkAt = 0;
  private relinkMs = RELINK_MS;
  /** The review of a game ended before its podium was asked for once (it shows the right answers so far). */
  private reviewAsked = false;
  /** «Встань на ответ»: the room's socket carries the game, so the database is not read meanwhile (MODE_STAND §9). */
  private watchPaused = false;
  private readonly onOnline = () => {
    this.kick();
    // Back online: the channel may have been given up meanwhile (or never joined): a fresh one now.
    if (this.linked !== true && this.stopWatch) {
      this.relinkMs = RELINK_MS;
      this.relink();
    }
  };
  private readonly onOffline = () => this.set({ link: 'lost' });
  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') this.kick();
  };

  constructor(options: ControllerOptions) {
    this.api = options.api;
    this.platform = options.platform;
    this.profile = options.profile;
    const unlocked = this.cachedUnlocked();
    const name = readStore('local', NAME_KEY(options.profile)) ?? options.platform.suggestedName ?? '';
    const cached = parseJson<Look>(readStore('local', LOOK_KEY(options.profile)));
    this.lookTouched = cached !== null;
    this.s = {
      step: 'pin',
      pin: '',
      name,
      look: cached ? usableLook(cached, unlocked, name) : defaultLook(name || 'Игрок'),
      unlocked,
      builderFrom: 'join',
      busy: false,
      error: null,
      notice: null,
      lockedTap: null,
      game: null,
      guest: options.platform.kind === 'web',
      state: null,
      pick: null,
      answered: null,
      link: 'ok',
      offsetMs: 0,
      turnQi: -1,
      hpFrom: null,
      frozenBefore: false,
      lateQi: null,
      review: null,
      reviewError: null,
      reviewOnly: false,
      gone: null,
      modeHint: null,
    };
  }

  // ─────────────────────────────────────────── store ───────────────────────────────────────────

  readonly getSnapshot = (): PlayerSnapshot => this.s;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<PlayerSnapshot>): void {
    if (this.disposed) return;
    let changed = false;
    for (const key of Object.keys(patch) as (keyof PlayerSnapshot)[]) {
      if (this.s[key] !== patch[key]) {
        changed = true;
        break;
      }
    }
    if (!changed) return;
    this.s = { ...this.s, ...patch };
    for (const listener of Array.from(this.listeners)) listener();
  }

  private later(ms: number, fn: () => void): void {
    const handle = setTimeout(() => {
      this.timers.delete(handle);
      if (!this.disposed) fn();
    }, Math.max(0, ms));
    this.timers.add(handle);
  }

  private serverNow(): number {
    return Date.now() + this.s.offsetMs;
  }

  private cachedUnlocked(): UnlockId[] {
    if (this.platform.kind === 'web') return [];
    const list = parseJson<unknown[]>(readStore('local', UNLOCKED_KEY(this.profile)));
    return Array.isArray(list) ? (list.filter((x) => UNLOCK_IDS.includes(x as UnlockId)) as UnlockId[]) : [];
  }

  // ─────────────────────────────────────────── entry ───────────────────────────────────────────

  /**
   * The way in: a PIN from the address or Telegram's start parameter, or a game's review (`r_<game>` in Telegram). A
   * PIN this tab already joined goes on with the kept token.
   */
  async start(entry: { pin?: string | null; reviewGame?: string | null; mode?: string | null }): Promise<void> {
    // React's StrictMode starts, disposes and starts again: the second start is the one that counts.
    this.disposed = false;
    const gen = ++this.gen;
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.onOnline);
      window.addEventListener('offline', this.onOffline);
      document.addEventListener('visibilitychange', this.onVisible);
    }
    if (entry.reviewGame) {
      await this.openReviewOf(entry.reviewGame);
      return;
    }
    const pin = entry.pin && PIN_RE.test(entry.pin) ? entry.pin : null;
    if (!pin) {
      this.set({ step: 'pin' });
      return;
    }
    const hint = entry.mode === 'stand' || readStore('session', MODE_KEY(pin)) === 'stand' ? 'stand' : null;
    this.set({ pin, modeHint: hint });
    if (await this.resume(pin, gen)) return;
    if (gen === this.gen) await this.checkPin(pin, gen);
  }

  /** A game this tab joined with this PIN: its kept token, if the server still knows it. */
  private async resume(pin: string, gen: number): Promise<boolean> {
    const gameId = readStore('session', PIN_KEY(pin));
    if (!gameId) return false;
    const kept = parseJson<Kept>(readStore('session', GAME_KEY(gameId)));
    const token = await this.platform.readToken(gameId);
    if (gen !== this.gen) return true;
    if (!kept || !token) return false;
    this.set({ step: 'joining', busy: true });
    try {
      const got = await this.api.state(gameId, token);
      if (gen !== this.gen) return true;
      if (isUnchanged(got)) throw new LiveError('unknown');
      this.token = token;
      this.joinedAt = typeof kept.joinedAt === 'number' ? kept.joinedAt : null;
      this.set({
        game: { id: gameId, topic: kept.topic, playerId: kept.playerId },
        guest: kept.guest,
        name: got.me.name,
        look: got.me.look,
        step: 'game',
        busy: false,
      });
      this.onState(got);
      this.watch();
      this.platform.setPlaying(got.state !== 'podium' && got.state !== 'ended');
      return true;
    } catch (error) {
      if (gen !== this.gen) return true;
      const e = error instanceof LiveError ? error : new LiveError('unknown');
      if (e.code === '42501' && e.detail === 'kicked') {
        this.set({ step: 'gone', busy: false, gone: goneOf(e, pin, this.s.modeHint ?? 'boss') });
        return true;
      }
      // The same token joins again: the server gives back the same player (CONTRACT §7), or a new one in a new game.
      this.token = token;
      if (e.code === 'P0002') writeStore('session', PIN_KEY(pin), null);
      const offline = e.code === 'network' || e.code === 'unknown';
      this.set({ step: 'builder', builderFrom: 'join', busy: false, error: offline ? errorText(new LiveError('network'), pin) : null });
      return true;
    }
  }

  // ─────────────────────────────────────────── PIN and builder ───────────────────────────────────────────

  /** «Дальше» on the PIN: six digits, then the server says whether there is a game to join (checkPin). */
  async submitPin(raw: string): Promise<boolean> {
    if (this.s.busy) return false;
    const pin = raw.replace(/\D/g, '');
    if (!PIN_RE.test(pin)) {
      this.set({ error: 'PIN\u00a0— шесть цифр с экрана ведущего.' });
      return false;
    }
    this.set({ pin, error: null, modeHint: readStore('session', MODE_KEY(pin)) === 'stand' ? 'stand' : null });
    return this.checkPin(pin, this.gen);
  }

  /**
   * A wrong or finished PIN is told on the PIN screen, before the character (Kahoot does the same). `live_pin` runs
   * live_join's checks before the name — the PIN, the game's state, the members-only rule, the room, kicked — and answers
   * as data, so the browser logs no refused request; the check makes no player and counts no join. `open`: the
   * character next (the mode says which picker); `joined`: this identity (the same token, or the same account) was in
   * the game already and the server took it back, so that join is kept and the builder skipped; `refused`: the LiveError
   * live_join gave for it, so the same words and the same step as before.
   *
   * Telegram's join goes through the bot's function, which needs a name; the check is the same anonymous RPC there, so
   * «members only» does not stop a Telegram player (their linked account decides at the real join).
   */
  private async checkPin(pin: string, gen: number): Promise<boolean> {
    this.set({ step: 'pin', busy: true, error: null, notice: null });
    const kept = readStore('session', PIN_KEY(pin));
    const known = this.token ?? (kept ? await this.platform.readToken(kept) : null);
    if (gen !== this.gen) return false;
    const token = known && TOKEN_RE.test(known) ? known : newLiveToken();
    try {
      const got = await this.api.pin(pin, token);
      if (gen !== this.gen) return false;
      if (got.status === 'refused') throw pinRefusal(got);
      if (got.status === 'joined') {
        const { status: _joined, ...result } = got;
        await this.joined(result, token);
        return true;
      }
      // The server's mode picks the character picker («Встань на ответ» has its own); unknown (the old check): as it was.
      let modeHint = this.s.modeHint;
      if (got.mode) {
        modeHint = got.mode === 'stand' ? 'stand' : null;
        writeStore('session', MODE_KEY(pin), modeHint);
      }
      this.set({ step: 'builder', builderFrom: 'join', busy: false, error: null, modeHint });
      return true;
    } catch (error) {
      if (gen !== this.gen) return false;
      const e = error instanceof LiveError ? error : new LiveError('unknown');
      const fine = e.code === 'ML006' || e.code === 'ML007' || e.code === 'ML005' || e.code === '22023' || (e.code === 'ML003' && this.platform.kind === 'telegram');
      if (fine) {
        this.set({ step: 'builder', builderFrom: 'join', busy: false, error: null });
        return true;
      }
      if (e.code === '42501' && e.detail === 'kicked') {
        this.set({ busy: false, step: 'gone', gone: goneOf(e, pin, this.s.modeHint ?? 'boss') });
        return false;
      }
      if (e.code === 'P0002') writeStore('session', PIN_KEY(pin), null);
      this.platform.haptic('error');
      this.set({ step: 'pin', busy: false, error: errorText(e, pin) });
      return false;
    }
  }

  backToPin(): void {
    this.set({ step: 'pin', error: null, notice: null });
  }

  setName(raw: string): void {
    const name = raw.slice(0, 40);
    const patch: Partial<PlayerSnapshot> = { name, error: null };
    if (!this.lookTouched) patch.look = defaultLook(name.trim() || 'Игрок');
    this.set(patch);
  }

  /** A part chosen in the builder; a locked one says how it opens. */
  choose(part: Part, id: string): void {
    if (LOCKED.has(id) && !this.s.unlocked.includes(id as UnlockId)) {
      this.platform.haptic('warning');
      this.set({ lockedTap: { part, id } });
      return;
    }
    const look = { ...this.s.look };
    if (part === 'body') look.body = id as BodyId;
    else if (part === 'colour') look.colour = id as ColourId;
    else if (part === 'eyes') look.eyes = id as EyesId;
    else look.hat = id as HatId;
    if (sameLook(look, this.s.look)) return;
    this.lookTouched = true;
    this.platform.haptic('select');
    this.set({ look, lockedTap: null });
  }

  /** The lobby's «Изменить персонажа». */
  editLook(): void {
    if (this.s.state?.state !== 'lobby') return;
    this.set({ step: 'builder', builderFrom: 'lobby', error: null, lockedTap: null });
  }

  cancelEdit(): void {
    if (this.s.builderFrom !== 'lobby') return;
    const look = this.s.state?.me.look ?? this.s.look;
    this.set({ step: 'game', look, lockedTap: null });
  }

  /** The game started while the character was being changed (the room said so): back to the game, the look as it was. */
  leaveEdit(): void {
    if (this.s.step !== 'builder' || this.s.builderFrom !== 'lobby') return;
    this.set({ step: 'game', look: this.s.state?.me.look ?? this.s.look, lockedTap: null, busy: false, notice: 'Игра началась. Герой остался прежним.' });
  }

  /** «Готово»: join (the look goes with it) or, from the lobby, keep the new look. */
  async confirm(): Promise<void> {
    if (this.s.busy) return;
    if (this.s.builderFrom === 'lobby') return this.saveLook();
    const name = this.s.name;
    const check = checkName(name);
    if (!check.ok) {
      this.platform.haptic('warning');
      this.set({ error: check.reason === 'rude' ? 'Такое имя не подойдёт. Выберите другое.' : 'Напишите имя\u00a0— до 24 знаков.' });
      return;
    }
    this.set({ busy: true, error: null, notice: null, step: 'joining' });
    const gen = this.gen;
    for (let attempt = 0; ; attempt += 1) {
      try {
        const kept = readStore('session', PIN_KEY(this.s.pin));
        const token = this.token ?? (kept ? await this.platform.readToken(kept) : null);
        const joined = await this.platform.join(this.api, { pin: this.s.pin, name: check.name, look: this.s.look, token });
        if (gen !== this.gen) return;
        await this.joined(joined.result, joined.token);
        return;
      } catch (error) {
        if (gen !== this.gen) return;
        const e = error instanceof LiveError ? error : new LiveError('unknown');
        // Many joins at once from one address (a class behind one router): wait a few seconds and try again.
        if (e.code === 'ML005' && attempt < JOIN_RETRIES) {
          this.set({ notice: 'Много входов сразу. Пробуем ещё раз…' });
          // The server's wait when it is known (Retry-After, at most a minute), else ~3 s; a little jitter either way.
          const wait = e.retryAfterS !== null && e.retryAfterS > 0 ? Math.min(e.retryAfterS, 60) * 1000 : JOIN_WAIT_MS;
          await new Promise<void>((resolve) => this.later(wait + Math.floor(Math.random() * 1500), resolve));
          if (gen !== this.gen) return;
          continue;
        }
        this.platform.haptic('error');
        if (e.code === '42501' && e.detail === 'kicked') {
          this.set({ busy: false, notice: null, step: 'gone', gone: goneOf(e, this.s.pin, this.s.modeHint ?? 'boss') });
          return;
        }
        // A locked part the cache thought open: the free look instead.
        if (e.code === 'ML007') this.set({ look: usableLook(this.s.look, [], name) });
        const back = e.code === 'P0002' || e.code === 'ML002' ? 'pin' : 'builder';
        this.set({ busy: false, notice: null, step: back, error: errorText(e, this.s.pin) });
        return;
      }
    }
  }

  private async joined(result: JoinResult, token: string): Promise<void> {
    this.token = token;
    await this.platform.keepToken(result.game_id, token);
    const guest = result.wardrobe === null;
    // The join's time: a player this tab made sits out the question that was open then. A rejoin of a player this tab
    // knows keeps the first time; one it does not know (another device) is taken as new.
    const before = parseJson<Kept>(readStore('session', GAME_KEY(result.game_id)));
    const at = Date.parse(result.now);
    this.joinedAt = before && before.playerId === result.player_id ? (typeof before.joinedAt === 'number' ? before.joinedAt : null) : Number.isFinite(at) ? at : null;
    const keep: Kept = { topic: result.topic, playerId: result.player_id, guest, joinedAt: this.joinedAt };
    writeStore('session', PIN_KEY(this.s.pin), result.game_id);
    writeStore('session', GAME_KEY(result.game_id), JSON.stringify(keep));
    writeStore('local', NAME_KEY(this.profile), result.name);
    writeStore('local', LOOK_KEY(this.profile), JSON.stringify(result.look));
    const unlocked = result.wardrobe ? (result.wardrobe.unlocked.filter((u) => UNLOCK_IDS.includes(u)) as UnlockId[]) : this.s.unlocked;
    if (result.wardrobe) writeStore('local', UNLOCKED_KEY(this.profile), JSON.stringify(unlocked));
    this.set({
      game: { id: result.game_id, topic: result.topic, playerId: result.player_id },
      guest,
      name: result.name,
      look: result.look,
      unlocked,
      busy: false,
      error: null,
      notice: null,
      step: 'game',
    });
    this.platform.haptic('success');
    this.platform.setPlaying(true);
    this.watch();
  }

  private async saveLook(): Promise<void> {
    const game = this.s.game;
    const current = this.s.state?.me.look;
    if (!game || !this.token || (current && sameLook(current, this.s.look))) {
      this.set({ step: 'game' });
      return;
    }
    this.set({ busy: true, error: null });
    try {
      const look = await this.api.setLook(game.id, this.token, this.s.look);
      writeStore('local', LOOK_KEY(this.profile), JSON.stringify(look));
      const state = this.s.state ? { ...this.s.state, me: { ...this.s.state.me, look } } : null;
      this.set({ busy: false, look, state, step: 'game' });
      this.platform.haptic('success');
      this.kick();
    } catch (error) {
      const e = error instanceof LiveError ? error : new LiveError('unknown');
      if (e.code === 'ML004') {
        this.set({ busy: false, step: 'game', look: current ?? this.s.look, notice: 'Игра уже началась: персонаж остался прежним.' });
        return;
      }
      this.set({ busy: false, error: errorText(e, this.s.pin) });
    }
  }

  // ─────────────────────────────────────────── following the game ───────────────────────────────────────────

  private watch(): void {
    const game = this.s.game;
    const token = this.token;
    if (!game || !token || this.watchPaused) return;
    this.stopWatch?.();
    this.linked = null;
    this.linkAt = Date.now();
    // The same API, with the channel's word noted here too (watchState keeps its own for the polling pace).
    const api = this.api;
    const tracked: LiveApi = Object.assign(Object.create(api) as LiveApi, {
      subscribe: (topic: string, onHint: Parameters<LiveApi['subscribe']>[1], onLink?: (connected: boolean) => void) =>
        api.subscribe(topic, onHint, (connected) => {
          this.noteLink(connected);
          onLink?.(connected);
        }),
    });
    this.stopWatch = watchState<PlayerState>({
      api: tracked,
      topic: game.topic,
      read: (since) => this.api.state(game.id, token, since),
      onState: (st) => this.onState(st),
      onError: (e) => this.onError(e),
      onClock: (offsetMs) => {
        if (Math.abs(offsetMs - this.s.offsetMs) > 15) this.set({ offsetMs });
      },
    });
  }

  private noteLink(connected: boolean): void {
    if (connected) {
      this.linked = true;
      this.relinkMs = RELINK_MS;
    } else if (this.linked !== false) {
      this.linked = false;
      this.linkAt = Date.now();
    }
  }

  /**
   * Polling every second while the channel is down is the fallback, not the way to play: after RELINK_MS without the
   * channel (never joined — the site's /sb way had no WebSocket when it subscribed — or lost and not back), subscribe
   * again; the wait doubles each time. Runs on every state read, so it needs no timer of its own.
   */
  private maybeRelink(st: PlayerState): void {
    if (this.watchPaused || this.linked === true || !this.stopWatch || st.state === 'podium' || st.state === 'ended') return;
    if (Date.now() - this.linkAt < this.relinkMs) return;
    this.relinkMs = Math.min(this.relinkMs * 2, RELINK_MAX_MS);
    this.relink();
  }

  private relink(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    this.linked = null;
    this.linkAt = Date.now();
    this.later(RELINK_GAP_MS, () => {
      if (this.s.game && this.token && !this.stopWatch && this.s.step !== 'gone') this.watch();
    });
  }

  /**
   * «Встань на ответ»: the room's socket works, so the game is not read from the database meanwhile (MODE_STAND §9:
   * the phone never calls the database for the game's state while the socket works). A read asked for by `kick()`
   * still goes (the podium's opened parts).
   */
  pauseWatch(): void {
    if (this.watchPaused) return;
    this.watchPaused = true;
    this.stopWatch?.();
    this.stopWatch = null;
  }

  /** The room is gone or silent for long: the database tells how the game goes on (or that it ended). */
  resumeWatch(): void {
    if (!this.watchPaused) return;
    this.watchPaused = false;
    this.linked = null;
    this.linkAt = Date.now();
    if (this.s.step !== 'gone') this.watch();
  }

  /** Read the state now (back online, back to the tab, a question's end). */
  kick(): void {
    const game = this.s.game;
    const token = this.token;
    if (!game || !token || this.kicking || this.s.step === 'gone') return;
    this.kicking = true;
    this.api
      .state(game.id, token)
      .then((got) => {
        if (!isUnchanged(got)) this.onState(got);
      })
      .catch((e: unknown) => this.onError(e instanceof LiveError ? e : new LiveError('unknown')))
      .finally(() => {
        this.kicking = false;
      });
  }

  private onError(e: LiveError): void {
    if (e.code === 'network' || e.code === 'unknown' || e.status >= 500) {
      this.set({ link: 'lost' });
      return;
    }
    if (e.code === '42501' || (e.code === 'P0002' && (e.detail === 'game' || e.detail === 'token'))) {
      this.stopWatch?.();
      this.stopWatch = null;
      this.platform.setPlaying(false);
      this.set({ step: 'gone', gone: goneOf(e, this.s.pin, this.s.state?.mode ?? this.s.modeHint ?? 'boss') });
    }
  }

  private onState(st: PlayerState): void {
    const prev = this.s.state;
    if (prev && st.rev < prev.rev) return;
    const patch: Partial<PlayerSnapshot> = { state: st, link: 'ok' };
    const live = st.state === 'countdown' || st.state === 'open';
    if (st.mode === 'stand' && this.s.modeHint !== 'stand') {
      patch.modeHint = 'stand';
      if (this.s.pin) writeStore('session', MODE_KEY(this.s.pin), 'stand');
    }
    if (st.qi !== this.s.turnQi && st.qi >= 0) {
      // A new question: its own figures.
      patch.turnQi = st.qi;
      patch.pick = st.me.choice !== null ? { qi: st.qi, choice: st.me.choice, status: 'accepted', elapsedMs: null, order: null } : null;
      patch.answered = null;
      patch.hpFrom = live ? st.boss.hp : null;
      patch.frozenBefore = live ? st.me.frozen : false;
    } else if (live) {
      patch.hpFrom = st.boss.hp;
      patch.frozenBefore = st.me.frozen;
      if (st.me.choice !== null && (!this.s.pick || this.s.pick.qi !== st.qi)) {
        patch.pick = { qi: st.qi, choice: st.me.choice, status: 'accepted', elapsedMs: null, order: null };
      }
    }
    // Joined after this question opened: the server takes no answer to it (live_answer: not_joined_yet).
    if (live && st.question && st.me.choice === null && this.joinedAt !== null && Date.parse(st.question.opens_at) < this.joinedAt) {
      patch.lateQi = st.qi;
    }
    if (st.state === 'open') patch.answered = Math.max(st.answered, this.s.answered ?? 0);
    if (st.state === 'lobby') patch.look = st.me.look;
    if (this.s.step === 'builder' && this.s.builderFrom === 'lobby' && st.state !== 'lobby') {
      patch.step = 'game';
      patch.look = st.me.look;
      patch.notice = st.mode === 'stand' ? 'Игра началась. Герой остался прежним.' : 'Игра началась: персонаж остался прежним.';
    }
    if ((st.state === 'podium' || st.state === 'ended') && (!prev || (prev.state !== 'podium' && prev.state !== 'ended'))) {
      this.platform.setPlaying(false);
      const opened = st.final?.unlocked_now ?? [];
      if (!this.s.guest && opened.length) {
        const unlocked = Array.from(new Set([...this.s.unlocked, ...opened]));
        writeStore('local', UNLOCKED_KEY(this.profile), JSON.stringify(unlocked));
        patch.unlocked = unlocked;
      }
    }
    this.set(patch);
    this.maybeRelink(st);
    // Ended before the podium (the host's «Закончить»): no final comes; the review gives the right answers so far.
    if (st.state === 'ended' && !st.final && closedOf(st) > 0 && !this.reviewAsked) {
      this.reviewAsked = true;
      void this.loadReview();
    }
    // A question that closes by time: read once just after its end (the hint may come later than the clock). Not in
    // «Встань на ответ»: the room tells the phone, and the database is not read while it does.
    if (st.state === 'open' && st.question && st.mode !== 'stand' && this.closeReadFor !== st.qi) {
      this.closeReadFor = st.qi;
      const end = Date.parse(st.question.closes_at) + GRACE_MS + 250 - this.serverNow();
      const qi = st.qi;
      this.later(end, () => {
        if (this.s.state?.qi === qi && this.s.state.state === 'open') this.kick();
      });
    }
  }

  // ─────────────────────────────────────────── answering ───────────────────────────────────────────

  /** True when the buttons of this question take a tap now (server clock). */
  isOpenNow(): boolean {
    const st = this.s.state;
    if (!st?.question || (st.state !== 'countdown' && st.state !== 'open')) return false;
    return this.serverNow() >= Date.parse(st.question.opens_at);
  }

  answer(choice: number): void {
    const st = this.s.state;
    const q = st?.question;
    if (!st || !q || !this.isOpenNow() || !this.s.game || !this.token) return;
    // a movement round is answered by standing in the arena (the room writes it), never by a tap
    if (q.stand) return;
    if (this.s.lateQi === q.qi) return;
    if (this.s.pick && this.s.pick.qi === q.qi) return;
    if (choice < 0 || choice >= q.options.length) return;
    this.set({ pick: { qi: q.qi, choice, status: 'sending', elapsedMs: null, order: null } });
    this.platform.haptic('tap');
    this.send({ qi: q.qi, choice, opensAt: Date.parse(q.opens_at), closesAt: Date.parse(q.closes_at), timeMs: st.time_s * 1000 }, 0);
  }

  private send(a: { qi: number; choice: number; opensAt: number; closesAt: number; timeMs: number }, attempt: number): void {
    const game = this.s.game;
    const token = this.token;
    if (!game || !token) return;
    const { qi } = a;
    const mark = (patch: Partial<Pick>) => {
      const pick = this.s.pick;
      if (pick && pick.qi === qi) this.set({ pick: { ...pick, ...patch } });
    };
    this.api
      .answer(game.id, token, qi, a.choice)
      .then((ack) => {
        // The ack's `now` is the server's clock at this answer: the time its damage is counted with (live_answer).
        const at = Date.parse(ack.now);
        const elapsedMs = Number.isFinite(at) ? Math.min(Math.max(at - a.opensAt, 0), a.timeMs) : null;
        mark({ status: 'accepted', elapsedMs, order: ack.answered > 0 ? ack.answered : null });
        if (this.s.turnQi === qi || this.s.state?.qi === qi) this.set({ answered: Math.max(ack.answered, this.s.answered ?? 0), link: 'ok' });
      })
      .catch((error: unknown) => {
        const e = error instanceof LiveError ? error : new LiveError('unknown');
        // Taken before (the first ack was lost): the server's time is not known here, so no seconds are shown.
        if (e.code === 'ML004' && e.detail === 'twice') return mark({ status: 'accepted' });
        if (e.code === 'ML004' && e.detail === 'early' && attempt < 6) {
          this.later(250, () => this.send(a, attempt + 1));
          return;
        }
        if (e.code === 'ML004' && e.detail === 'not_joined_yet') {
          // Joined during this question (a rejoin this tab could not date): sit it out, said in the line, not a toast.
          const pick = this.s.pick;
          this.set({ lateQi: qi, pick: pick && pick.qi === qi ? null : pick });
          return;
        }
        if (e.code === 'network' || e.code === 'unknown' || e.status >= 500) {
          if (this.serverNow() < a.closesAt + GRACE_MS) {
            mark({ status: 'retrying' });
            this.set({ link: 'lost' });
            this.later(900, () => this.send(a, attempt + 1));
          } else mark({ status: 'late' });
          return;
        }
        if (e.code === '42501') return this.onError(e);
        mark({ status: 'late' });
        this.platform.haptic('warning');
        // ML004 is said in the line beside the character; anything else in a passing line.
        if (e.code !== 'ML004') this.set({ notice: errorText(e, this.s.pin) });
      });
  }

  // ─────────────────────────────────────────── after the game ───────────────────────────────────────────

  async openReview(): Promise<void> {
    const game = this.s.game;
    if (!game || !this.token) return;
    this.set({ step: 'review', reviewError: null });
    if (this.s.review) return;
    await this.loadReview();
  }

  private async loadReview(): Promise<void> {
    const game = this.s.game;
    if (!game || !this.token) return;
    try {
      const review = await this.api.review(game.id, this.token);
      this.set({ review, reviewError: null });
    } catch (error) {
      this.set({ reviewError: errorText(error instanceof LiveError ? error : new LiveError('unknown'), null) });
    }
  }

  closeReview(): void {
    if (this.s.reviewOnly) return;
    this.set({ step: 'game' });
  }

  private async openReviewOf(gameId: string): Promise<void> {
    this.set({ step: 'review', reviewOnly: true });
    const token = await this.platform.readToken(gameId);
    if (!token) {
      this.set({ reviewError: 'Разбор открывается на том устройстве, где вы играли.' });
      return;
    }
    try {
      const review = await this.api.review(gameId, token);
      this.set({ review });
    } catch (error) {
      const e = error instanceof LiveError ? error : new LiveError('unknown');
      this.set({ reviewError: e.code === 'P0002' ? 'Разбор этой игры больше недоступен: он хранится 7 дней.' : errorText(e, null) });
    }
  }

  /** «Ещё игра»: back to the PIN, this game left behind. */
  restart(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    this.watchPaused = false;
    this.token = null;
    this.joinedAt = null;
    this.reviewAsked = false;
    this.closeReadFor = -1;
    this.platform.setPlaying(false);
    this.set({ step: 'pin', pin: '', game: null, state: null, pick: null, answered: null, review: null, reviewError: null, reviewOnly: false, turnQi: -1, hpFrom: null, lateQi: null, gone: null, error: null, notice: null, busy: false, modeHint: null });
  }

  /** The player's token (sharing asks the bot's function with it). */
  playerToken(): string | null {
    return this.token;
  }

  dismissNotice(): void {
    this.set({ notice: null });
  }

  dispose(): void {
    this.stopWatch?.();
    this.stopWatch = null;
    for (const handle of this.timers) clearTimeout(handle);
    this.timers.clear();
    this.platform.setPlaying(false);
    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.onOnline);
      window.removeEventListener('offline', this.onOffline);
      document.removeEventListener('visibilitychange', this.onVisible);
    }
    this.gen += 1;
    this.disposed = true;
  }
}
