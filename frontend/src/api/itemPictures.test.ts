import { beforeEach, describe, expect, it, vi } from 'vitest';

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
/** The client's routed fetch (lib/supabase supabaseFetch): each test makes a fresh one over a fake network. */
const net = vi.hoisted(() => ({ fetch: null as FetchLike | null }));
vi.mock('../lib/supabase', () => ({
  supabase: { storage: { from: vi.fn() } },
  supabaseUrl: 'https://ref.supabase.co',
  supabaseAnonKey: 'anon-key',
  supabaseFetch: (input: RequestInfo | URL, init?: RequestInit) => net.fetch!(input, init),
}));

import { guestPictureUrl, MAX_PICTURE_BYTES, pictureFromFile, picturePath, pictureUrl } from './itemPictures';
import { supabase } from '../lib/supabase';
import { createSupabaseFetch } from '../lib/supabaseRoute';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 1]);
const noMeasure = { measure: async () => null };

describe('pictureFromFile', () => {
  it('names a picture by the sha256 of its bytes and keeps them', async () => {
    const result = await pictureFromFile(new Blob([PNG], { type: 'image/png' }), noMeasure);
    if (typeof result === 'string') throw new Error(result);
    expect(result.id).toMatch(/^[0-9a-f]{64}$/);
    expect(result.picture.type).toBe('image/png');
    expect(Uint8Array.from(atob(result.picture.data), (c) => c.charCodeAt(0))).toEqual(PNG);
    expect(picturePath('11111111-2222-4333-8444-555555555555', result.id, result.picture.type)).toMatch(/\.png$/);
    const again = await pictureFromFile(new Blob([PNG], { type: 'image/png' }), noMeasure);
    expect(typeof again !== 'string' && again.id).toBe(result.id);
  });

  it('refuses what is not a picture', async () => {
    expect(await pictureFromFile(new Blob(['hello'], { type: 'text/plain' }), noMeasure)).toBe('type');
    expect(await pictureFromFile(new Blob(['<svg/>'], { type: 'image/svg+xml' }), noMeasure)).toBe('type');
  });

  it('redraws a big photo as JPEG', async () => {
    const shrink = vi.fn(async () => new Blob([new Uint8Array(1024)], { type: 'image/jpeg' }));
    const result = await pictureFromFile(new Blob([new Uint8Array(MAX_PICTURE_BYTES + 1)], { type: 'image/jpeg' }), { ...noMeasure, shrink });
    expect(shrink).toHaveBeenCalledWith(expect.any(Blob), 2000);
    expect(typeof result !== 'string' && result.picture.type).toBe('image/jpeg');
  });

  it('redraws a picture wider than 2000 px even when it is small in bytes', async () => {
    const shrink = vi.fn(async () => new Blob([new Uint8Array(10)], { type: 'image/jpeg' }));
    await pictureFromFile(new Blob([PNG], { type: 'image/png' }), { measure: async () => ({ width: 4000, height: 3000 }), shrink });
    expect(shrink).toHaveBeenCalledTimes(1);
  });

  it('says so when even the redrawn picture is too big', async () => {
    const shrink = async () => new Blob([new Uint8Array(MAX_PICTURE_BYTES + 5)], { type: 'image/jpeg' });
    expect(await pictureFromFile(new Blob([new Uint8Array(MAX_PICTURE_BYTES + 1)], { type: 'image/png' }), { ...noMeasure, shrink })).toBe('size');
    expect(await pictureFromFile(new Blob([new Uint8Array(MAX_PICTURE_BYTES + 1)], { type: 'image/png' }), { ...noMeasure, shrink: async () => { throw new Error('x'); } })).toBe('size');
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
