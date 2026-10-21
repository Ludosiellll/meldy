/**
 * Name tags: every name drawn once into one canvas atlas, all tags drawn in one call as screen-sized quads (the same
 * size on screen wherever the player stands, readable on a projector). No DOM per frame.
 */
import * as THREE from 'three';
import { FONT, roundRect } from './materials';
import { uploadFirst } from './upload';

const ATLAS_W = 1024;
const ATLAS_H = 1280;
const CELL_W = 340;
const CELL_H = 64;
const COLS = Math.floor(ATLAS_W / CELL_W);
const ROWS = Math.floor(ATLAS_H / CELL_H);
/** Tags the atlas holds (one per player). */
export const TAG_CAPACITY = COLS * ROWS;
/** Height of a tag on a 1080-pixel-high screen. */
const TAG_PX = 34;

const VERT = /* glsl */ `
attribute vec3 tagPos;
attribute vec4 tagCell;
attribute vec2 tagSize;
attribute float tagGhost;
uniform vec2 tagPx;
varying vec2 vUv;
varying float vGhost;
void main() {
  vec4 clip = projectionMatrix * viewMatrix * vec4(tagPos, 1.0);
  vec2 px = vec2(position.x * tagSize.x, (position.y + 0.5) * tagSize.y);
  clip.xy += px * tagPx * clip.w;
  gl_Position = clip;
  vUv = vec2(mix(tagCell.x, tagCell.z, uv.x), mix(tagCell.w, tagCell.y, uv.y));
  vGhost = tagGhost;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D tagAtlas;
varying vec2 vUv;
varying float vGhost;
void main() {
  vec4 c = texture2D(tagAtlas, vUv);
  if (vGhost > 0.5) c = vec4(mix(c.rgb, vec3(0.36, 0.56, 1.0), 0.45), c.a * 0.62);
  if (c.a < 0.01) discard;
  gl_FragColor = c;
  #include <colorspace_fragment>
}
`;

export class Tags {
  readonly mesh: THREE.Mesh;
  private readonly canvas: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D;
  private readonly texture: THREE.CanvasTexture;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly pos: Float32Array;
  private readonly cell: Float32Array;
  private readonly size: Float32Array;
  private readonly ghost: Float32Array;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private readonly free: number[] = [];
  /** Width of the drawn pill per cell, px. */
  private readonly widths = new Float32Array(TAG_CAPACITY);
  private readonly uniforms: { tagAtlas: { value: THREE.Texture }; tagPx: { value: THREE.Vector2 } };
  // per-frame lists, allocated once
  private readonly fCell = new Int32Array(TAG_CAPACITY);
  private readonly fX = new Float32Array(TAG_CAPACITY);
  private readonly fY = new Float32Array(TAG_CAPACITY);
  private readonly fZ = new Float32Array(TAG_CAPACITY);
  private readonly fGhost = new Uint8Array(TAG_CAPACITY);
  private readonly fDepth = new Float32Array(TAG_CAPACITY);
  private readonly order = new Int32Array(TAG_CAPACITY);
  private n = 0;
  private dirty = false;
  scale = 1;
  /** False hides every tag (thumbnails). */
  enabled = true;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.width = ATLAS_W;
    this.canvas.height = ATLAS_H;
    const g = this.canvas.getContext('2d');
    if (!g) throw new Error('no 2d canvas');
    this.g = g;
    for (let i = TAG_CAPACITY - 1; i >= 0; i--) this.free.push(i);
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.flipY = false;
    this.texture.generateMipmaps = false;
    this.texture.minFilter = THREE.LinearFilter;
    this.texture.magFilter = THREE.LinearFilter;
    const quad = new THREE.PlaneGeometry(1, 1);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.attributes.position);
    this.geometry.setAttribute('uv', quad.attributes.uv);
    this.pos = new Float32Array(TAG_CAPACITY * 3);
    this.cell = new Float32Array(TAG_CAPACITY * 4);
    this.size = new Float32Array(TAG_CAPACITY * 2);
    this.ghost = new Float32Array(TAG_CAPACITY);
    this.attrs = [
      new THREE.InstancedBufferAttribute(this.pos, 3),
      new THREE.InstancedBufferAttribute(this.cell, 4),
      new THREE.InstancedBufferAttribute(this.size, 2),
      new THREE.InstancedBufferAttribute(this.ghost, 1),
    ];
    ['tagPos', 'tagCell', 'tagSize', 'tagGhost'].forEach((name, i) => {
      this.attrs[i].setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, this.attrs[i]);
    });
    this.geometry.instanceCount = 0;
    this.uniforms = { tagAtlas: { value: this.texture }, tagPx: { value: new THREE.Vector2(1, 1) } };
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: this.uniforms,
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 20;
    this.mesh.name = 'name tags';
  }

  /** Draws a tag into a free cell; -1 when the atlas is full (the player then has no tag). */
  add(name: string, colourHex: string): number {
    const id = this.free.pop();
    if (id === undefined) return -1;
    const g = this.g;
    const x0 = (id % COLS) * CELL_W;
    const y0 = Math.floor(id / COLS) * CELL_H;
    g.clearRect(x0, y0, CELL_W, CELL_H);
    const text = name.trim() || '…';
    let font = 32;
    g.font = `700 ${font}px ${FONT}`;
    const room = CELL_W - 64;
    let w = g.measureText(text).width;
    if (w > room) {
      font = Math.max(18, Math.floor((font * room) / w));
      g.font = `700 ${font}px ${FONT}`;
      w = Math.min(room, g.measureText(text).width);
    }
    const pill = Math.ceil(w + 58);
    roundRect(g, x0 + 2, y0 + 4, pill - 4, CELL_H - 10, (CELL_H - 10) / 2);
    g.fillStyle = 'rgba(17, 19, 38, 0.84)';
    g.fill();
    g.beginPath();
    g.arc(x0 + 26, y0 + CELL_H / 2 - 1, 10, 0, Math.PI * 2);
    g.fillStyle = colourHex;
    g.fill();
    g.lineWidth = 3;
    g.strokeStyle = 'rgba(255, 255, 255, 0.95)';
    g.stroke();
    g.fillStyle = '#ffffff';
    g.textBaseline = 'middle';
    g.textAlign = 'left';
    g.fillText(text, x0 + 44, y0 + CELL_H / 2, room);
    this.widths[id] = pill;
    this.dirty = true;
    return id;
  }

  remove(id: number): void {
    if (id < 0) return;
    this.free.push(id);
  }

  setViewport(width: number, height: number): void {
    // a tag is TAG_PX tall on a 1080-high screen and scales with the screen
    const k = (height / 1080) * this.scale * (TAG_PX / CELL_H);
    this.uniforms.tagPx.value.set((2 / width) * k, (2 / height) * k);
  }

  begin(): void {
    this.n = 0;
  }

  push(id: number, x: number, y: number, z: number, ghost: boolean): void {
    if (id < 0 || this.n >= TAG_CAPACITY) return;
    const i = this.n++;
    this.fCell[i] = id;
    this.fX[i] = x;
    this.fY[i] = y;
    this.fZ[i] = z;
    this.fGhost[i] = ghost ? 1 : 0;
  }

  /** Sorts far to near (near tags drawn last, on top) and fills the instance buffers. */
  end(camera: THREE.Camera): void {
    const e = camera.matrixWorldInverse.elements;
    const n = this.n;
    for (let i = 0; i < n; i++) {
      this.fDepth[i] = e[2] * this.fX[i] + e[6] * this.fY[i] + e[10] * this.fZ[i] + e[14];
      // insertion sort by view-space z (more negative = farther)
      let j = i;
      while (j > 0 && this.fDepth[this.order[j - 1]] > this.fDepth[i]) {
        this.order[j] = this.order[j - 1];
        j--;
      }
      this.order[j] = i;
    }
    for (let k = 0; k < n; k++) {
      const i = this.order[k];
      const id = this.fCell[i];
      this.pos[k * 3] = this.fX[i];
      this.pos[k * 3 + 1] = this.fY[i];
      this.pos[k * 3 + 2] = this.fZ[i];
      const x0 = (id % COLS) * CELL_W;
      const y0 = Math.floor(id / COLS) * CELL_H;
      const w = this.widths[id];
      this.cell[k * 4] = x0 / ATLAS_W;
      this.cell[k * 4 + 1] = y0 / ATLAS_H;
      this.cell[k * 4 + 2] = (x0 + w) / ATLAS_W;
      this.cell[k * 4 + 3] = (y0 + CELL_H) / ATLAS_H;
      this.size[k * 2] = w;
      this.size[k * 2 + 1] = CELL_H;
      this.ghost[k] = this.fGhost[i];
    }
    this.geometry.instanceCount = n;
    this.mesh.visible = n > 0 && this.enabled;
    for (let i = 0; i < this.attrs.length; i++) uploadFirst(this.attrs[i], n);
    if (this.dirty) {
      this.texture.needsUpdate = true;
      this.dirty = false;
    }
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.texture.dispose();
  }
}
