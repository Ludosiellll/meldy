import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import TipClip from './TipClip';
import { TIP_CLIPS } from './scenes';

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

beforeEach(() => {
  // jsdom lays nothing out: the box is 400 px wide here.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(400);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('TipClip', () => {
  it('plays the talk clip on its 16:10 stage, scaled to the box, the room in its own words', () => {
    stubReducedMotion(false);
    render(<TipClip clip={TIP_CLIPS.talk} active />);
    const stage = document.querySelector('.tp-stage') as HTMLElement;
    expect(stage).toHaveAttribute('aria-hidden', 'true');
    expect(stage.style.transform).toBe('scale(0.3125)');
    expect(stage.textContent).toContain('Чем исчерпаемые ресурсы отличаются от возобновляемых?');
    expect(stage.textContent).toContain('Ваш ответ');
    expect(stage.textContent).toContain('Вот как сказано в лекции. Скажите своими словами.');
    expect(stage.textContent).toContain('Из лекции, фрагмент 3');
    expect(document.querySelector('.tp-box')).toHaveAttribute('data-playing', 'true');
    fireEvent.click(screen.getByRole('button', { name: 'Пауза' }));
    expect(document.querySelector('.tp-box')).toHaveAttribute('data-playing', 'false');
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
  });

  it('with reduced motion waits on the still frame until «Смотреть»', () => {
    stubReducedMotion(true);
    render(<TipClip clip={TIP_CLIPS.talk} active />);
    expect(document.querySelector('.tp-box')).toHaveAttribute('data-playing', 'false');
    // The poster: the reply and the lecture's words are on the desk.
    const reply = Array.from(document.querySelectorAll<HTMLElement>('[data-a="reply"]'))[0];
    expect(reply.style.opacity).toBe('1');
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Смотреть' }));
    });
    expect(document.querySelector('.tp-box')).toHaveAttribute('data-playing', 'true');
  });

  it('does not play while the tip is not shown', () => {
    stubReducedMotion(false);
    render(<TipClip clip={TIP_CLIPS.talk} active={false} />);
    expect(document.querySelector('.tp-box')).toHaveAttribute('data-playing', 'false');
  });

  it('starts and ends on empty paper, so the loop is seamless', () => {
    stubReducedMotion(false);
    window.__MELDY_TIP_EXPORT__ = true;
    try {
      render(<TipClip clip={TIP_CLIPS.talk} active />);
      const { total, poster } = TIP_CLIPS.talk;
      const ui = document.querySelector('[data-a="ui"]') as HTMLElement;
      const say = document.querySelector('.fm-say') as HTMLElement;
      void window.__meldyTipClip?.seek(0);
      expect(ui.style.opacity).toBe('0');
      void window.__meldyTipClip?.seek(poster);
      expect(ui.style.opacity).toBe('1');
      expect(say.style.opacity).toBe('0');
      void window.__meldyTipClip?.seek(total - 40);
      expect(ui.style.opacity).toBe('0');
      expect(say.style.opacity).toBe('0');
    } finally {
      delete window.__MELDY_TIP_EXPORT__;
    }
  });
});
