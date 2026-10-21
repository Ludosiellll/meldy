/**
 * The accessories (our own, built from primitives on the style board), each merged into one geometry with its
 * colours per vertex: `kitColor.rgb` the part's colour (linear), `kitColor.a` 1 where the player's colour goes,
 * `kitSpin` 1 on the propeller's blades. Units: metres for a head 0.62 m wide, origin at the top of the head.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { KitHatId } from '../look';

type AccId = Exclude<KitHatId, 'none'>;

/** The player's colour (a placeholder, replaced per instance by the shader). */
const PLAYER = 'player';
type Paint = typeof PLAYER | string;

interface Part {
  geo: THREE.BufferGeometry;
  paint: Paint;
  spin?: boolean;
}

const DARK = '#2a2c3f';
const WHITE = '#ffffff';
const GOLD = '#ffcf3a';

function place(geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0, s?: readonly [number, number, number]): THREE.BufferGeometry {
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(...(s ?? [1, 1, 1])),
  );
  geo.applyMatrix4(m);
  return geo;
}

function hemi(r: number, w = 24, h = 12): THREE.BufferGeometry {
  return new THREE.SphereGeometry(r, w, h, 0, Math.PI * 2, 0, Math.PI / 2);
}

function parts(id: AccId): { list: Part[]; dy: number; tilt?: number; shiftX?: number } {
  const L: Part[] = [];
  const add = (geo: THREE.BufferGeometry, paint: Paint, spin = false) => L.push({ geo, paint, spin });
  switch (id) {
    case 'cap':
      add(place(hemi(0.3), 0, -0.02, 0), PLAYER);
      add(place(new THREE.CylinderGeometry(0.26, 0.26, 0.03, 24, 1, false, -Math.PI / 2, Math.PI), 0, 0, 0.16, 0, 0, 0, [1, 1, 1.25]), PLAYER);
      add(place(new THREE.SphereGeometry(0.04, 8, 6), 0, 0.29, 0), WHITE);
      return { list: L, dy: -0.13 };
    case 'beanie':
      add(place(hemi(0.28), 0, -0.04, 0, 0, 0, 0, [1, 1.1, 1]), PLAYER);
      add(place(new THREE.TorusGeometry(0.27, 0.05, 8, 28), 0, -0.03, 0, Math.PI / 2, 0, 0), WHITE);
      add(place(new THREE.SphereGeometry(0.09, 12, 8), 0, 0.29, 0), WHITE);
      return { list: L, dy: -0.13 };
    case 'phones':
      add(place(new THREE.TorusGeometry(0.3, 0.035, 8, 24, Math.PI), 0, -0.12, 0), DARK);
      add(place(new THREE.CylinderGeometry(0.11, 0.11, 0.09, 18), -0.31, -0.14, 0, 0, 0, Math.PI / 2), PLAYER);
      add(place(new THREE.CylinderGeometry(0.11, 0.11, 0.09, 18), 0.31, -0.14, 0, 0, 0, Math.PI / 2), PLAYER);
      return { list: L, dy: -0.16 };
    case 'flower':
      add(place(new THREE.CylinderGeometry(0.012, 0.012, 0.18, 6), 0, 0.08, 0), '#3bb26b');
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(place(new THREE.SphereGeometry(0.055, 10, 8), Math.sin(a) * 0.08, 0.2, Math.cos(a) * 0.08, 0, 0, 0, [1, 0.5, 1]), WHITE);
      }
      add(place(new THREE.SphereGeometry(0.05, 10, 8), 0, 0.22, 0), GOLD);
      return { list: L, dy: -0.05 };
    case 'antenna':
      add(place(new THREE.CylinderGeometry(0.014, 0.014, 0.28, 6), -0.1, 0.12, 0, 0, 0, 0.25), DARK);
      add(place(new THREE.CylinderGeometry(0.014, 0.014, 0.28, 6), 0.1, 0.12, 0, 0, 0, -0.25), DARK);
      add(place(new THREE.SphereGeometry(0.06, 10, 8), -0.14, 0.27, 0), PLAYER);
      add(place(new THREE.SphereGeometry(0.06, 10, 8), 0.14, 0.27, 0), PLAYER);
      return { list: L, dy: -0.06 };
    case 'bow':
      add(place(new THREE.SphereGeometry(0.12, 12, 8), -0.12, 0.05, 0, 0, 0, 0, [1.2, 0.8, 0.5]), '#ff5fa2');
      add(place(new THREE.SphereGeometry(0.12, 12, 8), 0.12, 0.05, 0, 0, 0, 0, [1.2, 0.8, 0.5]), '#ff5fa2');
      add(place(new THREE.SphereGeometry(0.06, 10, 8), 0, 0.05, 0.02), '#ff8cc0');
      return { list: L, dy: -0.04, tilt: 0.35, shiftX: 0.12 };
    case 'crown':
      add(place(new THREE.CylinderGeometry(0.22, 0.22, 0.14, 24, 1, true), 0, 0.05, 0), GOLD);
      // the inner wall (mirrored, so its faces look inwards)
      add(place(new THREE.CylinderGeometry(0.214, 0.214, 0.14, 24, 1, true), 0, 0.05, 0, 0, 0, 0, [-1, 1, 1]), '#d9a521');
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(place(new THREE.ConeGeometry(0.06, 0.13, 8), Math.sin(a) * 0.2, 0.18, Math.cos(a) * 0.2), GOLD);
      }
      add(place(new THREE.SphereGeometry(0.045, 10, 8), 0, 0.06, 0.225), '#ff3d6e');
      return { list: L, dy: -0.1 };
    case 'grad':
      add(place(new THREE.CylinderGeometry(0.2, 0.22, 0.12, 20), 0, 0.02, 0), DARK);
      add(place(new THREE.BoxGeometry(0.56, 0.035, 0.56), 0, 0.1, 0, 0, Math.PI / 4, 0), DARK);
      add(place(new THREE.SphereGeometry(0.03, 8, 6), 0, 0.13, 0), GOLD);
      add(place(new THREE.CylinderGeometry(0.012, 0.012, 0.2, 6), 0.24, 0.02, 0, 0, 0, 0.1), GOLD);
      add(place(new THREE.SphereGeometry(0.04, 8, 6), 0.25, -0.08, 0), GOLD);
      return { list: L, dy: -0.1 };
    case 'horns':
      for (const sx of [-1, 1]) {
        add(place(new THREE.ConeGeometry(0.075, 0.26, 12), sx * 0.17, 0.1, 0.02, 0, 0, -sx * 0.45), '#fff3df');
        add(place(new THREE.CylinderGeometry(0.085, 0.09, 0.05, 12), sx * 0.14, 0.01, 0.02, 0, 0, -sx * 0.45), '#d94a3d');
      }
      return { list: L, dy: -0.05 };
    case 'party': {
      add(place(new THREE.ConeGeometry(0.18, 0.5, 24), 0, 0.22, 0), PLAYER);
      for (const [y, r] of [[0.05, 0.155], [0.2, 0.1], [0.34, 0.052]] as const) {
        add(place(new THREE.CylinderGeometry(r + 0.006, r + 0.022, 0.05, 24, 1, true), 0, y, 0), WHITE);
      }
      add(place(new THREE.SphereGeometry(0.07, 12, 8), 0, 0.48, 0), GOLD);
      return { list: L, dy: -0.07, tilt: 0.12 };
    }
    case 'propeller':
      add(place(hemi(0.27), 0, -0.04, 0), PLAYER);
      add(place(new THREE.CylinderGeometry(0.015, 0.015, 0.14, 6), 0, 0.27, 0), DARK);
      add(place(new THREE.BoxGeometry(0.42, 0.012, 0.07), 0, 0.34, 0), '#ff4f5a', true);
      add(place(new THREE.BoxGeometry(0.07, 0.012, 0.42), 0, 0.34, 0), '#3d8bff', true);
      return { list: L, dy: -0.13 };
    case 'tophat':
      add(place(new THREE.CylinderGeometry(0.3, 0.3, 0.03, 24), 0, 0, 0), DARK);
      add(place(new THREE.CylinderGeometry(0.18, 0.19, 0.32, 24), 0, 0.17, 0), DARK);
      add(place(new THREE.CylinderGeometry(0.192, 0.192, 0.06, 24), 0, 0.06, 0), PLAYER);
      return { list: L, dy: -0.09 };
  }
}

/** One accessory as a single geometry (position, normal, kitColor, kitSpin), origin at the top of the head. */
export function accessoryGeometry(id: AccId): THREE.BufferGeometry {
  const { list, dy, tilt, shiftX } = parts(id);
  const color = new THREE.Color();
  const geos = list.map(({ geo: g, paint, spin }) => {
    g.deleteAttribute('uv');
    const n = g.attributes.position.count;
    const col = new Float32Array(n * 4);
    const sp = new Float32Array(n);
    if (paint === PLAYER) color.set('#ffffff');
    else color.set(paint);
    for (let i = 0; i < n; i++) {
      col[i * 4] = color.r;
      col[i * 4 + 1] = color.g;
      col[i * 4 + 2] = color.b;
      col[i * 4 + 3] = paint === PLAYER ? 1 : 0;
      sp[i] = spin ? 1 : 0;
    }
    g.setAttribute('kitColor', new THREE.BufferAttribute(col, 4));
    g.setAttribute('kitSpin', new THREE.BufferAttribute(sp, 1));
    return g;
  });
  const indexed = geos.map((g) => (g.index ? g : withIndex(g)));
  const merged = mergeGeometries(indexed, false);
  if (!merged) throw new Error(`accessory ${id} did not merge`);
  indexed.forEach((g) => g.dispose());
  const m = new THREE.Matrix4().makeRotationZ(tilt ?? 0).setPosition(shiftX ?? 0, dy, 0);
  // a spinning blade turns about its own axis: keep it centred on x/z, only lift it
  if (!list.some((p) => p.spin)) merged.applyMatrix4(m);
  else merged.translate(0, dy, 0);
  merged.computeBoundingSphere();
  return merged;
}

function withIndex(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.attributes.position.count;
  const idx = new Uint16Array(n);
  for (let i = 0; i < n; i++) idx[i] = i;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
