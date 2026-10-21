/**
 * The boss «Дедлайн», as the teacher picks: `skeleton` (KayKit Skeleton Warrior with an alarm clock strapped to its
 * chest and red eyes) or `clock` (our own alarm-clock brute built from primitives). Either is one SkinnedMesh with a
 * few material groups and one outline hull: the clock's moving parts (hands, bells, hammer, legs, arms) are bones.
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { canvasTexture, FONT, hullMaterial, toon, type SharedUniforms } from './materials';
import { UNITS } from './crowd';

import type { BossKind, BossPhase } from '../types';

/** Seconds from setPhase('stomp') to the blow on the floor. */
export const STOMP_IMPACT: Record<BossKind, number> = { skeleton: 0.7, clock: 0.85 };

const RED = '#e2283d';
const GOLD = '#ffcf3a';
const DARK = '#2a2235';

/** A geometry with every attribute the boss mesh needs, bound rigidly to one bone. */
function rigid(geo: THREE.BufferGeometry, bone: number, color: THREE.ColorRepresentation, matrix?: THREE.Matrix4): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  if (matrix) g.applyMatrix4(matrix);
  const n = g.attributes.position.count;
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 2));
  if (!g.attributes.normal) g.computeVertexNormals();
  const c = new THREE.Color(color);
  const col = new Float32Array(n * 3);
  const si = new Uint16Array(n * 4);
  const sw = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    si[i * 4] = bone;
    sw[i * 4] = 1;
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  g.setAttribute('skinWeight', new THREE.BufferAttribute(sw, 4));
  for (const key of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color', 'skinIndex', 'skinWeight'].includes(key)) g.deleteAttribute(key);
  return g;
}

/** A copy of a loaded geometry with plain float attributes (the files store normals and uvs quantized). */
function floatify(src: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  for (const key of ['position', 'normal', 'uv', 'skinIndex', 'skinWeight']) {
    const a = src.getAttribute(key) as THREE.BufferAttribute | THREE.InterleavedBufferAttribute | undefined;
    if (!a) continue;
    const n = a.count;
    const size = a.itemSize;
    const out = key === 'skinIndex' ? new Uint16Array(n * size) : new Float32Array(n * size);
    for (let i = 0; i < n; i++) {
      out[i * size] = a.getX(i);
      if (size > 1) out[i * size + 1] = a.getY(i);
      if (size > 2) out[i * size + 2] = a.getZ(i);
      if (size > 3) out[i * size + 3] = a.getW(i);
    }
    g.setAttribute(key, new THREE.BufferAttribute(out, size));
  }
  if (src.index) g.setIndex(src.index.clone());
  return g;
}

function dialTexture(): THREE.CanvasTexture {
  return canvasTexture(512, 512, (g, w, h) => {
    const cx = w / 2;
    const cy = h / 2;
    const grd = g.createRadialGradient(cx, cy - 60, 40, cx, cy, 250);
    grd.addColorStop(0, '#fffdf5');
    grd.addColorStop(1, '#f1e3c4');
    g.fillStyle = grd;
    g.beginPath();
    g.arc(cx, cy, 250, 0, Math.PI * 2);
    g.fill();
    g.fillStyle = DARK;
    for (let i = 0; i < 60; i++) {
      const a = (i / 60) * Math.PI * 2;
      const big = i % 5 === 0;
      g.save();
      g.translate(cx, cy);
      g.rotate(a);
      g.fillRect(-(big ? 7 : 3), -236, big ? 14 : 6, big ? 38 : 16);
      g.restore();
    }
    g.font = `800 64px ${FONT}`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    ([['12', 0], ['3', 90], ['6', 180], ['9', 270]] as const).forEach(([s, deg]) => {
      const a = (deg / 180) * Math.PI;
      g.fillText(s, cx + Math.sin(a) * 168, cy - Math.cos(a) * 168);
    });
  });
}

interface ClockBones {
  root: THREE.Bone;
  minute: THREE.Bone;
  hour: THREE.Bone;
  bells: THREE.Bone[];
  hammer: THREE.Bone;
}

/**
 * The alarm clock as parts on bones. `parent` gets the clock's root bone at `place` (local to it); returns the parts
 * (in the parent's rest world space) by material: 0 toon colours, 1 the dial.
 */
function buildClock(
  parent: THREE.Object3D,
  place: THREE.Matrix4,
  bones: THREE.Bone[],
  options: { face: boolean },
): { parts: THREE.BufferGeometry[][]; bones: ClockBones } {
  const root = new THREE.Bone();
  root.name = 'clock';
  place.decompose(root.position, root.quaternion, root.scale);
  parent.add(root);
  const mk = (name: string, x: number, y: number, z: number, rz = 0) => {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    b.rotation.z = rz;
    root.add(b);
    return b;
  };
  const minute = mk('minute', 0, 0, 0.38);
  const hour = mk('hour', 0, 0, 0.38);
  const bellL = mk('bell.l', -0.55, 0.92, 0, 0.55);
  const bellR = mk('bell.r', 0.55, 0.92, 0, -0.55);
  const hammer = mk('hammer', 0, 1.0, 0);
  const all = [root, minute, hour, bellL, bellR, hammer];
  const base = bones.length;
  bones.push(...all);
  parent.updateMatrixWorld(true);
  const idx = (b: THREE.Bone) => base + all.indexOf(b);
  const w = (b: THREE.Bone) => b.matrixWorld.clone();
  const toonParts: THREE.BufferGeometry[] = [];
  const dialParts: THREE.BufferGeometry[] = [];
  const add = (geo: THREE.BufferGeometry, bone: THREE.Bone, color: string, local?: THREE.Matrix4) => {
    const m = w(bone);
    if (local) m.multiply(local);
    toonParts.push(rigid(geo, idx(bone), color, m));
  };
  const T = (x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, s?: readonly [number, number, number]) =>
    new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(...(s ?? [1, 1, 1])));
  add(new THREE.CylinderGeometry(1, 1, 0.7, 48), root, RED, T(0, 0, 0, Math.PI / 2));
  add(new THREE.TorusGeometry(0.93, 0.09, 12, 48), root, GOLD, T(0, 0, 0.36));
  dialParts.push(rigid(new THREE.CircleGeometry(0.9, 48), idx(root), '#ffffff', w(root).multiply(T(0, 0, 0.352))));
  add(new THREE.BoxGeometry(0.045, 0.62, 0.03), minute, DARK, T(0, 0.26, 0));
  add(new THREE.BoxGeometry(0.06, 0.42, 0.03), hour, DARK, T(0, 0.16, 0.01));
  add(new THREE.CylinderGeometry(0.07, 0.07, 0.06, 16), root, GOLD, T(0, 0, 0.4, Math.PI / 2));
  for (const bell of [bellL, bellR]) {
    add(new THREE.SphereGeometry(0.42, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2), bell, GOLD, T(0, 0.05, 0));
    add(new THREE.SphereGeometry(0.08, 10, 8), bell, GOLD, T(0, 0.5, 0));
  }
  add(new THREE.CylinderGeometry(0.035, 0.035, 0.42, 8), hammer, DARK, T(0, 0.2, 0));
  add(new THREE.SphereGeometry(0.09, 12, 8), hammer, DARK, T(0, 0.42, 0));
  add(new THREE.TorusGeometry(0.3, 0.06, 8, 20, Math.PI), root, DARK, T(0, 0.98, -0.2));
  if (options.face) {
    // an angry face on the dial: eyes, brows, a mouth with teeth
    for (const sx of [-1, 1]) {
      add(new THREE.SphereGeometry(0.26, 20, 14), root, '#ffffff', T(sx * 0.46, 0.38, 0.4, 0, 0, 0, [1, 0.8, 0.35]));
      add(new THREE.SphereGeometry(0.11, 14, 10), root, '#15151f', T(sx * 0.4, 0.33, 0.49, 0, 0, 0, [1, 1, 0.4]));
      add(new RoundedBoxGeometry(0.55, 0.13, 0.08, 2, 0.05), root, DARK, T(sx * 0.46, 0.68, 0.46, 0, 0, sx * 0.42));
    }
    add(new RoundedBoxGeometry(0.9, 0.3, 0.06, 2, 0.1), root, '#3a0f1a', T(0, -0.52, 0.43));
    for (let i = 0; i < 4; i++) add(new THREE.ConeGeometry(0.07, 0.14, 4), root, '#ffffff', T(-0.3 + i * 0.2, -0.43, 0.48, 0, 0, Math.PI));
  }
  return { parts: [toonParts, dialParts], bones: { root, minute, hour, bells: [bellL, bellR], hammer } };
}

function glowSprite(color: string, size: number): THREE.Sprite {
  const tex = canvasTexture(128, 128, (g) => {
    const r = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    r.addColorStop(0, 'rgba(255,255,255,1)');
    r.addColorStop(0.35, 'rgba(255,255,255,.45)');
    r.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = r;
    g.fillRect(0, 0, 128, 128);
  });
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
  s.scale.setScalar(size);
  return s;
}

function mergeByMaterial(groups: THREE.BufferGeometry[][]): THREE.BufferGeometry {
  const merged = groups.map((list) => {
    const m = list.length ? mergeGeometries(list, false) : null;
    list.forEach((g) => g.dispose());
    return m;
  });
  const present = merged.filter((m): m is THREE.BufferGeometry => !!m);
  const out = mergeGeometries(present, true);
  if (!out) throw new Error('the boss did not merge');
  // groups follow the materials' order; an empty group keeps its index by a zero-length group
  let g = 0;
  out.groups = merged.map((m, i) => {
    if (!m) return { start: 0, count: 0, materialIndex: i };
    const grp = out.groups[g++];
    return { start: grp.start, count: grp.count, materialIndex: i };
  });
  present.forEach((m) => m.dispose());
  return out;
}

const _v = new THREE.Vector3();

export class BossImpl {
  readonly group = new THREE.Group();
  readonly stompImpactS: number;
  phase: BossPhase = 'idle';
  /** 0…1: how hard the stage's red light glows. */
  alarm = 0.25;
  private readonly mesh: THREE.SkinnedMesh;
  private readonly hull: THREE.SkinnedMesh;
  private readonly clock: ClockBones;
  private readonly glow: THREE.Sprite;
  private readonly eyeGlow: THREE.Sprite;
  private readonly disposables: { dispose(): void }[] = [];
  private t = 0;
  private phaseT = 0;
  private facing = 0;
  private target = 0;
  private x = 0;
  private y = 0;
  // skeleton
  private mixer: THREE.AnimationMixer | null = null;
  private actions = new Map<string, THREE.AnimationAction>();
  private current: THREE.AnimationAction | null = null;
  private headBone: THREE.Bone | null = null;
  private rising = false;
  private pending: BossPhase | null = null;
  // clock
  private body: THREE.Bone | null = null;
  private legs: THREE.Bone[] = [];
  private arms: THREE.Bone[] = [];

  constructor(
    readonly kind: BossKind,
    ramp: THREE.Texture,
    shared: SharedUniforms,
    skeletonGltf: GLTF | null,
    readonly height: number,
  ) {
    this.group.name = `boss ${kind}`;
    this.stompImpactS = STOMP_IMPACT[kind];
    const own = <T extends { dispose(): void }>(x: T) => {
      this.disposables.push(x);
      return x;
    };
    const dial = own(dialTexture());
    let geometry: THREE.BufferGeometry;
    let materials: THREE.Material[];
    let skeleton: THREE.Skeleton;
    const holder = new THREE.Group();
    if (kind === 'skeleton') {
      if (!skeletonGltf) throw new Error('the skeleton model is not loaded');
      const scene = skeletonGltf.scene;
      scene.updateMatrixWorld(true);
      let skinned: THREE.SkinnedMesh | null = null;
      scene.traverse((o) => {
        if (!skinned && (o as THREE.SkinnedMesh).isSkinnedMesh) skinned = o as THREE.SkinnedMesh;
      });
      if (!skinned) throw new Error('no skinned mesh in the skeleton');
      const sk = (skinned as THREE.SkinnedMesh).skeleton;
      const bones = [...sk.bones];
      const inverses = sk.boneInverses.map((m) => m.clone());
      const boneIdx = new Map<THREE.Object3D, number>();
      bones.forEach((b, i) => boneIdx.set(b, i));
      const texParts: THREE.BufferGeometry[] = [];
      const glowParts: THREE.BufferGeometry[] = [];
      let map: THREE.Texture | null = null;
      let minY = Infinity;
      let maxY = -Infinity;
      let frontZ = -Infinity;
      scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const src = mesh.material as THREE.MeshStandardMaterial;
        let g = floatify(mesh.geometry);
        if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
          g.applyMatrix4((mesh as THREE.SkinnedMesh).bindMatrix);
          g = g.index ? g.toNonIndexed() : g;
          const col = new Float32Array(g.attributes.position.count * 3).fill(1);
          g.setAttribute('color', new THREE.BufferAttribute(col, 3));
        } else {
          let p: THREE.Object3D | null = mesh.parent;
          while (p && !boneIdx.has(p)) p = p.parent;
          if (!p) return;
          const bi = boneIdx.get(p) as number;
          const m = inverses[bi].clone().invert().multiply(p.matrixWorld.clone().invert()).multiply(mesh.matrixWorld);
          g = rigid(g, bi, '#ffffff', m);
        }
        g.computeBoundingBox();
        const bb = g.boundingBox as THREE.Box3;
        minY = Math.min(minY, bb.min.y);
        maxY = Math.max(maxY, bb.max.y);
        if (/Body/.test(mesh.name)) frontZ = Math.max(frontZ, bb.max.z);
        if (src.name === 'Glow') glowParts.push(g);
        else {
          texParts.push(g);
          if (!map && src.map) map = src.map;
        }
      });
      const scale = height / (maxY - minY);
      // the clock on the chest
      const chest = bones.find((b) => b.name === 'chest') as THREE.Bone;
      this.headBone = bones.find((b) => b.name === 'head') ?? null;
      const cp = new THREE.Vector3().setFromMatrixPosition(chest.matrixWorld);
      const chestInv = chest.matrixWorld.clone().invert();
      const clockWorld = new THREE.Matrix4().compose(
        new THREE.Vector3(0, cp.y + (height * 0.06) / scale, frontZ + 0.05 / scale),
        new THREE.Quaternion(),
        new THREE.Vector3(1, 1, 0.6).multiplyScalar((height * 0.105) / scale),
      );
      const clock = buildClock(chest, chestInv.multiply(clockWorld), bones, { face: false });
      // inverse bind matrices of the new bones: their rest pose
      for (let i = inverses.length; i < bones.length; i++) inverses.push(bones[i].matrixWorld.clone().invert());
      this.clock = clock.bones;
      geometry = mergeByMaterial([texParts, glowParts, clock.parts[0], clock.parts[1]]);
      skeleton = new THREE.Skeleton(bones, inverses);
      materials = [
        own(toon('#ffffff', ramp, { map: map ? own(map as THREE.Texture) : null })),
        own(new THREE.MeshBasicMaterial({ color: '#ff2236' })),
        own(toon('#ffffff', ramp, { vertexColors: true })),
        own(new THREE.MeshBasicMaterial({ map: dial })),
      ];
      scene.scale.setScalar(scale);
      scene.position.y = -minY * scale;
      // keep only the bones: the original meshes are replaced by the merged one
      const drop: THREE.Object3D[] = [];
      scene.traverse((o) => {
        if ((o as THREE.Mesh).isMesh) drop.push(o);
      });
      drop.forEach((o) => {
        const mesh = o as THREE.Mesh;
        mesh.geometry.dispose();
        o.removeFromParent();
      });
      holder.add(scene);
      this.mixer = new THREE.AnimationMixer(scene);
      for (const clip of skeletonGltf.animations) this.actions.set(clip.name, this.mixer.clipAction(clip));
    } else {
      // our own brute: a big alarm clock on legs, with fists
      const bones: THREE.Bone[] = [];
      const body = new THREE.Bone();
      body.name = 'body';
      holder.add(body);
      bones.push(body);
      const toonParts: THREE.BufferGeometry[] = [];
      const clock = buildClock(body, new THREE.Matrix4().compose(new THREE.Vector3(0, 2.75, 0), new THREE.Quaternion(), new THREE.Vector3(1.55, 1.55, 1.55)), bones, { face: true });
      const limb = (name: string, x: number, y: number) => {
        const b = new THREE.Bone();
        b.name = name;
        b.position.set(x, y, 0);
        body.add(b);
        bones.push(b);
        return b;
      };
      const legs = [limb('leg.l', -0.75, 1.35), limb('leg.r', 0.75, 1.35)];
      const arms = [limb('arm.l', -1.45, 2.6), limb('arm.r', 1.45, 2.6)];
      holder.updateMatrixWorld(true);
      legs.forEach((leg) => {
        const m = leg.matrixWorld;
        const bi = bones.indexOf(leg);
        toonParts.push(rigid(new THREE.CylinderGeometry(0.13, 0.13, 1.1, 10), bi, DARK, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.55, 0))));
        toonParts.push(rigid(new RoundedBoxGeometry(0.62, 0.32, 0.85, 3, 0.14), bi, RED, m.clone().multiply(new THREE.Matrix4().makeTranslation(0, -1.15, 0.12))));
      });
      arms.forEach((arm, i) => {
        const sx = i ? 1 : -1;
        const m = arm.matrixWorld;
        const bi = bones.indexOf(arm);
        const rot = new THREE.Matrix4().compose(new THREE.Vector3(sx * 0.4, -0.25, 0), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0, sx * 1.1)), new THREE.Vector3(1, 1, 1));
        toonParts.push(rigid(new THREE.CylinderGeometry(0.1, 0.1, 1.0, 10), bi, DARK, m.clone().multiply(rot)));
        toonParts.push(rigid(new THREE.SphereGeometry(0.3, 16, 12), bi, '#ffffff', m.clone().multiply(new THREE.Matrix4().makeTranslation(sx * 0.85, -0.5, 0.1))));
      });
      this.clock = clock.bones;
      this.body = body;
      this.legs = legs;
      this.arms = arms;
      geometry = mergeByMaterial([[...clock.parts[0], ...toonParts], clock.parts[1]]);
      skeleton = new THREE.Skeleton(bones);
      materials = [own(toon('#ffffff', ramp, { vertexColors: true })), own(new THREE.MeshBasicMaterial({ map: dial }))];
      holder.scale.setScalar(height / 4.6);
    }
    own(geometry);
    this.mesh = new THREE.SkinnedMesh(geometry, materials);
    this.mesh.name = `boss ${kind}`;
    this.mesh.frustumCulled = false;
    this.mesh.bind(skeleton, new THREE.Matrix4());
    this.hull = new THREE.SkinnedMesh(geometry, own(hullMaterial(shared)));
    this.hull.name = `boss ${kind} outline`;
    this.hull.frustumCulled = false;
    this.hull.bind(skeleton, new THREE.Matrix4());
    holder.add(this.mesh, this.hull);
    this.group.add(holder);
    this.glow = glowSprite('#ff2a3a', height * 1.25);
    this.glow.position.set(0, height * 0.55, -1.2);
    this.glow.renderOrder = -1;
    this.eyeGlow = glowSprite('#ff2236', height * 0.42);
    this.eyeGlow.visible = kind === 'skeleton';
    this.group.add(this.glow, this.eyeGlow);
    own(this.glow.material);
    own(this.eyeGlow.material);
    own(this.glow.material.map as THREE.Texture);
    own(this.eyeGlow.material.map as THREE.Texture);
    this.setPhase('idle');
  }

  setPosition(x: number, y: number): void {
    this.x = x;
    this.y = y;
  }

  setFacing(rad: number): void {
    this.target = rad;
  }

  setPhase(phase: BossPhase): void {
    if (this.kind === 'skeleton') {
      if (phase === this.phase && this.current && phase !== 'stomp') return;
      if (this.phase === 'stunned' && phase !== 'stunned') {
        // get back up before anything else
        this.rising = true;
        this.pending = phase;
        this.play('Death_C_Skeletons_Resurrect', false);
        this.phase = phase;
        this.phaseT = 0;
        return;
      }
      this.phase = phase;
      this.phaseT = 0;
      this.rising = false;
      this.play(SKELETON_CLIPS[phase].clip, SKELETON_CLIPS[phase].loop);
    } else {
      this.phase = phase;
      this.phaseT = 0;
    }
  }

  private play(name: string, loop: boolean): void {
    const next = this.actions.get(name);
    if (!next) return;
    next.reset();
    next.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    next.clampWhenFinished = !loop;
    next.enabled = true;
    next.setEffectiveWeight(1);
    next.play();
    if (this.current && this.current !== next) this.current.crossFadeTo(next, 0.2, false);
    this.current = next;
  }

  setEffects(on: boolean): void {
    this.glow.visible = on;
    this.eyeGlow.visible = on && this.kind === 'skeleton';
  }

  setOutlines(on: boolean): void {
    this.hull.visible = on;
  }

  update(dt: number): void {
    const step = dt > 0 ? dt : 0;
    this.t += step;
    this.phaseT += step;
    const t = this.t;
    // place
    let d = this.target - this.facing;
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    this.facing += Math.max(-step * 6, Math.min(step * 6, d));
    this.group.position.set(this.x / UNITS, this.y < 0 ? 0.3 : 0, this.y / UNITS);
    this.group.rotation.y = this.facing;
    // the clock: hands tick, bells ring while it threatens
    const c = this.clock;
    c.minute.rotation.z = -t * 6;
    c.hour.rotation.z = -t * 0.5;
    const ringing = this.phase === 'warn' || this.phase === 'roar';
    const r = Math.sin(t * 70);
    c.bells[0].rotation.x = ringing ? Math.sin(t * 70) * 0.16 : 0;
    c.bells[1].rotation.x = ringing ? Math.sin(t * 70 + 1) * 0.16 : 0;
    c.hammer.rotation.z = ringing ? r * 0.6 : 0;
    // how hot the stage glows
    const pulse = Math.abs(Math.sin(t * 9));
    this.alarm =
      this.phase === 'warn' ? 0.55 + 0.45 * pulse : this.phase === 'stomp' ? 1 : this.phase === 'roar' ? 0.6 + 0.3 * pulse : this.phase === 'stunned' ? 0.05 : this.phase === 'chase' ? 0.5 : 0.25;
    (this.glow.material as THREE.SpriteMaterial).opacity = 0.25 + 0.5 * this.alarm;
    if (this.kind === 'skeleton') this.updateSkeleton(step);
    else this.updateClock();
  }

  private updateSkeleton(step: number): void {
    const mixer = this.mixer as THREE.AnimationMixer;
    if (this.phase === 'stomp' && this.current && !this.current.isRunning() && this.phaseT > 0.3) this.setPhase('idle');
    if (this.rising && this.current && !this.current.isRunning()) {
      this.rising = false;
      const next = this.pending ?? 'idle';
      this.pending = null;
      this.phase = next === 'stunned' ? 'idle' : next;
      this.play(SKELETON_CLIPS[this.phase].clip, SKELETON_CLIPS[this.phase].loop);
    }
    mixer.update(step);
    if (this.headBone) {
      this.group.updateMatrixWorld(true);
      this.headBone.getWorldPosition(_v);
      this.group.worldToLocal(_v);
      this.eyeGlow.position.set(_v.x, _v.y + 0.05, _v.z + 0.55);
      (this.eyeGlow.material as THREE.SpriteMaterial).opacity = this.phase === 'stunned' ? 0.1 : 0.5 + 0.4 * Math.abs(Math.sin(this.t * 5));
    }
  }

  private updateClock(): void {
    const body = this.body as THREE.Bone;
    const t = this.t;
    const k = this.phaseT;
    body.position.set(0, 0, 0);
    body.scale.set(1, 1, 1);
    body.rotation.set(0, 0, 0);
    this.legs.forEach((l) => l.rotation.set(0, 0, 0));
    this.arms.forEach((a, i) => a.rotation.set(0, 0, (i ? -1 : 1) * 0.1 * Math.sin(t * 3)));
    switch (this.phase) {
      case 'idle': {
        const s = Math.sin(t * 3);
        body.position.y = Math.abs(s) * 0.08;
        body.scale.set(1 + 0.02 * s, 1 - 0.02 * s, 1);
        this.legs.forEach((l, i) => (l.rotation.x = (i ? 1 : -1) * 0.12 * s));
        break;
      }
      case 'warn':
      case 'roar': {
        const r = Math.sin(t * 70);
        body.rotation.z = r * 0.025;
        body.scale.set(1.04, 1.04 + 0.02 * r, 1.04);
        this.arms.forEach((a, i) => (a.rotation.z = (i ? -1 : 1) * (this.phase === 'warn' ? 1.5 : 0.9 + 0.1 * r)));
        break;
      }
      case 'stomp': {
        const dur = 1.3;
        const u = Math.min(1, k / dur);
        let y = 0;
        let sq = 0;
        if (u < 0.25) sq = -0.12 * smooth(u / 0.25);
        else if (u < 0.65) {
          const v = (u - 0.25) / 0.4;
          y = Math.sin(v * Math.PI) * 2.4;
          sq = 0.1 * (1 - v);
        } else if (u < 0.8) {
          const v = (u - 0.65) / 0.15;
          sq = -0.25 * Math.sin(v * Math.PI);
        }
        body.position.y = y;
        body.scale.set(1 - sq * 0.6, 1 + sq, 1 - sq * 0.6);
        this.arms.forEach((a, i) => (a.rotation.z = (i ? -1 : 1) * (u < 0.65 ? 1.6 : 0.4)));
        this.legs.forEach((l, i) => (l.rotation.x = u > 0.25 && u < 0.65 ? (i ? 0.5 : -0.5) : 0));
        if (k > dur + 0.3) this.setPhase('idle');
        break;
      }
      case 'stunned': {
        body.rotation.z = 0.22 + 0.06 * Math.sin(t * 2.4);
        body.rotation.x = 0.12 * Math.sin(t * 1.7);
        body.position.y = -0.15;
        this.arms.forEach((a, i) => (a.rotation.z = (i ? -1 : 1) * -0.5));
        this.clock.minute.rotation.z = -t * 20;
        this.clock.hour.rotation.z = t * 14;
        break;
      }
      case 'chase': {
        const s = Math.sin(t * 9);
        body.position.y = Math.abs(s) * 0.18;
        body.rotation.x = 0.12;
        this.legs.forEach((l, i) => (l.rotation.x = (i ? 1 : -1) * 0.6 * s));
        this.arms.forEach((a, i) => (a.rotation.x = (i ? -1 : 1) * 0.5 * s));
        break;
      }
    }
  }

  dispose(): void {
    this.mixer?.stopAllAction();
    for (const d of this.disposables) d.dispose();
    this.group.removeFromParent();
  }
}

const SKELETON_CLIPS: Record<BossPhase, { clip: string; loop: boolean }> = {
  idle: { clip: 'Idle_Combat', loop: true },
  warn: { clip: 'Taunt', loop: true },
  stomp: { clip: '1H_Melee_Attack_Jump_Chop', loop: false },
  roar: { clip: 'Taunt_Longer', loop: true },
  stunned: { clip: 'Death_C_Skeletons', loop: false },
  chase: { clip: 'Running_C', loop: true },
};

function smooth(k: number): number {
  const x = Math.max(0, Math.min(1, k));
  return x * x * (3 - 2 * x);
}
