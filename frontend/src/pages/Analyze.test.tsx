import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { MotionGlobalConfig } from 'framer-motion';
import type { ReactNode } from 'react';

/* ── Supabase, вход, лимит, повторение и журнал активности — в памяти ─────── */

const s = vi.hoisted(() => ({
  session: { access_token: 'tok' } as null | { access_token: string },
  inserts: [] as Array<Record<string, unknown>>,
  insertErrors: 0,
  updates: [] as Array<Record<string, unknown>>,
  /** id строки materials для каждой записи из updates. */
  updateIds: [] as unknown[],
  quizProps: null as null | Record<string, unknown>,
  materialRow: {} as Record<string, unknown>,
  demoRows: [] as Array<{ id: string }>,
  demoLookups: [] as Array<Array<[string, unknown]>>,
  increment: vi.fn(),
  sync: vi.fn(),
  activity: vi.fn(),
  verify: vi.fn(),
  checkLimit: vi.fn(),
  realEnergyHook: false,
  /** Слово, на котором «срабатывает» проверка текста (только для текста лекции, не для имени файла). */
  badWord: null as null | string,
}));

const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

vi.mock('../lib/supabase', () => ({
  supabase: {
    auth: { getSession: async () => ({ data: { session: s.session } }) },
    from: () => ({
      select: () => {
        const filters: Array<[string, unknown]> = [];
        const chain = {
          eq(column: string, value: unknown) {
            filters.push([column, value]);
            return chain;
          },
          limit: async () => {
            s.demoLookups.push([...filters]);
            return { data: clone(s.demoRows), error: null };
          },
          single: async () => ({ data: clone(s.materialRow), error: null }),
        };
        return chain;
      },
      insert: (row: Record<string, unknown>) => ({
        select: () => ({
          single: async () => {
            if (s.insertErrors > 0) {
              s.insertErrors -= 1;
              return { data: null, error: { message: 'insert failed' } };
            }
            s.inserts.push(clone(row));
            const id = `mat-${s.inserts.length}`;
            s.materialRow = { ...clone(row), id };
            return { data: { id }, error: null };
          },
        }),
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: (_column: string, id: unknown) => ({
          select: async () => {
            s.updates.push(clone(payload));
            s.updateIds.push(id);
            Object.assign(s.materialRow, clone(payload));
            return { data: [{ id }], error: null };
          },
        }),
      }),
    }),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../hooks/useEnergyConfirm', async importOriginal => {
  const actual = await importOriginal<typeof import('../hooks/useEnergyConfirm')>();
  return {
    useEnergyConfirm: () => (s.realEnergyHook ? actual.useEnergyConfirm() : { verifyEnergy: (...args: unknown[]) => s.verify(...args) }),
  };
});
vi.mock('../api/limits', () => ({
  FREE_DAILY_LIMIT: 100,
  AI_USAGE_EVENT: 'ai_usage_updated',
  checkAILimit: (...args: unknown[]) => s.checkLimit(...args),
  incrementAIUsage: (...args: unknown[]) => s.increment(...args),
  nextLimitReset: () => new Date('2026-10-04T00:00:00Z'),
  formatLimitReset: () => '03:00',
}));
vi.mock('../api/flashcards', () => ({ syncFlashcards: (...args: unknown[]) => s.sync(...args) }));
vi.mock('../api/quests', () => ({ recordStudyActivity: (...args: unknown[]) => s.activity(...args) }));
vi.mock('../utils/moderation', () => ({ hasBadWords: (text: string) => (s.badWord ? text.includes(s.badWord) : false) }));
vi.mock('../components/QuizView', () => ({
  default: (props: Record<string, unknown>) => {
    s.quizProps = props;
    return <div>Тест на экране</div>;
  },
}));
vi.mock('react-hot-toast', () => ({ default: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }) }));

import Analyze from './Analyze';
import { ANALYZE_TIMEOUTS } from '../api/analyzeStream';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import { DEMO_TEXT } from '../data/demo';

/* ── Поток SSE ─────────────────────────────────────────────────────────────── */

const enc = new TextEncoder();
const ev = (data: unknown) => `data: ${JSON.stringify(data)}\n\n`;
type End = 'close' | 'error' | 'hang';

function sse(chunks: string[], end: End = 'close', delayMs = 3) {
  let index = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise(resolve => setTimeout(resolve, delayMs));
      if (index < chunks.length) {
        controller.enqueue(enc.encode(chunks[index++]));
        return;
      }
      if (end === 'close') controller.close();
      else if (end === 'error') controller.error(new TypeError('network error'));
      else await new Promise(() => undefined);
    },
  });
  return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const summary = { title: 'Энтропия', subject: 'Физика', content: 'Энтропия — мера беспорядка системы.', terms: [], source_ids: ['S01'] };
const cards = { flashcards: [{ id: 1, question: 'Что такое энтропия?', answer: 'Мера беспорядка', source_ids: ['S01'] }] };
const quiz = { quiz: [{ id: 1, question: 'Растёт ли энтропия?', options: ['A) Да', 'B) Нет'], correct: 'A', explanation: '', source_ids: [] }] };
const TEXT = { type: 'text_extracted', length: 36, text: 'Энтропия — мера беспорядка системы.' };
const GROUNDING = { type: 'grounding', source_count: 1, sources: [{ id: 'S01', text: 'Энтропия — мера беспорядка системы.' }] };
const start = (agent: string) => ({ type: 'agent_start', agent, label: agent });
const DONE_SUMMARY = { type: 'agent_done', agent: 'summarizer', label: 'Конспект', progress: 1, total: 3, status: 'ok', result: summary };
const okSections = { summarizer: { status: 'ok' }, flashcards: { status: 'ok' }, quiz: { status: 'ok' } };
const RESULTS = {
  type: 'results',
  summarizer: summary,
  flashcards: cards,
  quiz,
  cheatsheet: { content: '' },
  podcast: { podcast: [] },
  missions: { missions: [] },
  warnings: [],
  sections: okSections,
  grounding: { source_count: 1, citable_items: 2, sources: GROUNDING.sources },
};
const fullRun = () => sse([ev(TEXT), ev(GROUNDING), ev(start('summarizer')), ev(DONE_SUMMARY), ev(RESULTS), ev({ type: 'done' })]);

const NGINX_502 =
  '<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n';

interface Call {
  url: string;
  init?: RequestInit;
}
let calls: Call[] = [];
let streams: Array<() => Response> = [];
let sectionResponse: () => Response | Promise<Response> = () => new Response('{}', { status: 500 });

const analyzeCalls = () => calls.filter(call => call.url.startsWith('/api/analyze') && call.url !== '/api/analyze/section');
const lastSignal = () => {
  const list = analyzeCalls();
  return list[list.length - 1]?.init?.signal as AbortSignal | undefined;
};
const form = (call: Call) => call.init?.body as FormData;

/* ── Отрисовка и действия ──────────────────────────────────────────────────── */

function renderAnalyze(wrap: (node: ReactNode) => ReactNode = node => node) {
  return render(
    <MemoryRouter initialEntries={['/analyze']}>
      {wrap(
        <Routes>
          <Route path="/analyze" element={<Analyze />} />
          <Route path="/login" element={<div>Страница входа</div>} />
          <Route path="/library/:id" element={<div>Страница материала</div>} />
          <Route path="/library" element={<div>Библиотека</div>} />
        </Routes>,
      )}
    </MemoryRouter>,
  );
}

const startButton = () => screen.getByRole('button', { name: /Запустить анализ|Вставьте текст|Сначала выберите файл|Запускаем/ });
const uploadScreen = () => screen.findByRole('heading', { name: 'Один материал — полный цикл подготовки' });

async function pasteText(text: string) {
  await uploadScreen();
  fireEvent.click(screen.getByRole('tab', { name: 'Текст' }));
  fireEvent.change(screen.getByLabelText('Текст лекции или конспекта'), { target: { value: text } });
}

async function chooseFile(file = new File(['Энтропия — мера беспорядка системы.'], 'lecture.pdf', { type: 'application/pdf' })) {
  await uploadScreen();
  fireEvent.change(screen.getByTestId('upload-file-input'), { target: { files: [file] } });
  await screen.findByText(file.name);
  return file;
}

async function loadDemo() {
  await uploadScreen();
  fireEvent.click(screen.getByRole('button', { name: 'Попробовать на демо-тексте' }));
  expect((screen.getByLabelText('Текст лекции или конспекта') as HTMLTextAreaElement).value).toBe(DEMO_TEXT);
}

const LECTURE = `Лекция 3. Эластичность спроса\n${'Эластичность показывает, насколько меняется спрос при изменении цены. '.repeat(6)}`;

const errorHeading = () => screen.findByRole('heading', { name: 'Анализ не завершён' }, { timeout: 3000 });
const resultsHeading = () => screen.findByText(/Материал обработан|Обработан частично/, undefined, { timeout: 3000 });

beforeAll(() => {
  MotionGlobalConfig.skipAnimations = true;
});

beforeEach(() => {
  s.session = { access_token: 'tok' };
  s.inserts = [];
  s.insertErrors = 0;
  s.updates = [];
  s.updateIds = [];
  s.quizProps = null;
  s.materialRow = {};
  s.demoRows = [];
  s.demoLookups = [];
  s.increment = vi.fn(async () => undefined);
  s.sync = vi.fn(async () => ({ inserted: 1, skipped: 0 }));
  s.activity = vi.fn(async () => undefined);
  s.verify = vi.fn(async () => true);
  s.checkLimit = vi.fn(async () => ({ allowed: true, isPro: false, count: 20, ok: true }));
  s.realEnergyHook = false;
  s.badWord = null;
  calls = [];
  streams = [];
  sectionResponse = () => new Response('{}', { status: 500 });
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === '/api/analyze/section') return sectionResponse();
      const next = streams.shift();
      return next ? next() : fullRun();
    }),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  ANALYZE_TIMEOUTS.idleMs = 45_000;
});

/* ── Исходы потока ─────────────────────────────────────────────────────────── */

describe('stream outcomes', () => {
  it('a clean EOF after agent_start shows «Анализ не завершён»; «Повторить» resends the same file and settings', async () => {
    streams = [() => sse([ev(TEXT), ev(start('summarizer'))], 'close')];
    renderAnalyze();
    const file = await chooseFile();
    fireEvent.click(startButton());

    await errorHeading();
    expect(screen.getByRole('alert')).toHaveTextContent('Анализ прервался до конца. Материал не сохранён, лимит не списан.');
    expect(s.inserts).toHaveLength(0);
    expect(s.increment).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await resultsHeading();
    expect(analyzeCalls()).toHaveLength(2);
    const [first, second] = analyzeCalls().map(form);
    expect(second.get('file')).toBe(file);
    for (const field of ['summary_detail', 'flashcard_count', 'quiz_count', 'quiz_difficulty', 'quiz_type', 'enabled_agents']) {
      expect(second.get(field)).toBe(first.get(field));
    }
    expect(s.inserts).toHaveLength(1);
  });

  it('results without done: results are shown, saved once and charged once', async () => {
    streams = [() => sse([ev(TEXT), ev(start('summarizer')), ev(DONE_SUMMARY), ev(RESULTS)], 'close')];
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());

    expect(await screen.findByText('Материал обработан', undefined, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(() => expect(s.activity).toHaveBeenCalledTimes(1));
    expect(s.inserts).toHaveLength(1);
    expect(s.increment).toHaveBeenCalledTimes(1);
    expect(s.increment).toHaveBeenCalledWith('user-1', 20);
    expect(s.sync).toHaveBeenCalledWith('user-1', 'mat-1', cards.flashcards);
    expect(s.activity).toHaveBeenCalledWith('user-1', 0, 1);
    const row = s.inserts[0];
    expect(row).toMatchObject({ user_id: 'user-1', title: 'Энтропия', original_text: TEXT.text, flashcards_json: cards, quiz_json: quiz });
    expect((row.summary_json as Record<string, unknown>).sections).toEqual(okSections);
  });

  it('agent_done(summarizer) then a cut connection: partial results saved and charged once, «Создать тест заново» never charges', async () => {
    streams = [() => sse([ev(TEXT), ev(GROUNDING), ev(start('summarizer')), ev(start('flashcards')), ev(start('quiz')), ev(DONE_SUMMARY)], 'error')];
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());

    expect(await screen.findByText('Обработан частично', undefined, { timeout: 3000 })).toBeInTheDocument();
    expect(screen.getByText('Связь прервалась. Показаны разделы, которые успели прийти.')).toBeInTheDocument();
    await waitFor(() => expect(s.activity).toHaveBeenCalledTimes(1));
    expect(s.inserts).toHaveLength(1);
    expect(s.increment).toHaveBeenCalledTimes(1);
    expect(s.inserts[0]).toMatchObject({ flashcards_json: { flashcards: [] }, quiz_json: { quiz: [] } });
    expect((s.inserts[0].summary_json as Record<string, unknown>).sections).toEqual({
      summarizer: { status: 'ok' },
      flashcards: { status: 'missing', message: 'Связь прервалась до этого раздела' },
      quiz: { status: 'missing', message: 'Связь прервалась до этого раздела' },
    });

    sectionResponse = () => new Response(JSON.stringify({ section: 'quiz', status: 'ok', result: quiz }), { status: 200 });
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    expect(await screen.findByText('Тест не получился: связь прервалась до этого раздела.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Создать тест заново' }));
    expect(await screen.findByText('Тест на экране')).toBeInTheDocument();
    const sectionCall = calls.find(call => call.url === '/api/analyze/section');
    expect(JSON.parse(String(sectionCall?.init?.body))).toMatchObject({ section: 'quiz', text: TEXT.text });
    expect(s.updates[0]).toEqual({ quiz_json: quiz });

    sectionResponse = () =>
      new Response(JSON.stringify({ section: 'flashcards', status: 'ok', result: cards }), { status: 200 });
    fireEvent.click(screen.getByRole('button', { name: /^Карточки/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать карточки заново' }));
    await waitFor(() => expect(s.sync).toHaveBeenCalledWith('user-1', 'mat-1', cards.flashcards));
    expect(s.increment).toHaveBeenCalledTimes(1);
    expect(s.inserts).toHaveLength(1);
  });

  it('results where every core section failed: error, nothing saved, charged or recorded', async () => {
    streams = [
      () =>
        sse([
          ev(TEXT),
          ev({
            ...RESULTS,
            summarizer: { error: 'Модель не ответила' },
            flashcards: { error: 'Модель не ответила' },
            quiz: { error: 'Модель не ответила' },
            sections: { summarizer: { status: 'failed' }, flashcards: { status: 'failed' }, quiz: { status: 'failed' } },
          }),
          ev({ type: 'done' }),
        ]),
    ];
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    await errorHeading();
    expect(screen.getByRole('alert')).toHaveTextContent('ИИ-сервис сейчас не ответил. Материал не сохранён, лимит не списан.');
    expect(s.inserts).toHaveLength(0);
    expect(s.increment).not.toHaveBeenCalled();
    expect(s.activity).not.toHaveBeenCalled();
  });

  it('an error event followed by done still shows the error', async () => {
    streams = [
      () =>
        sse([
          ev(TEXT),
          ev({ type: 'error', code: 'busy', message: 'Сервис ИИ сейчас занят. Материал не сохранён, лимит не списан. Попробуйте через минуту.' }),
          ev({ type: 'done' }),
        ]),
    ];
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    await errorHeading();
    expect(screen.getByRole('alert')).toHaveTextContent('Сервис ИИ сейчас занят.');
    await act(async () => new Promise(resolve => setTimeout(resolve, 50)));
    expect(screen.getByRole('heading', { name: 'Анализ не завершён' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
    expect(s.inserts).toHaveLength(0);
    expect(s.increment).not.toHaveBeenCalled();
    expect(s.activity).not.toHaveBeenCalled();
  });
});

/* ── HTTP-ошибки ───────────────────────────────────────────────────────────── */

describe('HTTP errors before the stream', () => {
  it('an nginx HTML 502 gives a Russian message and a retry, never parser text', async () => {
    streams = [() => new Response(NGINX_502, { status: 502, headers: { 'content-type': 'text/html' } })];
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    await errorHeading();
    expect(screen.getByRole('alert')).toHaveTextContent('Сервер сейчас недоступен. Повторите попытку через минуту.');
    expect(document.body.textContent).not.toMatch(/Unexpected|JSON|token/);
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeInTheDocument();
  });

  it('a slowapi 429 asks to wait a minute', async () => {
    streams = [() => new Response('{"error":"Rate limit exceeded: 5 per 1 minute"}', { status: 429, headers: { 'content-type': 'application/json' } })];
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    await errorHeading();
    expect(screen.getByRole('alert')).toHaveTextContent('Слишком много запусков за минуту. Подождите минуту и повторите.');
  });

  it('a 413 offers no retry, only another file, and keeps the settings', async () => {
    streams = [() => new Response('<html><title>413 Request Entity Too Large</title></html>', { status: 413, headers: { 'content-type': 'text/html' } })];
    renderAnalyze();
    await uploadScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Подробный' }));
    await chooseFile();
    fireEvent.click(startButton());
    await errorHeading();
    expect(screen.getByRole('alert')).toHaveTextContent('Файл больше 15 МБ. Сожмите его или загрузите часть материала.');
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать другой файл' }));
    await uploadScreen();
    expect(screen.getByRole('button', { name: 'Подробный' }).className).toMatch(/font-medium/);
  });

  it('a missing session asks to sign in again', async () => {
    s.session = null;
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    await errorHeading();
    expect(screen.getByRole('alert')).toHaveTextContent('Сессия истекла. Войдите снова.');
    fireEvent.click(screen.getByRole('link', { name: 'Войти' }));
    expect(await screen.findByText('Страница входа')).toBeInTheDocument();
    expect(analyzeCalls()).toHaveLength(0);
  });
});

/* ── Тишина, отмена, уход со страницы ──────────────────────────────────────── */

describe('timeouts and cancel', () => {
  it('silence longer than the idle limit ends with a timeout error', async () => {
    ANALYZE_TIMEOUTS.idleMs = 50;
    streams = [() => sse([ev(TEXT), ev(start('summarizer'))], 'hang')];
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    await errorHeading();
    expect(screen.getByRole('alert')).toHaveTextContent('Сервер слишком долго не отвечает.');
    expect(lastSignal()?.aborted).toBe(true);
    expect(s.inserts).toHaveLength(0);
  });

  it('keepalive bytes every 20 ms keep a 50 ms idle limit from firing', async () => {
    ANALYZE_TIMEOUTS.idleMs = 50;
    const keepalives = Array.from({ length: 6 }, () => ': keepalive\n\n');
    streams = [() => sse([ev(TEXT), ev(start('summarizer')), ...keepalives, ev(DONE_SUMMARY), ev(RESULTS)], 'close', 20)];
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    expect(await screen.findByText('Материал обработан', undefined, { timeout: 3000 })).toBeInTheDocument();
  });

  it('«Отменить» aborts the request and returns to the upload screen without an error or a save', async () => {
    streams = [() => sse([ev(TEXT), ev(start('summarizer'))], 'hang')];
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    fireEvent.click(await screen.findByRole('button', { name: 'Отменить' }));
    await uploadScreen();
    expect(lastSignal()?.aborted).toBe(true);
    expect(screen.queryByRole('heading', { name: 'Анализ не завершён' })).not.toBeInTheDocument();
    await act(async () => new Promise(resolve => setTimeout(resolve, 30)));
    expect(s.inserts).toHaveLength(0);
    expect(s.increment).not.toHaveBeenCalled();
    // После отмены можно сразу запустить снова.
    await chooseFile();
    fireEvent.click(startButton());
    await resultsHeading();
    expect(analyzeCalls()).toHaveLength(2);
  });

  it('shows the server note while a long extraction step runs', async () => {
    streams = [() => sse([ev({ type: 'status', message: 'Распознаём текст файла. Это может занять несколько минут.' })], 'hang')];
    renderAnalyze();
    await chooseFile(new File(['audio'], 'lecture.mp3', { type: 'audio/mpeg' }));
    fireEvent.click(startButton());
    expect(await screen.findByText('Распознаём текст файла. Это может занять несколько минут.')).toBeInTheDocument();
    expect(analyzeCalls()[0].url).toBe('/api/analyze/media');
  });

  it('leaving the page aborts the request', async () => {
    streams = [() => sse([ev(TEXT), ev(start('summarizer'))], 'hang')];
    const view = renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    await screen.findByRole('button', { name: 'Отменить' });
    expect(lastSignal()?.aborted).toBe(false);
    view.unmount();
    expect(lastSignal()?.aborted).toBe(true);
  });
});

/* ── Двойной запуск ────────────────────────────────────────────────────────── */

describe('one run per click', () => {
  it('two synchronous clicks on start send one request', async () => {
    let release: (value: boolean) => void = () => undefined;
    s.verify = vi.fn(() => new Promise<boolean>(resolve => (release = resolve)));
    renderAnalyze();
    await chooseFile();
    const button = startButton();
    fireEvent.click(button);
    fireEvent.click(button);
    expect(s.verify).toHaveBeenCalledTimes(1);
    expect(startButton()).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Попробовать на демо-тексте' })).toBeDisabled();
    await act(async () => release(true));
    await resultsHeading();
    expect(analyzeCalls()).toHaveLength(1);
    expect(s.inserts).toHaveLength(1);
    expect(s.increment).toHaveBeenCalledTimes(1);
  });

  it('two synchronous clicks on a demo start send one request', async () => {
    renderAnalyze();
    await loadDemo();
    const button = startButton();
    fireEvent.click(button);
    fireEvent.click(button);
    await resultsHeading();
    expect(analyzeCalls()).toHaveLength(1);
  });

  it('going back while «Повторить» waits for the limit check cancels that start', async () => {
    streams = [() => new Response(NGINX_502, { status: 502, headers: { 'content-type': 'text/html' } })];
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    await errorHeading();

    let release: (value: boolean) => void = () => undefined;
    s.verify = vi.fn(() => new Promise<boolean>(resolve => (release = resolve)));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(s.verify).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Повторить' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать другой файл' }));
    await uploadScreen();

    await act(async () => release(true));
    await act(async () => new Promise(resolve => setTimeout(resolve, 30)));
    expect(analyzeCalls()).toHaveLength(1);
    expect(screen.getByRole('heading', { name: 'Один материал — полный цикл подготовки' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Отменить' })).not.toBeInTheDocument();
  });

  it('a start made after going back is the only run: the abandoned retry never sends a request', async () => {
    streams = [() => new Response(NGINX_502, { status: 502, headers: { 'content-type': 'text/html' } })];
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    await errorHeading();

    let release: (value: boolean) => void = () => undefined;
    s.verify = vi.fn(() => new Promise<boolean>(resolve => (release = resolve)));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    const abandoned = release;
    fireEvent.click(screen.getByRole('button', { name: 'Выбрать другой файл' }));

    s.verify = vi.fn(async () => true);
    await chooseFile();
    fireEvent.click(startButton());
    await resultsHeading();
    await act(async () => abandoned(true));
    await act(async () => new Promise(resolve => setTimeout(resolve, 30)));
    expect(analyzeCalls()).toHaveLength(2);
    expect(screen.getByText('Материал обработан')).toBeInTheDocument();
    await waitFor(() => expect(s.inserts).toHaveLength(1));
    expect(s.increment).toHaveBeenCalledTimes(1);
  });

  it('after verifyEnergy says no, the start button works again', async () => {
    s.verify = vi.fn(async () => false);
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    await waitFor(() => expect(startButton()).toBeEnabled());
    expect(analyzeCalls()).toHaveLength(0);
    s.verify = vi.fn(async () => true);
    fireEvent.click(startButton());
    await resultsHeading();
    expect(analyzeCalls()).toHaveLength(1);
  });
});

/* ── Демо-текст ────────────────────────────────────────────────────────────── */

describe('demo text', () => {
  it('is free, ignores changed settings and is saved once with demo markers', async () => {
    renderAnalyze();
    await uploadScreen();
    fireEvent.click(screen.getByRole('button', { name: 'Подробный' }));
    fireEvent.click(screen.getByText('Разговор', { selector: 'span' }));
    await loadDemo();
    expect(screen.getByText('Демо-текст: лимит не списывается, настройки по умолчанию')).toBeInTheDocument();
    fireEvent.click(startButton());

    expect(await screen.findByText('Демо-текст: лимит не списывается.')).toBeInTheDocument();
    await resultsHeading();
    await waitFor(() => expect(s.activity).toHaveBeenCalledTimes(1));
    expect(s.verify).not.toHaveBeenCalled();
    expect(s.increment).not.toHaveBeenCalled();
    const body = form(analyzeCalls()[0]);
    expect(body.get('summary_detail')).toBe('medium');
    expect(body.get('flashcard_count')).toBe('6');
    expect(body.get('quiz_count')).toBe('5');
    expect(body.get('enabled_agents')).toBe(JSON.stringify(['summarizer', 'flashcards', 'quiz']));
    expect(await (body.get('file') as File).text()).toBe(DEMO_TEXT);
    expect(s.demoLookups[0]).toEqual([
      ['user_id', 'user-1'],
      ['summary_json->>demo_text_id', 'demo-v1'],
    ]);
    expect(s.inserts).toHaveLength(1);
    expect(s.inserts[0].summary_json).toMatchObject({ origin: 'demo', demo_text_id: 'demo-v1' });
    expect(screen.getByText('Демо-текст: лимит не списан.')).toBeInTheDocument();
  });

  it('a second demo run inserts nothing and links the existing material', async () => {
    s.demoRows = [{ id: 'demo-mat' }];
    renderAnalyze();
    await loadDemo();
    fireEvent.click(startButton());
    await resultsHeading();
    expect(await screen.findByText(/Этот результат не сохранён: демо-материал уже есть в библиотеке/)).toBeInTheDocument();
    expect(s.inserts).toHaveLength(0);
    expect(s.sync).not.toHaveBeenCalled();
    expect(s.activity).not.toHaveBeenCalled();
    expect(s.increment).not.toHaveBeenCalled();
    // На экране не библиотечная копия: тест этого запуска не пишется в её журнал.
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    await screen.findByText('Тест на экране');
    expect(s.quizProps).not.toBeNull();
    expect(s.quizProps?.materialId).toBeUndefined();
    fireEvent.click(screen.getByRole('link', { name: 'Открыть его' }));
    expect(await screen.findByText('Страница материала')).toBeInTheDocument();
  });

  it('a second demo run with a failed section writes nothing into the library copy', async () => {
    s.demoRows = [{ id: 'demo-mat' }];
    streams = [
      () =>
        sse([
          ev(TEXT),
          ev({
            ...RESULTS,
            quiz: { error: 'Сервис ИИ был перегружен' },
            sections: { ...okSections, quiz: { status: 'busy', message: 'Сервис ИИ был перегружен' } },
          }),
          ev({ type: 'done' }),
        ]),
    ];
    renderAnalyze();
    await loadDemo();
    fireEvent.click(startButton());
    expect(
      await screen.findByText(/Этот результат не сохранён: демо-материал уже есть в библиотеке/, undefined, { timeout: 3000 }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Изменить название' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    expect(await screen.findByText('Тест не получился: сервис ИИ был перегружен.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Создать тест заново' })).not.toBeInTheDocument();
    expect(calls.filter(call => call.url === '/api/analyze/section')).toHaveLength(0);
    expect(s.updates).toHaveLength(0);
    expect(s.inserts).toHaveLength(0);
  });

  it('the demo label never sticks to a later real run', async () => {
    streams = [() => sse([ev(TEXT), ev(start('summarizer'))], 'hang'), () => sse([ev(TEXT), ev(start('summarizer'))], 'hang')];
    renderAnalyze();
    await loadDemo();
    fireEvent.click(startButton());
    expect(await screen.findByText('Демо-текст: лимит не списывается.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отменить' }));

    await pasteText(LECTURE);
    fireEvent.click(startButton());
    await screen.findByRole('button', { name: 'Отменить' });
    expect(screen.queryByText('Демо-текст: лимит не списывается.')).not.toBeInTheDocument();
    expect(s.verify).toHaveBeenCalledTimes(1);
  });

  it('keeps the user’s own text: «Вернуть мой текст» brings it back', async () => {
    renderAnalyze();
    await pasteText(LECTURE);
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать на демо-тексте' }));
    const field = screen.getByLabelText('Текст лекции или конспекта') as HTMLTextAreaElement;
    expect(field.value).toBe(DEMO_TEXT);
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть мой текст' }));
    expect(field.value).toBe(LECTURE);
    expect(screen.queryByRole('button', { name: 'Вернуть мой текст' })).not.toBeInTheDocument();
  });

  it('stays available when the daily limit is used up', async () => {
    s.checkLimit = vi.fn(async () => ({ allowed: false, isPro: false, count: 100, ok: true }));
    renderAnalyze();
    await chooseFile();
    expect(await screen.findByText('На сегодня лимит исчерпан, он обновится в 03:00. Демо-текст доступен без лимита.')).toBeInTheDocument();
    expect(startButton()).toBeDisabled();
    const demo = screen.getByRole('button', { name: 'Попробовать на демо-тексте' });
    expect(demo).toBeEnabled();
    fireEvent.click(demo);
    expect(startButton()).toBeEnabled();
    expect(screen.queryByText(/На сегодня лимит исчерпан/)).not.toBeInTheDocument();
    fireEvent.click(startButton());
    await resultsHeading();
    expect(s.increment).not.toHaveBeenCalled();
  });
});

/* ── Вставленный текст ─────────────────────────────────────────────────────── */

describe('pasted text', () => {
  it('posts pasted-text.txt to /api/analyze and titles the material by the first line', async () => {
    streams = [
      () =>
        sse([
          ev(TEXT),
          ev({ ...RESULTS, summarizer: { ...summary, title: '' }, sections: okSections }),
        ]),
    ];
    renderAnalyze();
    await pasteText(LECTURE);
    fireEvent.click(startButton());
    await resultsHeading();
    await waitFor(() => expect(s.inserts).toHaveLength(1));
    const call = analyzeCalls()[0];
    expect(call.url).toBe('/api/analyze');
    const file = form(call).get('file') as File;
    expect(file.name).toBe('pasted-text.txt');
    expect(await file.text()).toBe(LECTURE);
    expect(s.inserts[0].title).toBe('Лекция 3. Эластичность спроса');
    expect(s.verify).toHaveBeenCalledWith('user-1', 20, 'Анализ материала');
  });

  it('an error keeps the text: «Повторить» resends it and «Изменить текст» shows it again', async () => {
    streams = [
      () => new Response(NGINX_502, { status: 502, headers: { 'content-type': 'text/html' } }),
      () => new Response(NGINX_502, { status: 502, headers: { 'content-type': 'text/html' } }),
    ];
    renderAnalyze();
    await pasteText(LECTURE);
    fireEvent.click(startButton());
    await errorHeading();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(analyzeCalls()).toHaveLength(2));
    expect(await (form(analyzeCalls()[1]).get('file') as File).text()).toBe(LECTURE);
    await errorHeading();
    fireEvent.click(screen.getByRole('button', { name: 'Изменить текст' }));
    await uploadScreen();
    expect((screen.getByLabelText('Текст лекции или конспекта') as HTMLTextAreaElement).value).toBe(LECTURE);
  });

  it('«Новый анализ» after results starts from a clean text field', async () => {
    renderAnalyze();
    await pasteText(LECTURE);
    fireEvent.click(startButton());
    await resultsHeading();
    fireEvent.click(screen.getByRole('button', { name: 'Новый анализ' }));
    await uploadScreen();
    expect((screen.getByLabelText('Текст лекции или конспекта') as HTMLTextAreaElement).value).toBe('');
  });
});

/* ── Сохранение ────────────────────────────────────────────────────────────── */

describe('saving', () => {
  it('a failed insert charges nothing and can be saved again once', async () => {
    s.insertErrors = 1;
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    await resultsHeading();
    expect(await screen.findByText(/Результат не сохранён в библиотеку/)).toBeInTheDocument();
    expect(s.increment).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Сохранить ещё раз' }));
    await waitFor(() => expect(s.inserts).toHaveLength(1));
    await waitFor(() => expect(s.increment).toHaveBeenCalledTimes(1));
    expect(screen.queryByText(/Результат не сохранён в библиотеку/)).not.toBeInTheDocument();
  });

  it('a slow save of the previous run does not block saving the next one', async () => {
    let releaseFirst: () => void = () => undefined;
    const firstSync = new Promise<void>(resolve => (releaseFirst = resolve));
    s.sync = vi.fn(() => (s.sync.mock.calls.length === 1 ? firstSync.then(() => ({ inserted: 1, skipped: 0 })) : Promise.resolve({ inserted: 1, skipped: 0 })));
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    await resultsHeading();
    await waitFor(() => expect(s.sync).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Новый анализ' }));
    await chooseFile();
    fireEvent.click(startButton());
    await resultsHeading();
    await waitFor(() => expect(s.inserts).toHaveLength(2));
    expect(s.increment).toHaveBeenCalledTimes(2);
    releaseFirst();
    await waitFor(() => expect(s.activity).toHaveBeenCalledTimes(2));
  });

  it('says so when cards did not reach review and retries the sync', async () => {
    s.sync = vi.fn(async () => {
      throw new Error('Не удалось добавить карточки в повторение.');
    });
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    await resultsHeading();
    const line = await screen.findByText(/Карточки не добавлены в повторение/);
    expect(s.increment).toHaveBeenCalledTimes(1);
    s.sync = vi.fn(async () => ({ inserted: 1, skipped: 0 }));
    fireEvent.click(within(line).getByRole('button', { name: 'Повторить' }));
    await waitFor(() => expect(screen.queryByText(/Карточки не добавлены в повторение/)).not.toBeInTheDocument());
    expect(s.sync).toHaveBeenCalledWith('user-1', 'mat-1', cards.flashcards);
  });

  it('inappropriate text stops the run with a clear message', async () => {
    s.badWord = 'беспорядка';
    streams = [() => sse([ev(TEXT), ev(start('summarizer'))], 'hang')];
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    await errorHeading();
    expect(screen.getByRole('alert')).toHaveTextContent('Текст содержит недопустимые материалы');
    expect(screen.queryByRole('button', { name: 'Повторить' })).not.toBeInTheDocument();
    expect(lastSignal()?.aborted).toBe(true);
  });
});

/* ── «Создать … заново» и следующий запуск ─────────────────────────────────── */

describe('a section re-created for an earlier run', () => {
  it('is saved to that run’s material and never lands on the next run’s screen', async () => {
    const summaryB = { title: 'Эластичность спроса', subject: 'Экономика', content: 'Эластичность показывает реакцию спроса на цену.', terms: [], source_ids: ['S01'] };
    streams = [
      () => sse([ev(TEXT), ev(GROUNDING), ev(start('summarizer')), ev(start('quiz')), ev(DONE_SUMMARY)], 'error'),
      () => sse([ev(TEXT), ev({ ...RESULTS, summarizer: summaryB }), ev({ type: 'done' })]),
    ];
    renderAnalyze();
    await chooseFile();
    fireEvent.click(startButton());
    expect(await screen.findByText('Обработан частично', undefined, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(() => expect(s.activity).toHaveBeenCalledTimes(1));

    let releaseSection: (value: Response) => void = () => undefined;
    sectionResponse = () => new Promise<Response>(resolve => (releaseSection = resolve));
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Создать тест заново' }));
    await waitFor(() => expect(calls.some(call => call.url === '/api/analyze/section')).toBe(true));

    // Пока тест создаётся, пользователь запускает новый анализ.
    fireEvent.click(screen.getByRole('button', { name: 'Новый анализ' }));
    await chooseFile();
    fireEvent.click(startButton());
    expect(await screen.findByRole('heading', { name: 'Эластичность спроса' }, { timeout: 3000 })).toBeInTheDocument();
    await waitFor(() => expect(s.activity).toHaveBeenCalledTimes(2));

    await act(async () => releaseSection(new Response(JSON.stringify({ section: 'quiz', status: 'ok', result: quiz }), { status: 200 })));
    await waitFor(() => expect(s.updates).toContainEqual({ quiz_json: quiz }));
    expect(s.updateIds[s.updates.findIndex(update => 'quiz_json' in update)]).toBe('mat-1');
    await act(async () => new Promise(resolve => setTimeout(resolve, 30)));

    expect(screen.getByRole('heading', { name: 'Эластичность спроса' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Энтропия' })).not.toBeInTheDocument();
    expect(screen.getByText('Материал обработан')).toBeInTheDocument();
    // Тест второго запуска остаётся привязан к его материалу.
    fireEvent.click(screen.getByRole('button', { name: /^Тест/ }));
    await screen.findByText('Тест на экране');
    expect(s.quizProps?.materialId).toBe('mat-2');
  });
});

/* ── Строка о лимите ───────────────────────────────────────────────────────── */

describe('cost note', () => {
  it('shows what an analysis costs and what is left', async () => {
    renderAnalyze();
    await chooseFile();
    expect(
      await screen.findByText('Анализ расходует 20 из 100 единиц дневного лимита. Осталось 80, лимит обновится в 03:00.'),
    ).toBeInTheDocument();
    expect(s.checkLimit).toHaveBeenCalledWith('user-1', 0);
  });

  it('falls back to a plain line when the balance could not be read, and shows nothing for PRO', async () => {
    s.checkLimit = vi.fn(async () => ({ allowed: true, isPro: false, count: 0, ok: false }));
    const view = renderAnalyze();
    expect(await screen.findByText('Анализ расходует 20 единиц дневного лимита (100 в сутки).')).toBeInTheDocument();
    view.unmount();

    s.checkLimit = vi.fn(async () => ({ allowed: true, isPro: true, count: 0, ok: true }));
    renderAnalyze();
    await uploadScreen();
    await act(async () => new Promise(resolve => setTimeout(resolve, 20)));
    expect(screen.queryByText(/Анализ расходует/)).not.toBeInTheDocument();
  });

  it('refreshes after a charge elsewhere (AI_USAGE_EVENT)', async () => {
    renderAnalyze();
    expect(await screen.findByText(/Осталось 80/)).toBeInTheDocument();
    s.checkLimit = vi.fn(async () => ({ allowed: true, isPro: false, count: 60, ok: true }));
    await act(async () => {
      window.dispatchEvent(new Event('ai_usage_updated'));
    });
    expect(await screen.findByText(/Осталось 40/)).toBeInTheDocument();
  });

  it('no «Запуск ИИ» dialog appears before an allowed analysis', async () => {
    s.realEnergyHook = true;
    renderAnalyze(node => <ConfirmProvider>{node}</ConfirmProvider>);
    await chooseFile();
    fireEvent.click(startButton());
    await resultsHeading();
    expect(screen.queryByText('Запуск ИИ')).not.toBeInTheDocument();
    expect(analyzeCalls()).toHaveLength(1);
  });
});
