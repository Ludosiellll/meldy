import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProReel from './ProReel';
import { cornerOpacity, sceneVisible, scenesAt } from '../authReel/script';
import { AI_COSTS, FREE_DAILY_UNITS, PRO_DAILY_UNITS } from '../../lib/plans';
import {
  FREE_EMPTY_AT,
  FREE_LEFT,
  FREE_SPENDS,
  FREE_TIMES,
  LIST_CHECK_COST,
  PRO_LEFT,
  PRO_REEL,
  PRO_SPENDS,
  PRO_TIMES,
  chipText,
  freeDayKinds,
  freeMeterAt,
  proMeterAt,
  sceneOf,
} from './reelScript';
import { plural, proGainLine, proLede, unitsPerDay } from './planCopy';

describe('the PRO reel script', () => {
  it('is a 12–16 s loop whose four beats cover it, each entering before the previous one leaves', () => {
    const { scenes, total } = PRO_REEL;
    expect(total).toBeGreaterThanOrEqual(12000);
    expect(total).toBeLessThanOrEqual(16000);
    expect(scenes.map((scene) => scene.id)).toEqual(['intro', 'free', 'pro', 'end']);
    expect(scenes[0].from).toBe(0);
    expect(scenes[scenes.length - 1].to).toBe(total);
    for (let i = 1; i < scenes.length; i += 1) {
      expect(scenes[i].from).toBeGreaterThan(scenes[i - 1].from);
      expect(scenes[i].from).toBeLessThan(scenes[i - 1].to);
    }
    expect(PRO_REEL.transcript).toHaveLength(scenes.length);
    expect(PRO_REEL.caption).toBe('Ролик: что будет с PRO, 16 секунд, без звука.');
  });

  it('mounts the next beat ahead, hidden, and the first one again before the loop wraps', () => {
    const free = sceneOf('free');
    expect(scenesAt(PRO_REEL, free.from - 100)).toEqual(['intro', 'free']);
    expect(sceneVisible(free, free.from - 100)).toBe(false);
    expect(scenesAt(PRO_REEL, PRO_REEL.total - 100)).toEqual(['intro', 'end']);
    expect(sceneVisible(sceneOf('intro'), PRO_REEL.total - 100)).toBe(false);
  });

  it('shows only the small «Meldy» in the corner, and hides it for the big wordmark at the end', () => {
    expect(cornerOpacity(PRO_REEL, 100)).toBe(0);
    expect(cornerOpacity(PRO_REEL, sceneOf('pro').from)).toBe(1);
    expect(cornerOpacity(PRO_REEL, PRO_REEL.total - 500)).toBe(0);
  });

  it('waits on the PRO day under reduced motion: the meter full, the tickets waiting, nothing in flight', () => {
    const pro = sceneOf('pro');
    expect(sceneVisible(pro, PRO_REEL.poster)).toBe(true);
    const local = PRO_REEL.poster - pro.from;
    expect(local).toBeGreaterThanOrEqual(PRO_TIMES.fill + PRO_TIMES.fillFor);
    expect(local).toBeGreaterThan(PRO_TIMES.focus + 650);
    expect(proMeterAt(local)).toBe(PRO_DAILY_UNITS);
    expect(PRO_SPENDS.every((spend) => spend.at > local)).toBe(true);
  });
});

describe('the numbers of the reel come from lib/plans.ts', () => {
  it('the free day: lectures, then answers, each at its price, down to exactly nothing', () => {
    expect(freeDayKinds()).toEqual(['lecture', 'lecture', 'lecture', 'lecture', 'answer', 'answer', 'answer', 'answer', 'answer']);
    for (const spend of FREE_SPENDS) expect(spend.cost).toBe(AI_COSTS[spend.kind]);
    expect(FREE_SPENDS.map(chipText).slice(3, 5)).toEqual(['Лекция −20', 'Ответ −4']);
    expect(FREE_LEFT).toBe(0);
    expect(freeMeterAt(0)).toBe(FREE_DAILY_UNITS);
    expect(freeMeterAt(FREE_EMPTY_AT)).toBe(0);
    // The meter only goes down, one landing chip at a time.
    let last = FREE_DAILY_UNITS;
    for (let l = 0; l <= sceneOf('free').to - sceneOf('free').from; l += 20) {
      const now = freeMeterAt(l);
      expect(now).toBeLessThanOrEqual(last);
      last = now;
    }
    // «Дневной лимит исчерпан» comes after the meter is empty, and is on screen before the beat leaves.
    expect(FREE_EMPTY_AT).toBeLessThan(FREE_TIMES.limit);
    expect(FREE_TIMES.leave - FREE_TIMES.limit).toBeGreaterThanOrEqual(1000);
  });

  it('keeps the story for other prices: a day of answers only stops when the next one does not fit', () => {
    const kinds = freeDayKinds(30);
    const spent = kinds.reduce((sum, kind) => sum + AI_COSTS[kind], 0);
    expect(kinds.every((kind) => kind === 'answer')).toBe(true);
    expect(30 - spent).toBeLessThan(AI_COSTS.answer);
  });

  it('the PRO day: the meter fills to the PRO units and has most of them left at the end', () => {
    expect(proMeterAt(0)).toBe(0);
    expect(proMeterAt(PRO_TIMES.fill + PRO_TIMES.fillFor)).toBe(PRO_DAILY_UNITS);
    // A list of 100 questions is checked at 10 units per started 40: 30.
    expect(LIST_CHECK_COST).toBe(30);
    expect(PRO_SPENDS.map(chipText)).toEqual(['Ответ −4', 'Ответ −4', 'Ответ −4', 'Ответ −4', 'Сверка −30', 'Разговор −5']);
    expect(PRO_LEFT).toBe(PRO_DAILY_UNITS - 4 * AI_COSTS.answer - 30 - AI_COSTS.conversation);
    expect(proMeterAt(PRO_TIMES.leave)).toBe(PRO_LEFT);
    for (const spend of PRO_SPENDS) expect(spend.lands).toBeLessThan(PRO_TIMES.leave);
    expect(PRO_REEL.transcript[2]).toContain(`а на счётчике ещё ${PRO_LEFT}`);
  });
});

describe('the words about the plans', () => {
  it('are computed from the plan numbers', () => {
    expect(proGainLine()).toBe('До 1000 единиц ИИ в день вместо 100 — это примерно 250 проверок ответов или 50 лекций.');
    expect(proLede()).toBe('Тот же Meldy, только дневной лимит ИИ в 10 раз больше.');
    expect(unitsPerDay(FREE_DAILY_UNITS)).toBe('100 единиц ИИ в день');
    expect(unitsPerDay(44)).toBe('44 единицы ИИ в день');
    expect([1, 2, 5, 11, 21, 22, 25].map((n) => plural(n, ['лекция', 'лекции', 'лекций']))).toEqual([
      'лекция',
      'лекции',
      'лекций',
      'лекций',
      'лекция',
      'лекции',
      'лекций',
    ]);
  });
});

// ---------------------------------------------------------------------------------------------
// The player

type Callback = (entries: Array<{ isIntersecting: boolean; intersectionRatio: number }>) => void;
let observed: Callback[] = [];
let reduced = false;
let restoreWidth: () => void = () => undefined;

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

function onScreen(visible: boolean) {
  act(() => {
    for (const callback of observed) callback([{ isIntersecting: visible, intersectionRatio: visible ? 1 : 0 }]);
  });
}

beforeEach(() => {
  observed = [];
  reduced = false;
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: query.includes('reduce') ? reduced : false,
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  }));
  // The box the stage is scaled into: 656 px (jsdom lays nothing out).
  const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return this.classList?.contains('pr-box') ? 656 : 0;
    },
  });
  restoreWidth = () => {
    if (width) Object.defineProperty(HTMLElement.prototype, 'clientWidth', width);
  };
});

afterEach(() => {
  cleanup();
  restoreWidth();
  vi.unstubAllGlobals();
  delete window.__MELDY_PRO_REEL_EXPORT__;
});

const stage = (container: HTMLElement) => container.querySelector('.mr-stage') as HTMLElement;

/** The stage as a frame: its markup with each element's style declarations in a fixed order (the
 * order of an inline style only records which property was written first, not what is drawn). */
const frameOf = (container: HTMLElement) =>
  stage(container).innerHTML.replace(/style="([^"]*)"/g, (_, css: string) => {
    const declarations = css
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .sort();
    return `style="${declarations.join('; ')}"`;
  });

describe('ProReel', () => {
  it('is a captioned figure: the moving stage is hidden from screen readers, a transcript says what it shows', () => {
    const { container } = render(<ProReel />);
    expect(screen.getByRole('figure', { name: PRO_REEL.caption })).toBeInTheDocument();
    expect(stage(container)).toHaveAttribute('aria-hidden', 'true');
    expect(stage(container).style.transform).toBe(`scale(${656 / 1920})`);
    expect(Array.from(container.querySelectorAll('ol.sr-only li')).map((item) => item.textContent)).toEqual([...PRO_REEL.transcript]);
  });

  it('plays only while it is on screen, and can be paused', () => {
    render(<ProReel />);
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
    onScreen(true);
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
    onScreen(false);
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
    onScreen(true);
    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
  });

  it('with reduced motion waits on the still frame until asked to play', () => {
    reduced = true;
    const { container } = render(<ProReel />);
    onScreen(true);
    // The PRO day is on the stage, not the opening words.
    expect(stage(container).textContent).toContain('Билет 14');
    expect(stage(container).textContent).not.toContain('Сессия.');
    fireEvent.click(screen.getByRole('button', { name: /Смотреть ролик/ }));
    expect(screen.queryByRole('button', { name: /Смотреть ролик/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
  });

  it('draws the same frame for the same moment, whatever came before (the loop wrap included)', async () => {
    window.__MELDY_PRO_REEL_EXPORT__ = true;
    const first = render(<ProReel />);
    const seek = (t: number) =>
      act(async () => {
        await window.__meldyProReel!.seek(t);
      });
    const moments = [1500, 4300, 6400, sceneOf('pro').from + PRO_TIMES.tickets + 300, 11800, 14300];
    const frames: string[] = [];
    for (const t of moments) {
      await seek(t);
      frames.push(frameOf(first.container));
    }
    // The same moments again, reached from the end of the loop, from later and from earlier.
    for (const [index, t] of moments.entries()) {
      await seek(PRO_REEL.total - 50);
      await seek(t + 900);
      await seek(t);
      expect(frameOf(first.container)).toBe(frames[index]);
    }
    first.unmount();
    // And in a reel that never played before.
    const second = render(<ProReel />);
    for (const [index, t] of moments.entries()) {
      await seek(t);
      expect(frameOf(second.container)).toBe(frames[index]);
    }
    expect(screen.queryByRole('button', { name: 'Пауза' })).toBeNull();
  });

  it('goes to the PRO beat when the window says PRO was just bought (a new `jump`)', async () => {
    window.__MELDY_PRO_REEL_EXPORT__ = true;
    const { container, rerender } = render(<ProReel jump={0} />);
    await act(async () => {
      await window.__meldyProReel!.seek(1500);
    });
    const visible = () =>
      Array.from(stage(container).querySelectorAll<HTMLElement>('.mr-layer'))
        .filter((layer) => layer.style.visibility === 'visible')
        .map((layer) => layer.textContent ?? '')
        .join(' ');
    expect(visible()).toContain('Сессия.');
    // Waiting (not playing): the still frame of the PRO day.
    act(() => {
      rerender(<ProReel jump={1} />);
    });
    expect(visible()).not.toContain('Сессия.');
    expect(visible()).toContain('Билет 12');
    // The same jump again changes nothing.
    await act(async () => {
      await window.__meldyProReel!.seek(1500);
    });
    act(() => {
      rerender(<ProReel jump={1} />);
    });
    expect(visible()).toContain('Сессия.');
  });

  it('shows the numbers of the plans on the stage', async () => {
    window.__MELDY_PRO_REEL_EXPORT__ = true;
    const { container } = render(<ProReel />);
    const seek = (t: number) =>
      act(async () => {
        await window.__meldyProReel!.seek(t);
      });
    const free = sceneOf('free').from;
    await seek(free + FREE_TIMES.limit + 800);
    const visible = () =>
      Array.from(stage(container).querySelectorAll<HTMLElement>('.mr-layer'))
        .filter((layer) => layer.style.visibility === 'visible')
        .map((layer) => layer.textContent ?? '')
        .join(' ');
    expect(visible()).toContain('Дневной лимит исчерпан');
    expect(visible()).toContain(`Осталось 0 из ${FREE_DAILY_UNITS} единиц`);
    expect((stage(container).querySelector('.mr-layer[style*="visible"] [data-a="num"]') as HTMLElement).textContent).toBe('0');
    await seek(sceneOf('pro').from + PRO_TIMES.leave);
    const nums = Array.from(stage(container).querySelectorAll<HTMLElement>('[data-a="num"]')).map((num) => num.textContent);
    expect(nums).toContain(String(PRO_LEFT));
    expect(visible()).toContain('Сверка −30');
  });
});
