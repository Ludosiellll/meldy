/**
 * The five KayKit bodies turned into data the crowd shader can draw: one merged geometry per body (skinned parts,
 * the cape and the body's own hat bound rigidly to their bone), the texture with the clothes marked for the player's
 * colour, and the clips baked into one float texture of bone matrices (3 texels per bone per frame).
 */
import * as THREE from 'three';
import type { GLTF } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { BAKE_FPS, bakedRows, POSE_CLIPS, POSES, type BakedClip, type Pose } from '../pose';
import { MODELS, type ModelId } from '../look';

/** Head top of every body after scaling, metres (1 m = 50 map units): the same height for all, so hats line up. */
export const BODY_HEIGHT = 2.2;

/** Texture cells of the clothes in each body's atlas, glTF uv (v down), as on the style board. */
const CLOTHES_CELLS: Record<ModelId, ReadonlyArray<readonly [number, number, number, number]>> = {
  knight: [[0, 0.25, 0.125, 0.5], [0.375, 0, 0.5, 0.25]],
  mage: [[0, 0.25, 0.375, 0.5]],
  barbarian: [[0, 0.25, 0.25, 0.5]],
  rogue: [[0, 0.25, 0.25, 0.5]],
  hooded: [[0, 0.25, 0.25, 0.5]],
};

export interface BodyData {
  model: ModelId;
  geometry: THREE.BufferGeometry;
  texture: THREE.Texture;
  /** Scale from the model's units to metres. */
  scale: number;
  /** Lift (metres, after scaling) that puts the feet on the floor. */
  lift: number;
  /** First row of this body's baked clips in the bone texture. */
  row0: number;
  /** Accessory anchor in bind space: x, y, z and the accessory's scale. */
  place: THREE.Vector4;
  /** Index of the head bone. */
  head: number;
  joints: number;
}

export interface BakedBodies {
  bodies: BodyData[];
  clips: Record<Pose, BakedClip>;
  bones: THREE.DataTexture;
  /** Bones in the rig (texels per row = 3 × bones). */
  joints: number;
}

function firstSkinned(root: THREE.Object3D): THREE.SkinnedMesh {
  let found: THREE.SkinnedMesh | null = null;
  root.traverse((o) => {
    if (!found && (o as THREE.SkinnedMesh).isSkinnedMesh) found = o as THREE.SkinnedMesh;
  });
  if (!found) throw new Error('no skinned mesh in a body');
  return found;
}

/** The clothes cells repainted: each pixel's brightness against its cell's mean (×1/1.5) in red, alpha 0 marks it. */
function clothesTexture(image: CanvasImageSource, cells: ReadonlyArray<readonly number[]>): THREE.Texture {
  const size = 256;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('no 2d canvas');
  g.drawImage(image, 0, 0, size, size);
  const img = g.getImageData(0, 0, size, size);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = 255;
  for (const [u0, v0, u1, v1] of cells) {
    const x0 = Math.round(u0 * size);
    const y0 = Math.round(v0 * size);
    const x1 = Math.round(u1 * size);
    const y1 = Math.round(v1 * size);
    let sum = 0;
    let n = 0;
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * size + x) * 4;
        sum += 0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2];
        n++;
      }
    }
    const mean = Math.max(1, sum / Math.max(1, n));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * size + x) * 4;
        const l = (0.3 * d[i] + 0.59 * d[i + 1] + 0.11 * d[i + 2]) / mean;
        const k = Math.min(1.35, Math.max(0.55, 0.25 + 0.75 * l));
        const v = Math.round((k / 1.5) * 255);
        d[i] = v;
        d[i + 1] = v;
        d[i + 2] = v;
        d[i + 3] = 0;
      }
    }
  }
  const t = new THREE.DataTexture(img.data, size, size, THREE.RGBAFormat);
  t.flipY = false;
  t.colorSpace = THREE.NoColorSpace;
  t.minFilter = THREE.LinearFilter;
  t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

/** Merges a body's parts into one geometry in bind space with kitJoints, kitWeights and kitHat. */
function mergeBody(scene: THREE.Object3D, skinned: THREE.SkinnedMesh): { geometry: THREE.BufferGeometry; headTop: number; headWidth: number; minY: number } {
  scene.updateMatrixWorld(true);
  const bones = skinned.skeleton.bones;
  const boneIndex = new Map<THREE.Object3D, number>();
  bones.forEach((b, i) => boneIndex.set(b, i));
  const pos: number[] = [];
  const nrm: number[] = [];
  const uv: number[] = [];
  const joints: number[] = [];
  const weights: number[] = [];
  const hat: number[] = [];
  const index: number[] = [];
  const v = new THREE.Vector3();
  const n = new THREE.Vector3();
  const m = new THREE.Matrix4();
  const nm = new THREE.Matrix3();
  let headTop = -Infinity;
  let headMinX = Infinity;
  let headMaxX = -Infinity;
  let minY = Infinity;
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    const isSkinned = (mesh as THREE.SkinnedMesh).isSkinnedMesh;
    let rigidBone = -1;
    if (isSkinned) {
      // three draws a skinned vertex at Σ w · bone.matrixWorld · boneInverse · bindMatrix · p
      m.copy((mesh as THREE.SkinnedMesh).bindMatrix);
    } else {
      // A rigid part under bone B is drawn at B.world · (B.world⁻¹ · part.world) · p in the rest pose; with the skin
      // matrix B.world · boneInverse it takes p' = boneInverse⁻¹ · B.world⁻¹ · part.world · p.
      let p: THREE.Object3D | null = mesh.parent;
      while (p && !boneIndex.has(p)) p = p.parent;
      if (!p) return;
      rigidBone = boneIndex.get(p) as number;
      const ibm = skinned.skeleton.boneInverses[rigidBone];
      m.copy(ibm).invert().multiply(p.matrixWorld.clone().invert()).multiply(mesh.matrixWorld);
    }
    nm.getNormalMatrix(m);
    const base = pos.length / 3;
    const P = geo.attributes.position;
    const N = geo.attributes.normal;
    const U = geo.attributes.uv;
    const J = geo.attributes.skinIndex;
    const W = geo.attributes.skinWeight;
    const isHat = /_(Hat|Helmet)$/.test(mesh.name);
    const isHead = /_Head(_Hooded)?$/.test(mesh.name);
    for (let i = 0; i < P.count; i++) {
      v.fromBufferAttribute(P, i).applyMatrix4(m);
      pos.push(v.x, v.y, v.z);
      if (v.y < minY) minY = v.y;
      if (isHead) {
        if (v.y > headTop) headTop = v.y;
        if (v.x < headMinX) headMinX = v.x;
        if (v.x > headMaxX) headMaxX = v.x;
      }
      n.fromBufferAttribute(N, i).applyMatrix3(nm).normalize();
      nrm.push(n.x, n.y, n.z);
      uv.push(U ? U.getX(i) : 0, U ? U.getY(i) : 0);
      if (rigidBone >= 0 || !J || !W) {
        joints.push(Math.max(0, rigidBone), 0, 0, 0);
        weights.push(1, 0, 0, 0);
      } else {
        joints.push(J.getX(i), J.getY(i), J.getZ(i), J.getW(i));
        const w = [W.getX(i), W.getY(i), W.getZ(i), W.getW(i)];
        const s = w[0] + w[1] + w[2] + w[3] || 1;
        weights.push(w[0] / s, w[1] / s, w[2] / s, w[3] / s);
      }
      hat.push(isHat ? 1 : 0);
    }
    if (geo.index) {
      for (let i = 0; i < geo.index.count; i++) index.push(base + geo.index.getX(i));
    } else {
      for (let i = 0; i < P.count; i++) index.push(base + i);
    }
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geometry.setAttribute('kitJoints', new THREE.Float32BufferAttribute(joints, 4));
  geometry.setAttribute('kitWeights', new THREE.Float32BufferAttribute(weights, 4));
  geometry.setAttribute('kitHat', new THREE.Float32BufferAttribute(hat, 1));
  geometry.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(index, 1) : new THREE.Uint16BufferAttribute(index, 1));
  return { geometry, headTop, headWidth: headMaxX - headMinX, minY };
}

/** Bakes every pose clip for one body's skeleton: 3 texels (the top 3 rows of the skin matrix) per bone per frame. */
function bakeClips(
  scene: THREE.Object3D,
  skinned: THREE.SkinnedMesh,
  clips: THREE.AnimationClip[],
  out: Float32Array,
  rowWidth: number,
  row0: number,
  layout: Record<Pose, BakedClip>,
): void {
  const mixer = new THREE.AnimationMixer(scene);
  const bones = skinned.skeleton.bones;
  const inverses = skinned.skeleton.boneInverses;
  const m = new THREE.Matrix4();
  const done = new Set<string>();
  for (const pose of POSES) {
    const name = POSE_CLIPS[pose].clip;
    if (done.has(name)) continue;
    done.add(name);
    const clip = clips.find((c) => c.name === name);
    if (!clip) throw new Error(`no clip ${name}`);
    const action = mixer.clipAction(clip);
    action.play();
    const info = layout[pose];
    for (let k = 0; k < info.rows; k++) {
      action.time = Math.min(k / BAKE_FPS, clip.duration);
      mixer.update(0);
      scene.updateMatrixWorld(true);
      const row = row0 + info.row + k;
      for (let b = 0; b < bones.length; b++) {
        m.multiplyMatrices(bones[b].matrixWorld, inverses[b]);
        const e = m.elements;
        const at = (row * rowWidth + b * 3) * 4;
        out[at] = e[0]; out[at + 1] = e[4]; out[at + 2] = e[8]; out[at + 3] = e[12];
        out[at + 4] = e[1]; out[at + 5] = e[5]; out[at + 6] = e[9]; out[at + 7] = e[13];
        out[at + 8] = e[2]; out[at + 9] = e[6]; out[at + 10] = e[10]; out[at + 11] = e[14];
      }
    }
    action.stop();
    mixer.uncacheAction(clip);
  }
  mixer.uncacheRoot(scene);
}

/** Builds the crowd's data from the loaded body files (in MODELS order) and the shared clips. */
export function buildBodies(bodyGltfs: GLTF[], anims: THREE.AnimationClip[]): BakedBodies {
  // clip layout, the same for every body
  const clips = {} as Record<Pose, BakedClip>;
  const byName = new Map<string, BakedClip>();
  let rows = 0;
  for (const pose of POSES) {
    const name = POSE_CLIPS[pose].clip;
    let info = byName.get(name);
    if (!info) {
      const clip = anims.find((c) => c.name === name);
      if (!clip) throw new Error(`no clip ${name}`);
      info = { row: rows, rows: bakedRows(clip.duration), duration: clip.duration };
      rows += info.rows;
      byName.set(name, info);
    }
    clips[pose] = info;
  }
  const first = firstSkinned(bodyGltfs[0].scene);
  const joints = first.skeleton.bones.length;
  const rowWidth = joints * 3;
  const height = rows * bodyGltfs.length;
  const data = new Float32Array(rowWidth * height * 4);
  const bodies: BodyData[] = bodyGltfs.map((gltf, i) => {
    const scene = gltf.scene;
    const skinned = firstSkinned(scene);
    if (skinned.skeleton.bones.length !== joints) throw new Error('bodies with different rigs');
    const merged = mergeBody(scene, skinned);
    const row0 = rows * i;
    bakeClips(scene, skinned, anims, data, rowWidth, row0, clips);
    const head = skinned.skeleton.bones.findIndex((b) => b.name === 'head');
    if (head < 0) throw new Error('a body without a head bone');
    // the head bone's place in bind space
    const hp = new THREE.Vector3().setFromMatrixPosition(skinned.skeleton.boneInverses[head].clone().invert());
    const height = merged.headTop - merged.minY;
    const scale = BODY_HEIGHT / height;
    // accessories are modelled for a head 0.62 m wide (style board), sitting 6 cm into the top of the head
    const place = new THREE.Vector4(hp.x, merged.headTop - 0.06 / scale, hp.z, merged.headWidth / 0.62);
    const map = (skinned.material as THREE.MeshStandardMaterial).map;
    if (!map || !map.image) throw new Error('a body without its texture');
    const texture = clothesTexture(map.image as CanvasImageSource, CLOTHES_CELLS[MODELS[i]]);
    map.dispose();
    return { model: MODELS[i], geometry: merged.geometry, texture, scale, lift: -merged.minY * scale, row0, place, head, joints };
  });
  const bones = new THREE.DataTexture(data, rowWidth, height, THREE.RGBAFormat, THREE.FloatType);
  bones.minFilter = THREE.NearestFilter;
  bones.magFilter = THREE.NearestFilter;
  bones.generateMipmaps = false;
  bones.needsUpdate = true;
  // the loaded scenes are not drawn: free their GPU-side data
  for (const gltf of bodyGltfs) {
    gltf.scene.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) {
        mesh.geometry.dispose();
        const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
        mats.forEach((mm) => mm.dispose());
      }
    });
  }
  return { bodies, clips, bones, joints };
}
