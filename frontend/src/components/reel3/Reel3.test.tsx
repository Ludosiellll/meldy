import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Reel3, { CAPTION, POINTER_KEYS3, TRANSCRIPT3 } from './Reel3';
import { GAME, SAY } from '../home3/copy3';
import { GAME_FRAMES } from '../home3/gameFrames';
import { FOOTAGE_FROM, footageAt, timerAt } from './scenes/Game';
import { STAND_RUN } from '../../lib/footage';
import { CHAPTERS3, scene3 } from './timeline3';

type Callback = (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void;
let observed: Callback[] = [];
let narrow = false;
let reduced = false;

class FakeIntersectionObserver {
  constructor(callback: Callback) {
    observed.push(callback);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
  takeRecords() {
    return [];
  }
}

class FakeResizeObserver {
  observe() {}
  disconnect() {}
  unobserve() {}
}

beforeEach(() => {
  observed = [];
  narrow = false;
  reduced = false;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') ? reduced : query.includes('max-width') ? narrow : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.__MELDY_REEL_EXPORT__;
  delete (HTMLElement.prototype as { clientWidth?: number }).clientWidth;
});

describe('Reel3', () => {
  it('is a captioned figure: the stage is hidden from screen readers, the transcript says every sentence', () => {
    const { container } = render(<Reel3 />);
    expect(CAPTION).toBe('Ролик о Meldy, 83 секунды, без звука.');
    expect(screen.getByRole('figure', { name: CAPTION })).toBeInTheDocument();
    expect(container.querySelector('.r3-stage')).toHaveAttribute('aria-hidden', 'true');
    expect(TRANSCRIPT3).toEqual(Object.values(SAY).flatMap((lines) => lines.map((line) => `${line}.`)));
    expect(container.querySelectorAll('ol.r3-sr li')).toHaveLength(TRANSCRIPT3.length);
  });

  it('uses the tall stage on a phone-wide window and the wide one otherwise', () => {
    const { container, unmount } = render(<Reel3 />);
    expect(container.querySelector('.r3-frame')).toHaveAttribute('data-layout', 'wide');
    unmount();
    narrow = true;
    const again = render(<Reel3 />);
    expect(again.container.querySelector('.r3-frame')).toHaveAttribute('data-layout', 'tall');
  });

  it('draws every scene at its time (the frame exporter steps the clock)', async () => {
    window.__MELDY_REEL_EXPORT__ = true;
    const { container } = render(<Reel3 />);
    for (const id of ['lecture', 'file', 'plan', 'session', 'ticket', 'learn', 'group', 'game', 'build', 'media', 'look', 'send', 'take', 'stats'] as const) {
      const window3 = scene3(id);
      await act(async () => {
        await window.__meldyReel!.seek(Math.round((window3.from + window3.to) / 2));
      });
      const words = (container.querySelector('.r3-stage')?.textContent ?? '').replace(/\s+/g, ' ');
      expect(words, id).toContain(SAY[id][0].split(' ')[0]);
    }
  });

  it('aims every key of every pointer at one element of its own scene (the places come from the page, not numbers)', async () => {
    window.__MELDY_REEL_EXPORT__ = true;
    const { container } = render(<Reel3 />);
    const scenes = Object.entries(POINTER_KEYS3);
    expect(scenes.map(([id]) => id)).toEqual(['file', 'plan', 'session', 'learn', 'group', 'game', 'build', 'media', 'look', 'send', 'take']);
    for (const [id, keys] of scenes) {
      const window3 = scene3(id as keyof typeof POINTER_KEYS3);
      await act(async () => {
        await window.__meldyReel!.seek(Math.round((window3.from + window3.to) / 2));
      });
      const gate = container.querySelector(`.r3-gate[data-scene="${id}"]`)!;
      expect(gate.querySelectorAll('.r3-cursor'), id).toHaveLength(1);
      for (const key of keys!) {
        // A key without a target is a place to rest or the pointer going away, never a press or a drag.
        if (!key.aim) {
          expect(key.press || key.down || key.up, `${id} @${key.t}`).toBeFalsy();
          continue;
        }
        for (const aim of [key.aim, key.over].filter(Boolean)) expect(gate.querySelectorAll(`[data-aim="${aim}"]`), `${id} ${aim}`).toHaveLength(1);
      }
      // The keys keep their time order.
      for (let i = 1; i < keys!.length; i += 1) expect(keys![i].t, id).toBeGreaterThanOrEqual(keys![i - 1].t);
    }
  });

  it('lists the nine chapters under the frame and jumps to one', () => {
    const { container } = render(<Reel3 />);
    const buttons = screen.getAllByRole('button', { name: /^Перейти:/ });
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(CHAPTERS3.map((chapter) => `Перейти: ${chapter.label}`));
    expect(buttons).toHaveLength(9);
    fireEvent.click(buttons[8]);
    expect(container.querySelector('[aria-current="step"]')).toHaveAttribute('aria-label', 'Перейти: Конструктор');
  });

  it('waits on its poster under reduced motion until asked', () => {
    reduced = true;
    render(<Reel3 />);
    act(() => {
      for (const callback of observed) callback([{ isIntersecting: true, intersectionRatio: 1 }]);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Смотреть ролик' }));
    expect(screen.queryByRole('button', { name: 'Смотреть ролик' })).toBeNull();
  });

  it('shows the game in class after the group: the real game on the projector, the phone in Telegram', async () => {
    window.__MELDY_REEL_EXPORT__ = true;
    const { container } = render(<Reel3 />);
    const game = scene3('game');
    expect(game.from).toBe(scene3('group').to - 400);
    await act(async () => {
      await window.__meldyReel!.seek(game.from + 1000);
    });
    const gate = container.querySelector('.r3-gate[data-scene="game"]')!;
    // The projector's pictures are frames of the recorded game, each its own file.
    const shots = Array.from(gate.querySelectorAll<HTMLImageElement>('.r3-proj img'));
    expect(shots.map((img) => img.getAttribute('src'))).toEqual(['run', 'last', 'stomp', 'drop'].map((name) => GAME_FRAMES[name as keyof typeof GAME_FRAMES]));
    for (const img of shots) expect(img).toHaveAttribute('alt', '');
    const words = (gate.textContent ?? '').replace(/\s+/g, ' ');
    for (const part of [GAME.mode, GAME.play, GAME.question, GAME.onAnswer, GAME.right, GAME.points]) expect(words).toContain(part);
    expect(words).toContain('Заходите по PIN');
    expect(CHAPTERS3.find((chapter) => chapter.id === 'game')).toMatchObject({ label: 'Игра в классе', from: game.from, to: scene3('build').from });
  });

  it('plays the recorded game on the projector at 1× from 3.8 s, and the phone’s timer reads the game’s', () => {
    expect(footageAt(0)).toBe(FOOTAGE_FROM);
    // Before the scene and after it the footage waits on one frame (no seeking while hidden).
    expect(footageAt(-800)).toBe(FOOTAGE_FROM);
    expect(footageAt(1000)).toBeCloseTo(FOOTAGE_FROM + 1, 5);
    expect(footageAt(60000)).toBeLessThan(STAND_RUN.duration);
    // The cut to the last second is the scene's own moment (2.8 s in): 6.6 s of the recording.
    expect(footageAt(2800)).toBeCloseTo(6.6, 5);
    expect([3.9, 4.6, 5.6, 6.4, 6.8, 7.4].map(timerAt)).toEqual([15, 14, 13, 12, 1, 0]);
    // No footage in a browser that cannot play it (jsdom): the stills are the picture.
  });
});
