import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import Footage from './Footage';
import type { Footage as FootageDef } from '../../lib/footage';

/* The player of real footage (Footage.tsx): the poster, the parts fetched near the window, play and pause. */

let made = 0;
function footage(): FootageDef {
  made += 1;
  return {
    parts: [`/game/footage/p${made}-0123456789-1.bin`, `/game/footage/p${made}-0123456789-2.bin`],
    poster: `/game/footage/p${made}-0123456789-poster.webp`,
    width: 800,
    height: 450,
    duration: 10.8,
    type: 'video/mp4; codecs="avc1.640028"',
    backdrop: 'rgb(42, 35, 86)',
  };
}

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: reduce && query.includes('prefers-reduced-motion'),
    media: query,
    addEventListener() {},
    removeEventListener() {},
    addListener() {},
    removeListener() {},
  }));
}

/** IntersectionObserver as a test drives it: `show(margin, on)` tells the observers of that margin. */
const observers: Array<{ margin: string; callback: (entries: Array<{ isIntersecting: boolean }>) => void }> = [];
class FakeObserver {
  constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void, options?: { rootMargin?: string }) {
    observers.push({ margin: options?.rootMargin ?? '0px', callback });
  }
  observe() {}
  disconnect() {}
}
function show(margin: string, on: boolean) {
  act(() => {
    for (const observer of observers) if (observer.margin === margin) observer.callback([{ isIntersecting: on }]);
  });
}

const ok = () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/octet-stream' }), blob: async () => new Blob(['x']) });
let fetchMock: Mock<(url: string) => Promise<unknown>>;
let play: Mock<(this: HTMLMediaElement) => Promise<void>>;
let pause: Mock<(this: HTMLMediaElement) => void>;
let canPlay: Mock<(type: string) => CanPlayTypeResult>;
const ownCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');

const root = () => document.querySelector('.fo') as HTMLElement;
const poster = () => document.querySelector('.fo-poster') as HTMLImageElement | null;
const video = () => document.querySelector('video');
const setHidden = (hidden: boolean) => {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  act(() => {
    document.dispatchEvent(new Event('visibilitychange'));
  });
};

beforeEach(() => {
  observers.length = 0;
  stubReducedMotion(false);
  fetchMock = vi.fn(async () => ok());
  vi.stubGlobal('fetch', fetchMock);
  play = vi.fn(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: false });
    return Promise.resolve();
  });
  pause = vi.fn(function (this: HTMLMediaElement) {
    Object.defineProperty(this, 'paused', { configurable: true, value: true });
  });
  canPlay = vi.fn((): CanPlayTypeResult => 'probably');
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(pause);
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockImplementation(canPlay);
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: () => `blob:fo-${made}` });
});
afterEach(() => {
  cleanup();
  if (ownCreate) Object.defineProperty(URL, 'createObjectURL', ownCreate);
  else delete (URL as { createObjectURL?: unknown }).createObjectURL;
  delete (document as { hidden?: boolean }).hidden;
  vi.unstubAllGlobals();
});

describe('Footage', () => {
  it('shows the poster at once, fitted whole, over the footage’s backdrop; decoration only', () => {
    const clip = footage();
    render(<Footage footage={clip} />);
    expect(root()).toHaveAttribute('aria-hidden', 'true');
    expect(root()).toHaveAttribute('data-fit', 'contain');
    expect(root().style.background).toBe('rgb(42, 35, 86)');
    expect(poster()).toHaveAttribute('src', clip.poster);
    expect(poster()).toHaveAttribute('alt', '');
    // Far below the fold (the landing), the poster waits too.
    expect(poster()).toHaveAttribute('loading', 'lazy');
    expect(poster()).toHaveAttribute('decoding', 'async');
  });

  it('takes a fit and a background of the caller’s', () => {
    render(<Footage footage={footage()} fit="cover" background="rgb(0, 0, 0)" className="x-reel" />);
    expect(root()).toHaveAttribute('data-fit', 'cover');
    expect(root()).toHaveClass('fo', 'x-reel');
    expect(root().style.background).toBe('rgb(0, 0, 0)');
  });

  it('fetches the parts, then plays the video muted in a loop, inline; it shows once a frame is up', async () => {
    const clip = footage();
    render(<Footage footage={clip} />);
    await waitFor(() => expect(video()).not.toBeNull());
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(clip.parts);
    const el = video()!;
    expect(el.getAttribute('src')).toBe(`blob:fo-${made}`);
    expect(el.muted).toBe(true);
    expect(el.loop).toBe(true);
    expect(el).toHaveAttribute('playsinline');
    expect(el.controls).toBe(false);
    await waitFor(() => expect(play).toHaveBeenCalled());
    // The poster stays until the video shows a frame.
    expect(root()).not.toHaveAttribute('data-shown');
    fireEvent.playing(el);
    expect(root()).toHaveAttribute('data-shown', '');
    expect(poster()).not.toBeNull();
  });

  it('with reduced motion keeps the poster and fetches nothing; `still={false}` plays anyway', async () => {
    stubReducedMotion(true);
    const clip = footage();
    const { rerender } = render(<Footage footage={clip} />);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(video()).toBeNull();
    expect(poster()).toHaveAttribute('src', clip.poster);
    rerender(<Footage footage={clip} still={false} />);
    await waitFor(() => expect(video()).not.toBeNull());
    await waitFor(() => expect(play).toHaveBeenCalled());
  });

  it('fetches nothing until it is near the window, and plays only while it is in it', async () => {
    vi.stubGlobal('IntersectionObserver', FakeObserver);
    render(<Footage footage={footage()} />);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(observers.map((observer) => observer.margin).sort()).toEqual(['0px', '300px']);
    show('300px', true);
    await waitFor(() => expect(video()).not.toBeNull());
    expect(play).not.toHaveBeenCalled();
    show('0px', true);
    expect(play).toHaveBeenCalledTimes(1);
    show('0px', false);
    expect(pause).toHaveBeenCalledTimes(1);
  });

  it('pauses while the tab is hidden and plays again when it is back', async () => {
    render(<Footage footage={footage()} />);
    await waitFor(() => expect(play).toHaveBeenCalledTimes(1));
    setHidden(true);
    expect(pause).toHaveBeenCalledTimes(1);
    setHidden(false);
    expect(play).toHaveBeenCalledTimes(2);
  });

  it('keeps the poster, with no words, when the browser cannot play it, a part fails or the video errs', async () => {
    canPlay.mockReturnValue('');
    render(<Footage footage={footage()} />);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    expect(video()).toBeNull();
    cleanup();

    canPlay.mockReturnValue('probably');
    fetchMock.mockImplementation(async () => ({ ...ok(), ok: false, status: 404 }));
    render(<Footage footage={footage()} />);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    await act(async () => {});
    expect(video()).toBeNull();
    expect(poster()).not.toBeNull();
    expect(root().textContent).toBe('');
    cleanup();

    fetchMock.mockImplementation(async () => ok());
    render(<Footage footage={footage()} />);
    await waitFor(() => expect(video()).not.toBeNull());
    fireEvent.error(video()!);
    expect(video()).toBeNull();
    expect(poster()).not.toBeNull();
  });

  it('gives the caller the <video> through its ref; `play={false}` leaves the time to the caller', async () => {
    const ref = createRef<HTMLVideoElement>();
    const ready = vi.fn();
    render(<Footage ref={ref} footage={footage()} play={false} onReady={ready} />);
    expect(ref.current).toBeNull();
    await waitFor(() => expect(ref.current).toBeInstanceOf(HTMLVideoElement));
    expect(ref.current).toBe(video());
    expect(play).not.toHaveBeenCalled();
    fireEvent.loadedData(ref.current!);
    expect(ready).toHaveBeenCalledWith(ref.current);
    fireEvent.seeked(ref.current!);
    expect(root()).toHaveAttribute('data-shown', '');
  });
});
