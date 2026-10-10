import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { MockRunInput } from '../../types/container';
import type { ContainerData, Loadable } from '../../lib/containers/hooks';
import type { MockProgress } from '../../lib/containers/mockStore';

const mocks = vi.hoisted(() => ({
  state: null as unknown,
  saveMock: vi.fn(),
  loadMock: vi.fn(),
  clearMock: vi.fn(),
  submitMock: vi.fn(),
  track: vi.fn(),
}));

vi.mock('../../lib/containers/hooks', () => ({ useContainerData: () => mocks.state }));
vi.mock('../../lib/containers/words', () => import('../../components/containers/testkit/fakeWords'));
vi.mock('../../lib/containers/plan', () => import('../../components/containers/testkit/fakePlan'));
vi.mock('../../lib/containers/session', () => import('../../components/containers/testkit/fakeSession'));
vi.mock('../../lib/containers/time', () => import('../../components/containers/testkit/fakeTime'));
vi.mock('../../lib/containers/mockStore', () => ({ saveMock: mocks.saveMock, loadMock: mocks.loadMock, clearMock: mocks.clearMock, submitMock: mocks.submitMock }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('../../lib/telemetry', () => ({ track: mocks.track }));

import MockPage from './MockPage';
import { CONTAINER, SUBJECT_DB, containerData, dbItems, summary } from '../../components/containers/testkit/fixtures';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const nm = (text: string) => (name: string) => plain(name) === text;
const page = () => plain(document.body.textContent);
const three = () => dbItems().filter((entry) => ['q-iso', 'q-plain', 'q-multi'].includes(entry.id));

function loaded(data: ContainerData): Loadable<ContainerData> {
  return { data, loading: false, offline: false, unavailable: false, error: null, reload: vi.fn() };
}

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderMock(search: string, data = containerData({ items: three() })) {
  mocks.state = loaded(data);
  Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
  return render(
    <MemoryRouter initialEntries={[`/exams/c/${CONTAINER}/mock${search}`]}>
      <Routes>
        <Route path="/exams/c/:id/mock" element={<MockPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const lastSaved = (): MockProgress => mocks.saveMock.mock.calls[mocks.saveMock.mock.calls.length - 1][1] as MockProgress;
/** The options of the question on screen. */
const options = () => Array.from(document.querySelectorAll<HTMLButtonElement>('.ct-opts .ct-opt'));

beforeEach(() => {
  mocks.loadMock.mockReturnValue(null);
  mocks.submitMock.mockResolvedValue(null);
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('«Как на экзамене» (Concept 1 §3.6, decisions 20, 36, 53)', () => {
  it('without a size in the address opens the setup, which starts the try', () => {
    renderMock(`?s=${SUBJECT_DB}`);
    const sheet = screen.getByRole('dialog', { name: 'Как на экзамене' });
    expect(plain(sheet.textContent)).toContain('Ответы можно менять до «Завершить»; итог покажем после.');
    fireEvent.click(within(sheet).getByRole('button', { name: 'Начать' }));
    // 240 questions in the subject: 40 by default, a minute each (the bank of this test holds three).
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(lastSaved().timeLimitS).toBe(2400);
    expect(plain(screen.getByRole('banner').textContent)).toContain('1 из 3 · 40:00');
  });

  it('a try: «1 из 3 · 3:00» on top, no «Не знаю», a tap chooses without telling, every change kept on the device', () => {
    renderMock(`?s=${SUBJECT_DB}&n=3&t=3`);
    expect(plain(screen.getByRole('banner').textContent)).toContain('1 из 3 · 3:00');
    expect(within(screen.getByRole('banner')).getByRole('button', { name: 'Завершить' })).toBeInTheDocument();
    expect(plain(document.querySelector('.ct-ctx')?.textContent)).toBe('Как на экзамене · Базы данных');
    expect(screen.queryByRole('button', { name: 'Не знаю' })).toBeNull();
    const first = lastSaved();
    expect(first.itemIds).toHaveLength(3);
    expect(first.timeLimitS).toBe(180);
    const kind = dbItems().find((entry) => entry.id === first.itemIds[0])!.kind;
    fireEvent.click(options()[0]);
    expect(options()[0].getAttribute('aria-pressed')).toBe('true');
    expect(document.querySelector('.ct-verdict')).toBeNull();
    expect(page()).not.toMatch(/В файле|Неверно|Верно\./);
    if (kind === 'single') {
      fireEvent.click(options()[1]);
      expect(lastSaved().answers[first.itemIds[0]]).toEqual([1]);
    } else {
      expect(lastSaved().answers[first.itemIds[0]]).toEqual([0]);
    }
    fireEvent.click(screen.getByRole('button', { name: 'Дальше' }));
    expect(plain(screen.getByRole('banner').textContent)).toContain('2 из 3');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(plain(screen.getByRole('banner').textContent)).toContain('1 из 3');
  });

  it('«Все вопросы» shows which have an answer and opens any of them', () => {
    renderMock(`?s=${SUBJECT_DB}&n=3&t=0`);
    expect(plain(screen.getByRole('banner').textContent)).toContain('1 из 3');
    expect(plain(screen.getByRole('banner').textContent)).not.toContain(':');
    fireEvent.click(options()[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Все вопросы' }));
    const sheet = screen.getByRole('dialog', { name: 'Все вопросы' });
    expect(within(sheet).getByRole('button', { name: 'Вопрос 1, есть ответ' })).toBeInTheDocument();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Вопрос 3, без ответа' }));
    expect(plain(screen.getByRole('banner').textContent)).toContain('3 из 3');
    // The last question's pill is «Завершить».
    expect(within(document.querySelector('.ct-bar') as HTMLElement).getByRole('button', { name: 'Завершить' })).toBeInTheDocument();
  });

  it('before finishing names the unanswered — they count as errors; the result comes from the server', async () => {
    mocks.submitMock.mockResolvedValue({ run_id: 'r', items: 3, correct: 1, unanswered: 2, duplicate: false });
    renderMock(`?s=${SUBJECT_DB}&n=3&t=40`);
    fireEvent.click(options()[0]);
    fireEvent.click(within(screen.getByRole('banner')).getByRole('button', { name: 'Завершить' }));
    const sheet = screen.getByRole('dialog', { name: 'Как на экзамене' });
    expect(plain(sheet.textContent)).toContain('Ответили на 1 из 3. Без ответа: 2, 3 — они считаются ошибками.');
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Завершить' }));
    });
    await waitFor(() => expect(mocks.submitMock).toHaveBeenCalledTimes(1));
    const run = mocks.submitMock.mock.calls[0][1] as MockRunInput;
    expect(run).toMatchObject({ container_id: CONTAINER, subject_ids: [SUBJECT_DB], time_limit_s: 2400 });
    expect(run.answers).toHaveLength(3);
    expect(run.answers.every((answer) => answer.mode === 'mock')).toBe(true);
    expect(run.answers.filter((answer) => answer.chosen === null || answer.text === null)).toHaveLength(2);
    expect(run.answers[0].client_event_id).toBe(`${run.client_run_id}:01`);
    expect(page()).toMatch(/Как на экзамене · \d+ \S+/);
    expect(plain(document.querySelector('.ct-score')?.textContent)).toBe('1 из 3');
    expect(page()).toContain('Ошибки — 2, из них без ответа 2: они вернутся завтра.');
    expect(page()).not.toMatch(/%|оценк|прогноз/i);
    expect(screen.getByRole('link', { name: 'Разобрать ошибки' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?s=${SUBJECT_DB}&only=errors&back=s`);
    expect(mocks.clearMock).toHaveBeenCalledWith('user-1', CONTAINER);
    expect(mocks.track).toHaveBeenCalledWith('container.mock_finished', { items: 3, correct: 1 });
  });

  it('without network the result is counted on the device and the answers wait in the queue', async () => {
    mocks.submitMock.mockResolvedValue(null);
    renderMock(`?s=${SUBJECT_DB}&n=3&t=40`);
    const ids = lastSaved().itemIds;
    // Answer every question right from the key.
    for (let i = 0; i < 3; i += 1) {
      const entry = dbItems().find((candidate) => candidate.id === ids[i])!;
      for (const index of entry.correct) fireEvent.click(options()[index]);
      fireEvent.click(within(document.querySelector('.ct-bar') as HTMLElement).getByRole('button', { name: i < 2 ? 'Дальше' : 'Завершить' }));
    }
    const sheet = screen.getByRole('dialog', { name: 'Как на экзамене' });
    expect(plain(sheet.textContent)).toContain('Ответили на все 3 вопроса.');
    await act(async () => {
      fireEvent.click(within(sheet).getByRole('button', { name: 'Завершить' }));
    });
    await waitFor(() => expect(plain(document.querySelector('.ct-score')?.textContent)).toBe('3 из 3'));
    expect(page()).toContain('Нет сети. Итог посчитан на этом устройстве, ответы уйдут, когда сеть появится.');
    expect(page()).toContain('Ошибок нет.');
    expect(screen.getByRole('link', { name: 'Готово' })).toBeInTheDocument();
  });

  it('a try in progress on this device is picked up where it stopped (a closed tab loses nothing)', () => {
    const ids = three().map((entry) => entry.id);
    mocks.loadMock.mockReturnValue({
      runId: 'run-saved-0001',
      containerId: CONTAINER,
      subjectIds: [SUBJECT_DB],
      itemIds: ids,
      answers: { [ids[0]]: [3] },
      marked: [],
      startedAt: Date.now() - 60_000,
      timeLimitS: 600,
    } satisfies MockProgress);
    renderMock('');
    expect(plain(screen.getByRole('banner').textContent)).toContain('2 из 3 · 9:00');
    expect(page()).toContain('Попытка продолжается: 2 из 3, осталось 9:00.');
    fireEvent.click(screen.getByRole('button', { name: 'Назад' }));
    expect(options()[3].getAttribute('aria-pressed')).toBe('true');
  });

  it('a try whose time ran out while away ends at once with what was answered', async () => {
    const ids = three().map((entry) => entry.id);
    mocks.loadMock.mockReturnValue({
      runId: 'run-saved-0002',
      containerId: CONTAINER,
      subjectIds: [SUBJECT_DB],
      itemIds: ids,
      answers: { [ids[0]]: [3], [ids[2]]: [2] },
      marked: [],
      startedAt: Date.now() - 3_600_000,
      timeLimitS: 600,
    } satisfies MockProgress);
    renderMock('');
    await waitFor(() => expect(page()).toContain('Время вышло, пока вас не было. В итог вошли ответы, которые вы успели дать: 2 из 3.'));
    expect(plain(document.querySelector('.ct-score')?.textContent)).toBe('2 из 3');
    expect(page()).toContain('Время: 10 минут из 10.');
  });

  it('at 0:00 the try ends by itself', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    renderMock(`?s=${SUBJECT_DB}&n=3&t=1`);
    await act(async () => {
      vi.advanceTimersByTime(61_000);
    });
    await waitFor(() => expect(document.querySelector('.ct-score')).not.toBeNull());
    expect(plain(document.querySelector('.ct-score')?.textContent)).toBe('0 из 3');
  });

  it('a subject with nothing keyed cannot start a try', () => {
    const empty = summary({ subjects: summary().subjects.map((s) => (s.id === SUBJECT_DB ? { ...s, keyed: 0 } : s)) });
    renderMock(`?s=${SUBJECT_DB}`, containerData({ summary: empty, items: [] }));
    expect(page()).toContain('Пока не из чего собрать попытку: в предмете нет вопросов с ключом.');
    expect(screen.queryByRole('button', { name: nm('Начать') })).toBeNull();
  });
});
