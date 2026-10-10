import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import type { ContainerData, Loadable } from '../../lib/containers/hooks';

const mocks = vi.hoisted(() => ({
  state: null as unknown,
  confirm: vi.fn(),
  alert: vi.fn(),
  start: vi.fn(),
  saveSettings: vi.fn(),
  withdrawDoubt: vi.fn(),
  deleteContainer: vi.fn(),
  deleteSubject: vi.fn(),
}));

vi.mock('../../lib/containers/hooks', () => ({ useContainerData: () => mocks.state }));
vi.mock('../../lib/containers/words', () => import('../../components/containers/testkit/fakeWords'));
vi.mock('../../lib/containers/plan', () => import('../../components/containers/testkit/fakePlan'));
vi.mock('../../lib/containers/session', () => import('../../components/containers/testkit/fakeSession'));
vi.mock('../../lib/containers/time', () => import('../../components/containers/testkit/fakeTime'));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm, alert: mocks.alert }) }));
vi.mock('../../components/guide/GuideContext', () => ({ useGuide: () => ({ start: mocks.start }) }));
vi.mock('../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/containers')>()),
  saveSettings: mocks.saveSettings,
  withdrawDoubt: mocks.withdrawDoubt,
  deleteContainer: mocks.deleteContainer,
  deleteSubject: mocks.deleteSubject,
}));

import ContainerPage from './ContainerPage';
import { PHONE_QUERY } from '../../lib/usePhone';
import { saveSession } from '../../components/containers/sessionStore';
import {
  CONTAINER,
  ORAL_EXAM,
  SUBJECT_CS,
  SUBJECT_DB,
  SUBJECT_ORAL,
  containerData,
  dayPlan,
  item,
  subject,
  summary,
} from '../../components/containers/testkit/fixtures';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
/** A role's name with its no-break spaces read as spaces (Testing Library compares names as they are). */
const nm = (text: string) => (name: string) => plain(name) === text;
/** Text of the page with no-break spaces as spaces. */
const page = () => plain(document.body.textContent);

function loaded(data: ContainerData, extra: Partial<Loadable<ContainerData>> = {}): Loadable<ContainerData> {
  return { data, loading: false, offline: false, unavailable: false, error: null, reload: vi.fn(), ...extra };
}

function setPhone(phone: boolean) {
  if (!phone) {
    // No matchMedia: usePhone says «not a phone», useWide says «a computer».
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

function Where() {
  const location = useLocation();
  return <p data-testid="where">{`${location.pathname}${location.search}`}</p>;
}

function renderPage(state: Loadable<ContainerData>, opts: { phone?: boolean; entry?: string | { pathname: string; state?: unknown } } = {}) {
  mocks.state = state;
  setPhone(Boolean(opts.phone));
  return render(
    <MemoryRouter initialEntries={[opts.entry ?? `/exams/c/${CONTAINER}`]}>
      <Routes>
        <Route path="/exams/c/:id" element={<ContainerPage />} />
        <Route path="*" element={<Where />} />
      </Routes>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  mocks.confirm.mockResolvedValue(true);
  mocks.alert.mockResolvedValue(undefined);
  mocks.saveSettings.mockResolvedValue(undefined);
  mocks.withdrawDoubt.mockResolvedValue(undefined);
  mocks.deleteContainer.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
});

describe('the exam page: a normal day (Concept 1 §3.3, decision 46)', () => {
  it('puts today’s step first, then the figure, then the subjects as rows', () => {
    renderPage(loaded(containerData()));
    expect(screen.getByRole('heading', { level: 1, name: 'Аккредитация' })).toBeInTheDocument();
    const card = screen.getByRole('region', { name: /Сегодня 90/ });
    expect(plain(card.textContent)).toContain('Сегодня 90 вопросов, около 45 минут');
    expect(plain(card.textContent)).toContain('30 новых и 60 знакомых.');
    expect(within(card).getByRole('button', { name: 'План по дням' })).toBeInTheDocument();
    // The laptop: the pill sits in the card, with its minutes.
    expect(within(card).getByRole('link', { name: nm('Начать: 20 вопросов, около 9 минут') }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?s=${SUBJECT_CS}`);
    const figure = screen.getByRole('region', { name: 'верно в два разных дня' });
    expect(plain(figure.textContent)).toContain('143');
    expect(plain(figure.textContent)).toContain('из 960 верно');
    expect(plain(figure.textContent)).toContain('Видели 410 · ошибок сейчас 37');
    const rows = screen.getByRole('list', { name: 'Предметы' });
    const links = within(rows).getAllByRole('link');
    expect(links).toHaveLength(4);
    expect(plain(links[0].textContent)).toContain('Программирование на C#');
    expect(plain(links[0].textContent)).toContain('61 из 240 · сегодня 25');
    expect(links[0].getAttribute('href')).toBe(`/exams/c/${CONTAINER}/s/${SUBJECT_CS}`);
    // The order of the page: the card before the figure before the rows.
    expect(card.compareDocumentPosition(figure) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(figure.compareDocumentPosition(rows) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(page()).toContain('28 октября, через 18 дней · 4 предмета, 960 вопросов');
  });

  it('on a phone: one meta line without the subjects, the pill alone in the bar at the bottom, the actions in «⋯»', () => {
    renderPage(loaded(containerData()), { phone: true });
    expect(page()).toContain('28 октября, через 18 дней · 960 вопросов');
    expect(page()).not.toContain('4 предмета');
    const pill = screen.getByRole('link', { name: nm('Начать: 20 вопросов') });
    expect(pill.closest('.ct-cta')).not.toBeNull();
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: экзамен' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((node) => plain(node.textContent))).toEqual([
      'Пригласить группу',
      'Ключи · 4 ждут',
      'Время в день',
      'Добавить предмет',
      'Настройки',
      'Удалить',
    ]);
  });

  it('shows the author «Ключи · 7 ждут» when keys or doubts wait, and the laptop’s row of the same actions', () => {
    const base = summary({ owner: { members: 3, doubts_open: 3, links: [] } });
    renderPage(loaded(containerData({ summary: base })));
    expect(screen.getByRole('link', { name: nm('Ключи · 7 ждут') }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/keys`);
    expect(screen.getByRole('link', { name: 'Пригласить группу' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/settings?invite=1`);
    expect(screen.getByRole('link', { name: 'Добавить предмет' }).getAttribute('href')).toBe(`/exams/import?from=c:${CONTAINER}`);
    expect(page()).toContain('Сомневаются в ключе: 3 вопроса.');
    expect(page()).toContain('4 вопроса без ключа не идут в занятия.');
    expect(screen.getByRole('link', { name: 'Отметить ответы' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/keys`);
  });

  it('gives a member only «Время в день» and «Настройки», and no key links', () => {
    renderPage(loaded(containerData({ summary: summary({ role: 'member', owner: null, key_changes_unseen: 2 }) })), { phone: true });
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: экзамен' }));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((node) => node.textContent)).toEqual(['Время в день', 'Настройки']);
    expect(page()).toContain('Автор исправил ключ в 2 вопросах — счёт по ним начнётся заново.');
    expect(screen.queryByRole('link', { name: 'Отметить ответы' })).toBeNull();
  });
});

describe('the states of the exam page (§3.3 table)', () => {
  it('no answers yet: the rule in place of the figure, no zeros', () => {
    const plan = dayPlan({ figure: { inPlan: 960, twoDays: 0, seen: 0, errors: 0, selfKnow: 0 } });
    renderPage(loaded(containerData({ plan })));
    const figure = screen.getByRole('region', { name: 'верно в два разных дня' });
    expect(plain(figure.textContent)).toContain('В счёт идёт вопрос, на который вы ответили верно в два разных дня.');
    expect(plain(figure.textContent)).not.toMatch(/\b0 из/);
    expect(plain(figure.textContent)).not.toContain('Видели');
  });

  it('answered, nothing counts yet: the plan’s dated line in ink and the seen line, no big zero (decision 40)', () => {
    const plan = dayPlan({
      figure: { inPlan: 960, twoDays: 0, seen: 60, errors: 9, selfKnow: 0 },
      firstCountDay: '2026-10-11',
      lines: [{ key: 'first_count', n: [1], day: '2026-10-11', time: '17:00' }],
    });
    renderPage(loaded(containerData({ plan })));
    const figure = screen.getByRole('region', { name: 'верно в два разных дня' });
    expect(plain(figure.textContent)).toContain('Первые войдут в счёт завтра после 17:00 — если снова ответите верно');
    expect(plain(figure.textContent)).toContain('Видели 60 · ошибок сейчас 9');
    expect(figure.querySelector('.ct-fig-n')).toBeNull();
    // The line is the figure's, not a note of the card.
    expect(page().match(/Первые войдут в счёт/g)).toHaveLength(1);
  });

  it('interrupted today: «Продолжить: ещё 8 вопросов»', () => {
    saveSession('user-1', {
      v: 1,
      id: 'session-1',
      containerId: CONTAINER,
      day: '2026-10-10',
      subjectId: SUBJECT_DB,
      kind: 'answer',
      topic: null,
      only: null,
      queue: Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, retry: 0 as const })),
      pos: 12,
      startedAt: Date.now(),
      records: [],
    });
    renderPage(loaded(containerData()));
    expect(screen.getByRole('link', { name: nm('Продолжить: ещё 8 вопросов') }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?resume=1`);
  });

  it('the plan done: the plan’s line, «Ещё 20 новых» as a link, no blue pill', () => {
    const plan = dayPlan({ state: 'done', sessions: [], lines: [{ key: 'done', n: [128, 61] }, { key: 'more_new', n: [20] }] });
    renderPage(loaded(containerData({ plan })));
    expect(page()).toContain('На сегодня всё: 128 вопросов.');
    expect(screen.getByRole('link', { name: 'Ещё 20 новых' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?s=${SUBJECT_DB}&only=new`);
    expect(document.querySelector('.sf-primary')).toBeNull();
  });

  it('yesterday skipped: the plan’s line, the same minutes', () => {
    const plan = dayPlan({ lines: [{ key: 'skip', n: [1, 45] }] });
    renderPage(loaded(containerData({ plan })));
    expect(page()).toContain('Вчера без занятий. Сегодня те же 45 минут — больше знакомых вопросов.');
    expect(page()).not.toMatch(/сгор/);
  });

  it('minutes too low: the honest line and «Изменить время», which opens the minutes', async () => {
    const plan = dayPlan({ lines: [{ key: 'short', n: [45, 700, 960, 75], day: '2026-10-28' }] });
    renderPage(loaded(containerData({ plan })));
    expect(page()).toContain('При 45 минутах к 28 октября вы увидите около 700 из 960. Чтобы увидеть все, нужно около 75 минут.');
    fireEvent.click(screen.getByRole('button', { name: 'Изменить время' }));
    const dialog = screen.getByRole('dialog', { name: 'Время в день' });
    fireEvent.click(within(dialog).getByRole('radio', { name: nm('60 минут') }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Сохранить' }));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith(CONTAINER, { minutes_per_day: 60, study_weekdays: 127 }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('no date: «Дата не указана» in the meta and «Указать дату»', () => {
    const base = summary({ exam_date: null, subjects: summary().subjects.map((s) => ({ ...s, exam_date: null })) });
    const plan = dayPlan({ lines: [{ key: 'no_date', n: [15] }] });
    renderPage(loaded(containerData({ summary: base, plan })), { phone: true });
    expect(page()).toContain('Дата не указана · 960 вопросов');
    expect(page()).toContain('Без даты — по 15 новых в день на предмет.');
    expect(screen.getByRole('link', { name: 'Указать дату' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/settings`);
  });

  it('exam today: «Сегодня экзамен.» and a quiet link to the errors, no blue pill', () => {
    const base = summary({ exam_date: '2026-10-10', subjects: summary().subjects.map((s) => ({ ...s, exam_date: '2026-10-10' })) });
    const plan = dayPlan({ state: 'exam_today', sessions: [], lines: [{ key: 'exam_today', n: [37] }, { key: 'exam_errors', n: [20] }] });
    const data = containerData({ summary: base, plan, items: [item({ id: 'e1', subject_id: SUBJECT_DB })] });
    data.planInput.items = [{ id: 'e1', s: SUBJECT_DB, f: 't', tp: 1, o: 1, u: { seen: 1, wrong: 1, firstDay: '2026-10-08', lastDay: '2026-10-08', seriesAt: null, seriesDay: null, twoDaysAt: null, namedAt: null, checks: 0, peekDay: '2026-10-08', wasTwoDays: false, cleanOkAt: null } }];
    renderPage(loaded(data));
    expect(screen.getByRole('heading', { level: 2, name: 'Сегодня экзамен.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: nm('20 вопросов, где были ошибки') }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?s=${SUBJECT_DB}&only=errors`);
    expect(document.querySelector('.sf-primary')).toBeNull();
  });

  it('exam passed: the meta says so, the figure stays, «Поставить новую дату» and a quiet «Удалить экзамен»', async () => {
    const base = summary({ exam_date: '2026-10-05', subjects: summary().subjects.map((s) => ({ ...s, exam_date: '2026-10-05' })) });
    const plan = dayPlan({ state: 'after', sessions: [], lines: [{ key: 'after', day: '2026-10-05' }] });
    renderPage(loaded(containerData({ summary: base, plan })));
    expect(page()).toContain('Экзамен прошёл 5 октября');
    expect(screen.getByRole('region', { name: 'верно в два разных дня' }).textContent).toContain('143');
    expect(screen.getByRole('link', { name: 'Поставить новую дату' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/settings`);
    expect(document.querySelector('.sf-primary')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Удалить экзамен' }));
    await waitFor(() => expect(mocks.deleteContainer).toHaveBeenCalledWith(CONTAINER));
    await waitFor(() => expect(screen.getByTestId('where').textContent).toBe('/exams'));
  });

  it('offline: the page draws from the device and says so in one line', () => {
    renderPage(loaded(containerData(), { offline: true }));
    expect(page()).toContain('Нет сети. Вопросы на сегодня сохранены, заниматься можно.');
  });

  it('oral questions without lectures: one line with «Добавить лекции» into the oral editor, back by from=c:', () => {
    const base = summary({ subjects: [...summary().subjects, subject({ id: SUBJECT_ORAL, position: 5, title: 'Гражданское право', keyed: 0, seen: 0, two_days: 0, open_errors: 0, topics: [], topic_titles: [], oral: { exam_id: ORAL_EXAM, questions: 60 } })] });
    renderPage(loaded(containerData({ summary: base, oralWithoutPoints: 60 })));
    expect(page()).toContain('60 устных вопросов пока не считаются: к ним нужны лекции.');
    expect(screen.getByRole('link', { name: 'Добавить лекции' }).getAttribute('href')).toBe(`/exams/${ORAL_EXAM}/edit?from=c:${CONTAINER}#lectures`);
    const row = screen.getByRole('link', { name: /Гражданское право/ });
    expect(plain(row.textContent)).toContain('60 устных · нужны лекции');
    expect(row.getAttribute('href')).toBe(`/exams/${ORAL_EXAM}?from=c:${CONTAINER}`);
  });

  it('a set-aside question comes back with «Вернуть в занятия»', async () => {
    const base = summary({ subjects: summary().subjects.map((s) => (s.id === SUBJECT_DB ? { ...s, doubted: 1 } : s)) });
    const data = containerData({ summary: base });
    data.planInput.items = data.planInput.items.filter((entry) => entry.id !== 'q-plain');
    const state = loaded(data);
    renderPage(state);
    expect(page()).toContain('Отложен 1 вопрос — вы сомневаетесь в ключе.');
    fireEvent.click(screen.getByRole('button', { name: 'Вернуть в занятия' }));
    await waitFor(() => expect(mocks.withdrawDoubt).toHaveBeenCalledWith('q-plain'));
    await waitFor(() => expect(state.reload).toHaveBeenCalled());
  });

  it('«План по дням»: the days at the day’s minutes, the final days, the exam, and what a skipped day does', () => {
    renderPage(loaded(containerData()));
    fireEvent.click(screen.getByRole('button', { name: 'План по дням' }));
    const dialog = screen.getByRole('dialog', { name: 'План по дням' });
    const text = plain(dialog.textContent);
    expect(text).toContain('Время в день: 45 минут');
    expect(text).toContain('10 октября – 23 октября — 45 минут в день');
    expect(text).toContain('24 октября – 27 октября — новых нет, только знакомые, сначала ошибки');
    expect(text).toContain('28 октября — экзамен');
    expect(text).toContain('Если пропустите день, его вопросы перейдут на следующие.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('a one-subject exam is its subject page (decision 44)', () => {
  it('has the exam’s name, the topics as rows and the exam’s «⋯» with «Удалить»', () => {
    renderPage(loaded(containerData({ summary: summary({ subjects: [subject({ id: SUBJECT_DB, title: 'Базы данных' })] }) })), { phone: true });
    expect(screen.getByRole('heading', { level: 1, name: 'Аккредитация' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Темы' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: экзамен' }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((node) => plain(node.textContent));
    expect(items).toEqual(['Пригласить группу', 'Ключи', 'Время в день', 'Добавить предмет', 'Настройки', 'Удалить']);
  });
});

describe('loading, failures, the guide', () => {
  it('waits quietly, then says it is loading', async () => {
    renderPage({ data: null, loading: true, offline: false, unavailable: false, error: null, reload: vi.fn() });
    expect(screen.getByRole('status').textContent).toBe('');
    await waitFor(() => expect(screen.getByRole('status').textContent).toBe('Загружаем экзамен…'));
  });

  it('says a failure with «Повторить»', () => {
    const reload = vi.fn();
    renderPage({ data: null, loading: false, offline: false, unavailable: false, error: 'Нет связи с сервером.', reload });
    expect(screen.getByRole('alert').textContent).toContain('Нет связи с сервером.');
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(reload).toHaveBeenCalled();
  });

  it('a database without the container functions: a calm line and the way to «Экзамены»', () => {
    renderPage({ data: null, loading: false, offline: false, unavailable: true, error: null, reload: vi.fn() });
    expect(page()).toContain('Экзамен пока не открывается');
    expect(screen.getByRole('link', { name: 'Экзамены' }).getAttribute('href')).toBe('/exams');
  });

  it('opens the guide after «Готово» of the first session (decision 33)', async () => {
    renderPage(loaded(containerData()), { entry: { pathname: `/exams/c/${CONTAINER}`, state: { guide: true } } });
    await waitFor(() => expect(mocks.start).toHaveBeenCalledWith('today'));
    expect(mocks.start).toHaveBeenCalledTimes(1);
  });
});
