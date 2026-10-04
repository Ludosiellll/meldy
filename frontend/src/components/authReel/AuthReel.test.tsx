import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), signInWithOAuth: vi.fn(), signUp: vi.fn(), resend: vi.fn() } },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));

import AuthReel from './AuthReel';
import { LOGIN_SCRIPT, REGISTER_SCRIPT, cornerOpacity, sceneVisible, scenesAt } from './script';
import Login from '../../pages/Login';
import Register from '../../pages/Register';

afterEach(cleanup);

describe('the sign-in reel scripts', () => {
  it.each([
    ['sign-in', LOGIN_SCRIPT],
    ['sign-up', REGISTER_SCRIPT],
  ])('%s: the scenes cover the loop, each entering before the previous one leaves', (_, script) => {
    expect(script.scenes[0].from).toBe(0);
    expect(script.scenes[script.scenes.length - 1].to).toBe(script.total);
    for (let i = 1; i < script.scenes.length; i += 1) {
      expect(script.scenes[i].from).toBeLessThan(script.scenes[i - 1].to);
      expect(script.scenes[i].from).toBeGreaterThan(script.scenes[i - 1].from);
    }
    expect(script.transcript).toHaveLength(script.scenes.length);
    expect(script.poster).toBeGreaterThan(0);
    expect(script.poster).toBeLessThan(script.total);
  });

  it('mounts the next scene ahead, hidden, and the first one again before the loop wraps', () => {
    expect(scenesAt(LOGIN_SCRIPT, 3100)).toEqual(['source', 'summary']);
    expect(sceneVisible(LOGIN_SCRIPT.scenes[1], 3100)).toBe(false);
    expect(scenesAt(LOGIN_SCRIPT, 17800)).toEqual(['source', 'ready']);
    expect(sceneVisible(LOGIN_SCRIPT.scenes[0], 17800)).toBe(false);
    expect(sceneVisible(LOGIN_SCRIPT.scenes[4], 17800)).toBe(true);
  });

  it('shows only a small «Meldy» in the corner, and hides it while the big wordmark is on', () => {
    expect(cornerOpacity(LOGIN_SCRIPT, 100)).toBe(0);
    expect(cornerOpacity(LOGIN_SCRIPT, 850)).toBeCloseTo(0.5);
    expect(cornerOpacity(LOGIN_SCRIPT, 9000)).toBe(1);
    expect(cornerOpacity(LOGIN_SCRIPT, 16000)).toBe(0);
    expect(cornerOpacity(REGISTER_SCRIPT, 17000)).toBe(0);
  });
});

describe('the reel in the panel', () => {
  let restore: Array<() => void> = [];
  beforeEach(() => {
    // The box the frame fits into: 640 × 400 px (jsdom lays nothing out).
    const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
    const height = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
    Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get() { return this.classList?.contains('ar-box') ? 640 : 0; } });
    Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get() { return this.classList?.contains('ar-box') ? 400 : 0; } });
    restore = [
      () => width && Object.defineProperty(HTMLElement.prototype, 'clientWidth', width),
      () => height && Object.defineProperty(HTMLElement.prototype, 'clientHeight', height),
    ];
  });
  afterEach(() => restore.forEach((undo) => undo()));

  it('tells screen readers what it shows and fits a 16:9 frame into the room', () => {
    const { container } = render(<AuthReel variant="login" />);
    expect(screen.getByText('Ролик: как работает Meldy, 18 секунд, без звука.')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([...LOGIN_SCRIPT.transcript]);
    const frame = container.querySelector('.ar-frame') as HTMLElement;
    expect(frame.style.width).toBe('640px');
    expect(frame.style.height).toBe('360px');
    expect(container.querySelector('.mr-stage')).toHaveAttribute('aria-hidden', 'true');
  });

  it('plays at once and can be paused', () => {
    render(<AuthReel variant="register" />);
    const button = screen.getByRole('button', { name: 'Пауза' });
    act(() => {
      fireEvent.click(button);
    });
    expect(screen.getByRole('button', { name: 'Смотреть' })).toBeInTheDocument();
  });

  it('waits on a still frame with reduced motion until asked to play', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('reduce') || query.includes('min-width'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      render(<AuthReel variant="login" />);
      act(() => {
        fireEvent.click(screen.getByRole('button', { name: /Смотреть ролик/ }));
      });
      expect(screen.getByRole('button', { name: 'Пауза' })).toBeInTheDocument();
    } finally {
      window.matchMedia = original;
    }
  });

  it('is not rendered where the panel is a banner', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({ matches: false, media: query, addEventListener: () => {}, removeEventListener: () => {} })) as unknown as typeof window.matchMedia;
    try {
      const { container } = render(<AuthReel variant="login" />);
      expect(container.querySelector('.ar')).toBeNull();
    } finally {
      window.matchMedia = original;
    }
  });
});

describe('the sign-in pages', () => {
  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<p>Восстановление пароля</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('puts «Забыли пароль?» on the row of the password label and keeps it working', () => {
    const { container } = renderAt('/login');
    const row = container.querySelector('.au-label-row') as HTMLElement;
    expect(within(row).getByText('Пароль')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Забыли пароль?' }));
    expect(screen.getByText('Восстановление пароля')).toBeInTheDocument();
  });

  it('shows the reel under the panel heading of both pages', () => {
    renderAt('/login');
    expect(screen.getByRole('heading', { name: 'От источника до уверенного ответа.' })).toBeInTheDocument();
    expect(screen.getByText('Ролик: как работает Meldy, 18 секунд, без звука.')).toBeInTheDocument();
    cleanup();

    const { container } = renderAt('/register');
    expect(screen.getByText('Ролик: материал становится планом подготовки, 19 секунд, без звука.')).toBeInTheDocument();
    // The password and its repeat stand side by side.
    const pair = container.querySelector('.au-pair') as HTMLElement;
    expect(within(pair).getByLabelText('Пароль')).toBeInTheDocument();
    expect(within(pair).getByLabelText('Повтор пароля')).toBeInTheDocument();
  });
});
