/**
 * The reveal as a short film (prototype host.js, 20.10): thaws, stars flying from each right answer's character to
 * «Дедлайн» in the order of time (stopping at the hit that kills, CONTRACT §3), the counter-attack's ice shards, the heal,
 * the phase change, the defeat. Everything moves by the Web Animations API on transform and opacity, on elements cloned
 * from hidden templates into one effects layer — no React render, no layout read: every point comes from layout.ts.
 * Character faces, ice, HP and the monster's look go through the stage store, which re-renders only the piece it
 * touches. `cancel()` stops it all at once (the teacher pressed «Дальше»); the screen then shows the server's state.
 */
import { COLOUR_PARTS } from '../art/parts';
import type { ColourId, HostState } from '../../../lib/live/types';
import { BANNER } from './copy';
import { bossBox, crowdPoint, hpBox, type Point, type Slot } from './layout';
import type { StageStore } from './stageStore';

export interface BannerSpec {
  title: string;
  sub: string;
  ms: number;
  /** Comes in and stays until the next state (the defeat). */
  stay?: boolean;
}

export interface DirectorEnv {
  store: StageStore;
  fx: () => HTMLElement | null;
  defs: () => HTMLElement | null;
  slotOf: (id: string) => Slot | null;
  colourOf: (id: string) => ColourId;
  width: () => number;
  banner: (b: BannerSpec) => void;
}

type Frames = Keyframe[];

const STAR = 34;
const SHARD = 30;
const BURST = 70;
const DEBRIS = 60;
const FLY = 520;

/** Shards leave one after another; a big class's shards share 1.2 s. */
const counterStep = (n: number) => (n > 20 ? 1200 / n : 60);
const counterLength = (n: number) => 300 + n * counterStep(n) + 560;

export function canAnimate(el: Element | null): el is HTMLElement {
  return !!el && typeof (el as HTMLElement).animate === 'function';
}

export class Director {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private anims = new Set<Animation>();
  private nodes = new Set<Element>();
  private templates = new Map<string, Element>();
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
    this.running = false;
  }

  private at(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.timers.delete(t);
      fn();
    }, Math.max(0, ms));
    this.timers.add(t);
  }

  private animate(el: Element | null | undefined, frames: Frames, opts: KeyframeAnimationOptions): Animation | null {
    if (!el || !canAnimate(el)) return null;
    const a = el.animate(frames, opts);
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
    this.animate(el, frames, { duration: big ? 380 : 260, easing: 'ease-out' });
  }

  /** The characters who just answered hop once, a few at a time. */
  hops(ids: readonly string[]): void {
    ids.slice(0, 40).forEach((id, i) => this.at(i * 30, () => this.bounce(id, false)));
  }

  private bossHurt(ms = 420): void {
    const { store } = this.env;
    store.setBoss({ hurt: true });
    if (this.hurtTimer) clearTimeout(this.hurtTimer);
    this.hurtTimer = setTimeout(() => {
      this.hurtTimer = null;
      store.setBoss({ hurt: false });
    }, ms);
  }

  private shakeBoss(k: number): void {
    this.animate(
      this.env.store.bossShake,
      [
        { transform: 'translate(0, 0) rotate(0)' },
        { transform: `translate(${k}px, -2px) rotate(${k / 6}deg)` },
        { transform: `translate(${-k * 0.6}px, 1px) rotate(${-k / 8}deg)` },
        { transform: 'translate(0, 0) rotate(0)' },
      ],
      { duration: 240, easing: 'ease-out' },
    );
    this.animate(this.env.store.bossFlash, [{ opacity: 0 }, { opacity: 0.22 }, { opacity: 0 }], { duration: 140, easing: 'linear' });
  }

  private hit(playerId: string, dmg: number, hpAfter: number, i: number): void {
    const { store } = this.env;
    const slot = this.env.slotOf(playerId);
    const from = slot ? { x: slot.cx, y: slot.cy } : crowdPoint(this.env.width());
    const c = this.bossCenter();
    const to = { x: c.x + ((i * 37) % 80) - 40, y: c.y + ((i * 53) % 60) - 30 };
    const mid = { x: (from.x + to.x) / 2, y: Math.max(120, Math.min(from.y, to.y) - 70 - ((i * 29) % 40)) };
    const h = STAR / 2;
    const star = this.spawn(`star-${this.env.colourOf(playerId)}`);
    this.animate(
      star,
      [
        { transform: `translate(${from.x - h}px, ${from.y - h}px) rotate(0deg) scale(0.6)`, easing: 'cubic-bezier(.25,.6,.5,1)' },
        { transform: `translate(${mid.x - h}px, ${mid.y - h}px) rotate(200deg) scale(1.15)`, easing: 'cubic-bezier(.5,0,.8,.6)' },
        { transform: `translate(${to.x - h}px, ${to.y - h}px) rotate(400deg) scale(1)` },
      ],
      { duration: FLY, easing: 'linear', fill: 'forwards' },
    );
    if (slot) {
      store.setChar(playerId, { face: 'happy' });
      this.bounce(playerId);
    }
    this.at(FLY, () => {
      this.drop(star);
      this.impact(to, dmg, i);
      store.setHp(hpAfter);
    });
  }

  private impact(at: Point, dmg: number, i: number): void {
    const b = this.spawn('burst');
    const hb = BURST / 2;
    this.animate(
      b,
      [
        { transform: `translate(${at.x - hb}px, ${at.y - hb}px) scale(0.3) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${at.x - hb}px, ${at.y - hb}px) scale(1.25) rotate(20deg)`, opacity: 0 },
      ],
      { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
    );
    this.at(380, () => this.drop(b));
    const c = this.bossCenter();
    const label = this.spawn('lv-dmg', `−${dmg}`);
    const dx = c.x - 40 + ((i % 5) - 2) * 62;
    const dy = c.y - 160 + (i % 3) * 30;
    this.animate(
      label,
      [
        { transform: `translate(${dx}px, ${dy}px) scale(0.5)`, opacity: 0 },
        { transform: `translate(${dx}px, ${dy - 26}px) scale(1.1)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${dx}px, ${dy - 70}px) scale(1)`, opacity: 0 },
      ],
      { duration: 950, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
    );
    this.at(980, () => this.drop(label));
    this.shakeBoss(9);
    this.bossHurt();
  }

  private counter(ids: readonly string[]): void {
    const { store } = this.env;
    this.animate(
      store.bossShake,
      [{ transform: 'scale(1)' }, { transform: 'scale(1.08, 0.92)' }, { transform: 'scale(0.97, 1.05)' }, { transform: 'scale(1)' }],
      { duration: 420, easing: 'ease-out' },
    );
    const shown = ids.filter((id) => this.env.slotOf(id));
    const step = counterStep(shown.length);
    const c = this.bossCenter();
    const from = { x: c.x, y: c.y - 90 };
    shown.forEach((id, i) => {
      this.at(300 + i * step, () => {
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
          { duration: 480, easing: 'linear', fill: 'forwards' },
        );
        this.at(480, () => {
          this.drop(shard);
          store.setChar(id, { frozen: true, face: 'frozen' });
          this.animate(
            store.hops.get(id),
            [{ transform: 'translateX(0)' }, { transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'translateX(0)' }],
            { duration: 220 },
          );
        });
      });
    });
  }

  private heal(amount: number): void {
    const { store } = this.env;
    store.setHp(store.getHp().hp + amount);
    const bar = hpBox(this.env.width());
    const label = this.spawn('lvh-heal', `+${amount}`);
    const x = bar.x + bar.width + 14;
    const y = bar.y + 24;
    this.animate(
      label,
      [
        { transform: `translate(${x}px, ${y}px) scale(0.6)`, opacity: 0 },
        { transform: `translate(${x}px, ${y - 10}px) scale(1.05)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${x}px, ${y - 30}px) scale(1)`, opacity: 0 },
      ],
      { duration: 1400, easing: 'ease-out', fill: 'forwards' },
    );
    this.at(1450, () => this.drop(label));
    this.env.banner({ ...BANNER.heal(amount), ms: 1700 });
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
    );
    const box = bossBox(this.env.width());
    for (let k = 0; k < 6; k += 1) {
      const puff = this.spawn('puff');
      const sx = box.x + (k % 2 ? box.size - 50 : 24);
      const sy = box.y + 20;
      this.animate(
        puff,
        [
          { transform: `translate(${sx}px, ${sy}px) scale(0.3)`, opacity: 1 },
          { transform: `translate(${sx + (k % 2 ? 40 : -40)}px, ${sy - 90 - k * 8}px) scale(1.3)`, opacity: 0 },
        ],
        { duration: 900, delay: 150 + k * 90, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'both' },
      );
      this.at(1100 + k * 90, () => this.drop(puff));
    }
    this.env.banner({ ...(to === 1 ? BANNER.phase1 : BANNER.phase2), ms: 1900 });
  }

  private defeat(everyone: readonly string[]): void {
    const { store } = this.env;
    if (this.hurtTimer) clearTimeout(this.hurtTimer);
    store.setBoss({ hurt: true });
    this.animate(
      store.bossShake,
      Array.from({ length: 12 }, (_, i) => ({ transform: `translate(${i % 2 ? 12 : -12}px, ${i % 3 ? -3 : 3}px) rotate(${i % 2 ? 3 : -3}deg)` })),
      { duration: 700, easing: 'linear' },
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
        );
      });
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
    this.running = true;
    const { store } = this.env;
    let t = 520;
    r.thawed.forEach((id, i) =>
      this.at(t + i * 40, () => {
        store.setChar(id, { frozen: false, face: 'happy' });
        this.bounce(id);
      }),
    );
    if (r.thawed.length) t += 320 + Math.min(r.thawed.length, 20) * 40;
    const hits: typeof r.hits = [];
    for (const h of r.hits) {
      hits.push(h);
      if (h.hp_after === 0) break;
    }
    const step = hits.length > 14 ? 90 : 140;
    hits.forEach((h, i) => this.at(t + i * step, () => this.hit(h.player_id, h.dmg, h.hp_after, i)));
    if (hits.length) t += (hits.length - 1) * step + FLY + 380;
    const finish = () => {
      this.running = false;
      done();
    };
    if (s.boss.defeated) {
      const everyone = s.roster.map((p) => p.player_id).filter((id) => this.env.slotOf(id));
      this.at(t, () => this.defeat(everyone));
      this.at(t + 3200, finish);
      return;
    }
    if (r.frozen_now.length) {
      const frozen = r.frozen_now;
      this.at(t, () => this.counter(frozen));
      t += counterLength(frozen.filter((id) => this.env.slotOf(id)).length);
    }
    if (r.healed > 0) {
      this.at(t, () => this.heal(r.healed));
      t += 1800;
    }
    if (r.phase_changed === 1 || r.phase_changed === 2) {
      const to = r.phase_changed;
      this.at(t, () => this.phase(to));
      t += 2000;
    }
    this.at(t, finish);
  }
}

/** The templates the director clones: one star per colour, the burst, the shard, debris, a puff of steam. */
export const FX_COLOURS = Object.keys(COLOUR_PARTS) as ColourId[];
