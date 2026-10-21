import { StrictMode } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { FROM_TRY } from '../lib/returnTo';
import type { RecognitionResultEvent } from '../hooks/useSpeechAnswer';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  confirm: vi.fn(async () => true),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, session: null, loading: false, signOut: vi.fn() }) }));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm, alert: vi.fn() }) }));

import TryExample from './TryExample';
import { LECTURE_RESULT_LINK, NONE_NOTE, PARTIAL_NOTE, PICK_LEAD, PICK_SAMPLE_LINE, PICK_TITLE } from '../components/example/ExamplePick';
import { CHECK_SCALE_NOTE, CHECK_TITLE, OWN_EXAM_LINE } from '../components/example/ExampleCheck';
import {
  BLANK_ROW_TEXT,
  CLOSING_PAUSE_MS,
  EXAMINER_PAUSE_MS,
  EXAMPLE_ANSWER_LABEL,
  EXAMPLE_NEXT_LINE,
  EXAMPLE_PASTE_REFUSED,
  EXAMPLE_PRIVACY_LINE,
  FOLLOWUP_LISTEN_MS,
  FOLLOWUP_WAIT_MS,
  LEAVE_MESSAGE,
} from '../components/example/ExampleTicket';
import { tryTicketPart } from '../components/example/tryParts';
import { sampleAnswer } from '../components/example/sampleAnswers';
import { CHECKED_BY_AI, CHECKED_DONT_KNOW, TRY_CHECK_TIMEOUT_MS, TRY_FOLLOWUP_TIMEOUT_MS } from '../components/example/tryCheck';
import { exampleQuestion } from '../data/example';

// ── Fakes ─────────────────────────────────────────────────────────────────────────────

/** The browser's speech recognition, driven by the test (the shape useSpeechAnswer uses). */
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
  starts = 0;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    if (this.running) throw new DOMException('already started', 'InvalidStateError');
    this.running = true;
    this.starts += 1;
  }
  stop() {
    queueMicrotask(() => this.end());
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

/** A device that can be heard: speech recognition, and a microphone among the media devices. */
function withMicrophone(present = true) {
  vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
  Object.defineProperty(window.navigator, 'mediaDevices', {
    configurable: true,
    value: { enumerateDevices: async () => (present ? [{ kind: 'audioinput', deviceId: '', label: '', groupId: '' }] : []) },
  });
}

let fetchSpy: ReturnType<typeof vi.fn>;

/** The server's answer to the AI check: a status and a body, a network failure, or no answer until aborted. */
type TryReply = { status: number; body: unknown } | 'network' | 'hang';
interface TryRequest {
  url: string;
  body: Record<string, unknown>;
  auth: string | null;
}
/** What POST /api/try/evaluate answers in the test; by default the server has no key (key words, no_key). */
let tryReply: (body: Record<string, unknown>) => TryReply | Promise<TryReply>;
let tryRequests: TryRequest[] = [];
const KEYWORDS_NO_KEY: TryReply = { status: 200, body: { mode: 'keywords', reason: 'no_key' } };
const ai = (points: Array<[string, string, string?, string?]>, extra: { errors?: unknown[]; verdict?: string } = {}): TryReply => ({
  status: 200,
  body: {
    mode: 'ai',
    evaluation: {
      points: points.map(([id, status, quote = '', comment = '']) => ({ id, status, student_quote: quote, comment })),
      errors: extra.errors ?? [],
      verdict: extra.verdict ?? 'Вы назвали главное своими словами.',
    },
  },
});

/** The sign-up of the test: its heading, and the router state the way there carried (the way back to /try). */
function RegisterProbe() {
  const { state } = useLocation();
  return (
    <>
      <h1>Регистрация</h1>
      <p data-testid="register-from">{JSON.stringify(state ?? null)}</p>
    </>
  );
}

function renderAt(url: string, options: { strict?: boolean } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/try/*" element={<TryExample />} />
        <Route path="/register" element={<RegisterProbe />} />
        <Route path="/login" element={<h1>Вход</h1>} />
        <Route path="/exams/new" element={<h1>Новый экзамен</h1>} />
        <Route path="/exams" element={<h1>Экзамены</h1>} />
        <Route path="/" element={<h1>Главная</h1>} />
      </Routes>
    </MemoryRouter>
  );
  return render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const plain = (text: string | null | undefined) => (text ?? '').replace(/\u00a0/g, ' ').replace(/⁠/g, '').replace(/\s+/g, ' ').trim();
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** After «Проверить ответ»: the examiner listens (its pause starts once the answer is in), then asks or closes. */
const toExaminer = async () => {
  await screen.findByText('Экзаменатор слушает ответ…');
  await advance(EXAMINER_PAUSE_MS + 100);
};

/** Every button and link has a name; the screen has exactly one level-1 heading. */
function expectAccessibleScreen() {
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  for (const control of [...screen.queryAllByRole('button'), ...screen.queryAllByRole('link')]) {
    const name = plain(control.getAttribute('aria-label') || control.textContent);
    expect(name, control.outerHTML.slice(0, 120)).not.toBe('');
  }
}

/** The step the visitor is on, by the steps' own list. */
const currentStep = () => plain(screen.getByRole('navigation', { name: 'Шаги примера' }).querySelector('[aria-current="step"] .tx-step-t')?.textContent);

/** Step 3: its rows' fates in a word, its result line and how it was checked. */
const checkRows = () => [...document.querySelectorAll<HTMLElement>('.tx-ck-row')].map((row) => row.dataset.status);
const checkTitle = () => plain(document.querySelector('.tx-ck-big')?.textContent);
const checkRest = () => plain(document.querySelector('.tx-ck-rest')?.textContent);
const checkHow = () => plain(document.querySelector('.tx-ck-how')?.textContent);
const toCheck = () => screen.findByRole('heading', { level: 1, name: CHECK_TITLE });

/** The cheat sheet is not part of the example any more (owner, 21.10): no word of it anywhere. */
const expectNoCheatSheet = () => expect(document.body.textContent).not.toMatch(/шпаргалк/i);

const Q1_PARTIAL = 'Закон спроса такой: когда цена растёт, люди покупают меньше. Кривая спроса на графике идёт вниз.';
const Q1_FOLLOWUP = 'Это когда покупатели готовы купить определённое количество товара при каждой цене';
const Q4_FULL =
  'Равновесие — это точка, где пересекаются кривые спроса и предложения. При равновесной цене величина спроса равна величине предложения. Если цена ниже равновесной, возникает дефицит: спрос превышает предложение. Если цена выше, возникает излишек, и продавцы снижают цену. В итоге цена сама приходит к равновесию.';
const Q5_SAMPLE = sampleAnswer(exampleQuestion('q5'))!;
const Q5_REPLY = exampleQuestion('q5')!.points[4].followup.expected;
const Q5_AI = ai([
  ['p1', 'covered', 'на сколько процентов изменится спрос, если цена изменится на один процент'],
  ['p2', 'covered', 'Её считают как отношение процентного изменения спроса к процентному изменению цены'],
  ['p3', 'covered', 'Если модуль больше единицы, спрос эластичный, если меньше единицы — неэластичный'],
  ['p4', 'covered', 'Знак у эластичности обычно отрицательный, поэтому сравнивают модуль'],
  ['p5', 'missing', '', 'Крайние случаи не прозвучали.'],
]);

// The answer room is a file of its own (components/example/tryParts), fetched once the list is idle; here it is in from
// the start, as after that prefetch (TryExample.lazy.test.tsx covers a step whose file has not arrived).
beforeAll(async () => {
  await tryTicketPart.load();
});

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 9, 4, 19, 30, 0));
  mocks.user = null;
  mocks.confirm.mockReset();
  mocks.confirm.mockResolvedValue(true);
  FakeRecognition.instances = [];
  window.localStorage.clear();
  window.sessionStorage.clear();
  tryRequests = [];
  tryReply = () => KEYWORDS_NO_KEY;
  // The example's only request is the AI check of an answer; anything else is a failure of the test.
  fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    if (url !== '/api/try/evaluate') throw new Error(`The example must not call ${url}`);
    const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
    tryRequests.push({ url, body, auth: new Headers(init?.headers).get('Authorization') });
    const reply = await tryReply(body);
    if (reply === 'network') throw new TypeError('Failed to fetch');
    if (reply === 'hang') {
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener('abort', () => reject(new DOMException('The operation was aborted.', 'AbortError')));
      });
    }
    return new Response(JSON.stringify(reply.body), { status: reply.status, headers: { 'Content-Type': 'application/json' } });
  });
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window.navigator as { mediaDevices?: unknown }).mediaDevices;
});

describe('«Попробовать на примере» (/try): three steps — a question, an answer, the check', () => {
  it('step 1 is the department’s list: what the example is, one tap to a question, and the question in no lecture said as such', () => {
    renderAt('/try');
    expect(screen.getByRole('heading', { level: 1, name: PICK_TITLE })).toBeInTheDocument();
    expect(currentStep()).toBe('Вопрос');
    const steps = within(screen.getByRole('navigation', { name: 'Шаги примера' })).getAllByRole('listitem');
    expect(steps.map((step) => plain(step.querySelector('.tx-step-t')?.textContent))).toEqual(['Вопрос', 'Ответ', 'Проверка']);
    // Nothing behind the steps yet: the visitor goes on by choosing a question.
    expect(within(screen.getByRole('navigation', { name: 'Шаги примера' })).queryAllByRole('link')).toHaveLength(0);
    expect(plain(document.querySelector('.tx-lead')?.textContent)).toBe(plain(PICK_LEAD));
    expect(screen.getByText(PICK_SAMPLE_LINE)).toBeInTheDocument();

    const list = screen.getByRole('region', { name: 'Вопросы к экзамену по микроэкономике' });
    const rows = within(list).getAllByRole('listitem');
    expect(rows).toHaveLength(12);
    const links = within(list).getAllByRole('link');
    expect(links).toHaveLength(11);
    expect(links[4]).toHaveAttribute('href', '/try/ticket?q=q5');
    expect(links[4]).toHaveAccessibleName('Вопрос 5. Ценовая эластичность спроса и её измерение.');
    expect(links[7]).toHaveAccessibleName('Вопрос 8. Перекрёстная эластичность и эластичность спроса по доходу. Товары Гиффена. В лекциях есть только часть ответа.');
    // The two questions the lectures cover in part say so; the one they do not cover cannot be chosen.
    expect(within(list).getAllByText(PARTIAL_NOTE)).toHaveLength(2);
    expect(within(rows[11]).queryByRole('link')).toBeNull();
    expect(within(rows[11]).getByText(NONE_NOTE)).toBeInTheDocument();

    // The lectures the answers are checked against, and the way to what Meldy made of one.
    const lectures = screen.getByRole('region', { name: 'Лекции курса' });
    expect(within(lectures).getAllByRole('group')).toHaveLength(3);
    expect(within(lectures).getByRole('link', { name: (name) => plain(name) === plain(LECTURE_RESULT_LINK) })).toHaveAttribute('href', '/try/lecture');
    expectAccessibleScreen();
    expectNoCheatSheet();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('the jury’s path: a question, the ready answer as the blue pill (no microphone), the examiner, the ready reply, the check', async () => {
    tryReply = (body) => (body.point_id ? { status: 200, body: { mode: 'ai', status: 'covered' } } : Q5_AI);
    renderAt('/try');
    fireEvent.click(screen.getByRole('link', { name: /Вопрос 5\. Ценовая эластичность/ }));

    // Step 2: the question, what to do and what will happen, the closed points said in words.
    expect(screen.getByRole('heading', { level: 1, name: 'Ценовая эластичность спроса и её измерение.' })).toBeInTheDocument();
    expect(currentStep()).toBe('Ответ');
    expect(screen.getByRole('link', { name: /Вопрос, пройден/ })).toHaveAttribute('href', '/try');
    expect(plain(document.querySelector('.tx-next')?.textContent)).toBe(plain(EXAMPLE_NEXT_LINE));
    expect(plain(document.querySelector('.tx-pts-line')?.textContent)).toBe('В полном ответе 5 пунктов из лекций. Пока они скрыты.');
    const points = screen.getByRole('list', { name: 'Пункты ответа' });
    expect(within(points).getAllByRole('listitem').map((row) => row.getAttribute('aria-label'))).toEqual([
      'Пункт 1, ещё не назван',
      'Пункт 2, ещё не назван',
      'Пункт 3, ещё не назван',
      'Пункт 4, ещё не назван',
      'Пункт 5, ещё не назван',
    ]);
    expect(within(points).getAllByText(BLANK_ROW_TEXT)).toHaveLength(5);
    // No speech recognition in this browser: the ready answer is the one blue pill, writing one's own is a link.
    const insert = screen.getByRole('button', { name: 'Вставить готовый ответ' });
    expect(insert).toHaveClass('sf-primary');
    expect(screen.getByRole('button', { name: 'Написать ответ' })).toHaveClass('sf-link');
    expect(screen.queryByRole('button', { name: 'Ответить голосом' })).toBeNull();
    expect(screen.getByText(EXAMPLE_PRIVACY_LINE)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Выбрать другой вопрос' })).toHaveAttribute('href', '/try');
    expectAccessibleScreen();

    // The ready answer goes in (it is not sent): the points it names open with the lecture's words.
    fireEvent.click(insert);
    const field = screen.getByLabelText(EXAMPLE_ANSWER_LABEL);
    expect(field).toHaveValue(Q5_SAMPLE);
    expect(field).toHaveFocus();
    expect(plain(document.querySelector('.or-count-line')?.textContent)).toBe('Открыто 4 пункта из 5');
    expect(within(points).getAllByRole('listitem').map((row) => row.hasAttribute('data-named'))).toEqual([true, true, true, true, false]);
    expect(fetchSpy).not.toHaveBeenCalled();

    // «Проверить ответ»: the examiner listens, then asks about the point that was not there.
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответ' }));
    await toExaminer();
    const examiner = document.querySelector('.or-examiner') as HTMLElement;
    expect(within(examiner).getByText('«Какие крайние случаи ценовой эластичности спроса бывают?»')).toBeInTheDocument();
    expect(within(examiner).getByText('В ответе не было пункта 5. Экзаменатор спрашивает о нём.')).toBeInTheDocument();
    expect(document.querySelector('.or-side > p.sr-only[aria-live="polite"]')?.textContent).toBe(
      'Экзаменатор спрашивает: «Какие крайние случаи ценовой эластичности спроса бывают?»',
    );
    // Under the examiner's question the answer is still the ready one, by its name.
    expect(screen.getByText(EXAMPLE_ANSWER_LABEL)).toBeInTheDocument();
    fireEvent.click(within(examiner).getByRole('button', { name: 'Вставить готовый ответ' }));
    expect(within(examiner).getByRole('textbox', { name: 'Ответ на вопрос экзаменатора' })).toHaveValue(Q5_REPLY);
    expect(within(examiner).queryByRole('button', { name: 'Вставить готовый ответ' })).toBeNull();
    fireEvent.click(within(examiner).getByRole('button', { name: 'Отправить ответ' }));

    // Step 3: what the check found — the AI's — and the way on.
    const heading = await toCheck();
    expect(heading).toHaveFocus();
    expect(currentStep()).toBe('Проверка');
    expect(checkTitle()).toBe('В ответе 4 пункта из 5');
    expect(checkRest()).toBe('Ещё 1 пункт прозвучал после вопроса экзаменатора.');
    expect(checkHow()).toBe(CHECKED_BY_AI);
    expect(checkRows()).toEqual(['named', 'named', 'named', 'named', 'after']);
    const rows = [...document.querySelectorAll<HTMLElement>('.tx-ck-row')];
    const parts = (row: Element) => [...row.querySelectorAll('p')].map((node) => plain(node.textContent));
    expect(parts(rows[0])).toEqual([
      'Есть в ответе',
      '1. Эластичность — на сколько процентов изменится спрос при изменении цены на 1 %',
      'В ответе: «на сколько процентов изменится спрос, если цена изменится на один процент»',
      'В лекции: «Ценовая эластичность спроса показывает, на сколько процентов изменится величина спроса при изменении цены на один процент.»',
    ]);
    expect(plain(rows[4].querySelector('.tx-ck-word')?.textContent)).toBe('Прозвучал после вопроса экзаменатора');
    expect(screen.getByRole('heading', { level: 2, name: (name) => plain(name) === 'Пункты из лекции «Эластичность спроса»' })).toBeInTheDocument();
    const asked = screen.getByRole('region', { name: 'Экзаменатор спросил о пункте 5' });
    expect([...asked.querySelectorAll('h2, p')].map((node) => plain(node.textContent))).toEqual([
      'Экзаменатор спросил о пункте 5',
      '«Какие крайние случаи ценовой эластичности спроса бывают?»',
      `Ваш ответ: «${Q5_REPLY.replace(/\.$/, '')}»`,
      'Ответ верный. Пункт прозвучал.',
    ]);
    expect(screen.getByText(CHECK_SCALE_NOTE)).toBeInTheDocument();
    expect(screen.getByText(OWN_EXAM_LINE)).toBeInTheDocument();
    const own = screen.getByRole('link', { name: 'Создать свой экзамен' });
    expect(own).toHaveClass('sf-primary');
    expect(own).toHaveAttribute('href', '/register?next=%2Fexams%2Fnew');
    // Said once to a screen reader when the check opens.
    expect(plain(document.querySelector('[data-try-announce]')?.textContent)).toBe('Проверка готова. В ответе 4 пункта из 5.');
    // No grade and no «Засчитано» (Ф1), no cheat sheet.
    expect(document.body.textContent).not.toMatch(/[Зз]асчитан|Оценка:|удовлетвор|отлично/);
    expectNoCheatSheet();
    expectAccessibleScreen();

    // Two requests: the answer, then the reply with the point's id — no question, no expected answer, no token.
    expect(tryRequests).toEqual([
      { url: '/api/try/evaluate', body: { question_id: 'q5', transcript: Q5_SAMPLE }, auth: null },
      { url: '/api/try/evaluate', body: { question_id: 'q5', point_id: 'p5', transcript: Q5_REPLY }, auth: null },
    ]);
    // Nothing is kept: not in this tab, not on the device.
    expect(window.sessionStorage.length).toBe(0);
    expect(window.localStorage.length).toBe(0);

    // «Ответить на другой вопрос»: back to step 1.
    fireEvent.click(screen.getByRole('button', { name: 'Ответить на другой вопрос' }));
    expect(screen.getByRole('heading', { level: 1, name: PICK_TITLE })).toBeInTheDocument();
  });

  it('a device that can be heard: speaking is the blue pill, the ready answer the white one under «Не знаете тему?»', async () => {
    withMicrophone();
    renderAt('/try/ticket?q=q5');
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: 'Ответить голосом' })).toHaveClass('sf-primary');
    const insert = screen.getByRole('button', { name: 'Вставить готовый ответ' });
    expect(insert).toHaveClass('tx-secondary');
    expect(insert.closest('.tx-sample')?.querySelector('.tx-sample-q')?.textContent).toBe('Не знаете тему?');
    expect(screen.getByRole('button', { name: 'Написать ответ' })).toHaveClass('sf-link');
    // Speaking: while nothing is said yet, the ready answer is one tap away still.
    fireEvent.click(screen.getByRole('button', { name: 'Ответить голосом' }));
    expect(recognition().running).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Вставить готовый ответ' }));
    expect(screen.getByLabelText(EXAMPLE_ANSWER_LABEL)).toHaveValue(Q5_SAMPLE);
  });

  it('speech recognition with no microphone listed: the ready answer is the blue pill, the voice a link beside writing', async () => {
    withMicrophone(false);
    renderAt('/try/ticket?q=q5');
    await act(async () => undefined);
    expect(screen.getByRole('button', { name: 'Вставить готовый ответ' })).toHaveClass('sf-primary');
    expect(screen.getByRole('button', { name: 'Ответить голосом' })).toHaveClass('sf-link');
    expect(screen.getByRole('button', { name: 'Написать ответ' })).toHaveClass('sf-link');
    expect(screen.getByText('Или ответьте сами.')).toBeInTheDocument();
  });

  it('a typed answer by the key words (no AI on the server): the examiner asks about the main point that was missed', async () => {
    renderAt('/try/ticket?q=q1');
    fireEvent.click(screen.getByRole('button', { name: 'Написать ответ' }));
    const field = screen.getByLabelText(/^Ваш ответ/);
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: Q1_PARTIAL } });
    expect(plain(document.querySelector('.or-count-line')?.textContent)).toBe('Открыто 2 пункта из 4');
    const points = screen.getByRole('list', { name: 'Пункты ответа' });
    const rows = within(points).getAllByRole('listitem');
    expect(rows.map((row) => row.hasAttribute('data-named'))).toEqual([false, true, true, false]);
    expect(plain(rows[1].querySelector('.or-pt-t')?.textContent)).toBe('«Закон спроса гласит: при прочих равных условиях чем выше цена, тем меньше величина спроса, и наоборот.»');
    const announcement = screen.getAllByRole('status').find((node) => node.textContent?.startsWith('Пункт 2 назван'));
    expect(announcement).toHaveAttribute('aria-live', 'polite');

    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответ' }));
    await toExaminer();
    expect(screen.getByText('«Что экономисты называют спросом?»')).toBeInTheDocument();
    expect(within(points).getAllByRole('listitem')[0]).toHaveAttribute('aria-label', 'Пункт 1 не назван, об этом спросил экзаменатор');
    const reply = screen.getByRole('textbox', { name: 'Ответ на вопрос экзаменатора' });
    expect(reply).toHaveFocus();
    fireEvent.change(reply, { target: { value: Q1_FOLLOWUP } });
    // Ctrl+Enter in the field sends the reply.
    fireEvent.keyDown(reply, { key: 'Enter', ctrlKey: true });

    await toCheck();
    expect(checkHow()).toBe('ИИ сейчас недоступен. Ответ проверен по ключевым словам.');
    expect(checkRows()).toEqual(['missing', 'named', 'named', 'missing']);
    expect(checkTitle()).toBe('В ответе 2 пункта из 4');
    expect(checkRest()).toBe('2 пункта не прозвучали.');
    // The key words never name a reply: they say what they found, and so.
    expect(plain(document.querySelector('.tx-ck-out')?.textContent)).toBe('Ответ проверен по ключевым словам. Пункт упомянут.');
    // The server had no key: the reply went to nobody.
    expect(tryRequests).toEqual([{ url: '/api/try/evaluate', body: { question_id: 'q1', transcript: Q1_PARTIAL }, auth: null }]);
  });

  it('closes a full answer with «Хорошо, по существу всё», no question from the examiner', async () => {
    renderAt('/try/ticket?q=q4');
    fireEvent.click(screen.getByRole('button', { name: 'Написать ответ' }));
    fireEvent.change(screen.getByLabelText(/^Ваш ответ/), { target: { value: Q4_FULL } });
    expect(plain(document.querySelector('.or-count-line')?.textContent)).toBe('Открыто 5 пунктов из 5');
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответ' }));
    await toExaminer();
    expect(screen.getByText('Хорошо, по существу всё.')).toBeInTheDocument();
    await advance(CLOSING_PAUSE_MS + 100);
    await toCheck();
    expect(checkTitle()).toBe('Ответ полный');
    expect(checkRest()).toBe('В нём все 5 пунктов из лекций.');
    expect(document.querySelector('.tx-ck-exam')).toBeNull();
    expect(tryRequests.map((request) => request.body)).toEqual([{ question_id: 'q4', transcript: Q4_FULL }]);
  });

  it('takes «Не знаю» on the examiner’s question as an answer: the point stays not named', async () => {
    renderAt('/try/ticket?q=q1');
    fireEvent.click(screen.getByRole('button', { name: 'Написать ответ' }));
    fireEvent.change(screen.getByLabelText(/^Ваш ответ/), {
      target: { value: 'Спрос — это сколько товара покупатели готовы купить. Кривая спроса идёт вниз, а величина спроса — количество при конкретной цене.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответ' }));
    await toExaminer();
    expect(screen.getByText('«Как по закону спроса связаны цена и величина спроса?»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    await toCheck();
    expect(plain(document.querySelector('.tx-ck-out')?.textContent)).toBe('Вы ответили «не знаю». Пункт не прозвучал.');
    expect(document.querySelector('.tx-ck-a')).toBeNull();
    expect(checkRows()[1]).toBe('missing');
  });

  it('answers by voice: the points open from the words recognised, the examiner’s question is listened to after it appears', async () => {
    withMicrophone();
    renderAt('/try/ticket?q=q1');
    await act(async () => undefined);
    fireEvent.click(screen.getByRole('button', { name: 'Ответить голосом' }));
    expect(recognition().running).toBe(true);
    act(() => recognition().say([['Закон спроса такой когда цена растёт', false]]));
    expect(plain(document.querySelector('.or-count-line')?.textContent)).toBe('Открыт 1 пункт из 4');
    act(() => recognition().say([[Q1_PARTIAL, true]]));
    expect(plain(document.querySelector('.or-count-line')?.textContent)).toBe('Открыто 2 пункта из 4');
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответ' }));
    await toExaminer();
    expect(screen.getByText('«Что экономисты называют спросом?»')).toBeInTheDocument();
    // The question is shown, not spoken: no /api/tts. Listening starts right after it appears.
    await advance(FOLLOWUP_LISTEN_MS);
    expect(recognition().running).toBe(true);
    act(() => recognition().say([[Q1_FOLLOWUP, true]]));
    expect(screen.getByText(Q1_FOLLOWUP)).toBeInTheDocument();
    fireEvent.click(within(document.querySelector('.or-examiner') as HTMLElement).getByRole('button', { name: 'Отправить ответ' }));
    await toCheck();
    expect(checkRows()).toEqual(['missing', 'named', 'named', 'missing']);
    // The recognised answer goes to the check once; the server had no key, so the reply stays on the device.
    expect(tryRequests.map((request) => request.body)).toEqual([{ question_id: 'q1', transcript: Q1_PARTIAL }]);
  });

  it('refuses a pasted ready text as a real ticket does, and says where the ready answer is (Н7)', () => {
    renderAt('/try/ticket?q=q5');
    fireEvent.click(screen.getByRole('button', { name: 'Написать ответ' }));
    const field = screen.getByLabelText(/^Ваш ответ/) as HTMLTextAreaElement;
    expect(fireEvent.paste(field, { clipboardData: { getData: () => Q5_SAMPLE } })).toBe(false);
    expect(field.value).toBe('');
    expect(screen.getByText(EXAMPLE_PASTE_REFUSED)).toBeInTheDocument();
    expect(EXAMPLE_PASTE_REFUSED).not.toMatch(/шпаргалк/i);
    // The button puts the ready answer in, and the line about the refused paste goes away. Changed, it is the guest's.
    fireEvent.click(screen.getByRole('button', { name: 'Вставить готовый ответ' }));
    expect(screen.getByLabelText(EXAMPLE_ANSWER_LABEL)).toHaveValue(Q5_SAMPLE);
    expect(screen.queryByText(EXAMPLE_PASTE_REFUSED)).toBeNull();
    fireEvent.change(screen.getByLabelText(EXAMPLE_ANSWER_LABEL), { target: { value: `${Q5_SAMPLE} И ещё.` } });
    expect(screen.getByLabelText(/^Ваш ответ, \d+:\d\d$/)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('gives a signed-in student the way to their exams and to a new exam of their own', async () => {
    mocks.user = { id: 'user-1' };
    renderAt('/try/ticket?q=q7');
    expect(screen.getByRole('link', { name: 'Мои экзамены' })).toHaveAttribute('href', '/exams');
    expect(screen.queryByRole('link', { name: 'Войти' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Вставить готовый ответ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответ' }));
    await toExaminer();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    await toCheck();
    expect(screen.getByRole('link', { name: 'Создать свой экзамен' })).toHaveAttribute('href', '/exams/new');
  });

  it('shows a guest the way in from the top line', () => {
    renderAt('/try');
    const bar = screen.getByRole('navigation', { name: 'Вход и регистрация' });
    expect(within(bar).getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/login');
    // Decision 5: the call to start with one's own list where there is room («Создать аккаунт» on a phone).
    expect(within(bar).getByRole('link', { name: 'Начать со своего списка' })).toHaveAttribute('href', '/register?next=%2Fexams%2Fnew');
    expect(screen.getByRole('link', { name: 'Meldy, на главную' })).toHaveAttribute('href', '/');
  });

  it('asks before leaving an answer in progress, by the steps or by «Выбрать другой вопрос»: nothing of it is kept', async () => {
    mocks.confirm.mockResolvedValue(false);
    renderAt('/try/ticket?q=q2');
    fireEvent.click(screen.getByRole('button', { name: 'Написать ответ' }));
    fireEvent.change(screen.getByLabelText(/^Ваш ответ/), { target: { value: 'Спрос зависит от доходов' } });
    fireEvent.click(screen.getByRole('link', { name: /Вопрос, пройден/ }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Выйти из ответа?', message: LEAVE_MESSAGE }));
    expect(LEAVE_MESSAGE).toBe('Ответ пропадёт. В примере ответы не сохраняются.');
    await act(async () => undefined);
    expect(screen.getByLabelText(/^Ваш ответ/)).toHaveValue('Спрос зависит от доходов');
    mocks.confirm.mockResolvedValue(true);
    fireEvent.click(screen.getByRole('link', { name: /Вопрос, пройден/ }));
    expect(await screen.findByRole('heading', { level: 1, name: PICK_TITLE })).toBeInTheDocument();
  });

  it('says honestly when a question cannot be answered in the example', () => {
    renderAt('/try/ticket?q=q12');
    expect(screen.getByRole('heading', { level: 1, name: 'Этого вопроса нет в лекциях примера' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Выбрать вопрос' })).toHaveAttribute('href', '/try');
    cleanup();
    renderAt('/try/ticket?q=nope');
    expect(screen.getByRole('heading', { level: 1, name: 'Такого вопроса в примере нет' })).toBeInTheDocument();
  });

  it.each(['/try/draw', '/try?view=sheet', '/try/whatever'])('an old address (%s) leads to the list of questions', (url) => {
    renderAt(url);
    expect(screen.getByRole('heading', { level: 1, name: PICK_TITLE })).toBeInTheDocument();
    expectNoCheatSheet();
  });

  it('in StrictMode too: the ready answer, the examiner, the check — and the answer is checked once', async () => {
    tryReply = () => Q5_AI;
    renderAt('/try/ticket?q=q5', { strict: true });
    fireEvent.click(screen.getByRole('button', { name: 'Вставить готовый ответ' }));
    expect(screen.getByLabelText(EXAMPLE_ANSWER_LABEL)).toHaveValue(Q5_SAMPLE);
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответ' }));
    await toExaminer();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    await toCheck();
    expect(checkRows()).toEqual(['named', 'named', 'named', 'named', 'missing']);
    expect(checkRest()).toBe('1 пункт не прозвучал.');
    expect(tryRequests.map((request) => request.body)).toEqual([{ question_id: 'q5', transcript: Q5_SAMPLE }]);
  });
});

/** A retelling in the guest's own words: none of question 1's key words, all of its meaning for points 1 and 2. */
const Q1_OWN_WORDS =
  'Покупатели берут товар тем охотнее, чем он дешевле: подорожал — берут реже, подешевел — чаще. Это связь между ценой и тем, сколько люди готовы купить.';
const Q1_OWN_WORDS_AI = ai([
  ['p1', 'covered', 'Это связь между ценой и тем, сколько люди готовы купить', 'Связь цены и количества названа своими словами.'],
  ['p2', 'covered', 'подорожал — берут реже, подешевел — чаще', 'Закон спроса пересказан.'],
  ['p3', 'missing', '', 'О графике ничего не сказано.'],
  ['p4', 'missing', '', 'Величина спроса не названа.'],
]);
/** The AI's protocol of Q1_PARTIAL: the same points as the key words find. */
const Q1_PARTIAL_AI = ai([
  ['p1', 'missing'],
  ['p2', 'covered', 'Закон спроса такой: когда цена растёт, люди покупают меньше'],
  ['p3', 'covered', 'Кривая спроса на графике идёт вниз'],
  ['p4', 'missing'],
]);

/** Q1_PARTIAL typed on question 1, «Проверить ответ». */
async function answerQ1(text = Q1_PARTIAL) {
  renderAt('/try/ticket?q=q1');
  fireEvent.click(screen.getByRole('button', { name: 'Написать ответ' }));
  fireEvent.change(screen.getByLabelText(/^Ваш ответ/), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Проверить ответ' }));
}

describe('the AI check of the example (/api/try/evaluate)', () => {
  it('says before the answer that the text goes to Meldy’s server and to Google’s AI service, and that nothing is kept', () => {
    renderAt('/try/ticket?q=q1');
    expect(screen.getByText(EXAMPLE_PRIVACY_LINE)).toBeInTheDocument();
    expect(EXAMPLE_PRIVACY_LINE).toBe(
      'Голос распознаёт браузер. В Chrome это делает Google. Ответ проверяют сервер Meldy и Google Gemini. Мы его не сохраняем.',
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('checks a retelling in the guest’s own words by the AI: the examiner asks about what is missing, the check is the AI’s', async () => {
    tryReply = () => Q1_OWN_WORDS_AI;
    await answerQ1(Q1_OWN_WORDS);
    expect(plain(document.querySelector('.or-strip-count')?.textContent)).toBe('Открыто 0 пунктов из 4');
    await toExaminer();
    // The AI found points 1 and 2 in other words: the examiner asks about the curve, not about them.
    expect(screen.getByText('«Как выглядит кривая спроса на графике?»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    await toCheck();
    expect(checkHow()).toBe(CHECKED_BY_AI);
    expect(checkRows()).toEqual(['named', 'named', 'missing', 'missing']);
    const rows = [...document.querySelectorAll<HTMLElement>('.tx-ck-row')];
    expect(plain(rows[1].querySelector('.tx-ck-said')?.textContent)).toBe('В ответе: «подорожал — берут реже, подешевел — чаще»');
    expect(checkTitle()).toBe('В ответе 2 пункта из 4');
    // The question's id and the answer, nothing else: the server keeps the points itself. No token either.
    expect(tryRequests).toEqual([{ url: '/api/try/evaluate', body: { question_id: 'q1', transcript: Q1_OWN_WORDS }, auth: null }]);
  });

  it('shows a point said wrong with the lecture’s correction', async () => {
    const wrong = 'Закон спроса такой: когда цена растёт, люди покупают больше. Кривая спроса на графике идёт вниз.';
    tryReply = () =>
      ai(
        [
          ['p1', 'missing'],
          ['p2', 'wrong', 'когда цена растёт, люди покупают больше', 'Связь перепутана.'],
          ['p3', 'covered', 'Кривая спроса на графике идёт вниз'],
          ['p4', 'missing'],
        ],
        { errors: [{ point_id: 'p2', student_quote: 'когда цена растёт, люди покупают больше', correction: 'Чем выше цена, тем меньше величина спроса.' }] },
      );
    await answerQ1(wrong);
    await toExaminer();
    // The rule of a real ticket: a main point said wrong is asked about first.
    expect(screen.getByText('«Как по закону спроса связаны цена и величина спроса?»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    await toCheck();
    expect(checkRows()).toEqual(['missing', 'wrong', 'named', 'missing']);
    expect(checkRest()).toBe('1 пункт с ошибкой. 2 пункта не прозвучали.');
    const row = document.querySelectorAll<HTMLElement>('.tx-ck-row')[1];
    expect(plain(row.querySelector('.tx-ck-word')?.textContent)).toBe('Есть ошибка');
    expect(within(row).getByText('Правильно: Чем выше цена, тем меньше величина спроса.')).toBeInTheDocument();
    expect(within(row).getByText('Связь перепутана.')).toBeInTheDocument();
  });

  it.each<[string, () => TryReply, string]>([
    ['the server has no key', () => KEYWORDS_NO_KEY, 'ИИ сейчас недоступен. Ответ проверен по ключевым словам.'],
    ['the day’s AI checks are spent', () => ({ status: 200, body: { mode: 'keywords', reason: 'day_cap' } }), 'Проверки ИИ на сегодня закончились. Ответ проверен по ключевым словам.'],
    ['the model is busy', () => ({ status: 200, body: { mode: 'keywords', reason: 'busy' } }), 'ИИ сейчас недоступен. Ответ проверен по ключевым словам.'],
    ['the model ran out of time', () => ({ status: 200, body: { mode: 'keywords', reason: 'timeout' } }), 'ИИ не успел проверить ответ. Ответ проверен по ключевым словам.'],
    ['one address checked too much', () => ({ status: 429, body: { detail: 'Слишком много запросов.' } }), 'Из вашей сети было слишком много проверок. Ответ проверен по ключевым словам.'],
    ['the connection broke', () => 'network', 'Нет связи с сервером. Ответ проверен по ключевым словам.'],
    ['the server failed', () => ({ status: 502, body: { detail: 'Bad gateway' } }), 'ИИ сейчас недоступен. Ответ проверен по ключевым словам.'],
    ['the protocol is unusable', () => ({ status: 200, body: { mode: 'ai', evaluation: { points: [] } } }), 'ИИ сейчас недоступен. Ответ проверен по ключевым словам.'],
  ])('checks by the key words when %s, and the check says so', async (_, reply, line) => {
    tryReply = reply;
    await answerQ1();
    await toExaminer();
    expect(screen.getByText('«Что экономисты называют спросом?»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    await toCheck();
    expect(checkHow()).toBe(line);
    expect(checkRows()).toEqual(['missing', 'named', 'named', 'missing']);
  });

  it('a reply the AI could not judge in time is judged by the key words, and the check says so', async () => {
    tryReply = (body) => (body.point_id ? 'hang' : Q1_PARTIAL_AI);
    await answerQ1();
    await toExaminer();
    const field = screen.getByRole('textbox', { name: 'Ответ на вопрос экзаменатора' });
    fireEvent.change(field, { target: { value: Q1_FOLLOWUP } });
    fireEvent.click(within(field.closest('.or-examiner') as HTMLElement).getByRole('button', { name: 'Отправить ответ' }));
    expect(await screen.findByText('Экзаменатор слушает ответ…')).toBeInTheDocument();
    await advance(TRY_FOLLOWUP_TIMEOUT_MS + 100);
    await toCheck();
    // The answer itself was the AI's; the reply, the key words' — never «назван» by them.
    expect(checkHow()).toBe(CHECKED_BY_AI);
    expect(plain(document.querySelector('.tx-ck-out')?.textContent)).toBe('Ответ проверен по ключевым словам. Пункт упомянут.');
    expect(tryRequests.map((request) => request.body.point_id ?? null)).toEqual([null, 'p1']);
  });

  it('a slow AI: the examiner asks by the key words after a few seconds, and the check waits for the AI', async () => {
    let release: () => void = () => undefined;
    const answered = new Promise<void>((resolve) => {
      release = resolve;
    });
    tryReply = async () => {
      await answered;
      return Q1_PARTIAL_AI;
    };
    await answerQ1();
    await toExaminer();
    // The AI has not answered: the examiner still listens…
    expect(screen.getByText('Экзаменатор слушает ответ…')).toBeInTheDocument();
    await advance(FOLLOWUP_WAIT_MS);
    // …then asks by the key words.
    expect(screen.getByText('«Что экономисты называют спросом?»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByText('Сверяем ответ с лекциями…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: CHECK_TITLE })).toBeNull();
    await act(async () => {
      release();
    });
    await toCheck();
    expect(checkHow()).toBe(CHECKED_BY_AI);
    expect(checkRows()).toEqual(['missing', 'named', 'named', 'missing']);
  });

  it('a server that does not answer at all: the key words after the time limit, and the check says so', async () => {
    tryReply = () => 'hang';
    await answerQ1();
    await toExaminer();
    await advance(FOLLOWUP_WAIT_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByText('Сверяем ответ с лекциями…')).toBeInTheDocument();
    await advance(TRY_CHECK_TIMEOUT_MS);
    await toCheck();
    expect(checkHow()).toBe('ИИ не успел проверить ответ. Ответ проверен по ключевым словам.');
    expect(checkRows()).toEqual(['missing', 'named', 'named', 'missing']);
  });

  it('«не знаю» as the whole answer goes nowhere: nothing named, as the button', async () => {
    await answerQ1('Не знаю.');
    await toExaminer();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    await toCheck();
    expect(checkHow()).toBe(CHECKED_DONT_KNOW);
    expect(checkRows()).toEqual(['missing', 'missing', 'missing', 'missing']);
    expect(checkTitle()).toBe('В ответе нет пунктов из лекций');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an answer over 4000 characters is checked by the key words without a request', async () => {
    await answerQ1(`${Q1_PARTIAL} ${'и так далее '.repeat(400)}`);
    await toExaminer();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    await toCheck();
    expect(checkHow()).toBe('ИИ проверяет ответы до 4000 знаков. Ответ проверен по ключевым словам.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('offline: the key words at once, without a request', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    await answerQ1();
    await toExaminer();
    expect(screen.getByText('«Что экономисты называют спросом?»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    await toCheck();
    expect(checkHow()).toBe('Нет связи с сервером. Ответ проверен по ключевым словам.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('every way from the example to the sign-up carries the way back: the check’s «Создать свой экзамен», the top line mid-answer', async () => {
    renderAt('/try/ticket?q=q5');
    fireEvent.click(screen.getByRole('button', { name: 'Вставить готовый ответ' }));
    // Mid-answer the top line asks first (the answer would be lost), then goes — with the way back.
    fireEvent.click(screen.getByRole('link', { name: /Начать со своего списка|Создать аккаунт/ }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Регистрация' })).toBeInTheDocument();
    expect(mocks.confirm).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId('register-from').textContent).toBe(JSON.stringify(FROM_TRY));
    cleanup();
    renderAt('/try/ticket?q=q5');
    fireEvent.click(screen.getByRole('button', { name: 'Вставить готовый ответ' }));
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответ' }));
    await toExaminer();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    await toCheck();
    fireEvent.click(screen.getByRole('link', { name: 'Создать свой экзамен' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Регистрация' })).toBeInTheDocument();
    expect(screen.getByTestId('register-from').textContent).toBe(JSON.stringify(FROM_TRY));
  });

  it('«Ответить на этот вопрос ещё раз» starts a new check: the answer before it does not come back', async () => {
    tryReply = () => Q1_PARTIAL_AI;
    await answerQ1();
    await toExaminer();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    await toCheck();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить на этот вопрос ещё раз' }));
    expect(currentStep()).toBe('Ответ');
    tryReply = () => KEYWORDS_NO_KEY;
    fireEvent.click(screen.getByRole('button', { name: 'Написать ответ' }));
    fireEvent.change(screen.getByLabelText(/^Ваш ответ/), { target: { value: Q1_FOLLOWUP } });
    fireEvent.click(screen.getByRole('button', { name: 'Проверить ответ' }));
    await toExaminer();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    await toCheck();
    expect(checkHow()).toBe('ИИ сейчас недоступен. Ответ проверен по ключевым словам.');
    expect(tryRequests.map((request) => request.body.transcript)).toEqual([Q1_PARTIAL, Q1_FOLLOWUP]);
  });
});
