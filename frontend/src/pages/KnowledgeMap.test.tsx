import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import KnowledgeMap, { conceptsShown, sharedChoiceLabel, sharedChoiceLine } from './KnowledgeMap';
import { sampleRows, type SampleRows } from '../components/knowledge/sampleCourse';
import type { MapConcept, MapView } from '../components/knowledge/model';
import { examShort } from '../components/knowledge/copy';
import { PHONE_QUERY } from '../lib/usePhone';

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

    await user.click(within(screen.getByRole('list', { name: 'Показать на карте' })).getByRole('button', { name: /ответ неполный/ }));
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
    expect(money).toHaveAccessibleName(/Вопросы экзамена: 6, 7 — выучено, 8 — ответ неполный, 9/);
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

  it('draws the legend’s marks on «№», so the only number of an item is its count (LIB-24)', async () => {
    await renderMap();
    const legend = screen.getByRole('list', { name: 'Показать на карте' });
    expect(Array.from(legend.querySelectorAll('.km-num-t')).map((sample) => sample.textContent)).toEqual(['№', '№', '№', '№']);
    // The word, then its count: one number per item.
    expect(within(legend).getByRole('button', { name: /^выучено \d+$/ }).textContent).toMatch(/^№выучено \d+$/);
    expect(document.title).toBe('Карта знаний — Meldy');
  });

  it('lights the lectures a legend filter is about and fades the others', async () => {
    const user = userEvent.setup();
    await renderMap();
    const button = within(screen.getByRole('list', { name: 'Показать на карте' })).getByRole('button', { name: /ответ неполный 3/ });
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
    expect(within(panel).getByText(/ответ неполный/)).toBeInTheDocument();
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

/** matchMedia that says «a phone» (lib/usePhone, max-width 639px) and nothing else: jsdom has none of its own. */
function phoneScreen() {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    value: (media: string) => ({ matches: media === PHONE_QUERY, media, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
  });
}

describe('on a phone', () => {
  const width = window.innerWidth;
  beforeEach(() => {
    // The window says «a phone» (usePhone); the page frame measures the same 390 px (useFrame reads the window in jsdom).
    phoneScreen();
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
  });
  afterEach(() => {
    delete (window as unknown as { matchMedia?: unknown }).matchMedia;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  });

  it('opens as a list; a row opens a sheet at the bottom that keeps the page still, and Esc closes it', async () => {
    const user = userEvent.setup();
    renderPage();
    const lectures = await screen.findByRole('region', { name: 'Лекции' });
    expect(screen.queryByRole('group', { name: /^Карта связей/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Список' })).toHaveAttribute('aria-pressed', 'true');

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

  it('opens the search from its button: a short hint for the phone’s field, the label whole (LIB-24)', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('region', { name: 'Лекции' });
    expect(screen.queryByRole('searchbox')).toBeNull();
    const find = screen.getByRole('button', { name: 'Найти лекцию или понятие' });
    expect(find).toHaveAttribute('aria-expanded', 'false');
    await user.click(find);
    const search = screen.getByRole('searchbox', { name: 'Найти лекцию или понятие' });
    expect(search).toHaveAttribute('placeholder', 'Найти');
    expect(search).toHaveFocus();
    expect(find).toHaveAttribute('aria-expanded', 'true');
    expect(find).toHaveAttribute('aria-controls', search.id);
    await user.type(search, 'Инфляц');
    const lectures = screen.getByRole('region', { name: 'Лекции' });
    expect(within(lectures).getAllByRole('button')).toHaveLength(1);
    // Esc clears the words, a second Esc closes the field and gives the focus back to the button.
    await user.keyboard('{Escape}');
    expect(search).toHaveValue('');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('searchbox')).toBeNull();
    await waitFor(() => expect(find).toHaveFocus());
    expect(find).toHaveAttribute('aria-expanded', 'false');
  });

  it('says the meta in one line and leaves the exam sheet to «Экзамены» and the lecture’s panel', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Лекции' });
    const head = document.querySelector('.km-head') as HTMLElement;
    // «21 октября, через 13 дней · 3 лекции»: the kind is named only when it is not an exam.
    expect(head.querySelector('.sf-lede')?.textContent?.replace(/\s/g, ' ')).toMatch(/^\d{1,2} [а-я]+( \d{4})?, через 12 дней · \d+ лекци(я|и|й)$/);
    expect(within(head).queryByRole('link', { name: 'Лист экзамена' })).toBeNull();
  });

  it('puts the exam, the view and the search in one row; the exam is a choice that fits any name', async () => {
    const user = userEvent.setup();
    renderPage();
    await screen.findByRole('region', { name: 'Лекции' });
    const row = document.querySelector('.km-bar-one') as HTMLElement;
    const exam = within(row).getByRole('combobox', { name: 'Экзамен' });
    expect(within(exam).getAllByRole('option').map((option) => option.textContent)).toEqual(['Макроэкономика', 'Эконометрика', 'Все лекции']);
    expect(exam).toHaveValue('exam-macro');
    expect(within(row).getByRole('button', { name: 'Карта' })).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Список' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(row).getByRole('button', { name: 'Найти лекцию или понятие' })).toBeInTheDocument();
    await user.selectOptions(exam, 'Все лекции');
    expect(exam).toHaveValue('');
    expect(await screen.findByRole('list', { name: 'Предмет' })).toBeInTheDocument();
    await user.selectOptions(exam, 'Эконометрика');
    expect(document.querySelector('.km-head .sf-lede')?.textContent?.replace(/\s/g, ' ')).toMatch(/^Коллоквиум \d{1,2} [а-я]+( \d{4})?, через 26 дней · /);
  });

  it('folds the legend under «Обозначения»: words in the list, filters on the map', async () => {
    const user = userEvent.setup();
    renderPage();
    const fold = await screen.findByRole('button', { name: 'Обозначения' });
    expect(fold).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('list', { name: 'Показать на карте' })).toBeNull();
    await user.click(fold);
    expect(fold).toHaveAttribute('aria-expanded', 'true');
    const words = screen.getByRole('list', { name: 'Обозначения' });
    expect(fold).toHaveAttribute('aria-controls', words.id);
    // The list view does not light anything: the items say what the marks mean.
    expect(within(words).queryAllByRole('button')).toHaveLength(0);
    expect(within(words).getByText('выучено')).toBeInTheDocument();
    expect(within(words).getByText('открытые ошибки')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Карта' }));
    const filters = screen.getByRole('list', { name: 'Показать на карте' });
    await user.click(within(filters).getByRole('button', { name: /открытые ошибки/ }));
    expect(within(filters).getByRole('button', { name: /открытые ошибки/ })).toHaveAttribute('aria-pressed', 'true');
    // The fold names the chosen filter, so a lit map says why it is lit.
    expect(screen.getByRole('button', { name: 'Обозначения: открытые ошибки' })).toBeInTheDocument();
  });

  it('says which concepts are shown at the head of the concepts, after the lectures', async () => {
    renderPage();
    const lectures = await screen.findByRole('region', { name: 'Лекции' });
    const all = screen.getByRole('button', { name: /^Все понятия \(\d+\)$/ });
    expect(lectures.compareDocumentPosition(all) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(all.closest('.km-list')).not.toBeNull();
  });
});

describe('the words of «Понятия» (LIB-24)', () => {
  const concept = (shared: boolean, weak: boolean) => ({ shared, weak }) as unknown as MapConcept;
  const view = (shared: number, concepts: Array<ReturnType<typeof concept>>) =>
    ({ counts: { shared }, conceptByKey: new Map(concepts.map((item, index) => [`k${index}`, item])) }) as unknown as MapView;

  it('names what the first choice shows: shared concepts, concepts with open mistakes, or both', () => {
    const none = conceptsShown(view(0, [concept(false, true), concept(false, true), concept(false, false)]));
    expect(none).toEqual({ shared: 0, weak: 2 });
    expect(sharedChoiceLabel(none)).toBe('с ошибками');
    expect(sharedChoiceLine(none)).toBe('Общих понятий нет — показаны понятия с открытыми ошибками.');

    const both = conceptsShown(view(2, [concept(true, true), concept(true, false), concept(false, true)]));
    expect(both).toEqual({ shared: 2, weak: 1 });
    expect(sharedChoiceLabel(both)).toBe('общие и с ошибками');
    expect(sharedChoiceLine(both)).toBe('Показаны общие понятия и понятия с открытыми ошибками.');

    expect(sharedChoiceLabel({ shared: 3, weak: 0 })).toBe('общие');
    expect(sharedChoiceLine({ shared: 3, weak: 0 })).toBe('Показаны общие понятия.');
    expect(sharedChoiceLine({ shared: 0, weak: 0 })).toBe('Общих понятий нет.');
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
    expect(screen.getByRole('link', { name: 'Разобрать лекцию' })).toHaveAttribute('href', '/analyze');
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

describe('a computer keeps what a phone leaves out', () => {
  it('has «Лист экзамена» in the header, the exams as a rail, the search field and the legend as filters', async () => {
    renderPage();
    await screen.findByRole('group', { name: /^Карта связей/ });
    const head = document.querySelector('.km-head') as HTMLElement;
    expect(within(head).getByRole('link', { name: 'Лист экзамена' })).toHaveAttribute('href', '/exams/exam-macro');
    expect(head.querySelector('.sf-lede')?.textContent?.replace(/\s/g, ' ')).toMatch(/^Макроэкономика — экзамен .+, через 12 дней · /);
    expect(screen.getByRole('list', { name: 'Экзамен' })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Экзамен' })).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Найти лекцию или понятие' })).toHaveAttribute('placeholder', 'Найти лекцию или понятие');
    expect(screen.getByRole('list', { name: 'Показать на карте' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Обозначения' })).toBeNull();
  });
});

describe('the phone’s meta', () => {
  it('says the day of the exam and how soon it is, naming the kind only when it is not an exam', () => {
    const now = new Date(2026, 9, 8, 12);
    expect(examShort({ kind: 'exam', examDate: '2026-10-21' }, now)).toBe('21 октября, через 13 дней');
    expect(examShort({ kind: 'credit', examDate: '2026-10-08' }, now)).toBe('Зачёт 8 октября, сегодня');
    expect(examShort({ kind: 'colloquium', examDate: '2026-10-09' }, now)).toBe('Коллоквиум 9 октября, завтра');
    expect(examShort({ kind: 'exam', examDate: null }, now)).toBe('Экзамен');
  });
});

describe('a computer window narrowed by its scrollbar', () => {
  const width = window.innerWidth;
  afterEach(() => {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  });

  it('keeps the computer’s map when only the page is under 640 px (a 650 px window less its scrollbar), not the window', async () => {
    // The page frame measures 630 px (useFrame: «s»); the window is not a phone (no matchMedia match).
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 630 });
    renderPage();
    await screen.findByRole('group', { name: /^Карта связей/ });
    expect(document.querySelector('.sf-page')).toHaveAttribute('data-frame', 's');
    const head = document.querySelector('.km-head') as HTMLElement;
    expect(within(head).getByRole('link', { name: 'Лист экзамена' })).toBeInTheDocument();
    expect(screen.getByRole('list', { name: 'Экзамен' })).toBeInTheDocument();
    expect(document.querySelector('.km-bar-one')).toBeNull();
    expect(screen.getByRole('searchbox', { name: 'Найти лекцию или понятие' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Списком' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('list', { name: 'Показать на карте' })).toBeInTheDocument();
  });
});
