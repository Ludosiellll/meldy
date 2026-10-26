import { afterEach, describe, expect, it, vi } from 'vitest';
import { hoursMinutes, mediaDuration } from './mediaDuration';

describe('mediaDuration', () => {
  afterEach(() => vi.restoreAllMocks());

  function stubMedia(onSrc: (element: HTMLMediaElement) => void) {
    const created: HTMLMediaElement[] = [];
    const original = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const element = original(tag) as HTMLMediaElement;
      if (tag === 'audio' || tag === 'video') {
        created.push(element);
        Object.defineProperty(element, 'src', { set: () => onSrc(element), configurable: true });
      }
      return element;
    }) as typeof document.createElement);
    URL.createObjectURL = vi.fn(() => 'blob:rec');
    URL.revokeObjectURL = vi.fn();
    return created;
  }

  it('reads the length from the metadata and lets the object URL go', async () => {
    const created = stubMedia(element => {
      Object.defineProperty(element, 'duration', { value: 2820, configurable: true });
      element.dispatchEvent(new Event('loadedmetadata'));
    });
    await expect(mediaDuration(new File([new Uint8Array(4)], 'a.mp3', { type: 'audio/mpeg' }))).resolves.toBe(2820);
    expect(created[0].tagName).toBe('AUDIO');
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:rec');
  });

  it('uses a video element for a video and gives null for an unreadable file', async () => {
    const created = stubMedia(element => element.dispatchEvent(new Event('error')));
    await expect(mediaDuration(new File([new Uint8Array(4)], 'a.mp4', { type: 'video/mp4' }))).resolves.toBeNull();
    expect(created[0].tagName).toBe('VIDEO');
  });

  it('gives null for an endless or unknown length and after the timeout', async () => {
    stubMedia(element => {
      Object.defineProperty(element, 'duration', { value: Infinity, configurable: true });
      element.dispatchEvent(new Event('loadedmetadata'));
    });
    await expect(mediaDuration(new File([], 'a.mp3', { type: 'audio/mpeg' }))).resolves.toBeNull();
    vi.restoreAllMocks();
    stubMedia(() => undefined);
    await expect(mediaDuration(new File([], 'b.mp3', { type: 'audio/mpeg' }), 20)).resolves.toBeNull();
  });
});

describe('hoursMinutes', () => {
  it('says a length as the server does', () => {
    expect([2700, 3900, 7200, 7201, 30].map(hoursMinutes)).toEqual(['45 мин', '1 ч 05 мин', '2 ч', '2 ч 01 мин', '1 мин']);
  });
});
