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
  moveExamDate: vi.fn(),
}));

vi.mock('../../lib/containers/hooks', () => ({ useContainerData: () => mocks.state }));
vi.mock('../../lib/containers/plan', async (original) => (await import('../../components/containers/testkit/engine')).planModule(original));
vi.mock('../../lib/containers/session', async (original) => (await import('../../components/containers/testkit/engine')).sessionModule(original));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));
vi.mock('../../contexts/ConfirmContext', () => ({ useConfirm: () => ({ confirm: mocks.confirm, alert: mocks.alert }) }));
vi.mock('../../components/guide/GuideContext', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../components/guide/GuideContext')>()),
  useGuide: () => ({ start: mocks.start }),
}));
// The Telegram tip has its own tests (components/telegram/ExamTelegramTip.test): here the bot is not on the server.
vi.mock('../../api/telegram', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/telegram')>()),
  fetchTelegramState: vi.fn(async () => null),
}));
vi.mock('../../api/containers', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../api/containers')>()),
  saveSettings: mocks.saveSettings,
  withdrawDoubt: mocks.withdrawDoubt,
  deleteContainer: mocks.deleteContainer,
  deleteSubject: mocks.deleteSubject,
  moveExamDate: mocks.moveExamDate,
}));

import ContainerPage from './ContainerPage';
import { DEFAULT_PACE } from '../../lib/containers/pace';
import { PHONE_QUERY } from '../../lib/usePhone';
import { saveSession } from '../../components/containers/sessionStore';
import {
  CONTAINER,
  ORAL_EXAM,
  SUBJECT_CS,
  SUBJECT_DB,
  SUBJECT_NET,
  SUBJECT_ORAL,
  SUBJECT_OS,
  containerData,
  dayPlan,
  dbItems,
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
  mocks.moveExamDate.mockReset().mockImplementation(async (id: string, date: string | null, forWhom: string) => ({
    for: forWhom, container_id: id, exam_date: forWhom === 'all' ? date : '2026-10-05', own_exam_date: forWhom === 'me' ? date : null, subjects: [],
  }));
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
    // The laptop: the pill sits in the card; with work in two subjects today it names the first (m3).
    expect(within(card).getByRole('link', { name: nm('Начать: Программирование на C# — 20 вопросов') }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?s=${SUBJECT_CS}`);
    const figure = screen.getByRole('region', { name: 'верно в два разных дня' });
    expect(plain(figure.textContent)).toContain('143');
    expect(plain(figure.textContent)).toContain('из 960 верно');
    expect(plain(figure.textContent)).toContain('Видели 410 · ошибок сейчас 37');
    const rows = screen.getByRole('list', { name: 'Предметы' });
    const links = within(rows).getAllByRole('link');
    expect(links).toHaveLength(4);
    expect(plain(links[0].textContent)).toContain('Программирование на C#');
    expect(plain(links[0].textContent)).toContain('видели 180 из 240 · в счёте 61 · сегодня 25');
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
    const pill = screen.getByRole('link', { name: nm('Начать: Программирование на C# — 20 вопросов') });
    expect(pill.closest('.ct-cta')).not.toBeNull();
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: экзамен' }));
    const menu = screen.getByRole('menu');
    expect(within(menu).getAllByRole('menuitem').map((node) => plain(node.textContent))).toEqual([
      'Пригласить группу',
      'Вопросы и ключи · 4 ждут',
      'Студия',
      'Контрольные',
      'Время в день',
      'Добавить предмет',
      'Настройки',
      'Удалить',
    ]);
  });

  it('names no subject when only one has work today: «Начать: 20 вопросов», with its minutes on a laptop (m3)', () => {
    const plan = dayPlan({ sessions: [{ subjectId: SUBJECT_CS, kind: 'answer', ids: Array.from({ length: 20 }, (_, i) => `cs-${i}`), estSec: 540 }] });
    renderPage(loaded(containerData({ plan })));
    expect(screen.getByRole('link', { name: nm('Начать: 20 вопросов, около 9 минут') })).toBeInTheDocument();
    cleanup();
    renderPage(loaded(containerData({ plan })), { phone: true });
    expect(screen.getByRole('link', { name: nm('Начать: 20 вопросов') }).closest('.ct-cta')).not.toBeNull();
  });

  it('shows one note of the card on a phone and two on a laptop, what explains today first (m9)', () => {
    const lines = [
      { key: 'window_ahead', n: [4], day: '2026-10-24' },
      { key: 'short', n: [45, 700, 960, 75], day: '2026-10-28' },
      { key: 'skip', n: [1, 45] },
      { key: 'first_day' },
    ];
    const notes = () => Array.from(document.querySelectorAll('.ct-plan-notes .ct-note')).map((node) => plain(node.textContent));
    renderPage(loaded(containerData({ plan: dayPlan({ lines }) })), { phone: true });
    expect(notes()).toEqual(['Вчера без занятий. Сегодня те же 45 минут — больше знакомых вопросов.']);
    cleanup();
    renderPage(loaded(containerData({ plan: dayPlan({ lines }) })));
    expect(notes()).toEqual([
      'Вчера без занятий. Сегодня те же 45 минут — больше знакомых вопросов.',
      'При 45 минутах к 28 октября вы увидите около 700 из 960. Чтобы увидеть все, нужно около 75 минут. Изменить время',
    ]);
    cleanup();
    // offline first; the final days, announced from day 1, in one line when nothing comes before them
    renderPage(loaded(containerData({ plan: dayPlan({ lines }) }), { offline: true }), { phone: true });
    expect(notes()).toEqual(['Нет сети. Вопросы на сегодня сохранены, заниматься можно.']);
    cleanup();
    renderPage(loaded(containerData({ plan: dayPlan({ lines: [lines[0], lines[3]] }) })), { phone: true });
    expect(notes()).toEqual(['С 24 октября новых вопросов не будет.']);
  });

  it('shows the author «Ключи · 7 ждут» when keys or doubts wait, and the laptop’s row of the same actions', () => {
    const base = summary({ owner: { members: 3, doubts_open: 3, links: [] } });
    renderPage(loaded(containerData({ summary: base })));
    expect(screen.getByRole('link', { name: nm('Вопросы и ключи · 7 ждут') }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/keys`);
    expect(screen.getByRole('link', { name: 'Пригласить группу' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/settings?invite=1`);
    expect(screen.getByRole('link', { name: 'Добавить предмет' }).getAttribute('href')).toBe(`/exams/import?from=c:${CONTAINER}`);
    expect(page()).toContain('Сомневаются в ключе: 3 вопроса.');
    expect(page()).toContain('4 вопроса без ключа не идут в занятия.');
    expect(screen.getByRole('link', { name: 'Отметить ответы' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/keys`);
  });

  it('gives a member «Время в день», «Настройки» and the way out (usability check m1), and no key links', () => {
    renderPage(loaded(containerData({ summary: summary({ role: 'member', owner: null, key_changes_unseen: 2 }) })), { phone: true });
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: экзамен' }));
    expect(within(screen.getByRole('menu')).getAllByRole('menuitem').map((node) => node.textContent)).toEqual(['Время в день', 'Настройки', 'Выйти из экзамена']);
    expect(screen.getByRole('menuitem', { name: 'Выйти из экзамена' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/settings#leave`);
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
    expect(page()).toContain('На сегодня всё: 128 вопросов за 61 минуту.');
    expect(screen.getByRole('link', { name: nm('Ещё 20 новых') }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?s=${SUBJECT_DB}&only=new`);
    expect(document.querySelector('.sf-primary')).toBeNull();
  });

  it('yesterday skipped: the plan’s line, the same minutes', () => {
    const plan = dayPlan({ lines: [{ key: 'skip', n: [1, 45] }] });
    renderPage(loaded(containerData({ plan })));
    expect(page()).toContain('Вчера без занятий. Сегодня те же 45 минут — больше знакомых вопросов.');
    expect(page()).not.toMatch(/сгор/);
  });

  it('minutes too low: the honest line and «Изменить время» to the settings’ minutes', () => {
    const plan = dayPlan({ lines: [{ key: 'short', n: [45, 700, 960, 75], day: '2026-10-28' }] });
    renderPage(loaded(containerData({ plan })));
    expect(page()).toContain('При 45 минутах к 28 октября вы увидите около 700 из 960. Чтобы увидеть все, нужно около 75 минут.');
    expect(screen.getByRole('link', { name: 'Изменить время' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/settings#minutes`);
  });

  it('the pace re-estimated: told once, «Поставить 30» saves the minutes, «Оставить 45» keeps them', async () => {
    const data = () => containerData({ input: { pace: { [SUBJECT_DB]: DEFAULT_PACE } } });
    const state = loaded(data());
    renderPage(state);
    expect(page()).toContain('Вы отвечаете быстрее, чем мы считали: хватит 30 минут в день.');
    fireEvent.click(screen.getByRole('button', { name: 'Поставить 30' }));
    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledWith(CONTAINER, { minutes_per_day: 30, study_weekdays: 127 }));
    await waitFor(() => expect(state.reload).toHaveBeenCalled());
    expect(page()).not.toContain('Вы отвечаете быстрее');
    cleanup();
    // Told once: the same stage says nothing again.
    renderPage(loaded(data()));
    expect(page()).not.toContain('Вы отвечаете быстрее');
    cleanup();
    window.localStorage.clear();
    renderPage(loaded(data()));
    fireEvent.click(screen.getByRole('button', { name: 'Оставить 45' }));
    expect(page()).not.toContain('Вы отвечаете быстрее');
    expect(mocks.saveSettings).toHaveBeenCalledTimes(1);
  });

  it('no date: «Дата не указана» in the meta and «Указать дату»', () => {
    const base = summary({ exam_date: null, subjects: summary().subjects.map((s) => ({ ...s, exam_date: null })) });
    const plan = dayPlan({ lines: [{ key: 'no_date', n: [15] }] });
    renderPage(loaded(containerData({ summary: base, plan })), { phone: true });
    expect(page()).toContain('Дата не указана · 960 вопросов');
    expect(page()).toContain('Без даты — по 15 новых в день на предмет.');
    expect(screen.getByRole('link', { name: 'Указать дату' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/settings`);
  });

  // Release 47: the errors are the day's pill «Пройтись по ошибкам: N» (was a quiet link with no pill), and «Перенести
  // экзамен» is a quiet link beside it.
  it('exam today: «Сегодня экзамен.», the pill «Пройтись по ошибкам: 20» and a quiet «Перенести экзамен»', () => {
    const base = summary({ exam_date: '2026-10-10', subjects: summary().subjects.map((s) => ({ ...s, exam_date: '2026-10-10' })) });
    const plan = dayPlan({ state: 'exam_today', sessions: [], lines: [{ key: 'exam_today', n: [37] }, { key: 'exam_errors', n: [20] }] });
    const data = containerData({ summary: base, plan, items: [item({ id: 'e1', subject_id: SUBJECT_DB })] });
    data.planInput.items = [{ id: 'e1', s: SUBJECT_DB, f: 't', tp: 1, o: 1, u: { seen: 1, wrong: 1, firstDay: '2026-10-08', lastDay: '2026-10-08', seriesAt: null, seriesDay: null, twoDaysAt: null, namedAt: null, checks: 0, peekDay: '2026-10-08', wasTwoDays: false, cleanOkAt: null } }];
    renderPage(loaded(data));
    expect(screen.getByRole('heading', { level: 2, name: 'Сегодня экзамен' })).toBeInTheDocument();
    const pill = screen.getByRole('link', { name: nm('Пройтись по ошибкам: 20') });
    expect(pill.getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?s=${SUBJECT_DB}&only=errors`);
    expect(pill).toHaveClass('sf-primary');
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
    expect(screen.queryByRole('link', { name: nm('20 вопросов, где были ошибки') })).toBeNull();
    const move = screen.getByRole('button', { name: 'Перенести экзамен' });
    expect(move).toHaveClass('sf-link');
    expect(move).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('exam today without errors: no pill, only the quiet «Перенести экзамен»', () => {
    const base = summary({ exam_date: '2026-10-10', subjects: summary().subjects.map((s) => ({ ...s, exam_date: '2026-10-10' })) });
    const plan = dayPlan({ state: 'exam_today', sessions: [], lines: [{ key: 'exam_today', n: [0] }] });
    renderPage(loaded(containerData({ summary: base, plan })));
    expect(document.querySelector('.sf-primary')).toBeNull();
    expect(screen.getByRole('button', { name: 'Перенести экзамен' })).toHaveClass('sf-link');
  });

  // Release 47: «Поставить новую дату» (a link to «Настройки», where a member could not change it) became the blue pill
  // «Перенести экзамен», for the author and for a member.
  it('exam passed: the meta says so, the figure stays, the blue pill «Перенести экзамен» and a quiet «Удалить экзамен»', () => {
    const base = summary({ exam_date: '2026-10-05', subjects: summary().subjects.map((s) => ({ ...s, exam_date: '2026-10-05' })) });
    const plan = dayPlan({ state: 'after', sessions: [], lines: [{ key: 'after', day: '2026-10-05' }] });
    renderPage(loaded(containerData({ summary: base, plan })));
    expect(page()).toContain('Экзамен прошёл 5 октября');
    expect(screen.getByRole('region', { name: 'верно в два разных дня' }).textContent).toContain('143');
    expect(screen.queryByRole('link', { name: 'Поставить новую дату' })).toBeNull();
    const pill = screen.getByRole('button', { name: 'Перенести экзамен' });
    expect(pill).toHaveClass('sf-primary');
    expect(document.querySelectorAll('.sf-primary')).toHaveLength(1);
    expect(screen.getByRole('link', { name: 'Удалить экзамен' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/settings#delete`);
  });

  it('offline: the page draws from the device and says so in one line', () => {
    renderPage(loaded(containerData(), { offline: true }));
    expect(page()).toContain('Нет сети. Вопросы на сегодня сохранены, заниматься можно.');
  });

  it('oral questions without lectures: one line with «Добавить лекции» into the oral editor, back by from=c:', () => {
    const base = summary({ subjects: [...summary().subjects, subject({ id: SUBJECT_ORAL, position: 5, title: 'Гражданское право', keyed: 0, seen: 0, two_days: 0, open_errors: 0, topics: [], topic_titles: [], oral: { exam_id: ORAL_EXAM, questions: 60 } })] });
    renderPage(loaded(containerData({ summary: base, oralWithoutPoints: 60 })));
    expect(page()).toContain('Ещё 60 устных войдут в план, когда к предмету будут лекции.');
    expect(screen.getByRole('link', { name: 'Добавить лекции' }).getAttribute('href')).toBe(`/exams/${ORAL_EXAM}/edit?from=c:${CONTAINER}#lectures`);
    const row = screen.getByRole('link', { name: /Гражданское право/ });
    expect(plain(row.textContent)).toContain('60 устных · нужны лекции');
    expect(row.getAttribute('href')).toBe(`/exams/${ORAL_EXAM}?from=c:${CONTAINER}`);
  });

  describe('an exam with an oral part (usability check 2026-10-10, m6, m7)', () => {
    // The QA's exam: an oral exam of 20 questions, 16 of them in the plan (4 wait for lectures), and questions with
    // variants; today 16 new and 16 oral, about 30 minutes.
    const oralSubject = subject({ id: SUBJECT_ORAL, position: 1, title: 'Гражданское право', keyed: 0, seen: 0, two_days: 0, open_errors: 0, topics: [], topic_titles: [], oral: { exam_id: ORAL_EXAM, questions: 20 } });
    const oralItems = Array.from({ length: 16 }, (_, i) => ({ id: `o-${i}`, s: SUBJECT_ORAL, f: 'o' as const, tp: null, o: i + 1, l: [], m: { sc: null, rating: 0 as const, ac: null, prepared: false } }));
    const qaPlan = () =>
      dayPlan({
        sessions: [
          { subjectId: SUBJECT_ORAL, kind: 'self_check', ids: oralItems.slice(0, 10).map((entry) => entry.id), estSec: 600 },
          { subjectId: SUBJECT_ORAL, kind: 'self_check', ids: oralItems.slice(10).map((entry) => entry.id), estSec: 360 },
          { subjectId: SUBJECT_DB, kind: 'answer', ids: dbItems().map((entry) => entry.id), estSec: 840 },
        ],
        counts: { newItems: 5, reviews: 0, oral: 16, aiChecks: 0, estSec: 1800, leftSec: 1800, doneSec: 0 },
        perSubject: [
          { subjectId: SUBJECT_ORAL, estSec: 960, items: 16, figure: { inPlan: 16, twoDays: 0, seen: 1, errors: 0 } },
          ...dayPlan().perSubject,
        ],
        lines: [{ key: 'short', n: [30, 700, 976, 60], day: '2026-10-28' }],
      });
    const qaData = () => {
      const data = containerData({ summary: summary({ subjects: [oralSubject, ...summary().subjects.map((s) => ({ ...s, position: s.position + 1 }))] }), plan: qaPlan(), oralWithoutPoints: 4 });
      data.planInput.items = [...data.planInput.items, ...oralItems];
      data.planInput.subjects = [{ id: SUBJECT_ORAL, title: 'Гражданское право', date: '2026-10-28' }, ...data.planInput.subjects];
      data.planInput.budgetMin = 30;
      return data;
    };

    it('the oral subject’s row says «устный», as «Настройки» does (m7)', () => {
      renderPage(loaded(qaData()));
      const row = document.querySelector<HTMLAnchorElement>(`a.ct-row[href="/exams/${ORAL_EXAM}?from=c:${CONTAINER}"]`);
      expect(plain(row?.textContent)).toBe('Гражданское правоустный · видели 1 из 16 · сегодня 16');
      expect(page()).toContain('Ещё 4 устных войдут в план, когда к предмету будут лекции.');
      // the exam's one size: 960 with variants and 20 oral
      expect(page()).toContain('980 вопросов');
    });

    it('«План по дням»: today at the card’s minutes, the days with oral questions say so (m6, m7)', () => {
      renderPage(loaded(qaData()));
      expect(page()).toContain('Сегодня 21 вопрос, около 30 минут');
      fireEvent.click(screen.getByRole('button', { name: 'План по дням' }));
      const rows = Array.from(screen.getByRole('dialog', { name: 'План по дням' }).querySelectorAll('li')).map((node) => plain(node.textContent));
      expect(rows[0]).toBe('Время в день: 45 минут · Изменить');
      expect(rows[1]).toBe('10 октября — около 30 минут, с устными');
      expect(rows[2]).toMatch(/^11–23 октября — около \d+ минут в день, с устными$/);
      expect(rows[3]).toBe('24–27 октября — новых нет, только знакомые, с устными, сначала ошибки');
      expect(rows[4]).toBe('28 октября — экзамен');
    });

    it('what the minutes reach names its count «в плане»: the exam says 980, the plan holds 976 (m6)', () => {
      renderPage(loaded(qaData()));
      expect(page()).toContain('При 30 минутах к 28 октября вы увидите около 700 из 976 в плане. Чтобы увидеть все, нужно около 60 минут.');
    });
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
    // A bank of 960 questions, so the study days take the day's whole 45 minutes (plan.ts daysAhead).
    const bank = Array.from({ length: 960 }, (_, i) => item({ id: `b${i}`, subject_id: [SUBJECT_CS, SUBJECT_DB, SUBJECT_NET, SUBJECT_OS][i % 4], position: i + 1 }));
    renderPage(loaded(containerData({ items: bank })));
    fireEvent.click(screen.getByRole('button', { name: 'План по дням' }));
    const dialog = screen.getByRole('dialog', { name: 'План по дням' });
    const text = plain(dialog.textContent);
    expect(text).toContain('Время в день: 45 минут');
    expect(within(dialog).getByRole('link', { name: 'Изменить' }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/settings#minutes`);
    expect(text).toContain('10–23 октября — около 45 минут в день');
    expect(text).toContain('24–27 октября — новых нет, только знакомые, сначала ошибки');
    expect(text).toContain('28 октября — экзамен');
    expect(text).toContain('Если пропустите день, его вопросы перейдут на следующие.');
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('«Перенести экзамен» on the exam page (release 47)', () => {
  const passedSummary = (over: Parameters<typeof summary>[0] = {}) =>
    summary({ exam_date: '2026-10-05', subjects: summary().subjects.map((s) => ({ ...s, exam_date: '2026-10-05' })), ...over });
  const afterPlan = () => dayPlan({ state: 'after', sessions: [], lines: [{ key: 'after', day: '2026-10-05' }] });

  it('the author without members moves the exam for everyone; the page reads its data again and says the new date', async () => {
    const state = loaded(containerData({ summary: passedSummary(), plan: afterPlan() }));
    renderPage(state);
    const pill = screen.getByRole('button', { name: 'Перенести экзамен' });
    pill.focus();
    fireEvent.click(pill);
    const dialog = screen.getByRole('dialog', { name: 'Перенести экзамен' });
    // The first choice has the focus; no «Для кого» without members.
    expect(document.activeElement).toBe(within(dialog).getByRole('radio', { name: /Через неделю/ }));
    expect(within(dialog).queryByRole('group', { name: 'Для кого' })).toBeNull();
    fireEvent.click(within(dialog).getByRole('radio', { name: (name) => plain(name).startsWith('Через 2 недели') }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Перенести' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(mocks.moveExamDate).toHaveBeenCalledWith(CONTAINER, '2026-10-24', 'all', null);
    expect(state.reload).toHaveBeenCalledTimes(1);
    const line = screen.getByRole('status');
    expect(plain(line.textContent)).toBe('Экзамен перенесён на 24 октября.');
    await waitFor(() => expect(document.activeElement).toBe(line));
  });

  it('the author with members chooses «Для всех участников» or «Только для меня»', async () => {
    const base = passedSummary({ owner: { members: 3, doubts_open: 0, links: [] } });
    renderPage(loaded(containerData({ summary: base, plan: afterPlan() })));
    fireEvent.click(screen.getByRole('button', { name: 'Перенести экзамен' }));
    const who = screen.getByRole('group', { name: 'Для кого' });
    expect(within(who).getByRole('radio', { name: 'Для всех участников' })).toBeChecked();
    fireEvent.click(within(who).getByRole('radio', { name: 'Только для меня' }));
    fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));
    await waitFor(() => expect(mocks.moveExamDate).toHaveBeenCalledWith(CONTAINER, '2026-10-17', 'me', null));
  });

  it('a member moves only their own date and is told the author’s stays', async () => {
    const base = passedSummary({ role: 'member', owner: null });
    renderPage(loaded(containerData({ summary: base, plan: afterPlan() })));
    expect(screen.queryByRole('link', { name: 'Удалить экзамен' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Перенести экзамен' }));
    const dialog = screen.getByRole('dialog', { name: 'Перенести экзамен' });
    expect(within(dialog).queryByRole('group', { name: 'Для кого' })).toBeNull();
    expect(plain(dialog.textContent)).toContain('Это ваша дата. У автора остаётся 5 октября.');
    fireEvent.click(within(dialog).getByRole('radio', { name: /Через месяц/ }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Перенести' }));
    await waitFor(() => expect(mocks.moveExamDate).toHaveBeenCalledWith(CONTAINER, '2026-11-10', 'me', null));
  });

  it('a refusal is said in the dialog, which stays open', async () => {
    const { ContainerApiError } = await import('../../api/containers');
    mocks.moveExamDate.mockRejectedValueOnce(new ContainerApiError('42501', 'Это может сделать только автор экзамена.'));
    const state = loaded(containerData({ summary: passedSummary(), plan: afterPlan() }));
    renderPage(state);
    fireEvent.click(screen.getByRole('button', { name: 'Перенести экзамен' }));
    fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Это может сделать только автор экзамена.');
    expect(screen.getByRole('dialog', { name: 'Перенести экзамен' })).toBeInTheDocument();
    expect(state.reload).not.toHaveBeenCalled();
  });

  it('on a phone the pill is in the bar at the bottom', () => {
    renderPage(loaded(containerData({ summary: passedSummary(), plan: afterPlan() })), { phone: true });
    const bar = document.querySelector('.ct-cta') as HTMLElement;
    expect(within(bar).getByRole('button', { name: 'Перенести экзамен' })).toHaveClass('sf-primary');
  });

  it('on the exam’s day the quiet «Перенести экзамен» opens the same dialog', async () => {
    const base = summary({ exam_date: '2026-10-10', subjects: summary().subjects.map((s) => ({ ...s, exam_date: '2026-10-10' })) });
    const plan = dayPlan({ state: 'exam_today', sessions: [], lines: [{ key: 'exam_today', n: [0] }] });
    renderPage(loaded(containerData({ summary: base, plan })));
    fireEvent.click(screen.getByRole('button', { name: 'Перенести экзамен' }));
    fireEvent.click(screen.getByRole('button', { name: 'Перенести' }));
    await waitFor(() => expect(mocks.moveExamDate).toHaveBeenCalledWith(CONTAINER, '2026-10-17', 'all', null));
  });
});

describe('the days of the week (settings.study_weekdays)', () => {
  // A bank of 960 questions; Пн–Пт; today is Saturday 10 October: a day off.
  const bank = () => Array.from({ length: 960 }, (_, i) => item({ id: `b${i}`, subject_id: [SUBJECT_CS, SUBJECT_DB, SUBJECT_NET, SUBJECT_OS][i % 4], position: i + 1 }));
  const dayOff = () => dayPlan({ state: 'nothing', sessions: [], lines: [{ key: 'day_off', n: [2], day: '2026-10-12' }, { key: 'more_new', n: [20] }] });

  it('a day off: the plan’s line with the next study day, «Ещё 20 новых», no blue pill', () => {
    renderPage(loaded(containerData({ items: bank(), plan: dayOff(), input: { studyWeekdays: 31 } })), { phone: true });
    expect(page()).toContain('Сегодня выходной. Следующие вопросы — в понедельник.');
    expect(screen.getByRole('link', { name: nm('Ещё 20 новых') }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?s=${SUBJECT_CS}&only=new`);
    expect(document.querySelector('.sf-primary')).toBeNull();
    // the day off is the card's title, never one of its notes
    expect(Array.from(document.querySelectorAll('.ct-plan-notes .ct-note')).map((node) => plain(node.textContent))).not.toContain('Сегодня выходной. Следующие вопросы — в понедельник.');
  });

  it('«План по дням» on a day off: the study days, no row for a day off, «Изменить» to the days in «Настройки»', () => {
    renderPage(loaded(containerData({ items: bank(), plan: dayOff(), input: { studyWeekdays: 31 } })));
    fireEvent.click(screen.getByRole('button', { name: 'План по дням' }));
    const dialog = screen.getByRole('dialog', { name: 'План по дням' });
    const rows = Array.from(dialog.querySelectorAll('li')).map((node) => plain(node.textContent));
    expect(rows).toEqual([
      'Время в день: 45 минут · Изменить',
      'Дни занятий: Пн–Пт · Изменить',
      '12–21 октября — около 45 минут в день',
      '22–27 октября — новых нет, только знакомые, сначала ошибки',
      '28 октября — экзамен',
    ]);
    expect(within(dialog).getAllByRole('link', { name: 'Изменить' }).map((link) => link.getAttribute('href'))).toEqual([
      `/exams/c/${CONTAINER}/settings#minutes`,
      `/exams/c/${CONTAINER}/settings#days`,
    ]);
  });

  it('every day: no row of days in «План по дням»', () => {
    renderPage(loaded(containerData({ items: bank() })));
    fireEvent.click(screen.getByRole('button', { name: 'План по дням' }));
    expect(plain(screen.getByRole('dialog', { name: 'План по дням' }).textContent)).not.toContain('Дни занятий');
  });
});

describe('a one-subject exam is its subject page (decision 44)', () => {
  it('has the exam’s name, the topics as rows and the exam’s «⋯» with «Удалить»', () => {
    renderPage(loaded(containerData({ summary: summary({ subjects: [subject({ id: SUBJECT_DB, title: 'Базы данных' })] }) })), { phone: true });
    expect(screen.getByRole('heading', { level: 1, name: 'Аккредитация' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Темы' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Ещё: экзамен' }));
    const items = within(screen.getByRole('menu')).getAllByRole('menuitem').map((node) => plain(node.textContent));
    expect(items).toEqual(['Пригласить группу', 'Вопросы и ключи', 'Студия', 'Контрольные', 'Время в день', 'Добавить предмет', 'Настройки', 'Удалить']);
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
