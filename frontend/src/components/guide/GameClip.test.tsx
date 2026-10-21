import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import GuideClip from './GuideClip';
import { GUIDE_CLIPS, GUIDE_FOOTAGE } from './clips';
import { STAND_RUN } from '../../lib/footage';
import { TIP_CLIPS, TIP_FOOTAGE } from '../tips/scenes';
import TipClipFor from '../tips/TipClipFor';
import { TIPS } from '../tips/tips';
import { ENTRY } from '../live/host/copy';

/* The guide's «Игра в классе» clip, also the test page's first-use tip: real footage of the game on the projector (the
   owner, 21.10: «тут должен быть ролик прям когда игра идет … небольшой отрезок где бегают игроки»). */

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

const ok = () => ({ ok: true, status: 200, headers: new Headers({ 'content-type': 'application/octet-stream' }), blob: async () => new Blob(['x']) });
let fetchMock: Mock<(url: string) => Promise<unknown>>;
let play: Mock<() => Promise<void>>;
const ownCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');

const box = (cls: string) => document.querySelector(cls) as HTMLElement;
const video = () => document.querySelector('video');

beforeEach(() => {
  stubReducedMotion(false);
  fetchMock = vi.fn(async () => ok());
  vi.stubGlobal('fetch', fetchMock);
  play = vi.fn(() => Promise.resolve());
  vi.spyOn(HTMLMediaElement.prototype, 'play').mockImplementation(play);
  vi.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
  vi.spyOn(HTMLMediaElement.prototype, 'canPlayType').mockReturnValue('probably');
  Object.defineProperty(URL, 'createObjectURL', { configurable: true, writable: true, value: () => 'blob:stand-run' });
});
afterEach(() => {
  cleanup();
  if (ownCreate) Object.defineProperty(URL, 'createObjectURL', ownCreate);
  else delete (URL as { createObjectURL?: unknown }).createObjectURL;
  vi.unstubAllGlobals();
});

describe('the «Игра в классе» clip', () => {
  it('is the real game, not a drawn scene: the class running to the answers on the projector', () => {
    expect(GUIDE_FOOTAGE.game).toBe(STAND_RUN);
    expect('game' in GUIDE_CLIPS).toBe(false);
    expect(STAND_RUN.width / STAND_RUN.height).toBe(16 / 9);
  });

  it('shows the whole 16:9 frame in the 4:3 box, centred, the bars in the game’s own backdrop', async () => {
    render(<GuideClip chapter="game" active />);
    const clip = box('.gd-box');
    expect(clip).toHaveAttribute('data-footage', '');
    expect(clip.style.background).toContain('linear-gradient');
    expect(clip.querySelector('.gd-stage')).toBeNull();
    const footage = box('.gd-box .fo');
    expect(footage).toHaveAttribute('data-fit', 'contain');
    expect(footage).toHaveAttribute('aria-hidden', 'true');
    expect(footage.style.background).toBe(clip.style.background);
    expect(footage.querySelector('.fo-poster')).toHaveAttribute('src', STAND_RUN.poster);
    await waitFor(() => expect(video()).not.toBeNull());
    // The file's first player to load it: the parts are fetched once, for the rest of the page's life.
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(STAND_RUN.parts);
    await waitFor(() => expect(play).toHaveBeenCalled());
    expect(clip).toHaveAttribute('data-playing', 'true');
  });

  it('pauses and plays again from the round button', async () => {
    render(<GuideClip chapter="game" active />);
    await waitFor(() => expect(video()).not.toBeNull());
    const el = video()!;
    Object.defineProperty(el, 'paused', { configurable: true, value: false });
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    });
    expect(box('.gd-box')).toHaveAttribute('data-playing', 'false');
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalled();
    const before = play.mock.calls.length;
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Смотреть' }));
    });
    expect(box('.gd-box')).toHaveAttribute('data-playing', 'true');
    expect(play.mock.calls.length).toBe(before + 1);
  });

  it('with reduced motion waits on the poster, fetching nothing, until «Смотреть»', async () => {
    stubReducedMotion(true);
    render(<GuideClip chapter="game" active />);
    await act(async () => {});
    expect(box('.gd-box')).toHaveAttribute('data-playing', 'false');
    expect(box('.fo-poster')).toHaveAttribute('src', STAND_RUN.poster);
    expect(video()).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Смотреть' }));
    });
    expect(box('.gd-box')).toHaveAttribute('data-playing', 'true');
    await waitFor(() => expect(video()).not.toBeNull());
    await waitFor(() => expect(play).toHaveBeenCalled());
  });

  it('does not play while the guide is closed (inactive)', async () => {
    render(<GuideClip chapter="game" active={false} />);
    await waitFor(() => expect(video()).not.toBeNull());
    await act(async () => {});
    expect(play).not.toHaveBeenCalled();
    expect(box('.gd-box')).toHaveAttribute('data-playing', 'false');
  });
});

describe('the test page’s first-use tip «Игра в классе»', () => {
  it('plays the same footage in a frame of its own shape, 16:9, no bars', async () => {
    expect(TIP_FOOTAGE.game).toBe(GUIDE_FOOTAGE.game);
    expect('game' in TIP_CLIPS).toBe(false);
    expect(TIPS.game.clip).toEqual({ ratio: 16 / 9, themed: false });
    render(<TipClipFor id="game" active />);
    const clip = box('.tp-box');
    expect(clip).toHaveAttribute('data-footage', '');
    // The same shape as the card's frame before the clip's file arrives (TipCard, tips.ts `clip.ratio`).
    expect(clip).toHaveStyle({ aspectRatio: String(16 / 9) });
    expect(clip.querySelector('.fo-poster')).toHaveAttribute('src', STAND_RUN.poster);
    expect(clip.querySelector('.tp-stage')).toBeNull();
    await waitFor(() => expect(play).toHaveBeenCalled());
    expect(screen.getByRole('button', { name: 'Пауза' })).toHaveClass('tp-play');
  });

  it('with reduced motion waits on the poster until «Смотреть»', async () => {
    stubReducedMotion(true);
    render(<TipClipFor id="game" active />);
    await act(async () => {});
    expect(fetchMock).not.toHaveBeenCalled();
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Смотреть' }));
    });
    await waitFor(() => expect(play).toHaveBeenCalled());
  });

  it('says it in plain words, and its button is the page’s own', () => {
    expect(TIPS.game).toMatchObject({ title: 'Игра в классе', action: ENTRY.host, later: 'Не сейчас' });
    expect(TIPS.game.text).toBe('Вопросы теста идут на проекторе. Ученики играют с телефонов, на сайте или в Telegram.');
    expect(TIPS.game.text).not.toMatch(/\s—\s|:|!/);
  });
});
