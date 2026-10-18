/**
 * Six ready pictures for a cover or the page's background (spec §47.6 «Оформление»), drawn in SVG: calm paper and
 * fabric, the school's squared and graph paper, a slate board and hills in mist. No upload is needed to choose one:
 * the studio draws the chosen one into a JPEG in the browser and puts it into the exam's folder of quiz-covers like
 * any picture (types/testDoc.ts DOC_IMAGE_RE), so the participant's page needs nothing new to show it.
 *
 * Each picture is the same for the same size (the hills' curves come from a fixed seed), so choosing it twice stores
 * one object (the name is its sha256).
 */

export type PresetId = 'paper' | 'squares' | 'graph' | 'slate' | 'mist' | 'linen';
export type PresetUse = 'cover' | 'background';

export interface Preset {
  id: PresetId;
  title: string;
  /** Dark enough that white text reads on it without a scrim (the slate). */
  dark: boolean;
}

export const PRESETS: readonly Preset[] = [
  { id: 'paper', title: 'Бумага', dark: false },
  { id: 'squares', title: 'Клетка', dark: false },
  { id: 'graph', title: 'Миллиметровка', dark: false },
  { id: 'linen', title: 'Лён', dark: false },
  { id: 'mist', title: 'Холмы в тумане', dark: false },
  { id: 'slate', title: 'Грифельная доска', dark: true },
];

/** The sizes a preset is stored at: a cover is 5 : 2 (as the quiz cover), a background 16 : 10. */
export const PRESET_SIZE: Record<PresetUse, { width: number; height: number }> = {
  cover: { width: 1600, height: 640 },
  background: { width: 1600, height: 1000 },
};

/** A grain of `opacity` in the colour r g b (0..1): fractal noise on the alpha only. */
function grain(id: string, frequency: number, rgb: [number, number, number], opacity: number, octaves = 3): string {
  const [r, g, b] = rgb;
  return (
    `<filter id="${id}" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${frequency}" numOctaves="${octaves}" seed="7" stitchTiles="stitch"/>` +
    `<feColorMatrix type="matrix" values="0 0 0 0 ${r}  0 0 0 0 ${g}  0 0 0 0 ${b}  ${opacity} 0 0 0 0"/></filter>`
  );
}

/** A fixed pseudo-random sequence (mulberry32): the same curves every time. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A ridge across the width: a smooth curve through points around `base` (Catmull-Rom as cubic Béziers), closed below. */
function ridge(width: number, height: number, base: number, swing: number, points: number, random: () => number): string {
  const step = width / (points - 1);
  const ys = Array.from({ length: points }, () => base + (random() - 0.5) * 2 * swing);
  const xy = ys.map((y, at) => [at * step, y] as const);
  let d = `M ${-10} ${height + 10} L ${-10} ${xy[0][1].toFixed(1)} L ${xy[0][0]} ${xy[0][1].toFixed(1)}`;
  for (let at = 0; at < xy.length - 1; at += 1) {
    const p0 = xy[Math.max(0, at - 1)];
    const p1 = xy[at];
    const p2 = xy[at + 1];
    const p3 = xy[Math.min(xy.length - 1, at + 2)];
    const c1 = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2 = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0].toFixed(1)} ${c1[1].toFixed(1)}, ${c2[0].toFixed(1)} ${c2[1].toFixed(1)}, ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return `${d} L ${width + 10} ${xy[xy.length - 1][1].toFixed(1)} L ${width + 10} ${height + 10} Z`;
}

/** Lines every `step` px across and down, as one path. */
function lines(width: number, height: number, step: number, offset = 0): string {
  let d = '';
  for (let x = offset; x <= width; x += step) d += `M${x.toFixed(1)} 0V${height}`;
  for (let y = offset; y <= height; y += step) d += `M0 ${y.toFixed(1)}H${width}`;
  return d;
}

const wrap = (width: number, height: number, body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="xMidYMid slice">${body}</svg>`;

/** The preset as an SVG document of that size (a thumbnail draws it small, the stored picture large). */
export function presetSvg(id: PresetId, width: number, height: number): string {
  // Lines and grain are drawn at the stored picture's scale: a thumbnail is the same picture made smaller.
  const unit = width / 1600;
  switch (id) {
    case 'paper':
      return wrap(
        width,
        height,
        `<defs>${grain('g', 0.75 / unit, [0.35, 0.29, 0.2], 0.22)}${grain('f', 0.012 / unit, [0.55, 0.47, 0.35], 0.12, 2)}</defs>` +
          `<rect width="100%" height="100%" fill="#f3efe6"/><rect width="100%" height="100%" filter="url(#f)"/><rect width="100%" height="100%" filter="url(#g)"/>`,
      );
    case 'squares': {
      const step = 32 * unit;
      return wrap(
        width,
        height,
        `<defs>${grain('g', 0.8 / unit, [0.3, 0.32, 0.38], 0.12)}</defs><rect width="100%" height="100%" fill="#f8f8f3"/>` +
          `<path d="${lines(width, height, step, step / 2)}" stroke="#b9cbe6" stroke-width="${Math.max(0.6, 1.4 * unit)}" fill="none"/>` +
          `<rect width="100%" height="100%" filter="url(#g)"/>`,
      );
    }
    case 'graph': {
      const fine = 10 * unit;
      return wrap(
        width,
        height,
        `<defs>${grain('g', 0.8 / unit, [0.4, 0.3, 0.2], 0.1)}</defs><rect width="100%" height="100%" fill="#f6f2e8"/>` +
          `<path d="${lines(width, height, fine)}" stroke="#e3b48f" stroke-opacity=".55" stroke-width="${Math.max(0.4, 0.9 * unit)}" fill="none"/>` +
          `<path d="${lines(width, height, fine * 5)}" stroke="#d79a6a" stroke-opacity=".7" stroke-width="${Math.max(0.6, 1.3 * unit)}" fill="none"/>` +
          `<path d="${lines(width, height, fine * 10)}" stroke="#c98552" stroke-opacity=".75" stroke-width="${Math.max(0.8, 2 * unit)}" fill="none"/>` +
          `<rect width="100%" height="100%" filter="url(#g)"/>`,
      );
    }
    case 'linen':
      return wrap(
        width,
        height,
        `<defs><filter id="w" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="${0.9 / unit} ${0.035 / unit}" numOctaves="2" seed="3" result="a"/>` +
          `<feTurbulence type="fractalNoise" baseFrequency="${0.035 / unit} ${0.9 / unit}" numOctaves="2" seed="5" result="b"/><feBlend in="a" in2="b" mode="multiply"/>` +
          `<feColorMatrix type="matrix" values="0 0 0 0 0.33  0 0 0 0 0.28  0 0 0 0 0.21  1.6 0 0 0 -0.32"/></filter>${grain('g', 0.7 / unit, [0.3, 0.26, 0.2], 0.12)}</defs>` +
          `<rect width="100%" height="100%" fill="#ddd3bf"/><rect width="100%" height="100%" filter="url(#w)"/><rect width="100%" height="100%" filter="url(#g)"/>`,
      );
    case 'slate':
      return wrap(
        width,
        height,
        `<defs>${grain('g', 0.9 / unit, [0.9, 0.92, 0.9], 0.12)}${grain('s', 0.004 / unit, [0.7, 0.76, 0.74], 0.07, 2)}</defs>` +
          `<rect width="100%" height="100%" fill="#28332f"/><rect width="100%" height="100%" filter="url(#s)"/><rect width="100%" height="100%" filter="url(#g)"/>`,
      );
    case 'mist': {
      const random = seeded(47);
      const layers: Array<[number, number, string]> = [
        [0.42, 0.07, '#b9c4cc'],
        [0.53, 0.08, '#9eacb7'],
        [0.64, 0.07, '#7f8f9c'],
        [0.78, 0.06, '#5f6f7d'],
        [0.9, 0.05, '#46535f'],
      ];
      const hills = layers
        .map(([base, swing, fill], at) => `<path d="${ridge(width, height, base * height, swing * height, 6 + at, random)}" fill="${fill}"/>` + `<rect y="${((base - 0.02) * height).toFixed(1)}" width="100%" height="${(0.16 * height).toFixed(1)}" fill="url(#fog)"/>`)
        .join('');
      return wrap(
        width,
        height,
        `<defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#e6eaec"/><stop offset="1" stop-color="#d5dde2"/></linearGradient>` +
          `<linearGradient id="fog" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef1f2" stop-opacity="0"/><stop offset=".55" stop-color="#eef1f2" stop-opacity=".55"/><stop offset="1" stop-color="#eef1f2" stop-opacity="0"/></linearGradient>` +
          `${grain('g', 0.85 / unit, [0.2, 0.24, 0.28], 0.14)}</defs><rect width="100%" height="100%" fill="url(#sky)"/>${hills}<rect width="100%" height="100%" filter="url(#g)"/>`,
      );
    }
  }
}

/** The preset as an image address for a thumbnail (an <img>: the SVG is ours, it carries no script). */
export function presetDataUrl(id: PresetId, width: number, height: number): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(presetSvg(id, width, height))}`;
}

/** The preset drawn at its stored size as a JPEG (the browser draws the SVG into a canvas). */
export async function presetBlob(id: PresetId, use: PresetUse): Promise<Blob> {
  const { width, height } = PRESET_SIZE[use];
  const image = new Image();
  image.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('preset'));
  });
  image.src = presetDataUrl(id, width, height);
  await loaded;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('no canvas');
  context.drawImage(image, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('preset'))), 'image/jpeg', 0.88));
}
