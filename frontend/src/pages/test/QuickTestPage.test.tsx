import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation, useParams } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({
  parsePaste: vi.fn(),
  createContainer: vi.fn(),
  setContainerKind: vi.fn(),
  addItems: vi.fn(),
  createQuiz: vi.fn(),
}));
vi.mock('../../api/containers', () => ({
  parsePaste: api.parsePaste,
  createContainer: api.createContainer,
  setContainerKind: api.setContainerKind,
  addItems: api.addItems,
}));
vi.mock('../../api/quizzes', () => ({ createQuiz: api.createQuiz }));

import QuickTestPage, { defaultQuickName } from './QuickTestPage';
import { QUICK, QUIZ_MEANS } from '../../components/quick/copyQuick';
import { CHEMISTRY, bankItem, bankResult } from '../../components/quick/testkit';
import { PARSE_PAUSE_MS } from '../../components/quick/usePasteParse';

/* «Быстрая контрольная» (UX audit of 21.10, P1): pasted questions → the questions found → a link, on one screen. */

function LinkPage() {
  const { id, quizId } = useParams();
  return <h1>{`Ссылка ${id} ${quizId}`}</h1>;
}
function FullForm() {
  const location = useLocation();
  return <pre data-testid="form">{JSON.stringify({ search: location.search, state: location.state })}</pre>;
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/tests/quick']}>
      <Routes>
        <Route path="/tests/quick" element={<QuickTestPage />} />
        <Route path="/exams/c/:id/quizzes/:quizId/link" element={<LinkPage />} />
        <Route path="/exams/c/:id/quizzes/new" element={<FullForm />} />
      </Routes>
    </MemoryRouter>,
  );
}

const field = () => screen.getByLabelText(QUICK.text);
const submit = () => screen.getByRole('button', { name: QUICK.submit });

async function typeText(value: string) {
  fireEvent.change(field(), { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(PARSE_PAUSE_MS + 10);
  });
}

beforeEach(() => {
  window.sessionStorage.clear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
  api.parsePaste.mockReset().mockResolvedValue(CHEMISTRY);
  api.createContainer.mockReset().mockResolvedValue({ container_id: 'c-new', subjects: [{ id: 's-new', position: 1, title: 'Вопросы' }] });
  api.setContainerKind.mockReset().mockResolvedValue(undefined);
  api.addItems.mockReset().mockResolvedValue([]);
  api.createQuiz.mockReset().mockResolvedValue({ id: 'q-new', code: 'k7m2p9q4r8st' });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('QuickTestPage', () => {
  it('says what a контрольная is and how to mark the right answer; nothing to send before the questions', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: QUICK.title })).toBeInTheDocument();
    expect(screen.getByText(new RegExp(QUIZ_MEANS))).toBeInTheDocument();
    expect(screen.getByText(/Верный вариант отметьте звёздочкой/)).toBeInTheDocument();
    expect(submit()).toBeDisabled();
    expect(screen.getAllByText(QUICK.needText).length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: QUICK.crumb })).toHaveAttribute('href', '/exams?view=tests');
  });

  it('reads the text after a pause and shows the questions found, the one without its answer standing out', async () => {
    renderPage();
    await typeText('1. Какой индикатор…');
    expect(api.parsePaste).toHaveBeenCalledWith('1. Какой индикатор…', expect.any(AbortSignal));
    expect(await screen.findByRole('heading', { name: 'Нашли 4\u00a0вопроса' })).toBeInTheDocument();
    expect(screen.getByText('1 вопрос без верного ответа')).toBeInTheDocument();
    const cards = screen.getAllByRole('listitem').filter((item) => item.classList.contains('qk-q'));
    expect(cards).toHaveLength(4);
    expect(cards[3]).toHaveAttribute('data-state', 'no_key');
    expect(within(cards[3]).getByText(QUICK.tapRight)).toBeInTheDocument();
    expect(within(cards[0]).getByRole('button', { name: /лакмус/ })).toHaveAttribute('aria-pressed', 'true');
    expect(within(cards[2]).getByText('Ответ: 2')).toBeInTheDocument();
    expect(screen.getByText(/Часть текста не похожа на вопросы/)).toBeInTheDocument();
    expect(document.querySelector('.qk-sum')).toHaveTextContent('В контрольной 3 вопроса. 1 вопрос без верного ответа не войдёт.');
    expect(submit()).toBeEnabled();
  });

  it('a paste is read at once, without waiting for the pause', async () => {
    renderPage();
    const area = field() as HTMLTextAreaElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
    await act(async () => {
      setValue.call(area, '1. Вопрос?');
      area.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    });
    expect(api.parsePaste).toHaveBeenCalledTimes(1);
    expect(api.parsePaste).toHaveBeenCalledWith('1. Вопрос?', expect.any(AbortSignal));
    // The pause that follows asks nothing more: the text was read.
    await act(async () => {
      vi.advanceTimersByTime(PARSE_PAUSE_MS + 10);
    });
    expect(api.parsePaste).toHaveBeenCalledTimes(1);
  });

  it('a tap on the right variant marks the question, and every question goes in', async () => {
    renderPage();
    await typeText('текст');
    const cards = (await screen.findAllByRole('listitem')).filter((item) => item.classList.contains('qk-q'));
    fireEvent.click(within(cards[3]).getByRole('button', { name: /соляная/ }));
    expect(within(cards[3]).getByRole('button', { name: /соляная/ })).toHaveAttribute('aria-pressed', 'true');
    expect(cards[3]).toHaveAttribute('data-state', 'ok');
    expect(screen.queryByText('1 вопрос без верного ответа')).toBeNull();
    expect(document.querySelector('.qk-sum')).toHaveTextContent(/^В контрольной 4 вопроса\.$/);
    expect(document.querySelector('.qk-page > .sr-only[role="status"]')).toHaveTextContent('Вопрос 4. Верный вариант А.');
  });

  it('«Получить ссылку» saves the test, its questions and the контрольная, then opens the link', async () => {
    renderPage();
    fireEvent.change(screen.getByLabelText(QUICK.name), { target: { value: '  Кислоты, 9 Б  ' } });
    await typeText('текст');
    await screen.findByRole('heading', { name: 'Нашли 4\u00a0вопроса' });
    fireEvent.click(submit());
    expect(await screen.findByRole('heading', { name: 'Ссылка c-new q-new' })).toBeInTheDocument();
    expect(api.createContainer).toHaveBeenCalledWith('Кислоты, 9 Б', null, [{ title: 'Вопросы' }]);
    expect(api.setContainerKind).toHaveBeenCalledWith('c-new', 'test');
    const [subjectId, inputs] = api.addItems.mock.calls[0];
    expect(subjectId).toBe('s-new');
    expect(inputs).toHaveLength(4);
    const [containerId, settings] = api.createQuiz.mock.calls[0];
    expect(containerId).toBe('c-new');
    expect(settings).toMatchObject({ title: 'Кислоты, 9 Б', subject_ids: ['s-new'], item_count: 3, guests: true, time_limit_min: null, attempts: 1, same_set: true });
    // The right answers at the end, at once (owner, 21.10).
    expect(settings).toMatchObject({ review: 'answers' });
  });

  it('owner 21.10: a reload keeps the name and the pasted questions; a saved test leaves nothing behind', async () => {
    const first = renderPage();
    fireEvent.change(screen.getByLabelText(QUICK.name), { target: { value: 'Кислоты, 9 Б' } });
    await typeText('текст');
    await screen.findByRole('heading', { name: 'Нашли 4 вопроса' });
    first.unmount();

    renderPage();
    expect((screen.getByLabelText(QUICK.name) as HTMLInputElement).value).toBe('Кислоты, 9 Б');
    expect((field() as HTMLTextAreaElement).value).toBe('текст');
    await act(async () => {
      vi.advanceTimersByTime(PARSE_PAUSE_MS + 10);
    });
    await screen.findByRole('heading', { name: 'Нашли 4 вопроса' });
    fireEvent.click(submit());
    await screen.findByRole('heading', { name: 'Ссылка c-new q-new' });
    cleanup();

    renderPage();
    expect((field() as HTMLTextAreaElement).value).toBe('');
    expect((screen.getByLabelText(QUICK.name) as HTMLInputElement).value).toBe('');
  });

  it('without a name the контрольная is named by the day', async () => {
    renderPage();
    await typeText('текст');
    await screen.findByRole('heading', { name: 'Нашли 4\u00a0вопроса' });
    fireEvent.click(submit());
    await screen.findByRole('heading', { name: 'Ссылка c-new q-new' });
    expect(api.createContainer.mock.calls[0][0]).toBe(defaultQuickName());
  });

  it('the pills change the settings sent', async () => {
    renderPage();
    await typeText('текст');
    await screen.findByRole('heading', { name: 'Нашли 4\u00a0вопроса' });
    fireEvent.click(screen.getByRole('combobox', { name: QUICK.time.label }));
    fireEvent.click(screen.getByRole('option', { name: '20 минут' }));
    fireEvent.click(screen.getByRole('combobox', { name: QUICK.who.label }));
    fireEvent.click(screen.getByRole('option', { name: QUICK.who.link }));
    expect(screen.getByRole('combobox', { name: QUICK.review.label })).toHaveTextContent(QUICK.review.now);
    fireEvent.click(screen.getByRole('combobox', { name: QUICK.review.label }));
    fireEvent.click(screen.getByRole('option', { name: QUICK.review.later }));
    fireEvent.click(submit());
    await screen.findByRole('heading', { name: 'Ссылка c-new q-new' });
    expect(api.createQuiz.mock.calls[0][1]).toMatchObject({ time_limit_min: 20, guests: false, review: 'mistakes_then_answers' });
  });

  it('a failure says so in place, and «Получить ссылку» again goes on without a second test', async () => {
    api.createQuiz.mockRejectedValueOnce(Object.assign(new Error('x'), { code: 'unknown' }));
    renderPage();
    await typeText('текст');
    await screen.findByRole('heading', { name: 'Нашли 4\u00a0вопроса' });
    fireEvent.click(submit());
    expect(await screen.findByRole('alert')).toBeInTheDocument();
    fireEvent.click(submit());
    expect(await screen.findByRole('heading', { name: 'Ссылка c-new q-new' })).toBeInTheDocument();
    expect(api.createContainer).toHaveBeenCalledTimes(1);
    expect(api.addItems).toHaveBeenCalledTimes(1);
    expect(api.createQuiz).toHaveBeenCalledTimes(2);
  });

  it('no question with its answer: the button waits and says why', async () => {
    api.parsePaste.mockResolvedValue(bankResult([bankItem({ text: 'Вопрос?', options: ['да', 'нет'] })]));
    renderPage();
    await typeText('текст');
    await screen.findByRole('heading', { name: 'Нашли 1\u00a0вопрос' });
    expect(submit()).toBeDisabled();
    expect(screen.getByText(QUICK.needKey)).toBeInTheDocument();
  });

  it('text without questions says how to write one', async () => {
    api.parsePaste.mockResolvedValue(bankResult([]));
    renderPage();
    await typeText('Привет, класс!');
    await waitFor(() => expect(screen.getByText(QUICK.nothing)).toBeInTheDocument());
  });

  it('a read that failed offers «Повторить»', async () => {
    api.parsePaste.mockRejectedValueOnce(new Error('offline'));
    renderPage();
    await typeText('текст');
    expect(await screen.findByRole('alert')).toHaveTextContent(QUICK.readFailed);
    fireEvent.click(screen.getByRole('button', { name: QUICK.retry }));
    expect(await screen.findByRole('heading', { name: 'Нашли 4\u00a0вопроса' })).toBeInTheDocument();
  });

  it('«Ещё настройки» saves the test and opens the full form with the pills’ choices', async () => {
    renderPage();
    await typeText('текст');
    await screen.findByRole('heading', { name: 'Нашли 4\u00a0вопроса' });
    fireEvent.click(screen.getByRole('button', { name: QUICK.more }));
    const form = await screen.findByTestId('form');
    const shown = JSON.parse(form.textContent ?? '{}');
    expect(shown.search).toBe('?all=1');
    expect(shown.state).toMatchObject({ more: true, preset: { time_limit_min: null, attempts: 1, guests: true } });
    expect(api.addItems).toHaveBeenCalledTimes(1);
    expect(api.createQuiz).not.toHaveBeenCalled();
  });
});
