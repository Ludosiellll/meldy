import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContainerSummary } from '../../types/container';
import type { QuizResults } from '../../types/quiz';

const api = vi.hoisted(() => ({
  quizResults: vi.fn(),
  quizMarks: vi.fn(),
  attemptAnswers: vi.fn(),
  resetAttempt: vi.fn(),
  closeQuiz: vi.fn(),
  deleteQuiz: vi.fn(),
  reload: vi.fn(),
  state: { summary: null as unknown, items: null as unknown },
}));

vi.mock('../../api/quizzes', () => ({
  quizResults: api.quizResults,
  quizMarks: api.quizMarks,
  attemptAnswers: api.attemptAnswers,
  resetAttempt: api.resetAttempt,
  closeQuiz: api.closeQuiz,
  deleteQuiz: api.deleteQuiz,
}));
vi.mock('../../lib/containers/hooks', () => ({
  useContainerData: () => ({
    data: api.state.summary ? { summary: api.state.summary, items: api.state.items, planInput: null, oralWithoutPoints: 0 } : null,
    loading: false,
    offline: false,
    unavailable: false,
    error: null,
    gone: false,
    reload: api.reload,
  }),
}));

import QuizStatsPage, { POLL_IDLE_MS, POLL_WRITING_MS } from './QuizStatsPage';
import { QA_LIST, QA_PEOPLE, QA_QUESTIONS, QA_STATS } from '../../components/quiz/copyAuthor';
import { EXAM, examItems, examSummary, NOW, QUIZ_ID, quizRow, results, S1, S2 } from '../../components/quiz/testkit';

const plain = (text: string | null | undefined) => (text ?? '').replace(/ /g, ' ');
const page = () => plain(document.body.textContent);
const pad = (n: number) => String(n).padStart(2, '0');
const hhmm = (iso: string) => `${pad(new Date(iso).getHours())}:${pad(new Date(iso).getMinutes())}`;

function Where() {
  const location = useLocation();
  return <p data-testid="where">{location.pathname}</p>;
}

function renderPage(width = 1532) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  return render(
    <MemoryRouter initialEntries={[`/exams/c/${EXAM}/quizzes/${QUIZ_ID}`]}>
      <Routes>
        <Route path="/exams/c/:id/quizzes/:quizId" element={<QuizStatsPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

let visibility: DocumentVisibilityState = 'visible';
function setVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

beforeEach(() => {
  visibility = 'visible';
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  api.state.summary = examSummary();
  api.state.items = examItems();
  api.quizResults.mockReset().mockImplementation(async () => results());
  api.quizMarks.mockReset().mockResolvedValue([
    { attempt_id: 'a2', item_id: 'i37', correct: true },
    { attempt_id: 'a2', item_id: 'i5', correct: false },
  ]);
  api.attemptAnswers.mockReset().mockImplementation(async (attemptId: string) =>
    attemptId === 'a2'
      ? [
          { item_id: 'i5', chosen: null, text: '1596', correct: false, answered_at: '2026-10-16T11:55:00Z' },
          { item_id: 'i37', chosen: [1], text: null, correct: true, answered_at: '2026-10-16T11:52:00Z' },
        ]
      : [{ item_id: 'i3', chosen: [0, 1], text: null, correct: false, answered_at: '2026-10-16T11:40:00Z' }],
  );
  api.resetAttempt.mockReset().mockResolvedValue(undefined);
  api.closeQuiz.mockReset().mockResolvedValue(quizRow({ state: 'closed', closed_at: NOW.toISOString() }));
  api.deleteQuiz.mockReset().mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete (document as { visibilityState?: unknown }).visibilityState;
});

describe('QuizStatsPage: the head (spec 2026-10-16 §2.3)', () => {
  it('names the quiz and its state, gives the link with «Скопировать» and the actions', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Контрольная · 16.10' })).toBeInTheDocument();
    expect(page()).toContain('3 вопроса · 20 минут · 3 попытки');
    const url = `${window.location.origin}/k/k7m2p9q4r8st`;
    expect(screen.getByLabelText(QA_STATS.link)).toHaveValue(url);
    fireEvent.click(screen.getByRole('button', { name: QA_STATS.copy }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(url));
    expect(await screen.findByText(QA_STATS.copiedLine)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: QA_STATS.edit }).getAttribute('href')).toBe(`/exams/c/${EXAM}/quizzes/${QUIZ_ID}/edit`);
    expect(screen.getByRole('link', { name: QA_LIST.title }).getAttribute('href')).toBe(`/exams/c/${EXAM}/quizzes`);
    delete (navigator as { clipboard?: unknown }).clipboard;
  });

  it('the totals leave the author’s own try out (review focus 5)', async () => {
    renderPage();
    // Иванов counts with 67 %; the author's 0 % would make the average 33 %.
    expect(await screen.findByText(/Пишут 1/)).toBeInTheDocument();
    expect(page()).toContain('Пишут 1 · Сдали 1 · Средний результат 67 % · Набрали проходной балл 1 из 1');
  });

  it('with the author’s own try only, says so instead of «никто не писал»', async () => {
    api.quizResults.mockImplementation(async () => {
      const all = results();
      return { ...all, attempts: all.attempts.filter((a) => a.own), items: [] };
    });
    renderPage();
    expect(await screen.findByText(QA_STATS.onlyOwn)).toBeInTheDocument();
    expect(screen.queryByText(QA_STATS.nobody)).not.toBeInTheDocument();
  });

  it('the «создана» note shows once: the history entry forgets it, a reload does not repeat it', async () => {
    let seen: unknown = 'unset';
    function State() {
      seen = useLocation().state;
      return null;
    }
    render(
      <MemoryRouter initialEntries={[{ pathname: `/exams/c/${EXAM}/quizzes/${QUIZ_ID}`, state: { quizNote: 'created' } }]}>
        <Routes>
          <Route path="/exams/c/:id/quizzes/:quizId" element={<><QuizStatsPage /><State /></>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(await screen.findByText(QA_STATS.created)).toBeInTheDocument();
    await waitFor(() => expect(seen).toBeNull());
    expect(screen.getByText(QA_STATS.created)).toBeInTheDocument();
  });

  it('«Закрыть контрольную» after asking; the state says «Закрыта»', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: QA_STATS.close }));
    expect(screen.getByText(/Закрыть контрольную сейчас\? Ещё пишет 1 человек\./)).toBeInTheDocument();
    api.quizResults.mockImplementation(async () => results({ quiz: quizRow({ state: 'closed', closed_at: NOW.toISOString() }) }));
    fireEvent.click(screen.getByRole('button', { name: QA_STATS.closeYes }));
    await waitFor(() => expect(api.closeQuiz).toHaveBeenCalledWith(QUIZ_ID));
    expect(await screen.findByText(/^Закрыта · 3/)).toBeInTheDocument();
    expect(await screen.findByText(QA_STATS.closedHint)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: QA_STATS.close })).toBeNull();
  });

  it('«Удалить» asks, then deletes and goes back to the list', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: QA_STATS.remove }));
    expect(screen.getByText(QA_STATS.removeAsk('Контрольная · 16.10'))).toBeInTheDocument();
    expect(api.deleteQuiz).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: QA_STATS.no }));
    expect(screen.queryByText(QA_STATS.removeAsk('Контрольная · 16.10'))).toBeNull();
    await waitFor(() => expect(screen.getByRole('button', { name: QA_STATS.remove })).toHaveFocus());
    fireEvent.click(screen.getByRole('button', { name: QA_STATS.remove }));
    fireEvent.click(screen.getByRole('button', { name: QA_STATS.removeYes }));
    await waitFor(() => expect(api.deleteQuiz).toHaveBeenCalledWith(QUIZ_ID));
    expect(await screen.findByTestId('where')).toHaveTextContent(`/exams/c/${EXAM}/quizzes`);
  });

  it('a test’s quiz deleted: back to the test’s own page, where its quizzes are (release 47.3)', async () => {
    api.state.summary = examSummary({ kind: 'test' });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: QA_STATS.remove }));
    fireEvent.click(screen.getByRole('button', { name: QA_STATS.removeYes }));
    await waitFor(() => expect(api.deleteQuiz).toHaveBeenCalledWith(QUIZ_ID));
    expect((await screen.findByTestId('where')).textContent).toBe(`/exams/c/${EXAM}`);
  });

  it('a member of a test: the words name the test', async () => {
    api.state.summary = examSummary({ kind: 'test', role: 'member', owner: null } as Partial<ContainerSummary>);
    renderPage();
    expect(screen.getByText(QA_LIST.authorOnlyTest)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: QA_LIST.toTest })).toHaveAttribute('href', `/exams/c/${EXAM}`);
    expect(page()).not.toContain('экзамен');
  });

  it('a member of the exam sees that quizzes are the author’s', async () => {
    api.state.summary = examSummary({ role: 'member', owner: null } as Partial<ContainerSummary>);
    renderPage();
    expect(screen.getByText(QA_LIST.authorOnly)).toBeInTheDocument();
  });
});

describe('«Участники»', () => {
  it('one row a person: «(вы)», what they do now against the server clock, the result, the attempts', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: QA_PEOPLE.title });
    const rows = within(list).getAllByRole('button').map((row) => plain(row.textContent));
    expect(rows).toHaveLength(3);
    const author = rows.find((row) => row.startsWith('Автор Экзамена'));
    expect(author).toContain('Автор Экзамена (вы)');
    const writing = rows.find((row) => row.startsWith('Борисова Анна'));
    expect(writing).toContain('пишет, 2 из 3, осталось 08:41');
    const done = rows.find((row) => row.startsWith('Иванов Иван'));
    expect(done).toContain(`сдано ${hhmm('2026-10-16T11:58:00Z')}`);
    expect(done).toContain('2 из 3 · 67 %');
    expect(done).toContain('8 мин');
    expect(done).toContain('попытка 2 из 3');
    expect(screen.getByText(QA_PEOPLE.ownHint)).toBeInTheDocument();
  });

  it('the clock of one writing ticks with the server’s offset', async () => {
    api.quizResults.mockImplementation(async () => results({ server_now: new Date(NOW.getTime() + 60000).toISOString() }));
    renderPage();
    // The server is a minute ahead: a minute less is left than the device's clock says.
    expect(await screen.findByText(/осталось 07:41/)).toBeInTheDocument();
  });

  it('a press opens the person’s answers: the question, their answer and the key in letters, a switch of attempts', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: QA_PEOPLE.title });
    fireEvent.click(within(list).getByRole('button', { name: /^Иванов Иван/ }));
    const sheet = screen.getByRole('dialog', { name: QA_PEOPLE.open('Иванов Иван') });
    await waitFor(() => expect(api.attemptAnswers).toHaveBeenCalledWith('a2'));
    const answers = await within(sheet).findAllByRole('listitem');
    // In the exam's order: «Вариант 1» first.
    expect(plain(answers[0].textContent)).toContain('Вариант 1 · № 37');
    expect(plain(answers[0].textContent)).toContain('Какой оператор сравнивает строки?');
    expect(plain(answers[0].textContent)).toContain('Ответ: Б. ==');
    expect(plain(answers[0].textContent)).toContain('Верный ответ: Б. ==');
    expect(plain(answers[0].textContent)).toContain(QA_PEOPLE.right);
    expect(plain(answers[1].textContent)).toContain('Вариант 2 · № 5');
    expect(plain(answers[1].textContent)).toContain('Ответ: «1596»');
    expect(plain(answers[1].textContent)).toContain('Принимаем: 1569');
    expect(plain(answers[1].textContent)).toContain(QA_PEOPLE.wrong);
    expect(plain(sheet.textContent)).toContain('1 вопрос без ответа.');
    fireEvent.click(within(sheet).getByRole('button', { name: QA_PEOPLE.attemptTab(1) }));
    await waitFor(() => expect(api.attemptAnswers).toHaveBeenCalledWith('a1'));
    expect(await within(sheet).findByText(/Ответ: А и Б/)).toBeInTheDocument();
    expect(within(sheet).getByText('Верный ответ: А и В')).toBeInTheDocument();
  });

  it('«Сбросить попытку» asks, resets and reads the results again', async () => {
    renderPage();
    const list = await screen.findByRole('list', { name: QA_PEOPLE.title });
    fireEvent.click(within(list).getByRole('button', { name: /^Иванов Иван/ }));
    const sheet = screen.getByRole('dialog');
    await within(sheet).findAllByRole('listitem');
    fireEvent.click(within(sheet).getByRole('button', { name: QA_PEOPLE.reset }));
    expect(within(sheet).getByText(QA_PEOPLE.resetAsk(2))).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: QA_PEOPLE.resetNo })).toHaveFocus();
    const before = api.quizResults.mock.calls.length;
    fireEvent.click(within(sheet).getByRole('button', { name: QA_PEOPLE.resetYes }));
    await waitFor(() => expect(api.resetAttempt).toHaveBeenCalledWith('a2'));
    await waitFor(() => expect(api.quizResults.mock.calls.length).toBeGreaterThan(before));
    // The other attempt of the person is shown now.
    await waitFor(() => expect(api.attemptAnswers).toHaveBeenCalledWith('a1'));
  });

  it('an attempt that is gone (P0002 «attempt») is said as the attempt’s, not the quiz’s', async () => {
    api.attemptAnswers.mockRejectedValue(Object.assign(new Error('not found'), { code: 'P0002', detail: 'attempt' }));
    renderPage();
    const list = await screen.findByRole('list', { name: QA_PEOPLE.title });
    fireEvent.click(within(list).getByRole('button', { name: /^Иванов Иван/ }));
    expect(await within(screen.getByRole('dialog')).findByRole('alert')).toHaveTextContent(QA_PEOPLE.attemptGone);
  });

  it('on a phone the rows stack (no table head)', async () => {
    renderPage(390);
    const list = await screen.findByRole('list', { name: QA_PEOPLE.title });
    expect(document.querySelector('.qa-people-head')).toBeNull();
    expect(plain(within(list).getByRole('button', { name: /^Иванов Иван/ }).textContent)).toContain('8 мин · попытка 2 из 3');
  });
});

describe('«Вопросы»', () => {
  it('a test’s questions are named by the test, not by its subject «Вопросы» nobody named (phone audit 47.3)', async () => {
    api.state.summary = examSummary({ kind: 'test', title: 'Телефон проверка 19.10' });
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: QA_STATS.tabQuestions }));
    const list = screen.getByRole('list', { name: QA_QUESTIONS.title });
    const lines = within(list)
      .getAllByRole('listitem')
      .filter((node) => node.parentElement === list)
      .map((card) => plain(card.querySelector('.qa-q-line')?.textContent));
    expect(lines[0]).toBe('Телефон проверка 19.10 · № 5: 1 из 4 ответили верно (25 %)');
    expect(lines.join(' ')).not.toContain('Вариант');
  });

  it('the hardest first, the picks with the key in words, the common wrong answers, «Изменить» to «Вопросы и ключи»', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('tab', { name: QA_STATS.tabQuestions }));
    expect(screen.getByRole('tab', { name: QA_STATS.tabQuestions })).toHaveAttribute('aria-selected', 'true');
    const list = screen.getByRole('list', { name: QA_QUESTIONS.title });
    const cards = within(list).getAllByRole('listitem').filter((node) => node.parentElement === list);
    expect(cards.map((card) => plain(card.querySelector('.qa-q-line')?.textContent))).toEqual([
      'Вариант 2 · № 5: 1 из 4 ответили верно (25 %)',
      'Вариант 1 · № 3: 1 из 2 ответили верно (50 %)',
      'Вариант 1 · № 37: 3 из 4 ответили верно (75 %)',
    ]);
    expect(plain(cards[0].textContent)).toContain('«1596» · 2 раза');
    expect(plain(cards[0].textContent)).toContain('1 без ответа');
    const picks = within(cards[2]).getByRole('list', { name: QA_QUESTIONS.picks });
    expect(within(picks).getAllByRole('listitem').map((node) => plain(node.textContent))).toEqual(['А0', 'Б3верный', 'В1', 'Г0']);
    expect(within(cards[2]).getByRole('link', { name: QA_QUESTIONS.edit }).getAttribute('href')).toBe(`/exams/c/${EXAM}/keys?s=${S1}&no=37`);
    expect(within(cards[0]).getByRole('link', { name: QA_QUESTIONS.edit }).getAttribute('href')).toBe(`/exams/c/${EXAM}/keys?s=${S2}&no=5`);
  });
});

describe('«Скачать таблицу»', () => {
  it('builds the CSV from the marks and saves it as «<название>.csv»', async () => {
    const blobs: Blob[] = [];
    const names: string[] = [];
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn((blob: Blob) => {
        blobs.push(blob);
        return 'blob:quiz';
      }),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(this: HTMLAnchorElement) {
      names.push(this.download);
    });
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: QA_STATS.download }));
    await waitFor(() => expect(names).toEqual(['Контрольная · 16.10.csv']));
    expect(api.quizMarks).toHaveBeenCalledWith(QUIZ_ID);
    const bytes = new Uint8Array(await blobs[0].arrayBuffer());
    // The BOM (EF BB BF): Excel then reads the file as UTF-8.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const lines = new TextDecoder('utf-8').decode(bytes).split('\r\n');
    expect(lines[0]).toBe('Имя;Попытка;Начало;Конец;Минуты;Верно;Всего;%;Проходной балл;Вариант 1 № 37;Вариант 2 № 5');
    expect(lines.find((line) => line.startsWith('Иванов Иван;2;'))?.endsWith(';1;0')).toBe(true);
    expect(lines.some((line) => line.startsWith('Автор Экзамена (автор);'))).toBe(true);
  });
});

describe('polling (no realtime: spec §2.3)', () => {
  const flush = () => act(async () => {
    await vi.advanceTimersByTimeAsync(0);
  });
  const advance = (ms: number) => act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });

  beforeEach(() => {
    vi.useRealTimers();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
    vi.setSystemTime(NOW);
  });

  it('every 5 s while somebody writes; stopped on a hidden tab, read at once when it comes back', async () => {
    renderPage();
    await flush();
    expect(api.quizResults).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Контрольная · 16.10' })).toBeInTheDocument();
    await advance(POLL_WRITING_MS - 100);
    expect(api.quizResults).toHaveBeenCalledTimes(1);
    await advance(100);
    expect(api.quizResults).toHaveBeenCalledTimes(2);
    await advance(POLL_WRITING_MS);
    expect(api.quizResults).toHaveBeenCalledTimes(3);
    act(() => setVisibility('hidden'));
    await advance(POLL_IDLE_MS * 4);
    expect(api.quizResults).toHaveBeenCalledTimes(3);
    act(() => setVisibility('visible'));
    await flush();
    expect(api.quizResults).toHaveBeenCalledTimes(4);
    await advance(POLL_WRITING_MS);
    expect(api.quizResults).toHaveBeenCalledTimes(5);
  });

  it('every 30 s when nobody writes', async () => {
    const quiet = (): QuizResults => {
      const base = results();
      return { ...base, attempts: base.attempts.filter((attempt) => attempt.finished_at) };
    };
    api.quizResults.mockImplementation(async () => quiet());
    renderPage();
    await flush();
    expect(api.quizResults).toHaveBeenCalledTimes(1);
    await advance(POLL_WRITING_MS * 2);
    expect(api.quizResults).toHaveBeenCalledTimes(1);
    await advance(POLL_IDLE_MS - POLL_WRITING_MS * 2);
    expect(api.quizResults).toHaveBeenCalledTimes(2);
  });

  it('never two requests at once: the next waits for the last answer', async () => {
    let answer: (value: QuizResults) => void = () => undefined;
    renderPage();
    await flush();
    expect(api.quizResults).toHaveBeenCalledTimes(1);
    api.quizResults.mockImplementation(() => new Promise<QuizResults>((resolve) => (answer = resolve)));
    await advance(POLL_WRITING_MS);
    expect(api.quizResults).toHaveBeenCalledTimes(2);
    // The answer does not come; the tab comes back meanwhile: still one request out.
    await advance(POLL_IDLE_MS * 2);
    act(() => setVisibility('visible'));
    await flush();
    expect(api.quizResults).toHaveBeenCalledTimes(2);
    await act(async () => answer(results()));
    await advance(POLL_WRITING_MS);
    expect(api.quizResults).toHaveBeenCalledTimes(3);
  });

  it('a failed read keeps the last results and says so quietly', async () => {
    renderPage();
    await flush();
    api.quizResults.mockRejectedValue(Object.assign(new Error('Нет связи'), { code: 'network' }));
    await advance(POLL_WRITING_MS);
    expect(api.quizResults).toHaveBeenCalledTimes(2);
    expect(page()).toContain(QA_STATS.stale(hhmm(NOW.toISOString())));
    expect(screen.getByRole('list', { name: QA_PEOPLE.title })).toBeInTheDocument();
  });
});

describe('QuizStatsPage: the end of a writer’s time and sharing (release 47 design fixes)', () => {
  it('a writer whose clock ran out reads «время вышло, ответы сдаются», not «осталось 00:00»', async () => {
    const base = results();
    api.quizResults.mockImplementation(async () =>
      results({
        attempts: base.attempts.map((attempt) => (attempt.id === 'b1' ? { ...attempt, deadline_at: new Date(NOW.getTime() - 5000).toISOString() } : attempt)),
      }),
    );
    renderPage();
    const list = await screen.findByRole('list', { name: QA_PEOPLE.title });
    const writing = within(list).getAllByRole('button').map((row) => plain(row.textContent)).find((row) => row.startsWith('Борисова Анна'));
    expect(writing).toContain('время вышло, ответы сдаются');
    expect(writing).not.toContain('00:00');
  });

  it('«Показать QR»: the code over the whole screen with the short link; Escape closes it and the focus comes back', async () => {
    renderPage();
    const show = await screen.findByRole('button', { name: QA_STATS.qr });
    show.focus();
    fireEvent.click(show);
    const screenQr = screen.getByRole('dialog', { name: 'Контрольная · 16.10' });
    expect(screenQr).toHaveAttribute('aria-modal', 'true');
    // Made here from the link: an SVG of dark modules on a white field.
    const code = within(screenQr).getByRole('img', { name: QA_STATS.qrTitle });
    expect(code.querySelector('path')?.getAttribute('d')).toMatch(/^M\d+ \d+h\d+v1h-\d+z/);
    expect(code.querySelector('rect')).toHaveAttribute('fill', '#fff');
    // The link in large letters, without its scheme; a narrow screen may break it only after a «/».
    const link = screenQr.querySelector('.qa-qr-link')!;
    expect(link.textContent).toBe(`${window.location.host}/k/k7m2p9q4r8st`);
    expect(link.querySelectorAll('wbr')).toHaveLength(2);
    expect(within(screenQr).getByRole('button', { name: QA_STATS.qrClose })).toHaveFocus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Контрольная · 16.10' })).toBeNull();
    expect(show).toHaveFocus();
  });

  it('«Закрыть» closes the code too', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: QA_STATS.qr }));
    fireEvent.click(screen.getByRole('button', { name: QA_STATS.qrClose }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('«Открыть как ученик» opens /k/<код> in a new tab', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: QA_STATS.asTakerLabel });
    expect(link).toHaveAttribute('href', '/k/k7m2p9q4r8st');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link.getAttribute('rel')).toContain('noopener');
    expect(plain(link.textContent)).toBe(QA_STATS.asTaker);
  });

  it('«Поделиться» only where the device can share; it hands over the title and the link', async () => {
    renderPage();
    await screen.findByRole('button', { name: QA_STATS.qr });
    expect(screen.queryByRole('button', { name: QA_STATS.share })).toBeNull();
    cleanup();
    const share = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'share', { configurable: true, value: share });
    try {
      renderPage();
      fireEvent.click(await screen.findByRole('button', { name: QA_STATS.share }));
      await waitFor(() => expect(share).toHaveBeenCalledWith({ title: 'Контрольная · 16.10', url: `${window.location.origin}/k/k7m2p9q4r8st` }));
      // Closed without sharing: nothing to say, the button works again.
      share.mockRejectedValueOnce(new DOMException('cancel', 'AbortError'));
      fireEvent.click(screen.getByRole('button', { name: QA_STATS.share }));
      await waitFor(() => expect(share).toHaveBeenCalledTimes(2));
      expect(screen.queryByRole('alert')).toBeNull();
    } finally {
      delete (navigator as { share?: unknown }).share;
    }
  });
});
