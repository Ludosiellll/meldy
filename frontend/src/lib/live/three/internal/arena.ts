/**
 * The arena of mode A: a floor of tiles laid on the server's map, the answer zones in colour with their letter and
 * answer, the boss's stage beyond the far edge, and the collapse: every tile outside the right zone drops in a ripple
 * that starts under the stage.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import {
  COLLAPSE,
  TILE_TARGET,
  dropHeight,
  floorRect,
  impactOf,
  layoutTiles,
  planCollapse,
  riseHeight,
  shakeAmount,
  stageOf,
  tileIndexAt,
  type ArenaShape,
  type MoveMap,
  type Point,
  type TileLayout,
} from '../arenaPlan';
import { canvasTexture, FONT, hullMaterial, makeRamp, roundRect, toon, type SharedUniforms } from './materials';
import type { ArenaLook } from '../types';
import { UNITS } from './crowd';
import { ZONE_COLOURS } from '../constants';

export { ZONE_COLOURS };
const LETTERS: Record<string, string> = { A: 'А', B: 'Б', C: 'В', D: 'Г', E: 'Д', F: 'Е' };
const PIT = new THREE.Color('#15142e');
/** The floor's plain tiles (and a closed zone's), in a light check. */
const PLAIN = ['#e6d9c1', '#efe5d1'];
/** How deep the stage's column goes into the pit, metres. */
const COLUMN = 9;
const TILE_DEPTH = 0.7;

/** The letter shown for a zone id: the server's A–D become А–Г. */
export function zoneLetter(id: string): string {
  return LETTERS[id] ?? id;
}

interface Label {
  zone: number;
  mesh: THREE.Mesh;
  texture: THREE.CanvasTexture;
  base: THREE.Vector3;
  flat: boolean;
  /** Tile the label lies on (flat labels fall with it). */
  tile: number;
  text: string;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);
const _zero = new THREE.Vector3(0, 0, 0);
const _c = new THREE.Color();

export class ArenaImpl {
  readonly group = new THREE.Group();
  readonly layout: TileLayout;
  readonly stage: { x: number; y: number };
  readonly impact: Point;
  /** The floor's outline, map units (the shape's grid, or the whole map). */
  readonly bounds: { x: number; y: number; w: number; h: number };
  /** Zones that take no answer now (by index): plain tiles, no sign. */
  private readonly closed: boolean[];
  private readonly tiles: THREE.InstancedMesh;
  private readonly baseColors: THREE.Color[];
  private readonly drop: Float64Array;
  private readonly riseAt: Float64Array;
  private readonly riseFrom: Float64Array;
  private readonly labels: Label[] = [];
  private readonly posts: { zone: number; mesh: THREE.Mesh }[] = [];
  private readonly shock: THREE.Mesh;
  readonly redLight: THREE.PointLight;
  private readonly disposables: { dispose(): void }[] = [];
  private shockAt = Infinity;
  private shookAt = Infinity;
  private animating = false;
  private seed = 1;
  /** Seconds of the kit's clock. */
  private now = 0;
  effects = true;

  constructor(
    readonly map: MoveMap,
    private readonly ramp: THREE.Texture,
    private readonly shared: SharedUniforms,
    private readonly onShake: (strength: number) => void,
    readonly shape: ArenaShape = {},
    look: ArenaLook = {},
  ) {
    this.group.name = 'arena';
    this.layout = layoutTiles(map, TILE_TARGET, shape);
    this.stage = stageOf(map, shape);
    this.impact = impactOf(map, shape);
    this.bounds = floorRect(map, shape);
    this.closed = (map.zones ?? []).map(() => false);
    const n = this.layout.tiles.length;
    this.drop = new Float64Array(n).fill(Infinity);
    this.riseAt = new Float64Array(n).fill(Infinity);
    this.riseFrom = new Float64Array(n);
    const gridded = !!shape.floor;
    const staged = !!shape.stage && shape.stage.length >= 3;
    // the floor's outline in metres: the whole map, or the shape's grid
    const FX = this.bounds.x / UNITS;
    const FZ = this.bounds.y / UNITS;
    const W = this.bounds.w / UNITS;
    const H = this.bounds.h / UNITS;
    const sx = this.layout.sx / UNITS;
    const sy = this.layout.sy / UNITS;

    const signScale = Math.min(1, Math.max(0.3, look.signScale ?? 1));
    // tiles
    const tileGeo = new RoundedBoxGeometry(sx * 0.95, TILE_DEPTH, sy * 0.95, Math.max(1, Math.round(look.tileSegments ?? 2)), Math.min(sx, sy) * 0.07);
    const tileMat = toon('#ffffff', this.own(makeRamp([170, 210, 240, 255])));
    this.tiles = new THREE.InstancedMesh(tileGeo, tileMat, n);
    this.tiles.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tiles.name = 'floor tiles';
    this.own(tileGeo);
    this.own(tileMat);
    this.baseColors = this.layout.tiles.map(() => new THREE.Color());
    this.paintTiles();
    this.layout.tiles.forEach((t, i) => {
      this.tiles.setColorAt(i, this.baseColors[i]);
      if (t.under) _m.compose(_p.set(t.x / UNITS, -TILE_DEPTH / 2, t.y / UNITS), _q.identity(), _zero);
      else _m.makeTranslation(t.x / UNITS, -TILE_DEPTH / 2, t.y / UNITS);
      this.tiles.setMatrixAt(i, _m);
    });
    this.group.add(this.tiles);

    // frame around the floor: the map's own walls when the floor is the server's grid (they are its border), else a
    // frame round the whole map
    const frameParts = gridded
      ? (map.solids ?? [])
          .filter((sd) => sd.rect && sd.rect.length >= 4)
          .map((sd) => {
            const [x, y, w, h] = sd.rect as number[];
            return new RoundedBoxGeometry(w / UNITS, 1.0, h / UNITS, 2, 0.2).translate((x + w / 2) / UNITS, -0.2, (y + h / 2) / UNITS);
          })
      : [
          [W / 2, -1.3, W + 3.6, 2.6],
          [W / 2, H + 0.6, W + 3.6, 1.2],
          [-0.8, H / 2, 1.2, H + 4.4],
          [W + 0.8, H / 2, 1.2, H + 4.4],
        ].map(([x, z, w, d]) => new RoundedBoxGeometry(w, 1.0, d, 2, 0.2).translate(x, -0.2, z));
    if (frameParts.length) {
      const frameGeo = mergeGeometries(frameParts) as THREE.BufferGeometry;
      frameParts.forEach((g) => g.dispose());
      this.addWithHull(this.own(frameGeo), this.own(toon('#3a3360', ramp)), 'frame');
    }

    // the pit under the floor: falling tiles go into the dark
    const pitTex = this.own(
      canvasTexture(4, 128, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, '#3a3268');
        gr.addColorStop(0.4, '#1a1838');
        gr.addColorStop(1, '#0b0b1c');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
      }),
    );
    const walls = [
      new THREE.PlaneGeometry(W, 16).translate(FX + W / 2, -8.2, FZ),
      new THREE.PlaneGeometry(H, 16).rotateY(Math.PI / 2).translate(FX, -8.2, FZ + H / 2),
      new THREE.PlaneGeometry(H, 16).rotateY(-Math.PI / 2).translate(FX + W, -8.2, FZ + H / 2),
    ];
    const wallGeo = mergeGeometries(walls) as THREE.BufferGeometry;
    walls.forEach((g) => g.dispose());
    const wallMat = new THREE.MeshBasicMaterial({ map: pitTex, side: THREE.DoubleSide, fog: false });
    const wallMesh = new THREE.Mesh(this.own(wallGeo), this.own(wallMat));
    wallMesh.name = 'pit';
    this.group.add(wallMesh);
    const frontTex = this.own(
      canvasTexture(4, 128, (g, w, h) => {
        const gr = g.createLinearGradient(0, 0, 0, h);
        gr.addColorStop(0, '#2f2858');
        gr.addColorStop(1, '#121230');
        g.fillStyle = gr;
        g.fillRect(0, 0, w, h);
      }),
    );
    const front = new THREE.Mesh(this.own(new THREE.PlaneGeometry(W + 3.6, 16)), this.own(new THREE.MeshBasicMaterial({ map: frontTex })));
    // just in front of the frame's front face and overlapping it, so no gap shows the pit below the frame
    front.position.set(FX + W / 2, -8.35, gridded ? map.h / UNITS + 0.05 : H + 1.25);
    front.name = 'front skirt';
    this.group.add(front);

    // solids from the map: walls and pillars
    const solidParts: THREE.BufferGeometry[] = [];
    for (const s of map.solids ?? []) {
      if (gridded && s.rect) continue; // the frame
      if (staged && s.circle && s.circle[0] === this.stage.x && s.circle[1] === this.stage.y) continue; // the stage
      if (s.rect && s.rect.length >= 4) {
        const [x, y, w, h] = s.rect;
        solidParts.push(new RoundedBoxGeometry(w / UNITS, 1.1, h / UNITS, 2, 0.12).translate((x + w / 2) / UNITS, 0.55, (y + h / 2) / UNITS));
      } else if (s.circle && s.circle.length >= 3) {
        const [x, y, r] = s.circle;
        solidParts.push(new THREE.CylinderGeometry(r / UNITS, r / UNITS, 1.1, 24).translate(x / UNITS, 0.55, y / UNITS));
      }
    }
    if (solidParts.length) {
      const nonIndexed = solidParts.map((g) => (g.index ? g.toNonIndexed() : g));
      nonIndexed.forEach((g) => g.deleteAttribute('uv'));
      const solidGeo = mergeGeometries(nonIndexed) as THREE.BufferGeometry;
      solidParts.forEach((g) => g.dispose());
      nonIndexed.forEach((g) => g.dispose());
      this.addWithHull(this.own(solidGeo), this.own(toon('#6a5fa8', ramp)), 'solids');
    }

    // zone labels
    (map.zones ?? []).forEach((zone, zi) => {
      const [x, y, w, h] = zone.rect;
      const cx = (x + w / 2) / UNITS;
      const flat = y + h / 2 >= map.h / 2;
      const width = Math.min((w / UNITS) * 0.92, 11.2) * signScale;
      const height = width * (140 / 1024);
      const texture = this.own(canvasTexture(1024, 140, () => undefined));
      const mat = this.own(new THREE.MeshBasicMaterial({ map: texture, transparent: true, depthWrite: false }));
      const mesh = new THREE.Mesh(this.own(new THREE.PlaneGeometry(width, height)), mat);
      mesh.renderOrder = 2;
      let base: THREE.Vector3;
      let tile = -1;
      if (flat) {
        mesh.rotation.x = -Math.PI / 2;
        const lz = (y + h) / UNITS - height / 2 - 0.25;
        base = new THREE.Vector3(cx, 0.03, lz);
        tile = tileIndexAt(this.layout, x + w / 2, lz * UNITS);
      } else {
        // an upright sign on two legs at the zone's far edge, high enough to read over the heads and name tags
        mesh.rotation.x = -0.25;
        const z = y < 160 ? -1.3 : y / UNITS - 1.0;
        base = new THREE.Vector3(cx, 3.05, z);
        const board = new RoundedBoxGeometry(width + 0.4, height + 0.37, 0.25, 2, 0.1)
          .rotateX(-0.25)
          .translate(0, 0, -0.16);
        const legs = [-1, 1].map((sx) =>
          new RoundedBoxGeometry(0.22, base.y, 0.22, 2, 0.06).translate(sx * (width / 2 - 0.9 * signScale), -base.y / 2, -0.25),
        );
        const signGeo = mergeGeometries([board, ...legs]) as THREE.BufferGeometry;
        board.dispose();
        legs.forEach((g) => g.dispose());
        const post = this.addWithHull(this.own(signGeo), this.own(toon('#3a3360', ramp)), 'sign');
        post.position.copy(base);
        this.posts.push({ zone: zi, mesh: post });
      }
      mesh.position.copy(base);
      mesh.name = `label ${zone.id}`;
      this.group.add(mesh);
      const label: Label = { zone: zi, mesh, texture, base, flat, tile, text: '' };
      this.labels.push(label);
      this.drawLabel(label);
    });

    // the boss's stage: beyond the far edge, or (with the shape's stage) a round column in the floor that stays when
    // the tiles around it drop, as wide as the solid circle the players run round
    const st = { x: this.stage.x / UNITS, z: this.stage.y / UNITS };
    const sr = staged ? (shape.stage as number[])[2] / UNITS : 4.6;
    const stageGeo = this.own(
      staged ? new THREE.CylinderGeometry(sr, sr * 0.92, COLUMN, 48).translate(0, 0.3 - COLUMN / 2, 0) : new THREE.CylinderGeometry(4.6, 5.0, 1.2, 48),
    );
    const stageMesh = this.addWithHull(stageGeo, this.own(toon('#2c2650', ramp)), 'stage');
    stageMesh.position.set(st.x, staged ? 0 : -0.3, st.z);
    const ring = new THREE.Mesh(
      this.own(new THREE.TorusGeometry(staged ? sr * 0.86 : 4.3, staged ? 0.07 : 0.12, 8, 64)),
      this.own(new THREE.MeshBasicMaterial({ color: '#ff3b4a' })),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(st.x, 0.31, st.z);
    ring.name = 'stage ring';
    this.group.add(ring);
    const stripes = this.own(
      canvasTexture(512, 64, (g, w, h) => {
        g.fillStyle = '#ffcf3a';
        g.fillRect(0, 0, w, h);
        g.fillStyle = '#1d1b2e';
        for (let x = -64; x < w; x += 48) {
          g.beginPath();
          g.moveTo(x, h);
          g.lineTo(x + 24, 0);
          g.lineTo(x + 48, 0);
          g.lineTo(x + 24, h);
          g.fill();
        }
      }),
    );
    stripes.wrapS = THREE.RepeatWrapping;
    stripes.repeat.set(staged ? Math.max(2, Math.round(sr * 1.3)) : 6, 1);
    const bandR = staged ? sr + 0.02 : 5.02;
    const band = new THREE.Mesh(this.own(new THREE.CylinderGeometry(bandR, bandR, 0.35, 64, 1, true)), this.own(toon('#ffffff', ramp, { map: stripes })));
    band.position.set(st.x, staged ? 0.1 : 0.05, st.z);
    band.name = 'stage band';
    this.group.add(band);

    // the stomp's shock ring
    const imp = this.impact;
    this.shock = new THREE.Mesh(
      this.own(new THREE.RingGeometry(0.85, 1, 64)),
      this.own(new THREE.MeshBasicMaterial({ color: '#ff8a3d', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide })),
    );
    this.shock.rotation.x = -Math.PI / 2;
    this.shock.position.set(imp.x / UNITS, 0.45, imp.y / UNITS);
    this.shock.visible = false;
    this.shock.name = 'shock ring';
    this.group.add(this.shock);

    this.redLight = new THREE.PointLight('#ff2a3a', 25, 30, 1.6);
    // in front of the stage and low: it reddens the floor around the boss more than the boss itself
    this.redLight.position.set(st.x, 3, st.z + (staged ? sr + 2 : 5.5));
    this.group.add(this.redLight);
  }

  private own<T extends { dispose(): void }>(thing: T): T {
    this.disposables.push(thing);
    return thing;
  }

  private addWithHull(geo: THREE.BufferGeometry, mat: THREE.Material, name: string): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    this.group.add(mesh);
    const hull = new THREE.Mesh(geo, this.hullMat());
    hull.name = `${name} outline`;
    mesh.add(hull);
    this.hulls.push(hull);
    return mesh;
  }

  private hullShared: THREE.Material | null = null;
  readonly hulls: THREE.Mesh[] = [];
  private hullMat(): THREE.Material {
    if (!this.hullShared) this.hullShared = this.own(hullMaterial(this.shared));
    return this.hullShared;
  }

  private drawLabel(label: Label): void {
    const zone = (this.map.zones ?? [])[label.zone];
    const colour = ZONE_COLOURS[label.zone % ZONE_COLOURS.length];
    const canvas = label.texture.image as HTMLCanvasElement;
    const g = canvas.getContext('2d');
    if (!g) return;
    const w = canvas.width;
    const h = canvas.height;
    g.clearRect(0, 0, w, h);
    const text = label.text.trim();
    let right = 140;
    let font = 70;
    if (text) {
      g.font = `800 ${font}px ${FONT}`;
      const tw = g.measureText(text).width;
      if (tw > w - 200) {
        font = Math.max(36, Math.floor((font * (w - 200)) / tw));
        g.font = `800 ${font}px ${FONT}`;
      }
      right = Math.min(w - 4, 156 + Math.min(w - 200, g.measureText(text).width) + 40);
    }
    const x0 = text ? 4 : 0;
    roundRect(g, x0, 4, right - x0, h - 8, 34);
    g.fillStyle = 'rgba(255, 255, 255, 0.94)';
    g.fill();
    roundRect(g, x0 + 18, 18, 104, 104, 24);
    g.fillStyle = colour;
    g.fill();
    g.fillStyle = '#ffffff';
    g.font = `800 76px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(zoneLetter(zone?.id ?? ''), x0 + 70, 74);
    if (text) {
      g.fillStyle = '#1d1b2e';
      g.textAlign = 'left';
      g.font = `800 ${font}px ${FONT}`;
      g.fillText(text, 156, 74, w - 200);
    }
    label.texture.needsUpdate = true;
  }

  /** Each tile's colour at rest: its zone's (a closed zone's tiles plain), or the floor's check. */
  private paintTiles(): void {
    this.layout.tiles.forEach((t, i) => {
      const c = this.baseColors[i];
      if (t.zone >= 0 && !this.closed[t.zone]) {
        c.set(ZONE_COLOURS[t.zone % ZONE_COLOURS.length]);
        if ((t.col + t.row) % 2) c.offsetHSL(0, -0.02, 0.06);
      } else {
        c.set(PLAIN[(t.col + t.row) % 2]);
        if (t.zone >= 0) c.offsetHSL(0, -0.04, -0.05);
      }
    });
  }

  setClosedZones(ids: readonly string[]): void {
    const zones = this.map.zones ?? [];
    let changed = false;
    zones.forEach((z, i) => {
      const off = ids.includes(z.id);
      if (off !== this.closed[i]) changed = true;
      this.closed[i] = off;
    });
    if (!changed) return;
    this.paintTiles();
    for (const label of this.labels) label.mesh.visible = !this.closed[label.zone];
    for (const post of this.posts) post.mesh.visible = !this.closed[post.zone];
    if (!this.animating) {
      this.layout.tiles.forEach((_t, i) => this.tiles.setColorAt(i, this.baseColors[i]));
      if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
    }
  }

  setZoneLabels(labels: Partial<Record<string, string>>): void {
    for (const label of this.labels) {
      const id = (this.map.zones ?? [])[label.zone]?.id ?? '';
      const text = labels[id] ?? '';
      if (text === label.text) continue;
      label.text = text;
      this.drawLabel(label);
    }
  }

  collapse(correctZoneId: string | readonly string[], tStart: number): void {
    this.seed = (this.seed * 1103515245 + 12345) & 0x7fffffff;
    planCollapse(this.map, this.layout, correctZoneId, tStart, this.seed, this.drop, this.impact);
    this.riseAt.fill(Infinity);
    this.shockAt = tStart;
    this.shookAt = Infinity;
    this.animating = true;
  }

  restore(): void {
    const imp = this.impact;
    this.layout.tiles.forEach((t, i) => {
      const h = this.heightOf(i);
      if (h < 0 || this.drop[i] !== Infinity) {
        this.riseFrom[i] = Math.min(0, h);
        this.riseAt[i] = this.now + Math.hypot(t.x - imp.x, t.y - imp.y) * COLLAPSE.perUnit * 0.5;
      }
      this.drop[i] = Infinity;
    });
    this.shockAt = Infinity;
    this.animating = true;
  }

  /** Height of the tile top at index i at kit second `at` (default: the last update), map units. */
  private heightOf(i: number, at = this.now): number {
    if (this.riseAt[i] !== Infinity) return riseHeight(at, this.riseAt[i], this.riseFrom[i]);
    return dropHeight(at, this.drop[i]);
  }

  floorAt(x: number, y: number, at?: number): number {
    const i = tileIndexAt(this.layout, x, y);
    return i < 0 ? 0 : this.heightOf(i, at);
  }

  fallsAt(x: number, y: number): number {
    const i = tileIndexAt(this.layout, x, y);
    return i < 0 ? Infinity : this.drop[i];
  }

  update(now: number): void {
    this.now = now;
    // the shock ring and the camera's jolt at the impact
    if (now >= this.shockAt && now < this.shockAt + 0.9 && this.effects) {
      const u = (now - this.shockAt) / 0.9;
      this.shock.visible = true;
      this.shock.scale.setScalar(1 + u * 22);
      (this.shock.material as THREE.MeshBasicMaterial).opacity = (1 - u) * 0.9;
    } else {
      this.shock.visible = false;
    }
    if (now >= this.shockAt && this.shookAt !== this.shockAt) {
      this.shookAt = this.shockAt;
      if (now < this.shockAt + 0.5) this.onShake(0.35);
    }
    if (!this.animating) return;
    let busy = false;
    const tiles = this.layout.tiles;
    for (let i = 0; i < tiles.length; i++) {
      const t = tiles[i];
      let y = 0;
      let rx = 0;
      let rz = 0;
      let wob = 0;
      if (this.riseAt[i] !== Infinity) {
        y = riseHeight(now, this.riseAt[i], this.riseFrom[i]);
        if (now < this.riseAt[i] + COLLAPSE.rise) busy = true;
        else this.riseAt[i] = Infinity;
      } else if (this.drop[i] !== Infinity) {
        const start = this.drop[i];
        const shake = shakeAmount(now, start);
        if (shake > 0) {
          wob = shake;
          busy = true;
        }
        y = dropHeight(now, start);
        if (now > start) {
          const u = now - start;
          const k = ((i * 7919) % 100) / 100 - 0.5;
          rx = k * 1.8 * u;
          rz = (((i * 104729) % 100) / 100 - 0.5) * 1.8 * u;
          if (y > COLLAPSE.gone) busy = true;
        } else {
          busy = true;
        }
      }
      const wy = y / UNITS;
      if (wob > 0) {
        const s = now * 80 + i;
        _p.set(t.x / UNITS, -TILE_DEPTH / 2 + Math.sin(s * 1.1) * 0.04 * wob, t.y / UNITS);
        _e.set(Math.sin(s * 0.9) * 0.03 * wob, 0, Math.cos(s) * 0.03 * wob);
      } else {
        _p.set(t.x / UNITS, -TILE_DEPTH / 2 + wy, t.y / UNITS);
        _e.set(rx, 0, rz);
      }
      _q.setFromEuler(_e);
      _m.compose(_p, _q, t.under || y <= COLLAPSE.gone ? _zero : _one);
      this.tiles.setMatrixAt(i, _m);
      _c.copy(this.baseColors[i]).lerp(PIT, Math.min(0.92, Math.max(0, -wy / 7)));
      this.tiles.setColorAt(i, _c);
    }
    this.tiles.instanceMatrix.needsUpdate = true;
    if (this.tiles.instanceColor) this.tiles.instanceColor.needsUpdate = true;
    for (const label of this.labels) {
      if (!label.flat || label.tile < 0) continue;
      const h = this.heightOf(label.tile) / UNITS;
      label.mesh.position.set(label.base.x, label.base.y + h, label.base.z);
      label.mesh.visible = h > -12 && !this.closed[label.zone];
    }
    this.animating = busy;
  }

  /**
   * Points the camera keeps in the picture so every zone's sign is whole: the tops of the upright signs and the four
   * corners of the labels lying on the floor (metres).
   */
  labelPoints(): THREE.Vector3[] {
    const out: THREE.Vector3[] = [];
    for (const l of this.labels) {
      if (!l.flat) {
        out.push(new THREE.Vector3(l.base.x, l.base.y + 0.9, l.base.z - 0.4));
        continue;
      }
      const g = l.mesh.geometry as THREE.PlaneGeometry;
      const hw = g.parameters.width / 2;
      const hh = g.parameters.height / 2;
      for (const [dx, dz] of [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]]) out.push(new THREE.Vector3(l.base.x + dx, 0, l.base.z + dz));
    }
    return out;
  }

  setOutlines(on: boolean): void {
    for (const h of this.hulls) h.visible = on;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.tiles.dispose();
    this.group.removeFromParent();
  }
}
