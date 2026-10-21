/**
 * The kit itself (the lazily loaded chunk with three.js): loads the KayKit files, builds the crowd, and hands out
 * players, bosses, arenas and the view.
 */
import * as THREE from 'three';
import { GLTFLoader, type GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { ANIMS_FILE, BODY_FILES, SKELETON_FILE } from '../assets.gen';
import { MODELS, toPlayerLook, type PlayerLook } from '../look';
import type { ArenaShape, MoveMap } from '../arenaPlan';
import type { Arena, Boss, BossKind, BossOptions, BossPhase, Kit, LoadOptions, Player, View, ViewOptions } from '../types';
import { buildBodies } from './bodies';
import { Blobs } from './blobs';
import { Ice } from './ice';
import { BossImpl } from './boss';
import { Crowd, CrowdPlayer, MAX_PLAYERS, UNITS } from './crowd';
import { makeRamp, sharedUniforms, canvasTexture, FONT, type SharedUniforms } from './materials';
import { Tags } from './tags';
import { ArenaImpl } from './arena';
import { ViewImpl } from './view';

const BASE = `${import.meta.env.BASE_URL ?? '/'}game/`;

function remove<T>(list: T[], item: T): void {
  const i = list.indexOf(item);
  if (i >= 0) list.splice(i, 1);
}

function load(loader: GLTFLoader, file: string): Promise<GLTF> {
  return loader.loadAsync(BASE + file);
}

async function fontsReady(): Promise<void> {
  const fonts = (document as Document & { fonts?: FontFaceSet }).fonts;
  if (!fonts) return;
  const want = Promise.all([fonts.load(`700 32px ${FONT}`, 'Аа'), fonts.load(`800 64px ${FONT}`, 'Аа12')]).then(() => undefined);
  await Promise.race([want.catch(() => undefined), new Promise<void>((r) => setTimeout(r, 1500))]);
}

class BossFacade implements Boss {
  stamp = -1;
  constructor(
    readonly impl: BossImpl,
    private readonly kit: KitImpl,
  ) {}
  get kind(): BossKind {
    return this.impl.kind;
  }
  get phase(): BossPhase {
    return this.impl.phase;
  }
  get stompImpactS(): number {
    return this.impl.stompImpactS;
  }
  setPhase(phase: BossPhase): void {
    this.impl.setPhase(phase);
  }
  setPosition(x: number, y: number): void {
    this.impl.setPosition(x, y);
  }
  setFacing(rad: number): void {
    this.impl.setFacing(rad);
  }
  update(dt: number): void {
    this.stamp = this.kit.crowd.frame;
    this.impl.update(dt);
  }
  dispose(): void {
    remove(this.kit.bosses, this);
    this.impl.dispose();
  }
}

class ArenaFacade implements Arena {
  stamp = -1;
  constructor(
    readonly impl: ArenaImpl,
    private readonly kit: KitImpl,
  ) {}
  get map(): MoveMap {
    return this.impl.map;
  }
  get stage(): { x: number; y: number } {
    return this.impl.stage;
  }
  setZoneLabels(labels: Partial<Record<string, string>>): void {
    this.impl.setZoneLabels(labels);
  }
  setClosedZones(ids: readonly string[]): void {
    this.impl.setClosedZones(ids);
  }
  collapse(correctZoneId: string, tStart?: number): void {
    this.impl.collapse(correctZoneId, tStart ?? this.kit.now());
  }
  restore(): void {
    this.impl.restore();
  }
  floorAt(x: number, y: number): number {
    return this.impl.floorAt(x, y);
  }
  fallsAt(x: number, y: number): number {
    return this.impl.fallsAt(x, y);
  }
  update(_dt: number): void {
    this.stamp = this.kit.crowd.frame;
    this.impl.update(this.kit.now());
  }
  dispose(): void {
    remove(this.kit.arenas, this);
    this.impl.dispose();
  }
}

export class KitImpl implements Kit {
  readonly scene = new THREE.Scene();
  readonly shared: SharedUniforms;
  readonly ramp: THREE.DataTexture;
  readonly crowd: Crowd;
  readonly tags: Tags;
  readonly blobs: Blobs;
  readonly ice: Ice;
  readonly bosses: BossFacade[] = [];
  readonly arenas: ArenaFacade[] = [];
  private skeleton: Promise<GLTF> | null = null;
  private skeletonGltf: GLTF | null = null;
  private view: ViewImpl | null = null;
  private time = 0;
  private seed = 1;
  private outlines = true;
  private effects = true;
  private readonly background: THREE.Texture;

  private constructor(
    private readonly loader: GLTFLoader,
    bodies: GLTF[],
    anims: GLTF,
  ) {
    this.shared = sharedUniforms(MODELS.length);
    this.ramp = makeRamp([120, 170, 215, 255]);
    const baked = buildBodies(bodies, anims.animations);
    this.shared.kitBones.value = baked.bones;
    this.tags = new Tags();
    this.blobs = new Blobs(MAX_PLAYERS + 8);
    // a block per player, and the chips of the blocks breaking at once
    this.ice = new Ice(MAX_PLAYERS * 7);
    this.crowd = new Crowd(baked, this.shared, this.ramp, this.tags, this.blobs, this.ice);
    this.scene.add(this.crowd.group, this.blobs.mesh, this.ice.mesh, this.tags.mesh);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#5a4a7a', 1.25));
    const sun = new THREE.DirectionalLight('#fff1dc', 2.2);
    sun.position.set(-12, 30, 16);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight('#9cc4ff', 0.9);
    rim.position.set(6, 12, -25);
    this.scene.add(rim);
    this.background = canvasTexture(4, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, '#2b2457');
      gr.addColorStop(0.55, '#171a3a');
      gr.addColorStop(1, '#0c0d22');
      g.fillStyle = gr;
      g.fillRect(0, 0, w, h);
    });
    this.scene.background = this.background;
    this.scene.fog = new THREE.Fog('#14163a', 46, 78);
  }

  static async load(options: LoadOptions = {}): Promise<KitImpl> {
    const loader = new GLTFLoader();
    const skeleton = options.boss === 'skeleton' ? load(loader, SKELETON_FILE) : null;
    const [bodies, anims] = await Promise.all([
      Promise.all(MODELS.map((m) => load(loader, BODY_FILES[m]))),
      load(loader, ANIMS_FILE),
      fontsReady(),
    ]);
    const kit = new KitImpl(loader, bodies, anims);
    if (skeleton) {
      kit.skeleton = skeleton;
      kit.skeletonGltf = await skeleton;
    }
    return kit;
  }

  async loadBoss(kind: BossKind): Promise<void> {
    if (kind !== 'skeleton' || this.skeletonGltf) return;
    if (!this.skeleton) this.skeleton = load(this.loader, SKELETON_FILE);
    this.skeletonGltf = await this.skeleton;
  }

  now(): number {
    return this.time;
  }

  createPlayer(look: PlayerLook, name: string): Player {
    return new CrowdPlayer(this.crowd, toPlayerLook(look), name, this.seed++);
  }

  createBoss(kind: BossKind, options: BossOptions = {}): Boss {
    let gltf: GLTF | null = null;
    if (kind === 'skeleton') {
      if (!this.skeletonGltf) throw new Error("the skeleton is not loaded: loadKit({ boss: 'skeleton' }) or kit.loadBoss('skeleton') first");
      gltf = this.skeletonGltf;
      // the boss takes the loaded scene over: a second skeleton needs a fresh load
      this.skeletonGltf = null;
      this.skeleton = null;
    }
    const impl = new BossImpl(kind, this.ramp, this.shared, gltf, options.height ?? (kind === 'skeleton' ? 6.0 : 6.6));
    const arena = this.arenas[0];
    const stage = arena ? arena.stage : { x: 800, y: -160 };
    impl.setPosition(stage.x, stage.y);
    impl.setOutlines(this.outlines);
    impl.setEffects(this.effects);
    this.scene.add(impl.group);
    const boss = new BossFacade(impl, this);
    this.bosses.push(boss);
    return boss;
  }

  createArena(map: MoveMap, shape?: ArenaShape): Arena {
    const impl = new ArenaImpl(map, this.ramp, this.shared, (s) => this.view?.shake(s), shape);
    impl.setOutlines(this.outlines);
    impl.effects = this.effects;
    this.scene.add(impl.group);
    const arena = new ArenaFacade(impl, this);
    this.arenas.push(arena);
    for (const b of this.bosses) b.impl.setPosition(impl.stage.x, impl.stage.y);
    if (this.view) this.view.setCamera({ arena: map });
    return arena;
  }

  mount(canvas: HTMLCanvasElement, options: ViewOptions = {}): View {
    if (this.view) throw new Error('the kit is already on a canvas');
    if (options.transparent) {
      this.scene.background = null;
      this.scene.fog = null;
    }
    this.view = new ViewImpl(this, canvas, options);
    const arena = this.arenas[0];
    if (arena) this.view.setCamera({ arena: arena.map });
    return this.view;
  }

  update(dt: number): void {
    const step = dt > 0.1 ? 0.1 : dt < 0 ? 0 : dt;
    const frame = this.crowd.frame;
    this.time += step;
    this.shared.kitTime.value = this.time;
    this.tags.begin();
    this.blobs.begin();
    this.ice.begin();
    const players = this.crowd.players;
    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (p.stamp !== frame) p.update(step);
      p.write();
    }
    let alarm = 0.25;
    for (let i = 0; i < this.bosses.length; i++) {
      const b = this.bosses[i];
      if (b.stamp !== frame) b.update(step);
      const g = b.impl.group.position;
      this.blobs.push(g.x, g.y + 0.02, g.z, 2.2, 1, 0, 0, 0, 0);
      alarm = Math.max(alarm, b.impl.alarm);
    }
    for (let i = 0; i < this.arenas.length; i++) {
      const a = this.arenas[i];
      if (a.stamp !== frame) a.update(step);
      a.impl.redLight.intensity = 10 + 30 * alarm;
    }
    this.crowd.finish();
    this.blobs.end();
    this.ice.end();
    this.crowd.frame = frame + 1;
  }

  /** Before each draw: the name tags in depth order for this camera. */
  prepareRender(camera: THREE.Camera): void {
    this.tags.end(camera);
  }

  setLook(outlines: boolean, effects: boolean): void {
    this.outlines = outlines;
    this.effects = effects;
    this.crowd.outlines = outlines;
    for (const b of this.crowd.batches) if (b.outline) b.outline.visible = outlines && b.count > 0;
    for (const a of this.arenas) {
      a.impl.setOutlines(outlines);
      a.impl.effects = effects;
    }
    for (const b of this.bosses) {
      b.impl.setOutlines(outlines);
      b.impl.setEffects(effects);
    }
  }

  showAllForWarmUp(on: boolean): void {
    this.crowd.showAllForWarmUp(on);
  }

  /** Map units to the scene's metres (for the dev preview). */
  static readonly UNITS = UNITS;

  dispose(): void {
    this.view?.dispose();
    this.view = null;
    for (const b of this.bosses.slice()) b.dispose();
    for (const a of this.arenas.slice()) a.dispose();
    this.crowd.dispose();
    this.tags.dispose();
    this.blobs.dispose();
    this.ice.dispose();
    this.ramp.dispose();
    this.background.dispose();
    this.scene.clear();
    if (this.skeletonGltf) {
      this.skeletonGltf.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.isMesh) {
          mesh.geometry.dispose();
          (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).forEach((m) => m.dispose());
        }
      });
    }
  }
}

export function loadKitImpl(options?: LoadOptions): Promise<Kit> {
  return KitImpl.load(options);
}
