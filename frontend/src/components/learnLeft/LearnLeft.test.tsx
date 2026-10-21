import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PlanItem, UnitState } from '../../types/container';
import { buildTopics, type LearnLeftExam, type LearnLeftQuestion } from '../../lib/containers/topics';
import LearnLeft from './LearnLeft';
import TopicClosed from './TopicClosed';

afterEach(cleanup);

const NOW = Date.UTC(2026, 9, 21, 12);
const plain = (value: string | null | undefined) => (value ?? '').replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

function q(position: number, extra: Partial<LearnLeftQuestion> = {}): LearnLeftQuestion {
  return { id: `q${position}`, position, label: String(position), section: null, lecture: null, kind: 'lines', state: 0, named: 0, of: 3,
    learnedAt: null, readyAt: null, missed: false, ...extra };
}

/** B's «Базы данных» in a later state: one lecture learned, SQL half done, 8 and 16 in no lecture. */
function databases(): LearnLeftExam {
  const lecture = (p: number) => (p <= 6 ? 0 : [7, 9, 10, 11, 12, 19].includes(p) ? 1 : 2);
  return {
    examId: 'e1', title: 'Базы данных', mappingState: 'done', sectionTitles: [], toWrite: 0, units: 0,
    lectures: [
      { id: 'l1', title: 'Реляционная модель данных: ключи и связи' },
      { id: 'l2', title: 'Язык SQL: выборка данных и оператор SELECT' },
      { id: 'l3', title: 'Нормализация отношений и свойства транзакций ACID' },
    ],
    questions: Array.from({ length: 20 }, (_, i) => {
      const p = i + 1;
      if (p === 8 || p === 16) return q(p, { kind: 'none', of: 0 });
      const learned = p <= 6 || [7, 9, 11, 12].includes(p) || p === 13;
      return q(p, {
        lecture: lecture(p),
        state: learned ? 3 : p === 10 ? 2 : p === 14 || p === 15 ? 1 : 0,
        named: p === 10 ? 3 : p === 14 ? 1 : 0,
        learnedAt: learned ? Date.UTC(2026, 9, 19, 9) : null,
        readyAt: p === 10 ? NOW + 3_600_000 : null,
      });
    }),
  };
}

function renderCard(props: Partial<Parameters<typeof LearnLeft>[0]> = {}) {
  const list = props.list === undefined ? buildTopics({ oral: databases() }) : props.list;
  return render(
    <MemoryRouter>
      <LearnLeft
        list={list}
        status="ready"
        now={NOW}
        tz="Europe/Minsk"
        answerHref={(question) => `/exams/e1/ticket?q=${question.id}`}
        questionText={(question) => `Текст вопроса ${question.n}`}
        lecturesHref="/exams/e1/edit#lectures"
        {...props}
      />
    </MemoryRouter>,
  );
}

describe('LearnLeft: the oral exam\'s card', () => {
  it('says how many topics are left, the open ones first with a segment per question', () => {
    renderCard();
    const card = screen.getByRole('region', { name: 'Осталось выучить' });
    expect(plain(within(card).getByText('2').closest('p')?.textContent)).toBe('2 темы из 3');
    const sql = within(card).getByRole('button', { name: /Язык SQL/ });
    expect(plain(sql.textContent)).toContain('Осталось 2 вопроса из 6');
    // One segment per question: 4 learned, one started (10), one not yet (19).
    const segments = sql.querySelectorAll('.ll-segs i');
    expect([...segments].map((s) => s.getAttribute('data-s'))).toEqual(['done', 'done', 'started', 'done', 'done', 'none']);
  });

  it('a computer opens the first open oral topic with its questions left and «Ответить»', () => {
    renderCard();
    const sql = screen.getByRole('button', { name: /Язык SQL/ });
    expect(sql).toHaveAttribute('aria-expanded', 'true');
    const answer = screen.getByRole('link', { name: 'Ответить на вопрос 10' });
    expect(answer).toHaveAttribute('href', '/exams/e1/ticket?q=q10');
    expect(plain(answer.closest('li')?.textContent)).toContain('Ответ полный. Ответьте ещё раз в другой день, и вопрос выучен.');
    expect(screen.getByText('Текст вопроса 19')).toBeInTheDocument();
    // The other open topic stays folded; a tap opens it.
    const acid = screen.getByRole('button', { name: /Нормализация/ });
    expect(acid).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(acid);
    expect(acid).toHaveAttribute('aria-expanded', 'true');
    expect(plain(screen.getByRole('link', { name: 'Ответить на вопрос 14' }).closest('li')?.textContent)).toContain('В ответе 1 главный пункт из 3.');
  });

  it('a phone keeps every row folded', () => {
    renderCard({ phone: true });
    for (const row of screen.getAllByRole('button', { name: /Язык SQL|Нормализация/ })) expect(row).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('link', { name: /Ответить/ })).toBeNull();
  });

  it('folds the closed topics into one row with their dates', () => {
    renderCard();
    const fold = screen.getByRole('button', { name: /Выучена\s1\sтема/ });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Реляционная модель данных: ключи и связи')).toBeNull();
    fireEvent.click(fold);
    const row = screen.getByText('Реляционная модель данных: ключи и связи').closest('li');
    expect(plain(row?.textContent)).toContain('выучена 19 октября');
  });

  it('names what is not counted, with the way to lectures, and the rule behind «Как считается»', () => {
    renderCard();
    const note = screen.getByText(/не считаем/);
    expect(plain(note.textContent)).toBe('Вопросы 8 и 16 не считаем, их нет в лекциях. Добавить лекции');
    expect(within(note).getByRole('link', { name: 'Добавить лекции' })).toHaveAttribute('href', '/exams/e1/edit#lectures');
    const how = screen.getByRole('button', { name: 'Как считается' });
    fireEvent.click(how);
    expect(screen.getByText(/Устный вопрос выучен, когда вы сами назвали все его главные пункты/)).toBeInTheDocument();
    expect(screen.getByText('Темы взяты из лекций, в которых есть ответ.')).toBeInTheDocument();
  });

  it('holds its place with a quiet card while it loads, says so when it failed', () => {
    const { unmount } = renderCard({ list: null, status: 'loading' });
    expect(screen.getByRole('region', { name: 'Осталось выучить' })).toHaveAttribute('aria-busy', 'true');
    expect(document.querySelector('.ll-skel')).not.toBeNull();
    unmount();
    const retry = vi.fn();
    renderCard({ list: null, status: 'error', onRetry: retry });
    fireEvent.click(screen.getByRole('button', { name: 'Попробовать ещё раз' }));
    expect(retry).toHaveBeenCalled();
  });

  it('no lectures: one line and «Добавить лекции»', () => {
    renderCard({ list: buildTopics({ oral: { ...databases(), lectures: [], questions: [q(1, { kind: 'unmapped' })] } }) });
    expect(screen.getByText(/Темы появятся, когда к экзамену будут лекции/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Добавить лекции' })).toBeInTheDocument();
  });

  it('every topic learned: the words say it, the fold keeps them', () => {
    const done = databases();
    renderCard({ list: buildTopics({ oral: { ...done, questions: done.questions.map((x) => (x.kind === 'lines' ? { ...x, state: 3, learnedAt: Date.UTC(2026, 9, 19) } : x)) } }) });
    expect(screen.getByText(/Все темы выучены/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Выучены\s3\sтемы/ })).toBeInTheDocument();
  });
});

describe('LearnLeft: a subject\'s test topics', () => {
  const unit = (done: boolean): UnitState => ({ seen: done ? 2 : 0, wrong: 0, firstDay: null, lastDay: null, seriesAt: null, seriesDay: null,
    twoDaysAt: done ? NOW - 86_400_000 : null, namedAt: null, checks: 0, peekDay: null, wasTwoDays: false, cleanOkAt: null });
  const items: PlanItem[] = [
    ...Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, s: 's', f: 't' as const, tp: 1, o: i + 1, u: unit(i < 5) })),
    ...Array.from({ length: 20 }, (_, i) => ({ id: `b${i}`, s: 's', f: 't' as const, tp: 2, o: i + 21, u: unit(false) })),
  ];

  it('a tap on a test topic opens its sheet', () => {
    const open = vi.fn();
    renderCard({ list: buildTopics({ subjectId: 's', items, titles: ['Тема 1.1. Типы данных', 'Тема 1.2. Операторы'] }), onOpenTopic: open });
    fireEvent.click(screen.getByRole('button', { name: /Тема 1.2. Операторы/ }));
    expect(open).toHaveBeenCalledWith(expect.objectContaining({ testTopic: 2 }));
    expect(plain(screen.getByRole('button', { name: /Тема 1.1/ }).textContent)).toContain('Осталось 15 вопросов из 20');
    expect(plain(screen.getByRole('button', { name: /Тема 1.2/ }).textContent)).toContain('20 вопросов, ещё не начинали');
    expect(plain(screen.getByText('2').closest('p')?.textContent)).toBe('2 темы из 2');
  });
});

describe('TopicClosed: the end of a session', () => {
  it('the ribbon, the topic, its full bar, what is left and the nearest topic', () => {
    const unit = (done: boolean): UnitState => ({ seen: 1, wrong: 0, firstDay: null, lastDay: null, seriesAt: null, seriesDay: null,
      twoDaysAt: done ? NOW : null, namedAt: null, checks: 0, peekDay: null, wasTwoDays: false, cleanOkAt: null });
    const items: PlanItem[] = [
      ...Array.from({ length: 20 }, (_, i) => ({ id: `a${i}`, s: 's', f: 't' as const, tp: 1, o: i + 1, u: unit(true) })),
      ...Array.from({ length: 5 }, (_, i) => ({ id: `b${i}`, s: 's', f: 't' as const, tp: 2, o: i + 21, u: unit(i < 2) })),
    ];
    const topics = buildTopics({ subjectId: 's', items, titles: ['Тема 1.2. Операторы и выражения', 'Тема 1.4. Массивы и коллекции'] }).topics;
    render(<TopicClosed closed={[topics[0]]} left={1} total={2} near={topics[1]} />);
    expect(screen.getByText('Тема выучена')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Тема 1.2. Операторы и выражения' })).toBeInTheDocument();
    expect(document.querySelectorAll('.ll-won-segs i')).toHaveLength(20);
    expect(plain(screen.getByText(/Все 20/).textContent)).toBe('Все 20 вопросов выучены.');
    expect(plain(screen.getByText(/Осталась/).textContent)).toBe('Осталась 1 тема из 2. Почти готова тема «Массивы и коллекции», в ней ещё 3 вопроса.');
  });
});
