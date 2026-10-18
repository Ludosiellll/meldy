import { describe, expect, it } from 'vitest';
import { qrCode, shortLink } from './qr';

/** The 7 × 7 finder pattern: a dark ring, a light ring, a dark 3 × 3 core. */
function finderAt(dark: boolean[][], top: number, left: number): boolean {
  for (let r = 0; r < 7; r += 1) {
    for (let c = 0; c < 7; c += 1) {
      const ring = r === 0 || r === 6 || c === 0 || c === 6;
      const core = r >= 2 && r <= 4 && c >= 2 && c <= 4;
      if (dark[top + r][left + c] !== (ring || core)) return false;
    }
  }
  return true;
}

describe('qrCode (made on the device, qrcode-generator 1.4.4)', () => {
  const url = 'https://meldy.ru/k/k7m2p9q4r8st';
  const code = qrCode(url);

  it('a square of a QR version (21 + 4n modules), the three finder patterns in their corners', () => {
    expect((code.size - 21) % 4).toBe(0);
    expect(code.size).toBeGreaterThanOrEqual(25);
    expect(code.dark).toHaveLength(code.size);
    expect(finderAt(code.dark, 0, 0)).toBe(true);
    expect(finderAt(code.dark, 0, code.size - 7)).toBe(true);
    expect(finderAt(code.dark, code.size - 7, 0)).toBe(true);
    expect(finderAt(code.dark, code.size - 7, code.size - 7)).toBe(false);
    // The timing pattern between the finders alternates.
    for (let c = 8; c < code.size - 8; c += 1) expect(code.dark[6][c]).toBe(c % 2 === 0);
  });

  it('the path draws exactly the dark modules, a rectangle a run', () => {
    const drawn = new Set<string>();
    for (const [, x, y, w] of code.path.matchAll(/M(\d+) (\d+)h(\d+)v1h-\3z/g)) {
      for (let i = 0; i < Number(w); i += 1) drawn.add(`${y}:${Number(x) + i}`);
    }
    const dark = new Set<string>();
    code.dark.forEach((row, r) => row.forEach((on, c) => on && dark.add(`${r}:${c}`)));
    expect(drawn).toEqual(dark);
  });

  it('the same link, the same code; another link, another one', () => {
    expect(qrCode(url).path).toBe(code.path);
    expect(qrCode(`${url}x`).path).not.toBe(code.path);
  });

  it('the short link is the address without its scheme', () => {
    expect(shortLink(url)).toBe('meldy.ru/k/k7m2p9q4r8st');
    expect(shortLink('http://localhost:5173/k/abc/')).toBe('localhost:5173/k/abc');
  });
});
