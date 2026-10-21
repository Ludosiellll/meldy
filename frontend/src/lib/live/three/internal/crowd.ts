/**
 * The players: one InstancedMesh per body model and per accessory (and one more set for ghosts), so 40 players cost
 * about 15 draw calls whatever they wear. Each player owns a slot in its body's batch and in its accessory's batch;
 * a frame writes a matrix, two baked frame numbers and the colour into those slots.
 */
import * as THREE from 'three';
import { accessoryIndex, ACCESSORIES, clothesHex, MODELS, modelIndex, type PlayerLook } from '../look';
import { PoseMachine, type Pose } from '../pose';
import { accessoryGeometry } from './accessories';
import type { BakedBodies } from './bodies';
import { crowdMaterial, type CrowdPart, type SharedUniforms } from './materials';
import type { Tags } from './tags';
import type { Blobs } from './blobs';
import { uploadFirst } from './upload';

/** Players a batch holds; the kit draws up to this many players (the server's room holds 60). */
export const MAX_PLAYERS = 64;
/** Map units per metre. */
export const UNITS = 50;
const TURN_RATE = 11;
/** Where the name tag sits over the feet, metres. */
const TAG_Y = 2.95;

class Batch {
  readonly mesh: THREE.InstancedMesh;
  readonly outline: THREE.InstancedMesh | null;
  readonly anim: Float32Array;
  readonly tint: Float32Array;
  private readonly animAttr: THREE.InstancedBufferAttribute;
  private readonly tintAttr: THREE.InstancedBufferAttribute;
  readonly owners: (Slot | null)[] = [];
  count = 0;

  constructor(source: THREE.BufferGeometry, material: THREE.Material, outlineMaterial: THREE.Material | null, name: string) {
    const geometry = new THREE.BufferGeometry();
    for (const [key, attr] of Object.entries(source.attributes)) geometry.setAttribute(key, attr);
    geometry.index = source.index;
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.anim = new Float32Array(MAX_PLAYERS * 4);
    this.tint = new Float32Array(MAX_PLAYERS * 4);
    this.animAttr = new THREE.InstancedBufferAttribute(this.anim, 4);
    this.tintAttr = new THREE.InstancedBufferAttribute(this.tint, 4);
    this.animAttr.setUsage(THREE.DynamicDrawUsage);
    this.tintAttr.setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('kitAnim', this.animAttr);
    geometry.setAttribute('kitTint', this.tintAttr);
    this.mesh = new THREE.InstancedMesh(geometry, material, MAX_PLAYERS);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    this.mesh.name = name;
    if (outlineMaterial) {
      this.outline = new THREE.InstancedMesh(geometry, outlineMaterial, MAX_PLAYERS);
      this.outline.instanceMatrix = this.mesh.instanceMatrix;
      this.outline.frustumCulled = false;
      this.outline.count = 0;
      this.outline.visible = false;
      this.outline.name = `${name} outline`;
    } else {
      this.outline = null;
    }
  }

  get matrices(): Float32Array {
    return this.mesh.instanceMatrix.array as Float32Array;
  }

  add(slot: Slot): void {
    if (this.count >= MAX_PLAYERS) throw new Error(`more than ${MAX_PLAYERS} players`);
    slot.batch = this;
    slot.index = this.count++;
    this.owners[slot.index] = slot;
  }

  remove(slot: Slot): void {
    const last = this.count - 1;
    const i = slot.index;
    if (i !== last) {
      const moved = this.owners[last] as Slot;
      this.matrices.copyWithin(i * 16, last * 16, last * 16 + 16);
      this.anim.copyWithin(i * 4, last * 4, last * 4 + 4);
      this.tint.copyWithin(i * 4, last * 4, last * 4 + 4);
      this.owners[i] = moved;
      moved.index = i;
    }
    this.owners[last] = null;
    this.count = last;
    slot.batch = null;
    slot.index = -1;
  }

  /** After the frame's writes: upload and show what is used. */
  finish(outlines: boolean): void {
    const n = this.count;
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (this.outline) {
      this.outline.count = n;
      this.outline.visible = n > 0 && outlines;
    }
    if (n > 0) {
      uploadFirst(this.mesh.instanceMatrix, n);
      uploadFirst(this.animAttr, n);
      uploadFirst(this.tintAttr, n);
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.dispose();
    this.outline?.dispose();
  }
}

interface Slot {
  batch: Batch | null;
  index: number;
}

export class Crowd {
  readonly group = new THREE.Group();
  readonly batches: Batch[] = [];
  /** [layer][model] body batches; layer 0 solid, 1 ghost. */
  private readonly bodyBatches: Batch[][] = [[], []];
  private readonly accBatches: Batch[][] = [[], []];
  private readonly materials: THREE.Material[] = [];
  private readonly accGeometries: THREE.BufferGeometry[] = [];
  /** Every live player (an array: iterating it each frame allocates nothing). */
  readonly players: CrowdPlayer[] = [];
  outlines = true;
  /** How high over the feet the name tags sit, metres (ViewOptions.tagHeight). */
  tagY = TAG_Y;
  /** Counts the kit's frames (see CrowdPlayer.stamp). */
  frame = 0;

  constructor(
    readonly baked: BakedBodies,
    readonly shared: SharedUniforms,
    ramp: THREE.Texture,
    readonly tags: Tags,
    readonly blobs: Blobs,
  ) {
    this.group.name = 'crowd';
    const models = MODELS.length;
    const make = (part: CrowdPart, variant: 'solid' | 'outline' | 'ghost', map: THREE.Texture | null) => {
      const m = crowdMaterial(part, variant, shared, ramp, map, models);
      this.materials.push(m);
      return m;
    };
    const outlineBody = make('body', 'outline', null);
    const ghostBody = make('body', 'ghost', null);
    baked.bodies.forEach((body, i) => {
      const solid = new Batch(body.geometry, make('body', 'solid', body.texture), outlineBody, `body ${body.model}`);
      const ghost = new Batch(body.geometry, ghostBody, null, `ghost ${body.model}`);
      this.bodyBatches[0][i] = solid;
      this.bodyBatches[1][i] = ghost;
      shared.kitPlace.value[i].copy(body.place);
    });
    shared.kitHead.value = baked.bodies[0].head;
    const accSolid = make('acc', 'solid', null);
    const accOutline = make('acc', 'outline', null);
    const accGhost = make('acc', 'ghost', null);
    ACCESSORIES.forEach((id, i) => {
      const geo = accessoryGeometry(id);
      this.accGeometries.push(geo);
      this.accBatches[0][i] = new Batch(geo, accSolid, accOutline, `hat ${id}`);
      this.accBatches[1][i] = new Batch(geo, accGhost, null, `ghost hat ${id}`);
    });
    // draw order: solid bodies and hats, their outlines, then ghosts (see-through, last)
    for (const layer of [0, 1]) {
      for (const b of [...this.bodyBatches[layer], ...this.accBatches[layer]]) {
        this.batches.push(b);
        this.group.add(b.mesh);
        if (b.outline) this.group.add(b.outline);
        if (layer === 1) b.mesh.renderOrder = 5;
      }
    }
  }

  bodyBatch(ghost: boolean, model: number): Batch {
    return this.bodyBatches[ghost ? 1 : 0][model];
  }

  accBatch(ghost: boolean, acc: number): Batch {
    return this.accBatches[ghost ? 1 : 0][acc];
  }

  /** Every batch visible with one instance, for compiling the shaders before a round. */
  showAllForWarmUp(on: boolean): void {
    for (const b of this.batches) {
      b.mesh.visible = on || b.count > 0;
      if (on) b.mesh.count = Math.max(1, b.count);
      if (b.outline) b.outline.visible = on || (b.count > 0 && this.outlines);
    }
  }

  finish(): void {
    for (const b of this.batches) b.finish(this.outlines);
  }

  dispose(): void {
    for (const p of this.players.slice()) p.dispose();
    for (const b of this.batches) b.dispose();
    for (const m of this.materials) m.dispose();
    for (const g of this.accGeometries) g.dispose();
    for (const body of this.baked.bodies) {
      body.geometry.dispose();
      body.texture.dispose();
    }
    this.baked.bones.dispose();
  }
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _frames = new Float32Array(3);

export class CrowdPlayer {
  readonly model: number;
  readonly acc: number;
  private readonly color = new THREE.Color();
  private readonly machine: PoseMachine;
  private readonly body: Slot = { batch: null, index: -1 };
  private readonly hat: Slot = { batch: null, index: -1 };
  private readonly tag: number;
  private readonly phase: number;
  private x = 0;
  private y = 0;
  private z = 0;
  private facing = 0;
  private target = 0;
  private ghost = false;
  private away = false;
  private time = 0;
  private disposed = false;
  /** The kit frame this player was last updated in. */
  stamp = -1;

  constructor(
    private readonly crowd: Crowd,
    readonly look: PlayerLook,
    readonly name: string,
    seed: number,
  ) {
    this.model = modelIndex(look.body);
    this.acc = accessoryIndex(look.hat);
    const hex = clothesHex(look.colour);
    this.color.set(hex);
    this.phase = ((seed * 0.6180339887) % 1 + 1) % 1;
    this.machine = new PoseMachine(crowd.baked.clips, this.phase);
    // No name, no tag: a phone knows only its own player's name (CONTRACT §5), so the others carry none there.
    this.tag = name.trim() ? crowd.tags.add(name, hex) : -1;
    this.attach();
    crowd.players.push(this);
  }

  get pose(): Pose {
    return this.machine.pose;
  }

  /** Dev only (thumbnails): clothes in this colour instead of the look's. */
  overrideTint(hex: string): void {
    this.color.set(hex);
  }

  setPose(pose: Pose): void {
    this.machine.set(pose);
  }

  setAway(on: boolean): void {
    this.away = on;
  }

  setGhost(on: boolean): void {
    if (on === this.ghost || this.disposed) return;
    this.detach();
    this.ghost = on;
    this.attach();
  }

  /** Map angle the player faces: 0 = towards +y (down the map, to the viewer), π/2 = towards +x. */
  setFacing(rad: number, instant = false): void {
    this.target = rad;
    if (instant) this.facing = rad;
  }

  /** Map units; z = height over the floor (negative: below it, falling). */
  setPosition(x: number, y: number, z = 0): void {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  /** Advances the pose and the turn by dt seconds (the kit calls it each frame for a player not updated by hand). */
  update(dt: number): void {
    this.stamp = this.crowd.frame;
    if (this.disposed) return;
    const step = dt > 0.1 ? 0.1 : dt < 0 ? 0 : dt;
    this.time += step;
    this.machine.step(step);
    // turn the short way round, at most TURN_RATE rad/s
    let d = this.target - this.facing;
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    const turn = TURN_RATE * step;
    this.facing += d > turn ? turn : d < -turn ? -turn : d;
  }

  /** Writes this frame's instance data, the blob and the tag (the kit calls it once per frame). */
  write(): void {
    if (this.disposed) return;
    const body = this.crowd.baked.bodies[this.model];
    const wx = this.x / UNITS;
    const wz = this.y / UNITS;
    let wy = this.z / UNITS;
    let tilt = 0;
    let roll = 0;
    if (this.ghost) {
      wy += 0.3 + 0.14 * Math.sin(this.time * 3 + this.phase * 6.28);
      roll = 0.08 * Math.sin(this.time * 2.2 + this.phase * 6.28);
    } else if (this.machine.pose === 'fall') {
      tilt = Math.min(1.1, this.machine.t * 1.8);
    }
    _e.set(tilt, this.facing, roll);
    _q.setFromEuler(_e);
    _p.set(wx, wy + body.lift, wz);
    _s.setScalar(body.scale);
    _m.compose(_p, _q, _s);
    this.machine.sample(_frames, 0);
    this.writeSlot(this.body, body.row0, this.acc >= 0 ? 1 : 0);
    this.writeSlot(this.hat, body.row0, this.model);
    const falling = this.z < -20;
    if (!falling) {
      const floorY = this.ghost ? 0 : this.z / UNITS;
      if (!this.ghost) this.crowd.blobs.push(wx, Math.min(0, floorY) + 0.02, wz, 0.62, 1, this.color.r, this.color.g, this.color.b, 0.95);
    }
    if (!falling || this.ghost) this.crowd.tags.push(this.tag, wx, wy + this.crowd.tagY, wz, this.ghost || this.away);
  }

  private writeSlot(slot: Slot, row0: number, w: number): void {
    const b = slot.batch;
    if (!b) return;
    const i = slot.index;
    _m.toArray(b.matrices, i * 16);
    b.anim[i * 4] = _frames[0] + row0;
    b.anim[i * 4 + 1] = _frames[1] + row0;
    b.anim[i * 4 + 2] = _frames[2];
    b.anim[i * 4 + 3] = 0;
    b.tint[i * 4] = this.color.r;
    b.tint[i * 4 + 1] = this.color.g;
    b.tint[i * 4 + 2] = this.color.b;
    b.tint[i * 4 + 3] = w;
  }

  private attach(): void {
    this.crowd.bodyBatch(this.ghost, this.model).add(this.body);
    if (this.acc >= 0) this.crowd.accBatch(this.ghost, this.acc).add(this.hat);
  }

  private detach(): void {
    this.body.batch?.remove(this.body);
    this.hat.batch?.remove(this.hat);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.detach();
    this.crowd.tags.remove(this.tag);
    const list = this.crowd.players;
    const i = list.indexOf(this);
    if (i >= 0) {
      list[i] = list[list.length - 1];
      list.pop();
    }
  }
}
