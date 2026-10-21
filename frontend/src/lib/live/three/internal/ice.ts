/**
 * The battle's freeze drawn in the arena (docs/live/MODE_MIXED.md: a character frozen in the battle carries ice): a
 * faceted block of ice around the character, and the chips of a block that breaks. Every block and chip of the scene
 * is one instance of one InstancedMesh: one draw call, none when nobody is frozen.
 */
import * as THREE from 'three';
import { uploadFirst } from './upload';

/** How the block grows round a character (s) and how it breaks (s); chips fly for CHIP_S. */
export const FORM_S = 0.38;
export const BREAK_S = 0.42;
const CHIP_S = 0.7;
/** Chips a breaking block throws. */
const CHIPS = 6;
/** The block's size over the feet, metres (a character is ~1.9 m tall in the kit). */
const BLOCK_R = 0.78;
const BLOCK_H = 2.25;

/** Scale of a forming block at `k` (0…1 of FORM_S): grows past full and settles (ease out back). */
export function formScale(k: number): number {
  const u = Math.min(1, Math.max(0, k));
  const c1 = 1.9;
  return 0.25 + 0.75 * (1 + (c1 + 1) * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2));
}

/** Scale of a breaking block at `k` (0…1 of BREAK_S): swells for a moment, then shrinks to nothing. */
export function breakScale(k: number): number {
  const u = Math.min(1, Math.max(0, k));
  if (u < 0.25) return 1 + 0.6 * u;
  return 1.15 * (1 - (u - 0.25) / 0.75);
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();

export class Ice {
  readonly mesh: THREE.InstancedMesh;
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.MeshPhongMaterial;
  private n = 0;

  constructor(readonly capacity: number) {
    // a seven-sided block, a little narrower at the top, its base on the floor
    const geo = new THREE.CylinderGeometry(BLOCK_R * 0.86, BLOCK_R, BLOCK_H, 7, 1);
    geo.translate(0, BLOCK_H / 2, 0);
    this.geometry = geo.toNonIndexed();
    this.geometry.computeVertexNormals();
    geo.dispose();
    this.material = new THREE.MeshPhongMaterial({
      color: '#bfe8ff',
      emissive: '#2f6f9a',
      emissiveIntensity: 0.45,
      specular: '#ffffff',
      shininess: 90,
      flatShading: true,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(this.geometry, this.material, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.visible = false;
    // after the solid bodies (seen through the ice), before the ghosts
    this.mesh.renderOrder = 4;
    this.mesh.name = 'ice';
  }

  begin(): void {
    this.n = 0;
  }

  /** A block round the feet at (x, y, z) metres, turned by `yaw`, scaled by `s` (1: full). */
  block(x: number, y: number, z: number, yaw: number, s: number): void {
    if (this.n >= this.capacity || s <= 0.01) return;
    _e.set(0, yaw, 0);
    _q.setFromEuler(_e);
    _p.set(x, y, z);
    _s.set(s, s, s);
    _m.compose(_p, _q, _s);
    _m.toArray(this.mesh.instanceMatrix.array as Float32Array, this.n * 16);
    this.n++;
  }

  /**
   * The chips of a block that broke `t` seconds ago (0…CHIP_S): small blocks thrown out and up, falling, spinning.
   * `seed` keeps each character's chips its own.
   */
  chips(x: number, y: number, z: number, t: number, seed: number): void {
    if (t < 0 || t > CHIP_S) return;
    const fade = 1 - t / CHIP_S;
    for (let i = 0; i < CHIPS; i++) {
      if (this.n >= this.capacity) return;
      const a = ((i + (seed % 7) * 0.37) / CHIPS) * Math.PI * 2;
      const speed = 2.2 + ((i * 13 + seed) % 5) * 0.35;
      const up = 3.2 + ((i * 7 + seed) % 4) * 0.5;
      const h = 0.8 + up * t - 4.9 * t * t;
      _e.set(t * 7 + i, t * 5 + a, 0);
      _q.setFromEuler(_e);
      _p.set(x + Math.cos(a) * speed * t, y + Math.max(0, h), z + Math.sin(a) * speed * t);
      const s = 0.16 * fade;
      _s.set(s, s, s);
      _m.compose(_p, _q, _s);
      _m.toArray(this.mesh.instanceMatrix.array as Float32Array, this.n * 16);
      this.n++;
    }
  }

  end(): void {
    this.mesh.count = this.n;
    this.mesh.visible = this.n > 0;
    if (this.n > 0) uploadFirst(this.mesh.instanceMatrix, this.n);
  }

  /** One block visible, for compiling the shader before a round. */
  showForWarmUp(on: boolean): void {
    if (on) {
      this.begin();
      this.block(0, -50, 0, 0, 1);
      this.end();
    } else {
      this.begin();
      this.end();
    }
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

export const ICE_CHIP_S = CHIP_S;
