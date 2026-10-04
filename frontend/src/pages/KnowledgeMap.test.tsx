import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import KnowledgeMap from './KnowledgeMap';
import { sampleRows, type SampleRows } from '../components/knowledge/sampleCourse';

const api = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: { from: api.from } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));

type Tables = Partial<Record<keyof SampleRows | string, Array<Record<string, unknown>>>>;
let tables: Tables;
let failing: Set<string>;

/** A Supabase query builder: every filter returns itself, awaiting it gives the table's rows. */
function query(table: string) {
  const result = () => (failing.has(table) ? { data: null, error: { code: 'XX000', message: 'boom' } } : { data: tables[table] ?? [], error: null });
  const chain: Record<string, unknown> = {};
  for (const name of ['select', 'eq', 'in', 'lte', 'gte', 'order', 'limit', 'range', 'is', 'neq']) chain[name] = () => chain;
  chain.maybeSingle = () => Promise.resolve({ ...result(), data: (result().data ?? [])[0] ?? null });
  chain.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(result()).then(resolve, reject);
  return chain;
}

function renderPage(path = '/knowledge-map') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/knowledge-map" element={<KnowledgeMap />} />
        <Route path="/library/:id" element={<p>Страница лекции</p>} />
        <Route path="/exams/:id" element={<p>Лист экзамена открыт</p>} />
        <Route path="/review" element={<p>Повторение открыто</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

async function renderMap() {
  renderPage();
  return screen.findByRole('group', { name: /^Карта связей/ });
}

const card = (name: RegExp) => screen.getByRole('button', { name });
const lectureCards = () => screen.queryAllByRole('button', { name: /^Лекция \d+:/ });
const zoomValue = () => document.querySelector('.km-zoom-v')?.textContent?.replace(/\s+/g, ' ');
const layerTransform = () => (document.querySelector('.km-layer') as HTMLElement | null)?.style.transform;

beforeEach(() => {
  tables = sampleRows(new Date(), 'user-1') as unknown as Tables;
  failing = new Set();
  api.from.mockImplementation((table: string) => query(table));
});

afterEach(() => {
  cleanup();
  document.body.style.overflow = '';
});

describe('KnowledgeMap zoom', () => {
  it('zooms with Ctrl + wheel or a trackpad pinch in proportion to deltaY', async () => {
    const map = await renderMap();

    expect(fireEvent.wheel(map, { deltaY: -10, ctrlKey: true })).toBe(false);
    expect(zoomValue()).toBe('111 %');

    expect(fireEvent.wheel(map, { deltaY: 10, ctrlKey: true })).toBe(false);
    expect(zoomValue()).toBe('100 %');
  });

  it('leaves a plain wheel scroll to the page', async () => {
    const map = await renderMap();

    expect(fireEvent.wheel(map, { deltaY: 120 })).toBe(true);
    expect(zoomValue()).toBe('100 %');
  });

  it('lets a finger scroll the page vertically over the map', async () => {
    const map = await renderMap();

    expect(map).toHaveClass('touch-pan-y');
    expect(map).not.toHaveClass('touch-none');
  });

  it('keeps the chosen zoom when a node, a legend filter or the search changes, until «По размеру»', async () => {
    const user = userEvent.setup();
    await renderMap();

    await user.click(screen.getByRole('button', { name: 'Приблизить' }));
    expect(zoomValue()).toBe('120 %');
    const transform = layerTransform();

    await user.click(card(/^Понятие: Инфляция,/));
    expect(screen.getByRole('heading', { name: 'Инфляция' })).toBeInTheDocument();
    expect(zoomValue()).toBe('120 %');

    await user.click(within(screen.getByRole('list', { name: 'Показать на карте' })).getByRole('button', { name: /не засчитано/ }));
    expect(zoomValue()).toBe('120 %');

    await user.type(screen.getByRole('searchbox', { name: 'Найти лекцию или понятие' }), 'денеж');
    expect(zoomValue()).toBe('120 %');
    expect(layerTransform()).toBe(transform);

    await user.click(screen.getByRole('button', { name: 'По размеру' }));
    expect(zoomValue()).toBe('100 %');
  });
});

describe('what the map shows', () => {
  it('opens on the nearest exam: its lectures as cards, with question numbers and their marks', async () => {
    await renderMap();
    expect(screen.getByText(/Макроэкономика — экзамен .+ через 12 дней · 9 лекций · 14 общих понятий/)).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Экзамен' })).getByRole('button', { name: /Макроэкономика/ })).toHaveAttribute('aria-pressed', 'true');
    expect(lectureCards()).toHaveLength(9);
    // File names become titles; the readiness of each question is said in words.
    const money = card(/^Лекция 3: Деньги и денежный рынок/);
    expect(money).toHaveAccessibleName(/Вопросы экзамена: 6, 7 — подтверждено, 8 — не засчитано, 9/);
    expect(money).toHaveAccessibleName(/1\sоткрытая ошибка, 5\sкарточек к повторению/);
    expect(card(/^Лекция 1: Предмет макроэкономики и ВВП/)).toBeInTheDocument();
    expect(money.querySelector('[data-mark="ring"]')).not.toBeNull();
    expect(money.querySelector('[data-mark="wave"]')).not.toBeNull();
    // The questions that are in no lecture are named under the map.
    expect(screen.getByText('Нет ни в одной лекции: вопросы 23, 24')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Показать на листе' })).toHaveAttribute('href', '/exams/exam-macro?filter=cov:none');
  });

  it('shows the concepts shared by two or more lectures first, and all of them on request', async () => {
    const user = userEvent.setup();
    await renderMap();
    expect(card(/^Понятие: Центральный банк, в\s3\sлекциях/)).toBeInTheDocument();
    expect(card(/^Понятие: Кривая Филлипса, в\s2\sлекциях, есть открытая ошибка/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Понятие: Гиперинфляция/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: /^все/ }));
    expect(card(/^Понятие: Гиперинфляция, в одной лекции/)).toBeInTheDocument();
  });

  it('switches exams, and on all lectures offers the subjects', async () => {
    const user = userEvent.setup();
    await renderMap();
    const exams = screen.getByRole('list', { name: 'Экзамен' });

    await user.click(within(exams).getByRole('button', { name: /Эконометрика/ }));
    expect(lectureCards()).toHaveLength(4);
    expect(screen.queryByRole('list', { name: 'Предмет' })).toBeNull();

    await user.click(within(exams).getByRole('button', { name: /Все лекции/ }));
    expect(lectureCards()).toHaveLength(15);
    const subjects = screen.getByRole('list', { name: 'Предмет' });
    await user.click(within(subjects).getByRole('button', { name: /Без предмета/ }));
    expect(lectureCards().map((element) => element.textContent)).toEqual([
      expect.stringContaining('Международная торговля'),
      expect.stringContaining('Лекция 10 Открытая экономика'),
    ]);
  });

  it('lights the lectures a legend filter is about and fades the others', async () => {
    const user = userEvent.setup();
    await renderMap();
    const button = within(screen.getByRole('list', { name: 'Показать на карте' })).getByRole('button', { name: /не засчитано 3/ });
    await user.click(button);
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(card(/^Лекция 3:/)).toHaveAttribute('data-state', 'lit');
    expect(card(/^Лекция 9:/)).toHaveAttribute('data-state', 'dim');

    await user.click(button);
    expect(card(/^Лекция 9:/)).toHaveAttribute('data-state', 'rest');
  });
});

describe('the panel', () => {
  it('shows a lecture: its exam questions with fragments, concepts, mistakes and the ways on', async () => {
    const user = userEvent.setup();
    await renderMap();
    await user.click(card(/^Лекция 3: Деньги и денежный рынок/));

    const panel = screen.getByRole('region', { name: 'Деньги и денежный рынок' });
    expect(within(panel).getByText('Денежный мультипликатор и денежная база.')).toBeInTheDocument();
    expect(within(panel).getByText(/не засчитано/)).toBeInTheDocument();
    expect(within(panel).getAllByRole('link', { name: /фрагмент/ })[0]).toHaveAttribute('href', '/library/macro-3');
    expect(within(panel).getByRole('button', { name: 'Центральный банк' })).toBeInTheDocument();
    expect(within(panel).getByText(/Почему рост норм обязательных резервов/)).toBeInTheDocument();
    expect(within(panel).getByRole('link', { name: 'Открыть лекцию' })).toHaveAttribute('href', '/library/macro-3');
    expect(within(panel).getByRole('link', { name: /^Повторить 5\sкарточек$/ })).toHaveAttribute('href', '/review?material=macro-3');
    expect(within(panel).getByRole('link', { name: 'Лист экзамена' })).toHaveAttribute('href', '/exams/exam-macro');
    // The old oral exam (/exam) is not a way on any more (redesign spec 5.20).
    expect(document.querySelector('a[href="/exam"]')).toBeNull();
  });

  it('shows a concept: where it appears with each lecture’s definition, and the exam questions with its words', async () => {
    const user = userEvent.setup();
    await renderMap();
    await user.click(card(/^Понятие: Кривая Филлипса/));

    const panel = screen.getByRole('region', { name: 'Кривая Филлипса' });
    expect(within(panel).getByText(/^Встречается в\s2\sлекциях$/)).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Инфляция: причины и последствия' })).toBeInTheDocument();
    expect(within(panel).getByText('Краткосрочная обратная связь инфляции и безработицы.')).toBeInTheDocument();
    expect(within(panel).getByText('Кривая Филлипса в краткосрочном и долгосрочном периоде.')).toBeInTheDocument();
    expect(within(panel).getByText('Как выглядит кривая Филлипса в долгосрочном периоде?')).toBeInTheDocument();

    // A lecture of the list opens on the map.
    await user.click(within(panel).getByRole('button', { name: 'Безработица и рынок труда' }));
    expect(screen.getByRole('region', { name: 'Безработица и рынок труда' })).toBeInTheDocument();
  });

  it('follows a link to the lecture', async () => {
    const user = userEvent.setup();
    await renderMap();
    await user.click(card(/^Лекция 6:/));
    await user.click(within(screen.getByRole('region', { name: 'Инфляция: причины и последствия' })).getByRole('link', { name: 'Открыть лекцию' }));
    expect(await screen.findByText('Страница лекции')).toBeInTheDocument();
  });
});

describe('keyboard', () => {
  it('lights a focused node’s neighbourhood, opens it with Enter and closes with Esc back on the node', async () => {
    const user = userEvent.setup();
    await renderMap();
    const unemployment = card(/^Лекция 7: Безработица и рынок труда/);
    act(() => unemployment.focus());
    expect(unemployment).toHaveAttribute('data-state', 'lit');
    expect(card(/^Понятие: Кривая Филлипса/)).toHaveAttribute('data-state', 'lit');
    expect(card(/^Лекция 6:/)).toHaveAttribute('data-state', 'far');
    expect(card(/^Лекция 2:/)).toHaveAttribute('data-state', 'dim');

    await user.keyboard('{Enter}');
    const heading = screen.getByRole('heading', { name: 'Безработица и рынок труда' });
    await waitFor(() => expect(heading).toHaveFocus());

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('heading', { name: 'Безработица и рынок труда' })).toBeNull();
    await waitFor(() => expect(card(/^Лекция 7:/)).toHaveFocus());
  });

  it('moves through the cards with Tab, in reading order', async () => {
    const user = userEvent.setup();
    await renderMap();
    act(() => card(/^Лекция 1:/).focus());
    await user.tab();
    expect(card(/^Лекция 2:/)).toHaveFocus();
    await user.tab();
    expect(card(/^Лекция 3:/)).toHaveFocus();
  });
});

describe('closing', () => {
  it('closes the panel when the empty paper is clicked', async () => {
    const user = userEvent.setup();
    const map = await renderMap();
    await user.click(card(/^Лекция 2:/));
    expect(screen.getByRole('region', { name: 'Совокупный спрос и совокупное предложение' })).toBeInTheDocument();
    await user.click(map);
    expect(screen.queryByRole('region', { name: 'Совокупный спрос и совокупное предложение' })).toBeNull();
  });
});

describe('on a phone', () => {
  const width = window.innerWidth;
  beforeEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  });
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  });

  it('opens as a list; a row opens a sheet at the bottom that keeps the page still, and Esc closes it', async () => {
    const user = userEvent.setup();
    renderPage();
    const lectures = await screen.findByRole('region', { name: 'Лекции' });
    expect(screen.queryByRole('group', { name: /^Карта связей/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Списком' })).toHaveAttribute('aria-pressed', 'true');

    await user.click(within(lectures).getByRole('button', { name: /Инфляция: причины и последствия/ }));
    const panel = screen.getByRole('region', { name: 'Инфляция: причины и последствия' });
    expect(panel).toHaveAttribute('data-sheet');
    expect(document.body.style.overflow).toBe('hidden');

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('region', { name: 'Инфляция: причины и последствия' })).toBeNull();
    expect(document.body.style.overflow).toBe('');
    // The map is one tap away.
    await user.click(screen.getByRole('button', { name: 'Карта' }));
    expect(screen.getByRole('group', { name: /^Карта связей/ })).toBeInTheDocument();
  });
});

describe('the list', () => {
  it('says the same in words, and a row opens the same panel', async () => {
    const user = userEvent.setup();
    await renderMap();
    await user.click(screen.getByRole('button', { name: 'Списком' }));
    expect(screen.queryByRole('group', { name: /^Карта связей/ })).toBeNull();

    const lectures = screen.getByRole('region', { name: 'Лекции' });
    expect(within(lectures).getAllByRole('listitem')).toHaveLength(9);
    const moneyRow = within(lectures).getByRole('button', { name: /Деньги и денежный рынок/ });
    expect(moneyRow).toHaveTextContent(/7\sпонятий, общих — 5 · 1\sоткрытая ошибка, 5\sкарточек к повторению/);
    const concepts = screen.getByRole('region', { name: 'Общие понятия' });
    await user.click(within(concepts).getByRole('button', { name: /Центральный банк/ }));
    expect(screen.getByRole('region', { name: 'Центральный банк' })).toBeInTheDocument();
  });
});

describe('states', () => {
  it('lives in «Прогресс»: the crumb over the title leads back there', async () => {
    await renderMap();
    const title = screen.getByRole('heading', { level: 1, name: 'Карта знаний' });
    const crumb = screen.getByRole('link', { name: 'Прогресс' });
    expect(crumb).toHaveAttribute('href', '/analytics');
    expect(crumb.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('asks for the first lecture when there are none', async () => {
    tables = {};
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Здесь будет карта ваших лекций' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Добавить лекцию' })).toHaveAttribute('href', '/analyze');
    expect(screen.getByRole('link', { name: 'Прогресс' })).toHaveAttribute('href', '/analytics');
  });

  it('says when the lectures could not be read, and tries again', async () => {
    failing = new Set(['materials']);
    const user = userEvent.setup();
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Не удалось загрузить карту' })).toBeInTheDocument();
    failing = new Set();
    await user.click(screen.getByRole('button', { name: 'Повторить' }));
    expect(await screen.findByRole('group', { name: /^Карта связей/ })).toBeInTheDocument();
  });

  it('draws the lectures without exams when the exams could not be read, and says so', async () => {
    failing = new Set(['exams']);
    await renderMap();
    expect(screen.getByText('Не удалось загрузить экзамены; карта показана без этих данных.')).toBeInTheDocument();
    expect(lectureCards()).toHaveLength(15);
  });
});
