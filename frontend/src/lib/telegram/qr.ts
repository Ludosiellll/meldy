/**
 * A QR code for a short link, drawn without a library (package T3: the bot's link on a computer, Telegram bot spec
 * §6.3 «Сайт»). ISO/IEC 18004 model 2: byte mode (UTF-8), the four error-correction levels, versions 1–40, and the
 * mask with the lowest penalty of the standard's four rules (or a fixed one). Pure: no DOM, no clock; the card draws
 * `qrPath` as one SVG path, dark modules on a light plate (a camera reads a light-on-dark code badly).
 */

export type QrLevel = 'L' | 'M' | 'Q' | 'H';

export interface QrCode {
  /** 1–40. */
  version: number;
  level: QrLevel;
  /** 0–7. */
  mask: number;
  /** Modules on a side: 17 + 4 × version. */
  size: number;
  /** Row by row, `size × size`; 1 is a dark module. */
  modules: Uint8Array;
}

export interface QrOptions {
  level?: QrLevel;
  /** The smallest version to use (a fixed size for links of one shape). */
  minVersion?: number;
  /** A fixed mask 0–7; by default the one with the lowest penalty. */
  mask?: number;
}

// Error-correction codewords in each block, and the number of blocks, by level and version (ISO/IEC 18004 table 9).
// Index 0 is unused.
const ECC_PER_BLOCK: Record<QrLevel, readonly number[]> = {
  L: [0, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  M: [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  Q: [0, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  H: [0, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
};
const BLOCKS: Record<QrLevel, readonly number[]> = {
  L: [0, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  M: [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  Q: [0, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  H: [0, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
};
/** The level's two bits in the format information (table 12). */
const LEVEL_BITS: Record<QrLevel, number> = { L: 1, M: 0, Q: 3, H: 2 };

// ── GF(256) over x⁸ + x⁴ + x³ + x² + 1, for Reed–Solomon ────────────────────────────────────────────────────────

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i += 1) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i += 1) EXP[i] = EXP[i - 255];
}

function gfMul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

const generators = new Map<number, Uint8Array>();

/** (x − α⁰)(x − α¹)…(x − α^(degree−1)), highest power first; the leading 1 included. */
function generator(degree: number): Uint8Array {
  const known = generators.get(degree);
  if (known) return known;
  let poly = new Uint8Array([1]);
  for (let i = 0; i < degree; i += 1) {
    const next = new Uint8Array(poly.length + 1);
    for (let j = 0; j < poly.length; j += 1) {
      next[j] ^= poly[j];
      next[j + 1] ^= gfMul(poly[j], EXP[i]);
    }
    poly = next;
  }
  generators.set(degree, poly);
  return poly;
}

/** The error-correction codewords of one block: the remainder of data·x^n divided by the generator. */
function remainder(data: Uint8Array, degree: number): Uint8Array {
  const gen = generator(degree);
  const rest = new Uint8Array(degree);
  for (const byte of data) {
    const factor = byte ^ rest[0];
    rest.copyWithin(0, 1);
    rest[degree - 1] = 0;
    for (let k = 0; k < degree; k += 1) rest[k] ^= gfMul(gen[k + 1], factor);
  }
  return rest;
}

// ── Sizes ──────────────────────────────────────────────────────────────────────────────────────────────────

/** Modules left for data and error correction once the function patterns are drawn. */
function rawModules(version: number): number {
  let n = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const aligns = Math.floor(version / 7) + 2;
    n -= (25 * aligns - 10) * aligns - 55;
    if (version >= 7) n -= 36;
  }
  return n;
}

function totalCodewords(version: number): number {
  return Math.floor(rawModules(version) / 8);
}

/** Data codewords of a version at a level. */
export function dataCodewords(version: number, level: QrLevel): number {
  return totalCodewords(version) - ECC_PER_BLOCK[level][version] * BLOCKS[level][version];
}

/** Bits of the character count in byte mode. */
function countBits(version: number): number {
  return version <= 9 ? 8 : 16;
}

/** The most bytes a version holds at a level in byte mode. */
export function byteCapacity(version: number, level: QrLevel): number {
  return Math.floor((dataCodewords(version, level) * 8 - 4 - countBits(version)) / 8);
}

/** Centres of the alignment patterns along one side (empty for version 1). */
export function alignmentCenters(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const last = version * 4 + 10;
  const step = version === 32 ? 26 : Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const centers = [6];
  for (let pos = last; centers.length < count; pos -= step) centers.splice(1, 0, pos);
  return centers;
}

// ── Codewords ──────────────────────────────────────────────────────────────────────────────────────────────

/** Mode, count, the bytes, the terminator and the pad codewords 0xEC 0x11. */
function dataBytes(bytes: Uint8Array, version: number, level: QrLevel): Uint8Array {
  const capacity = dataCodewords(version, level);
  const out = new Uint8Array(capacity);
  let bitLength = 0;
  const push = (value: number, length: number) => {
    for (let i = length - 1; i >= 0; i -= 1) {
      if ((value >>> i) & 1) out[bitLength >>> 3] |= 0x80 >>> (bitLength & 7);
      bitLength += 1;
    }
  };
  push(0b0100, 4);
  push(bytes.length, countBits(version));
  for (const byte of bytes) push(byte, 8);
  push(0, Math.min(4, capacity * 8 - bitLength));
  let used = Math.ceil(bitLength / 8);
  for (let pad = 0xec; used < capacity; pad ^= 0xec ^ 0x11) out[used++] = pad;
  return out;
}

/** The data split into blocks, each with its error correction, interleaved as the symbol reads them. */
function codewords(data: Uint8Array, version: number, level: QrLevel): Uint8Array {
  const blocks = BLOCKS[level][version];
  const eccLength = ECC_PER_BLOCK[level][version];
  const total = totalCodewords(version);
  const shortLength = Math.floor(total / blocks);
  const shortBlocks = blocks - (total % blocks);
  const dataParts: Uint8Array[] = [];
  const eccParts: Uint8Array[] = [];
  let offset = 0;
  for (let b = 0; b < blocks; b += 1) {
    const length = shortLength - eccLength + (b < shortBlocks ? 0 : 1);
    const part = data.subarray(offset, offset + length);
    offset += length;
    dataParts.push(part);
    eccParts.push(remainder(part, eccLength));
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (let i = 0; i <= shortLength - eccLength; i += 1) {
    for (const part of dataParts) if (i < part.length) out[at++] = part[i];
  }
  for (let i = 0; i < eccLength; i += 1) {
    for (const part of eccParts) out[at++] = part[i];
  }
  return out;
}

// ── The symbol ─────────────────────────────────────────────────────────────────────────────────────────────

const MASKS: ReadonlyArray<(x: number, y: number) => boolean> = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

/** The 15 format bits of a level and mask: BCH(15, 5), then the fixed XOR so they are never all light. */
export function formatBits(level: QrLevel, mask: number): number {
  const data = (LEVEL_BITS[level] << 3) | mask;
  let rest = data;
  for (let i = 0; i < 10; i += 1) rest = (rest << 1) ^ ((rest >>> 9) * 0x537);
  return ((data << 10) | (rest & 0x3ff)) ^ 0x5412;
}

/** The 18 version bits (versions 7 and up): BCH(18, 6). */
export function versionBits(version: number): number {
  let rest = version;
  for (let i = 0; i < 12; i += 1) rest = (rest << 1) ^ ((rest >>> 11) * 0x1f25);
  return (version << 12) | (rest & 0xfff);
}

class Matrix {
  readonly version: number;
  readonly size: number;
  readonly dark: Uint8Array;
  /** Function modules: never data, never masked. */
  readonly fixed: Uint8Array;

  constructor(version: number) {
    this.version = version;
    this.size = version * 4 + 17;
    this.dark = new Uint8Array(this.size * this.size);
    this.fixed = new Uint8Array(this.size * this.size);
  }

  set(x: number, y: number, dark: boolean): void {
    const at = y * this.size + x;
    this.dark[at] = dark ? 1 : 0;
    this.fixed[at] = 1;
  }

  drawPatterns(): void {
    const { size } = this;
    for (let i = 0; i < size; i += 1) {
      this.set(6, i, i % 2 === 0);
      this.set(i, 6, i % 2 === 0);
    }
    // Finders with their light separators.
    for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
      for (let dy = -4; dy <= 4; dy += 1) {
        for (let dx = -4; dx <= 4; dx += 1) {
          const x = cx + dx;
          const y = cy + dy;
          if (x < 0 || y < 0 || x >= size || y >= size) continue;
          const ring = Math.max(Math.abs(dx), Math.abs(dy));
          this.set(x, y, ring !== 2 && ring !== 4);
        }
      }
    }
    const centers = alignmentCenters(this.version);
    const last = centers.length - 1;
    centers.forEach((cy, i) => {
      centers.forEach((cx, j) => {
        if ((i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0)) return;
        for (let dy = -2; dy <= 2; dy += 1) {
          for (let dx = -2; dx <= 2; dx += 1) this.set(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      });
    });
    // The format areas are reserved now and written once the mask is chosen.
    this.drawFormat('M', 0);
    if (this.version >= 7) {
      const bits = versionBits(this.version);
      for (let i = 0; i < 18; i += 1) {
        const bit = ((bits >>> i) & 1) === 1;
        const a = size - 11 + (i % 3);
        const b = Math.floor(i / 3);
        this.set(a, b, bit);
        this.set(b, a, bit);
      }
    }
  }

  drawFormat(level: QrLevel, mask: number): void {
    const { size } = this;
    const bits = formatBits(level, mask);
    const bit = (i: number) => ((bits >>> i) & 1) === 1;
    // Around the top-left finder.
    for (let i = 0; i <= 5; i += 1) this.set(8, i, bit(i));
    this.set(8, 7, bit(6));
    this.set(8, 8, bit(7));
    this.set(7, 8, bit(8));
    for (let i = 9; i < 15; i += 1) this.set(14 - i, 8, bit(i));
    // Under the top-right finder and beside the bottom-left one.
    for (let i = 0; i < 8; i += 1) this.set(size - 1 - i, 8, bit(i));
    for (let i = 8; i < 15; i += 1) this.set(8, size - 15 + i, bit(i));
    this.set(8, size - 8, true);
  }

  /** The codewords in the two-column zigzag from the bottom right, around the function modules. */
  drawData(words: Uint8Array): void {
    const { size } = this;
    let i = 0;
    const length = words.length * 8;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      const upward = ((right + 1) & 2) === 0;
      for (let step = 0; step < size; step += 1) {
        const y = upward ? size - 1 - step : step;
        for (let j = 0; j < 2; j += 1) {
          const x = right - j;
          const at = y * size + x;
          if (this.fixed[at]) continue;
          // Remainder bits past the last codeword stay light.
          this.dark[at] = i < length ? (words[i >>> 3] >>> (7 - (i & 7))) & 1 : 0;
          i += 1;
        }
      }
    }
  }

  /** XORs a mask over the data modules: twice is undone. */
  applyMask(mask: number): void {
    const rule = MASKS[mask];
    const { size } = this;
    for (let y = 0; y < size; y += 1) {
      for (let x = 0; x < size; x += 1) {
        const at = y * size + x;
        if (!this.fixed[at] && rule(x, y)) this.dark[at] ^= 1;
      }
    }
  }

  /** The standard's penalty: runs of five or more, 2×2 blocks, finder-like patterns, and the dark share. */
  penalty(): number {
    const { size, dark } = this;
    let score = 0;
    const lines = (vertical: boolean) => {
      for (let a = 0; a < size; a += 1) {
        // The line with four light modules on each side (the quiet zone is light).
        const line = new Uint8Array(size + 8);
        for (let b = 0; b < size; b += 1) line[b + 4] = vertical ? dark[b * size + a] : dark[a * size + b];
        let run = 1;
        for (let b = 1; b < size; b += 1) {
          if (line[b + 4] === line[b + 3]) {
            run += 1;
          } else {
            if (run >= 5) score += 3 + (run - 5);
            run = 1;
          }
        }
        if (run >= 5) score += 3 + (run - 5);
        for (let b = 0; b + 11 <= line.length; b += 1) {
          if (matches(line, b, FINDER_BEFORE) || matches(line, b, FINDER_AFTER)) score += 40;
        }
      }
    };
    lines(false);
    lines(true);
    for (let y = 0; y + 1 < size; y += 1) {
      for (let x = 0; x + 1 < size; x += 1) {
        const v = dark[y * size + x];
        if (v === dark[y * size + x + 1] && v === dark[(y + 1) * size + x] && v === dark[(y + 1) * size + x + 1]) score += 3;
      }
    }
    let darkCount = 0;
    for (const v of dark) darkCount += v;
    score += Math.floor(Math.abs((darkCount * 100) / dark.length - 50) / 5) * 10;
    return score;
  }
}

const FINDER_BEFORE = [0, 0, 0, 0, 1, 0, 1, 1, 1, 0, 1];
const FINDER_AFTER = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0];

function matches(line: Uint8Array, from: number, pattern: readonly number[]): boolean {
  for (let i = 0; i < pattern.length; i += 1) if (line[from + i] !== pattern[i]) return false;
  return true;
}

/** The QR code of a text (UTF-8, byte mode) in the smallest version that holds it. Throws RangeError when none does. */
export function encodeQr(text: string, options: QrOptions = {}): QrCode {
  const level = options.level ?? 'M';
  const bytes = new TextEncoder().encode(text);
  const from = Math.max(1, Math.min(40, Math.trunc(options.minVersion ?? 1)));
  let version = 0;
  for (let v = from; v <= 40; v += 1) {
    if (bytes.length <= byteCapacity(v, level)) {
      version = v;
      break;
    }
  }
  if (version === 0) throw new RangeError('lib/telegram/qr: the text does not fit a QR code');
  if (options.mask !== undefined && !(Number.isInteger(options.mask) && options.mask >= 0 && options.mask <= 7)) {
    throw new RangeError('lib/telegram/qr: a mask is 0–7');
  }

  const symbol = new Matrix(version);
  symbol.drawPatterns();
  symbol.drawData(codewords(dataBytes(bytes, version, level), version, level));

  let mask = options.mask ?? -1;
  if (mask < 0) {
    let best = Infinity;
    for (let m = 0; m < 8; m += 1) {
      symbol.applyMask(m);
      symbol.drawFormat(level, m);
      const score = symbol.penalty();
      if (score < best) {
        best = score;
        mask = m;
      }
      symbol.applyMask(m);
    }
  }
  symbol.applyMask(mask);
  symbol.drawFormat(level, mask);
  return { version, level, mask, size: symbol.size, modules: symbol.dark };
}

/**
 * The dark modules as one SVG path in a box `size + 2 × quiet` wide: a rectangle per run of dark modules in a row.
 * Draw it on a light plate of the same box.
 */
export function qrPath(code: Pick<QrCode, 'size' | 'modules'>, quiet = 4): { d: string; box: number } {
  const { size, modules } = code;
  let d = '';
  for (let y = 0; y < size; y += 1) {
    let x = 0;
    while (x < size) {
      if (!modules[y * size + x]) {
        x += 1;
        continue;
      }
      let end = x + 1;
      while (end < size && modules[y * size + end]) end += 1;
      d += `M${x + quiet} ${y + quiet}h${end - x}v1h-${end - x}z`;
      x = end;
    }
  }
  return { d, box: size + quiet * 2 };
}
