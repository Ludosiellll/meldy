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
import { ANSWER_CHANGE, ORAL_CAPTION, ORAL_LINES } from './StoryScenes';
import { statesAt } from '../film/listLine';
import { EXAM_TITLE, IMPORT_WORDS, INVITE_WORDS, SESSION, START_LABEL, exampleWords } from '../../data/containerExample';
import Login, { LOGIN_LEDE, LOGIN_PANEL_TITLE } from '../../pages/Login';
import Register, { SIGN_UP_LEDE, SIGN_UP_PANEL_TITLE } from '../../pages/Register';

afterEach(cleanup);

/** Words of the old reels: the paper cheat sheet's story, the summary, cards and tests, grades and stamps. */
const OLD = /Конспект|Карточк|Тест\b|Выжимк|Разговор|Повторение по дням|Засчитано|Проверено|оценк|отличн|хорошо\b|План готов|Шпаргалка на месте|пустая шпаргалка|Стирают только|клетк|ластик|карандаш/i;

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
    expect(script.caption).toContain(`${Math.round(script.total / 1000)} секунд`);
  });

  it('mounts the next scene ahead, hidden, and the first one again before the loop wraps', () => {
    expect(scenesAt(LOGIN_SCRIPT, 3100)).toEqual(['today', 'session']);
    expect(sceneVisible(LOGIN_SCRIPT.scenes[1], 3100)).toBe(false);
    expect(scenesAt(LOGIN_SCRIPT, 18800)).toEqual(['today', 'ready']);
    expect(sceneVisible(LOGIN_SCRIPT.scenes[0], 18800)).toBe(false);
    expect(sceneVisible(LOGIN_SCRIPT.scenes[4], 18800)).toBe(true);
  });

  it('shows only a small «Meldy» in the corner, and hides it before the big wordmark comes', () => {
    expect(cornerOpacity(LOGIN_SCRIPT, 100)).toBe(0);
    expect(cornerOpacity(LOGIN_SCRIPT, 850)).toBeCloseTo(0.5);
    expect(cornerOpacity(LOGIN_SCRIPT, 9000)).toBe(1);
    for (const script of [LOGIN_SCRIPT, REGISTER_SCRIPT]) {
      const ready = script.scenes.find((scene) => scene.id === 'ready')!;
      // The wordmark slides in 1950 ms into the last beat (Ready.tsx).
      expect(cornerOpacity(script, ready.from + 1950)).toBe(0);
    }
  });
});

describe('the story the reels tell (the exam for the whole preparation)', () => {
  it.each([
    ['sign-in', LOGIN_SCRIPT, ['today', 'session', 'oral', 'group', 'ready']],
    ['sign-up', REGISTER_SCRIPT, ['file', 'plan', 'session', 'oral', 'ready']],
  ] as const)('%s: its beats, then the wordmark', (_, script, ids) => {
    expect(script.scenes.map((scene) => scene.id)).toEqual(ids);
    // Each screen leaves as its scene ends, while the next one comes in.
    for (const scene of script.scenes.slice(0, -1)) expect(leaveOf(script, scene.id)).toBe(scene.to - scene.from - 440);
  });

  it.each([
    ['sign-in', LOGIN_SCRIPT],
    ['sign-up', REGISTER_SCRIPT],
  ] as const)('%s: the still frame is the sheet just after the oral answer, the line named on two days struck off', (_, script: AuthScript) => {
    const oral = script.scenes.find((scene) => scene.id === 'oral')!;
    expect(sceneVisible(oral, script.poster)).toBe(true);
    const local = script.poster - oral.from;
    expect(local).toBeLessThan(leaveOf(script, 'oral'));
    expect(statesAt(ORAL_LINES, local)).toEqual(['erased', 'rubbed', 'missed', 'rubbed']);
    // What the answer did is on screen by then.
    expect(local).toBeGreaterThanOrEqual(ORAL_CAPTION[0].at + 320);
  });

  it('signs off with what Meldy is, in the landing\'s words', () => {
    expect(READY_TAG).toBe(EYEBROW);
  });

  it('says nothing of the old story: no paper sheet, summary, cards, tests, grades or stamps', () => {
    for (const script of [LOGIN_SCRIPT, REGISTER_SCRIPT]) {
      expect(script.caption).not.toMatch(OLD);
      for (const line of script.transcript) expect(line).not.toMatch(OLD);
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
    expect(screen.getByText('Ролик: как работает Meldy, 19 секунд, без звука.')).toBeInTheDocument();
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

  const words = exampleWords('2026-10-10');
  it.each([
    [
      'login',
      LOGIN_SCRIPT,
      ['960', 'вопросов.', 'Один', 'план.', 'Вся', 'группа', 'одной', 'ссылке.', 'Продолжите', 'места', EXAM_TITLE, words.flag, START_LABEL, INVITE_WORDS.title, INVITE_WORDS.lead],
    ],
    [
      'register',
      REGISTER_SCRIPT,
      ['Один', 'файл', '960', 'вопросов.', 'Каждый', 'день', 'понемногу.', 'Начните', 'списка', IMPORT_WORDS.title, IMPORT_WORDS.found, words.planTitle, words.days[0], words.days[2]],
    ],
  ] as const)('%s: plays its beats in the screens\' own words, and nothing of the old story', (variant, script, own) => {
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
      const text = Array.from(seen).join(' ').replace(/ /g, ' ');
      const plain = (value: string) => value.replace(/ /g, ' ');
      for (const word of [...own, 'Ошибка', 'вернётся', 'завтра.', 'Ответ', 'вслух', 'лекциям.', 'Шпаргалка', READY_TAG, SESSION.stem, SESSION.verdict, ANSWER_CHANGE]) {
        expect(text).toContain(plain(word));
      }
      expect(text).not.toMatch(OLD);
      expect(text).not.toMatch(/Запустить анализ/);
    } finally {
      delete window.__MELDY_AUTH_REEL_EXPORT__;
    }
  });

  it('draws the same frame for the same moment, whatever came before (the loop wrap included)', () => {
    window.__MELDY_AUTH_REEL_EXPORT__ = true;
    try {
      const { container } = render(<AuthReel variant="login" />);
      const stage = () => (container.querySelector('.mr-stage') as HTMLElement).innerHTML.replace(/style="([^"]*)"/g, (_, css: string) => `style="${css.split(';').map((part) => part.trim()).filter(Boolean).sort().join('; ')}"`);
      const seek = (t: number) =>
        act(() => {
          void window.__meldyAuthReel!.seek(t);
        });
      const oral = LOGIN_SCRIPT.scenes.find((scene) => scene.id === 'oral')!;
      const moments = [1200, 5200, oral.from + 2400, oral.from + 3600, 12500];
      const frames = moments.map((t) => {
        seek(t);
        return stage();
      });
      for (const [index, t] of moments.entries()) {
        seek(LOGIN_SCRIPT.total - 50);
        seek(t + 700);
        seek(t);
        expect(stage()).toBe(frames[index]);
      }
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
      const chip = container.querySelector('.ar-cap .sl-cap-t') as HTMLElement;
      expect(chip.textContent).toBe(ANSWER_CHANGE);
      expect(chip.style.opacity).toBe('1');
      // The sheet in Meldy's own look: the first line struck off, no paper.
      expect(container.querySelector('.ss, .ss-paper, .ar-paper')).toBeNull();
      expect((container.querySelector('.ar-sheet .sl-words') as HTMLElement).style.getPropertyValue('--sl-s')).toBe('1.000');
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

  it('shows the reel under the panel heading of both pages, both told as the exam is now', () => {
    const login = renderAt('/login');
    expect(screen.getByRole('heading', { name: LOGIN_PANEL_TITLE })).toBeInTheDocument();
    expect(LOGIN_PANEL_TITLE.replace(/\u00a0/g, ' ')).toBe('Сотни вопросов — один план на каждый день.');
    expect(screen.getByText(LOGIN_LEDE.replace(/\u00a0/g, ' '))).toBeInTheDocument();
    expect(screen.getByText('Ролик: как работает Meldy, 19 секунд, без звука.')).toBeInTheDocument();
    // The form's card no longer promises cheat sheets: the exams, the lectures, the answers.
    expect(login.container.querySelector('.au-card')?.textContent).not.toMatch(/шпаргалк/i);
    cleanup();

    const { container } = renderAt('/register');
    expect(screen.getByRole('heading', { name: SIGN_UP_PANEL_TITLE })).toBeInTheDocument();
    expect(SIGN_UP_PANEL_TITLE.replace(/\u00a0/g, ' ')).toBe('От файла с вопросами — до плана на каждый день');
    expect(screen.getByText(SIGN_UP_LEDE.replace(/\u00a0/g, ' '))).toBeInTheDocument();
    expect(screen.getByText('Ролик: от файла с вопросами до плана на каждый день, 19 секунд, без звука.')).toBeInTheDocument();
    // The password and its repeat stand side by side.
    const pair = container.querySelector('.au-pair') as HTMLElement;
    expect(within(pair).getByLabelText('Пароль')).toBeInTheDocument();
    expect(within(pair).getByLabelText('Повтор пароля')).toBeInTheDocument();
  });
});
