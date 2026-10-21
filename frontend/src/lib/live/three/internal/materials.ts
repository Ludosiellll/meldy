/**
 * Materials of the kit: the toon look, the outline hull, the ghost, and the shader code that draws a whole crowd of
 * skinned characters with one draw call per body type (the clips are baked into a texture, see bake.ts).
 */
import * as THREE from 'three';

/** Uniforms every crowd material shares (one object each, so a change reaches every program). */
export interface SharedUniforms {
  kitBones: { value: THREE.Texture | null };
  kitTime: { value: number };
  /** 1 while rendering the thumbnails' mask: clothes white, everything else clear. */
  kitMask: { value: number };
  /** Outline thickness in clip units of the screen's height (2 / height px ≈ 1 px). */
  kitOutline: { value: number };
  kitOutlineColor: { value: THREE.Color };
  kitAspect: { value: number };
  /** Accessory placement per body model: xyz in the body's bind space, w the scale. */
  kitPlace: { value: THREE.Vector4[] };
  kitHead: { value: number };
}

export function sharedUniforms(models: number): SharedUniforms {
  return {
    kitBones: { value: null },
    kitTime: { value: 0 },
    kitMask: { value: 0 },
    kitOutline: { value: 0.0042 },
    kitOutlineColor: { value: new THREE.Color('#15132a') },
    kitAspect: { value: 16 / 9 },
    kitPlace: { value: Array.from({ length: models }, () => new THREE.Vector4(0, 0, 0, 1)) },
    kitHead: { value: 0 },
  };
}

/** A toon ramp: 4 soft steps, so shading reads as illustrated, not banded. */
export function makeRamp(steps: readonly number[]): THREE.DataTexture {
  const data = new Uint8Array(steps.length * 4);
  steps.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  const t = new THREE.DataTexture(data, steps.length, 1, THREE.RGBAFormat);
  t.minFilter = THREE.NearestFilter;
  t.magFilter = THREE.NearestFilter;
  t.generateMipmaps = false;
  t.needsUpdate = true;
  return t;
}

const COLOR_FNS = /* glsl */ `
vec3 kitToLinear(vec3 c) { return mix(pow(c * 0.9478672986 + vec3(0.0521327014), vec3(2.4)), c * 0.0773993808, vec3(lessThanEqual(c, vec3(0.04045)))); }
vec3 kitToSrgb(vec3 c) { return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
`;

const VERT_PARS = /* glsl */ `
uniform highp sampler2D kitBones;
uniform float kitTime;
uniform float kitOutline;
uniform float kitAspect;
attribute vec4 kitAnim;
attribute vec4 kitTint;
varying vec3 vKitTint;
mat4 kitRow(int b, int row) {
  int x = b * 3;
  vec4 r0 = texelFetch(kitBones, ivec2(x, row), 0);
  vec4 r1 = texelFetch(kitBones, ivec2(x + 1, row), 0);
  vec4 r2 = texelFetch(kitBones, ivec2(x + 2, row), 0);
  return mat4(r0.x, r1.x, r2.x, 0.0, r0.y, r1.y, r2.y, 0.0, r0.z, r1.z, r2.z, 0.0, r0.w, r1.w, r2.w, 1.0);
}
mat4 kitAt(int b, float f) {
  int r = int(f);
  float t = f - float(r);
  return kitRow(b, r) * (1.0 - t) + kitRow(b, r + 1) * t;
}
mat4 kitBone(int b) {
  mat4 m = kitAt(b, kitAnim.x);
  if (kitAnim.z > 0.001) m = m * (1.0 - kitAnim.z) + kitAt(b, kitAnim.y) * kitAnim.z;
  return m;
}
`;

const BODY_VERT_PARS = /* glsl */ `
attribute vec4 kitJoints;
attribute vec4 kitWeights;
attribute float kitHat;
`;

const ACC_VERT_PARS = /* glsl */ `
uniform vec4 kitPlace[KIT_MODELS];
uniform int kitHead;
attribute vec4 kitColor;
attribute float kitSpin;
varying vec4 vKitColor;
`;

const BODY_SKIN = /* glsl */ `
vKitTint = kitTint.rgb;
mat4 kitSkin = kitBone(int(kitJoints.x)) * kitWeights.x;
if (kitWeights.y > 0.0) kitSkin += kitBone(int(kitJoints.y)) * kitWeights.y;
if (kitWeights.z > 0.0) kitSkin += kitBone(int(kitJoints.z)) * kitWeights.z;
if (kitWeights.w > 0.0) kitSkin += kitBone(int(kitJoints.w)) * kitWeights.w;
`;

const ACC_SKIN = /* glsl */ `
vKitTint = kitTint.rgb;
vKitColor = kitColor;
mat4 kitSkin = kitBone(kitHead);
`;

const SKIN_NORMAL = /* glsl */ `
objectNormal = normalize((kitSkin * vec4(objectNormal, 0.0)).xyz);
`;

const BODY_SKIN_POS = /* glsl */ `
transformed = (kitSkin * vec4(transformed, 1.0)).xyz;
if (kitHat > 0.5 && kitTint.w > 0.5) transformed = vec3(0.0);
`;

const ACC_SKIN_POS = /* glsl */ `
vec3 kitP = transformed;
if (kitSpin > 0.5) {
  float kitA = kitTime * 17.0;
  float kitC = cos(kitA), kitS = sin(kitA);
  kitP.xz = vec2(kitC * kitP.x - kitS * kitP.z, kitS * kitP.x + kitC * kitP.z);
}
vec4 kitPl = kitPlace[int(kitTint.w + 0.5)];
kitP = kitPl.xyz + kitPl.w * kitP;
transformed = (kitSkin * vec4(kitP, 1.0)).xyz;
`;

/** Pushes the hull's vertices out along the normal, a constant width on screen (as three's OutlineEffect does). */
const OUTLINE_PUSH = /* glsl */ `
{
  #ifdef USE_INSTANCING
  vec4 kitN = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(transformed + objectNormal * 0.05, 1.0);
  #else
  vec4 kitN = projectionMatrix * modelViewMatrix * vec4(transformed + objectNormal * 0.05, 1.0);
  #endif
  vec2 kitDir = kitN.xy / kitN.w - gl_Position.xy / gl_Position.w;
  kitDir.x *= kitAspect;
  float kitLen = length(kitDir);
  if (kitLen > 1e-6) {
    kitDir /= kitLen;
    kitDir.x /= kitAspect;
    gl_Position.xy += kitDir * kitOutline * gl_Position.w;
  }
}
`;

const FRAG_PARS = /* glsl */ `
uniform float kitMask;
uniform vec3 kitOutlineColor;
varying vec3 vKitTint;
`;

const BODY_MAP = /* glsl */ `
float kitClothes = 0.0;
#ifdef USE_MAP
  vec4 kitTex = texture2D(map, vMapUv);
  kitClothes = 1.0 - step(0.5, kitTex.a);
  vec3 kitSrgb = kitClothes > 0.5 ? min(kitToSrgb(vKitTint) * kitTex.r * 1.5, vec3(1.0)) : kitTex.rgb;
  diffuseColor.rgb *= kitToLinear(kitSrgb);
#endif
`;

const ACC_MAP = /* glsl */ `
float kitClothes = step(0.5, vKitColor.a);
diffuseColor.rgb *= mix(vKitColor.rgb, vKitTint, kitClothes);
`;

export type CrowdPart = 'body' | 'acc';
export type CrowdVariant = 'solid' | 'outline' | 'ghost';

/**
 * A material for a crowd batch. `solid` is the toon look (the body's texture or the accessory's colours, the player's
 * colour on the clothes), `outline` the dark hull drawn from the back faces, `ghost` the see-through blue of a player
 * who fell.
 */
export function crowdMaterial(
  part: CrowdPart,
  variant: CrowdVariant,
  shared: SharedUniforms,
  ramp: THREE.Texture,
  map: THREE.Texture | null,
  models: number,
): THREE.MeshToonMaterial {
  let mat: THREE.MeshToonMaterial;
  if (variant === 'ghost') {
    mat = new THREE.MeshToonMaterial({
      color: '#c4e4ff',
      emissive: '#5f9cff',
      emissiveIntensity: 0.5,
      gradientMap: ramp,
      transparent: true,
      opacity: 0.5,
      depthWrite: false,
    });
  } else if (variant === 'outline') {
    mat = new THREE.MeshToonMaterial({ color: '#15132a', side: THREE.BackSide });
  } else {
    mat = new THREE.MeshToonMaterial({ color: '#ffffff', gradientMap: ramp, map: part === 'body' ? map : null });
  }
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.defines = { ...(shader.defines ?? {}), KIT_MODELS: models };
    let v = shader.vertexShader;
    v = v.replace('#include <skinning_pars_vertex>', `#include <skinning_pars_vertex>\n${VERT_PARS}${part === 'body' ? BODY_VERT_PARS : ACC_VERT_PARS}`);
    v = v.replace('#include <skinbase_vertex>', part === 'body' ? BODY_SKIN : ACC_SKIN);
    v = v.replace('#include <skinnormal_vertex>', SKIN_NORMAL);
    v = v.replace('#include <skinning_vertex>', part === 'body' ? BODY_SKIN_POS : ACC_SKIN_POS);
    if (variant === 'outline') v = v.replace('#include <project_vertex>', `#include <project_vertex>\n${OUTLINE_PUSH}`);
    shader.vertexShader = v;
    let f = shader.fragmentShader;
    f = f.replace('#include <common>', `#include <common>\n${FRAG_PARS}${COLOR_FNS}${part === 'acc' ? 'varying vec4 vKitColor;\n' : ''}`);
    if (variant === 'solid') {
      f = f.replace('#include <map_fragment>', part === 'body' ? BODY_MAP : ACC_MAP);
      f = f.replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (kitMask > 0.5) gl_FragColor = vec4(kitClothes);');
    } else if (variant === 'outline') {
      f = f.replace('#include <opaque_fragment>', 'gl_FragColor = vec4(kitOutlineColor, 1.0);');
      f = f.replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (kitMask > 0.5) gl_FragColor = vec4(0.0);');
    }
    shader.fragmentShader = f;
  };
  mat.customProgramCacheKey = () => `meldy-crowd-${part}-${variant}-${models}`;
  return mat;
}

/** A plain outline hull for an ordinary mesh or a SkinnedMesh (the boss, the stage). */
export function hullMaterial(shared: SharedUniforms): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({ color: '#15132a', side: THREE.BackSide });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.kitOutline = shared.kitOutline;
    shader.uniforms.kitAspect = shared.kitAspect;
    shader.uniforms.kitOutlineColor = shared.kitOutlineColor;
    shader.uniforms.kitMask = shared.kitMask;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float kitOutline;\nuniform float kitAspect;')
      .replace('#include <project_vertex>', `#include <project_vertex>\n${OUTLINE_PUSH}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 kitOutlineColor;\nuniform float kitMask;')
      .replace('#include <opaque_fragment>', 'gl_FragColor = vec4(kitOutlineColor, 1.0);')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\nif (kitMask > 0.5) gl_FragColor = vec4(0.0);');
  };
  mat.customProgramCacheKey = () => 'meldy-hull';
  return mat;
}

/** The toon look for the arena and the bosses. */
export function toon(color: THREE.ColorRepresentation, ramp: THREE.Texture, extra: THREE.MeshToonMaterialParameters = {}): THREE.MeshToonMaterial {
  return new THREE.MeshToonMaterial({ color, gradientMap: ramp, ...extra });
}

/** A canvas drawn once into a texture. */
export function canvasTexture(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  if (g) draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** The family the app bundles (@fontsource-variable/onest), with fallbacks. */
export const FONT = '"Onest Variable", Onest, system-ui, sans-serif';
