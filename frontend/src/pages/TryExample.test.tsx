import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import type { RecognitionResultEvent } from '../hooks/useSpeechAnswer';

const mocks = vi.hoisted(() => ({
  user: null as null | { id: string },
  confirm: vi.fn(async () => true),
}));

vi.mock('../lib/supabase', () => ({ supabase: {} }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: mocks.user, session: null, loading: false, signOut: vi.fn() }) }));
vi.mock('../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm, alert: vi.fn() }) }));

import TryExample from './TryExample';
import { EXAMPLE_NOTE } from '../components/example/ExampleSheet';
import { EXAMPLE_GRADE_NOTE, EXAMPLE_GRADE_NOTE_AI, EXAMPLE_GRADE_NOTE_PLAIN, EXAMPLE_SCALE_NOTE } from '../components/example/ExampleGrade';
import {
  CLOSING_PAUSE_MS,
  EXAMINER_PAUSE_MS,
  EXAMPLE_NEXT_LINE,
  EXAMPLE_PRIVACY_LINE,
  FOLLOWUP_LISTEN_MS,
  FOLLOWUP_WAIT_MS,
  LEAVE_MESSAGE,
} from '../components/example/ExampleTicket';
import { resetExampleDraws } from '../components/example/exampleFlow';
import { EXAMPLE_ANSWER_Q5 } from '../components/example/trySheet';
import { CHECKED_BY_AI, TRY_CHECK_TIMEOUT_MS, TRY_FOLLOWUP_TIMEOUT_MS } from '../components/example/tryCheck';
import { PASTE_REFUSED } from '../lib/oral/pasteGuard';
import { DONT_KNOW_VERDICT } from '../lib/oral/oralApi';

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

function renderAt(url: string, options: { strict?: boolean } = {}) {
  const tree = (
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/try/*" element={<TryExample />} />
        <Route path="/register" element={<h1>Регистрация</h1>} />
        <Route path="/login" element={<h1>Вход</h1>} />
        <Route path="/exams/new" element={<h1>Новый экзамен</h1>} />
        <Route path="/exams" element={<h1>Экзамены</h1>} />
        <Route path="/" element={<h1>Главная</h1>} />
      </Routes>
    </MemoryRouter>
  );
  return render(options.strict ? <StrictMode>{tree}</StrictMode> : tree);
}

const plain = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();
const advance = async (ms: number) => {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
};

/** After «Готово»: the examiner listens (its pause starts once the answer is in), then asks or closes. */
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

const Q1_PARTIAL = 'Закон спроса такой: когда цена растёт, люди покупают меньше. Кривая спроса на графике идёт вниз.';
const Q1_FOLLOWUP = 'Это когда покупатели готовы купить определённое количество товара при каждой цене';
const Q4_FULL =
  'Равновесие — это точка, где пересекаются кривые спроса и предложения. При равновесной цене величина спроса равна величине предложения. Если цена ниже равновесной, возникает дефицит: спрос превышает предложение. Если цена выше, возникает излишек, и продавцы снижают цену. В итоге цена сама приходит к равновесию.';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(2026, 9, 4, 19, 30, 0));
  mocks.user = null;
  mocks.confirm.mockReset();
  mocks.confirm.mockResolvedValue(true);
  FakeRecognition.instances = [];
  resetExampleDraws();
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
  // The draw's randomness (crypto.getRandomValues of one 32-bit number): always the first question.
  vi.spyOn(globalThis.crypto, 'getRandomValues').mockImplementation(<T extends ArrayBufferView | null>(array: T): T => {
    if (array instanceof Uint32Array) array.fill(0);
    return array;
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('«Попробовать на примере» (/try)', () => {
  it('takes a guest from the sheet through the draw, a typed answer and the examiner’s follow-up to the protocol', async () => {
    renderAt('/try?view=questions');

    // (a) The example's sheet: the subject, the honest note, numbers from the marks, the twelve questions.
    expect(screen.getByRole('heading', { level: 1, name: 'Микроэкономика' })).toBeInTheDocument();
    expect(screen.getByText(EXAMPLE_NOTE)).toBeInTheDocument();
    // Where the answers go, truly (PUB-3): the text goes to the server and to Gemini for the check; the tab keeps the answers.
    expect(plain(document.querySelector('.tx-privacy')?.textContent)).toBe(
      'Для проверки текст ответа отправляется на сервер Meldy и в ИИ-сервис Google Gemini. Meldy его не сохраняет: ваши ответы примера помнит только эта вкладка.',
    );
    expect(plain(document.querySelector('.ex-meta')?.textContent)).toBe('Экзамен · 12 вопросов, в билете один · 3 лекции');
    expect(screen.getByRole('button', { name: '1 вопроса нет ни в одной лекции. Показать его' })).toBeInTheDocument();
    expect(plain(document.querySelector('.ex-figs-now')?.textContent)).toBe('75 %');
    expect(plain(document.querySelector('.ex-share .ex-sub')?.textContent)).toBe('9 из 12 · частично — 2');
    const sheet = screen.getByRole('article', { name: 'Список вопросов кафедры с пометками' });
    expect(within(sheet).getByRole('heading', { name: 'Вопросы к экзамену по микроэкономике' })).toBeInTheDocument();
    expect(within(sheet).getAllByRole('button')).toHaveLength(12);
    expect(within(sheet).getAllByText('есть в лекциях', { selector: '.ex-sr' })).toHaveLength(9);
    expect(within(sheet).getAllByText('есть частично', { selector: '.ex-sr' })).toHaveLength(2);
    expect(within(sheet).getAllByText('нет ни в одной лекции', { selector: '.ex-sr' })).toHaveLength(1);
    expectAccessibleScreen();

    // «Почему» of a row: the lecture quote behind the mark, word for word.
    fireEvent.click(within(sheet).getByRole('button', { name: /Перекрёстная эластичность/ }));
    const why = screen.getByRole('region', { name: 'Есть частично' });
    expect(within(why).getByText('Не хватает: товаров Гиффена.')).toBeInTheDocument();
    expect(within(why).getByText('Перекрёстная эластичность показывает, как величина спроса на один товар реагирует на изменение цены другого.')).toBeInTheDocument();
    expect(plain(within(why).getByText(/^Лекция «Эластичность спроса»/).textContent)).toBe('Лекция «Эластичность спроса», фрагмент 6');
    // One filled pill at a time: the panel's answer, while «Тянуть билет» steps down to white.
    expect(within(why).getByRole('button', { name: 'Ответить на этот вопрос' })).toHaveClass('sf-primary');
    expect(screen.getByRole('button', { name: 'Тянуть билет' })).toHaveClass('ex-secondary');
    fireEvent.click(within(why).getByRole('button', { name: 'Закрыть' }));
    expect(screen.getByRole('button', { name: 'Тянуть билет' })).toHaveClass('sf-primary');

    // (b) «Тянуть билет»: the draw room turns the first card over.
    fireEvent.click(screen.getByRole('button', { name: 'Тянуть билет' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Тянуть билет' })).toBeInTheDocument();
    expect(document.title).toBe('Тянуть билет · пример — Meldy');
    const card = screen.getByRole('article', { name: 'Вопрос 1' });
    expect(card).toHaveAttribute('aria-live', 'polite');
    expect(within(card).getByText('Спрос. Закон спроса и кривая спроса.')).toBeInTheDocument();
    expect(screen.getByText('Случайно из 11 вопросов, которые есть в лекциях примера.')).toBeInTheDocument();
    expect(plain(screen.getByText(/^Вопроса 12 нет в лекциях примера/).textContent)).toBe(
      'Вопроса 12 нет в лекциях примера: ответ не с чем сверить, поэтому в билеты он не попадает.',
    );
    expectAccessibleScreen();

    // (c) The answer screen: the question, the closed points, the way to answer.
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Спрос. Закон спроса и кривая спроса.' })).toBeInTheDocument();
    expect(plain(document.querySelector('.or-note')?.textContent)).toBe('4 пункта ответа из лекций примера. Они откроются, когда вы их назовёте.');
    expect(screen.getByText(EXAMPLE_PRIVACY_LINE)).toBeInTheDocument();
    expect(plain(document.querySelector('.or-next')?.textContent)).toBe(plain(EXAMPLE_NEXT_LINE));
    expect(EXAMPLE_NEXT_LINE).toBe('После «Готово» экзаменатор спросит о пропущенном пункте, если он есть, а потом откроется протокол по пунктам из лекций.');
    const points = screen.getByRole('list', { name: 'Пункты ответа' });
    expect(within(points).getAllByRole('listitem').map((row) => row.getAttribute('aria-label'))).toEqual([
      'Пункт 1, ещё не назван',
      'Пункт 2, ещё не назван',
      'Пункт 3, ещё не назван',
      'Пункт 4, ещё не назван',
    ]);
    expectAccessibleScreen();

    // No speech API in this browser: the answer is typed; the points open as their key words come.
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    const field = screen.getByLabelText(/^Ваш ответ/);
    expect(field).toHaveFocus();
    fireEvent.change(field, { target: { value: Q1_PARTIAL } });
    expect(plain(document.querySelector('.or-count-line')?.textContent)).toBe('По ключевым словам: 2 из 4');
    const rows = within(points).getAllByRole('listitem');
    expect(rows.map((row) => row.hasAttribute('data-named'))).toEqual([false, true, true, false]);
    expect(within(rows[1]).getByText('Пункт 2 назван по ключевым словам.')).toBeInTheDocument();
    expect(plain(rows[1].querySelector('.or-pt-t')?.textContent)).toBe('«Закон спроса гласит: при прочих равных условиях чем выше цена, тем меньше величина спроса, и наоборот.»');
    const announcement = screen.getAllByRole('status').find((node) => node.textContent?.startsWith('Пункт 2 назван'));
    expect(announcement).toHaveAttribute('aria-live', 'polite');

    // «Готово»: the examiner listens, then asks about the main point that was not named.
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText('Экзаменатор слушает ответ…')).toBeInTheDocument();
    await toExaminer();
    const examiner = screen.getAllByRole('region', { name: 'Экзаменатор' }).find((node) => node.classList.contains('or-examiner'))!;
    expect(within(examiner).getByText('«Что экономисты называют спросом?»')).toBeInTheDocument();
    expect(within(examiner).queryByRole('button', { name: 'Повторить вопрос' })).toBeNull();
    const said = document.querySelector('.or-side > p.sr-only[aria-live="polite"]');
    expect(said?.textContent).toBe('Экзаменатор спрашивает: «Что экономисты называют спросом?»');
    expect(within(points).getAllByRole('listitem')[0]).toHaveAttribute('aria-label', 'Пункт 1 не назван, об этом спросил экзаменатор');
    const answer = within(examiner).getByRole('textbox', { name: 'Ответ на вопрос экзаменатора' });
    expect(answer).toHaveFocus();
    fireEvent.change(answer, { target: { value: Q1_FOLLOWUP } });
    fireEvent.click(within(examiner).getByRole('button', { name: 'Готово' }));

    // (d) The protocol: the points with the lecture quotes, what was named (no grade, Ф1), the honest lines, the way on.
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    // A partial reply to the question is no naming after it: only «сами».
    expect(plain(document.querySelector('.or-sum')?.textContent)).toBe('Сами назвали 1 из 2 главных пунктов');
    expect(plain(document.querySelector('.or-grade-why')?.textContent)).toBe('Раскрыто 2 пункта из 4, два не названы.');
    // The server had no key for the AI check: the key words checked the answer, and the protocol says so.
    expect(plain(document.querySelector('.or-ph-check')?.textContent)).toBe('Проверено по ключевым словам: проверка ИИ в примере сейчас недоступна.');
    expect(screen.getByText(EXAMPLE_GRADE_NOTE)).toBeInTheDocument();
    // The scale line in the example's words: its lectures are not the guest's own.
    expect(screen.getByText(EXAMPLE_SCALE_NOTE)).toBeInTheDocument();
    expect(EXAMPLE_SCALE_NOTE).toBe('Отметку ставит преподаватель по 10-\u2060балльной шкале. Meldy проверяет только, назвали ли вы пункты из лекций.');
    expect(screen.getByRole('button', { name: 'Пункт 1 не назван — о нём спросил экзаменатор.' })).toBeInTheDocument();
    const protocol = screen.getByRole('list', { name: 'Пункты ответа' });
    const statuses = within(protocol).getAllByRole('listitem').map((row) => row.getAttribute('data-status'));
    expect(statuses).toEqual(['missing', 'covered', 'covered', 'missing']);
    expect(plain(within(protocol).getAllByRole('listitem')[0].querySelector('.or-ppt-st')?.textContent)).toBe(
      'главный пункт · не назван; после вопроса экзаменатора по ключевым словам — упомянут',
    );
    expect(plain(document.querySelector('.or-extra')?.textContent)).toBe(
      `Дополнительный вопрос: «Что экономисты называют спросом?» — ответ: «${Q1_FOLLOWUP}». По ключевым словам пункт упомянут.`,
    );
    expect(plain(within(protocol).getAllByRole('listitem')[0].textContent)).toContain(
      '«Спрос — это зависимость между ценой товара и тем количеством, которое покупатели готовы и могут купить за определённый период.»',
    );
    expect(plain(within(protocol).getAllByRole('listitem')[1].textContent)).toContain('Вы:«Закон спроса такой: когда цена растёт, люди покупают меньше»');
    // No grade and no «Засчитано» anywhere (Ф1).
    expect(document.querySelector('.or-stamp, svg[data-mark="oval"]')).toBeNull();
    expect(document.body.textContent).not.toMatch(/[Зз]асчитан|Оценка|удовлетвор|отлично/);
    fireEvent.click(screen.getByRole('button', { name: 'Как считается' }));
    expect(plain(document.querySelector('.or-how')?.textContent)).toContain('строку шпаргалки такой пункт не стирает');
    expect(document.querySelector('.or-how')?.textContent).not.toMatch(/из 100|→/);
    expect(screen.getByRole('link', { name: 'Создать свой экзамен' })).toHaveAttribute('href', '/register?next=%2Fexams%2Fnew');
    expectAccessibleScreen();

    // «Ещё билет»: the next question, not the same one again.
    fireEvent.click(screen.getByRole('button', { name: 'Ещё билет' }));
    expect(screen.getByRole('article', { name: 'Вопрос 2' })).toBeInTheDocument();

    // One request left the page: the AI check, with the question's id and the answer — no points, no lecture
    // text, no token. The server had no key, so the reply to the examiner went to nobody: the key words judged it.
    // The answer is kept only in this tab, for the example's cheat sheet.
    expect(tryRequests).toEqual([{ url: '/api/try/evaluate', body: { question_id: 'q1', transcript: Q1_PARTIAL }, auth: null }]);
    expect(window.localStorage.length).toBe(0);
    const keys = Array.from({ length: window.sessionStorage.length }, (_, index) => window.sessionStorage.key(index));
    expect(keys.every((key) => key?.startsWith('meldy_try_'))).toBe(true);
    // Yesterday's three answers of the example and the guest's own.
    expect(JSON.parse(window.sessionStorage.getItem('meldy_try_sheet') ?? '{}').answers).toHaveLength(4);
  });

  it('closes a full answer with «Хорошо, по существу всё» and a 5, with no follow-up', async () => {
    renderAt('/try/ticket?q=q4');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    fireEvent.change(screen.getByLabelText(/^Ваш ответ/), { target: { value: Q4_FULL } });
    expect(plain(document.querySelector('.or-count-line')?.textContent)).toBe('По ключевым словам: 5 из 5');
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await toExaminer();
    expect(screen.getByText('Хорошо, по существу всё.')).toBeInTheDocument();
    expect(screen.queryByText('Экзаменатор', { selector: '.or-examiner-who' })).toBeNull();
    await advance(CLOSING_PAUSE_MS + 100);
    expect(plain(document.querySelector('.or-sum')?.textContent)).toBe('Сами назвали 4 из 4 главных пунктов');
    expect(plain(document.querySelector('.or-grade-why')?.textContent)).toBe('Раскрыто 5 пунктов из 5.');
    expect(tryRequests.map((request) => request.body)).toEqual([{ question_id: 'q4', transcript: Q4_FULL }]);
  });

  it('takes «Не знаю» on the follow-up as an answer: the point is not named after the question', async () => {
    renderAt('/try/ticket?q=q1');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    fireEvent.change(screen.getByLabelText(/^Ваш ответ/), {
      target: { value: 'Спрос — это сколько товара покупатели готовы купить. Кривая спроса идёт вниз, а величина спроса — количество при конкретной цене.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await toExaminer();
    expect(screen.getByText('«Как по закону спроса связаны цена и величина спроса?»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    expect(plain(document.querySelector('.or-sum')?.textContent)).toBe('Сами назвали 1 из 2 главных пунктов');
    expect(plain(document.querySelector('.or-extra')?.textContent)).toBe('Дополнительный вопрос: «Как по закону спроса связаны цена и величина спроса?» — ответ: не знаю.');
    expect(document.body.textContent).not.toMatch(/Оценк|ограничил/);
  });

  it('answers by voice: the points light up from the words recognised, the follow-up is listened to after it appears', async () => {
    vi.stubGlobal('webkitSpeechRecognition', FakeRecognition);
    renderAt('/try/ticket?q=q1');
    expect(screen.getByRole('button', { name: 'Ответить текстом' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Отвечать голосом' }));
    expect(recognition().running).toBe(true);
    act(() => recognition().say([['Закон спроса такой когда цена растёт', false]]));
    expect(plain(document.querySelector('.or-count-line')?.textContent)).toBe('По ключевым словам: 1 из 4');
    act(() => recognition().say([[Q1_PARTIAL, true]]));
    expect(plain(document.querySelector('.or-count-line')?.textContent)).toBe('По ключевым словам: 2 из 4');
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await toExaminer();
    expect(screen.getByText('«Что экономисты называют спросом?»')).toBeInTheDocument();
    // The question is shown, not spoken: no /api/tts. Listening starts right after it appears.
    await advance(FOLLOWUP_LISTEN_MS);
    expect(recognition().running).toBe(true);
    act(() => recognition().say([[Q1_FOLLOWUP, true]]));
    expect(screen.getByText(Q1_FOLLOWUP)).toBeInTheDocument();
    fireEvent.click(within(document.querySelector('.or-examiner') as HTMLElement).getByRole('button', { name: 'Готово' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    expect(plain(document.querySelector('.or-sum')?.textContent)).toBe('Сами назвали 1 из 2 главных пунктов');
    // The recognised answer goes to the check once; the answer to the follow-up stays on the device.
    expect(tryRequests.map((request) => request.body)).toEqual([{ question_id: 'q1', transcript: Q1_PARTIAL }]);
  });

  it('gives a signed-in student the way to their exams and to a new exam of their own', async () => {
    mocks.user = { id: 'user-1' };
    renderAt('/try/ticket?q=q7');
    expect(screen.getByRole('link', { name: 'Мои экзамены' })).toHaveAttribute('href', '/exams');
    expect(screen.queryByRole('link', { name: 'Войти' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    fireEvent.change(screen.getByLabelText(/^Ваш ответ/), { target: { value: 'Выручка — это цена, умноженная на количество проданного товара.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await toExaminer();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByRole('link', { name: 'Создать свой экзамен' })).toHaveAttribute('href', '/exams/new');
  });

  it('shows a guest the way in from the top line', () => {
    renderAt('/try');
    const bar = screen.getByRole('navigation', { name: 'Вход и регистрация' });
    expect(within(bar).getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/login');
    // Decision 5: the call to start with one's own list where there is room («Создать аккаунт» on a phone); the
    // sign-up leads on to a new exam, where the list comes first.
    expect(within(bar).getByRole('link', { name: 'Начать со своего списка' })).toHaveAttribute('href', '/register?next=%2Fexams%2Fnew');
    expect(screen.getByRole('link', { name: 'Meldy, на главную' })).toHaveAttribute('href', '/');
  });

  it('asks before leaving an answer in progress: nothing of it is saved', async () => {
    mocks.confirm.mockResolvedValue(false);
    renderAt('/try/ticket?q=q2');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    fireEvent.change(screen.getByLabelText(/^Ваш ответ/), { target: { value: 'Спрос зависит от доходов' } });
    fireEvent.click(screen.getByRole('link', { name: 'Лист примера' }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Выйти из билета?', message: LEAVE_MESSAGE }));
    // The tab keeps finished answers (the sheet erases by them): only this unfinished one is lost (PUB-3).
    expect(LEAVE_MESSAGE).toBe('Ответ пропадёт: незаконченный ответ нигде не сохраняется.');
    await act(async () => undefined);
    expect(screen.getByLabelText(/^Ваш ответ/)).toHaveValue('Спрос зависит от доходов');
  });

  it('says honestly when a question cannot be answered in the example', () => {
    renderAt('/try/ticket?q=q12');
    expect(screen.getByRole('heading', { level: 1, name: 'Этого вопроса нет в лекциях примера' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Тянуть билет' })).toHaveAttribute('href', '/try/draw');
    cleanup();
    renderAt('/try/ticket?q=nope');
    expect(screen.getByRole('heading', { level: 1, name: 'Такого вопроса в примере нет' })).toBeInTheDocument();
  });

  it('opens the question in no lecture with its nearest fragment and the words that matched', () => {
    renderAt('/try');
    fireEvent.click(screen.getByRole('button', { name: /Рынок труда/ }));
    const why = screen.getByRole('region', { name: (name) => plain(name) === 'Ни в одной из 3 лекций нет фрагмента об этом' });
    expect(plain(within(why).getByText(/^Ближе всего/).textContent)).toBe('Ближе всего — «Спрос и предложение», фрагмент 1: совпали слова «рынок», «спрос».');
    expect(within(why).queryByRole('button', { name: 'Ответить на этот вопрос' })).toBeNull();
  });

  it('filters the sheet by its marks and opens the lectures it was checked against', () => {
    renderAt('/try?view=questions');
    fireEvent.click(screen.getByRole('button', { name: '1 вопроса нет ни в одной лекции. Показать его' }));
    const sheet = screen.getByRole('article', { name: 'Список вопросов кафедры с пометками' });
    // A row's button is named by its question; the status pill inside it is for the eye only (aria-hidden).
    const spoken = (row: Element) => {
      const copy = row.cloneNode(true) as Element;
      copy.querySelectorAll('[aria-hidden="true"]').forEach((node) => node.remove());
      return plain(copy.textContent);
    };
    expect(within(sheet).getAllByRole('button').map(spoken)).toEqual(['Рынок труда: спрос на труд и заработная плата.']);
    fireEvent.click(screen.getByRole('button', { name: /^Все/ }));
    expect(within(sheet).getAllByRole('button')).toHaveLength(12);
    const lectures = screen.getByRole('region', { name: 'Лекции примера' });
    expect(within(lectures).getAllByRole('group')).toHaveLength(3);
    expect(within(lectures).getByText('Спрос и предложение', { selector: '.tx-lecture-t' })).toBeInTheDocument();
  });
  it('opens on the cheat sheet: written, with yesterday’s answers to 1, 5 and 9 rubbed in, and says so', () => {
    renderAt('/try');
    expect(screen.getByRole('tab', { name: 'Шпаргалка' })).toHaveAttribute('aria-selected', 'true');
    expect(plain(document.querySelector('.tx-sheet-cap')?.textContent)).toBe(
      'Для примера считаем, что вчера в это же время вы ответили на вопросы 1, 5 и 9: что вы назвали — стёрто наполовину, что не назвали — с пометкой «не назван». Ответьте на вопрос 5 — что назовёте снова, сотрётся совсем. Ответ проверяет ИИ — так же, как в вашем экзамене.',
    );
    // The scripted moment is the page's blue pill under the caption (PUB-15); «Тянуть билет» (a random question) is the white one.
    expect(screen.getByRole('link', { name: 'Ответить на вопрос 5' })).toHaveAttribute('href', '/try/ticket?q=q5');
    expect(screen.getByRole('link', { name: 'Ответить на вопрос 5' })).toHaveClass('sf-primary');
    expect(screen.getByRole('button', { name: 'Тянуть билет' })).toHaveClass('ex-secondary');
    expect(document.title).toBe('Пример экзамена — Meldy');
    const paper = screen.getByRole('tabpanel', { name: 'Шпаргалка' });
    const states = (id: string) => [...paper.querySelectorAll<HTMLElement>(`#cs-q-${id} .cs-line`)].map((line) => line.dataset.state);
    expect(states('q5')).toEqual(['rubbed', 'rubbed', 'rubbed', 'missed', 'missed']);
    expect(states('q9')).toEqual(['rubbed', 'missed', 'rubbed', 'missed', 'missed']);
    // Question 1 is on the first screen of every size: the rubbed lines are seen at once.
    expect(states('q1')).toEqual(['rubbed', 'rubbed', 'missed', 'missed']);
    expect(states('q2')).toEqual(['fresh', 'fresh', 'fresh']);
    // Nothing touched yet: no «Начать пример заново».
    expect(screen.queryByRole('button', { name: 'Начать пример заново' })).toBeNull();
    // The lines are the short ones; a question in no lecture says so, with no link to add one.
    expect(plain(paper.querySelector('#cs-q-q7 .cs-line .cs-ink')?.textContent)).toBe('выручка = цена × количество');
    expect(plain(paper.querySelector('#cs-q-q12 .cs-pnote')?.textContent)).toBe('Ни в одной из 3 лекций нет фрагмента об этом');
    expect(paper.querySelector('#cs-q-q12 .cs-pnote a')).toBeNull();
    // The counter: 47 lines, 5 of them rubbed (still there).
    expect(document.querySelector('.cs-big')?.textContent).toBe('47');
    expect(plain(document.querySelector('.cs-count-l')?.textContent)).toBe('строк осталось из 47');
    expect(fetchSpy).not.toHaveBeenCalled();
    expectAccessibleScreen();
  });

  it('a rubbed line of yesterday’s answer: its history says «ответ примера» and opens that answer’s protocol', async () => {
    renderAt('/try');
    const paper = screen.getByRole('tabpanel', { name: 'Шпаргалка' });
    fireEvent.click(paper.querySelector<HTMLButtonElement>('#cs-q-q9 .cs-line .cs-lbtn')!);
    const panel = document.querySelector('.cs-lp') as HTMLElement;
    expect(within(panel).getByRole('link', { name: 'Ответить на этот вопрос' })).toHaveAttribute('href', '/try/ticket?q=q9');
    const item = within(panel.querySelector('.cs-lp-history') as HTMLElement).getByRole('link');
    expect(plain(item.textContent)).toMatch(/^3 окт\., 19:30 — назван \(ответ примера\)$/);
    fireEvent.click(item);
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 9' })).toBeInTheDocument();
    expect(plain(document.querySelector('.or-readonly-note')?.textContent)).toBe(
      'Ответ примера: считаем, что он дан вчера, 3 октября, 19:30. Строки названных в нём пунктов этот ответ стёр на шпаргалке наполовину.',
    );
    expect(plain(document.querySelector('.or-sum')?.textContent)).toBe('Сами назвали 2 из 4 главных пунктов');
    // A kept answer read later: no line about the sheet under the date (the note above says it).
    expect(document.querySelector('.or-ph-sheet')).toBeNull();
    expect(screen.getByRole('link', { name: 'К шпаргалке' })).toHaveAttribute('href', '/try?view=sheet');
  });

  it('refuses a pasted ready text as a real ticket does; «Вставить ответ примера» is a button and still fills the answer (Н7)', async () => {
    renderAt('/try/ticket?q=q5');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    const field = screen.getByLabelText(/^Ваш ответ/) as HTMLTextAreaElement;
    expect(fireEvent.paste(field, { clipboardData: { getData: () => EXAMPLE_ANSWER_Q5 } })).toBe(false);
    expect(field.value).toBe('');
    expect(screen.getByText(PASTE_REFUSED)).toBeInTheDocument();
    expect(plain(document.querySelector('.or-count-line')?.textContent)).toBe('По ключевым словам: 0 из 5');
    // The button puts the example's own answer in, and the line about the refused paste goes away.
    fireEvent.click(screen.getByRole('button', { name: 'Вставить ответ примера' }));
    expect((screen.getByLabelText(/^Ваш ответ/) as HTMLTextAreaElement).value).toBe(EXAMPLE_ANSWER_Q5);
    expect(plain(document.querySelector('.or-count-line')?.textContent)).toBe('По ключевым словам: 4 из 5');
    expect(screen.queryByText(PASTE_REFUSED)).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('answer 5 with the example’s answer: the protocol says what erased, and the sheet plays it', async () => {
    renderAt('/try/ticket?q=q5');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    fireEvent.click(screen.getByRole('button', { name: 'Вставить ответ примера' }));
    expect(plain(document.querySelector('.or-count-line')?.textContent)).toBe('По ключевым словам: 4 из 5');
    expect(screen.queryByRole('button', { name: 'Вставить ответ примера' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await toExaminer();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 5' })).toBeInTheDocument();
    // Named yesterday and again today, the three main points are erased; the sign of the elasticity is half.
    const line = document.querySelector('.or-sheet-change') as HTMLElement;
    // Under the date of the protocol, where the «Засчитано» stamp was (Ф1); «К шпаргалке» on the desk leads there.
    expect(line.closest('.or-ph')).not.toBeNull();
    expect(plain(line.textContent)).toBe('На шпаргалке: 3 строки стёрлись, 1 — наполовину');
    expect(within(line).queryByRole('link')).toBeNull();
    fireEvent.click(screen.getByRole('link', { name: 'К шпаргалке' }));
    const paper = await screen.findByRole('tabpanel', { name: 'Шпаргалка' });
    expect(await screen.findByText((_, node) => node?.classList.contains('cs-change') === true && plain(node.textContent) === 'После ответа: 3 строки стёрлись, 1 — наполовину.', {}, { timeout: 8000 })).toBeInTheDocument();
    expect([...paper.querySelectorAll<HTMLElement>('#cs-q-q5 .cs-line')].map((node) => node.dataset.state)).toEqual(['erased', 'erased', 'erased', 'rubbed', 'missed']);
    // Every main line erased: the question's tick.
    expect(paper.querySelector('#cs-q-q5 .cs-tick')).not.toBeNull();
    // The guest has answered: an exam of their own is the next step, in the column under what changed (PUB-18).
    const next = document.querySelector('.cs-next') as HTMLElement;
    expect(within(next).getByRole('link', { name: 'Начать со своего списка' })).toHaveAttribute('href', '/register?next=%2Fexams%2Fnew');
    expect(within(next).getByRole('link', { name: 'Начать со своего списка' })).toHaveClass('sf-primary');
    expect(screen.queryByRole('link', { name: 'Ответить на вопрос 5' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Тянуть билет' })).toHaveClass('ex-secondary');
    expect(tryRequests.map((request) => request.body)).toEqual([{ question_id: 'q5', transcript: EXAMPLE_ANSWER_Q5 }]);
    // The sheet replays the answer in real time (its own wait is up to 8 s): the default 5 s is too tight on a busy machine.
  }, 15_000);

  it('in StrictMode too: «Вставить ответ примера» before choosing a way, the protocol’s next steps, the sheet plays the answer, «Начать пример заново»', async () => {
    renderAt('/try/ticket?q=q5', { strict: true });
    // Straight from the ticket: the example's answer goes into a text answer.
    fireEvent.click(screen.getByRole('button', { name: 'Вставить ответ примера' }));
    expect(screen.getByLabelText(/^Ваш ответ/)).toHaveValue(EXAMPLE_ANSWER_Q5);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await toExaminer();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 5' })).toBeInTheDocument();
    // The sheet first: «К шпаргалке» is the filled pill, «Ещё билет» next to it; the rest is quieter.
    const toSheet = screen.getByRole('link', { name: 'К шпаргалке' });
    expect(toSheet).toHaveClass('sf-primary');
    expect(screen.getByRole('button', { name: 'Ещё билет' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Создать свой экзамен' })).toHaveClass('ex-secondary');
    fireEvent.click(toSheet);
    const paper = await screen.findByRole('tabpanel', { name: 'Шпаргалка' });
    // A render run twice must not take the after-answer flag away: the change is played.
    expect(await screen.findByText((_, node) => node?.classList.contains('cs-change') === true && plain(node.textContent) === 'После ответа: 3 строки стёрлись, 1 — наполовину.', {}, { timeout: 8000 })).toBeInTheDocument();
    const states = () => [...paper.querySelectorAll<HTMLElement>('#cs-q-q5 .cs-line')].map((node) => node.dataset.state);
    expect(states()).toEqual(['erased', 'erased', 'erased', 'rubbed', 'missed']);
    // The guest's answer is in: the example can start again, with yesterday's answers only.
    fireEvent.click(screen.getByRole('button', { name: 'Начать пример заново' }));
    expect(states()).toEqual(['rubbed', 'rubbed', 'rubbed', 'missed', 'missed']);
    expect(screen.queryByRole('button', { name: 'Начать пример заново' })).toBeNull();
    // Effects run twice in StrictMode; the answer is still checked once.
    expect(tryRequests.map((request) => request.body)).toEqual([{ question_id: 'q5', transcript: EXAMPLE_ANSWER_Q5 }]);
    // The sheet replays the answer in real time (its own wait is up to 8 s): the default 5 s is too tight on a busy machine.
  }, 15_000);
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

/** Q1_PARTIAL typed on question 1, «Готово». */
async function answerQ1(text = Q1_PARTIAL) {
  renderAt('/try/ticket?q=q1');
  fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
  fireEvent.change(screen.getByLabelText(/^Ваш ответ/), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
}

const checkLineText = () => plain(document.querySelector('.or-ph-check')?.textContent);
const protocolStatuses = () => within(screen.getByRole('list', { name: 'Пункты ответа' })).getAllByRole('listitem').map((row) => row.getAttribute('data-status'));

describe('the AI check of the example (/api/try/evaluate)', () => {
  it('says before the answer that the text goes to Meldy’s server and to Google’s AI service, and that Meldy keeps nothing', () => {
    renderAt('/try/ticket?q=q1');
    expect(screen.getByText(EXAMPLE_PRIVACY_LINE)).toBeInTheDocument();
    expect(EXAMPLE_PRIVACY_LINE).toBe(
      'Речь распознаёт браузер, в Chrome — через сервис Google. Для проверки текст ответа отправляется на сервер Meldy и в ИИ-сервис Google Gemini. Meldy его не сохраняет.',
    );
    expect(EXAMPLE_PRIVACY_LINE).not.toMatch(/не получает|по ключевым словам/);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('checks a retelling in the guest’s own words by the AI: the examiner asks about what is missing, the protocol is the AI’s', async () => {
    tryReply = () => Q1_OWN_WORDS_AI;
    await answerQ1(Q1_OWN_WORDS);
    expect(plain(document.querySelector('.or-strip-count')?.textContent)).toContain('По ключевым словам: 0 из 4');
    await toExaminer();
    // The AI found points 1 and 2 in other words: the examiner asks about the curve, not about them.
    expect(screen.getByText('«Как выглядит кривая спроса на графике?»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    expect(checkLineText()).toBe(CHECKED_BY_AI);
    expect(protocolStatuses()).toEqual(['covered', 'covered', 'missing', 'missing']);
    const rows = within(screen.getByRole('list', { name: 'Пункты ответа' })).getAllByRole('listitem');
    // Where the key words and the AI differ, the protocol says so, as on a real ticket.
    expect(plain(rows[0].textContent)).toContain('По ключевым словам пункт не назван; проверка по всему ответу: раскрыт.');
    expect(plain(rows[1].textContent)).toContain('Вы:«подорожал — берут реже, подешевел — чаще»');
    expect(plain(rows[2].textContent)).toContain('О графике ничего не сказано.');
    expect(plain(document.querySelector('.or-sum')?.textContent)).toBe('Сами назвали 2 из 2 главных пунктов');
    expect(screen.getByText(EXAMPLE_GRADE_NOTE_AI)).toBeInTheDocument();
    expect(screen.queryByText(EXAMPLE_GRADE_NOTE)).toBeNull();
    // No grade and no «Засчитано» (Ф1).
    expect(document.body.textContent).not.toMatch(/[Зз]асчитан|Оценка|удовлетвор|отлично/);
    // The question's id and the answer, nothing else: the server keeps the points itself. No token either.
    expect(tryRequests).toEqual([{ url: '/api/try/evaluate', body: { question_id: 'q1', transcript: Q1_OWN_WORDS }, auth: null }]);

    // The tab keeps the AI's protocol: read again from the sheet's history, it is the same.
    const store = JSON.parse(window.sessionStorage.getItem('meldy_try_sheet') ?? '{}') as { answers: Array<Record<string, unknown>> };
    const mine = store.answers.find((answer) => !String(answer.session).startsWith('try-seed-'))!;
    expect(mine.check).toEqual({ by: 'ai' });
    expect(mine.statuses).toEqual({ p1: 'covered', p2: 'covered', p3: 'missing', p4: 'missing' });
    expect(mine.live).toEqual([]);
    cleanup();
    renderAt(`/try/ticket?q=q1&answer=${encodeURIComponent(String(mine.session))}`);
    expect(screen.getByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    expect(checkLineText()).toBe(CHECKED_BY_AI);
    expect(protocolStatuses()).toEqual(['covered', 'covered', 'missing', 'missing']);
    const kept = within(screen.getByRole('list', { name: 'Пункты ответа' })).getAllByRole('listitem');
    expect(plain(kept[1].textContent)).toContain('Вы:«подорожал — берут реже, подешевел — чаще»');
    expect(plain(kept[0].textContent)).toContain('По ключевым словам пункт не назван; проверка по всему ответу: раскрыт.');
    expect(screen.getByText(EXAMPLE_GRADE_NOTE_AI)).toBeInTheDocument();
  });

  it('shows a point said wrong as an error with the lecture’s correction', async () => {
    const wrong = 'Закон спроса такой: когда цена растёт, люди покупают больше. Кривая спроса на графике идёт вниз.';
    tryReply = () =>
      ai(
        [
          ['p1', 'missing'],
          ['p2', 'wrong', 'когда цена растёт, люди покупают больше'],
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
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    expect(protocolStatuses()).toEqual(['missing', 'wrong', 'covered', 'missing']);
    expect(screen.getByText('Поправка: Чем выше цена, тем меньше величина спроса.')).toBeInTheDocument();
    expect(checkLineText()).toBe(CHECKED_BY_AI);
  });

  it.each<[string, () => TryReply, string]>([
    ['the server has no key', () => KEYWORDS_NO_KEY, 'Проверено по ключевым словам: проверка ИИ в примере сейчас недоступна.'],
    ['the day’s AI checks are spent', () => ({ status: 200, body: { mode: 'keywords', reason: 'day_cap' } }), 'Проверено по ключевым словам: проверки ИИ в примере на сегодня закончились.'],
    ['the model is busy', () => ({ status: 200, body: { mode: 'keywords', reason: 'busy' } }), 'Проверено по ключевым словам: проверка ИИ в примере сейчас недоступна.'],
    ['the model ran out of time', () => ({ status: 200, body: { mode: 'keywords', reason: 'timeout' } }), 'Проверено по ключевым словам: ИИ не успел проверить ответ.'],
    ['one address checked too much', () => ({ status: 429, body: { detail: 'Слишком много запросов. Подождите минуту и повторите.' } }), 'Проверено по ключевым словам: из вашей сети было слишком много проверок подряд.'],
    ['the connection broke', () => 'network', 'Проверено по ключевым словам: нет связи с сервером.'],
    ['the server failed', () => ({ status: 502, body: { detail: 'Bad gateway' } }), 'Проверено по ключевым словам: проверка ИИ в примере сейчас недоступна.'],
    ['the protocol is unusable', () => ({ status: 200, body: { mode: 'ai', evaluation: { points: [] } } }), 'Проверено по ключевым словам: проверка ИИ в примере сейчас недоступна.'],
  ])('checks by the key words when %s, and the protocol says so', async (_, reply, line) => {
    tryReply = reply;
    await answerQ1();
    await toExaminer();
    expect(screen.getByText('«Что экономисты называют спросом?»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    expect(checkLineText()).toBe(line);
    // Today's key-word check, as the example always did it.
    expect(protocolStatuses()).toEqual(['missing', 'covered', 'covered', 'missing']);
    expect(plain(document.querySelector('.or-sum')?.textContent)).toBe('Сами назвали 1 из 2 главных пунктов');
    expect(screen.getByText(EXAMPLE_GRADE_NOTE)).toBeInTheDocument();
    const store = JSON.parse(window.sessionStorage.getItem('meldy_try_sheet') ?? '{}') as { answers: Array<Record<string, unknown>> };
    const mine = store.answers.find((answer) => !String(answer.session).startsWith('try-seed-'))!;
    expect((mine.check as { by: string }).by).toBe('keywords');
    expect(mine.evaluation).toBeUndefined();
  });

  it('a correct reply to the examiner counts: the AI judges it by the point, «ещё 1 — после вопроса экзаменатора» (PUB-2)', async () => {
    const answer = 'Спрос зависит от доходов, вкусов и цен других товаров. Когда меняется цена самого товара, это движение вдоль кривой.';
    const reply = 'Вправо, а если спрос упал — влево.';
    tryReply = (body) =>
      body.point_id
        ? { status: 200, body: { mode: 'ai', status: 'covered' } }
        : ai([
            ['p1', 'covered', 'Спрос зависит от доходов, вкусов и цен других товаров'],
            ['p2', 'covered', 'Когда меняется цена самого товара, это движение вдоль кривой'],
            ['p3', 'missing', '', 'О сдвиге кривой не сказано.'],
          ]);
    renderAt('/try/ticket?q=q2');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    fireEvent.change(screen.getByLabelText(/^Ваш ответ/), { target: { value: answer } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await toExaminer();
    expect(screen.getByText('«Куда сдвигается кривая спроса, если спрос на товар вырос?»')).toBeInTheDocument();
    const field = screen.getByRole('textbox', { name: 'Ответ на вопрос экзаменатора' });
    fireEvent.change(field, { target: { value: reply } });
    // Ctrl+Enter in the field is «Готово».
    fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true });
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 2' })).toBeInTheDocument();
    expect(plain(document.querySelector('.or-sum')?.textContent)).toBe('Сами назвали 2 из 3 главных пунктов, ещё 1 — после вопроса экзаменатора');
    const rows = within(screen.getByRole('list', { name: 'Пункты ответа' })).getAllByRole('listitem');
    expect(plain(rows[2].querySelector('.or-ppt-st')?.textContent)).toBe('главный пункт · назван только после вопроса экзаменатора');
    expect(plain(document.querySelector('.or-extra')?.textContent)).toBe(
      `Дополнительный вопрос: «Куда сдвигается кривая спроса, если спрос на товар вырос?» — ответ: «${reply.slice(0, -1)}». Пункт назван после вопроса — строку шпаргалки это не стирает.`,
    );
    // Two requests: the answer, then the reply with the point's id — no question, no expected answer.
    expect(tryRequests.map((request) => request.body)).toEqual([
      { question_id: 'q2', transcript: answer },
      { question_id: 'q2', point_id: 'p3', transcript: reply },
    ]);
    // The example's sheet: the line of point 3 says how it was named.
    fireEvent.click(screen.getByRole('link', { name: 'К шпаргалке' }));
    const paper = await screen.findByRole('tabpanel', { name: 'Шпаргалка' });
    const note = () => plain(paper.querySelectorAll<HTMLElement>('#cs-q-q2 .cs-line')[2]?.querySelector('.cs-note')?.textContent);
    await vi.waitFor(() => expect(note()).toBe('4 окт. назван только после вопроса экзаменатора'), { timeout: 9000, interval: 100 });
    // The sheet replays the answer in real time (its own wait is up to 8 s).
  }, 15_000);

  it('a reply the AI could not judge in time is judged by the key words, and the protocol says so', async () => {
    tryReply = (body) => (body.point_id ? 'hang' : Q1_PARTIAL_AI);
    await answerQ1();
    await toExaminer();
    const field = screen.getByRole('textbox', { name: 'Ответ на вопрос экзаменатора' });
    fireEvent.change(field, { target: { value: Q1_FOLLOWUP } });
    fireEvent.click(within(field.closest('.or-examiner') as HTMLElement).getByRole('button', { name: 'Готово' }));
    expect(await screen.findByText('Экзаменатор слушает ответ…')).toBeInTheDocument();
    await advance(TRY_FOLLOWUP_TIMEOUT_MS + 100);
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    // The answer itself was the AI's; the reply, the key words' — never «назван» by them.
    expect(checkLineText()).toBe(CHECKED_BY_AI);
    expect(plain(document.querySelector('.or-sum')?.textContent)).toBe('Сами назвали 1 из 2 главных пунктов');
    expect(plain(document.querySelector('.or-extra')?.textContent)).toMatch(/По ключевым словам пункт упомянут\.$/);
    expect(tryRequests.map((request) => request.body.point_id ?? null)).toEqual([null, 'p1']);
  });

  it('a slow AI: the examiner asks by the key words after a few seconds, and the protocol waits for the AI', async () => {
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
    expect(await screen.findByText('Сверяем ответ с пунктами…')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeNull();
    await act(async () => {
      release();
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    expect(checkLineText()).toBe(CHECKED_BY_AI);
    expect(protocolStatuses()).toEqual(['missing', 'covered', 'covered', 'missing']);
  });

  it('a server that does not answer at all: the key words after the time limit, and the protocol says so', async () => {
    tryReply = () => 'hang';
    await answerQ1();
    await toExaminer();
    await advance(FOLLOWUP_WAIT_MS);
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByText('Сверяем ответ с пунктами…')).toBeInTheDocument();
    await advance(TRY_CHECK_TIMEOUT_MS);
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    expect(checkLineText()).toBe('Проверено по ключевым словам: ИИ не успел проверить ответ.');
    expect(protocolStatuses()).toEqual(['missing', 'covered', 'covered', 'missing']);
  });

  it('«не знаю» as the whole answer goes nowhere: nothing named, as the button', async () => {
    await answerQ1('Не знаю.');
    await toExaminer();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    expect(checkLineText()).toBe(DONT_KNOW_VERDICT);
    expect(protocolStatuses()).toEqual(['missing', 'missing', 'missing', 'missing']);
    expect(screen.getByText(EXAMPLE_GRADE_NOTE_PLAIN)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('an answer over 4000 characters is checked by the key words without a request', async () => {
    await answerQ1(`${Q1_PARTIAL} ${'и так далее '.repeat(400)}`);
    await toExaminer();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    expect(checkLineText()).toBe('Проверено по ключевым словам: ИИ в примере проверяет ответы до 4000 знаков.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('offline: the key words at once, without a request', async () => {
    vi.spyOn(window.navigator, 'onLine', 'get').mockReturnValue(false);
    await answerQ1();
    await toExaminer();
    expect(screen.getByText('«Что экономисты называют спросом?»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    expect(checkLineText()).toBe('Проверено по ключевым словам: нет связи с сервером.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('«Вставить ответ примера» on question 5: the AI checks the example’s answer, and the sheet erases by it', async () => {
    tryReply = () =>
      ai([
        ['p1', 'covered', 'на сколько процентов изменится спрос, если цена изменится на один процент'],
        ['p2', 'covered', 'Её считают как отношение процентного изменения спроса к процентному изменению цены'],
        ['p3', 'covered', 'Если модуль больше единицы, спрос эластичный, если меньше единицы — неэластичный'],
        ['p4', 'covered', 'Знак у эластичности обычно отрицательный, поэтому сравнивают модуль'],
        ['p5', 'missing', '', 'Крайние случаи не названы.'],
      ]);
    renderAt('/try/ticket?q=q5');
    fireEvent.click(screen.getByRole('button', { name: 'Вставить ответ примера' }));
    expect(screen.getByLabelText(/^Ваш ответ/)).toHaveValue(EXAMPLE_ANSWER_Q5);
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await toExaminer();
    expect(screen.getByText('«Какие крайние случаи ценовой эластичности спроса бывают?»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 5' })).toBeInTheDocument();
    expect(checkLineText()).toBe(CHECKED_BY_AI);
    expect(protocolStatuses()).toEqual(['covered', 'covered', 'covered', 'covered', 'missing']);
    expect(plain(document.querySelector('.or-sheet-change')?.textContent)).toBe('На шпаргалке: 3 строки стёрлись, 1 — наполовину');
    expect(tryRequests.map((request) => request.body)).toEqual([{ question_id: 'q5', transcript: EXAMPLE_ANSWER_Q5 }]);
  });

  it('«Ответить ещё раз» starts a new check: the answer before it does not come back', async () => {
    tryReply = () => Q1_PARTIAL_AI;
    await answerQ1();
    await toExaminer();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ответить ещё раз' }));
    tryReply = () => KEYWORDS_NO_KEY;
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    fireEvent.change(screen.getByLabelText(/^Ваш ответ/), { target: { value: Q1_FOLLOWUP } });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await toExaminer();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    expect(checkLineText()).toBe('Проверено по ключевым словам: проверка ИИ в примере сейчас недоступна.');
    expect(tryRequests.map((request) => request.body.transcript)).toEqual([Q1_PARTIAL, Q1_FOLLOWUP]);
  });

  it('yesterday’s answers of the example say they were marked by the key words', async () => {
    renderAt('/try');
    const paper = screen.getByRole('tabpanel', { name: 'Шпаргалка' });
    fireEvent.click(paper.querySelector<HTMLButtonElement>('#cs-q-q9 .cs-line .cs-lbtn')!);
    fireEvent.click(within(document.querySelector('.cs-lp-history') as HTMLElement).getByRole('link'));
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 9' })).toBeInTheDocument();
    expect(checkLineText()).toBe('Проверено по ключевым словам.');
    expect(screen.getByText(EXAMPLE_GRADE_NOTE)).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
