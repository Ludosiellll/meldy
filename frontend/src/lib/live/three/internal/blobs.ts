/**
 * Soft round shadows under the characters and a ring in each player's colour, all in one draw call (no shadow map).
 */
import * as THREE from 'three';
import { uploadFirst } from './upload';

const VERT = /* glsl */ `
attribute vec4 blobPos;   // x, y (floor height), z, radius (metres)
attribute vec4 blobRing;  // rgb (linear), ring opacity
attribute float blobShade;
varying vec2 vUv;
varying vec4 vRing;
varying float vShade;
#include <common>
#include <fog_pars_vertex>
void main() {
  vec3 p = vec3(blobPos.x + position.x * blobPos.w, blobPos.y, blobPos.z - position.y * blobPos.w);
  vec4 mvPosition = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  vUv = uv * 2.0 - 1.0;
  vRing = blobRing;
  vShade = blobShade;
  #include <fog_vertex>
}
`;

const FRAG = /* glsl */ `
varying vec2 vUv;
varying vec4 vRing;
varying float vShade;
#include <common>
#include <fog_pars_fragment>
void main() {
  float d = length(vUv);
  if (d > 1.0) discard;
  float shade = (1.0 - smoothstep(0.25, 0.95, d)) * 0.42 * vShade;
  float ring = smoothstep(0.6, 0.66, d) * (1.0 - smoothstep(0.8, 0.86, d)) * vRing.a;
  vec3 rgb = vRing.rgb;
  float a = max(shade, ring);
  gl_FragColor = vec4(mix(vec3(0.03, 0.02, 0.08), rgb, ring / max(a, 1e-4)), a);
  #include <colorspace_fragment>
  #include <fog_fragment>
}
`;

export class Blobs {
  readonly mesh: THREE.Mesh;
  private readonly geometry: THREE.InstancedBufferGeometry;
  private readonly pos: Float32Array;
  private readonly ring: Float32Array;
  private readonly shade: Float32Array;
  private readonly attrs: THREE.InstancedBufferAttribute[];
  private n = 0;
  /** False hides every blob (thumbnails). */
  enabled = true;

  constructor(readonly capacity: number) {
    const quad = new THREE.PlaneGeometry(2, 2);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.attributes.position);
    this.geometry.setAttribute('uv', quad.attributes.uv);
    this.pos = new Float32Array(capacity * 4);
    this.ring = new Float32Array(capacity * 4);
    this.shade = new Float32Array(capacity);
    this.attrs = [
      new THREE.InstancedBufferAttribute(this.pos, 4),
      new THREE.InstancedBufferAttribute(this.ring, 4),
      new THREE.InstancedBufferAttribute(this.shade, 1),
    ];
    ['blobPos', 'blobRing', 'blobShade'].forEach((name, i) => {
      this.attrs[i].setUsage(THREE.DynamicDrawUsage);
      this.geometry.setAttribute(name, this.attrs[i]);
    });
    const material = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      uniforms: THREE.UniformsUtils.clone(THREE.UniformsLib.fog),
      transparent: true,
      depthWrite: false,
      fog: true,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.Mesh(this.geometry, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'blob shadows';
  }

  begin(): void {
    this.n = 0;
  }

  /** One blob: centre on the floor (metres), radius, shadow strength 0…1, ring colour (linear) and its opacity. */
  push(x: number, y: number, z: number, r: number, shade: number, cr: number, cg: number, cb: number, ring: number): void {
    if (this.n >= this.capacity) return;
    const i = this.n++;
    this.pos[i * 4] = x;
    this.pos[i * 4 + 1] = y;
    this.pos[i * 4 + 2] = z;
    this.pos[i * 4 + 3] = r;
    this.ring[i * 4] = cr;
    this.ring[i * 4 + 1] = cg;
    this.ring[i * 4 + 2] = cb;
    this.ring[i * 4 + 3] = ring;
    this.shade[i] = shade;
  }

  end(): void {
    this.geometry.instanceCount = this.n;
    this.mesh.visible = this.n > 0 && this.enabled;
    for (let i = 0; i < this.attrs.length; i++) uploadFirst(this.attrs[i], this.n);
  }

  dispose(): void {
    this.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}
