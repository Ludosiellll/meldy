import { describe, expect, it } from 'vitest';
import { alignmentCenters, byteCapacity, dataCodewords, encodeQr, formatBits, qrPath, versionBits, type QrCode } from './qr';

const rows = (code: QrCode) =>
  Array.from({ length: code.size }, (_, y) => Array.from(code.modules.subarray(y * code.size, (y + 1) * code.size)).join(''));

/**
 * Reference symbols from an independent encoder (segno 1.6.6, with the padding of ISO/IEC 18004 §7.4.10: zero bits only
 * when the stream does not end on a codeword boundary — segno adds a whole zero codeword there). The same check passed
 * for 432 symbols: 54 texts and levels, every mask, versions 1–40; jsQR read them back.
 */
const LINK = 'https://t.me/Meldyteach_bot?start=L0123456789abcdef0123456789abcdef';
const LINK_5M_MASK_2 = [
  '1111111001001101011011001110001111111',
  '1000001001011111000100001011001000001',
  '1011101011100111100111010000101011101',
  '1011101011011010100110101111001011101',
  '1011101010100001101100010000101011101',
  '1000001010101100101000100111101000001',
  '1111111010101010101010101010101111111',
  '0000000010100001000010010011100000000',
  '1011111001100010001011111101101111100',
  '1011110100110011110000010010010001110',
  '0101111001111110000010100011111010011',
  '0101000101111000101001100001101100001',
  '0100111001011000111010100111001111111',
  '0100010110110110010111100110100100010',
  '1110101111101011110001001001101111001',
  '0010100011100101111101101001101110001',
  '0111011111001111100001011100101010100',
  '1100010101011101001011110110010101010',
  '0101101100001001101101101001010100011',
  '1100000000011011001111000011100100001',
  '1000101001101001111110001111011011100',
  '1001110110010110000110110111100001010',
  '0010101111111011001010100001101111001',
  '0100100111001101100000011010111110010',
  '0111101000110111001011101110101010111',
  '1011000000000111100000010000010101000',
  '1000111101010010001010100011110001111',
  '1010010010010010100001111000011100010',
  '1011001101111110111000101111111111101',
  '0000000010101100010111110001100011010',
  '1111111000010001110001000000101010101',
  '1000001011011000011011101011100011000',
  '1011101011000001100001001111111110111',
  '1011101010111001001011110000011011001',
  '1011101011011101111100001010000000111',
  '1000001001000101001111111010101010001',
  '1111111011001101111110101111000011111',
];
const MELDY_1L_MASK_4 = [
  '111111101111101111111',
  '100000101010101000001',
  '101110101000001011101',
  '101110101111001011101',
  '101110100000101011101',
  '100000101101001000001',
  '111111101010101111111',
  '000000000111100000000',
  '110011100101000101111',
  '000100000011100101110',
  '110010110001001110010',
  '111100000000011010010',
  '101110110100111000000',
  '000000001000111001011',
  '111111100010110001010',
  '100000101001100100010',
  '101110101101001110001',
  '101110100111100001111',
  '101110100101001111000',
  '100000101100011010000',
  '111111101010111011001',
];

describe('the encoder against a reference encoder', () => {
  it('draws the bot link as the reference does, module for module', () => {
    const code = encodeQr(LINK, { level: 'M', mask: 2 });
    expect([code.version, code.size, code.level, code.mask]).toEqual([5, 37, 'M', 2]);
    expect(rows(code)).toEqual(LINK_5M_MASK_2);
  });

  it('draws a version 1 symbol at level L as the reference does', () => {
    expect(rows(encodeQr('Meldy', { level: 'L', mask: 4 }))).toEqual(MELDY_1L_MASK_4);
  });

  it('puts the 67 characters of a bot link in version 5 at level M (37 modules a side)', () => {
    const code = encodeQr(LINK);
    expect([code.version, code.size, code.level]).toEqual([5, 37, 'M']);
    expect(code.mask).toBeGreaterThanOrEqual(0);
    expect(code.mask).toBeLessThanOrEqual(7);
    // The same text gives the same symbol.
    expect(rows(encodeQr(LINK))).toEqual(rows(code));
  });
});

describe('the standard’s tables', () => {
  it('has the format strings of ISO/IEC 18004 annex C', () => {
    expect(formatBits('L', 0)).toBe(0x77c4);
    expect(formatBits('M', 0)).toBe(0x5412);
    expect(formatBits('Q', 0)).toBe(0x355f);
    expect(formatBits('H', 0)).toBe(0x1689);
    expect(formatBits('M', 3)).toBe(0x5b4b);
    expect(formatBits('M', 7)).toBe(0x4aa0);
  });

  it('has the version strings of annex D', () => {
    expect(versionBits(7)).toBe(0x07c94);
    expect(versionBits(8)).toBe(0x085bc);
    expect(versionBits(40)).toBe(0x28c69);
  });

  it('holds as many bytes as table 7 says', () => {
    expect(byteCapacity(1, 'L')).toBe(17);
    expect(byteCapacity(1, 'M')).toBe(14);
    expect(byteCapacity(1, 'H')).toBe(7);
    expect(byteCapacity(5, 'M')).toBe(84);
    expect(byteCapacity(10, 'M')).toBe(213);
    expect(byteCapacity(40, 'L')).toBe(2953);
    expect(byteCapacity(40, 'H')).toBe(1273);
    expect(dataCodewords(5, 'M')).toBe(86);
  });

  it('places the alignment patterns of annex E', () => {
    expect(alignmentCenters(1)).toEqual([]);
    expect(alignmentCenters(2)).toEqual([6, 18]);
    expect(alignmentCenters(7)).toEqual([6, 22, 38]);
    expect(alignmentCenters(32)).toEqual([6, 34, 60, 86, 112, 138]);
    expect(alignmentCenters(40)).toEqual([6, 30, 58, 86, 114, 142, 170]);
  });
});

/** Reads the 15 format bits back from both copies (bit 0 first, as the encoder writes them). */
function readFormat(code: QrCode): [number, number] {
  const { size, modules } = code;
  const at = (x: number, y: number) => modules[y * size + x];
  const first: Array<[number, number]> = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8], [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  const second: Array<[number, number]> = [];
  for (let i = 0; i < 8; i += 1) second.push([size - 1 - i, 8]);
  for (let i = 8; i < 15; i += 1) second.push([8, size - 15 + i]);
  const value = (cells: Array<[number, number]>) => cells.reduce((sum, [x, y], i) => sum | (at(x, y) << i), 0);
  return [value(first), value(second)];
}

describe('a symbol reads back', () => {
  it('has its three finders, the timing rows and the dark module', () => {
    const code = encodeQr(LINK);
    const { size, modules } = code;
    const at = (x: number, y: number) => modules[y * size + x];
    for (const [ox, oy] of [[0, 0], [size - 7, 0], [0, size - 7]]) {
      for (let i = 0; i < 7; i += 1) {
        expect(at(ox + i, oy)).toBe(1);
        expect(at(ox + i, oy + 6)).toBe(1);
        expect(at(ox, oy + i)).toBe(1);
        expect(at(ox + 6, oy + i)).toBe(1);
      }
      expect(at(ox + 1, oy + 1)).toBe(0);
      expect(at(ox + 3, oy + 3)).toBe(1);
    }
    for (let i = 8; i < size - 8; i += 1) {
      expect(at(i, 6)).toBe(i % 2 === 0 ? 1 : 0);
      expect(at(6, i)).toBe(i % 2 === 0 ? 1 : 0);
    }
    expect(at(8, size - 8)).toBe(1);
  });

  it('writes its level and mask in both copies of the format information', () => {
    for (const level of ['L', 'M', 'Q', 'H'] as const) {
      const code = encodeQr('Осенняя сессия · 3 ноября', { level });
      expect(readFormat(code)).toEqual([formatBits(level, code.mask), formatBits(level, code.mask)]);
    }
  });

  it('writes the version information from version 7 on', () => {
    const code = encodeQr('x'.repeat(130), { level: 'M' });
    expect(code.version).toBeGreaterThanOrEqual(7);
    const { size, modules } = code;
    let below = 0;
    let beside = 0;
    for (let i = 0; i < 18; i += 1) {
      const a = size - 11 + (i % 3);
      const b = Math.floor(i / 3);
      below |= modules[a * size + b] << i;
      beside |= modules[b * size + a] << i;
    }
    expect(below).toBe(versionBits(code.version));
    expect(beside).toBe(versionBits(code.version));
  });

  it('picks the smallest version that holds the text', () => {
    expect(encodeQr('x'.repeat(14), { level: 'M' }).version).toBe(1);
    expect(encodeQr('x'.repeat(15), { level: 'M' }).version).toBe(2);
    expect(encodeQr('x'.repeat(84), { level: 'M' }).version).toBe(5);
    expect(encodeQr('x'.repeat(85), { level: 'M' }).version).toBe(6);
    expect(encodeQr('x', { level: 'M', minVersion: 5 }).version).toBe(5);
    // Cyrillic letters are two bytes each in UTF-8.
    expect(encodeQr('я'.repeat(7), { level: 'M' }).version).toBe(1);
    expect(encodeQr('я'.repeat(8), { level: 'M' }).version).toBe(2);
  });

  it('refuses what does not fit and a mask outside 0–7', () => {
    expect(() => encodeQr('x'.repeat(2954), { level: 'L' })).toThrow(RangeError);
    expect(() => encodeQr('x', { mask: 8 })).toThrow(RangeError);
    expect(() => encodeQr('x', { mask: 1.5 })).toThrow(RangeError);
  });
});

describe('the SVG path', () => {
  it('draws every dark module once, inside a quiet zone of four', () => {
    const code = encodeQr(LINK);
    const { d, box } = qrPath(code);
    expect(box).toBe(45);
    let area = 0;
    for (const match of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)) {
      const [x, y, w, back] = match.slice(1).map(Number);
      expect(back).toBe(w);
      expect(x).toBeGreaterThanOrEqual(4);
      expect(y).toBeGreaterThanOrEqual(4);
      expect(x + w).toBeLessThanOrEqual(box - 4);
      for (let i = 0; i < w; i += 1) expect(code.modules[(y - 4) * code.size + (x - 4 + i)]).toBe(1);
      area += w;
    }
    expect(area).toBe(code.modules.reduce((sum, v) => sum + v, 0));
    expect(d.replace(/M\d+ \d+h\d+v1h-\d+z/g, '')).toBe('');
  });

  it('takes another quiet zone', () => {
    expect(qrPath(encodeQr('Meldy', { level: 'L' }), 2).box).toBe(25);
  });
});
