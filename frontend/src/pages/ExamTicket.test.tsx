import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { createFakeSupabase } from '../lib/oral/testing/fakeSupabase';
import { DEMO_ANSWER, DEMO_QUESTION, DEMO_RUBRIC, demoRubricResponse } from '../lib/oral/testing/fixtures';
import { CHECK_AFTER_FAILED_CHECK_MS, CHECK_CONFIRM_TIMEOUT_MS, CHECK_FOLLOWUP_TIMEOUT_MS, DONT_KNOW_VERDICT } from '../lib/oral/oralApi';
import type { RecognitionResultEvent } from '../hooks/useSpeechAnswer';
import { CHOSE_SERVER_NOTICE, PRIVACY_LINE, PRIVACY_SERVER_LINE, SAVE_WAIT_MS, SWITCHED_TO_SERVER_NOTICE } from './ExamTicket';
import { SCALE_NOTE } from '../components/oral/OralProtocol';
import { PASTE_REFUSED } from '../lib/oral/pasteGuard';

const mocks = vi.hoisted(() => ({
  client: null as unknown as ReturnType<typeof import('../lib/oral/testing/fakeSupabase').createFakeSupabase>['client'],
  confirm: vi.fn(async () => true),
  checkAILimit: vi.fn(),
  incrementAIUsage: vi.fn(async () => undefined),
  recordSelfRating: vi.fn(async () => undefined),
  fetchSheetEvents: vi.fn(async (): Promise<unknown[]> => []),
}));

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => mocks.client.from(table),
    rpc: (fn: string, args: Record<string, unknown>) => mocks.client.rpc(fn, args),
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, session: null, loading: false, signOut: vi.fn() }) }));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm, alert: vi.fn() }) }));
vi.mock('../api/learning', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/learning')>()),
  recordSelfRating: mocks.recordSelfRating,
  fetchSheetEvents: mocks.fetchSheetEvents,
}));
// The server's recognition: off unless a test turns it on; the test hands out the pieces and their text.
const media = vi.hoisted(() => ({
  supported: false,
  recorders: [] as Array<{ active: boolean; piece: () => void; flushPiece: boolean; options: { onSegment: (piece: unknown) => void } }>,
  texts: [] as Array<{ resolve: (text: string) => void; hint?: string }>,
}));
vi.mock('../lib/oral/recorder', () => ({
  recorderSupported: () => media.supported,
  RecorderError: class RecorderError extends Error {},
  SegmentRecorder: function SegmentRecorder(options: { onSegment: (piece: unknown) => void }) {
    let next = 0;
    const recorder = {
      active: false,
      flushPiece: false,
      options,
      piece: () => options.onSegment({ blob: new Blob(['opus'], { type: 'audio/webm' }), index: next++, speechMs: 900, durationMs: 2600 }),
      start: async () => {
        recorder.active = true;
      },
      flush: async () => {
        if (recorder.flushPiece) recorder.piece();
      },
      stop: async () => {
        recorder.active = false;
      },
      release: () => {
        recorder.active = false;
      },
    };
    media.recorders.push(recorder);
    return recorder;
  },
}));
vi.mock('../lib/oral/transcribe', () => ({
  transcribeAudio: (_blob: Blob, options: { hint?: string }) => new Promise<string>((resolve) => media.texts.push({ resolve, hint: options.hint })),
}));
vi.mock('../api/limits', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/limits')>()),
  checkAILimit: mocks.checkAILimit,
  // The server charges the checked answer (/api/oral/evaluate); after the save the page only
  // refreshes the meter — counted here under the old name.
  notifyAIUsageChanged: mocks.incrementAIUsage,
}));

// ── Fixtures ────────────────────────────────────────────────────────────────────────

const EXAM = '0e000000-0000-4000-8000-000000000001';
const Q1 = '0a000000-0000-4000-8000-000000000001';
const Q2 = '0a000000-0000-4000-8000-000000000002';
const PREVIOUS_SESSION = '05000000-0000-4000-8000-000000000009';
const SESSION = '05000000-0000-4000-8000-000000000001';
const HASH = 'c'.repeat(32);
const RUBRIC_ID = '07000000-0000-4000-8000-000000000001';
const Q4 = DEMO_RUBRIC.points[3].followup.question;
const Q2_FOLLOWUP = DEMO_RUBRIC.points[1].followup.question;
const FULL_ANSWER = `${DEMO_ANSWER}. Большая скорость обучения даёт колебания, маленькая — медленно.`;

const questionRow = (id: string, position: number, extra: Record<string, unknown> = {}) => ({
  id,
  exam_id: EXAM,
  position,
  label: String(position),
  text: position === 7 ? DEMO_QUESTION : `Вопрос номер ${position}`,
  question_hash: position === 7 ? HASH : 'd'.repeat(32),
  coverage: 'full',
  evidence: [{ material_id: 'mat-1', material_title: 'Нейронные сети', source_id: 'S12', excerpt: 'Обучение сети…' }],
  nearest: [],
  ...extra,
});

const EVALUATION = {
  points: [
    { id: 'p1', status: 'covered', student_quote: 'подбор весов, которые минимизируют функцию потерь', comment: '' },
    { id: 'p2', status: 'covered', student_quote: 'прямой проход', comment: '' },
    { id: 'p3', status: 'partial', student_quote: 'обратное распространение ошибки', comment: 'Про градиент по весам не сказано.' },
    { id: 'p4', status: 'missing', student_quote: '', comment: 'Скорость обучения не прозвучала.' },
    { id: 'p5', status: 'covered', student_quote: 'оптимизаторы вроде Адам', comment: '' },
  ],
  errors: [],
  verdict: 'Повторите скорость обучения.',
};

const SAVED = { session_id: SESSION, duplicate: false, events: 6, mistakes_added: 2, mistakes_existing: 0, card_added: true };

// ── Fakes: network, audio, Cache API, speech recognition ───────────────────────────

function json(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: new Headers({ 'content-type': 'application/json' }),
    text: async () => JSON.stringify(body),
    json: async () => body,
  } as unknown as Response;
}

/** A request that never answers by itself and fails when its signal aborts. */
function hang(init?: RequestInit): Promise<Response> {
  return new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
  });
}

type Handler = (body: Record<string, unknown>, init: RequestInit) => Promise<Response> | Response;
let api: Record<string, ReturnType<typeof vi.fn<Handler>>>;
let fetchMock: ReturnType<typeof vi.fn>;
let ttsFailing: Set<string>;
const blobText = new WeakMap<Blob, string>();
const urlText = new Map<string, string>();

class FakeAudio {
  static instances: FakeAudio[] = [];
  src: string;
  paused = true;
  playbackRate = 1;
  currentTime = 0;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(src: string) {
    this.src = src;
    FakeAudio.instances.push(this);
  }
  addEventListener() {}
  play() {
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  get text() {
    return urlText.get(this.src) ?? '';
  }
}

const audiosFor = (text: string) => FakeAudio.instances.filter((audio) => audio.text === text);

class FakeResponse {
  constructor(private readonly body: Blob) {}
  async blob() {
    return this.body;
  }
}
let cacheStore: Map<string, FakeResponse>;

class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = false;
  maxAlternatives = 0;
  onresult: ((event: RecognitionResultEvent) => void) | null = null;
  onerror: ((event: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  starts = 0;
  stops = 0;
  running = false;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    if (this.running) throw new DOMException('already started', 'InvalidStateError');
    this.running = true;
    this.starts += 1;
  }
  stop() {
    this.stops += 1;
  }
  abort() {
    this.running = false;
  }
  say(results: Array<[string, boolean]>) {
    const list = results.map(([transcript, isFinal]) => ({ isFinal, length: 1, 0: { transcript } }));
    this.onresult?.({ resultIndex: 0, results: Object.assign(list, { length: list.length }) });
  }
  end() {
    this.running = false;
    this.onend?.();
  }
}
const recognition = () => FakeRecognition.instances[FakeRecognition.instances.length - 1];

const ttsTexts = () =>
  fetchMock.mock.calls.filter((call) => String(call[0]) === '/api/tts').map((call) => JSON.parse(String((call[1] as RequestInit).body)).text as string);
const callsTo = (url: string) => fetchMock.mock.calls.filter((call) => String(call[0]) === url);
const bodyOf = (call: unknown[]) => JSON.parse(String((call[1] as RequestInit).body));

async function ttsKey(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return `/__tts/professor/${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function persistClip(text: string) {
  const blob = new Blob(['mp3']);
  blobText.set(blob, text);
  cacheStore.set(await ttsKey(text), new FakeResponse(blob));
}

type RpcFake = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: unknown }>;

/** The department's own tickets of the test exam: ticket 12 is questions 7 and 9 (Q1, Q2). */
const DEPARTMENT_TICKETS = { mode: 'fixed', per_ticket: 2, tickets: [{ number: 12, question_ids: [Q1, Q2] }] };

function seedDatabase(
  extra: { events?: Record<string, unknown>[]; sessions?: Record<string, unknown>[]; rpc?: RpcFake; layout?: Record<string, unknown> | null } = {},
) {
  const layout = extra.layout === undefined ? DEPARTMENT_TICKETS : extra.layout;
  const fake = createFakeSupabase({
    tables: {
      exams: [{ id: EXAM, title: 'Нейросети', kind: 'exam', ...(layout ? { ticket_layout: layout } : {}) }],
      exam_questions: [
        questionRow(Q1, 7),
        questionRow(Q2, 9, {
          coverage: 'none',
          nearest: [{ material_id: 'mat-1', material_title: 'Нейронные сети', source_id: 'S07', excerpt: 'Функция активации определяет выход нейрона', matched: ['активац'] }],
        }),
      ],
      learning_events: extra.events ?? [],
      exam_sessions: extra.sessions ?? [],
      oral_rubrics: [{ id: RUBRIC_ID, rubric: { points: DEMO_RUBRIC.points.map((point) => ({ id: point.id, anchors: point.anchors })) } }],
    },
    rpc: extra.rpc,
  });
  mocks.client = fake.client;
  return fake;
}

let location = '';
let search = '';
function Where() {
  const current = useLocation();
  location = current.pathname;
  search = current.search;
  return <p>Другая страница</p>;
}

async function renderPage(url: string) {
  vi.resetModules();
  const { default: ExamTicket } = await import('./ExamTicket');
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/exams/:id/ticket" element={<ExamTicket />} />
        <Route path="/exams/:id/draw" element={<Where />} />
        <Route path="/exams/:id/edit" element={<Where />} />
        <Route path="/exams/:id" element={<Where />} />
        <Route path="/mistakes" element={<Where />} />
        <Route path="/dashboard" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const ticketUrl = (ids = [Q1]) => `/exams/${EXAM}/ticket?q=${ids.join(',')}&n=12`;
const DRAFT_KEY = `meldy_answer_draft_${Q1}`;
const peakFlag = () => JSON.parse(window.sessionStorage.getItem(`meldy_exam_peak_${EXAM}`) ?? 'null');

/** record_oral_attempt held until the test lets it answer. */
function heldRpc() {
  const held: { release: (outcome?: 'saved' | 'failed') => void } = { release: () => undefined };
  const rpc = vi.fn(
    () =>
      new Promise<{ data: unknown; error: unknown }>((resolve) => {
        held.release = (outcome = 'saved') => resolve(outcome === 'saved' ? { data: SAVED, error: null } : { data: null, error: { code: '08006', message: 'down' } });
      }),
  );
  return { rpc, held };
}

async function readyToAnswer() {
  await waitFor(() => expect(screen.getAllByRole('button', { name: /^(Отвечать голосом|Ответить текстом)$/ })[0]).toBeEnabled());
}

function typeAnswer(text: string) {
  fireEvent.change(screen.getByRole('textbox'), { target: { value: text } });
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 9, 3, 15, 0, 0));
  FakeAudio.instances = [];
  FakeRecognition.instances = [];
  ttsFailing = new Set();
  cacheStore = new Map();
  location = '';
  search = '';
  window.localStorage.clear();
  window.sessionStorage.clear();
  mocks.confirm.mockReset();
  mocks.confirm.mockResolvedValue(true);
  mocks.checkAILimit.mockReset();
  mocks.checkAILimit.mockResolvedValue({ allowed: true, isPro: false, count: 3, ok: true });
  mocks.incrementAIUsage.mockClear();
  mocks.recordSelfRating.mockReset();
  mocks.recordSelfRating.mockResolvedValue(undefined);
  mocks.fetchSheetEvents.mockReset();
  mocks.fetchSheetEvents.mockResolvedValue([]);

  api = {
    '/api/oral/rubric': vi.fn<Handler>(async () => json(200, demoRubricResponse())),
    '/api/oral/check': vi.fn<Handler>(async () => json(200, { statuses: { p1: 'covered', p2: 'covered', p3: 'covered', p4: 'missing', p5: 'covered' }, ask: 'p4' })),
    '/api/oral/evaluate': vi.fn<Handler>(async () => json(200, EVALUATION)),
  };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    const body = init.body ? JSON.parse(String(init.body)) : {};
    if (url === '/api/tts') {
      if (ttsFailing.has(body.text)) return { ok: false, status: 502, headers: new Headers(), blob: async () => new Blob() };
      const blob = new Blob(['mp3']);
      blobText.set(blob, body.text);
      return { ok: true, status: 200, blob: async () => blob };
    }
    const handler = api[url];
    if (!handler) throw new Error(`Unexpected request ${url}`);
    return handler(body, init);
  });
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('Audio', FakeAudio);
  vi.stubGlobal('Response', FakeResponse);
  vi.stubGlobal('caches', {
    open: async () => ({
      match: async (key: string) => cacheStore.get(String(key)),
      put: async (key: string, response: FakeResponse) => {
        cacheStore.set(String(key), response);
      },
    }),
  });
  let counter = 0;
  URL.createObjectURL = vi.fn((blob: Blob) => {
    const url = `blob:clip-${(counter += 1)}`;
    urlText.set(url, blobText.get(blob) ?? '');
    return url;
  });
  URL.revokeObjectURL = vi.fn();
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  // Let a test's persisted prefetch queue finish against its own fakes, not the next test's.
  await new Promise((resolve) => setTimeout(resolve, 40));
  vi.unstubAllGlobals();
});

// ── Tests ───────────────────────────────────────────────────────────────────────────

describe('ExamTicket: before the answer', () => {
  it('uses the cached rubric, keeps titles out of the page and prefetches the examiner’s lines in order', async () => {
    seedDatabase();
    const { container } = await renderPage(ticketUrl());
    await readyToAnswer();
    expect(api['/api/oral/rubric']).toHaveBeenCalledTimes(1);
    expect(api['/api/oral/rubric'].mock.calls[0][0]).toEqual({ exam_id: EXAM, question_id: Q1, force: false });
    expect(screen.getByRole('heading', { level: 1, name: DEMO_QUESTION })).toBeInTheDocument();
    for (const point of DEMO_RUBRIC.points) expect(container.textContent).not.toContain(point.title);
    expect(screen.getByText('Полный ответ — 5 пунктов из ваших лекций. Они откроются, когда вы их назовёте.')).toBeInTheDocument();
    expect(screen.getByText(/Речь распознаёт браузер, в Chrome — через сервис Google/)).toBeInTheDocument();
    const lines = DEMO_RUBRIC.points.map((point) => point.followup.question);
    await waitFor(() =>
      expect(ttsTexts()).toEqual(['Так…', lines[0], lines[1], lines[2], lines[3], lines[4], 'Хорошо, по существу всё', 'Хорошо, спасибо', 'Не расслышал ответ']),
    );
    // The ticket's question is shown, never voiced.
    expect(ttsTexts()).not.toContain(DEMO_QUESTION);
  });

  it('skips clips that are already in the persistent cache', async () => {
    seedDatabase();
    await persistClip('Так…');
    await persistClip(Q4);
    await renderPage(ticketUrl());
    await readyToAnswer();
    await waitFor(() => expect(ttsTexts()).toContain('Не расслышал ответ'));
    expect(ttsTexts()).not.toContain('Так…');
    expect(ttsTexts()).not.toContain(Q4);
  });

  it('shows the lectures’ nearest fragments when the question is not in them (409)', async () => {
    seedDatabase();
    api['/api/oral/rubric'].mockImplementation(async () =>
      json(409, { detail: 'Этого вопроса нет в ваших лекциях — оценить ответ не по чему.', code: 'not_in_lectures' }),
    );
    await renderPage(`/exams/${EXAM}/ticket?q=${Q2}`);
    expect(await screen.findByRole('heading', { name: 'Этого вопроса нет в ваших лекциях — оценить ответ не по чему.' })).toBeInTheDocument();
    expect(screen.getByText('Функция активации определяет выход нейрона')).toBeInTheDocument();
    expect(screen.getByText('«Нейронные сети», фрагмент 7')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Лист экзамена' }));
    await waitFor(() => expect(location).toBe(`/exams/${EXAM}`));
  });

  it('shows the server’s detail for 422 and offers another ticket', async () => {
    seedDatabase();
    api['/api/oral/rubric'].mockImplementation(async () => json(422, { detail: 'Не получилось собрать пункты ответа, где каждый подтверждён цитатой из ваших лекций. Ответьте на другой вопрос.', code: 'rubric_unverifiable' }));
    await renderPage(ticketUrl());
    expect(await screen.findByText(/Не получилось собрать пункты ответа, где каждый подтверждён цитатой/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Тянуть другой билет' }));
    await waitFor(() => expect(location).toBe(`/exams/${EXAM}/draw`));
  });

  it('never blames the lectures for an outage and retries on request (502)', async () => {
    seedDatabase();
    api['/api/oral/rubric'].mockImplementationOnce(async () => json(502, { detail: 'ИИ-сервис сейчас не ответил. Попробуйте ещё раз.', code: 'ai_failed' }));
    await renderPage(ticketUrl());
    expect(await screen.findByText('ИИ-сервис сейчас не ответил. Попробуйте ещё раз.')).toBeInTheDocument();
    expect(screen.queryByText(/нет в ваших лекциях/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    await readyToAnswer();
    expect(api['/api/oral/rubric']).toHaveBeenCalledTimes(2);
  });

  it('says the daily limit is spent, without a dialog and without answering', async () => {
    seedDatabase();
    mocks.checkAILimit.mockResolvedValue({ allowed: false, isPro: false, count: 100, ok: true });
    await renderPage(ticketUrl());
    // «Обновится в 3:00»: the hour without a leading zero (redesign critique 4, spec 3.10).
    expect(await screen.findByText(/^Дневной лимит исчерпан\. Обновится в [1-9]?\d:\d\d\.$/)).toBeInTheDocument();
    expect(screen.queryByText(/Обновится в 0\d:/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Отвечать голосом' })).toBeNull();
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(callsTo('/api/oral/evaluate')).toHaveLength(0);
  });
});

describe('ExamTicket: answering without a check', () => {
  it('lets the student answer when the lectures have no text, and keeps the answer for a self-rating', async () => {
    const rpc = vi.fn(async () => ({ data: SAVED, error: null }));
    seedDatabase({ rpc });
    api['/api/oral/rubric'].mockImplementation(async () => json(422, { detail: 'В лекциях этого экзамена нет текста', code: 'no_text' }));
    await renderPage(ticketUrl());
    expect(await screen.findByRole('heading', { name: 'У лекций этого экзамена нет текста' })).toBeInTheDocument();
    expect(screen.getByText(/Можно ответить без проверки/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Добавить лекции' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    // While answering, the reason gives way to the field.
    expect(screen.queryByRole('heading', { name: 'У лекций этого экзамена нет текста' })).toBeNull();
    expect(screen.getByText('Ответ без проверки: после него оцените себя сами.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(screen.getByText('Ответ пустой: скажите или напишите ответ, потом нажмите «Готово».')).toBeInTheDocument();
    typeAnswer('Энтропия — мера неопределённости, бит — её единица.');
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));

    expect(await screen.findByRole('heading', { name: 'Ответ не проверялся' })).toBeInTheDocument();
    expect(screen.getByText('У лекций экзамена нет текста — сверять было не с чем.')).toBeInTheDocument();
    expect(screen.getByText('Энтропия — мера неопределённости, бит — её единица.')).toBeInTheDocument();
    const rate = screen.getByRole('group', { name: 'Как вы ответили?' });
    fireEvent.click(within(rate).getByRole('button', { name: 'плаваю' }));
    await waitFor(() => expect(screen.getByText('Отмечено «плаваю» — видно на листе экзамена.')).toBeInTheDocument());
    expect(mocks.recordSelfRating).toHaveBeenCalledWith(
      expect.objectContaining({ questionHash: HASH, rating: 'unsure', examId: EXAM, examQuestionId: Q1, materialId: 'mat-1' }),
    );
    expect(within(rate).getByRole('button', { name: 'плаваю' })).toHaveAttribute('aria-pressed', 'true');
    // Nothing was checked, graded, charged or recorded as an oral answer.
    expect(callsTo('/api/oral/check')).toHaveLength(0);
    expect(callsTo('/api/oral/evaluate')).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.incrementAIUsage).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();

    // The way to a reference: the editor at the exam's lectures.
    fireEvent.click(screen.getByRole('button', { name: 'Добавить лекции' }));
    await waitFor(() => expect(location).toBe(`/exams/${EXAM}/edit`));
  });

  it('names an exam without lectures as such and leads to choosing them', async () => {
    seedDatabase();
    api['/api/oral/rubric'].mockImplementation(async () => json(422, { detail: 'К экзамену не выбраны лекции', code: 'no_lectures' }));
    await renderPage(ticketUrl());
    expect(await screen.findByRole('heading', { name: 'К экзамену не выбраны лекции' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Выбрать лекции' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Ответить текстом' })).toBeEnabled();
  });

  it('shows the lectures’ nearest fragments again after an answer to a question they do not cover (409)', async () => {
    seedDatabase();
    api['/api/oral/rubric'].mockImplementation(async () =>
      json(409, { detail: 'Этого вопроса нет в ваших лекциях — оценить ответ не по чему.', code: 'not_in_lectures' }),
    );
    await renderPage(`/exams/${EXAM}/ticket?q=${Q2}`);
    await screen.findByRole('heading', { name: 'Этого вопроса нет в ваших лекциях — оценить ответ не по чему.' });
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    // No crib while answering.
    expect(screen.queryByText('Функция активации определяет выход нейрона')).toBeNull();
    typeAnswer('Функция активации добавляет нелинейность.');
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByRole('heading', { name: 'Ответ не проверялся' })).toBeInTheDocument();
    expect(screen.getByText('Этого вопроса нет в ваших лекциях — сверять было не с чем.')).toBeInTheDocument();
    expect(screen.getByText('Функция активации определяет выход нейрона')).toBeInTheDocument();
  });

  it('lets the student answer with the day’s checks spent and compare with the reference’s points', async () => {
    const rpc = vi.fn(async () => ({ data: SAVED, error: null }));
    seedDatabase({ rpc });
    mocks.checkAILimit.mockResolvedValue({ allowed: false, isPro: false, count: 100, ok: true });
    await renderPage(ticketUrl());
    expect(await screen.findByText(/^Дневной лимит исчерпан\. Обновится в [1-9]?\d:\d\d\.$/)).toBeInTheDocument();
    expect(screen.getByText('Можно ответить без проверки — после ответа сравните его с пунктами из лекций сами.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByRole('heading', { name: 'Ответ не проверялся' })).toBeInTheDocument();
    expect(screen.getByText('Проверки на сегодня закончились — сравните ответ с пунктами из лекций сами.')).toBeInTheDocument();
    expect(screen.getByText('Пункты ответа из лекций: сравните со своим ответом')).toBeInTheDocument();
    // The titles of the reference open now, for the comparison (they stayed hidden while answering).
    expect(screen.getByText(DEMO_RUBRIC.points[3].title)).toBeInTheDocument();
    expect(callsTo('/api/oral/check')).toHaveLength(0);
    expect(callsTo('/api/oral/evaluate')).toHaveLength(0);
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('offers the way the student answered last time first', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    seedDatabase();
    const first = await renderPage(ticketUrl());
    await readyToAnswer();
    expect(document.querySelector('.or-choice .sf-primary')).toHaveTextContent('Отвечать голосом');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    expect(window.localStorage.getItem('meldy_oral_mode')).toBe('text');
    first.unmount();
    await renderPage(ticketUrl());
    await readyToAnswer();
    expect(document.querySelector('.or-choice .sf-primary')).toHaveTextContent('Ответить текстом');
    expect(document.querySelector('.or-choice .or-alt')).toHaveTextContent('Отвечать голосом');
  });
});

describe('ExamTicket: answering by text', () => {
  beforeEach(() => {
    // «Так…» is not cached here, so the follow-up comes right after the check.
    ttsFailing.add('Так…');
  });

  it('opens rows as soon as the words match, asks the follow-up, takes «Не знаю» offline and saves once', async () => {
    const rpc = vi.fn(async () => ({ data: SAVED, error: null }));
    seedDatabase({ rpc });
    const { container } = await renderPage(ticketUrl());
    await readyToAnswer();
    expect(screen.getByText('В этом браузере голосовой ввод недоступен — ответьте текстом.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    // The rows open in the same render that brought the words.
    expect(Array.from(container.querySelectorAll('[data-named]')).map((row) => row.getAttribute('data-point'))).toEqual(['p1', 'p2', 'p3', 'p5']);
    expect(container.textContent).not.toContain(DEMO_RUBRIC.points[3].title);
    expect(screen.getByRole('status', { name: '' })).toBeDefined();

    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText(`«${Q4}»`)).toBeInTheDocument();
    expect(bodyOf(callsTo('/api/oral/check')[0])).toMatchObject({ transcript: DEMO_ANSWER, only: null });
    expect(callsTo('/api/oral/evaluate')).toHaveLength(1);
    expect(bodyOf(callsTo('/api/oral/evaluate')[0]).transcript).toBe(DEMO_ANSWER);
    // The asked row gets a brace and keeps its title hidden.
    expect(container.querySelector('[data-point="p4"] svg[data-mark="brace"]')).not.toBeNull();
    expect(container.textContent).not.toContain(DEMO_RUBRIC.points[3].title);
    // The follow-up is voiced from the persistent cache: one request for it, made by the prefetch.
    await waitFor(() => expect(audiosFor(Q4)).toHaveLength(1));
    expect(ttsTexts().filter((text) => text === Q4)).toHaveLength(1);

    const requests = fetchMock.mock.calls.length;
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByText(/Сохранено в историю и/)).toBeInTheDocument();
    expect(fetchMock.mock.calls.length).toBe(requests);

    // The memo's stage example: «Не знаю» on the follow-up about a missing main point. Its grade, a 3
    // ((2 + 2 + 1 + 0 + 1) / 9 = 67, capped), goes to the save only (Ф1): the screen says what was named.
    expect(document.querySelector('.or-sum')?.textContent?.replace(/\u00a0/g, ' ')).toBe('Назвали сами 2 из 4 главных');
    expect(screen.getByText('Раскрыто 3 пункта из 5, один упомянут, один не назван.')).toBeInTheDocument();
    expect(screen.getByText(SCALE_NOTE)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Итог' })).toBeInTheDocument();
    expect(container.querySelector('svg[data-mark="oval"], .or-stamp')).toBeNull();
    expect(container.textContent).not.toMatch(/[Зз]ачтено|[Зз]асчитан|Оценка|удовлетвор|хорошо ·/);
    fireEvent.click(screen.getByRole('button', { name: 'Как считается' }));
    expect(container.querySelector('.or-how')?.textContent).not.toMatch(/из 100|→|оценк/);
    expect(screen.getByText('Пропущенный пункт стал карточкой — она вернётся в повторении завтра.')).toBeInTheDocument();
    expect(container.querySelector('.or-extra')?.textContent).toContain('ответ: не знаю.');

    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0] as unknown as [string, { p_attempt: Record<string, unknown> }];
    expect(fn).toBe('record_oral_attempt');
    const payload = args.p_attempt as {
      attempt_id: string;
      points: Array<{ id: string; status: string; credit: number; live: boolean; source_ids: string[]; material_id: string; source_label: string }>;
    } & Record<string, unknown>;
    expect(payload.attempt_id).toMatch(/^[A-Za-z0-9_-]{8,64}$/);
    expect(payload).toMatchObject({
      exam_question_id: Q1,
      rubric_id: RUBRIC_ID,
      material_id: 'mat-1',
      input: 'text',
      score: 67,
      grade: 3,
      confidence: null,
      make_card: true,
      verdict: 'Повторите скорость обучения.',
      followup: { point_id: 'p4', question: Q4, status: 'missing', student_quote: 'не знаю', chosen_by: 'check' },
    });
    expect(payload.points.map((point) => [point.id, point.status, point.credit, point.live])).toEqual([
      ['p1', 'covered', 1, true],
      ['p2', 'covered', 1, true],
      ['p3', 'partial', 0.5, true],
      ['p4', 'missing', 0, false],
      ['p5', 'covered', 1, true],
    ]);
    expect(payload.points[0]).toMatchObject({ source_ids: ['S12'], material_id: 'mat-1', source_label: '«Нейронные сети», фрагмент 12' });
    expect(mocks.incrementAIUsage).toHaveBeenCalledTimes(1);
    expect(mocks.incrementAIUsage).toHaveBeenCalledWith();
    expect(rpc.mock.invocationCallOrder[0]).toBeLessThan(mocks.incrementAIUsage.mock.invocationCallOrder[0]);
    // The exam sheet learns which question changed.
    expect(JSON.parse(window.sessionStorage.getItem(`meldy_exam_peak_${EXAM}`) ?? '[]')).toEqual([{ hash: HASH, question_id: Q1, before: 'untested' }]);
    // The question was never voiced.
    expect(FakeAudio.instances.map((audio) => audio.text)).not.toContain(DEMO_QUESTION);
  });

  it('says «Хорошо, по существу всё» and opens the protocol when there is nothing to ask', async () => {
    seedDatabase({ rpc: vi.fn(async () => ({ data: { ...SAVED, card_added: false }, error: null })) });
    api['/api/oral/check'].mockImplementation(async () => json(200, { statuses: { p1: 'covered', p2: 'covered', p3: 'covered', p4: 'covered', p5: 'covered' }, ask: null }));
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(FULL_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText(/Сохранено в историю и/)).toBeInTheDocument();
    expect(screen.queryByText(`«${Q4}»`)).toBeNull();
    await waitFor(() => expect(audiosFor('Хорошо, по существу всё')).toHaveLength(1));
  });

  it('says on the protocol what the answer changed on the cheat sheet, and leads there', async () => {
    seedDatabase({ rpc: vi.fn(async () => ({ data: { ...SAVED, card_added: false }, error: null })) });
    api['/api/oral/check'].mockImplementation(async () => json(200, { statuses: { p1: 'covered', p2: 'covered', p3: 'covered', p4: 'covered', p5: 'covered' }, ask: null }));
    // p1 was named three days ago too: this answer erases it; the other four are named for the first time.
    const point = (id: string, session: string, daysAgo: number) => {
      const at = new Date(Date.now() - daysAgo * 86_400_000 - 60_000);
      const title = DEMO_RUBRIC.points.find((item) => item.id === id)!.title;
      return {
        id: `${session}-${id}`,
        created_at: at.toISOString(),
        local_date: `${at.getFullYear()}-${String(at.getMonth() + 1).padStart(2, '0')}-${String(at.getDate()).padStart(2, '0')}`,
        material_id: null,
        kind: 'oral_point',
        item_key: `oral:${RUBRIC_ID}:${id}`,
        correct: true,
        score: null,
        confidence: null,
        source_ids: [],
        session_id: session,
        payload: { v: 1, question_hash: HASH, rubric_id: RUBRIC_ID, point_id: id, title, status: 'covered' },
      };
    };
    mocks.fetchSheetEvents.mockResolvedValue([point('p1', PREVIOUS_SESSION, 3), ...['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => point(id, SESSION, 0))]);
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(FULL_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText(/Сохранено в историю и/)).toBeInTheDocument();
    const line = await screen.findByText((_, element) => element?.classList.contains('or-sheet-change') === true);
    expect(line.textContent?.replace(/\u00a0/g, ' ')).toBe('На шпаргалке: 1 строка стёрлась, 4 — наполовину · посмотреть');
    expect(mocks.fetchSheetEvents).toHaveBeenCalledWith([HASH]);
    expect(screen.queryByRole('button', { name: 'Лист экзамена' })).not.toBeNull(); // the top line keeps its way back
    fireEvent.click(within(line).getByRole('button', { name: 'посмотреть' }));
    await waitFor(() => expect(location + search).toBe(`/exams/${EXAM}?view=sheet`));
  });

  it('«К шпаргалке» on the protocol opens the exam on its cheat sheet', async () => {
    seedDatabase({ rpc: vi.fn(async () => ({ data: { ...SAVED, card_added: false }, error: null })) });
    api['/api/oral/check'].mockImplementation(async () => json(200, { statuses: { p1: 'covered', p2: 'covered', p3: 'covered', p4: 'covered', p5: 'covered' }, ask: null }));
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(FULL_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText(/Сохранено в историю и/)).toBeInTheDocument();
    // No events of this answer in the journal: no line, the link is there all the same.
    expect(document.querySelector('.or-sheet-change')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'К шпаргалке' }));
    await waitFor(() => expect(location + search).toBe(`/exams/${EXAM}?view=sheet`));
  });

  it('refuses a pasted ready text in the answer and in the reply to the examiner, says why, and lets a term in («Чистый ответ», Н7)', async () => {
    const READY = 'Обучение сети — это подбор весов, которые минимизируют функцию потерь на обучающей выборке.';
    const paste = (target: HTMLElement, text: string) => fireEvent.paste(target, { clipboardData: { getData: () => text } });
    const drop = (target: HTMLElement, text: string) => fireEvent.drop(target, { dataTransfer: { getData: () => text } });
    seedDatabase({ rpc: vi.fn(async () => ({ data: SAVED, error: null })) });
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    const field = screen.getByRole('textbox');
    // More than 8 words: the paste is cancelled, nothing goes in, and the line under the field says why.
    expect(paste(field, READY)).toBe(false);
    expect(field).toHaveValue('');
    expect(screen.getByText(PASTE_REFUSED)).toHaveAttribute('role', 'status');
    expect(field).toHaveAccessibleDescription(PASTE_REFUSED);
    // Typing by hand takes the line away; a term (up to 8 words) is pasted as usual.
    typeAnswer('Обучение сети');
    expect(screen.queryByText(PASTE_REFUSED)).toBeNull();
    expect(paste(field, 'функция потерь')).toBe(true);
    expect(screen.queryByText(PASTE_REFUSED)).toBeNull();
    // Dropped text is the same as pasted; one's own words moved inside the field are not.
    expect(drop(field, READY)).toBe(false);
    expect(screen.getByText(PASTE_REFUSED)).toBeInTheDocument();
    fireEvent.dragStart(field);
    expect(drop(field, READY)).toBe(true);

    // The reply to the examiner's question: the same rule.
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    const reply = await screen.findByRole('textbox', { name: 'Ответ на вопрос экзаменатора' });
    expect(screen.queryByText(PASTE_REFUSED)).toBeNull();
    expect(paste(reply, READY)).toBe(false);
    expect(reply).toHaveValue('');
    expect(reply).toHaveAccessibleDescription(PASTE_REFUSED);
    fireEvent.change(reply, { target: { value: 'Будут колебания' } });
    expect(screen.queryByText(PASTE_REFUSED)).toBeNull();
  });

  it('switches to the point the model names when the browser’s candidate was covered', async () => {
    seedDatabase();
    api['/api/oral/check'].mockImplementation(async () => json(200, { statuses: { p1: 'covered', p2: 'wrong', p3: 'covered', p4: 'covered', p5: 'covered' }, ask: 'p2' }));
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText(`«${Q2_FOLLOWUP}»`)).toBeInTheDocument();
  });

  it('keeps the browser’s candidate when the check does not answer in 5.5 s (chosen_by client)', async () => {
    const rpc = vi.fn(async () => ({ data: SAVED, error: null }));
    seedDatabase({ rpc });
    api['/api/oral/check'].mockImplementation(async (_body, init) => hang(init));
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    // The evaluation does not wait for the check.
    await waitFor(() => expect(callsTo('/api/oral/evaluate')).toHaveLength(1));
    expect(screen.getByText('Экзаменатор слушает ответ…')).toBeInTheDocument();
    expect(screen.queryByText(`«${Q4}»`)).toBeNull();
    // The old 1.5 s are not the end of the wait any more: the server gives the model 4.5 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(screen.queryByText(`«${Q4}»`)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_CONFIRM_TIMEOUT_MS - 1600 + 100);
    });
    expect(await screen.findByText(`«${Q4}»`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    await screen.findByText(/Сохранено в историю и/);
    expect((rpc.mock.calls[0] as unknown as [string, { p_attempt: { followup: { chosen_by: string } } }])[1].p_attempt.followup.chosen_by).toBe('client');
  });

  it.each([
    ['Если взять слишком большую скорость обучения', 'missing', 'по ключевым словам пункт не назван'],
    ['Будут колебания, и сеть может не сойтись', 'partial', 'по ключевым словам пункт упомянут'],
  ])('decides «%s» in the browser when the follow-up check fails → %s, and says so', async (answer, status, verdict) => {
    const rpc = vi.fn(async () => ({ data: SAVED, error: null }));
    seedDatabase({ rpc });
    api['/api/oral/check'].mockImplementation(async (body) =>
      body.only ? json(502, { detail: 'ИИ-сервис сейчас не ответил. Попробуйте ещё раз.', code: 'ai_failed' }) : json(200, { statuses: { p4: 'missing' }, ask: 'p4' }),
    );
    const { container } = await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    const field = await screen.findByRole('textbox', { name: 'Ответ на вопрос экзаменатора' });
    fireEvent.change(field, { target: { value: answer } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await screen.findByText(/Сохранено в историю и/);
    const followupCheck = callsTo('/api/oral/check').map(bodyOf).find((body) => body.only === 'p4');
    expect(followupCheck).toMatchObject({ only: 'p4', followup_question: Q4, transcript: answer });
    expect((rpc.mock.calls[0] as unknown as [string, { p_attempt: { followup: { status: string } } }])[1].p_attempt.followup.status).toBe(status);
    // The browser's key-word rule decided, and the protocol does not pass it off as the check's verdict.
    expect(container.querySelector('.or-extra')?.textContent).toBe(`Дополнительный вопрос: «${Q4}» — ответ: «${answer}», ${verdict}.`);
    expect(container.querySelector('[data-point="p4"] .or-ppt-st')?.textContent).toMatch(new RegExp(`, ${verdict}$`));
  });

  it('labels the follow-up as judged by key words when its check runs past 5.5 s', async () => {
    seedDatabase({ rpc: vi.fn(async () => ({ data: SAVED, error: null })) });
    api['/api/oral/check'].mockImplementation(async (body, init) => (body.only ? hang(init) : json(200, { statuses: { p4: 'missing' }, ask: 'p4' })));
    const { container } = await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    const field = await screen.findByRole('textbox', { name: 'Ответ на вопрос экзаменатора' });
    fireEvent.change(field, { target: { value: 'Будут колебания, и сеть может не сойтись' } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    // The check at «Готово» answered in time, so this one gets the whole wait, not 2.5 s.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_AFTER_FAILED_CHECK_MS + 100);
    });
    expect(screen.queryByText(/Сохранено в историю и/)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_FOLLOWUP_TIMEOUT_MS - CHECK_AFTER_FAILED_CHECK_MS);
    });
    await screen.findByText(/Сохранено в историю и/);
    expect(container.querySelector('.or-extra')?.textContent).toContain('по ключевым словам пункт упомянут.');
  });

  it('waits only once in full: after the check at «Готово» ran out of time, the follow-up’s check waits 2.5 s', async () => {
    const rpc = vi.fn(async () => ({ data: SAVED, error: null }));
    seedDatabase({ rpc });
    api['/api/oral/check'].mockImplementation(async (_body, init) => hang(init));
    const { container } = await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_CONFIRM_TIMEOUT_MS + 100);
    });
    const field = await screen.findByRole('textbox', { name: 'Ответ на вопрос экзаменатора' });
    fireEvent.change(field, { target: { value: 'Будут колебания, и сеть может не сойтись' } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(callsTo('/api/oral/check')).toHaveLength(2));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(CHECK_AFTER_FAILED_CHECK_MS + 100);
    });
    await screen.findByText(/Сохранено в историю и/);
    const followupCheck = callsTo('/api/oral/check').find((call) => bodyOf(call).only === 'p4');
    expect((followupCheck?.[1] as RequestInit).signal?.aborted).toBe(true);
    expect(container.querySelector('.or-extra')?.textContent).toContain('по ключевым словам засчитан частично.');
    const [, args] = rpc.mock.calls[0] as unknown as [string, { p_attempt: { followup: { chosen_by: string; status: string } } }];
    expect(args.p_attempt.followup).toMatchObject({ chosen_by: 'client', status: 'partial' });
  });

  it('takes «не знаю» said instead of an answer as the button: no check, no protocol request, every point missing', async () => {
    const rpc = vi.fn(async () => ({ data: SAVED, error: null }));
    seedDatabase({ rpc });
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer('Ну, не знаю…');
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    // Nothing was named: the examiner asks about the first main point at once.
    expect(await screen.findByText(`«${DEMO_RUBRIC.points[0].followup.question}»`)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    await screen.findByText(/Сохранено в историю и/);
    expect(callsTo('/api/oral/check')).toHaveLength(0);
    expect(callsTo('/api/oral/evaluate')).toHaveLength(0);
    const [, args] = rpc.mock.calls[0] as unknown as [string, { p_attempt: Record<string, unknown> & { points: Array<{ status: string }> } }];
    expect(args.p_attempt.points.map((point) => point.status)).toEqual(['missing', 'missing', 'missing', 'missing', 'missing']);
    expect(args.p_attempt).toMatchObject({ grade: 2, score: 0, verdict: DONT_KNOW_VERDICT, followup: { point_id: 'p1', status: 'missing' } });
  });

  it('keeps an answer whose evaluation failed: no grade, no save, no charge, and the previous protocol', async () => {
    const rpc = vi.fn(async () => ({ data: SAVED, error: null }));
    seedDatabase({
      rpc,
      events: [
        {
          id: 'e1',
          created_at: '2026-10-06T10:00:00Z',
          local_date: '2026-10-06',
          material_id: null,
          kind: 'exam_answer',
          item_key: `q:${HASH}`,
          correct: true,
          score: 0.78,
          confidence: null,
          source_ids: [],
          session_id: PREVIOUS_SESSION,
          payload: { grade: 4, score_pct: 78 },
        },
      ],
    });
    api['/api/oral/check'].mockImplementation(async () => json(200, { statuses: { p1: 'covered', p2: 'covered', p3: 'covered', p4: 'covered', p5: 'covered' }, ask: null }));
    api['/api/oral/evaluate'].mockImplementation(async () => json(502, { detail: 'ИИ-сервис сейчас не ответил. Попробуйте ещё раз.', code: 'ai_failed' }));
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(FULL_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText('Не удалось проверить ответ: сервис занят. Ответ сохранён на этой странице — попробуйте через минуту.')).toBeInTheDocument();
    expect(document.querySelector('.or-sum, .or-ph-sheet')).toBeNull();
    expect(document.body.textContent).not.toMatch(/[Зз]асчитан|Оценк/);
    expect(screen.getByText('Предварительно: по ключевым словам')).toBeInTheDocument();
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.incrementAIUsage).not.toHaveBeenCalled();
    const previous = screen.getByRole('link', { name: /^Открыть протокол прошлого ответа \(6\sокт\.\)$/ });
    expect(previous).toHaveAttribute('href', `/exams/${EXAM}/ticket?session=${PREVIOUS_SESSION}`);
    await waitFor(() =>
      expect(JSON.parse(window.sessionStorage.getItem('meldy_oral_attempt') ?? '{}')).toMatchObject({ examId: EXAM, questionId: Q1, transcript: FULL_ANSWER }),
    );

    api['/api/oral/evaluate'].mockImplementation(async () => json(200, EVALUATION));
    fireEvent.click(screen.getByRole('button', { name: 'Проверить снова' }));
    expect(await screen.findByText(/Сохранено в историю и/)).toBeInTheDocument();
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(window.sessionStorage.getItem('meldy_oral_attempt')).toBeNull();
    // The previous answer has its own muted line under «Как считается»; its date leads to that protocol
    // (redesign critique 4, round 2), with no grade word (Ф1).
    const before = screen.getByRole('link', { name: /^Протокол прошлого ответа, 6\sокт\.$/ });
    expect(before).toHaveAttribute('href', `/exams/${EXAM}/ticket?session=${PREVIOUS_SESSION}`);
    expect(before.textContent?.replace(/\s/g, ' ')).toBe('6 окт.');
    expect(before.closest('.or-prev-line')?.textContent?.replace(/\s/g, ' ')).toBe('Прошлый ответ, 6 окт.');
    expect(before.closest('.or-how-row')).toBeNull();
  });

  it('links the previous answer’s protocol under the exam it was given in', async () => {
    const OTHER = '0e000000-0000-4000-8000-000000000002';
    seedDatabase({
      rpc: vi.fn(async () => ({ data: SAVED, error: null })),
      events: [
        {
          id: 'e1',
          created_at: '2026-10-06T10:00:00Z',
          local_date: '2026-10-06',
          material_id: null,
          kind: 'exam_answer',
          item_key: `q:${HASH}`,
          correct: true,
          score: 0.78,
          confidence: null,
          source_ids: [],
          session_id: PREVIOUS_SESSION,
          payload: { grade: 4, score_pct: 78, exam_id: OTHER },
        },
      ],
    });
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Не знаю' }));
    await screen.findByText(/Сохранено в историю и/);
    expect(screen.getByRole('link', { name: /^Протокол прошлого ответа, 6\sокт\.$/ })).toHaveAttribute('href', `/exams/${OTHER}/ticket?session=${PREVIOUS_SESSION}`);
  });

  it('says «Результат не сохранён», retries with the same attempt id and charges once', async () => {
    let fail = true;
    const rpc = vi.fn(async () => (fail ? { data: null, error: { code: '08006', message: 'down' } } : { data: SAVED, error: null }));
    seedDatabase({ rpc });
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByText(/Результат не сохранён/)).toBeInTheDocument();
    expect(mocks.incrementAIUsage).not.toHaveBeenCalled();
    // Not saved means nothing on the cheat sheet: the journal is not even read for its line yet.
    expect(document.querySelector('.or-ph-sheet, .or-stamp')).toBeNull();
    expect(mocks.fetchSheetEvents).not.toHaveBeenCalled();
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByText(/Сохранено в историю и/)).toBeInTheDocument();
    await waitFor(() => expect(mocks.fetchSheetEvents).toHaveBeenCalledWith([HASH]));
    expect(document.querySelector('.or-stamp')).toBeNull();
    const ids = rpc.mock.calls.map((call) => (call as unknown as [string, { p_attempt: { attempt_id: string } }])[1].p_attempt.attempt_id);
    expect(ids).toHaveLength(2);
    expect(ids[0]).toBe(ids[1]);
    expect(mocks.incrementAIUsage).toHaveBeenCalledTimes(1);
  });

  it('waits for the save in flight when the student leaves, instead of calling the answer unsaved', async () => {
    const { rpc, held } = heldRpc();
    seedDatabase({ rpc });
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByText('Сохраняем…')).toBeInTheDocument();
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Следующий билет' }));
    // A second click while the first one waits does nothing more.
    fireEvent.click(screen.getByRole('button', { name: 'Следующий билет' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(location).toBe('');
    expect(mocks.confirm).not.toHaveBeenCalled();
    await act(async () => {
      held.release();
    });
    await waitFor(() => expect(location).toBe(`/exams/${EXAM}/draw`));
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull();
    expect(peakFlag()).toEqual([{ hash: HASH, question_id: Q1, before: 'untested' }]);
    expect(mocks.incrementAIUsage).toHaveBeenCalledTimes(1);
  });

  it('lets a save that outlasts the wait finish after the student left: the draft goes and the sheet learns', async () => {
    const { rpc, held } = heldRpc();
    seedDatabase({ rpc });
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Не знаю' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));

    // The way back in the top line («‹ Лист экзамена» on a phone); the protocol has its own link too.
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Лист экзамена' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS + 100);
    });
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    // The dialog tells the truth: the answer is being saved, not «ещё не сохранён».
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'Результат ещё сохраняется. Если сохранить не получится, текст ответа останется черновиком на этом устройстве.' }),
    );
    await waitFor(() => expect(location).toBe(`/exams/${EXAM}`));
    expect(window.localStorage.getItem(DRAFT_KEY)).not.toBeNull();
    expect(peakFlag()).toBeNull();

    // The page is gone; the save answers now.
    await act(async () => {
      held.release();
    });
    await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull());
    expect(peakFlag()).toEqual([{ hash: HASH, question_id: Q1, before: 'untested' }]);
    expect(mocks.incrementAIUsage).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['saved', false],
    ['failed', true],
  ] as const)('answering again while the last answer is being saved (%s) offers its draft only if the save failed', async (outcome, offered) => {
    const { rpc, held } = heldRpc();
    seedDatabase({ rpc });
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Не знаю' }));
    await waitFor(() => expect(rpc).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByRole('button', { name: 'Ответить ещё раз' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(SAVE_WAIT_MS + 100);
    });
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    await readyToAnswer();
    // While the save is undecided, the answer being saved is not offered back as a draft.
    expect(screen.queryByText(/Восстановлен черновик ответа/)).toBeNull();

    await act(async () => {
      held.release(outcome);
    });
    if (offered) {
      expect(await screen.findByText(/^Восстановлен черновик ответа от/)).toBeInTheDocument();
      expect(screen.getByRole('textbox')).toHaveValue(DEMO_ANSWER);
      expect(mocks.incrementAIUsage).not.toHaveBeenCalled();
    } else {
      await waitFor(() => expect(window.localStorage.getItem(DRAFT_KEY)).toBeNull());
      expect(screen.queryByText(/Восстановлен черновик ответа/)).toBeNull();
      expect(screen.getByRole('button', { name: 'Ответить текстом' })).toBeInTheDocument();
      expect(peakFlag()).toEqual([{ hash: HASH, question_id: Q1, before: 'untested' }]);
    }
  });

  it('restores a typed draft after a reload and clears it after the save', async () => {
    seedDatabase({ rpc: vi.fn(async () => ({ data: SAVED, error: null })) });
    window.localStorage.setItem(`meldy_answer_draft_${Q1}`, JSON.stringify({ v: 1, text: DEMO_ANSWER, input: 'text', saved_at: new Date(2026, 9, 3, 14, 2).toISOString() }));
    await renderPage(ticketUrl());
    expect(await screen.findByText('Восстановлен черновик ответа от 14:02')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toHaveValue(DEMO_ANSWER);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Готово' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Не знаю' }));
    await screen.findByText(/Сохранено в историю и/);
    expect(window.localStorage.getItem(`meldy_answer_draft_${Q1}`)).toBeNull();
  });

  it('writes the draft half a second after typing stops', async () => {
    seedDatabase();
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer('Обучение — это подбор весов');
    expect(window.localStorage.getItem(`meldy_answer_draft_${Q1}`)).toBeNull();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(JSON.parse(window.localStorage.getItem(`meldy_answer_draft_${Q1}`) ?? '{}')).toMatchObject({ text: 'Обучение — это подбор весов', input: 'text' });
  });

  it('asks before the page’s own links leave an unsaved answer', async () => {
    seedDatabase();
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer('Начало ответа');
    mocks.confirm.mockResolvedValueOnce(false);
    fireEvent.click(screen.getByRole('button', { name: /Выйти из билета/ }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalledTimes(1));
    expect(location).toBe('');
    fireEvent.click(screen.getByRole('button', { name: 'Meldy' }));
    await waitFor(() => expect(location).toBe('/dashboard'));
    expect(mocks.confirm).toHaveBeenCalledTimes(2);
  });

  it('leaves without asking before anything was said', async () => {
    seedDatabase();
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: /Выйти из билета/ }));
    await waitFor(() => expect(location).toBe(`/exams/${EXAM}`));
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('keeps rows closed while answering when live marks are switched off', async () => {
    seedDatabase();
    const { container } = await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Отмечать пункты во время ответа' }));
    expect(window.localStorage.getItem('meldy_oral_live_marks')).toBe('0');
    expect(screen.getByText('Полный ответ — 5 пунктов из ваших лекций.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    expect(container.querySelectorAll('[data-named]')).toHaveLength(0);
    expect(screen.getByText('Отметки во время ответа выключены: пункты откроются в протоколе.')).toBeInTheDocument();
  });

  it('guards a tab close while an answer is unsaved', async () => {
    seedDatabase();
    await renderPage(ticketUrl());
    await readyToAnswer();
    const quiet = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(quiet);
    expect(quiet.defaultPrevented).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer('Начало ответа');
    const guarded = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(guarded);
    expect(guarded.defaultPrevented).toBe(true);
  });

  it('starts the answer over after a confirmation', async () => {
    seedDatabase();
    const { container } = await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    expect(container.querySelectorAll('[data-named]').length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Сначала' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Ответить текстом' })).toBeInTheDocument());
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Начать ответ заново?' }));
    expect(container.querySelectorAll('[data-named]')).toHaveLength(0);
    expect(api['/api/oral/rubric']).toHaveBeenCalledTimes(1);
  });

  it('moves the focus where the answer goes on: the field, the examiner’s question, the protocol', async () => {
    seedDatabase({ rpc: vi.fn(async () => ({ data: SAVED, error: null })) });
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    expect(document.activeElement).toBe(screen.getByRole('textbox'));
    typeAnswer(DEMO_ANSWER);
    const done = screen.getByRole('button', { name: 'Готово' });
    done.focus();
    fireEvent.click(done);
    // «Готово» is gone with its state: the focus goes to the field of the follow-up, not to the page.
    const field = await screen.findByRole('textbox', { name: 'Ответ на вопрос экзаменатора' });
    await waitFor(() => expect(document.activeElement).toBe(field));
    // The question is said to screen readers once, through a polite live region.
    const announced = screen.getByText(`Экзаменатор спрашивает: «${Q4}»`);
    expect(announced).toHaveAttribute('aria-live', 'polite');
    const dontKnow = screen.getByRole('button', { name: 'Не знаю' });
    dontKnow.focus();
    fireEvent.click(dontKnow);
    const title = await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Билет 12' });
    await waitFor(() => expect(document.activeElement).toBe(title));
    await screen.findByText(/Сохранено в историю и/);
    expect(document.activeElement).toBe(title);
  });

  it('leaves the focus alone on arrival', async () => {
    seedDatabase();
    await renderPage(ticketUrl());
    await readyToAnswer();
    expect(document.activeElement).toBe(document.body);
  });

  it('refuses an empty answer without calling the model', async () => {
    seedDatabase();
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(screen.getByText('Ответ пустой: скажите или напишите ответ, потом нажмите «Готово».')).toBeInTheDocument();
    expect(callsTo('/api/oral/check')).toHaveLength(0);
    expect(callsTo('/api/oral/evaluate')).toHaveLength(0);
  });

  it('says the privacy line in full before the answer and keeps it one link away while answering (redesign critique 5, round 2)', async () => {
    const rpc = vi.fn(async () => ({ data: SAVED, error: null }));
    seedDatabase({ rpc });
    await renderPage(ticketUrl());
    await readyToAnswer();
    // No promise of a teacher's view: there is no such screen.
    expect(PRIVACY_LINE).not.toMatch(/преподавател/);
    expect(document.querySelector('.or-privacy')?.textContent).toBe(PRIVACY_LINE);
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    // While answering: no paragraph under «Готово» on any width, one link instead.
    expect(document.querySelector('.or-privacy')).toBeNull();
    const link = screen.getByRole('button', { name: 'Кто видит ответ' });
    expect(link).not.toHaveAttribute('data-muted');
    link.focus();
    fireEvent.click(link);
    const sheet = screen.getByRole('dialog', { name: 'Кто видит ответ' });
    expect(sheet).toHaveAttribute('aria-modal', 'true');
    expect(within(sheet).getByText(PRIVACY_LINE)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Закрыть' })).toHaveFocus();
    // The page under the sheet holds still while it is open.
    expect(document.documentElement.style.overflow).toBe('hidden');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Кто видит ответ' })).toBeNull();
    expect(document.documentElement.style.overflow).toBe('');
    expect(link).toHaveFocus();

    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Не знаю' }));
    await screen.findByText(/Сохранено в историю и/);
    // The protocol does not repeat it; its top line on a phone is only «‹ Лист экзамена».
    expect(document.querySelector('.or-privacy')).toBeNull();
    const bar = screen.getByRole('banner');
    expect(bar).toHaveAttribute('data-back');
    expect(within(bar).getByRole('button', { name: 'Лист экзамена' }).querySelector('svg')).not.toBeNull();
  });
});

describe('ExamTicket: answering aloud', () => {
  beforeEach(() => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
  });

  it('opens a row from interim words, checks the snapshot and listens to the follow-up only after its audio', async () => {
    seedDatabase({ rpc: vi.fn(async () => ({ data: SAVED, error: null })) });
    let releaseCheck: (() => void) | null = null;
    api['/api/oral/check'].mockImplementation(
      (body) =>
        new Promise((resolve) => {
          if (body.only) resolve(json(200, { statuses: { p4: 'partial' }, ask: null }));
          else releaseCheck = () => resolve(json(200, { statuses: { p4: 'missing' }, ask: 'p4' }));
        }),
    );
    const { container } = await renderPage(ticketUrl());
    await readyToAnswer();
    await waitFor(() => expect(ttsTexts()).toContain('Не расслышал ответ'));
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
    const rec = recognition();
    expect(rec.starts).toBe(1);
    act(() => rec.say([['Обучение — это подбор весов,', true], [' которые минимизируют функцию потерь', false]]));
    // A matching interim result opens the row in this very render. Only final words are underlined,
    // and only the words that named the point («потерь» is still interim): nothing yet.
    expect(container.querySelector('[data-point="p1"]')).toHaveAttribute('data-named');
    const underlinedNow = () => Array.from(container.querySelectorAll('.or-said-text .sf-under')).map((node) => node.textContent);
    expect(underlinedNow()).toEqual([]);
    act(() => rec.say([['Обучение — это подбор весов,', true], [' которые минимизируют функцию потерь', true]]));
    expect(underlinedNow()).toEqual(['потерь']);

    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(rec.stops).toBe(1);
    await waitFor(() => expect(callsTo('/api/oral/check')).toHaveLength(1));
    expect(bodyOf(callsTo('/api/oral/check')[0]).transcript).toBe('Обучение — это подбор весов, которые минимизируют функцию потерь');
    act(() => {
      rec.say([['Обучение — это подбор весов,', true], [' которые минимизируют функцию потерь', true]]);
      rec.end();
    });
    // The evaluation starts on the final text while the check is still out.
    await waitFor(() => expect(callsTo('/api/oral/evaluate')).toHaveLength(1));
    expect(bodyOf(callsTo('/api/oral/evaluate')[0]).transcript).toBe('Обучение — это подбор весов, которые минимизируют функцию потерь');
    act(() => releaseCheck?.());
    // «Так…» was cached by the prefetch, so it plays first; the question waits for its end.
    await waitFor(() => expect(audiosFor('Так…')).toHaveLength(1));
    expect(screen.queryByText(`«${Q4}»`)).toBeNull();
    act(() => audiosFor('Так…')[0].onended?.());

    expect(await screen.findByText(`«${Q4}»`)).toBeInTheDocument();
    await waitFor(() => expect(audiosFor(Q4)).toHaveLength(1));
    expect(ttsTexts().filter((text) => text === Q4)).toHaveLength(1);
    // The microphone stays closed while the examiner speaks…
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(rec.starts).toBe(1);
    // …and opens 300 ms after the question ended.
    act(() => audiosFor(Q4)[0].onended?.());
    expect(rec.starts).toBe(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(rec.starts).toBe(2);

    act(() => rec.say([['Будут колебания', true]]));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    act(() => rec.end());
    expect(await screen.findByText(/Сохранено в историю и/)).toBeInTheDocument();
    const followupCheck = callsTo('/api/oral/check').map(bodyOf).find((body) => body.only === 'p4');
    expect(followupCheck).toMatchObject({ transcript: 'Будут колебания', followup_question: Q4 });
    // The check answered: its verdict is given as is.
    expect(container.querySelector('.or-extra')?.textContent).toBe(`Дополнительный вопрос: «${Q4}» — ответ: «Будут колебания», пункт упомянут.`);
  });

  it('stages peak 2: one secondary count line, the question shows, the voice comes 300 ms later (redesign critique 3, round 2; Jury_Check 7, 9)', async () => {
    ttsFailing.add('Так…');
    seedDatabase();
    const { container } = await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
    const rec = recognition();
    act(() => rec.say([[DEMO_ANSWER, true]]));
    // While answering: one 17 px line by key words and the fine line, never the 64 px «Названо 4 из 5».
    expect(container.querySelector('.or-count .or-count-line')?.textContent?.replace(/\s+/g, ' ')).toBe('По ключевым словам: 4 из 5');
    expect(container.querySelector('.or-count .or-count-fine')?.textContent).toBe('итог — после ответа');
    expect(container.querySelector('.or-count-big')).toBeNull();
    expect(container.textContent).not.toMatch(/Названо/);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    act(() => rec.end());
    // From «Готово» on the same line stays.
    await waitFor(() => expect(container.querySelector('.or-count')).toBeNull());
    expect(container.querySelector('.or-count-line')?.textContent?.replace(/\s+/g, ' ')).toBe('По ключевым словам: 4 из 5');
    expect(await screen.findByText(`«${Q4}»`)).toBeInTheDocument();
    // The question is set large (a short question: 40 px) and the privacy text is not on the desk.
    expect(container.querySelector('.or-examiner-q')).toHaveAttribute('data-size', 'l');
    expect(document.querySelector('.or-privacy')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Кто видит ответ' })).toBeNull();
    // The question is on screen before the voice: nothing plays in the first 300 ms.
    expect(audiosFor(Q4)).toHaveLength(0);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(320);
    });
    await waitFor(() => expect(audiosFor(Q4)).toHaveLength(1));
  });

  it('heads the answer sheet with the phone strip: two paper objects, the strip’s marks provisional (redesign critique 10, round 2)', async () => {
    seedDatabase();
    const { container } = await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
    act(() => recognition().say([[DEMO_ANSWER, true]]));
    const strip = container.querySelector('.or-strip') as HTMLElement;
    expect(strip.closest('.or-sheet')).not.toBeNull();
    expect(strip).not.toHaveClass('sf-sheet');
    expect(container.querySelectorAll('.or-left .sf-sheet, .or-left .sf-index-card')).toHaveLength(2);
    // The same provisional dots as the sheet, and the same words as the desk's count line.
    expect(strip.querySelectorAll('svg[data-mark="dot"]')).toHaveLength(4);
    expect(strip.querySelector('svg[data-mark="tick"], svg[data-mark="dtick"]')).toBeNull();
    expect(strip.querySelector('.or-strip-count')?.textContent?.replace(/\s+/g, ' ')).toBe('По ключевым словам: 4 из 5 итог — после ответа');
    expect(strip.querySelector('.or-strip-fine')?.textContent).toBe('итог — после ответа');
    // The strip comes first in the sheet, the answer after it.
    expect(strip.compareDocumentPosition(container.querySelector('.or-said') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('keeps the voice silent when «Не знаю» comes before it', async () => {
    ttsFailing.add('Так…');
    seedDatabase({ rpc: vi.fn(async () => ({ data: SAVED, error: null })) });
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
    const rec = recognition();
    act(() => rec.say([[DEMO_ANSWER, true]]));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    act(() => rec.end());
    fireEvent.click(await screen.findByRole('button', { name: 'Не знаю' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(audiosFor(Q4)).toHaveLength(0);
  });

  it('plays «Так…» only when it is ready, and the follow-up after it', async () => {
    seedDatabase();
    await renderPage(ticketUrl());
    await readyToAnswer();
    await waitFor(() => expect(ttsTexts()).toContain('Не расслышал ответ'));
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
    const rec = recognition();
    act(() => rec.say([[DEMO_ANSWER, true]]));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    act(() => rec.end());
    await waitFor(() => expect(audiosFor('Так…')).toHaveLength(1));
    expect(ttsTexts().filter((text) => text === 'Так…')).toHaveLength(1);
    expect(audiosFor(Q4)).toHaveLength(0);
    act(() => audiosFor('Так…')[0].onended?.());
    await waitFor(() => expect(audiosFor(Q4)).toHaveLength(1));
  });

  it('skips an unready «Так…» without asking the server for it', async () => {
    seedDatabase();
    ttsFailing.add('Так…');
    await renderPage(ticketUrl());
    await readyToAnswer();
    await waitFor(() => expect(ttsTexts()).toContain('Не расслышал ответ'));
    const before = ttsTexts().filter((text) => text === 'Так…').length;
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
    const rec = recognition();
    act(() => rec.say([[DEMO_ANSWER, true]]));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    act(() => rec.end());
    await waitFor(() => expect(audiosFor(Q4)).toHaveLength(1));
    expect(audiosFor('Так…')).toHaveLength(0);
    expect(ttsTexts().filter((text) => text === 'Так…')).toHaveLength(before);
  });

  it('repeats the question without taking it as the answer and listens again after it', async () => {
    seedDatabase();
    ttsFailing.add('Так…');
    await renderPage(ticketUrl());
    await readyToAnswer();
    await waitFor(() => expect(ttsTexts()).toContain('Не расслышал ответ'));
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
    const rec = recognition();
    act(() => rec.say([[DEMO_ANSWER, true]]));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    act(() => rec.end());
    await waitFor(() => expect(audiosFor(Q4)).toHaveLength(1));
    act(() => audiosFor(Q4)[0].onended?.());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(rec.starts).toBe(2);
    act(() => rec.say([['Будут', false]]));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить вопрос' }));
    await waitFor(() => expect(audiosFor(Q4)).toHaveLength(2));
    expect(screen.queryByText('Не расслышал ответ.')).toBeNull();
    expect(rec.running).toBe(false);
    act(() => audiosFor(Q4)[1].onended?.());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(rec.starts).toBe(3);
  });

  it('carries a typed follow-up answer into the spoken one and back', async () => {
    seedDatabase();
    ttsFailing.add('Так…');
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    const field = await screen.findByRole('textbox', { name: 'Ответ на вопрос экзаменатора' });
    fireEvent.change(field, { target: { value: 'Будут колебания' } });
    fireEvent.click(screen.getByRole('button', { name: 'Голосом' }));
    // The typed words stay on the sheet as the start of the spoken answer.
    expect(screen.getByText('Будут колебания')).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    const rec = recognition();
    expect(rec.running).toBe(true);
    act(() => rec.say([['и сеть не сойдётся', true]]));
    fireEvent.click(screen.getByRole('button', { name: 'Текстом' }));
    const back = screen.getByRole('textbox', { name: 'Ответ на вопрос экзаменатора' });
    expect(back).toHaveValue('Будут колебания и сеть не сойдётся');
    expect(document.activeElement).toBe(back);
  });

  it('starts the follow-up’s answer empty: the main answer is not carried into it', async () => {
    seedDatabase();
    ttsFailing.add('Так…');
    await renderPage(ticketUrl());
    await readyToAnswer();
    await waitFor(() => expect(ttsTexts()).toContain('Не расслышал ответ'));
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
    const rec = recognition();
    act(() => rec.say([[DEMO_ANSWER, true]]));
    const done = screen.getByRole('button', { name: 'Готово' });
    done.focus();
    fireEvent.click(done);
    act(() => rec.end());
    await waitFor(() => expect(audiosFor(Q4)).toHaveLength(1));
    // The focus waits on «Отвечать» while the examiner asks.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Отвечать' }));
    // The student prefers to write while the question is still being said.
    fireEvent.click(screen.getByRole('button', { name: 'Текстом' }));
    const field = screen.getByRole('textbox', { name: 'Ответ на вопрос экзаменатора' });
    expect(field).toHaveValue('');
    expect(document.activeElement).toBe(field);
  });

  it('keeps what was said before «Повторить вопрос» when «Отвечать» is pressed during the repeat', async () => {
    seedDatabase({ rpc: vi.fn(async () => ({ data: SAVED, error: null })) });
    ttsFailing.add('Так…');
    api['/api/oral/check'].mockImplementation(async (body) =>
      body.only ? json(200, { statuses: { p4: 'partial' }, ask: null }) : json(200, { statuses: { p4: 'missing' }, ask: 'p4' }),
    );
    await renderPage(ticketUrl());
    await readyToAnswer();
    await waitFor(() => expect(ttsTexts()).toContain('Не расслышал ответ'));
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
    const rec = recognition();
    act(() => rec.say([[DEMO_ANSWER, true]]));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    act(() => rec.end());
    await waitFor(() => expect(audiosFor(Q4)).toHaveLength(1));
    act(() => audiosFor(Q4)[0].onended?.());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(rec.starts).toBe(2);
    act(() => rec.say([['Будут', true]]));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить вопрос' }));
    await waitFor(() => expect(audiosFor(Q4)).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать' }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(rec.starts).toBe(3);
    act(() => rec.say([['колебания', true]]));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    act(() => rec.end());
    await screen.findByText(/Сохранено в историю и/);
    expect(callsTo('/api/oral/check').map(bodyOf).find((body) => body.only === 'p4')).toMatchObject({ transcript: 'Будут колебания' });
  });

  it('keeps what was said when the question is repeated twice and the microphone opens by itself', async () => {
    seedDatabase({ rpc: vi.fn(async () => ({ data: SAVED, error: null })) });
    ttsFailing.add('Так…');
    api['/api/oral/check'].mockImplementation(async (body) =>
      body.only ? json(200, { statuses: { p4: 'partial' }, ask: null }) : json(200, { statuses: { p4: 'missing' }, ask: 'p4' }),
    );
    await renderPage(ticketUrl());
    await readyToAnswer();
    await waitFor(() => expect(ttsTexts()).toContain('Не расслышал ответ'));
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
    const rec = recognition();
    act(() => rec.say([[DEMO_ANSWER, true]]));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    act(() => rec.end());
    await waitFor(() => expect(audiosFor(Q4)).toHaveLength(1));
    act(() => audiosFor(Q4)[0].onended?.());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    act(() => rec.say([['Будут', true]]));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить вопрос' }));
    await waitFor(() => expect(audiosFor(Q4)).toHaveLength(2));
    fireEvent.click(screen.getByRole('button', { name: 'Повторить вопрос' }));
    await waitFor(() => expect(audiosFor(Q4)).toHaveLength(3));
    act(() => audiosFor(Q4)[2].onended?.());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(rec.starts).toBe(3);
    act(() => rec.say([['колебания', true]]));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    act(() => rec.end());
    await screen.findByText(/Сохранено в историю и/);
    expect(callsTo('/api/oral/check').map(bodyOf).find((body) => body.only === 'p4')).toMatchObject({ transcript: 'Будут колебания' });
  });

  it('moves to the text field when the microphone is denied, keeping what was heard', async () => {
    seedDatabase();
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
    const rec = recognition();
    act(() => rec.say([['Обучение — это подбор весов', true]]));
    act(() => {
      rec.onerror?.({ error: 'not-allowed' });
      rec.end();
    });
    expect(await screen.findByRole('textbox')).toHaveValue('Обучение — это подбор весов');
    expect(screen.getByText(/Браузер не дал доступ к микрофону/)).toBeInTheDocument();
  });
});

describe('ExamTicket: when the browser does not recognise speech', () => {
  beforeEach(() => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    media.supported = true;
    media.recorders = [];
    media.texts = [];
  });
  afterEach(() => {
    media.supported = false;
  });

  it('continues the same answer on the server after a recognition error, and «Готово» waits for the last words', async () => {
    seedDatabase({ rpc: vi.fn(async () => ({ data: SAVED, error: null })) });
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
    act(() => recognition().say([['Обучение — это подбор весов', true]]));
    act(() => recognition().onerror?.({ error: 'network' }));
    // No «нужен интернет» and no switch to the text field: the answer goes on, now on the server.
    expect(screen.getByText(SWITCHED_TO_SERVER_NOTICE)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /Ваш ответ/ })).not.toBeInTheDocument();
    expect(screen.getByText('Слушаю. Текст появляется после каждой паузы.')).toBeInTheDocument();
    expect(media.recorders).toHaveLength(1);
    act(() => media.recorders[0].piece());
    expect(screen.getByText('Распознаём сказанное…')).toBeInTheDocument();
    expect(media.texts[0].hint).toBe(DEMO_QUESTION);
    await act(async () => {
      media.texts[0].resolve('которые минимизируют функцию потерь');
      await Promise.resolve();
    });
    expect(document.querySelector('.or-said-text')?.textContent).toContain('Обучение — это подбор весов которые минимизируют функцию потерь');
    // «Готово»: the phrase still being recorded goes to the server first.
    media.recorders[0].flushPiece = true;
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await waitFor(() => expect(media.texts).toHaveLength(2));
    expect(screen.getByText('Распознаём последние слова…')).toBeInTheDocument();
    expect(callsTo('/api/oral/check')).toHaveLength(0);
    await act(async () => {
      media.texts[1].resolve('с помощью градиентного спуска.');
      await Promise.resolve();
    });
    await waitFor(() => expect(callsTo('/api/oral/check')).toHaveLength(1));
    expect(bodyOf(callsTo('/api/oral/check')[0]).transcript).toBe(
      'Обучение — это подбор весов которые минимизируют функцию потерь с помощью градиентного спуска.',
    );
  });

  it('moves to the server when the browser sends no words, and then says who hears the answer', async () => {
    seedDatabase();
    await renderPage(ticketUrl());
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
    expect(media.recorders).toHaveLength(0);
    await act(async () => {
      vi.advanceTimersByTime(7100);
    });
    expect(screen.getByText(CHOSE_SERVER_NOTICE)).toBeInTheDocument();
    expect(media.recorders).toHaveLength(1);
    expect(recognition().running).toBe(false);
    expect(screen.getByText('Слушаю. Текст появляется после каждой паузы.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Кто видит ответ' }));
    expect(screen.getByText(PRIVACY_SERVER_LINE)).toBeInTheDocument();
    expect(screen.queryByText(PRIVACY_LINE)).not.toBeInTheDocument();
  });
});

describe('ExamTicket: a saved protocol, read only', () => {
  const sessionRow = {
    id: SESSION,
    kind: 'oral_ticket',
    subject: 'Нейросети',
    score: 67,
    completed_at: '2026-10-07T14:02:00',
    created_at: '2026-10-07T14:01:00',
    questions_json: [
      {
        v: 1,
        exam_id: EXAM,
        exam_question_id: Q1,
        rubric_id: RUBRIC_ID,
        question_hash: HASH,
        question: DEMO_QUESTION,
        input: 'speech',
        points: DEMO_RUBRIC.points.map((point, index) => ({
          id: point.id,
          title: point.title,
          essential: point.essential,
          status: ['covered', 'covered', 'partial', 'missing', 'covered'][index],
          credit: [1, 1, 0.5, 0, 1][index],
          student_quote: index === 0 ? 'подбор весов' : '',
          comment: '',
          source_ids: [`S1${index + 2}`],
          material_id: 'mat-1',
          source_quote: point.source_quote,
          source_label: `«Нейронные сети», фрагмент 1${index + 2}`,
          live: index !== 3,
        })),
        followup: { point_id: 'p4', question: Q4, expected: 'Колебания.', status: 'missing', student_quote: 'не знаю', chosen_by: 'check' },
        errors: [],
        verdict: 'Повторите скорость обучения.',
        grade: 4,
        formula: 'v1',
      },
    ],
  };

  it('renders the stored protocol with its date and makes no save, call, charge or recording', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    const rpc = vi.fn(async () => ({ data: SAVED, error: null }));
    seedDatabase({ rpc, sessions: [sessionRow] });
    const { container } = await renderPage(`/exams/${EXAM}/ticket?session=${SESSION}`);
    expect(await screen.findByText('Ответ от 7 окт., 14:02')).toBeInTheDocument();
    // A 4 saved with «не знаю» before formula v2: the grade is not shown (Ф1), only what was named.
    expect(summaryText()).toBe('Назвали сами 2 из 4 главных');
    expect(screen.getByText(SCALE_NOTE)).toBeInTheDocument();
    expect(container.textContent).not.toMatch(/[Зз]асчитан|Оценк|хорошо ·|правилу, которое действовало/);
    // A saved protocol read later does not know what it did to the sheet then: no line under the date.
    expect(container.querySelector('.or-ph-sheet, .or-stamp')).toBeNull();
    for (const point of DEMO_RUBRIC.points) expect(screen.getByText(point.title)).toBeInTheDocument();
    expect(container.querySelector('.or-extra')?.textContent).toContain('ответ: не знаю.');
    expect(container.querySelector('[data-point="p1"] .or-q2 [data-mark="under"]')).not.toBeNull();
    expect(rpc).not.toHaveBeenCalled();
    expect(fetchMock.mock.calls.filter((call) => String(call[0]).startsWith('/api/oral/'))).toHaveLength(0);
    expect(FakeAudio.instances).toHaveLength(0);
    expect(mocks.incrementAIUsage).not.toHaveBeenCalled();
    expect(mocks.checkAILimit).not.toHaveBeenCalled();
    expect(FakeRecognition.instances).toHaveLength(0);
    expect(screen.queryByRole('button', { name: 'Ответить ещё раз' })).toBeNull();
    expect(screen.getByRole('heading', { level: 1, name: `Протокол ответа на вопрос «${DEMO_QUESTION}»` })).toBeInTheDocument();
  });

  it('names the exam the answer was given in and leads back to its sheet', async () => {
    const OTHER = '0e000000-0000-4000-8000-000000000002';
    const fake = seedDatabase({
      sessions: [{ ...sessionRow, subject: 'Зачёт по нейросетям', questions_json: [{ ...sessionRow.questions_json[0], exam_id: OTHER }] }],
    });
    fake.tables.exams.push({ id: OTHER, title: 'Зачёт по нейросетям, весна', kind: 'credit' });
    const { container } = await renderPage(`/exams/${EXAM}/ticket?session=${SESSION}`);
    expect(await screen.findByText('Ответ от 7 окт., 14:02')).toBeInTheDocument();
    expect(container.querySelector('.or-course')?.textContent?.replace(/\s+/g, ' ')).toBe('Зачёт по нейросетям, весна · ');
    const links = screen.getAllByRole('button', { name: 'Лист экзамена' });
    expect(links).toHaveLength(2);
    fireEvent.click(links[1]);
    await waitFor(() => expect(location).toBe(`/exams/${OTHER}`));
  });

  it('says the subject in the top line, not «Экзамен: …» once more', async () => {
    const fake = seedDatabase({ sessions: [{ ...sessionRow }] });
    fake.tables.exams[0].title = 'Экзамен: цифровая экономика';
    const { container } = await renderPage(`/exams/${EXAM}/ticket?session=${SESSION}`);
    expect(await screen.findByText('Ответ от 7 окт., 14:02')).toBeInTheDocument();
    expect(container.querySelector('.or-course')?.textContent?.replace(/\s+/g, ' ')).toBe('Цифровая экономика · ');
  });

  it('falls back to the saved title and the address’s sheet when the answer’s exam is gone', async () => {
    const GONE = '0e000000-0000-4000-8000-000000000003';
    seedDatabase({ sessions: [{ ...sessionRow, subject: 'Удалённый зачёт', questions_json: [{ ...sessionRow.questions_json[0], exam_id: GONE }] }] });
    const { container } = await renderPage(`/exams/${EXAM}/ticket?session=${SESSION}`);
    expect(await screen.findByText('Ответ от 7 окт., 14:02')).toBeInTheDocument();
    expect(container.querySelector('.or-course')?.textContent?.replace(/\s+/g, ' ')).toBe('Удалённый зачёт · ');
    fireEvent.click(screen.getAllByRole('button', { name: 'Лист экзамена' })[0]);
    await waitFor(() => expect(location).toBe(`/exams/${EXAM}`));
  });

  it('says «Протокол не найден» for a missing or foreign session', async () => {
    seedDatabase({ sessions: [] });
    await renderPage(`/exams/${EXAM}/ticket?session=05000000-0000-4000-8000-00000000abcd`);
    expect(await screen.findByRole('heading', { name: 'Протокол не найден' })).toBeInTheDocument();
    expect(screen.getAllByText('Лист экзамена').length).toBeGreaterThan(0);
  });
});

describe('ExamTicket: a ticket of two questions', () => {
  it('moves to the second question after the first protocol', async () => {
    seedDatabase({ rpc: vi.fn(async () => ({ data: SAVED, error: null })) });
    api['/api/oral/rubric'].mockImplementation(async (body) =>
      body.question_id === Q2
        ? json(409, { detail: 'Этого вопроса нет в ваших лекциях — оценить ответ не по чему.', code: 'not_in_lectures' })
        : json(200, demoRubricResponse()),
    );
    await renderPage(ticketUrl([Q1, Q2]));
    await readyToAnswer();
    expect(screen.getByRole('article', { name: 'Билет 12, вопрос 1 из 2' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Не знаю' }));
    await screen.findByText(/Сохранено в историю и/);
    fireEvent.click(screen.getByRole('button', { name: 'Второй вопрос' }));
    expect(await screen.findByRole('article', { name: 'Билет 12, вопрос 2 из 2' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Этого вопроса нет в ваших лекциях — оценить ответ не по чему.' })).toBeInTheDocument();
  });
  it('keeps the question’s own number for a drawn pair: card, top line and protocol (redesign critique 8)', async () => {
    seedDatabase({ rpc: vi.fn(async () => ({ data: SAVED, error: null })) });
    const { container } = await renderPage(`/exams/${EXAM}/ticket?q=${Q1},${Q2}`);
    await readyToAnswer();
    const card = screen.getByRole('article', { name: 'Вопрос 7, 1 из 2' });
    expect(card.querySelector('.or-ticket-no')?.textContent?.replace(/\s+/g, ' ')).toBe('Вопрос 7 · 1 из 2');
    expect(container.querySelector('.or-where .or-long')?.textContent).toBe('Вопрос 7, 1 из 2');
    expect(container.querySelector('.or-where .or-short')?.textContent).toBe('Вопрос 7 · 1 из 2');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Не знаю' }));
    await screen.findByText(/Сохранено в историю и/);
    expect(container.querySelector('.or-ph-date')?.textContent?.replace(/\s+/g, ' ')).toMatch(/^Вопрос 7 · ответ 3 октября, \d{1,2}:\d{2}$/);
  });
});

/** The result's line («Назвали сами 2 из 4 главных · …») as plain text. */
function summaryText(): string | undefined {
  return document.querySelector('.or-sum')?.textContent?.replace(/\u00a0/g, ' ');
}

describe('ExamTicket: the jury’s fixes (Jury_Check 2026-10-03)', () => {
  beforeEach(() => {
    ttsFailing.add('Так…');
  });

  /** Answers DEMO_ANSWER by text and waits for the examiner's question about p4. */
  async function answerAndGetAsked(url = ticketUrl()) {
    const view = await renderPage(url);
    await readyToAnswer();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    typeAnswer(DEMO_ANSWER);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await screen.findByText(`«${Q4}»`);
    return view;
  }

  async function answerFollowup(text: string) {
    const field = await screen.findByRole('textbox', { name: 'Ответ на вопрос экзаменатора' });
    fireEvent.change(field, { target: { value: text } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
  }

  const savedPayload = (rpc: ReturnType<typeof vi.fn>) =>
    (rpc.mock.calls[0] as unknown as [string, { p_attempt: { score: number; grade: number; followup: { status: string } | null; points: Array<{ id: string; live: boolean }> } }])[1].p_attempt;

  describe('the cap for a main point not recovered on the follow-up (item 3)', () => {
    it('caps a model-judged wrong answer to the follow-up at 3', async () => {
      const rpc = vi.fn(async () => ({ data: SAVED, error: null }));
      seedDatabase({ rpc });
      api['/api/oral/check'].mockImplementation(async (body) =>
        body.only ? json(200, { statuses: { p4: 'wrong' }, ask: null }) : json(200, { statuses: { p4: 'missing' }, ask: 'p4' }),
      );
      await answerAndGetAsked();
      await answerFollowup('Веса станут меньше');
      await screen.findByText(/Сохранено в историю и/);
      // The grade goes to the save (record_oral_attempt requires it); the screen says what was named.
      expect(summaryText()).toBe('Назвали сами 2 из 4 главных');
      expect(savedPayload(rpc)).toMatchObject({ score: 67, grade: 3, followup: { status: 'wrong' } });
    });

    it('saves a partial answer to it as (2 + 2 + 1 + 0,5 + 1) / 9 = 72 → 4, and shows no grade', async () => {
      const rpc = vi.fn(async () => ({ data: SAVED, error: null }));
      seedDatabase({ rpc });
      api['/api/oral/check'].mockImplementation(async (body) =>
        body.only ? json(200, { statuses: { p4: 'partial' }, ask: null }) : json(200, { statuses: { p4: 'missing' }, ask: 'p4' }),
      );
      const { container } = await answerAndGetAsked();
      await answerFollowup('Будут колебания');
      await screen.findByText(/Сохранено в историю и/);
      // A partial reply to the question is no naming: «после вопроса» stays out.
      expect(summaryText()).toBe('Назвали сами 2 из 4 главных');
      expect(container.querySelector('.or-stamp, svg[data-mark="oval"]')).toBeNull();
      expect(container.textContent).not.toMatch(/[Зз]асчитан|Оценк|хорошо ·/);
      fireEvent.click(screen.getByRole('button', { name: 'Как считается' }));
      expect(container.querySelector('.or-how')?.textContent).not.toMatch(/72|из 100|→/);
      expect(savedPayload(rpc)).toMatchObject({ score: 72, grade: 4 });
    });

    it('adds no cap when the follow-up was judged only by key words (the check timed out), and says so', async () => {
      const rpc = vi.fn(async () => ({ data: SAVED, error: null }));
      seedDatabase({ rpc });
      api['/api/oral/check'].mockImplementation(async (body, init) => (body.only ? hang(init) : json(200, { statuses: { p4: 'missing' }, ask: 'p4' })));
      const { container } = await answerAndGetAsked();
      // An echo of the question: the browser's rule says «missing», but it cannot tell a paraphrase from a miss.
      await answerFollowup('Если взять слишком большую скорость обучения');
      await act(async () => {
        await vi.advanceTimersByTimeAsync(CHECK_FOLLOWUP_TIMEOUT_MS + 100);
      });
      await screen.findByText(/Сохранено в историю и/);
      expect(summaryText()).toBe('Назвали сами 2 из 4 главных');
      expect(container.querySelector('.or-extra')?.textContent).toContain('по ключевым словам пункт не назван');
      expect(savedPayload(rpc)).toMatchObject({ score: 67, grade: 4, followup: { status: 'missing' } });
    });

    it('gives the same 3 when nothing is heard after «Не расслышал ответ»', async () => {
      vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
      const rpc = vi.fn(async () => ({ data: SAVED, error: null }));
      seedDatabase({ rpc });
      await renderPage(ticketUrl());
      await readyToAnswer();
      await waitFor(() => expect(ttsTexts()).toContain('Не расслышал ответ'));
      fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
      const rec = recognition();
      act(() => rec.say([[DEMO_ANSWER, true]]));
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
      act(() => rec.end());
      await waitFor(() => expect(audiosFor(Q4)).toHaveLength(1));
      act(() => audiosFor(Q4)[0].onended?.());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      expect(rec.starts).toBe(2);
      // Silence: «Не расслышал ответ», then the microphone opens again.
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
      await waitFor(() => expect(audiosFor('Не расслышал ответ')).toHaveLength(1));
      act(() => audiosFor('Не расслышал ответ')[0].onended?.());
      await act(async () => {
        await vi.advanceTimersByTimeAsync(350);
      });
      // Silence again: the follow-up is not answered.
      fireEvent.click(await screen.findByRole('button', { name: 'Готово' }));
      await screen.findByText(/Сохранено в историю и/);
      expect(summaryText()).toBe('Назвали сами 2 из 4 главных');
      expect(savedPayload(rpc)).toMatchObject({ score: 67, grade: 3, followup: { status: 'missing' } });
    });
  });

  describe('the protocol explains key words against the check (item 7) and finds the asked point (item 9)', () => {
    it('explains p3, named by key words and judged «упомянут», with the check’s comment', async () => {
      seedDatabase({ rpc: vi.fn(async () => ({ data: SAVED, error: null })) });
      api['/api/oral/evaluate'].mockImplementation(async () =>
        json(200, {
          ...EVALUATION,
          points: EVALUATION.points.map((point) => (point.id === 'p3' ? { ...point, comment: 'Названо, но без градиента по каждому весу.' } : point)),
        }),
      );
      const { container } = await answerAndGetAsked();
      fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
      await screen.findByText(/Сохранено в историю и/);
      const p3 = container.querySelector('[data-point="p3"]') as HTMLElement;
      expect(p3.querySelector('.or-ppt-st')?.textContent).toBe('главный пункт · упомянут · фрагмент\u00a014');
      expect(p3.querySelector('.or-ppt-why')?.textContent).toBe('По ключевым словам пункт назван; проверка по всему ответу: упомянут.');
      expect(within(p3).getByText('Названо, но без градиента по каждому весу.')).toBeInTheDocument();
      // Where the key words and the check agree, nothing is added.
      for (const id of ['p1', 'p2', 'p4', 'p5']) expect(container.querySelector(`[data-point="${id}"] .or-ppt-why`)).toBeNull();
      // Every main point says so; p5 is not one.
      expect(container.querySelector('[data-point="p4"] .or-ppt-st')?.textContent).toBe('главный пункт · не назван; на вопрос экзаменатора — «не знаю»');
      expect(container.querySelector('[data-point="p5"] .or-ppt-st')?.textContent).toBe('раскрыт · фрагмент\u00a016');
    });

    it('turns the line about the asked point into a button that brings the point into view and focuses it', async () => {
      seedDatabase({ rpc: vi.fn(async () => ({ data: SAVED, error: null })) });
      const scrollTo = vi.fn();
      vi.stubGlobal('scrollTo', scrollTo);
      const { container } = await answerAndGetAsked();
      fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
      await screen.findByText(/Сохранено в историю и/);
      const line = screen.getByRole('button', { name: 'Пункт 4 не назван — о нём спросил экзаменатор.' });
      // Right under the sheet's header, before the first point.
      expect(line.compareDocumentPosition(container.querySelector('.or-ppts') as HTMLElement) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      const row = container.querySelector('[data-point="p4"]') as HTMLElement;
      vi.spyOn(row, 'getBoundingClientRect').mockReturnValue({ top: 820, bottom: 900, left: 0, right: 0, width: 0, height: 80, x: 0, y: 820, toJSON: () => ({}) });
      fireEvent.click(line);
      expect(document.activeElement).toBe(row);
      await act(async () => {
        await vi.advanceTimersByTimeAsync(500);
      });
      expect(scrollTo).toHaveBeenCalled();
      expect(scrollTo.mock.calls.every((call) => (call[0] as { behavior?: string }).behavior === 'instant')).toBe(true);
    });
  });

  describe('peak 2 (item 9)', () => {
    function rubricWithFollowup(question: string) {
      return demoRubricResponse({
        rubric: { ...DEMO_RUBRIC, points: DEMO_RUBRIC.points.map((point) => (point.id === 'p4' ? { ...point, followup: { ...point.followup, question } } : point)) },
      });
    }

    it.each([
      ['a short', Q4, 'l'],
      ['a longer', `${Q4} И почему тогда веса начинают колебаться вокруг минимума функции потерь?`, 'm'],
      [
        'a 200-character',
        `${Q4} И почему тогда веса начинают колебаться вокруг минимума функции потерь, а не сходятся к нему? Что вы предложите сделать с шагом обучения?`.slice(0, 200),
        's',
      ],
    ])('sets %s question by its length, beside the bracketed row, with no privacy text', async (_label, question, size) => {
      seedDatabase();
      api['/api/oral/rubric'].mockImplementation(async () => json(200, rubricWithFollowup(question)));
      const { container } = await renderPage(ticketUrl());
      await readyToAnswer();
      fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
      typeAnswer(DEMO_ANSWER);
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
      expect(await screen.findByText(`«${question}»`)).toHaveAttribute('data-size', size);
      expect(container.querySelector('[data-point="p4"] svg[data-mark="brace"]')).not.toBeNull();
      expect(screen.getByRole('button', { name: 'Не знаю' })).toBeInTheDocument();
      expect(document.querySelector('.or-privacy')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Кто видит ответ' })).toBeNull();
    });
  });

  it('keeps the answer’s place under the question while the examiner asks, so the block does not move when the microphone opens', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    seedDatabase();
    const { container } = await renderPage(ticketUrl());
    await readyToAnswer();
    await waitFor(() => expect(ttsTexts()).toContain('Не расслышал ответ'));
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
    const rec = recognition();
    act(() => rec.say([[DEMO_ANSWER, true]]));
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    act(() => rec.end());
    await screen.findByText(`«${Q4}»`);
    const waiting = container.querySelector('.or-examiner .or-examiner-listen') as HTMLElement;
    expect(waiting).toHaveAttribute('data-waiting');
    expect(waiting).toHaveAttribute('aria-hidden', 'true');
    await waitFor(() => expect(audiosFor(Q4)).toHaveLength(1));
    act(() => audiosFor(Q4)[0].onended?.());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(350);
    });
    expect(rec.starts).toBe(2);
    // The same element, now shown: nothing new was added to the block.
    expect(container.querySelector('.or-examiner .or-examiner-listen')).toBe(waiting);
    expect(waiting).not.toHaveAttribute('data-waiting');
    expect(waiting).not.toHaveAttribute('aria-hidden');
    expect(within(waiting).getByText('Ваш ответ на вопрос')).toBeInTheDocument();
  });

  describe('«как на экзамене» (item 11)', () => {
    const examUrl = () => `/exams/${EXAM}/ticket?q=${Q1}&n=12&mode=exam`;

    it('starts with marks off, no hint and no counter, and never writes the stored preference', async () => {
      const rpc = vi.fn(async () => ({ data: SAVED, error: null }));
      seedDatabase({ rpc });
      window.localStorage.setItem('meldy_oral_live_marks', '1');
      const { container } = await renderPage(examUrl());
      await readyToAnswer();
      const toggle = screen.getByRole('checkbox', { name: 'Отмечать пункты во время ответа' });
      expect(toggle).not.toBeChecked();
      expect(container.textContent).not.toMatch(/В эталоне/);
      // The switch works for this answer and leaves the training preference alone.
      fireEvent.click(toggle);
      expect(toggle).toBeChecked();
      fireEvent.click(toggle);
      expect(toggle).not.toBeChecked();
      expect(window.localStorage.getItem('meldy_oral_live_marks')).toBe('1');
      fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
      typeAnswer(DEMO_ANSWER);
      expect(container.querySelectorAll('[data-named]')).toHaveLength(0);
      expect(container.querySelector('.or-count, .or-count-line, .or-strip')).toBeNull();
      expect(container.querySelector('.or-said .sf-under')).toBeNull();
      expect(screen.getByText('Отметки во время ответа выключены: пункты откроются в протоколе.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Не знаю' }));
      await screen.findByText(/Сохранено в историю и/);
      expect(container.querySelector('.or-count-line')).toBeNull();
      // The key words were still counted: the saved answer and the protocol's explanations know them.
      expect(savedPayload(rpc).points.map((point) => [point.id, point.live])).toEqual([
        ['p1', true],
        ['p2', true],
        ['p3', true],
        ['p4', false],
        ['p5', true],
      ]);
      expect(container.querySelector('[data-point="p3"] .or-ppt-why')?.textContent).toBe('По ключевым словам пункт назван; проверка по всему ответу: упомянут.');
      expect(window.localStorage.getItem('meldy_oral_live_marks')).toBe('1');
    });

    it('keeps today’s behaviour without the parameter: the stored preference, on by default', async () => {
      seedDatabase();
      const { container } = await renderPage(ticketUrl());
      await readyToAnswer();
      expect(screen.getByRole('checkbox', { name: 'Отмечать пункты во время ответа' })).toBeChecked();
      expect(screen.getByText('Полный ответ — 5 пунктов из ваших лекций. Они откроются, когда вы их назовёте.')).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
      typeAnswer(DEMO_ANSWER);
      expect(container.querySelectorAll('[data-named]')).toHaveLength(4);
      expect(container.querySelector('.or-count-line')?.textContent?.replace(/\s+/g, ' ')).toBe('По ключевым словам: 4 из 5');
    });
  });

  describe('«Билет N» only for the department’s ticket (item 11)', () => {
    const wordsOnScreen = (container: HTMLElement) => container.textContent ?? '';

    it.each([
      ['an exam without the department’s tickets', null, `q=${Q1}&n=12`],
      ['a q that is not inside ticket 12', { mode: 'fixed', per_ticket: 2, tickets: [{ number: 12, question_ids: [Q2] }] }, `q=${Q1}&n=12`],
      ['a pair in another order than ticket 12', { mode: 'fixed', per_ticket: 2, tickets: [{ number: 12, question_ids: [Q2, Q1] }] }, `q=${Q1},${Q2}&n=12`],
    ])('shows no «Билет 12» for a forged &n=12 on %s: card, top line, protocol', async (_label, layout, query) => {
      seedDatabase({ layout, rpc: vi.fn(async () => ({ data: SAVED, error: null })) });
      const { container } = await renderPage(`/exams/${EXAM}/ticket?${query}`);
      await readyToAnswer();
      expect(wordsOnScreen(container)).not.toMatch(/Билет 12/);
      const card = container.querySelector('.or-ticket-no')?.textContent?.replace(/\s+/g, ' ');
      expect(card === 'Вопрос 7' || card === 'Вопрос 7 · 1 из 2').toBe(true);
      fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
      typeAnswer(DEMO_ANSWER);
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Не знаю' }));
      await screen.findByText(/Сохранено в историю и/);
      expect(wordsOnScreen(container)).not.toMatch(/Билет 12/);
      expect(container.querySelector('.or-ph-date')?.textContent?.replace(/\s+/g, ' ')).toMatch(/^Вопрос 7 · ответ/);
      expect(screen.getByRole('heading', { level: 1, name: /^Протокол ответа, Вопрос 7/ })).toBeInTheDocument();
    });

    it('keeps «Билет 7» when the draw dropped the ticket’s «нет» question from q', async () => {
      seedDatabase({ layout: { mode: 'fixed', per_ticket: 2, tickets: [{ number: 7, question_ids: [Q1, Q2] }] }, rpc: vi.fn(async () => ({ data: SAVED, error: null })) });
      const { container } = await renderPage(`/exams/${EXAM}/ticket?q=${Q1}&n=7`);
      await readyToAnswer();
      expect(screen.getByRole('article', { name: 'Билет 7' })).toBeInTheDocument();
      expect(container.querySelector('.or-where .or-long')?.textContent).toBe('Билет 7');
      fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
      typeAnswer(DEMO_ANSWER);
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
      fireEvent.click(await screen.findByRole('button', { name: 'Не знаю' }));
      await screen.findByText(/Сохранено в историю и/);
      expect(container.querySelector('.or-ph-date')?.textContent?.replace(/\s+/g, ' ')).toMatch(/^Билет 7 · ответ/);
      expect(container.querySelector('.or-where .or-long')?.textContent?.replace(/\s+/g, ' ')).toMatch(/^Билет 7 · протокол ответа/);
    });
  });

  describe('the examiner’s closing line (item 12)', () => {
    function heldEvaluation() {
      const held: { release: () => void } = { release: () => undefined };
      api['/api/oral/evaluate'].mockImplementation(
        () =>
          new Promise((resolve) => {
            held.release = () => resolve(json(200, EVALUATION));
          }),
      );
      return held;
    }

    it('says «Хорошо, спасибо», never «по существу всё», when a row stays closed and nothing is asked', async () => {
      seedDatabase({ rpc: vi.fn(async () => ({ data: { ...SAVED, card_added: false }, error: null })) });
      const held = heldEvaluation();
      // The check finds nothing to ask, but p4 was never named by key words.
      api['/api/oral/check'].mockImplementation(async () => json(200, { statuses: { p1: 'covered', p2: 'covered', p3: 'covered', p4: 'covered', p5: 'covered' }, ask: null }));
      await renderPage(ticketUrl());
      await readyToAnswer();
      fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
      typeAnswer(DEMO_ANSWER);
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
      expect(await screen.findByText('Хорошо, спасибо.')).toBeInTheDocument();
      expect(screen.queryByText(/по существу всё/)).toBeNull();
      await waitFor(() => expect(audiosFor('Хорошо, спасибо')).toHaveLength(1));
      expect(audiosFor('Хорошо, по существу всё')).toHaveLength(0);
      await act(async () => {
        held.release();
      });
      await screen.findByText(/Сохранено в историю и/);
    });

    it('says «Хорошо, по существу всё» when every row was named, also with the marks hidden', async () => {
      seedDatabase({ rpc: vi.fn(async () => ({ data: { ...SAVED, card_added: false }, error: null })) });
      const held = heldEvaluation();
      api['/api/oral/check'].mockImplementation(async () => json(200, { statuses: { p1: 'covered', p2: 'covered', p3: 'covered', p4: 'covered', p5: 'covered' }, ask: null }));
      await renderPage(`/exams/${EXAM}/ticket?q=${Q1}&mode=exam`);
      await readyToAnswer();
      expect(screen.getByRole('checkbox', { name: 'Отмечать пункты во время ответа' })).not.toBeChecked();
      fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
      typeAnswer(FULL_ANSWER);
      fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
      expect(await screen.findByText('Хорошо, по существу всё.')).toBeInTheDocument();
      await waitFor(() => expect(audiosFor('Хорошо, по существу всё')).toHaveLength(1));
      expect(audiosFor('Хорошо, спасибо')).toHaveLength(0);
      await act(async () => {
        held.release();
      });
      await screen.findByText(/Сохранено в историю и/);
    });
  });
});
