/**
 * The small map on the phone: the arena's floor from above (the four answer zones in the projector's colours, the
 * boss's stage), everyone as a dot in their clothes colour and the own character as a big dot with a ring. A player
 * who looks at the phone still knows where they are. 2D canvas, no 3D:
 *
 * - the floor is drawn once into its own canvas, again only when the size, the options or the floor change;
 * - each frame copies it and draws the dots: one `drawImage` and ~30 arcs, nothing allocated here;
 * - device pixels at most ×2.
 *
 * The map fills the width it is given and may be taller than the arena's own shape (up to MAX_STRETCH), so the phone's
 * height goes to the map rather than to an empty box. Dots stay round.
 */
import type { Pose } from '../../../../lib/live/move/interp';
import { F_AWAY, isGhost, kindOf, KIND_PLAYER, type RosterEntry } from '../../../../lib/live/move/protocol';
import type { GameMap } from '../../../../lib/live/move/sim';
import { clothesHex, toPlayerLook } from '../../../../lib/live/three/look';
import { LETTERS, ZONE_COLOURS } from './words';

/** The part of the 1600 × 900 arena players can reach (inside the walls; MODE_STAND.md §3). */
export const VIEW = { x: 20, y: 160, w: 1560, h: 720 } as const;
/** How much taller than the arena's own shape the map may be drawn. */
export const MAX_STRETCH = 1.6;
const FLOOR = '#efe5d1';
const FLOOR_LINE = 'rgba(120, 96, 60, 0.12)';
const VOID = '#1d2433';
const STAGE = '#2b3140';

/** The map's CSS height for a box: the full width, as tall as the box allows up to MAX_STRETCH × the arena's shape. */
export function mapHeight(width: number, room: number): number {
  const natural = (width * VIEW.h) / VIEW.w;
  return Math.max(natural * 0.8, Math.min(room, natural * MAX_STRETCH));
}

export interface FloorLook {
  /** How many options the question has (zones beyond are closed); 4 in the lobby. */
  options: number;
  /** The right zone while the floor is down, else null. */
  keep: number | null;
}

export class ArenaMap {
  private ctx: CanvasRenderingContext2D | null = null;
  private floor: HTMLCanvasElement | null = null;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private sx = 1;
  private sy = 1;
  private look: FloorLook = { options: 4, keep: null };
  private floorDirty = true;
  private readonly colours = new Map<number, string>();
  private map: GameMap | null = null;

  constructor(private readonly canvas: HTMLCanvasElement) {}

  /** The canvas's CSS size (from the screen's resize observer, never read per frame): the backing store follows. */
  resize(cssW: number, cssH: number, dpr: number): void {
    const d = Math.min(2, Math.max(1, dpr || 1));
    const w = Math.max(1, Math.round(cssW));
    const h = Math.max(1, Math.round(cssH));
    if (w === this.w && h === this.h && d === this.dpr) return;
    this.w = w;
    this.h = h;
    this.dpr = d;
    this.canvas.width = Math.round(w * d);
    this.canvas.height = Math.round(h * d);
    this.sx = (w * d) / VIEW.w;
    this.sy = (h * d) / VIEW.h;
    this.ctx = this.canvas.getContext('2d');
    this.floorDirty = true;
  }

  setMap(map: GameMap | null): void {
    if (map === this.map) return;
    this.map = map;
    this.floorDirty = true;
  }

  setFloor(look: FloorLook): void {
    if (look.options === this.look.options && look.keep === this.look.keep) return;
    this.look = look;
    this.floorDirty = true;
  }

  /** Draws one frame: the floor, everyone else, then the own character on top. */
  draw(others: Map<number, Pose> | null, me: { x: number; y: number; flags: number } | null, roster: ReadonlyMap<number, RosterEntry>, myColour: string): void {
    const g = this.ctx;
    if (!g) return;
    if (this.floorDirty) this.paintFloor();
    const { sx, sy, dpr } = this;
    if (this.floor) g.drawImage(this.floor, 0, 0);
    else g.clearRect(0, 0, this.canvas.width, this.canvas.height);
    if (others) {
      const r = 3.6 * dpr;
      for (const [id, p] of others) {
        if (kindOf(p.flags) !== KIND_PLAYER) continue;
        g.globalAlpha = isGhost(p.flags) || (p.flags & F_AWAY) !== 0 ? 0.3 : 0.9;
        g.fillStyle = this.colourOf(id, roster);
        g.beginPath();
        g.arc((p.x - VIEW.x) * sx, (p.y - VIEW.y) * sy, r, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
    }
    if (me) {
      // The own character: a halo, a white ring with a dark edge, the clothes colour inside.
      const x = (me.x - VIEW.x) * sx;
      const y = (me.y - VIEW.y) * sy;
      const r = 7.5 * dpr;
      g.globalAlpha = isGhost(me.flags) ? 0.6 : 1;
      g.fillStyle = 'rgba(11, 18, 28, 0.18)';
      g.beginPath();
      g.arc(x, y, r + 8 * dpr, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.arc(x, y, r + 3 * dpr, 0, Math.PI * 2);
      g.fill();
      g.lineWidth = 2 * dpr;
      g.strokeStyle = '#0b121c';
      g.stroke();
      g.fillStyle = myColour;
      g.beginPath();
      g.arc(x, y, r, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
  }

  private colourOf(id: number, roster: ReadonlyMap<number, RosterEntry>): string {
    let c = this.colours.get(id);
    if (c === undefined) {
      const entry = roster.get(id);
      c = entry ? clothesHex(toPlayerLook(entry[4]).colour) : '#8b93a3';
      this.colours.set(id, c);
    }
    return c;
  }

  private paintFloor(): void {
    this.floorDirty = false;
    if (!this.map || !this.w) return;
    const cw = this.canvas.width;
    const ch = this.canvas.height;
    const f = this.floor ?? document.createElement('canvas');
    this.floor = f;
    if (f.width !== cw) f.width = cw;
    if (f.height !== ch) f.height = ch;
    const g = f.getContext('2d');
    if (!g) return;
    const { sx, sy, dpr } = this;
    const X = (x: number) => (x - VIEW.x) * sx;
    const Y = (y: number) => (y - VIEW.y) * sy;
    const down = this.look.keep !== null;
    g.clearRect(0, 0, cw, ch);
    g.fillStyle = down ? VOID : FLOOR;
    g.fillRect(0, 0, cw, ch);
    if (!down) {
      // The tiles of 60 units the floor drops in (MODE_STAND §3): faint lines, so the floor reads as a floor.
      g.strokeStyle = FLOOR_LINE;
      g.lineWidth = 1;
      g.beginPath();
      for (let x = VIEW.x + 60; x < VIEW.x + VIEW.w; x += 60) {
        g.moveTo(Math.round(X(x)) + 0.5, 0);
        g.lineTo(Math.round(X(x)) + 0.5, ch);
      }
      for (let y = VIEW.y + 60; y < VIEW.y + VIEW.h; y += 60) {
        g.moveTo(0, Math.round(Y(y)) + 0.5);
        g.lineTo(cw, Math.round(Y(y)) + 0.5);
      }
      g.stroke();
    }
    const radius = 10 * dpr;
    const font = Math.round(Math.min(34 * dpr, 110 * Math.min(sx, sy * 1.2)));
    this.map.zones.forEach((z, i) => {
      if (!z.rect) return;
      if (down && i !== this.look.keep) return;
      const live = i < this.look.options;
      const x = X(z.rect.x);
      const y = Y(z.rect.y);
      const w = z.rect.w * sx;
      const h = z.rect.h * sy;
      if (live) {
        g.fillStyle = ZONE_COLOURS[i % ZONE_COLOURS.length];
        roundRect(g, x, y, w, h, radius);
        g.fill();
      } else {
        // A closed zone (fewer options than zones): an outline only, no answer here.
        g.setLineDash([6 * dpr, 5 * dpr]);
        g.lineWidth = 1.5 * dpr;
        g.strokeStyle = 'rgba(11, 18, 28, 0.25)';
        roundRect(g, x + dpr, y + dpr, w - 2 * dpr, h - 2 * dpr, radius);
        g.stroke();
        g.setLineDash([]);
      }
      if (!live) return;
      g.fillStyle = 'rgba(11, 18, 28, 0.8)';
      g.font = `800 ${font}px Onest, system-ui, sans-serif`;
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(LETTERS[i] ?? z.id, x + w / 2, y + h / 2 + font * 0.06);
    });
    // The boss's stage: a solid circle nobody passes.
    for (const c of this.map.circles) {
      g.fillStyle = STAGE;
      g.beginPath();
      g.ellipse(X(c.x), Y(c.y), c.r * sx, c.r * sy, 0, 0, Math.PI * 2);
      g.fill();
    }
  }
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
