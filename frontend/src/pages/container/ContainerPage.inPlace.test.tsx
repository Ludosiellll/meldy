import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ContainerData, Loadable } from '../../lib/containers/hooks';
import type { QuizListRow } from '../../types/quiz';

/**
 * Release 47.3 (owner, 18.10, live): the exam page's actions act in place — «Удалить» and «Выйти из экзамена» their
 * confirm with the settings' words, «Время в день» its choices saved at once, «Пригласить группу» its dialog — and a
 * computer shows at most three pills with «Ещё»; the author's own test opens as the test's own page (TestHome).
 */
const mocks = vi.hoisted(() => ({
  state: null as unknown,
  confirm: vi.fn(),
  alert: vi.fn(),
  saveSettings: vi.fn(),
  deleteContainer: vi.fn(),
  leaveContainer: vi.fn(),
  listQuizzes: vi.fn(),
  track: vi.fn(),
}));

vi.mock('../../lib/containers/hooks', () => ({ useContainerData: () => mocks.state }));
vi.mock('../../lib/containers/plan', async (original) => (await import('../../components/containers/testkit/engine')).planModule(original));
vi.mock('../../lib/containers/session', async (original) => (await import('../../components/containers/testkit/engine')).sessionModule(original));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm, alert: mocks.alert }) }));
vi.mock('../../components/guide/GuideContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/guide/GuideContext')>()),
  useGuide: () => ({ start: vi.fn() }),
}));
vi.mock('../../api/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/telegram')>()),
  fetchTelegramState: vi.fn(async () => null),
}));
vi.mock('../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/containers')>()),
  saveSettings: mocks.saveSettings,
  deleteContainer: mocks.deleteContainer,
  leaveContainer: mocks.leaveContainer,
}));
vi.mock('../../api/quizzes', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/quizzes')>()),
  listQuizzes: mocks.listQuizzes,
}));
vi.mock('../../lib/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../lib/telemetry')>()),
  track: mocks.track,
}));
// The group's Telegram section under the invite has its own tests: here it draws nothing.
vi.mock('../../components/telegram/GroupBotInvite', () => ({ default: () => null }));

import ContainerPage from './ContainerPage';
import SubjectPage from './SubjectPage';
import { PHONE_QUERY } from '../../lib/usePhone';
import { SETTINGS } from '../../components/containers/copyImport';
import { TEST_HOME } from '../../components/test/copyTest';
import { CONTAINER, SUBJECT_DB, containerData, subject, summary } from '../../components/containers/testkit/fixtures';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const page = () => plain(document.body.textContent);
/** A role's name with its no-break spaces read as spaces. */
const nm = (text: string) => (name: string) => plain(name) === text;

function loaded(data: ContainerData, reload = vi.fn()): Loadable<ContainerData> {
  return { data, loading: false, offline: false, unavailable: false, error: null, reload };
}

function setPhone(phone: boolean) {
  if (!phone) {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
    return;
  }
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (query: string) => ({
      matches: query === PHONE_QUERY,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

/** «Экзамены» as the test sees it: where it is and the line the exam's page handed over. */
function Exams() {
  const location = useLocation();
  const notice = (location.state as { notice?: string } | null)?.notice ?? '';
  return <p data-testid="exams">{`${location.pathname}|${notice}`}</p>;
}
function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}${location.hash}`}</p>;
}

function renderPage(state: Loadable<ContainerData>, phone = false) {
  mocks.state = state;
  setPhone(phone);
  return render(
    <MemoryRouter initialEntries={[`/exams/c/${CONTAINER}`]}>
      <Routes>
        <Route path="/exams" element={<Exams />} />
        <Route path="/exams/c/:id" element={<ContainerPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

const testSummary = (extra: Parameters<typeof summary>[0] = {}) =>
  summary({
    kind: 'test',
    title: 'Кислоты и основания',
    exam_date: null,
    subjects: [subject({ id: SUBJECT_DB, title: 'Вопросы', exam_date: null, oral: null, keyed: 12, no_key: 0, topic_titles: [], topics: [] })],
    items_version: { count: 12, updated_at: '2026-10-18T10:00:00+00:00' },
    ...extra,
  });

function quiz(extra: Partial<QuizListRow>): QuizListRow {
  return {
    id: 'q-1', container_id: CONTAINER, code: 'k7m2p9q4r8st', title: 'Контрольная · 18 октября', subject_ids: [SUBJECT_DB], item_count: 12,
    same_set: true, shuffle_items: true, shuffle_options: true, time_limit_s: null, opens_at: null, closes_at: null, closed_at: null,
    attempts: null, grading: 'percent', allow_back: true, pass_percent: null, review: 'after', members_only: false, guests: true,
    cover_path: null, accent: 'blue', offer_practice: false, created_at: '2026-10-18T10:00:00Z', updated_at: '2026-10-18T10:00:00Z',
    state: 'open', started: true, people: 6, writing: 1, finished: 5, avg_percent: 71, ...extra,
  } as QuizListRow;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  mocks.confirm.mockReset().mockResolvedValue(true);
  mocks.alert.mockReset().mockResolvedValue(undefined);
  mocks.saveSettings.mockReset().mockResolvedValue(undefined);
  mocks.deleteContainer.mockReset().mockResolvedValue(undefined);
  mocks.leaveContainer.mockReset().mockResolvedValue(undefined);
  mocks.listQuizzes.mockReset().mockResolvedValue([]);
  mocks.track.mockReset();
});
afterEach(() => cleanup());

describe('the exam page acts in place (release 47.3)', () => {
  it('a computer: three pills — «Пригласить группу», «Вопросы и ключи», «Контрольные» — and «Ещё» with the rest', () => {
    renderPage(loaded(containerData({ summary: summary({ owner: { members: 0, doubts_open: 0, links: [] } }) })));
    const row = document.querySelector('.ct-links') as HTMLElement;
    const pills = Array.from(row.querySelectorAll('.ct-pill-link')).map((node) => plain(node.textContent).split(' · ')[0]);
    expect(pills).toEqual(['Пригласить группу', 'Вопросы и ключи', 'Контрольные']);
    fireEvent.click(within(row).getByRole('button', { name: 'Ещё: экзамен' }));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((node) => node.textContent)).toEqual([
      'Студия',
      'Время в день',
      'Добавить предмет',
      'Настройки',
      'Удалить',
    ]);
    // «Настройки» stays a link.
    expect(screen.getByRole('menuitem', { name: 'Настройки' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/settings`);
  });

  it('«Удалить» asks right here with the settings’ words, deletes, and «Экзамены» says so', async () => {
    renderPage(loaded(containerData({ summary: summary({ owner: { members: 0, doubts_open: 0, links: [] } }) })));
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: экзамен' }));
    const item = screen.getByRole('menuitem', { name: 'Удалить' });
    expect(item).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(item);
    await waitFor(() => expect(mocks.deleteContainer).toHaveBeenCalledWith(CONTAINER));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({
        title: SETTINGS.remove,
        message: SETTINGS.removeAsk('Аккредитация', false),
        confirmText: SETTINGS.removeYes,
        cancelText: SETTINGS.removeNo,
      }),
    );
    expect(await screen.findByTestId('exams')).toHaveTextContent('/exams|Экзамен «Аккредитация» удалён.');
  });

  it('«Удалить» kept: nothing is deleted, the page stays', async () => {
    mocks.confirm.mockResolvedValue(false);
    renderPage(loaded(containerData({ summary: summary({ owner: { members: 0, doubts_open: 0, links: [] } }) })));
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: экзамен' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    await waitFor(() => expect(mocks.confirm).toHaveBeenCalled());
    expect(mocks.deleteContainer).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { level: 1, name: 'Аккредитация' })).toBeInTheDocument();
  });

  it('with members in, «Удалить» says to remove them first and leads to «Кто вошёл»', async () => {
    renderPage(loaded(containerData({ summary: summary({ owner: { members: 3, doubts_open: 0, links: [] } }) })));
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: экзамен' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    await waitFor(() => expect(mocks.alert).toHaveBeenCalled());
    const options = mocks.alert.mock.calls[0][0];
    expect(options).toMatchObject({ title: SETTINGS.remove, message: SETTINGS.hasMembers(3), secondaryText: 'Кто вошёл' });
    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.deleteContainer).not.toHaveBeenCalled();
    act(() => options.onSecondary());
    expect(await screen.findByTestId('where')).toHaveTextContent(`/exams/c/${CONTAINER}/settings?who=1#group`);
  });

  it('someone joined since the page was read (MC009): the page reads again and says to remove them first', async () => {
    const reload = vi.fn();
    mocks.deleteContainer.mockRejectedValue(Object.assign(new Error('members'), { code: 'MC009' }));
    renderPage(loaded(containerData({ summary: summary({ owner: { members: 0, doubts_open: 0, links: [] } }) }), reload));
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: экзамен' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    await waitFor(() => expect(mocks.alert).toHaveBeenCalledWith(expect.objectContaining({ message: SETTINGS.hasMembers(1) })));
    expect(reload).toHaveBeenCalled();
    expect(screen.queryByTestId('exams')).toBeNull();
  });

  it('a member’s «Выйти из экзамена» asks right here, leaves, and «Экзамены» says so', async () => {
    renderPage(loaded(containerData({ summary: summary({ role: 'member', owner: null }) })), true);
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: экзамен' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Выйти из экзамена' }));
    await waitFor(() => expect(mocks.leaveContainer).toHaveBeenCalledWith(CONTAINER));
    expect(mocks.confirm).toHaveBeenCalledWith(expect.objectContaining({ title: SETTINGS.leave, message: SETTINGS.leaveAsk('Аккредитация'), confirmText: SETTINGS.leaveYes }));
    expect(await screen.findByTestId('exams')).toHaveTextContent('/exams|Вы вышли из «Аккредитация».');
  });

  it('«Время в день» opens the settings’ choices; each is saved as it is chosen and the plan is read again', async () => {
    const reload = vi.fn();
    renderPage(loaded(containerData({ summary: summary({ owner: { members: 0, doubts_open: 0, links: [] } }) }), reload));
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: экзамен' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Время в день' }));
    const dialog = screen.getByRole('dialog', { name: 'Время в день' });
    const minutes = within(dialog).getByRole('group', { name: 'Время в день' });
    expect(within(minutes).getAllByRole('radio').map((node) => plain(node.parentElement?.textContent))).toEqual([
      '30 минут',
      '45 минут',
      '60 минут',
      '90 минут',
      'Все вопросы',
    ]);
    expect(within(minutes).getByRole('radio', { name: nm('45 минут') })).toBeChecked();
    fireEvent.click(within(minutes).getByRole('radio', { name: nm('90 минут') }));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith(CONTAINER, { minutes_per_day: 90, study_weekdays: 127, tempo: 'date' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(plain(within(dialog).getByRole('status').textContent)).toBe('Сохранено: 90 минут в день. План пересчитан.');
    fireEvent.click(within(dialog).getByRole('radio', { name: 'Как можно быстрее' }));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenLastCalledWith(CONTAINER, { minutes_per_day: 90, study_weekdays: 127, tempo: 'fast' }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
    expect(within(dialog).getByRole('link', { name: 'Дни занятий и дата — в настройках' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/settings#days`);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Готово' }));
    expect(screen.queryByRole('dialog', { name: 'Время в день' })).toBeNull();
  });

  it('«Время в день» says a failure in place, and keeps the dialog', async () => {
    mocks.saveSettings.mockRejectedValue(Object.assign(new Error('x'), { code: 'network' }));
    renderPage(loaded(containerData({ summary: summary({ owner: { members: 0, doubts_open: 0, links: [] } }) })));
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: экзамен' }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Время в день' }));
    const dialog = screen.getByRole('dialog', { name: 'Время в день' });
    fireEvent.click(within(dialog).getByRole('radio', { name: nm('60 минут') }));
    await waitFor(() => expect(within(dialog).getByRole('status').textContent).toBe('Не получилось. Попробуйте ещё раз.'));
    expect(within(dialog).getByRole('status')).toHaveAttribute('data-error');
  });

  it('«Пригласить группу» opens the invite over the page, not on the way to «Настройки»', () => {
    renderPage(loaded(containerData({ summary: summary({ owner: { members: 0, doubts_open: 0, links: [] } }) })));
    fireEvent.click(screen.getByRole('button', { name: 'Пригласить группу' }));
    expect(screen.getByRole('dialog', { name: 'Пригласить группу' })).toBeInTheDocument();
    expect(screen.queryByTestId('where')).toBeNull();
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog', { name: 'Пригласить группу' })).toBeNull();
  });

  it('a subject of several follows the rule: three pills and «Ещё» with «Убрать предмет»', async () => {
    mocks.state = loaded(containerData());
    setPhone(false);
    render(
      <MemoryRouter initialEntries={[`/exams/c/${CONTAINER}/s/${SUBJECT_DB}`]}>
        <Routes>
          <Route path="/exams/c/:id/s/:subjectId" element={<SubjectPage />} />
          <Route path="*" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    );
    const row = await waitFor(() => document.querySelector('.ct-links') as HTMLElement);
    expect(Array.from(row.querySelectorAll('.ct-pill-link')).map((node) => node.textContent)).toEqual(['Вопросы и ключи', 'Обновить из файла', 'Настройки']);
    fireEvent.click(within(row).getByRole('button', { name: 'Ещё: предмет' }));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((node) => node.textContent)).toEqual(['Убрать предмет']);
  });
});

describe('the author’s own test opens as the test’s page (release 47.3)', () => {
  it('the name, «Тест · 12 вопросов · 2 контрольные», «Открыть студию», «Отправить по ссылке», the контрольные; no plan', async () => {
    mocks.listQuizzes.mockResolvedValue([
      quiz({ id: 'q-1', title: 'Контрольная · 18 октября', state: 'open', finished: 5 }),
      quiz({ id: 'q-2', title: 'Пробный тур', state: 'closed', finished: 0, people: 0 }),
    ]);
    renderPage(loaded(containerData({ summary: testSummary() })));
    expect(screen.getByRole('heading', { level: 1, name: 'Кислоты и основания' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Открыть студию' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/studio`);
    expect(screen.getByRole('link', { name: TEST_HOME.send }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/quizzes/new?all=1&design=1`);
    const list = await screen.findByRole('list', { name: 'Контрольные' });
    expect(page()).toContain('Тест · 12 вопросов · 2 контрольные');
    const rows = within(list).getAllByRole('link');
    expect(rows.map((row) => plain(row.textContent))).toEqual(['Контрольная · 18 октябряОткрыта · сдали 5', 'Пробный турЗакрыта · пока никто не сдал']);
    expect(rows.map((row) => row.getAttribute('href'))).toEqual([`/exams/c/${CONTAINER}/quizzes/q-1`, `/exams/c/${CONTAINER}/quizzes/q-2`]);
    expect(mocks.listQuizzes).toHaveBeenCalledWith(CONTAINER);
    // No plan card, no figure, no «В счёт идёт…», no «Время в день».
    expect(page()).not.toContain('В счёт идёт');
    expect(page()).not.toContain('На сегодня');
    expect(document.querySelector('.ct-plan')).toBeNull();
    expect(screen.queryByRole('region', { name: 'верно в два разных дня' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: TEST_HOME.menuLabel }));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((node) => node.textContent)).toEqual([
      'Настройки',
      'Вопросы и ключи',
      'Пригласить группу',
      'Удалить',
    ]);
    // The only pills of the row are the page's own two: the rest are in «Ещё».
    expect(document.querySelectorAll('.ct-pill-link')).toHaveLength(0);
  });

  it('no контрольная yet: one line of what will be here', async () => {
    renderPage(loaded(containerData({ summary: testSummary() })));
    expect(await screen.findByText((_, node) => node?.className === 'th-empty')).toHaveTextContent(/Контрольная — это ваш тест по ссылке/);
    expect(page()).toContain('Тест · 12 вопросов');
    expect(page()).not.toContain('контрольные ·');
  });

  it('no question with its key: «Отправить по ссылке» is shut and says why', async () => {
    const none = testSummary({ subjects: [subject({ id: SUBJECT_DB, title: 'Вопросы', exam_date: null, oral: null, keyed: 0, no_key: 0, topic_titles: [], topics: [] })] });
    renderPage(loaded(containerData({ summary: none })));
    const send = screen.getByRole('button', { name: TEST_HOME.send });
    expect(send).toBeDisabled();
    const why = document.getElementById(send.getAttribute('aria-describedby') ?? '');
    expect(plain(why?.textContent)).toBe(TEST_HOME.sendWhyEmpty);
    expect(page()).toContain('Тест · пока без вопросов');
    cleanup();
    const noKey = testSummary({ subjects: [subject({ id: SUBJECT_DB, title: 'Вопросы', exam_date: null, oral: null, keyed: 0, no_key: 3, topic_titles: [], topics: [] })] });
    renderPage(loaded(containerData({ summary: noKey })));
    const shut = screen.getByRole('button', { name: TEST_HOME.send });
    expect(plain(document.getElementById(shut.getAttribute('aria-describedby') ?? '')?.textContent)).toBe(TEST_HOME.sendWhyKey);
  });

  it('a phone: the round «⋯», «Отправить по ссылке» under the meta, «Открыть студию» in the bar at the bottom', () => {
    renderPage(loaded(containerData({ summary: testSummary() })), true);
    expect(screen.getByRole('link', { name: 'Открыть студию' }).closest('.ct-cta')).not.toBeNull();
    expect(screen.getByRole('link', { name: TEST_HOME.send }).closest('.ct-links')).not.toBeNull();
    expect(screen.getByRole('button', { name: TEST_HOME.menuLabel }).closest('.ct-more')).not.toBeNull();
  });

  it('«Удалить» of a test says the test’s words, and «Экзамены» says it is gone', async () => {
    renderPage(loaded(containerData({ summary: testSummary({ owner: { members: 0, doubts_open: 0, links: [] } }) })));
    fireEvent.click(screen.getByRole('button', { name: TEST_HOME.menuLabel }));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Удалить' }));
    await waitFor(() => expect(mocks.deleteContainer).toHaveBeenCalledWith(CONTAINER));
    expect(mocks.confirm).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Удалить тест', message: 'Удалить «Кислоты и основания»? Вопросы, контрольные и их результаты пропадут.', confirmText: 'Удалить тест' }),
    );
    expect(await screen.findByTestId('exams')).toHaveTextContent('/exams|Тест «Кислоты и основания» удалён.');
  });

  it('a контрольные list that failed says so with «Повторить»', async () => {
    mocks.listQuizzes.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce([quiz({})]);
    renderPage(loaded(containerData({ summary: testSummary() })));
    fireEvent.click(await screen.findByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('list', { name: 'Контрольные' })).toBeInTheDocument();
  });

  it('a member of a test studies it: the exam’s page with its plan', () => {
    renderPage(loaded(containerData({ summary: testSummary({ role: 'member', owner: null }) })));
    expect(document.querySelector('.th-page')).toBeNull();
    expect(document.querySelector('.ct-plan')).not.toBeNull();
    expect(screen.queryByRole('link', { name: 'Открыть студию' })).toBeNull();
  });

  it('an exam the server says nothing of the kind about (an older server) is an exam', () => {
    renderPage(loaded(containerData({ summary: summary({ kind: undefined }) })));
    expect(document.querySelector('.th-page')).toBeNull();
    expect(document.querySelector('.ct-plan')).not.toBeNull();
  });
});
