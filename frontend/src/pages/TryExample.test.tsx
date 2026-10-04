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
import { EXAMPLE_GRADE_NOTE } from '../components/example/ExampleGrade';
import { CLOSING_PAUSE_MS, EXAMINER_PAUSE_MS, EXAMPLE_PRIVACY_LINE, FOLLOWUP_LISTEN_MS } from '../components/example/ExampleTicket';
import { resetExampleDraws } from '../components/example/exampleFlow';

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

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <Routes>
        <Route path="/try/*" element={<TryExample />} />
        <Route path="/register" element={<h1>Регистрация</h1>} />
        <Route path="/login" element={<h1>Вход</h1>} />
        <Route path="/exams/new" element={<h1>Новый экзамен</h1>} />
        <Route path="/exams" element={<h1>Экзамены</h1>} />
        <Route path="/" element={<h1>Главная</h1>} />
      </Routes>
    </MemoryRouter>,
  );
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
  fetchSpy = vi.fn(async () => {
    throw new Error('The example must not call the network');
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
    renderAt('/try');

    // (a) The example's sheet: the subject, the honest note, numbers from the marks, the twelve questions.
    expect(screen.getByRole('heading', { level: 1, name: 'Микроэкономика' })).toBeInTheDocument();
    expect(screen.getByText(EXAMPLE_NOTE)).toBeInTheDocument();
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

    // (d) The protocol: the points with the lecture quotes, the app's grade, the honest line, the way on.
    expect(await screen.findByRole('heading', { level: 1, name: 'Протокол ответа, Вопрос 1' })).toBeInTheDocument();
    expect(screen.getByText('Оценка 3 · удовлетворительно')).toBeInTheDocument();
    expect(plain(document.querySelector('.or-grade-why')?.textContent)).toBe('Раскрыто 2 пункта из 4, два не названы.');
    expect(screen.getByText(EXAMPLE_GRADE_NOTE)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Пункт 1 не назван — о нём спросил экзаменатор.' })).toBeInTheDocument();
    const protocol = screen.getByRole('list', { name: 'Пункты ответа' });
    const statuses = within(protocol).getAllByRole('listitem').map((row) => row.getAttribute('data-status'));
    expect(statuses).toEqual(['missing', 'covered', 'covered', 'missing']);
    expect(plain(within(protocol).getAllByRole('listitem')[0].textContent)).toContain(
      `на вопрос экзаменатора — «${Q1_FOLLOWUP}», по ключевым словам засчитан частично`,
    );
    expect(plain(within(protocol).getAllByRole('listitem')[0].textContent)).toContain(
      '«Спрос — это зависимость между ценой товара и тем количеством, которое покупатели готовы и могут купить за определённый период.»',
    );
    expect(plain(within(protocol).getAllByRole('listitem')[1].textContent)).toContain('Вы:«Закон спроса такой: когда цена растёт, люди покупают меньше»');
    // No «Засчитано»: the example saves nothing, so nothing is counted.
    expect(document.querySelector('.or-stamp')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Как считается' }));
    expect(plain(document.querySelector('.or-how-formula')?.textContent)).toBe('(0,5 + 2 + 1 + 0) / 6 = 58 из 100 → 3');
    expect(screen.getByRole('link', { name: 'Создать свой экзамен' })).toHaveAttribute('href', '/register');
    expectAccessibleScreen();

    // «Ещё билет»: the next question, not the same one again.
    fireEvent.click(screen.getByRole('button', { name: 'Ещё билет' }));
    expect(screen.getByRole('article', { name: 'Вопрос 2' })).toBeInTheDocument();

    // Nothing left the page and nothing was saved.
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(window.localStorage.length).toBe(0);
    expect(window.sessionStorage.length).toBe(0);
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
    expect(screen.getByText('Оценка 5 · отлично')).toBeInTheDocument();
    expect(plain(document.querySelector('.or-grade-why')?.textContent)).toBe('Раскрыто 5 пунктов из 5.');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('takes «Не знаю» on the follow-up as an answer and applies the cap for a main point', async () => {
    renderAt('/try/ticket?q=q1');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    fireEvent.change(screen.getByLabelText(/^Ваш ответ/), {
      target: { value: 'Спрос — это сколько товара покупатели готовы купить. Кривая спроса идёт вниз, а величина спроса — количество при конкретной цене.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Готово' }));
    await toExaminer();
    expect(screen.getByText('«Как по закону спроса связаны цена и величина спроса?»')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Не знаю' }));
    expect(await screen.findByText('Оценка 3 · удовлетворительно')).toBeInTheDocument();
    expect(plain(document.querySelector('.or-extra')?.textContent)).toBe('Дополнительный вопрос: «Как по закону спроса связаны цена и величина спроса?» — ответ: не знаю.');
    fireEvent.click(screen.getByRole('button', { name: 'Как считается' }));
    expect(screen.getByText('Здесь оценку ограничил пункт 2: на вопрос экзаменатора о нём не было верного ответа.')).toBeInTheDocument();
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
    expect(await screen.findByText('Оценка 3 · удовлетворительно')).toBeInTheDocument();
    expect(fetchSpy).not.toHaveBeenCalled();
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
    expect(within(bar).getByRole('link', { name: 'Создать аккаунт' })).toHaveAttribute('href', '/register');
    expect(screen.getByRole('link', { name: 'Meldy, на главную' })).toHaveAttribute('href', '/');
  });

  it('asks before leaving an answer in progress: nothing of it is saved', async () => {
    mocks.confirm.mockResolvedValue(false);
    renderAt('/try/ticket?q=q2');
    fireEvent.click(screen.getByRole('button', { name: 'Ответить текстом' }));
    fireEvent.change(screen.getByLabelText(/^Ваш ответ/), { target: { value: 'Спрос зависит от доходов' } });
    fireEvent.click(screen.getByRole('link', { name: 'Лист примера' }));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: 'Выйти из билета?', message: 'Ответ пропадёт: пример ничего не сохраняет.' }));
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
    renderAt('/try');
    fireEvent.click(screen.getByRole('button', { name: '1 вопроса нет ни в одной лекции. Показать его' }));
    const sheet = screen.getByRole('article', { name: 'Список вопросов кафедры с пометками' });
    expect(within(sheet).getAllByRole('button').map((row) => plain(row.textContent))).toEqual(['Рынок труда: спрос на труд и заработная плата.']);
    fireEvent.click(screen.getByRole('button', { name: /^Все/ }));
    expect(within(sheet).getAllByRole('button')).toHaveLength(12);
    const lectures = screen.getByRole('region', { name: 'Лекции примера' });
    expect(within(lectures).getAllByRole('group')).toHaveLength(3);
    expect(within(lectures).getByText('Спрос и предложение', { selector: '.tx-lecture-t' })).toBeInTheDocument();
  });
});
