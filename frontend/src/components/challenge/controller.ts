/**
 * The player's side of «Соревнование в своё время» (docs/live/CHALLENGE.md), without React: the link's intro → name and
 * character → «Готовы?» → the questions one by one (the server opens each, times it and grades it) → the final (place,
 * points, the boss) → the review with «Тренировать ошибки», and the table by the same link at any moment. The screens
 * render its snapshot (useSyncExternalStore); every change makes a new snapshot object.
 *
 * - The token is made here and kept in localStorage by the link's code (lib/challenge/token): coming back days later
 *   finds the run, its result and the table. The server keeps only its sha256.
 * - Time is the server's: the answers open at `opens_at` on the server clock (estimated from each response's `now`), and
 *   the end of a question's time is asked from the server (`challenge_state` grades it), never decided here.
 * - Nothing is graded here: the answer's response carries the verdict, the key and the explanation.
 */
import { LiveError, type AnswerInput, type Look, type Review, type UnlockId, type BodyId, type ColourId, type EyesId, type HatId } from '../../lib/live/types';
import { LOCKED, checkName, defaultLook } from '../../lib/live/rules';
import { CODE_RE, GRACE_MS } from '../../lib/challenge/rules';
import { challengeToken, dropChallengeToken, ensureChallengeToken } from '../../lib/challenge/token';
import type { Board, ChallengeApi, ChallengeInfo, RunState } from '../../lib/challenge/types';
import { practiceRefusal, type Part, type PracticeView } from '../live/player/controller';
import { CH, errorWords } from './copy';

export type Step = 'loading' | 'intro' | 'builder' | 'ready' | 'question' | 'final' | 'review' | 'board' | 'gone';

export interface ChallengeSnapshot {
  step: Step;
  code: string;
  info: ChallengeInfo | null;
  state: RunState | null;
  name: string;
  look: Look;
  busy: boolean;
  /** Under the form or the question: why the last step failed. */
  error: string | null;
  /** The answer is on its way (the buttons wait). */
  sending: boolean;
  /** Server clock − this device's clock, ms. */
  offsetMs: number;
  /** The boss's HP before the last result came (the screen animates from it). */
  hpFrom: number | null;
  board: Board | null;
  boardError: string | null;
  /** Where «Назад» of the table goes. */
  boardFrom: 'intro' | 'final' | 'ready';
  review: Review | null;
  reviewError: string | null;
  practice: PracticeView;
  gone: { title: string; text: string } | null;
  /** Locked parts this device has opened (a guest: none). */
  unlocked: readonly UnlockId[];
  lockedTap: { part: Part; id: string } | null;
}

export interface ChallengeControllerOptions {
  api: ChallengeApi;
  /** The device's haptics (the live player's platform), optional. */
  haptic?: (kind: 'tap' | 'select' | 'success' | 'error' | 'warning') => void;
}

const LOOK_KEY = 'meldy.live.look.web';
const NAME_KEY = 'meldy.live.name.web';
/** The table is read again this often while it is on the screen. */
export const BOARD_POLL_MS = 5000;

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

export class ChallengeController {
  private s: ChallengeSnapshot;
  private readonly listeners = new Set<() => void>();
  private readonly api: ChallengeApi;
  private readonly haptic: NonNullable<ChallengeControllerOptions['haptic']>;
  private token: string | null = null;
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private boardTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private gen = 0;
  private offsets: number[] = [];
  private lookTouched = false;

  constructor(options: ChallengeControllerOptions) {
    this.api = options.api;
    this.haptic = options.haptic ?? (() => {});
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
      hpFrom: null,
      board: null,
      boardError: null,
      boardFrom: 'intro',
      review: null,
      reviewError: null,
      practice: { status: 'idle' },
      gone: null,
      unlocked: [],
      lockedTap: null,
    };
  }

  readonly getSnapshot = (): ChallengeSnapshot => this.s;

  readonly subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private set(patch: Partial<ChallengeSnapshot>): void {
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

  /** A response's server time against the moment it was asked and came back: the median of the last five. */
  private clock(now: string | undefined, sent: number): void {
    const at = Date.parse(now ?? '');
    if (!Number.isFinite(at)) return;
    this.offsets.push(at - (sent + Date.now()) / 2);
    if (this.offsets.length > 5) this.offsets.shift();
    const sorted = this.offsets.slice().sort((a, b) => a - b);
    this.set({ offsetMs: sorted[Math.floor(sorted.length / 2)] });
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
    const gen = ++this.gen;
    if (!CODE_RE.test(code)) {
      this.set({ step: 'gone', code, gone: CH.gone.noLink });
      return;
    }
    this.set({ code, step: 'loading' });
    this.token = challengeToken(code);
    if (this.token) {
      try {
        const st = await this.call(() => this.api.state(code, this.token!));
        if (gen !== this.gen) return;
        this.set({ state: st, info: st.challenge, name: st.run.name, look: st.run.look });
        this.route(st);
        if (entry.practice && st.run.finished) {
          await this.openReview();
          if (gen === this.gen) await this.practiceMistakes();
        }
        return;
      } catch (error) {
        if (gen !== this.gen) return;
        const e = error instanceof LiveError ? error : new LiveError('unknown');
        if (e.code === 'P0002' && e.detail === 'token') {
          dropChallengeToken(code);
          this.token = null;
        } else if (e.code === '42501' && e.detail === 'removed') {
          this.set({ step: 'gone', gone: CH.gone.removed });
          return;
        } else if (e.code === 'P0002') {
          this.set({ step: 'gone', gone: CH.gone.noLink });
          return;
        } else {
          this.set({ step: 'gone', gone: { title: CH.gone.failedTitle, text: errorWords(e) } });
          return;
        }
      }
    }
    try {
      const info = await this.call(() => this.api.info(code));
      if (gen !== this.gen) return;
      this.set({ info, step: 'intro' });
    } catch (error) {
      if (gen !== this.gen) return;
      const e = error instanceof LiveError ? error : new LiveError('unknown');
      this.set({ step: 'gone', gone: e.code === 'P0002' ? CH.gone.noLink : { title: CH.gone.failedTitle, text: errorWords(e) } });
    }
  }

  /** The screen of a run as the server has it. */
  private route(st: RunState): void {
    if (st.run.finished) {
      this.set({ step: 'final' });
      void this.peekBoard();
    }
    // a run that never opened a question of a challenge now over: the intro says it is over and offers the table
    else if (st.run.qi < 0 && st.challenge.state === 'over') this.set({ step: 'intro', info: st.challenge });
    else if (st.run.qi < 0) this.set({ step: 'ready' });
    else {
      this.set({ step: 'question' });
      this.watchTime(st);
    }
  }

  // ─────────────────────────────────────────── the intro and the character ───────────────────────────────────────────

  /** «Начать»: the name and the character (a challenge already over shows its table instead). */
  begin(): void {
    if (this.s.info?.state === 'over') {
      void this.openBoard('intro');
      return;
    }
    this.set({ step: 'builder', error: null });
  }

  /** The builder's quiet button: back to the intro. */
  backToPin(): void {
    this.set({ step: 'intro', error: null });
  }

  cancelEdit(): void {
    this.backToPin();
  }

  setName(raw: string): void {
    const name = raw.slice(0, 40);
    const patch: Partial<ChallengeSnapshot> = { name, error: null };
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

  /** «Готово»: the run is made (the look and the name go with it). */
  async confirm(): Promise<void> {
    if (this.s.busy) return;
    const check = checkName(this.s.name);
    if (!check.ok) {
      this.haptic('warning');
      this.set({ error: check.reason === 'rude' ? CH.builder.rude : CH.builder.length });
      return;
    }
    this.set({ busy: true, error: null });
    const token = ensureChallengeToken(this.s.code);
    this.token = token;
    try {
      const st = await this.call(() => this.api.join(this.s.code, check.name, token, this.s.look));
      write(NAME_KEY, check.name);
      write(LOOK_KEY, JSON.stringify(this.s.look));
      this.set({ busy: false, state: st, info: st.challenge, name: st.run.name, look: st.run.look });
      this.route(st);
    } catch (error) {
      const e = error instanceof LiveError ? error : new LiveError('unknown');
      if (e.code === 'ML002') {
        this.set({ busy: false, step: 'intro', info: this.s.info ? { ...this.s.info, state: 'over', over: e.detail === 'closed' ? 'closed' : 'deadline' } : null, error: errorWords(e) });
        return;
      }
      this.haptic('error');
      this.set({ busy: false, error: errorWords(e) });
    }
  }

  // ─────────────────────────────────────────── the questions ───────────────────────────────────────────

  /** «Первый вопрос» / «Дальше»: the next question (the server opens it now; asking twice opens nothing twice). */
  async next(): Promise<void> {
    const st = this.s.state;
    if (!st || !this.token || this.s.busy) return;
    if (st.run.finished) {
      this.showFinal();
      return;
    }
    const qi = st.run.qi + 1;
    this.set({ busy: true, error: null });
    try {
      const got = await this.call(() => this.api.next(this.s.code, this.token!, qi));
      this.set({ busy: false, state: got, hpFrom: null });
      this.route(got);
    } catch (error) {
      const e = error instanceof LiveError ? error : new LiveError('unknown');
      if (e.code === 'ML004' || e.code === 'ML002') {
        // the server's word wins: read the run as it is
        await this.refresh();
        this.set({ busy: false });
        return;
      }
      this.set({ busy: false, error: errorWords(e) });
    }
  }

  /** An answer: a tap, the ticks, or the text typed. The response carries the verdict. */
  async answer(input: AnswerInput): Promise<void> {
    const st = this.s.state;
    if (!st || !st.question || st.result || this.s.sending || !this.token) return;
    const qi = st.question.qi;
    const hpFrom = st.run.boss.hp;
    this.set({ sending: true, error: null });
    this.haptic('tap');
    for (let attempt = 0; ; attempt += 1) {
      try {
        const got = await this.call(() => this.api.answer(this.s.code, this.token!, qi, input));
        this.set({ sending: false, state: got, hpFrom });
        this.haptic(got.result?.correct ? 'success' : 'error');
        return;
      } catch (error) {
        const e = error instanceof LiveError ? error : new LiveError('unknown');
        if (e.code === 'network' && attempt < 3) {
          await new Promise((r) => this.later(800, () => r(null)));
          continue;
        }
        if (e.code === 'ML004' && e.detail === 'early') {
          // the device's clock ran ahead: the answers open a moment later
          await new Promise((r) => this.later(400, () => r(null)));
          if (attempt < 3) continue;
        }
        this.set({ sending: false, error: e.code === 'ML004' ? null : errorWords(e) });
        await this.refresh(hpFrom);
        return;
      }
    }
  }

  /** The end of a question's time on the server's clock: ask the server (it grades the question as none). */
  private watchTime(st: RunState): void {
    const q = st.question;
    if (!q || st.result) return;
    const qi = q.qi;
    const until = Date.parse(q.closes_at) - this.s.offsetMs + GRACE_MS + 250 - Date.now();
    this.later(until, () => {
      const now = this.s.state;
      if (!now || now.run.qi !== qi || now.result || this.s.sending) return;
      void this.refresh(now.run.boss.hp).then(() => {
        const after = this.s.state;
        if (after && after.run.qi === qi && !after.result) this.later(1000, () => this.watchTime(after));
      });
    });
  }

  /** The run as the server has it now. */
  async refresh(hpFrom: number | null = null): Promise<void> {
    if (!this.token) return;
    try {
      const got = await this.call(() => this.api.state(this.s.code, this.token!));
      this.set({ state: got, info: got.challenge, ...(hpFrom !== null && got.result ? { hpFrom } : {}) });
      if (this.s.step === 'question' || this.s.step === 'ready') this.route(got);
    } catch (error) {
      const e = error instanceof LiveError ? error : new LiveError('unknown');
      if (e.code === '42501') this.set({ step: 'gone', gone: CH.gone.removed });
      else this.set({ error: errorWords(e) });
    }
  }

  /** «Итог» after the last result. */
  showFinal(): void {
    this.set({ step: 'final' });
    void this.peekBoard();
  }

  /** The table's first rows for the final: one read, no polling. */
  private async peekBoard(): Promise<void> {
    try {
      const b = await this.api.board(this.s.code, this.token);
      this.set({ board: b });
    } catch {
      // the final goes without them
    }
  }

  // ─────────────────────────────────────────── the table ───────────────────────────────────────────

  async openBoard(from: ChallengeSnapshot['boardFrom'] = this.s.step === 'final' ? 'final' : this.s.step === 'ready' ? 'ready' : 'intro'): Promise<void> {
    this.set({ step: 'board', boardFrom: from, boardError: null });
    await this.loadBoard();
  }

  private async loadBoard(): Promise<void> {
    if (this.boardTimer) clearTimeout(this.boardTimer);
    this.boardTimer = null;
    try {
      const b = await this.call(() => this.api.board(this.s.code, this.token));
      this.set({ board: b, info: b.challenge, boardError: null });
    } catch (error) {
      this.set({ boardError: errorWords(error instanceof LiveError ? error : new LiveError('unknown')) });
    }
    if (this.s.step === 'board' && !this.disposed) this.boardTimer = this.later(BOARD_POLL_MS, () => void this.loadBoard());
  }

  closeBoard(): void {
    if (this.boardTimer) clearTimeout(this.boardTimer);
    this.boardTimer = null;
    this.set({ step: this.s.boardFrom });
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
      this.set({ reviewError: errorWords(error instanceof LiveError ? error : new LiveError('unknown')) });
    }
  }

  closeReview(): void {
    this.set({ step: 'final' });
  }

  /** «Тренировать ошибки» (challenge_practice): signed out → `signin`; ML012 and the rest → `refused`. */
  async practiceMistakes(): Promise<void> {
    if (!this.token || this.s.practice.status === 'busy') return;
    this.set({ practice: { status: 'busy' } });
    try {
      const r = await this.api.practice(this.s.code, this.token);
      this.set({ practice: { status: 'done', containerId: r.container_id, saved: r.saved } });
    } catch (error) {
      const e = error instanceof LiveError ? error : new LiveError('unknown');
      this.set({ practice: e.code === '28000' || e.status === 401 ? { status: 'signin' } : { status: 'refused', text: practiceRefusal(e) } });
    }
  }

  dispose(): void {
    for (const h of this.timers) clearTimeout(h);
    this.timers.clear();
    if (this.boardTimer) clearTimeout(this.boardTimer);
    this.boardTimer = null;
    this.gen += 1;
    this.disposed = true;
  }
}
