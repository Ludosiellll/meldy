/**
 * The flat view for a phone without WebGL 2 (every other phone draws the 3D arena, lighter when it must: scene3d.ts):
 * the arena from above in 2D, the camera on the own character, everyone drawn as the kit's picture in their clothes
 * colour (thumbs.ts, ~5 KB each, painted once per look). Each zone's letter and answer on a small sign at its far edge,
 * the floor dropping at the stomp (all but the right zone go dark), ghosts see-through and floating. Same contract as
 * the 3D scene (Backdrop): the screen's loop calls `frame()`.
 *
 * Per frame: one copy of the floor (drawn once per question into its own canvas), one picture per character, no
 * allocation of its own.
 */
import type { Pose as Sample } from '../../../../lib/live/move/interp';
import { F_AWAY, isGhost, kindOf, KIND_PLAYER, type RosterEntry, type StandState } from '../../../../lib/live/move/protocol';
import type { GameMap } from '../../../../lib/live/move/sim';
import { toPlayerLook, type PlayerLook } from '../../../../lib/live/three/look';
import { paintThumb, thumbUrl } from '../../../../lib/live/three/thumbs';
import { roundRect } from './map';
import { LETTERS, ZONE_COLOURS } from './words';

/** Map units across the phone's width. */
const VIEW_UNITS = 620;
/** A character's picture, map units (the picture's square). */
const SPRITE = 150;

export interface FrameInput {
  me: { id: number; x: number; y: number; flags: number } | null;
  others: Map<number, Sample> | null;
  roster: ReadonlyMap<number, RosterEntry>;
}

/** What the screen needs from a view of the arena (the 3D scene or this one). */
export interface Backdrop {
  start(onFrame: (dt: number) => void): void;
  stop(): void;
  frame(dt: number, input: FrameInput): void;
  setState(st: StandState, nowRoom: number | null): void;
  setOptions(options: readonly string[] | null): void;
  setAlarm(on: boolean): void;
  /**
   * The part of the screen the arena may use, client px: from the question card's bottom edge (`top`) to the top edge
   * of the stick and the small map (`bottom`). Told on layout changes, never per frame.
   */
  setBand?(top: number, bottom: number): void;
}

export class SpriteView implements Backdrop {
  private readonly g: CanvasRenderingContext2D | null;
  private floor: HTMLCanvasElement | null = null;
  private floorKey = '';
  private options: readonly string[] = [];
  private keep: number | null = null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private s = 1;
  private cam = { x: 800, y: 520, ready: false };
  private readonly pictures = new Map<string, HTMLCanvasElement | null>();
  private readonly looks = new Map<number, string>();
  private raf = 0;
  private last = 0;
  private time = 0;
  private readonly order: number[] = [];
  private readonly ys: Float64Array = new Float64Array(128);
  private readonly ro: ResizeObserver | null;
  /** Where the band between the cards is centred, a share of the canvas's height (setBand). */
  private middle = 0.52;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly map: GameMap,
  ) {
    this.g = canvas.getContext('2d');
    this.ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(() => this.resize()) : null;
    this.ro?.observe(canvas);
    this.resize();
  }

  private resize(): void {
    const w = Math.max(1, this.canvas.clientWidth);
    const h = Math.max(1, this.canvas.clientHeight);
    // The light view is for weak phones: at most 1.25 device pixels per CSS pixel, like the 3D view.
    const dpr = Math.min(1.25, window.devicePixelRatio || 1);
    if (w === this.w && h === this.h && dpr === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.s = (w * dpr) / VIEW_UNITS;
    this.floorKey = '';
  }

  start(onFrame: (dt: number) => void): void {
    if (this.raf) return;
    this.last = performance.now();
    const loop = (now: number) => {
      this.raf = requestAnimationFrame(loop);
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      onFrame(dt);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  setOptions(options: readonly string[] | null): void {
    const next = options ?? [];
    if (next.join('\u0001') === this.options.join('\u0001')) return;
    this.options = next;
    this.floorKey = '';
  }

  setState(st: StandState): void {
    const keep = st.phase === 'reveal' && st.floor === 'down' && st.res ? st.res.key : null;
    if (keep !== this.keep) {
      this.keep = keep;
      this.floorKey = '';
    }
  }

  setAlarm(): void {
    // The flat view has no boss to ring: the timer on the card shakes.
  }

  setBand(top: number, bottom: number): void {
    const r = this.canvas.getBoundingClientRect();
    if (r.height <= 0) return;
    this.middle = Math.min(0.75, Math.max(0.3, ((top + bottom) / 2 - r.top) / r.height));
  }

  frame(dt: number, input: FrameInput): void {
    const g = this.g;
    if (!g) return;
    this.time += dt;
    const me = input.me;
    if (me) {
      const k = this.cam.ready ? 1 - Math.exp(-dt * 7) : 1;
      this.cam.x += (me.x - this.cam.x) * k;
      this.cam.y += (me.y - 60 - this.cam.y) * k;
      this.cam.ready = true;
    }
    const key = `${this.w}|${this.h}|${this.keep}|${this.options.join('\u0001')}`;
    if (key !== this.floorKey) this.paintFloor(key);
    const s = this.s;
    const ox = this.canvas.width / 2 - this.cam.x * s;
    const oy = this.canvas.height * this.middle - this.cam.y * s;
    g.fillStyle = '#14163a';
    g.fillRect(0, 0, this.canvas.width, this.canvas.height);
    if (this.floor) g.drawImage(this.floor, ox, oy);
    // Everyone, back to front.
    const order = this.order;
    order.length = 0;
    if (input.others) {
      for (const [id, p] of input.others) {
        if (kindOf(p.flags) !== KIND_PLAYER) continue;
        if (order.length >= this.ys.length) break;
        this.ys[order.length] = p.y;
        order.push(id);
      }
    }
    const n = order.length;
    // insertion sort by y (≤ 60 characters, nearly sorted frame to frame)
    for (let i = 1; i < n; i++) {
      const id = order[i];
      const y = this.ys[i];
      let j = i - 1;
      while (j >= 0 && this.ys[j] > y) {
        order[j + 1] = order[j];
        this.ys[j + 1] = this.ys[j];
        j--;
      }
      order[j + 1] = id;
      this.ys[j + 1] = y;
    }
    let meDrawn = !me;
    for (let i = 0; i < n; i++) {
      const id = order[i];
      if (!meDrawn && me && this.ys[i] > me.y) {
        this.drawMe(g, me, input.roster, ox, oy);
        meDrawn = true;
      }
      const p = input.others!.get(id)!;
      this.drawOne(g, id, p.x, p.y, p.flags, input.roster, ox, oy, false);
    }
    if (!meDrawn && me) this.drawMe(g, me, input.roster, ox, oy);
  }

  private drawMe(g: CanvasRenderingContext2D, me: NonNullable<FrameInput['me']>, roster: ReadonlyMap<number, RosterEntry>, ox: number, oy: number): void {
    const s = this.s;
    const x = ox + me.x * s;
    const y = oy + me.y * s;
    g.lineWidth = 3 * this.dpr;
    g.strokeStyle = '#ffffff';
    g.beginPath();
    g.ellipse(x, y, 34 * s, 16 * s, 0, 0, Math.PI * 2);
    g.stroke();
    this.drawOne(g, me.id, me.x, me.y, me.flags, roster, ox, oy, true);
  }

  private drawOne(g: CanvasRenderingContext2D, id: number, mx: number, my: number, flags: number, roster: ReadonlyMap<number, RosterEntry>, ox: number, oy: number, mine: boolean): void {
    const s = this.s;
    const pic = this.pictureOf(id, roster);
    const ghost = isGhost(flags);
    const size = SPRITE * s;
    const x = ox + mx * s;
    let y = oy + my * s;
    if (ghost) y -= (14 + 8 * Math.sin(this.time * 3 + id)) * s;
    g.globalAlpha = ghost ? 0.5 : (flags & F_AWAY) !== 0 ? 0.45 : 1;
    if (!ghost) {
      g.fillStyle = 'rgba(17, 19, 38, 0.22)';
      g.beginPath();
      g.ellipse(x, y, 26 * s, 11 * s, 0, 0, Math.PI * 2);
      g.fill();
    }
    if (pic) g.drawImage(pic, x - size / 2, y - size * 0.86, size, size);
    else {
      g.fillStyle = '#8b93a3';
      g.beginPath();
      g.arc(x, y - 30 * s, 22 * s, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    if (mine) {
      const ty = y - size * 0.86 - 6 * this.dpr;
      g.font = `700 ${Math.round(13 * this.dpr)}px Onest, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'bottom';
      g.fillStyle = 'rgba(17, 19, 38, 0.85)';
      const tw = 34 * this.dpr;
      g.fillRect(x - tw / 2, ty - 18 * this.dpr, tw, 18 * this.dpr);
      g.fillStyle = '#ffffff';
      g.fillText('Вы', x, ty - 2 * this.dpr);
    }
  }

  /** The look's picture, painted once in its clothes colour (null until the file has come). */
  private pictureOf(id: number, roster: ReadonlyMap<number, RosterEntry>): HTMLCanvasElement | null {
    let key = this.looks.get(id);
    if (key === undefined) {
      const look = toPlayerLook(roster.get(id)?.[4]);
      key = `${look.body}|${look.colour}|${look.hat}`;
      this.looks.set(id, key);
      if (!this.pictures.has(key)) this.load(key, look);
    }
    return this.pictures.get(key) ?? null;
  }

  private load(key: string, look: PlayerLook): void {
    this.pictures.set(key, null);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      const c = document.createElement('canvas');
      paintThumb(c, img, look.colour);
      this.pictures.set(key, c);
    };
    img.src = thumbUrl(look.body, look.hat);
  }

  private paintFloor(key: string): void {
    this.floorKey = key;
    const s = this.s;
    const W = Math.ceil(this.map.w * s);
    const H = Math.ceil(this.map.h * s);
    const f = this.floor ?? document.createElement('canvas');
    this.floor = f;
    f.width = W;
    f.height = H;
    const g = f.getContext('2d');
    if (!g) return;
    const down = this.keep !== null;
    g.clearRect(0, 0, W, H);
    // the floor inside the walls (MODE_STAND §3): tiles of 60 from (20, 160)
    if (!down) {
      for (let row = 0; row < 12; row++) {
        for (let col = 0; col < 26; col++) {
          g.fillStyle = (row + col) % 2 ? '#efe5d1' : '#e6d9c1';
          g.fillRect((20 + col * 60) * s, (160 + row * 60) * s, 60 * s + 1, 60 * s + 1);
        }
      }
    }
    this.map.zones.forEach((z, i) => {
      if (!z.rect) return;
      if (down && i !== this.keep) return;
      const live = i < this.options.length || this.options.length === 0;
      const { x, y, w, h } = z.rect;
      g.fillStyle = live ? ZONE_COLOURS[i] : '#cfc5b0';
      g.globalAlpha = live ? 0.9 : 0.6;
      g.fillRect(x * s, y * s, w * s, h * s);
      g.globalAlpha = 1;
      if (!live) return;
      // a small sign at the zone's far edge, as on the projector's: the letter on the zone's colour, then the answer
      const text = this.options[i] ?? '';
      g.font = `700 ${Math.round(20 * s)}px Onest, system-ui, sans-serif`;
      const tw = Math.min((w - 90) * s, g.measureText(text).width);
      const sw = 44 * s + (text ? tw + 18 * s : 0);
      const sx0 = (x + 12) * s;
      const sy0 = (y + 10) * s;
      g.fillStyle = 'rgba(255, 255, 255, 0.94)';
      roundRect(g, sx0, sy0, sw, 36 * s, 10 * s);
      g.fill();
      g.fillStyle = ZONE_COLOURS[i];
      roundRect(g, sx0 + 4 * s, sy0 + 4 * s, 28 * s, 28 * s, 7 * s);
      g.fill();
      g.fillStyle = '#0b121c';
      g.textBaseline = 'middle';
      g.textAlign = 'center';
      g.font = `800 ${Math.round(19 * s)}px Onest, system-ui, sans-serif`;
      g.fillText(LETTERS[i], sx0 + 18 * s, sy0 + 19 * s);
      if (text) {
        g.textAlign = 'left';
        g.font = `700 ${Math.round(20 * s)}px Onest, system-ui, sans-serif`;
        g.fillText(text, sx0 + 42 * s, sy0 + 19 * s, tw);
      }
    });
    for (const c of this.map.circles) {
      g.fillStyle = '#2b3140';
      g.beginPath();
      g.arc(c.x * s, c.y * s, c.r * s, 0, Math.PI * 2);
      g.fill();
    }
  }

  dispose(): void {
    this.stop();
    this.ro?.disconnect();
    this.pictures.clear();
  }
}
