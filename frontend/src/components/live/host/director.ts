/**
 * The reveal as one short film (≤ ~3.5 s, Space skips it): the key and the bars come first (the panel, by CSS); then
 * the thaws, a star from each right answer's character into «Дедлайн» while ONE number counts the class's damage up;
 * the number flies into the HP bar — the bar drains, the monster flinches — and the three who hit hardest are named
 * under the bar. Then, one after another and never on top of each other: the counter-attack's ice shards, the heal or
 * the phase change with its banner, or the defeat. Hits stop at the one that kills (CONTRACT §3).
 *
 * Everything moves by the Web Animations API on transform and opacity, on elements cloned from hidden templates into
 * one effects layer — no React render, no layout read: every point comes from layout.ts. Character faces, ice, HP, the
 * monster's look and the named three go through the stage store, which re-renders only the piece it touches.
 * `cancel()` stops it all at once (the teacher pressed «Дальше»); the screen then shows the server's state.
 */
import { COLOUR_PARTS } from '../art/parts';
import type { ColourId, Hit, HostResult, HostState } from '../../../lib/live/types';
import { BANNER, nb } from './copy';
import { bossBox, crowdPoint, hpBox, type Point, type Slot } from './layout';
import type { StageStore, StrikeView } from './stageStore';

export interface BannerSpec {
  title: string;
  sub: string;
  ms: number;
  /** Comes in and stays until the next state (the defeat). */
  stay?: boolean;
}

/** Moments the screen may follow (sound): a star landed, the blow hit the bar, ice, heal, phase, defeat. */
export type Cue = 'land' | 'impact' | 'freeze' | 'heal' | 'phase' | 'defeat';

export interface DirectorEnv {
  store: StageStore;
  fx: () => HTMLElement | null;
  defs: () => HTMLElement | null;
  slotOf: (id: string) => Slot | null;
  colourOf: (id: string) => ColourId;
  width: () => number;
  banner: (b: BannerSpec) => void;
  cue?: (cue: Cue, n?: number) => void;
}

type Frames = Keyframe[];

const STAR = 34;
const SHARD = 30;
const BURST = 70;
const DEBRIS = 60;

/** The film's clock (ms from the reveal's start). Exported for the tests. */
export const FILM = {
  /** Thaws: the ice of right answers by the frozen falls off first. */
  thawAt: 100,
  /** The stars leave once the class has read the key and the bars. */
  starsAt: 500,
  /** All the stars leave within this. */
  starsSpread: 260,
  fly: 420,
  /** The total rests a moment after the last star, then flies to the bar. */
  hold: 100,
  toBar: 360,
  /** After the blow: the named three, then the counter-attack. */
  topAfter: 80,
  counterAfter: 160,
  shardsAfter: 120,
  shardsSpread: 220,
  shardFly: 380,
  /** A heal or a phase banner (one per reveal: a heal needs phase 2 already). */
  bannerMs: 1250,
  /** The defeat: the shaking, the fall, the cheering. */
  defeatMs: 2500,
  /** A reveal without a blow (nobody right): the counter-attack starts here. */
  emptyAt: 500,
} as const;

/** The hits that count on the screen: in order of time, up to the one that kills. */
export function countedHits(hits: readonly Hit[]): Hit[] {
  const out: Hit[] = [];
  for (const h of hits) {
    out.push(h);
    if (h.hp_after === 0) break;
  }
  return out;
}

/** The question's blow: the total of the counted hits and the three who hit hardest (the faster first on a tie). */
export function strikeOf(s: Pick<HostState, 'result' | 'roster'>): StrikeView | null {
  const r = s.result;
  if (!r) return null;
  const hits = countedHits(r.hits);
  if (!hits.length) return null;
  const names = new Map(s.roster.map((p) => [p.player_id, p]));
  const total = hits.reduce((sum, h) => sum + h.dmg, 0);
  const top = hits
    .map((h, i) => ({ h, i }))
    .filter(({ h }) => h.dmg > 0 && names.has(h.player_id))
    .sort((a, b) => b.h.dmg - a.h.dmg || a.i - b.i)
    .slice(0, 3)
    .map(({ h }) => {
      const p = names.get(h.player_id)!;
      return { id: h.player_id, name: p.name, dmg: h.dmg, look: p.look };
    });
  return { total, top };
}

/** When the film's parts happen, for a result as the screen has it (`drawn`: ids the arena shows). Pure; tested. */
export function filmPlan(r: Pick<HostResult, 'hits' | 'thawed' | 'frozen_now' | 'healed' | 'phase_changed'>, defeated: boolean, drawn: (id: string) => boolean) {
  const hits = countedHits(r.hits);
  const stars = hits.length;
  const step = stars > 1 ? FILM.starsSpread / (stars - 1) : 0;
  const lastLand = stars ? FILM.starsAt + (stars - 1) * step + FILM.fly : 0;
  const impact = stars ? lastLand + FILM.hold + FILM.toBar : null;
  let t = impact !== null ? impact + FILM.counterAfter : FILM.emptyAt;
  if (defeated) return { hits, step, impact, counter: null, banner: null, defeat: t, end: t + FILM.defeatMs };
  const frozen = r.frozen_now.filter(drawn);
  let counter: number | null = null;
  if (frozen.length) {
    counter = t;
    t += FILM.shardsAfter + FILM.shardsSpread + FILM.shardFly;
  }
  let banner: number | null = null;
  if (r.healed > 0 || r.phase_changed === 1 || r.phase_changed === 2) {
    // after the last shard has landed: the banner comes over the monster with nothing else in the air
    banner = t;
    t = banner + 200;
  }
  return { hits, step, impact, counter, banner, defeat: null, end: Math.max(t, impact !== null ? impact + 300 : 0) };
}

export function canAnimate(el: Element | null): el is HTMLElement {
  return !!el && typeof (el as HTMLElement).animate === 'function';
}

export class Director {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private anims = new Set<Animation>();
  private nodes = new Set<Element>();
  private templates = new Map<string, Element>();
  private current = new WeakMap<Element, Animation>();
  private hurtTimer: ReturnType<typeof setTimeout> | null = null;
  running = false;

  constructor(private env: DirectorEnv) {}

  /** Stop everything: timers, animations, effects on screen. */
  cancel(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers.clear();
    if (this.hurtTimer) clearTimeout(this.hurtTimer);
    this.hurtTimer = null;
    this.anims.forEach((a) => a.cancel());
    this.anims.clear();
    this.nodes.forEach((n) => n.remove());
    this.nodes.clear();
    this.setRunning(false);
  }

  /** `data-film` on the effects layer while a reveal plays (for the browser runs; no render). */
  private setRunning(on: boolean): void {
    this.running = on;
    const fx = this.env.fx();
    if (!fx) return;
    if (on) fx.setAttribute('data-film', '');
    else fx.removeAttribute('data-film');
  }

  private at(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, Math.max(0, ms));
    this.timers.add(t);
  }

  private cue(name: Cue, n?: number): void {
    this.env.cue?.(name, n);
  }

  /**
   * `replace`: the element's previous motion of this kind stops first. Two transform animations at once on one element
   * (a shake every 90 ms, a hop on a hop) cannot run on the compositor — the trace showed them falling back to the main
   * thread.
   */
  private animate(el: Element | null | undefined, frames: Frames, opts: KeyframeAnimationOptions, replace = false): Animation | null {
    if (!el || !canAnimate(el)) return null;
    if (replace) {
      const prev = this.current.get(el);
      if (prev && prev.playState !== 'finished') prev.cancel();
    }
    const a = el.animate(frames, opts);
    if (replace) this.current.set(el, a);
    this.anims.add(a);
    const drop = () => this.anims.delete(a);
    a.addEventListener('finish', drop);
    a.addEventListener('cancel', drop);
    return a;
  }

  private template(name: string): Element | null {
    const cached = this.templates.get(name);
    if (cached && cached.isConnected) return cached;
    const el = this.env.defs()?.querySelector(`[data-fx="${name}"]`)?.firstElementChild ?? null;
    if (el) this.templates.set(name, el);
    return el;
  }

  /** A copy of a template in the effects layer, at the stage's origin (moved by transform only). */
  private spawn(name: string, text?: string): HTMLElement | null {
    const fx = this.env.fx();
    if (!fx) return null;
    const box = document.createElement('div');
    box.className = 'lvh-fx-item';
    if (text !== undefined) {
      const label = document.createElement('span');
      label.className = name;
      label.textContent = text;
      box.appendChild(label);
    } else {
      const t = this.template(name);
      if (!t) return null;
      box.appendChild(t.cloneNode(true));
    }
    fx.appendChild(box);
    this.nodes.add(box);
    return box;
  }

  private drop(el: Element | null): void {
    if (!el) return;
    el.remove();
    this.nodes.delete(el);
  }

  private bossCenter(): Point {
    return bossBox(this.env.width()).center;
  }

  /** Where the class's total gathers: over the monster's face. */
  private totalPoint(): Point {
    const c = this.bossCenter();
    return { x: c.x, y: c.y - 40 };
  }

  /** A character's hop (squash, jump, land). */
  bounce(id: string, big = true): void {
    const el = this.env.store.hops.get(id);
    const frames: Frames = big
      ? [
          { transform: 'translateY(0) scale(1, 1)' },
          { transform: 'translateY(4px) scale(1.12, 0.86)', offset: 0.3 },
          { transform: 'translateY(-16px) scale(0.94, 1.08)', offset: 0.6 },
          { transform: 'translateY(0) scale(1, 1)' },
        ]
      : [{ transform: 'translateY(0)' }, { transform: 'translateY(-10px)' }, { transform: 'translateY(0)' }];
    this.animate(el, frames, { duration: big ? 380 : 260, easing: 'ease-out' }, true);
  }

  /** The characters who just answered hop once, a few at a time. */
  hops(ids: readonly string[]): void {
    ids.slice(0, 40).forEach((id, i) => this.at(i * 30, () => this.bounce(id, false)));
  }

  private bossHurt(ms = 460): void {
    const { store } = this.env;
    store.setBoss({ hurt: true });
    if (this.hurtTimer) clearTimeout(this.hurtTimer);
    this.hurtTimer = setTimeout(() => {
      this.hurtTimer = null;
      store.setBoss({ hurt: false });
    }, ms);
  }

  private shakeBoss(k: number, ms = 240): void {
    this.animate(
      this.env.store.bossShake,
      [
        { transform: 'translate(0, 0) rotate(0)' },
        { transform: `translate(${k}px, -2px) rotate(${k / 6}deg)` },
        { transform: `translate(${-k * 0.6}px, 1px) rotate(${-k / 8}deg)` },
        { transform: `translate(${k * 0.3}px, 0) rotate(${k / 14}deg)` },
        { transform: 'translate(0, 0) rotate(0)' },
      ],
      { duration: ms, easing: 'ease-out' },
      true,
    );
    this.animate(this.env.store.bossFlash, [{ opacity: 0 }, { opacity: 0.3 }, { opacity: 0 }], { duration: Math.min(ms, 200), easing: 'linear' }, true);
  }

  /** One right answer's star, from its character (or the crowd's count) into the monster; `land` when it arrives. */
  private star(playerId: string, i: number, land: () => void): void {
    const slot = this.env.slotOf(playerId);
    const from = slot ? { x: slot.cx, y: slot.cy } : crowdPoint(this.env.width());
    const c = this.totalPoint();
    const to = { x: c.x + ((i * 37) % 60) - 30, y: c.y + ((i * 53) % 40) - 20 };
    const mid = { x: (from.x + to.x) / 2, y: Math.max(130, Math.min(from.y, to.y) - 70 - ((i * 29) % 40)) };
    const h = STAR / 2;
    const star = this.spawn(`star-${this.env.colourOf(playerId)}`);
    this.animate(
      star,
      [
        { transform: `translate(${from.x - h}px, ${from.y - h}px) rotate(0deg) scale(0.6)`, easing: 'cubic-bezier(.25,.6,.5,1)' },
        { transform: `translate(${mid.x - h}px, ${mid.y - h}px) rotate(200deg) scale(1.15)`, easing: 'cubic-bezier(.5,0,.8,.6)' },
        { transform: `translate(${to.x - h}px, ${to.y - h}px) rotate(400deg) scale(0.7)`, opacity: 0.9 },
      ],
      { duration: FILM.fly, easing: 'linear', fill: 'forwards' },
    );
    if (slot) {
      this.env.store.setChar(playerId, { face: 'happy' });
      this.bounce(playerId);
    }
    this.at(FILM.fly, () => {
      this.drop(star);
      land();
    });
  }

  /**
   * The blow: a star per counted hit; one number over the monster counts the damage up as they land, then flies into
   * the HP bar, where the bar drains and the monster flinches. Returns nothing; times come from filmPlan.
   */
  private blow(s: HostState, plan: ReturnType<typeof filmPlan>): void {
    const { store } = this.env;
    const hits = plan.hits;
    const total = hits.reduce((sum, h) => sum + h.dmg, 0);
    const hpAfter = hits[hits.length - 1].hp_after;
    const p = this.totalPoint();
    let shown = 0;
    let label: HTMLElement | null = null;
    let text: Text | null = null;
    const show = (value: number) => {
      if (!label) {
        label = this.spawn('lvh-total', `−${nb(value)}`);
        text = (label?.firstElementChild?.firstChild as Text | null) ?? null;
        // centred on its point by the label's own CSS (translate −50 %); the box moves by transform only
        this.animate(
          label,
          [
            { transform: `translate(${p.x}px, ${p.y}px) scale(0.4)`, opacity: 0 },
            { transform: `translate(${p.x}px, ${p.y}px) scale(1.12)`, opacity: 1, offset: 0.6 },
            { transform: `translate(${p.x}px, ${p.y}px) scale(1)`, opacity: 1 },
          ],
          { duration: 260, easing: 'ease-out', fill: 'forwards' },
          true,
        );
      } else if (text) text.data = `−${nb(value)}`;
    };
    hits.forEach((h, i) => {
      this.at(FILM.starsAt + i * plan.step, () =>
        this.star(h.player_id, i, () => {
          shown = i === hits.length - 1 ? total : shown + h.dmg;
          show(shown);
          this.shakeBoss(3, 160);
          this.cue('land', i);
        }),
      );
    });
    const impact = plan.impact!;
    this.at(impact - FILM.toBar, () => {
      show(total);
      const bar = hpBox(this.env.width());
      const max = store.getHp().max || s.boss.hp_max || 1;
      const to = { x: bar.x + bar.width * Math.max(0, Math.min(1, hpAfter / max)), y: bar.cy };
      this.animate(
        label,
        [
          { transform: `translate(${p.x}px, ${p.y}px) scale(1)`, opacity: 1 },
          { transform: `translate(${(p.x + to.x) / 2}px, ${p.y - 60}px) scale(0.9)`, opacity: 1, offset: 0.45 },
          { transform: `translate(${to.x}px, ${to.y}px) scale(0.45)`, opacity: 0.2 },
        ],
        { duration: FILM.toBar, easing: 'cubic-bezier(.5,0,.75,.4)', fill: 'forwards' },
        true,
      );
    });
    this.at(impact, () => {
      this.drop(label);
      store.setHp(hpAfter);
      const bar = hpBox(this.env.width());
      const max = store.getHp().max || 1;
      const at = { x: bar.x + bar.width * Math.max(0, Math.min(1, hpAfter / max)), y: bar.cy };
      const b = this.spawn('burst');
      const hb = BURST / 2;
      this.animate(
        b,
        [
          { transform: `translate(${at.x - hb}px, ${at.y - hb}px) scale(0.3) rotate(0deg)`, opacity: 1 },
          { transform: `translate(${at.x - hb}px, ${at.y - hb}px) scale(1.3) rotate(20deg)`, opacity: 0 },
        ],
        { duration: 380, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
      );
      this.at(400, () => this.drop(b));
      this.shakeBoss(14, 360);
      this.bossHurt(520);
      this.cue('impact', total);
    });
    this.at(impact + FILM.topAfter, () => store.setStrike(strikeOf(s)));
  }

  private counter(ids: readonly string[]): void {
    const { store } = this.env;
    this.animate(
      store.bossShake,
      [{ transform: 'scale(1)' }, { transform: 'scale(1.08, 0.92)' }, { transform: 'scale(0.97, 1.05)' }, { transform: 'scale(1)' }],
      { duration: 420, easing: 'ease-out' },
      true,
    );
    this.cue('freeze', ids.length);
    const shown = ids.filter((id) => this.env.slotOf(id));
    const step = shown.length > 1 ? FILM.shardsSpread / (shown.length - 1) : 0;
    const c = this.bossCenter();
    const from = { x: c.x, y: c.y - 90 };
    shown.forEach((id, i) => {
      this.at(FILM.shardsAfter + i * step, () => {
        const slot = this.env.slotOf(id);
        if (!slot) return;
        const to = { x: slot.cx, y: slot.cy };
        const h = SHARD / 2;
        const shard = this.spawn('shard');
        this.animate(
          shard,
          [
            { transform: `translate(${from.x - h}px, ${from.y - h}px) rotate(0deg) scale(0.5)` },
            { transform: `translate(${(from.x + to.x) / 2 - h}px, ${Math.min(from.y, to.y) - 90 - h}px) rotate(180deg) scale(1.1)` },
            { transform: `translate(${to.x - h}px, ${to.y - h}px) rotate(360deg) scale(1)` },
          ],
          { duration: FILM.shardFly, easing: 'linear', fill: 'forwards' },
        );
        this.at(FILM.shardFly, () => {
          this.drop(shard);
          store.setChar(id, { frozen: true, face: 'frozen' });
          this.animate(
            store.hops.get(id),
            [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
            { duration: 220 },
            true,
          );
        });
      });
    });
  }

  private heal(amount: number): void {
    const { store } = this.env;
    store.setHp(store.getHp().hp + amount);
    const bar = hpBox(this.env.width());
    const label = this.spawn('lvh-heal', `+${nb(amount)}`);
    // right of the HP number, on the bar's line
    const x = bar.x + bar.width + 262;
    const y = bar.cy - 24;
    this.animate(
      label,
      [
        { transform: `translate(${x}px, ${y}px) scale(0.6)`, opacity: 0 },
        { transform: `translate(${x}px, ${y - 8}px) scale(1.05)`, opacity: 1, offset: 0.2 },
        { transform: `translate(${x}px, ${y - 12}px) scale(1)`, opacity: 1, offset: 0.8 },
        { transform: `translate(${x}px, ${y - 24}px) scale(1)`, opacity: 0 },
      ],
      { duration: FILM.bannerMs, easing: 'ease-out', fill: 'forwards' },
    );
    this.at(FILM.bannerMs + 40, () => this.drop(label));
    this.cue('heal', amount);
    this.env.banner({ ...BANNER.heal(amount), ms: FILM.bannerMs });
  }

  private phase(to: 1 | 2): void {
    const { store } = this.env;
    store.setBoss({ phase: to });
    this.animate(
      store.bossShake,
      [
        { transform: 'translate(0, 0)' },
        { transform: 'translate(-10px, 0)' },
        { transform: 'translate(10px, 0)' },
        { transform: 'translate(-8px, 0)' },
        { transform: 'translate(8px, 0)' },
        { transform: 'translate(0, 0)' },
      ],
      { duration: 520, easing: 'linear' },
      true,
    );
    const box = bossBox(this.env.width());
    for (let k = 0; k < 6; k += 1) {
      const puff = this.spawn('puff');
      // steam from the bells, out to the sides (it stays under the HP bar and what is under it)
      const sx = box.x + (k % 2 ? box.size - 50 : 24);
      const sy = box.y + 30;
      this.animate(
        puff,
        [
          { transform: `translate(${sx}px, ${sy}px) scale(0.3)`, opacity: 1 },
          { transform: `translate(${sx + (k % 2 ? 70 + k * 6 : -70 - k * 6)}px, ${sy - 20 - k * 3}px) scale(1.3)`, opacity: 0 },
        ],
        { duration: 800, delay: 100 + k * 70, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' },
      );
      this.at(950 + k * 70, () => this.drop(puff));
    }
    this.cue('phase', to);
    this.env.banner({ ...(to === 1 ? BANNER.phase1 : BANNER.phase2), ms: FILM.bannerMs });
  }

  private defeat(everyone: readonly string[]): void {
    const { store } = this.env;
    if (this.hurtTimer) clearTimeout(this.hurtTimer);
    store.setBoss({ hurt: true });
    this.animate(
      store.bossShake,
      Array.from({ length: 12 }, (_, i) => ({ transform: `translate(${i % 2 ? 12 : -12}px, ${i % 3 ? -3 : 3}px) rotate(${i % 2 ? 3 : -3}deg)` })),
      { duration: 700, easing: 'linear' },
      true,
    );
    this.at(650, () => {
      const box = bossBox(this.env.width());
      const c = box.center;
      const parts = ['bell', 'bell', 'gear', 'hand', 'hand', 'spring', 'gear'];
      parts.forEach((kind, i) => {
        const piece = this.spawn(`debris-${kind}`);
        const a = (i / parts.length) * Math.PI * 2 - Math.PI / 2;
        const sx = c.x - DEBRIS / 2;
        const sy = c.y - 40 - DEBRIS / 2;
        const tx = sx + Math.cos(a) * (300 + i * 20);
        const ty = sy + Math.sin(a) * 200 + 160;
        this.animate(
          piece,
          [
            { transform: `translate(${sx}px, ${sy}px) rotate(0deg) scale(0.6)`, opacity: 1 },
            { transform: `translate(${(sx + tx) / 2}px, ${sy - 160}px) rotate(${180 + i * 40}deg) scale(1.2)`, opacity: 1, offset: 0.45 },
            { transform: `translate(${tx}px, ${ty}px) rotate(${360 + i * 60}deg) scale(1)`, opacity: 0 },
          ],
          { duration: 1100, easing: 'linear', fill: 'forwards' },
        );
        this.at(1150, () => this.drop(piece));
      });
      const fall = this.animate(
        store.bossShake,
        [
          { transform: 'scale(1) rotate(0deg)', opacity: 1 },
          { transform: 'scale(1.15, 0.8) rotate(0deg)', opacity: 1, offset: 0.3 },
          { transform: 'scale(0.2) rotate(-25deg)', opacity: 0 },
        ],
        { duration: 560, easing: 'cubic-bezier(.5,0,.75,0)', fill: 'forwards' },
        true,
      );
      this.at(570, () => {
        store.setBoss({ fallen: true, hurt: false });
        fall?.cancel();
      });
      everyone.forEach((id, i) => {
        store.setChar(id, { frozen: false, face: 'happy' });
        const el = store.hops.get(id);
        this.animate(
          el,
          [
            { transform: 'translateY(0) rotate(0deg)' },
            { transform: 'translateY(-34px) rotate(-6deg)', offset: 0.4 },
            { transform: 'translateY(0) rotate(0deg)', offset: 0.8 },
            { transform: 'translateY(0) rotate(0deg)' },
          ],
          { duration: 620, delay: 300 + (i % 7) * 40, iterations: 3, easing: 'ease-out' },
          true,
        );
      });
      this.cue('defeat');
      this.at(500, () => this.env.banner({ ...BANNER.defeated, ms: 600, stay: true }));
    });
  }

  /**
   * Play the close of question `s.qi` (state `reveal`) from what the screen shows now to the server's result. `done`
   * runs at the end (the screen then takes the server's state as it is by then).
   */
  reveal(s: HostState, done: () => void): void {
    this.cancel();
    const r = s.result;
    if (!r) {
      done();
      return;
    }
    this.setRunning(true);
    const { store } = this.env;
    store.setStrike(null);
    const plan = filmPlan(r, s.boss.defeated, (id) => !!this.env.slotOf(id));
    const thawStep = r.thawed.length > 1 ? Math.min(30, 300 / (r.thawed.length - 1)) : 0;
    r.thawed.forEach((id, i) =>
      this.at(FILM.thawAt + i * thawStep, () => {
        store.setChar(id, { frozen: false, face: 'happy' });
        this.bounce(id);
      }),
    );
    if (plan.impact !== null) this.blow(s, plan);
    const finish = () => {
      this.setRunning(false);
      done();
    };
    if (plan.defeat !== null) {
      const everyone = s.roster.map((p) => p.player_id).filter((id) => this.env.slotOf(id));
      this.at(plan.defeat, () => this.defeat(everyone));
      this.at(plan.end, finish);
      return;
    }
    if (plan.counter !== null) {
      const frozen = r.frozen_now;
      this.at(plan.counter, () => this.counter(frozen));
    }
    if (plan.banner !== null) {
      const healed = r.healed;
      const to = r.phase_changed;
      this.at(plan.banner, () => {
        if (healed > 0) this.heal(healed);
        else if (to === 1 || to === 2) this.phase(to);
      });
    }
    this.at(plan.end, finish);
  }
}

/** The templates the director clones: one star per colour, the burst, the shard, debris, a puff of steam. */
export const FX_COLOURS = Object.keys(COLOUR_PARTS) as ColourId[];
