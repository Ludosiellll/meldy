import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, loading: false }) }));

import TodayExamCard, { type TodayExamCardProps } from './TodayExamCard';
import { PHONE_QUERY } from '../../lib/usePhone';
import { saveSession } from './sessionStore';
import { CONTAINER, ORAL_EXAM, SUBJECT_CS, SUBJECT_ORAL, dayPlan, overviewContainer } from './testkit/fixtures';

const NB = String.fromCharCode(0xa0);
const plain = (text: string | null | undefined) => (text ?? '').split(NB).join(' ');
const nm = (text: string) => (name: string) => plain(name) === text;

function setPhone(phone: boolean) {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: phone
      ? (query: string) => ({
          matches: query === PHONE_QUERY,
          media: query,
          onchange: null,
          addEventListener: () => undefined,
          removeEventListener: () => undefined,
          addListener: () => undefined,
          removeListener: () => undefined,
          dispatchEvent: () => false,
        })
      : undefined,
  });
}

function renderCard(props: Partial<TodayExamCardProps> = {}, phone = false) {
  setPhone(phone);
  return render(
    <MemoryRouter>
      <div className="sf-page td">
        <TodayExamCard container={overviewContainer()} plan={dayPlan()} lead {...props} />
      </div>
    </MemoryRouter>,
  );
}

const card = () => screen.getByRole('article');
const text = () => plain(card().textContent);

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('the «Сегодня» card of an exam (decision 47)', () => {
  it('has today’s oral card anatomy: flag, name, one meta line, today’s step, the blue pill, then the blue number', () => {
    renderCard();
    expect(screen.getByRole('heading', { level: 2 }).textContent).toBe(`Аккредитация — экзамен через 18${NB}дней`.replace(NB, ' '));
    const flag = card().querySelector('.td-flag')!;
    expect(flag.textContent).toBe('Экзамен через 18 дней');
    expect(flag.getAttribute('data-tone')).toBe('g');
    expect(plain(card().querySelector('.td-meta')?.textContent)).toBe('28 октября · 960 вопросов');
    expect(text()).toContain('Сегодня 90 вопросов, около 45 минут.');
    // Two subjects have work today: the pill names the one it starts (usability m3).
    const pill = screen.getByRole('link', { name: nm('Начать: Программирование на C# — 20 вопросов') });
    expect(pill.className).toBe('sf-primary');
    expect(pill.getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?s=${SUBJECT_CS}`);
    const figure = screen.getByRole('link', { name: /143/ });
    expect(plain(figure.textContent)).toBe('143из 960 верно в два разных дня');
    expect(figure.getAttribute('href')).toBe(`/exams/c/${CONTAINER}`);
    // No second «Лист экзамена», no «Видели N из M».
    expect(text()).not.toContain('Видели');
    expect(screen.getAllByRole('link')).toHaveLength(2);
  });

  it('steps aside when another card leads: a white pill on a computer, a quiet link on a phone', () => {
    renderCard({ lead: false });
    expect(screen.getByRole('link', { name: nm('Начать: Программирование на C# — 20 вопросов') }).className).toBe('sf-secondary td-pill');
    cleanup();
    renderCard({ lead: false }, true);
    expect(screen.getByRole('link', { name: nm('Начать: Программирование на C# — 20 вопросов') }).className).toBe('sf-link td-alt');
    expect(card().getAttribute('data-phone')).toBe('');
  });

  it('one subject with work today: the pill says the count and, on a computer, the minutes, without the subject', () => {
    const one = dayPlan();
    renderCard({ plan: { ...one, sessions: one.sessions.slice(0, 1) } });
    expect(screen.getByRole('link', { name: nm('Начать: 20 вопросов, около 9 минут') }).className).toBe('sf-primary');
    cleanup();
    renderCard({ plan: { ...one, sessions: one.sessions.slice(0, 1) } }, true);
    expect(screen.getByRole('link', { name: nm('Начать: 20 вопросов') })).toBeTruthy();
  });

  it('while the plan loads: the card and its numbers from the overview, no pill yet', () => {
    renderCard({ plan: null });
    expect(text()).toContain('Считаем план на сегодня…');
    expect(screen.queryByRole('link', { name: /Начать/ })).toBeNull();
    expect(screen.getByRole('link', { name: /143/ })).toBeInTheDocument();
  });

  it('the day done: the plan’s line and no pill, so «Начать повторение» can take the blue', () => {
    renderCard({ plan: dayPlan({ state: 'done', sessions: [], lines: [{ key: 'done', n: [90, 47] }] }) });
    expect(text()).toContain('На сегодня всё: 90 вопросов за 47 минут.');
    expect(document.querySelector('.sf-primary')).toBeNull();
  });

  it('a day off (not one of the student’s days of the week): the plan’s line with the next study day, no pill', () => {
    renderCard({ plan: dayPlan({ state: 'nothing', sessions: [], lines: [{ key: 'day_off', n: [2], day: '2026-10-12' }, { key: 'more_new', n: [20] }] }) });
    expect(text()).toContain('Сегодня выходной. Следующие вопросы — в понедельник.');
    expect(card().querySelector('.sf-primary, .sf-secondary')).toBeNull();
  });

  it('the first day before any answer: the rule as the link, no zeros', () => {
    renderCard({ plan: dayPlan({ figure: { inPlan: 960, twoDays: 0, seen: 0, errors: 0, selfKnow: 0 } }) });
    const rule = screen.getByRole('link', { name: (name) => plain(name).startsWith('В счёт идёт вопрос') });
    expect(plain(rule.textContent)).toBe('В счёт идёт вопрос, на который вы ответили верно в два разных дня');
    expect(text()).not.toMatch(/\b0 из/);
    expect(text()).not.toContain('Видели');
  });

  it('answered, nothing counts yet: the plan’s dated line as the link (decision 40)', () => {
    renderCard({
      plan: dayPlan({
        figure: { inPlan: 960, twoDays: 0, seen: 60, errors: 9, selfKnow: 0 },
        firstCountDay: '2026-10-11',
        lines: [{ key: 'first_count', n: [1], day: '2026-10-11', time: '17:00' }],
      }),
    });
    expect(plain(screen.getByRole('link', { name: (name) => plain(name).startsWith('Первые') }).textContent)).toBe('Первые войдут в счёт завтра после 17:00 — если снова ответите верно');
    expect(text()).not.toContain('Видели 60');
  });

  it('three days or less: a yellow flag', () => {
    renderCard({ container: overviewContainer({ exam_date: '2026-10-11', subjects: overviewContainer().subjects.map((s) => ({ ...s, exam_date: '2026-10-11' })) }) });
    const flag = card().querySelector('.td-flag')!;
    expect(flag.textContent).toBe('Экзамен завтра');
    expect(flag.getAttribute('data-tone')).toBe('y');
  });

  it('without network: one quiet line', () => {
    renderCard({ offline: true });
    expect(text()).toContain('Нет сети. Вопросы на сегодня сохранены, заниматься можно.');
  });

  it('a session left today: «Продолжить: ещё 8 вопросов»', () => {
    saveSession('user-1', {
      v: 1,
      id: 'session-1',
      containerId: CONTAINER,
      day: '2026-10-10',
      subjectId: SUBJECT_CS,
      kind: 'answer',
      topic: null,
      only: null,
      queue: Array.from({ length: 20 }, (_, i) => ({ id: `x${i}`, retry: 0 as const })),
      pos: 12,
      startedAt: Date.now(),
      records: [],
    });
    renderCard();
    expect(screen.getByRole('link', { name: nm('Продолжить: ещё 8 вопросов') }).getAttribute('href')).toBe(`/exams/c/${CONTAINER}/study?resume=1`);
  });

  it('says the exam’s one size, oral questions included, as its page does (usability check 2026-10-10, m6)', () => {
    // The QA's exam: 34 questions with variants and an oral exam of 20 — its page said 54, this card 34.
    const container = overviewContainer({
      items: 34,
      exam_date: '2026-10-21',
      subjects: [{ ...overviewContainer().subjects[0], id: SUBJECT_ORAL, title: 'Базы данных', exam_date: '2026-10-21', keyed: 0, oral_exam_id: ORAL_EXAM, has_oral: true }],
    });
    renderCard({ container, questions: 54 });
    expect(plain(card().querySelector('.td-meta')?.textContent)).toBe('21 октября · 54 вопроса');
    cleanup();
    // before its page's numbers are read: the date alone, never the smaller number of the overview
    renderCard({ container, plan: null });
    expect(plain(card().querySelector('.td-meta')?.textContent)).toBe('21 октября');
    cleanup();
    // without an oral part the overview's number is the size, as before
    renderCard({ plan: null });
    expect(plain(card().querySelector('.td-meta')?.textContent)).toBe('28 октября · 960 вопросов');
  });

  it('an AI check first: one ticket of the oral exam with the way back', () => {
    const container = overviewContainer({
      subjects: [...overviewContainer().subjects, { ...overviewContainer().subjects[0], id: SUBJECT_ORAL, title: 'Право', oral_exam_id: ORAL_EXAM, has_oral: true }],
    });
    renderCard({ container, plan: dayPlan({ sessions: [{ subjectId: SUBJECT_ORAL, kind: 'ai_check', ids: ['a', 'b', 'c'], estSec: 450 }] }) });
    expect(screen.getByRole('link', { name: nm('Ответить вслух: 3 вопроса') }).getAttribute('href')).toBe(`/exams/${ORAL_EXAM}/ticket?q=a,b,c&from=c:${CONTAINER}`);
  });
});

describe('«Перенести» on the exam’s own day (release 47)', () => {
  const examToday = () => {
    const subjects = overviewContainer().subjects.map((entry) => ({ ...entry, exam_date: '2026-10-10' }));
    return overviewContainer({ exam_date: '2026-10-10', subjects });
  };
  const todayPlan = () => dayPlan({ state: 'exam_today', sessions: [], lines: [{ key: 'exam_today', n: [3] }, { key: 'exam_errors', n: [3] }] });

  it('a quiet «Перенести» beside the day’s line; «Сегодня» opens the dialog', () => {
    const onMove = vi.fn();
    renderCard({ container: examToday(), plan: todayPlan(), onMove });
    expect(text()).toContain('Сегодня экзамен.');
    const move = screen.getByRole('button', { name: 'Перенести' });
    expect(move).toHaveClass('sf-link');
    expect(move).toHaveAttribute('aria-haspopup', 'dialog');
    expect(card().querySelector('.sf-primary')).toBeNull();
    fireEvent.click(move);
    expect(onMove).toHaveBeenCalledTimes(1);
  });

  it('no «Перенести» on a study day, while the plan loads, or without a way to open the dialog', () => {
    const onMove = vi.fn();
    renderCard({ onMove });
    expect(screen.queryByRole('button', { name: 'Перенести' })).toBeNull();
    cleanup();
    renderCard({ container: examToday(), plan: null, onMove });
    expect(screen.queryByRole('button', { name: 'Перенести' })).toBeNull();
    cleanup();
    renderCard({ container: examToday(), plan: todayPlan() });
    expect(screen.queryByRole('button', { name: 'Перенести' })).toBeNull();
  });
});
