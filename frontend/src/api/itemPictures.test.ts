import { describe, expect, it, vi } from 'vitest';

vi.mock('../lib/supabase', () => ({ supabase: { storage: { from: vi.fn() } } }));

import { MAX_PICTURE_BYTES, pictureFromFile, picturePath } from './itemPictures';

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
