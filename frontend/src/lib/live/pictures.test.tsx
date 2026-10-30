/**
 * A live question's pictures on a screen (pictures.ts): the first picture of the question and of each option, read once
 * the question is there; a picture that does not come says so (false) instead of an empty box; a poll's new object with
 * the same paths reads nothing again; a question without pictures reads nothing.
 */
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { hasPictures, useLivePictures } from './pictures';
import type { LivePictures } from './types';

const flush = () => act(async () => {
  await Promise.resolve();
  await Promise.resolve();
});

describe('useLivePictures', () => {
  it('a question without pictures: nothing read, nothing shown', async () => {
    const read = vi.fn(async (path: string) => `blob:${path}`);
    const { result } = renderHook(() => useLivePictures(undefined, read));
    await flush();
    expect(result.current).toEqual({ stem: undefined, options: [], any: false });
    expect(hasPictures({ stem: [], options: [[], []] })).toBe(false);
    expect(read).not.toHaveBeenCalled();
  });

  it('the stem\'s first picture and each option\'s; a failed one is false, an option without one undefined', async () => {
    const read = vi.fn((path: string) => (path === 'c/bad.png' ? Promise.reject(new Error('404')) : Promise.resolve(`blob:${path}`)));
    const pictures: LivePictures = { stem: ['c/a.png', 'c/a2.png'], options: [[], ['c/b.png'], ['c/bad.png'], []] };
    const { result } = renderHook(() => useLivePictures(pictures, read));
    expect(result.current.any).toBe(true);
    expect(result.current.stem).toBeNull();
    await flush();
    expect(result.current).toEqual({ stem: 'blob:c/a.png', options: [undefined, 'blob:c/b.png', false, undefined], any: true });
    expect(read.mock.calls.map(([p]) => p)).toEqual(['c/a.png', 'c/b.png', 'c/bad.png']);
  });

  it('the same paths in a new object (the next poll): no new read', async () => {
    const read = vi.fn(async (path: string) => `blob:${path}`);
    const { result, rerender } = renderHook(({ p }) => useLivePictures(p, read), {
      initialProps: { p: { stem: ['c/a.png'], options: [[], []] } as LivePictures },
    });
    await flush();
    rerender({ p: { stem: ['c/a.png'], options: [[], []] } });
    await flush();
    expect(read).toHaveBeenCalledTimes(1);
    expect(result.current.stem).toBe('blob:c/a.png');
  });
});
