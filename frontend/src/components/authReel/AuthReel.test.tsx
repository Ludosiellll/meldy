import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EYEBROW } from '../../pages/Landing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), signInWithOAuth: vi.fn(), signUp: vi.fn(), resend: vi.fn() } },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));

import AuthReel from './AuthReel';
import { READY_TAG } from './Ready';
import { LOGIN_SCRIPT, REGISTER_SCRIPT, cornerOpacity, leaveOf, sceneVisible, scenesAt, type AuthReelVariant, type AuthScript } from './script';
import { ANSWER_CHANGE, ERASE_AT, q7 } from './StoryScenes';
import { inkAt } from '../film/ink';
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
    expect(scenesAt(LOGIN_SCRIPT, 3100)).toEqual(['back', 'answers']);
    expect(sceneVisible(LOGIN_SCRIPT.scenes[1], 3100)).toBe(false);
    expect(scenesAt(LOGIN_SCRIPT, 17800)).toEqual(['back', 'ready']);
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

describe('the story the reels tell (Release 29)', () => {
  it.each([
    ['sign-in', LOGIN_SCRIPT, ['back', 'answers', 'ticket', 'erase', 'ready']],
    ['sign-up', REGISTER_SCRIPT, ['list', 'answers', 'ticket', 'erase', 'ready']],
  ] as const)('%s: the four steps, then the sheet after an answer, then the wordmark', (_, script, ids) => {
    expect(script.scenes.map((scene) => scene.id)).toEqual(ids);
    // Each screen leaves as its scene ends, while the next one comes in.
    for (const scene of script.scenes.slice(0, -1)) expect(leaveOf(script, scene.id)).toBe(scene.to - scene.from - 440);
  });

  it.each([
    ['sign-in', LOGIN_SCRIPT],
    ['sign-up', REGISTER_SCRIPT],
  ] as const)('%s: the still frame is the sheet just after the answer, the line named on two days gone', (_, script: AuthScript) => {
    const erase = script.scenes.find((scene) => scene.id === 'erase')!;
    expect(sceneVisible(erase, script.poster)).toBe(true);
    const local = script.poster - erase.from;
    expect(local).toBeLessThan(leaveOf(script, 'erase'));
    expect(q7(ERASE_AT).lines.map((line) => inkAt(line, local).state)).toEqual(['erased', 'rubbed', 'missed', 'rubbed']);
  });

  it('signs off with what Meldy is, in the landing\'s words', () => {
    expect(READY_TAG).toBe(EYEBROW);
  });

  it('says nothing of the old story: no summary, cards, tests, days of repetition, grades or «Засчитано»', () => {
    const old = /Конспект|Карточк|Тест\b|Выжимк|Разговор|Повторение по дням|Засчитано|Проверено|оценк|отличн|хорошо\b|План готов/i;
    for (const script of [LOGIN_SCRIPT, REGISTER_SCRIPT]) {
      expect(script.caption).not.toMatch(old);
      for (const line of script.transcript) expect(line).not.toMatch(old);
    }
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

  it.each([
    ['login', LOGIN_SCRIPT, ['Шпаргалка', 'месте.', 'Цель', 'шпаргалка']],
    ['register', REGISTER_SCRIPT, ['Список', 'кафедры.', 'Начните', 'списка']],
  ] as const)('%s: plays the four steps in the screens\' own words, and nothing of the old story', (variant, script, own) => {
    window.__MELDY_AUTH_REEL_EXPORT__ = true;
    try {
      const { container } = render(<AuthReel variant={variant as AuthReelVariant} />);
      const seen = new Set<string>();
      for (let t = 0; t < script.total; t += 250) {
        act(() => {
          void window.__meldyAuthReel!.seek(t);
        });
        seen.add(container.querySelector('.mr-stage')!.textContent ?? '');
      }
      const text = Array.from(seen).join(' ');
      for (const word of [...own, 'Ответы', 'лекций.', 'Билет', 'вслух.', 'Стирают', 'ответы.', 'Экзаменатор', 'Шпаргалка', READY_TAG]) expect(text).toContain(word);
      expect(text.replace(/\u00a0/g, ' ')).toContain(ANSWER_CHANGE.replace(/\u00a0/g, ' '));
      expect(text).not.toMatch(/Конспект|Карточк|Выжимк|Разговор|Повторение по дням|Засчитано|Проверено|Запустить анализ/);
    } finally {
      delete window.__MELDY_AUTH_REEL_EXPORT__;
    }
  });

  it('waits on a still frame with reduced motion until asked to play: the sheet, the answer said in its words', () => {
    const original = window.matchMedia;
    window.matchMedia = ((query: string) => ({
      matches: query.includes('reduce') || query.includes('min-width'),
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    })) as unknown as typeof window.matchMedia;
    try {
      const { container } = render(<AuthReel variant="login" />);
      const chip = container.querySelector('.ar-cap .ss-cap-t') as HTMLElement;
      expect(chip.textContent).toBe(ANSWER_CHANGE);
      expect(chip.style.opacity).toBe('1');
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
    expect(screen.getByRole('heading', { name: 'От списка кафедры до пустой шпаргалки.' })).toBeInTheDocument();
    expect(screen.getByText('Ролик: как работает Meldy, 18 секунд, без звука.')).toBeInTheDocument();
    cleanup();

    const { container } = renderAt('/register');
    expect(screen.getByRole('heading', { name: 'Вопросы кафедры, ответы из ваших лекций' })).toBeInTheDocument();
    expect(screen.getByText('Ролик: от списка вопросов до шпаргалки, 19 секунд, без звука.')).toBeInTheDocument();
    // The password and its repeat stand side by side.
    const pair = container.querySelector('.au-pair') as HTMLElement;
    expect(within(pair).getByLabelText('Пароль')).toBeInTheDocument();
    expect(within(pair).getByLabelText('Повтор пароля')).toBeInTheDocument();
  });
});
