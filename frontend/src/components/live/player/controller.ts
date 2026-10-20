/**
 * The player's side of «Битва с монстром» (docs/live/CONTRACT.md), without React: PIN → character → join → the game by
 * the server's state (watchState: Realtime hints + polling) → final → review. The screens render its snapshot
 * (useSyncExternalStore); every change makes a new snapshot object.
 *
 * - Time is the server's: the answer buttons open at `opens_at` on the server clock, estimated from every response's
 *   `now` (watchState's median offset). The server still decides.
 * - An answer shows at once (optimistic); a refusal says why; a lost network retries until the question closes.
 * - The token stays on the device (platform.ts): a reload finds the game by its PIN in this tab and goes on with it.
 */
import { watchState } from '../../../lib/live/api';
import { GRACE_MS, LOCKED, checkLook, checkName, defaultLook } from '../../../lib/live/rules';
import {
  LiveError,
  isUnchanged,
  type BodyId,
  type ColourId,
  type EyesId,
  type HatId,
  type JoinResult,
  type LiveApi,
  type Look,
  type PlayerState,
  type Review,
  type UnlockId,
} from '../../../lib/live/types';
import { errorText } from './copy';
import { readStore, writeStore, type PlayerPlatform } from './platform';

export type Step = 'pin' | 'builder' | 'joining' | 'game' | 'review' | 'gone';
export type Part = 'body' | 'colour' | 'eyes' | 'hat';

export interface Pick {
  qi: number;
  /** Shown index. */
  choice: number;
  status: 'sending' | 'accepted' | 'retrying' | 'late';
  /** Opening → tap on the server's clock (estimated here), ms; null when the answer came from the server (a reload). */
  elapsedMs: number | null;
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
  review: Review | null;
  reviewError: string | null;
  /** Review opened from a link (Telegram `r_<game>`): no game screen behind it. */
  reviewOnly: boolean;
  gone: string | null;
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
const NAME_KEY = 'meldy.live.name';
const UNLOCKED_KEY = (profile: string) => `meldy.live.unlocked.${profile}`;
const UNLOCK_IDS: readonly UnlockId[] = ['graphite', 'snow', 'crown', 'grad', 'horns'];

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
  private readonly onOnline = () => this.kick();
  private readonly onOffline = () => this.set({ link: 'lost' });
  private readonly onVisible = () => {
    if (document.visibilityState === 'visible') this.kick();
  };

  constructor(options: ControllerOptions) {
    this.api = options.api;
    this.platform = options.platform;
    this.profile = options.profile;
    const unlocked = this.cachedUnlocked();
    const name = options.platform.fixedName ?? readStore('local', NAME_KEY) ?? '';
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
      review: null,
      reviewError: null,
      reviewOnly: false,
      gone: null,
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
  async start(entry: { pin?: string | null; reviewGame?: string | null }): Promise<void> {
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
    this.set({ pin });
    if (await this.resume(pin, gen)) return;
    if (gen === this.gen) this.set({ step: 'builder', builderFrom: 'join' });
  }

  /** A game this tab joined with this PIN: its kept token, if the server still knows it. */
  private async resume(pin: string, gen: number): Promise<boolean> {
    const gameId = readStore('session', PIN_KEY(pin));
    if (!gameId) return false;
    const kept = parseJson<{ topic: string; playerId: string; guest: boolean }>(readStore('session', GAME_KEY(gameId)));
    const token = await this.platform.readToken(gameId);
    if (gen !== this.gen) return true;
    if (!kept || !token) return false;
    this.set({ step: 'joining', busy: true });
    try {
      const got = await this.api.state(gameId, token);
      if (gen !== this.gen) return true;
      if (isUnchanged(got)) throw new LiveError('unknown');
      this.token = token;
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
        this.set({ step: 'gone', busy: false, gone: errorText(e, pin) });
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

  submitPin(raw: string): boolean {
    const pin = raw.replace(/\D/g, '');
    if (!PIN_RE.test(pin)) {
      this.set({ error: 'PIN — шесть цифр с экрана ведущего.' });
      return false;
    }
    this.set({ pin, step: 'builder', builderFrom: 'join', error: null });
    return true;
  }

  backToPin(): void {
    this.set({ step: 'pin', error: null, notice: null });
  }

  setName(raw: string): void {
    if (this.platform.fixedName) return;
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

  /** «Готово»: join (the look goes with it) or, from the lobby, keep the new look. */
  async confirm(): Promise<void> {
    if (this.s.busy) return;
    if (this.s.builderFrom === 'lobby') return this.saveLook();
    const name = this.platform.fixedName ?? this.s.name;
    if (!this.platform.fixedName) {
      const check = checkName(name);
      if (!check.ok) {
        this.platform.haptic('warning');
        this.set({ error: check.reason === 'rude' ? 'Такое имя не подойдёт. Выберите другое.' : 'Напишите имя — до 24 знаков.' });
        return;
      }
    }
    this.set({ busy: true, error: null, step: 'joining' });
    try {
      const kept = readStore('session', PIN_KEY(this.s.pin));
      const token = this.token ?? (kept ? await this.platform.readToken(kept) : null);
      const joined = await this.platform.join(this.api, { pin: this.s.pin, name: name.trim(), look: this.s.look, token });
      await this.joined(joined.result, joined.token);
    } catch (error) {
      const e = error instanceof LiveError ? error : new LiveError('unknown');
      // A locked part the cache thought open: the server's look instead.
      if (e.code === 'ML007') this.set({ look: usableLook(this.s.look, [], name) });
      const back = e.code === 'P0002' || e.code === 'ML002' ? 'pin' : 'builder';
      this.platform.haptic('error');
      this.set({ busy: false, step: back, error: errorText(e, this.s.pin) });
    }
  }

  private async joined(result: JoinResult, token: string): Promise<void> {
    this.token = token;
    await this.platform.keepToken(result.game_id, token);
    const guest = result.wardrobe === null;
    writeStore('session', PIN_KEY(this.s.pin), result.game_id);
    writeStore('session', GAME_KEY(result.game_id), JSON.stringify({ topic: result.topic, playerId: result.player_id, guest }));
    if (!this.platform.fixedName) writeStore('local', NAME_KEY, result.name);
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
    if (!game || !token) return;
    this.stopWatch?.();
    this.stopWatch = watchState<PlayerState>({
      api: this.api,
      topic: game.topic,
      read: (since) => this.api.state(game.id, token, since),
      onState: (st) => this.onState(st),
      onError: (e) => this.onError(e),
      onClock: (offsetMs) => {
        if (Math.abs(offsetMs - this.s.offsetMs) > 15) this.set({ offsetMs });
      },
    });
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
      this.set({ step: 'gone', gone: errorText(e, this.s.pin) });
    }
  }

  private onState(st: PlayerState): void {
    const prev = this.s.state;
    if (prev && st.rev < prev.rev) return;
    const patch: Partial<PlayerSnapshot> = { state: st, link: 'ok' };
    const live = st.state === 'countdown' || st.state === 'open';
    if (st.qi !== this.s.turnQi && st.qi >= 0) {
      // A new question: its own figures.
      patch.turnQi = st.qi;
      patch.pick = st.me.choice !== null ? { qi: st.qi, choice: st.me.choice, status: 'accepted', elapsedMs: null } : null;
      patch.answered = null;
      patch.hpFrom = live ? st.boss.hp : null;
      patch.frozenBefore = live ? st.me.frozen : false;
    } else if (live) {
      patch.hpFrom = st.boss.hp;
      patch.frozenBefore = st.me.frozen;
      if (st.me.choice !== null && (!this.s.pick || this.s.pick.qi !== st.qi)) {
        patch.pick = { qi: st.qi, choice: st.me.choice, status: 'accepted', elapsedMs: null };
      }
    }
    if (st.state === 'open') patch.answered = Math.max(st.answered, this.s.answered ?? 0);
    if (st.state === 'lobby') patch.look = st.me.look;
    if (this.s.step === 'builder' && this.s.builderFrom === 'lobby' && st.state !== 'lobby') {
      patch.step = 'game';
      patch.look = st.me.look;
      patch.notice = 'Игра началась: персонаж остался прежним.';
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
    // A question that closes by time: read once just after its end (the hint may come later than the clock).
    if (st.state === 'open' && st.question) {
      const end = Date.parse(st.question.closes_at) + GRACE_MS + 250 - this.serverNow();
      const qi = st.qi;
      this.later(end, () => {
        if (this.s.state?.qi === qi && this.s.state.state === 'open') this.kick();
      });
    }
    if (st.state === 'countdown' && st.question) {
      const qi = st.qi;
      this.later(Date.parse(st.question.opens_at) - this.serverNow() + 30, () => {
        if (this.s.state?.qi === qi) this.set({ notice: null });
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
    if (this.s.pick && this.s.pick.qi === q.qi) return;
    if (choice < 0 || choice >= q.options.length) return;
    const elapsedMs = Math.min(Math.max(this.serverNow() - Date.parse(q.opens_at), 0), st.time_s * 1000);
    this.set({ pick: { qi: q.qi, choice, status: 'sending', elapsedMs } });
    this.platform.haptic('tap');
    this.send(q.qi, choice, Date.parse(q.closes_at), 0);
  }

  private send(qi: number, choice: number, closesAt: number, attempt: number): void {
    const game = this.s.game;
    const token = this.token;
    if (!game || !token) return;
    const mark = (status: Pick['status']) => {
      const pick = this.s.pick;
      if (pick && pick.qi === qi) this.set({ pick: { ...pick, status } });
    };
    this.api
      .answer(game.id, token, qi, choice)
      .then((ack) => {
        mark('accepted');
        if (this.s.turnQi === qi || this.s.state?.qi === qi) this.set({ answered: Math.max(ack.answered, this.s.answered ?? 0), link: 'ok' });
      })
      .catch((error: unknown) => {
        const e = error instanceof LiveError ? error : new LiveError('unknown');
        if (e.code === 'ML004' && e.detail === 'twice') return mark('accepted');
        if (e.code === 'ML004' && e.detail === 'early' && attempt < 6) {
          this.later(250, () => this.send(qi, choice, closesAt, attempt + 1));
          return;
        }
        if (e.code === 'network' || e.code === 'unknown' || e.status >= 500) {
          if (this.serverNow() < closesAt + GRACE_MS) {
            mark('retrying');
            this.set({ link: 'lost' });
            this.later(900, () => this.send(qi, choice, closesAt, attempt + 1));
          } else mark('late');
          return;
        }
        if (e.code === '42501') return this.onError(e);
        mark('late');
        this.platform.haptic('warning');
        this.set({ notice: errorText(e, this.s.pin) });
      });
  }

  // ─────────────────────────────────────────── after the game ───────────────────────────────────────────

  async openReview(): Promise<void> {
    const game = this.s.game;
    if (!game || !this.token) return;
    this.set({ step: 'review', reviewError: null });
    if (this.s.review) return;
    try {
      const review = await this.api.review(game.id, this.token);
      this.set({ review });
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
    this.token = null;
    this.platform.setPlaying(false);
    this.set({ step: 'pin', pin: '', game: null, state: null, pick: null, answered: null, review: null, reviewError: null, reviewOnly: false, turnQi: -1, hpFrom: null, gone: null, error: null, notice: null });
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
