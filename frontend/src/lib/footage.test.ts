import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import nginxConf from '../../../nginx.conf?raw';
import {
  ALL_FOOTAGE,
  LANDING_EXAM_PHONE,
  LANDING_EXAM_WIDE,
  LANDING_LECTURE_PHONE,
  LANDING_LECTURE_WIDE,
  LANDING_ORAL,
  STAND_RUN,
  STAND_RUN_PHONE,
  canPlayFootage,
  loadFootage,
  type Footage,
} from './footage';

/* Real footage in parts (lib/footage.ts): the files on disk, and the loader that joins them into one video. */

interface NodeFs {
  readdirSync(path: string): string[];
  readFileSync(path: string): Uint8Array;
}
interface NodeCrypto {
  createHash(name: string): { update(data: Uint8Array): { digest(encoding: 'hex'): string } };
}
// Specifiers TypeScript does not resolve: the project has no Node types, and the test only runs in Node.
const NODE_FS: string = 'node:fs';
const NODE_CRYPTO: string = 'node:crypto';
const HERE = decodeURIComponent(import.meta.url.replace(/^file:\/\//, ''));
const PUBLIC = `${HERE.slice(0, HERE.lastIndexOf('/src/'))}/public`;

let made = 0;
/** A footage of its own per test: the loader keeps one load per footage for the page's life. */
function footage(count = 3): Footage {
  made += 1;
  return {
    parts: Array.from({ length: count }, (_, at) => `/game/footage/t${made}-0123456789-${at + 1}.bin`),
    poster: `/game/footage/t${made}-0123456789-poster.webp`,
    width: 800,
    height: 450,
    duration: 10.8,
    type: 'video/mp4; codecs="avc1.640028"',
    backdrop: '#2a2356',
  };
}

const ok = (text: string) => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/octet-stream' }), blob: async () => new Blob([text]) });
const failing = (status = 503) => ({ ok: false, status, headers: new Headers({ 'content-type': 'text/plain' }), blob: async () => new Blob(['']) });
const page = () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'text/html; charset=utf-8' }), blob: async () => new Blob(['<!doctype html>']) });

let blobs: Blob[];
const ownCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
beforeEach(() => {
  blobs = [];
  Object.defineProperty(URL, 'createObjectURL', {
    configurable: true,
    writable: true,
    value: (blob: Blob) => {
      blobs.push(blob);
      return `blob:footage-${blobs.length}`;
    },
  });
});
afterEach(() => {
  if (ownCreate) Object.defineProperty(URL, 'createObjectURL', ownCreate);
  else delete (URL as { createObjectURL?: unknown }).createObjectURL;
  vi.unstubAllGlobals();
});

describe('STAND_RUN, the class running to the answers on the projector', () => {
  it('is five parts and a poster under /game/footage/, every name with the video’s hash', () => {
    expect(STAND_RUN.parts).toEqual([1, 2, 3, 4, 5].map((n) => `/game/footage/stand-run-46f8c5a7ae-${n}.bin`));
    expect(STAND_RUN.poster).toBe('/game/footage/stand-run-46f8c5a7ae-poster.webp');
    expect(STAND_RUN).toMatchObject({ width: 800, height: 450, duration: 10.8, type: 'video/mp4; codecs="avc1.640028"' });
    // nginx keeps exactly these names for a year, and answers a missing one with 404, not the app's page.
    const location = /location ~ "(\^\/game\/[^"]+)" \{([^}]*)\}/.exec(nginxConf);
    expect(location).not.toBeNull();
    expect(location![2]).toContain('try_files $uri =404;');
    expect(location![2]).toContain('add_header Cache-Control "public, max-age=31536000, immutable";');
    const served = new RegExp(location![1]);
    for (const name of [...STAND_RUN.parts, STAND_RUN.poster]) expect(name).toMatch(served);
    for (const other of ['/game/footage/stand-run-46f8c5a7ae.mp4', '/game/footage/stand-run-1.bin', '/game/footage/x/stand-run-46f8c5a7ae-1.bin']) {
      expect(other).not.toMatch(served);
    }
  });

  it('is on disk: joined, the parts are the video the hash names, each under the Space’s 100 KB', async () => {
    const fs = (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
    const files = fs.readdirSync(`${PUBLIC}/game/footage`).sort();
    // Only the cuts in use are shipped: the game's two and the landing's five.
    const used = new Set(ALL_FOOTAGE.flatMap((cut) => [...cut.parts, cut.poster]).map((name) => name.split('/').pop()));
    expect(files).toEqual([...used].sort());
    await expectOnDisk(STAND_RUN, '46f8c5a7ae');
  });
});

/** The cut's parts on disk: each under the Space's 100 KB, joined the faststart MP4 its names' hash names. */
async function expectOnDisk(cut: Footage, hash: string) {
  const fs = (await import(/* @vite-ignore */ NODE_FS)) as NodeFs;
  const crypto = (await import(/* @vite-ignore */ NODE_CRYPTO)) as NodeCrypto;
  const parts = cut.parts.map((name) => fs.readFileSync(`${PUBLIC}${name}`));
  for (const part of parts) expect(part.length).toBeLessThanOrEqual(100 * 1024);
  const whole = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  parts.reduce((at, part) => {
    whole.set(part, at);
    return at + part.length;
  }, 0);
  expect(crypto.createHash('sha256').update(whole).digest('hex').slice(0, 10)).toBe(hash);
  // An MP4 whose index comes first (faststart): it can play as soon as it is whole.
  expect(new TextDecoder().decode(whole.slice(4, 8))).toBe('ftyp');
  expect(new TextDecoder().decode(whole.slice(0, 4096))).toContain('moov');
  expect(fs.readFileSync(`${PUBLIC}${cut.poster}`).length).toBeLessThanOrEqual(100 * 1024);
  return whole.length;
}

describe('STAND_RUN_PHONE, the same game on a student’s phone', () => {
  it('is four parts and a poster under /game/footage/ that nginx serves as the projector’s', () => {
    expect(STAND_RUN_PHONE.parts).toEqual([1, 2, 3, 4].map((n) => `/game/footage/stand-run-phone-1897562cbf-${n}.bin`));
    expect(STAND_RUN_PHONE.poster).toBe('/game/footage/stand-run-phone-1897562cbf-poster.webp');
    const served = new RegExp(/location ~ "(\^\/game\/[^"]+)" \{/.exec(nginxConf)![1]);
    for (const name of [...STAND_RUN_PHONE.parts, STAND_RUN_PHONE.poster]) expect(name).toMatch(served);
  });

  it('is the projector’s cut frame for frame: the same length, the same codecs, a portrait phone screen', () => {
    expect(STAND_RUN_PHONE.duration).toBe(STAND_RUN.duration);
    expect(STAND_RUN_PHONE.type).toBe(STAND_RUN.type);
    expect(STAND_RUN_PHONE).toMatchObject({ width: 360, height: 780 });
    // The phone page is 390 × 844: the frame keeps its proportions.
    expect(STAND_RUN_PHONE.width / STAND_RUN_PHONE.height).toBeCloseTo(390 / 844, 2);
  });

  it('is on disk: joined, the parts are the video the hash names, each under the Space’s 100 KB', async () => {
    expect(await expectOnDisk(STAND_RUN_PHONE, '1897562cbf')).toBeLessThan(400 * 1024);
  });
});

describe('the landing’s tiles (layout «D — Плитки», owner 22.10)', () => {
  const NAMED: Array<[string, Footage]> = [
    ['landing-oral', LANDING_ORAL],
    ['landing-lecture-wide', LANDING_LECTURE_WIDE],
    ['landing-lecture-phone', LANDING_LECTURE_PHONE],
    ['landing-exam-wide', LANDING_EXAM_WIDE],
    ['landing-exam-phone', LANDING_EXAM_PHONE],
  ];
  const hashOf = (cut: Footage) => /-([0-9a-f]{10})-poster\.webp$/.exec(cut.poster)![1];

  it('are served by nginx as the game’s footage, every name with its video’s hash', () => {
    const served = new RegExp(/location ~ "(\^\/game\/[^"]+)" \{/.exec(nginxConf)![1]);
    for (const [name, cut] of NAMED) {
      const hash = hashOf(cut);
      expect(cut.parts).toEqual(cut.parts.map((_, at) => `/game/footage/${name}-${hash}-${at + 1}.bin`));
      expect(cut.poster).toBe(`/game/footage/${name}-${hash}-poster.webp`);
      for (const file of [...cut.parts, cut.poster]) expect(file).toMatch(served);
      expect(cut.type).toMatch(/^video\/mp4; codecs="avc1\.[0-9a-f]{6}"$/);
      expect(cut.duration).toBeGreaterThan(0);
    }
  });

  it('are on disk: joined, the parts are the video the hash names, each under the Space’s 100 KB', async () => {
    const size = new Map<Footage, number>();
    for (const [, cut] of NAMED) size.set(cut, await expectOnDisk(cut, hashOf(cut)));
    const sum = (cuts: Footage[]) => cuts.reduce((total, cut) => total + size.get(cut)!, 0);
    // The five cuts are 2 434 277 bytes; a visitor fetches three of them, near the window and after the page's load.
    expect(sum(NAMED.map(([, cut]) => cut))).toBeLessThan(2.4 * 1024 * 1024);
    expect(sum([LANDING_ORAL, LANDING_LECTURE_WIDE, LANDING_EXAM_WIDE])).toBeLessThan(1.55 * 1024 * 1024);
    expect(sum([LANDING_ORAL, LANDING_LECTURE_PHONE, LANDING_EXAM_PHONE])).toBeLessThan(1.3 * 1024 * 1024);
  });

  it('give a phone its own 4:5 cut and a computer a wide one; the oral answer is a phone’s screen', () => {
    for (const [phone, wide] of [
      [LANDING_LECTURE_PHONE, LANDING_LECTURE_WIDE],
      [LANDING_EXAM_PHONE, LANDING_EXAM_WIDE],
    ]) {
      expect(phone).not.toBe(wide);
      expect(phone.width / phone.height).toBeCloseTo(4 / 5, 3);
      expect(wide.width / wide.height).toBeGreaterThan(1.5);
    }
    expect(LANDING_ORAL.height / LANDING_ORAL.width).toBeGreaterThan(2);
  });
});

describe('loadFootage', () => {
  it('fetches the parts and joins them in their order into one video/mp4 Blob behind an object URL', async () => {
    const clip = footage(3);
    const fetchMock = vi.fn(async (url: string) => ok(`[${url.split('-').pop()}]`));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadFootage(clip)).resolves.toBe('blob:footage-1');
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(clip.parts);
    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe('video/mp4');
    expect(await blobs[0].text()).toBe('[1.bin][2.bin][3.bin]');
  });

  it('fetches once per page life: every player of the same footage gets the same URL', async () => {
    const clip = footage(2);
    const fetchMock = vi.fn(async () => ok('x'));
    vi.stubGlobal('fetch', fetchMock);
    const [a, b] = await Promise.all([loadFootage(clip), loadFootage(clip)]);
    const c = await loadFootage({ ...clip });
    expect(new Set([a, b, c]).size).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('asks for a failed part once more', async () => {
    const clip = footage(2);
    let second = 0;
    const fetchMock = vi.fn(async (url: string) => {
      if (url.endsWith('-2.bin') && second++ === 0) throw new TypeError('Failed to fetch');
      return ok(url.endsWith('-1.bin') ? 'a' : 'b');
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadFootage(clip)).resolves.toMatch(/^blob:/);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(await blobs[0].text()).toBe('ab');
  });

  it('fails when a part fails twice, or comes back as the app’s page; the next call tries again', async () => {
    const clip = footage(2);
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('-2.bin') ? failing() : ok('a'))));
    await expect(loadFootage(clip)).rejects.toThrow(/HTTP 503/);
    expect(blobs).toHaveLength(0);

    // A missing file is answered with index.html (200, text/html): not a part of a video.
    vi.stubGlobal('fetch', vi.fn(async (url: string) => (url.endsWith('-2.bin') ? page() : ok('a'))));
    await expect(loadFootage(clip)).rejects.toThrow(/text\/html/);

    const fetchMock = vi.fn(async () => ok('z'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadFootage(clip)).resolves.toMatch(/^blob:/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe('canPlayFootage', () => {
  it('asks the browser about the footage’s own type and codecs', () => {
    const ask = vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('');
    expect(canPlayFootage(STAND_RUN)).toBe(false);
    expect(ask).toHaveBeenCalledWith('video/mp4; codecs="avc1.640028"');
    ask.mockReturnValue('probably');
    expect(canPlayFootage(STAND_RUN)).toBe(true);
  });
});
