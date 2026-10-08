import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { RecognitionResultEvent } from '../hooks/useSpeechAnswer';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  playTTS: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, session: null, loading: false, signOut: vi.fn() }) }));
vi.mock('../utils/tts', () => ({
  playTTS: mocks.playTTS,
  stopTTS: vi.fn(),
  isTTSUnavailable: (error: unknown) => error instanceof Error && error.name === 'TTSUnavailableError',
}));

import Check from './Check';

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((event: RecognitionResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  running = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.running = true;
  }
  stop() {
    queueMicrotask(() => {
      this.running = false;
      this.onend?.();
    });
  }
  abort() {
    this.running = false;
  }
  say(text: string) {
    const list = [{ isFinal: true, length: 1, 0: { transcript: text } }];
    this.onresult?.({ resultIndex: 0, results: Object.assign(list, { length: 1 }) });
  }
}

type Answer = { status: number; body?: unknown } | 'network';
let answers: Record<string, Answer>;
let fetchSpy: ReturnType<typeof vi.fn>;

function routeOf(url: string): string {
  if (url.startsWith('/?check=')) return 'site';
  if (url === '/api/health') return 'health';
  if (url === '/api/health/deep') return 'deep';
  if (url.endsWith('/auth/v1/health')) return 'supabase';
  return url;
}

beforeEach(() => {
  mocks.user = null;
  mocks.playTTS.mockReset();
  FakeRecognition.instances = [];
  answers = {
    site: { status: 200, body: '<!doctype html>' },
    health: { status: 200, body: { status: 'ok', groq_configured: true, gemini_configured: true } },
    supabase: { status: 200, body: { name: 'GoTrue' } },
  };
  fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const answer = answers[routeOf(url)];
    if (!answer || answer === 'network') throw new TypeError('Failed to fetch');
    const text = typeof answer.body === 'string' ? answer.body : JSON.stringify(answer.body ?? {});
    void init;
    return new Response(text, { status: answer.status, headers: { 'content-type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchSpy);
  // A browser that can record (the recorder itself is not started in these tests).
  vi.stubGlobal('MediaRecorder', class {});
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn() } });
  (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
  Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: undefined });
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/check']}>
      <Check />
    </MemoryRouter>,
  );
}

const card = (id: string) => document.querySelector(`[data-check="${id}"]`) as HTMLElement;

describe('/check', () => {
  it('checks the site, the server and Supabase at once and says what is left', async () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Проверка перед показом' })).toBeInTheDocument();
    expect(await screen.findByText(/^Сайт отвечает за/)).toBeInTheDocument();
    expect(await screen.findByText(/Ключи ИИ заданы: Gemini и Groq/)).toBeInTheDocument();
    expect(await screen.findByText(/^Supabase доступен из этой сети/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Пока всё в порядке' })).toBeInTheDocument();
    expect(screen.getByText('Осталось проверить: ИИ, микрофон и распознавание в браузере.')).toBeInTheDocument();
    // Signed out: server recognition and the voice wait for an account, with the way to sign in.
    for (const id of ['stt', 'voice']) {
      expect(card(id)).toHaveAttribute('data-state', 'skip');
      expect(within(card(id)).getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/login');
    }
    expect(within(card('voice')).getByText(/В примере \/try голоса нет/)).toBeInTheDocument();
    const urls = fetchSpy.mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.endsWith('/auth/v1/health'))).toBe(true);
    const supabaseCall = fetchSpy.mock.calls.find(([url]) => String(url).endsWith('/auth/v1/health'));
    expect(new Headers((supabaseCall?.[1] as RequestInit).headers).get('apikey')).toBeTruthy();
    expect(urls).not.toContain('/api/health/deep'); // the AI is checked only by its button
  });

  it('names its tab, and no longer calls the example «без ИИ»: its answers are checked by the AI, key words without it (audit PUB-27)', async () => {
    renderPage();
    expect(document.title).toBe('Проверка перед показом — Meldy');
    const foot = document.querySelector('.ck-foot') as HTMLElement;
    expect(foot.textContent).not.toMatch(/без ИИ/);
    expect(foot.textContent?.replace(/\s+/g, ' ')).toContain('Пример экзамена без входа — /try: ответы там проверяет ИИ, а если он не отвечает — ключевые слова.');
    expect(within(foot).getByRole('link', { name: '/try' })).toHaveAttribute('href', '/try');
    await screen.findByText(/^Сайт отвечает за/);
  });

  it('a network that blocks supabase.co is the first problem named, with the phone as the fix', async () => {
    answers.supabase = 'network';
    renderPage();
    expect(await screen.findByRole('heading', { level: 2, name: 'Есть проблемы: Supabase' })).toBeInTheDocument();
    expect(within(card('supabase')).getByText(/раздайте интернет с телефона/i)).toBeInTheDocument();
  });

  it('«Проверить ИИ» shows which model answered for each service', async () => {
    answers.deep = {
      status: 200,
      body: {
        ok: true,
        checked_at: '2026-10-05T10:00:00Z',
        cached: true,
        age_seconds: 130,
        fresh_in_seconds: 470,
        checks: {
          gemini: { ok: true, provider: 'Gemini', model: 'model-a', ms: 700, code: null, fallback: false },
          groq: { ok: true, provider: 'Groq', model: 'groq-fast', ms: 300, code: null },
          tts: { ok: true, provider: 'edge-tts', model: 'voice', ms: 900, code: null },
          supabase: { ok: true, provider: 'Supabase', model: null, ms: 80, code: null },
        },
      },
    };
    renderPage();
    await screen.findByText(/^Сайт отвечает за/);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ИИ' }));
    expect(await within(card('ai')).findByText('Gemini отвечает: model-a, 700 мс.')).toBeInTheDocument();
    expect(within(card('ai')).getByText('Groq отвечает: groq-fast, 300 мс.')).toBeInTheDocument();
    expect(within(card('ai')).getByText(/^Проверено 2 мин назад\./)).toBeInTheDocument();
    expect(card('ai')).toHaveAttribute('data-state', 'ok');
  });

  it('the browser speech test listens for 5 seconds and shows the words it heard', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderPage();
    await screen.findByText(/^Сайт отвечает за/);
    fireEvent.click(within(card('speech')).getByRole('button', { name: 'Скажите фразу' }));
    expect(card('speech')).toHaveAttribute('data-state', 'running');
    act(() => FakeRecognition.instances[0].say('спрос зависит от цены'));
    expect(within(card('speech')).getByText('спрос зависит от цены')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5200);
    });
    expect(await within(card('speech')).findByText('Браузер распознал: «спрос зависит от цены».')).toBeInTheDocument();
    expect(card('speech')).toHaveAttribute('data-state', 'ok');
  });

  it('signed in, the voice plays a line with no browser stand-in and asks if it was heard', async () => {
    mocks.user = { id: 'u1' };
    mocks.playTTS.mockImplementation(async (_text: string, _role: string, onEnd: () => void, _onError: unknown, onStart: () => void, options: unknown) => {
      expect(options).toEqual({ fallback: 'none' });
      onStart();
      onEnd();
    });
    renderPage();
    await screen.findByText(/^Сайт отвечает за/);
    fireEvent.click(within(card('voice')).getByRole('button', { name: 'Проиграть фразу' }));
    expect(await within(card('voice')).findByText('Фраза прозвучала до конца.')).toBeInTheDocument();
    fireEvent.click(within(card('voice')).getByRole('button', { name: 'Не слышно' }));
    expect(card('voice')).toHaveAttribute('data-state', 'fail');
    expect(within(card('voice')).getByText(/HDMI проектора/)).toBeInTheDocument();
  });
});
