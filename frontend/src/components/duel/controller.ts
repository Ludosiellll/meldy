/**
 * The seat's side of «Дуэль» (docs/live/DUEL.md), without React: the invite → the name and the character → the lobby
 * («Готов») → the questions on the server's clock → the reveal of both answers → the final («Ещё раз», «Разбор и
 * ошибки») → the next round. The screens render its snapshot (useSyncExternalStore); every change is a new snapshot.
 *
 * - The token is made here (lib/duel/token: 256 bits of crypto.getRandomValues) and kept in localStorage
 *   `meldy.duel.<code>`; it goes in POST bodies only. The next round's duel takes the same token (the server copies its
 *   hash), so the move to it keeps the token under the new code.
 * - Time is the server's: each response's `now` gives the offset of this device's clock; a question's answers open at
 *   `opens_at` and its end, the reveal's end and the end of a wait are asked from the server exactly when its clock says
 *   they are due (the server settles them), never decided here.
 * - The poll (`duel_state` with the rev held): every 1 s while something is timed, 1.5 s in the lobby, 3 s after the end;
 *   on the /sb route (lib/supabaseRoute: the proxy lets 600 anonymous calls a minute through per address) every 3 s and
 *   5 s after the end, the due calls on top; a 429 backs off 3 s more each time, at most 9 s (lib/duel/rules).
 * - A rematch both pressed moves this device to the next duel — after every state and on the start (a reload after
 *   both pressed «Ещё раз» lands on the new duel).
 */
import { LiveError, type AnswerInput, type BodyId, type ColourId, type EyesId, type HatId, type Look, type UnlockId } from '../../lib/live/types';
import { LOCKED, checkName, defaultLook } from '../../lib/live/rules';
import { CODE_RE, GRACE_MS, backoffMs, pollMs, type Route } from '../../lib/duel/rules';
import { dropDuelToken, duelToken, keepDuelToken, newDuelToken } from '../../lib/duel/token';
import { isUnchanged, type DuelApi, type DuelInfo, type DuelReview, type DuelState, type DuelUnchanged } from '../../lib/duel/types';
import { practiceRefusal, type Part, type PracticeView } from '../live/player/controller';
import { DU, errorWords } from './copy';

export type Step = 'loading' | 'intro' | 'builder' | 'full' | 'duel' | 'review' | 'gone';

export interface DuelSnapshot {
  step: Step;
  code: string;
  info: DuelInfo | null;
  state: DuelState | null;
  name: string;
  look: Look;
  busy: boolean;
  /** Under the form or the question: why the last step failed. */
  error: string | null;
  /** The answer is on its way (the buttons wait). */
  sending: boolean;
  /** Server clock − this device's clock, ms. */
  offsetMs: number;
  /** The other seat is here (the latest word, an «unchanged» poll's included). */
  otherPresent: boolean | null;
  review: DuelReview | null;
  reviewError: string | null;
  practice: PracticeView;
  gone: { title: string; text: string } | null;
  /** Locked parts this device has opened (a guest: none). */
  unlocked: readonly UnlockId[];
  lockedTap: { part: Part; id: string } | null;
  /** Both pressed «Ещё раз»: the next duel's code while this device moves there. */
  moving: string | null;
  /** The polls are refused for the rate (429) this many times in a row. */
  backoff: number;
}

export interface DuelControllerOptions {
  api: DuelApi;
  haptic?: (kind: 'tap' | 'select' | 'success' | 'error' | 'warning') => void;
  /** How this browser reaches the database (lib/supabaseRoute preferredRoute); null until it is chosen. */
  route?: () => Route;
  /** A signed-in session: a full link first asks the server for this account's seat. */
  signedIn?: () => boolean;
  /** Open another duel's page (the next round). */
  moveTo?: (code: string) => void;
}

const LOOK_KEY = 'meldy.live.look.web';
const NAME_KEY = 'meldy.live.name.web';
/** A due call goes this long after the moment, so the server's clock is surely past it. */
const DUE_SLACK_MS = 150;

function read(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // a private window: nothing kept
  }
}
const err = (e: unknown) => (e instanceof LiveError ? e : new LiveError('unknown'));
const rateRefused = (e: LiveError) => e.status === 429 || e.code === 'ML005';

/** The moment (server ms) something of this state is due on the server: the text, the end of the time, the reveal's end, the wait's. */
export function dueAt(st: DuelState, serverNow: number): number | null {
  const at: number[] = [];
  const q = st.question;
  const stage = st.duel.stage;
  if (q && stage === 'play') {
    if (q.soon) at.push(Date.parse(q.shown_at));
    if (!q.closed_at) at.push(Date.parse(q.closes_at) + GRACE_MS);
    else if (q.reveal_until) at.push(Date.parse(q.reveal_until));
  }
  if (stage === 'wait' && st.duel.wait_until) at.push(Date.parse(st.duel.wait_until));
  const next = at.filter((t) => Number.isFinite(t) && t > serverNow - 1000).sort((a, b) => a - b)[0];
  return next ?? null;
}

export class DuelController {
  private s: DuelSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly api: DuelApi;
  private readonly haptic: NonNullable<DuelControllerOptions['haptic']>;
  private readonly route: () => Route;
  private readonly signedIn: () => boolean;
  private readonly moveToPage: (code: string) => void;
  private token: string | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private polling = false;
  private disposed = false;
  private gen = 0;
  private offsets: number[] = [];
  private lookTouched = false;
  private retryAfterS: number | null = null;

  constructor(options: DuelControllerOptions) {
    this.api = options.api;
    this.haptic = options.haptic ?? (() => {});
    this.route = options.route ?? (() => null);
    this.signedIn = options.signedIn ?? (() => false);
    this.moveToPage = options.moveTo ?? (() => {});
    const name = read(NAME_KEY) ?? '';
    let look: Look = defaultLook(name || 'Игрок');
    try {
      const cached = JSON.parse(read(LOOK_KEY) ?? 'null') as Look | null;
      if (cached && typeof cached === 'object' && !LOCKED.has(cached.colour) && !LOCKED.has(cached.hat)) {
        look = cached;
        this.lookTouched = true;
      }
    } catch {
      // no cached look
    }
    this.s = {
      step: 'loading',
      code: '',
      info: null,
      state: null,
      name,
      look,
      busy: false,
      error: null,
      sending: false,
      offsetMs: 0,
      otherPresent: null,
      review: null,
      reviewError: null,
      practice: { status: 'idle' },
      gone: null,
      unlocked: [],
      lockedTap: null,
      moving: null,
      backoff: 0,
    };
  }

  readonly getSnapshot = (): DuelSnapshot => this.s;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<DuelSnapshot>): void {
    if (this.disposed) return;
    this.s = { ...this.s, ...patch };
    for (const l of Array.from(this.listeners)) l();
  }

  private later(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const handle = setTimeout(() => {
      this.timers.delete(handle);
      if (!this.disposed) fn();
    }, Math.max(0, ms));
    this.timers.add(handle);
    return handle;
  }

  /** The server's time now, by this device's clock and the offset. */
  serverNow(): number {
    return Date.now() + this.s.offsetMs;
  }

  /** A response's server time against the moment it was asked and came back: the median of the last five. */
  private clock(now: string | undefined, sent: number): void {
    const at = Date.parse(now ?? '');
    if (!Number.isFinite(at)) return;
    this.offsets.push(at - (sent + Date.now()) / 2);
    if (this.offsets.length > 5) this.offsets.shift();
    const sorted = this.offsets.slice().sort((a, b) => a - b);
    const offsetMs = sorted[Math.floor(sorted.length / 2)];
    if (offsetMs !== this.s.offsetMs) this.set({ offsetMs });
  }

  private async call<T extends { now?: string }>(fn: () => Promise<T>): Promise<T> {
    const sent = Date.now();
    const got = await fn();
    this.clock(got.now, sent);
    return got;
  }

  // ─────────────────────────────────────────── entry ───────────────────────────────────────────

  /** The way in: the link's code; `practice`: back from the sign-in «Тренировать ошибки» asked for. */
  async start(code: string, entry: { practice?: boolean } = {}): Promise<void> {
    this.disposed = false;
    this.stopPolling();
    const gen = ++this.gen;
    this.set({ code, step: 'loading', state: null, info: null, review: null, reviewError: null, practice: { status: 'idle' }, moving: null, error: null, gone: null });
    if (!CODE_RE.test(code)) {
      this.set({ step: 'gone', gone: DU.gone.noLink });
      return;
    }
    this.token = duelToken(code);
    if (this.token) {
      try {
        const st = (await this.call(() => this.api.state(code, this.token!, null))) as DuelState;
        if (gen !== this.gen) return;
        this.seated(st);
        if (entry.practice && st.duel.stage === 'final' && !this.s.moving) {
          await this.openReview();
          if (gen === this.gen) await this.practiceMistakes();
        }
        return;
      } catch (error) {
        if (gen !== this.gen) return;
        const e = err(error);
        if (e.code === 'P0002' && e.detail === 'token') {
          dropDuelToken(code);
          this.token = null;
        } else if (e.code === 'P0002') {
          this.set({ step: 'gone', gone: DU.gone.noLink });
          return;
        } else {
          this.set({ step: 'gone', gone: { title: DU.gone.failedTitle, text: errorWords(e) } });
          return;
        }
      }
    }
    let info: DuelInfo;
    try {
      info = await this.call(() => this.api.info(code));
    } catch (error) {
      if (gen !== this.gen) return;
      const e = err(error);
      this.set({ step: 'gone', gone: e.code === 'P0002' ? DU.gone.noLink : { title: DU.gone.failedTitle, text: errorWords(e) } });
      return;
    }
    if (gen !== this.gen) return;
    this.set({ info });
    if (info.stage === 'final') {
      this.set({ step: 'gone', gone: DU.gone.over });
      return;
    }
    if (!info.full) {
      this.set({ step: 'intro' });
      return;
    }
    // The seats look full. Signed in: the server takes this account's seat back (the same account on another device).
    if (this.signedIn()) {
      const token = newDuelToken();
      try {
        const st = await this.call(() => this.api.join(code, checkName(this.s.name).ok ? this.s.name.trim() : 'Игрок', token, null));
        if (gen !== this.gen) return;
        this.token = token;
        keepDuelToken(code, token);
        this.seated(st);
        return;
      } catch (error) {
        if (gen !== this.gen) return;
        const e = err(error);
        if (e.code === 'ML002') {
          this.set({ step: 'gone', gone: DU.gone.over });
          return;
        }
        if (e.code !== 'ML001') {
          this.set({ step: 'gone', gone: { title: DU.gone.failedTitle, text: errorWords(e) } });
          return;
        }
      }
    }
    this.set({ step: 'full' });
  }

  /** «Проверить ещё раз» on «Места заняты». */
  retryFull(): void {
    void this.start(this.s.code);
  }

  /** Both pressed «Ещё раз»: the next duel is this device's now. */
  private shouldMove(st: DuelState): boolean {
    return st.duel.stage === 'final' && !!st.rematch?.code && st.me.rematch;
  }

  private moveTo(code: string): void {
    if (this.s.moving === code || !this.token) return;
    keepDuelToken(code, this.token);
    this.stopPolling();
    this.set({ moving: code });
    this.moveToPage(code);
  }

  /** The token's seat as the server has it (the start, the join, a takeover). */
  private seated(st: DuelState): void {
    this.set({ state: st, step: 'duel', name: st.me.name, look: st.me.look, otherPresent: st.other?.present ?? null, busy: false, error: null });
    if (this.shouldMove(st)) {
      this.moveTo(st.rematch!.code!);
      return;
    }
    this.schedule();
  }

  /** A new state of the seat (a poll, an answer, a press). */
  private apply(st: DuelState): void {
    const before = this.s.state;
    const step = this.s.step === 'review' ? 'review' : 'duel';
    this.set({ state: st, step, otherPresent: st.other?.present ?? null });
    if (this.shouldMove(st)) {
      this.moveTo(st.rematch!.code!);
      return;
    }
    if (st.result && (!before?.result || before.result.qi !== st.result.qi)) this.haptic(st.result.me?.correct ? 'success' : 'error');
  }

  // ─────────────────────────────────────────── the poll ───────────────────────────────────────────

  private stopPolling(): void {
    if (this.pollTimer) clearTimeout(this.pollTimer);
    this.pollTimer = null;
  }

  /** The next poll: by the stage and the route, sooner when something is due, later after a 429. */
  private schedule(): void {
    this.stopPolling();
    const st = this.s.state;
    if (this.disposed || !this.token || !st || this.s.moving) return;
    let delay = pollMs(st.duel.stage, this.route());
    if (this.s.backoff > 0) {
      delay = Math.max(delay, backoffMs(this.s.backoff, this.retryAfterS));
    } else {
      const due = dueAt(st, this.serverNow());
      if (due !== null) {
        const until = due - this.serverNow() + DUE_SLACK_MS;
        if (until < delay) delay = Math.max(100, until);
      }
    }
    this.pollTimer = this.later(delay, () => void this.poll());
  }

  private async poll(): Promise<void> {
    const st = this.s.state;
    if (!st || !this.token || this.polling) return;
    this.polling = true;
    const gen = this.gen;
    try {
      const got: DuelState | DuelUnchanged = await this.call(() => this.api.state(this.s.code, this.token!, st.rev));
      if (gen !== this.gen) return;
      this.retryAfterS = null;
      if (this.s.backoff) this.set({ backoff: 0 });
      if (isUnchanged(got)) {
        const present = got.other ? got.other.present : null;
        if (present !== this.s.otherPresent) this.set({ otherPresent: present });
      } else this.apply(got);
    } catch (error) {
      if (gen !== this.gen) return;
      const e = err(error);
      if (rateRefused(e)) {
        this.retryAfterS = e.retryAfterS;
        this.set({ backoff: this.s.backoff + 1 });
      } else if (e.code === 'P0002' && e.detail === 'token') {
        this.lost();
        return;
      }
      // a network failure: the next poll tries again
    } finally {
      this.polling = false;
    }
    if (gen === this.gen) this.schedule();
  }

  /** The server no longer knows this token: another device took the seat over, or the lobby freed it. */
  private lost(): void {
    const lobby = this.s.state?.duel.stage === 'lobby' && this.s.state.me.seat === 2;
    dropDuelToken(this.s.code);
    this.token = null;
    this.stopPolling();
    this.set({ step: 'gone', gone: lobby ? DU.gone.freed : DU.gone.other, state: null });
  }

  /** The seat as the server has it now (after a refused press). */
  async refresh(): Promise<void> {
    if (!this.token) return;
    try {
      const got = (await this.call(() => this.api.state(this.s.code, this.token!, null))) as DuelState;
      this.apply(got);
    } catch (error) {
      const e = err(error);
      if (e.code === 'P0002' && e.detail === 'token') this.lost();
    }
    this.schedule();
  }

  // ─────────────────────────────────────────── the invite and the character ───────────────────────────────────────────

  /** «Принять вызов». */
  begin(): void {
    this.set({ step: 'builder', error: null });
  }

  backToPin(): void {
    this.set({ step: 'intro', error: null });
  }

  cancelEdit(): void {
    this.backToPin();
  }

  setName(raw: string): void {
    const name = raw.slice(0, 40);
    const patch: Partial<DuelSnapshot> = { name, error: null };
    if (!this.lookTouched) patch.look = defaultLook(name.trim() || 'Игрок');
    this.set(patch);
  }

  choose(part: Part, id: string): void {
    if (LOCKED.has(id) && !this.s.unlocked.includes(id as UnlockId)) {
      this.haptic('warning');
      this.set({ lockedTap: { part, id } });
      return;
    }
    const look = { ...this.s.look };
    if (part === 'body') look.body = id as BodyId;
    else if (part === 'colour') look.colour = id as ColourId;
    else if (part === 'eyes') look.eyes = id as EyesId;
    else look.hat = id as HatId;
    this.lookTouched = true;
    this.haptic('select');
    this.set({ look, lockedTap: null });
  }

  /** «Готово»: the invited seat (or this account's own, taken back). */
  async confirm(): Promise<void> {
    if (this.s.busy) return;
    const check = checkName(this.s.name);
    if (!check.ok) {
      this.haptic('warning');
      this.set({ error: check.reason === 'rude' ? DU.builder.rude : DU.builder.length });
      return;
    }
    this.set({ busy: true, error: null });
    const token = this.token ?? newDuelToken();
    try {
      const st = await this.call(() => this.api.join(this.s.code, check.name, token, this.s.look));
      this.token = token;
      keepDuelToken(this.s.code, token);
      write(NAME_KEY, check.name);
      write(LOOK_KEY, JSON.stringify(this.s.look));
      this.seated(st);
    } catch (error) {
      const e = err(error);
      this.haptic('error');
      if (e.code === 'ML001') this.set({ busy: false, step: 'full' });
      else if (e.code === 'ML002') this.set({ busy: false, step: 'gone', gone: DU.gone.over });
      else this.set({ busy: false, error: errorWords(e) });
    }
  }

  // ─────────────────────────────────────────── the duel ───────────────────────────────────────────

  private async press(fn: () => Promise<DuelState>): Promise<boolean> {
    if (!this.token || this.s.busy) return false;
    this.set({ busy: true, error: null });
    try {
      const st = await this.call(fn);
      this.set({ busy: false });
      this.apply(st);
      this.schedule();
      return true;
    } catch (error) {
      const e = err(error);
      if (e.code === 'P0002' && e.detail === 'token') {
        this.set({ busy: false });
        this.lost();
        return false;
      }
      this.set({ busy: false, error: errorWords(e) });
      await this.refresh();
      return false;
    }
  }

  /** «Готов» in the lobby. */
  async ready(): Promise<void> {
    this.haptic('tap');
    await this.press(() => this.api.ready(this.s.code, this.token!));
  }

  /** «Дальше» in the reveal. */
  async next(): Promise<void> {
    const q = this.s.state?.question;
    if (!q) return;
    await this.press(() => this.api.next(this.s.code, this.token!, q.qi));
  }

  /** «Ещё раз» on the final. */
  async again(): Promise<void> {
    this.haptic('tap');
    await this.press(() => this.api.rematch(this.s.code, this.token!));
  }

  /** An answer: a tap, the ticks, or the text typed. No verdict comes back before the question closes. */
  async answer(input: AnswerInput): Promise<void> {
    const st = this.s.state;
    const q = st?.question;
    if (!st || !q || q.closed_at || st.answer || this.s.sending || !this.token) return;
    const qi = q.qi;
    this.set({ sending: true, error: null });
    this.haptic('tap');
    for (let attempt = 0; ; attempt += 1) {
      try {
        const got = await this.call(() => this.api.answer(this.s.code, this.token!, qi, input));
        this.set({ sending: false });
        this.apply(got);
        this.schedule();
        return;
      } catch (error) {
        const e = err(error);
        if (e.code === 'network' && attempt < 3) {
          await new Promise((r) => this.later(800, () => r(null)));
          continue;
        }
        if (e.code === 'ML004' && e.detail === 'early' && attempt < 3) {
          // the device's clock ran ahead: the answers open a moment later
          await new Promise((r) => this.later(400, () => r(null)));
          continue;
        }
        this.set({ sending: false, error: e.code === 'ML004' ? (e.detail === 'late' ? errorWords(e) : null) : errorWords(e) });
        await this.refresh();
        return;
      }
    }
  }

  // ─────────────────────────────────────────── the review ───────────────────────────────────────────

  async openReview(): Promise<void> {
    if (!this.token) return;
    this.set({ step: 'review', reviewError: null });
    if (this.s.review) return;
    try {
      const review = await this.api.review(this.s.code, this.token);
      this.set({ review });
    } catch (error) {
      this.set({ reviewError: errorWords(err(error)) });
    }
  }

  closeReview(): void {
    this.set({ step: 'duel' });
  }

  /** «Тренировать ошибки» (duel_practice): signed out → `signin`; ML012 and the rest → `refused`. */
  async practiceMistakes(): Promise<void> {
    if (!this.token || this.s.practice.status === 'busy') return;
    this.set({ practice: { status: 'busy' } });
    try {
      const r = await this.api.practice(this.s.code, this.token);
      this.set({ practice: { status: 'done', containerId: r.container_id, saved: r.saved } });
    } catch (error) {
      const e = err(error);
      if (e.code === '28000' || e.status === 401) this.set({ practice: { status: 'signin' } });
      else if (e.code === 'ML002') this.set({ practice: { status: 'refused', text: 'Эта дуэль закончилась больше 7 дней назад или не была сыграна.' } });
      else if (e.code === 'ML004') this.set({ practice: { status: 'refused', text: 'В этой дуэли не было сыгранных вопросов.' } });
      else this.set({ practice: { status: 'refused', text: practiceRefusal(e).replace('по этой игре', 'по этой дуэли') } });
    }
  }

  dispose(): void {
    for (const h of this.timers) clearTimeout(h);
    this.timers.clear();
    this.stopPolling();
    this.gen += 1;
    this.disposed = true;
  }
}
