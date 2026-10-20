import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
/** The client's routed fetch (lib/supabase supabaseFetch): each test makes a fresh one over a fake network. */
const net = vi.hoisted(() => ({ fetch: null as FetchLike | null }));
vi.mock('../lib/supabase', () => ({
  supabase: { storage: { from: vi.fn() } },
  supabaseUrl: 'https://ref.supabase.co',
  supabaseAnonKey: 'anon-key',
  supabaseFetch: (input: RequestInfo | URL, init?: RequestInit) => net.fetch!(input, init),
}));

import {
  COVER_BUCKET,
  guestPictureUrl,
  isHeic,
  MAX_PICTURE_BYTES,
  MAX_PICTURE_SIDE,
  PICTURE_BUCKET,
  pictureFromFile,
  picturePath,
  pictureUrl,
  removeContainerPictures,
  uploadPicture,
} from './itemPictures';
import { supabase } from '../lib/supabase';
import { createSupabaseFetch } from '../lib/supabaseRoute';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1]);
const MB = 1024 * 1024;

/** A file of `size` bytes (its content does not matter: the browser's drawing is mocked). */
const fileOf = (size: number, type: string, name = 'photo') => new File([new Uint8Array(size)], name, { type });

// ── the browser's drawing, mocked: createImageBitmap, a 2D canvas and toBlob ──

interface Drawn {
  width: number;
  height: number;
  /** The canvas was filled with white before the picture (no transparency kept). */
  white: boolean;
  /** toBlob's calls: [type, quality]. */
  asked: Array<[string, number | undefined]>;
}

interface Browser {
  /** The picture as createImageBitmap gives it; null — it cannot draw it (throws). */
  bitmap: { width: number; height: number } | null;
  /** Some pixel of it is not opaque. */
  alpha?: boolean;
  /** Bytes the canvas writes for a type at a size (a WebP the browser cannot write comes back as PNG). */
  bytes: (type: string, width: number, height: number) => number;
  webp?: boolean;
  /** createImageBitmap refuses the options (an older browser): asked again without them. */
  noOptions?: boolean;
}

let canvases: Drawn[] = [];
let decodeCalls: unknown[][] = [];

function browser(setup: Browser) {
  canvases = [];
  decodeCalls = [];
  const close = vi.fn();
  vi.stubGlobal('createImageBitmap', async (...args: unknown[]) => {
    decodeCalls.push(args);
    if (!setup.bitmap) throw new DOMException('The source image could not be decoded.', 'InvalidStateError');
    if (setup.noOptions && args.length > 1) throw new TypeError("The provided value 'from-image' is not a valid enum value");
    return { ...setup.bitmap, close };
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(function (this: HTMLCanvasElement) {
    const drawn: Drawn = { width: this.width, height: this.height, white: false, asked: [] };
    canvases.push(drawn);
    (this as unknown as { drawn: Drawn }).drawn = drawn;
    return {
      fillStyle: '',
      fillRect: () => {
        drawn.white = true;
      },
      drawImage: () => undefined,
      getImageData: (_x: number, _y: number, width: number, height: number) => {
        const data = new Uint8ClampedArray(width * height * 4).fill(255);
        if (setup.alpha && !drawn.white) data[3] = 0;
        return { data, width, height };
      },
    } as unknown as CanvasRenderingContext2D;
  } as never);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (this: HTMLCanvasElement, callback: BlobCallback, type?: string, quality?: number) {
    const drawn = (this as unknown as { drawn: Drawn }).drawn;
    drawn.asked.push([type ?? 'image/png', quality]);
    const made = type === 'image/webp' && setup.webp === false ? 'image/png' : type ?? 'image/png';
    callback(new Blob([new Uint8Array(setup.bytes(made, this.width, this.height))], { type: made }));
  });
  return { close };
}

/** The canvases the picture was redrawn on (the 256 px probe of transparency left out). */
const redrawn = () => canvases.filter((drawn) => drawn.asked.length > 0);

beforeEach(() => {
  canvases = [];
  decodeCalls = [];
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('pictureFromFile: the one helper of every picture the author adds', () => {
  it('names a picture by the sha256 of its bytes and keeps them', async () => {
    const result = await pictureFromFile(new Blob([PNG], { type: 'image/png' }));
    if (typeof result === 'string') throw new Error(result);
    expect(result.id).toMatch(/^[0-9a-f]{64}$/);
    expect(result.picture.type).toBe('image/png');
    expect(Uint8Array.from(atob(result.picture.data), (c) => c.charCodeAt(0))).toEqual(PNG);
    expect(picturePath('11111111-2222-4333-8444-555555555555', result.id, result.picture.type)).toMatch(/\.png$/);
    const again = await pictureFromFile(new Blob([PNG], { type: 'image/png' }));
    expect(typeof again !== 'string' && again.id).toBe(result.id);
  });

  it('refuses what is not a picture, and SVG', async () => {
    expect(await pictureFromFile(new Blob(['hello'], { type: 'text/plain' }))).toBe('type');
    expect(await pictureFromFile(new Blob(['<svg/>'], { type: 'image/svg+xml' }))).toBe('type');
    expect(await pictureFromFile(fileOf(10, '', 'notes.txt'))).toBe('type');
  });

  it('a phone’s 5 MB photo: drawn upright (EXIF), redrawn at 2400 px, the smaller of JPEG 0.85 and WebP 0.85', async () => {
    const { close } = browser({ bitmap: { width: 4032, height: 3024 }, bytes: (type) => (type === 'image/webp' ? 600_000 : 900_000) });
    const onStage = vi.fn();
    const result = await pictureFromFile(fileOf(5 * MB, 'image/jpeg', 'IMG_0001.jpg'), { onStage });
    if (typeof result === 'string') throw new Error(result);
    expect(decodeCalls[0][1]).toEqual({ imageOrientation: 'from-image' });
    expect(onStage).toHaveBeenCalledWith('shrink');
    const [canvas] = redrawn();
    expect([canvas.width, canvas.height]).toEqual([MAX_PICTURE_SIDE, 1800]);
    expect(canvas.white).toBe(true);
    expect(canvas.asked).toEqual([
      ['image/jpeg', 0.85],
      ['image/webp', 0.85],
    ]);
    expect(result.picture.type).toBe('image/webp');
    expect(atob(result.picture.data).length).toBe(600_000);
    expect(close).toHaveBeenCalled();
  });

  it('JPEG when it is smaller, or when the browser cannot write WebP (Safari gives PNG instead)', async () => {
    browser({ bitmap: { width: 3024, height: 4032 }, bytes: (type) => (type === 'image/jpeg' ? 700_000 : 800_000) });
    const smaller = await pictureFromFile(fileOf(4 * MB, 'image/jpeg'));
    expect(typeof smaller !== 'string' && smaller.picture.type).toBe('image/jpeg');
    expect([redrawn()[0].width, redrawn()[0].height]).toEqual([1800, 2400]);

    browser({ bitmap: { width: 4000, height: 3000 }, webp: false, bytes: (type) => (type === 'image/png' ? 100 : 900_000) });
    const noWebp = await pictureFromFile(fileOf(4 * MB, 'image/jpeg'));
    expect(typeof noWebp !== 'string' && noWebp.picture.type).toBe('image/jpeg');
  });

  it('a picture that already fits (≤ 3 MB, ≤ 2400 px) is kept as it is', async () => {
    browser({ bitmap: { width: 2400, height: 1600 }, bytes: () => 1 });
    const onStage = vi.fn();
    const file = fileOf(2 * MB, 'image/jpeg');
    const result = await pictureFromFile(file, { onStage });
    expect(typeof result !== 'string' && atob(result.picture.data).length).toBe(2 * MB);
    expect(redrawn()).toEqual([]);
    expect(onStage).not.toHaveBeenCalled();
  });

  it('a PNG with transparency under 3 MB is kept even when it is large; an opaque one is redrawn', async () => {
    browser({ bitmap: { width: 3200, height: 2000 }, alpha: true, bytes: () => 1 });
    const clear = await pictureFromFile(fileOf(MB, 'image/png'));
    expect(typeof clear !== 'string' && clear.picture.type).toBe('image/png');
    expect(redrawn()).toEqual([]);

    browser({ bitmap: { width: 3200, height: 2000 }, alpha: false, bytes: (type) => (type === 'image/jpeg' ? 300_000 : 400_000) });
    const opaque = await pictureFromFile(fileOf(MB, 'image/png'));
    expect(typeof opaque !== 'string' && opaque.picture.type).toBe('image/jpeg');
    expect([redrawn()[0].width, redrawn()[0].height]).toEqual([2400, 1500]);
  });

  it('a transparent picture over 3 MB keeps its transparency: PNG or WebP, nothing white under it', async () => {
    browser({ bitmap: { width: 3000, height: 3000 }, alpha: true, bytes: (type) => (type === 'image/png' ? 2 * MB : 2.5 * MB) });
    const result = await pictureFromFile(fileOf(6 * MB, 'image/png'));
    expect(typeof result !== 'string' && result.picture.type).toBe('image/png');
    const [canvas] = redrawn();
    expect(canvas.white).toBe(false);
    expect(canvas.asked.map(([type]) => type)).toEqual(['image/png', 'image/webp']);
  });

  it('a transparent picture that does not fit as PNG or WebP goes on white as JPEG', async () => {
    browser({ bitmap: { width: 3000, height: 3000 }, alpha: true, bytes: (type) => (type === 'image/jpeg' ? MB : 4 * MB) });
    const result = await pictureFromFile(fileOf(6 * MB, 'image/png'));
    expect(typeof result !== 'string' && result.picture.type).toBe('image/jpeg');
    expect(redrawn().map((canvas) => canvas.white)).toEqual([false, true]);
  });

  it('a GIF up to 3 MB keeps its motion (not even drawn); a larger one is redrawn', async () => {
    browser({ bitmap: { width: 4000, height: 3000 }, bytes: () => 500_000 });
    const small = await pictureFromFile(fileOf(2 * MB, 'image/gif'));
    expect(typeof small !== 'string' && small.picture.type).toBe('image/gif');
    expect(decodeCalls).toEqual([]);
    const big = await pictureFromFile(fileOf(5 * MB, 'image/gif'));
    expect(typeof big !== 'string' && big.picture.type).toBe('image/jpeg');
  });

  it('a BMP the browser draws is redrawn (the cover bucket does not take BMP)', async () => {
    browser({ bitmap: { width: 800, height: 600 }, bytes: (type) => (type === 'image/jpeg' ? 50_000 : 60_000) });
    const result = await pictureFromFile(fileOf(1_440_054, 'image/bmp'));
    expect(typeof result !== 'string' && result.picture.type).toBe('image/jpeg');
    expect([redrawn()[0].width, redrawn()[0].height]).toEqual([800, 600]);
  });

  it('HEIC: by its type or by its name; redrawn when the browser draws it (Safari), else said in words', async () => {
    expect(isHeic(fileOf(1, 'image/heic'))).toBe(true);
    expect(isHeic(fileOf(1, 'image/heif'))).toBe(true);
    expect(isHeic(fileOf(1, '', 'IMG_2042.HEIC'))).toBe(true);
    expect(isHeic(fileOf(1, 'application/octet-stream', 'photo.heif'))).toBe(true);
    expect(isHeic(fileOf(1, 'image/jpeg', 'photo.heic'))).toBe(false);

    browser({ bitmap: { width: 4032, height: 3024 }, bytes: (type) => (type === 'image/jpeg' ? 800_000 : 900_000) });
    const drawn = await pictureFromFile(fileOf(2 * MB, '', 'IMG_2042.HEIC'));
    expect(typeof drawn !== 'string' && drawn.picture.type).toBe('image/jpeg');

    browser({ bitmap: null, bytes: () => 1 });
    expect(await pictureFromFile(fileOf(2 * MB, 'image/heic', 'IMG_2042.HEIC'))).toBe('heic');
    expect(await pictureFromFile(fileOf(2 * MB, '', 'IMG_2043.heic'))).toBe('heic');
  });

  it('a browser that does not know imageOrientation is asked again without it', async () => {
    browser({ bitmap: { width: 4000, height: 3000 }, noOptions: true, bytes: () => 500_000 });
    const result = await pictureFromFile(fileOf(4 * MB, 'image/jpeg'));
    expect(typeof result).not.toBe('string');
    expect(decodeCalls.map((args) => args.length)).toEqual([2, 1]);
  });

  it('a picture the browser cannot draw: kept when it fits, else too big; another type is not a picture', async () => {
    browser({ bitmap: null, bytes: () => 1 });
    const kept = await pictureFromFile(fileOf(MB, 'image/webp'));
    expect(typeof kept !== 'string' && kept.picture.type).toBe('image/webp');
    expect(await pictureFromFile(fileOf(4 * MB, 'image/jpeg'))).toBe('size');
    expect(await pictureFromFile(fileOf(MB, 'image/avif'))).toBe('type');
  });

  it('smaller sides while it is still over 3 MB (2400, 1800, 1280), then «size»', async () => {
    browser({ bitmap: { width: 6000, height: 4000 }, bytes: (_type, width) => (width > 1280 ? 4 * MB : 2 * MB) });
    const last = await pictureFromFile(fileOf(9 * MB, 'image/jpeg'));
    expect(typeof last !== 'string' && last.picture.type).toBe('image/jpeg');
    expect(redrawn().map((canvas) => canvas.width)).toEqual([2400, 1800, 1280]);

    browser({ bitmap: { width: 6000, height: 4000 }, bytes: () => 4 * MB });
    expect(await pictureFromFile(fileOf(9 * MB, 'image/jpeg'))).toBe('size');
    expect(await pictureFromFile(fileOf(MAX_PICTURE_BYTES + 1, 'image/png'))).toBe('size');
  });
});

// ── a guest's pictures (release 47): the quiz-media function, the way the client goes ──

const BASE = 'https://ref.supabase.co';
const SITE = 'https://meldy.example';
const CONTAINER = '11111111-2222-4333-8444-555555555555';
const ATTEMPT = '0f1e2d3c-4b5a-4968-8778-695a4b3c2d1e';
const TOKEN = 'AbCdEfGhIjKlMnOpQrStUvWxYz0123456789-_AbCdE';
const FUNCTION_PATH = '/functions/v1/quiz-media?forceFunctionRegion=eu-central-1';

/** A path no other test read (the cache lives as long as the module). */
let pathNo = 0;
const freshPath = () => `${CONTAINER}/${(pathNo += 1).toString(16).padStart(64, '0')}.png`;

type Call = { url: string; init?: RequestInit };

/** supabase.co answers the probe or refuses it; every other call gets `reply`. */
function network(direct: 'up' | 'refused', reply: (call: Call) => Promise<Response> | Response) {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.endsWith('/auth/v1/health')) {
      if (direct === 'refused') throw new TypeError('Failed to fetch');
      return new Response('{}', { status: 200 });
    }
    calls.push({ url, init });
    return reply({ url, init });
  });
  net.fetch = createSupabaseFetch({ supabaseUrl: BASE, anonKey: 'anon-key', fetchImpl, origin: () => SITE });
  return calls;
}

const picture = () => new Response(PNG, { status: 200, headers: { 'Content-Type': 'image/png' } });
const notFound = () => new Response('{"error":"not_found"}', { status: 404, headers: { 'Content-Type': 'application/json' } });

let made = 0;
beforeEach(() => {
  window.localStorage.clear();
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: vi.fn(() => `blob:picture-${(made += 1)}`) });
});

describe('guestPictureUrl', () => {
  it('POSTs the attempt, the token and the path to quiz-media with the public anon key, as supabase-js would', async () => {
    const calls = network('up', picture);
    const path = freshPath();
    const url = await guestPictureUrl(path, ATTEMPT, TOKEN);
    expect(url).toMatch(/^blob:picture-\d+$/);
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call.url).toBe(`${BASE}${FUNCTION_PATH}`);
    expect(call.init?.method).toBe('POST');
    expect(call.init?.headers).toEqual({ apikey: 'anon-key', Authorization: 'Bearer anon-key', 'Content-Type': 'application/json' });
    expect(JSON.parse(String(call.init?.body))).toEqual({ attempt_id: ATTEMPT, token: TOKEN, path });
    const blob = vi.mocked(URL.createObjectURL).mock.calls[0][0] as Blob;
    expect(blob.type).toBe('image/png');
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(PNG);
  });

  it('goes through the site (/sb/) when supabase.co is blocked, as the client does', async () => {
    const calls = network('refused', picture);
    await guestPictureUrl(freshPath(), ATTEMPT, TOKEN);
    expect(calls.map((call) => call.url)).toEqual([`${SITE}/sb${FUNCTION_PATH}`]);
    expect((calls[0].init?.headers as Record<string, string>).Authorization).toBe('Bearer anon-key');
  });

  it('reads a path once per page load; another path is another read', async () => {
    const calls = network('up', picture);
    const path = freshPath();
    const first = guestPictureUrl(path, ATTEMPT, TOKEN);
    expect(guestPictureUrl(path, ATTEMPT, TOKEN)).toBe(first);
    const url = await first;
    expect(await guestPictureUrl(path, ATTEMPT, TOKEN)).toBe(url);
    expect(calls).toHaveLength(1);
    await guestPictureUrl(freshPath(), ATTEMPT, TOKEN);
    expect(calls).toHaveLength(2);
  });

  it('a failed read is forgotten: a 404, an answer that is not a picture, a network failure', async () => {
    const replies: Array<() => Response> = [notFound, () => new Response('<html></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }), picture];
    const calls = network('up', () => replies.shift()!());
    const path = freshPath();
    await expect(guestPictureUrl(path, ATTEMPT, TOKEN)).rejects.toThrow();
    await expect(guestPictureUrl(path, ATTEMPT, TOKEN)).rejects.toThrow();
    await expect(guestPictureUrl(path, ATTEMPT, TOKEN)).resolves.toMatch(/^blob:/);
    expect(calls).toHaveLength(3);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);

    let down = true;
    const again = network('up', () => {
      if (down) throw new TypeError('Failed to fetch');
      return picture();
    });
    const other = freshPath();
    await expect(guestPictureUrl(other, ATTEMPT, TOKEN)).rejects.toThrow();
    down = false;
    await expect(guestPictureUrl(other, ATTEMPT, TOKEN)).resolves.toMatch(/^blob:/);
    // The direct way failed: the client moved to the site's way, and the picture took it too.
    expect(again.map((call) => call.url)).toEqual([`${BASE}${FUNCTION_PATH}`, `${SITE}/sb${FUNCTION_PATH}`]);
  });
});

describe('pictureUrl (signed in)', () => {
  it('reads from the private bucket once per path; a failed read is forgotten', async () => {
    const download = vi.fn().mockResolvedValueOnce({ data: null, error: new Error('denied') }).mockResolvedValue({ data: new Blob([PNG], { type: 'image/png' }), error: null });
    vi.mocked(supabase.storage.from).mockReturnValue({ download } as unknown as ReturnType<typeof supabase.storage.from>);
    const path = freshPath();
    await expect(pictureUrl(path)).rejects.toThrow('denied');
    const url = await pictureUrl(path);
    expect(url).toMatch(/^blob:/);
    expect(await pictureUrl(path)).toBe(url);
    expect(supabase.storage.from).toHaveBeenCalledWith('test-item-images');
    expect(download).toHaveBeenCalledTimes(2);
    expect(download).toHaveBeenCalledWith(path);
  });

  it('a path a guest read already is not read again', async () => {
    network('up', picture);
    const download = vi.fn();
    vi.mocked(supabase.storage.from).mockReturnValue({ download } as unknown as ReturnType<typeof supabase.storage.from>);
    const path = freshPath();
    const url = await guestPictureUrl(path, ATTEMPT, TOKEN);
    expect(await pictureUrl(path)).toBe(url);
    expect(download).not.toHaveBeenCalled();
  });
});

describe('removeContainerPictures (live check of 47.4: a deleted test’s public pictures kept opening)', () => {
  const EXAM = '90a6a48d-b7ad-478f-b274-da63cea1a4de';
  const file = (name: string) => ({ id: `${name}-id`, name });
  it('lists the exam’s folder of both buckets page by page and removes what it holds', async () => {
    const covers = Array.from({ length: 130 }, (_, n) => file(`${String(n).padStart(64, '0')}.jpg`));
    const lists: Record<string, Array<{ id: string | null; name: string }>> = {
      'quiz-covers': covers,
      'test-item-images': [file(`${'a'.repeat(64)}.png`), { id: null, name: 'sub' }],
    };
    const removed: Array<[string, string[]]> = [];
    vi.mocked(supabase.storage.from).mockImplementation(((bucket: string) => ({
      list: vi.fn(async (folder: string, options: { limit: number; offset: number }) => {
        expect(folder).toBe(EXAM);
        return { data: lists[bucket].slice(options.offset, options.offset + options.limit), error: null };
      }),
      remove: vi.fn(async (paths: string[]) => {
        removed.push([bucket, paths]);
        return { data: paths.map((name) => ({ name })), error: null };
      }),
    })) as never);
    await expect(removeContainerPictures(EXAM)).resolves.toBe(131);
    expect(removed.map(([bucket, paths]) => [bucket, paths.length])).toEqual([
      ['quiz-covers', 100],
      ['quiz-covers', 30],
      ['test-item-images', 1],
    ]);
    expect(removed[0][1][0]).toBe(`${EXAM}/${'0'.repeat(64)}.jpg`);
    // A sub-folder (no id) is not an object of the exam.
    expect(removed[2][1]).toEqual([`${EXAM}/${'a'.repeat(64)}.png`]);
  });

  it('touches nothing for an id that is not an exam’s, and throws what storage refuses', async () => {
    vi.mocked(supabase.storage.from).mockClear();
    await expect(removeContainerPictures('../other')).resolves.toBe(0);
    expect(supabase.storage.from).not.toHaveBeenCalled();
    vi.mocked(supabase.storage.from).mockImplementation((() => ({
      list: vi.fn(async () => ({ data: null, error: new Error('denied') })),
      remove: vi.fn(),
    })) as never);
    await expect(removeContainerPictures(EXAM)).rejects.toThrow('denied');
  });
});

describe('uploadPicture: the same picture again', () => {
  const picture = { type: 'image/png', data: btoa('png') };
  const path = `11111111-2222-4333-8444-555555555555/${'a'.repeat(64)}.png`;

  it('a quiz cover (the studio’s pictures too) is written over: no «already exists» 400 (live check of 47.4)', async () => {
    const upload = vi.fn().mockResolvedValue({ data: { path }, error: null });
    vi.mocked(supabase.storage.from).mockReturnValue({ upload } as unknown as ReturnType<typeof supabase.storage.from>);
    expect(await uploadPicture(path, picture, COVER_BUCKET)).toBe('kept');
    expect(supabase.storage.from).toHaveBeenLastCalledWith(COVER_BUCKET);
    expect(upload.mock.calls[0][2]).toMatchObject({ upsert: true, contentType: 'image/png' });
  });

  it('a question’s picture (no update policy there): not written over; one already there counts as kept', async () => {
    const upload = vi.fn().mockResolvedValue({ data: null, error: { status: 400, statusCode: '409', message: 'The resource already exists' } });
    vi.mocked(supabase.storage.from).mockReturnValue({ upload } as unknown as ReturnType<typeof supabase.storage.from>);
    expect(await uploadPicture(path, picture)).toBe('kept');
    expect(supabase.storage.from).toHaveBeenLastCalledWith(PICTURE_BUCKET);
    expect(upload.mock.calls[0][2]).toMatchObject({ upsert: false });
  });
});

describe('a picture the author adds is made in its own worker (the smoothness audit of 20.10)', () => {
  const FIXED = 'f'.repeat(64);
  type Ask = { ask: number; file: Blob };
  type Answer = { ask: number; stage?: string; done?: unknown; failed?: true };

  /** A Worker that answers as `answer` says; the files it was given. */
  function fakeWorker(answer: (ask: Ask) => Answer[]) {
    const given: Blob[] = [];
    class FakeWorker {
      onmessage: ((event: { data: Answer }) => void) | null = null;
      onerror: (() => void) | null = null;
      postMessage(ask: Ask) {
        given.push(ask.file);
        setTimeout(() => {
          for (const data of answer(ask)) this.onmessage?.({ data });
        }, 0);
      }
    }
    vi.stubGlobal('Worker', FakeWorker);
    vi.stubGlobal('OffscreenCanvas', class {});
    return given;
  }

  it('the worker’s picture is the one uploaded: its bytes (no base64), its stage heard on the page', async () => {
    const made = new Blob([new Uint8Array(1000)], { type: 'image/jpeg' });
    const given = fakeWorker(({ ask }) => [{ ask, stage: 'shrink' }, { ask, done: { id: FIXED, blob: made } }]);
    vi.resetModules();
    const fresh = await import('./itemPictures');
    const onStage = vi.fn();
    const photo = fileOf(5 * MB, 'image/jpeg', 'IMG_0001.jpg');
    const result = await fresh.preparePicture(photo, { onStage });
    expect(given).toEqual([photo]);
    expect(onStage).toHaveBeenCalledWith('shrink');
    expect(result).toEqual({ id: FIXED, blob: made });

    const upload = vi.fn().mockResolvedValue({ data: {}, error: null });
    const { supabase: client } = await import('../lib/supabase');
    vi.mocked(client.storage.from).mockReturnValue({ upload } as unknown as ReturnType<typeof client.storage.from>);
    expect(await fresh.uploadPicture(`11111111-2222-4333-8444-555555555555/${FIXED}.jpg`, made, fresh.COVER_BUCKET)).toBe('kept');
    expect(upload.mock.calls[0][1]).toBe(made);
    expect(upload.mock.calls[0][2]).toMatchObject({ contentType: 'image/jpeg', upsert: true });
  });

  it('a worker that fails: the page makes the picture itself, the same way', async () => {
    fakeWorker(({ ask }) => [{ ask, failed: true }]);
    vi.resetModules();
    const fresh = await import('./itemPictures');
    const result = await fresh.preparePicture(new Blob([PNG], { type: 'image/png' }));
    if (typeof result === 'string') throw new Error(result);
    expect(result.id).toMatch(/^[0-9a-f]{64}$/);
    expect(result.blob.type).toBe('image/png');
  });

  it('the worker itself: no 2D canvas of its own — it says so (the page then draws); not a picture — refused there', async () => {
    const answers: Answer[] = [];
    const scope = { onmessage: null as ((event: { data: Ask }) => void) | null, postMessage: (answer: Answer) => answers.push(answer) };
    vi.stubGlobal('self', scope);
    vi.resetModules();
    await import('./pictureWorker');
    scope.onmessage?.({ data: { ask: 1, file: new Blob(['x'], { type: 'image/png' }) } });
    await vi.waitFor(() => expect(answers).toEqual([{ ask: 1, failed: true }]));

    vi.stubGlobal(
      'OffscreenCanvas',
      class {
        getContext() {
          return {};
        }
      },
    );
    scope.onmessage?.({ data: { ask: 2, file: new Blob(['hello'], { type: 'text/plain' }) } });
    await vi.waitFor(() => expect(answers).toContainEqual({ ask: 2, done: 'type' }));
  });
});
