import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import KnowledgeMap from './KnowledgeMap';

const api = vi.hoisted(() => ({ from: vi.fn() }));

vi.mock('../lib/supabase', () => ({ supabase: { from: api.from } }));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../contexts/ThemeProvider', () => ({ useTheme: () => ({ theme: 'light' }) }));

const materials = [
  {
    id: 'material-1',
    title: 'Алгоритмы',
    subject: 'Информатика',
    created_at: '2026-09-20T10:00:00Z',
    summary_json: { terms: [
      { term: 'Рекурсия', definition: 'Функция вызывает саму себя.' },
      { term: 'Стек вызовов', definition: 'Хранит активные вызовы функций.' },
    ] },
  },
  {
    id: 'material-2',
    title: 'Структуры данных',
    subject: 'Информатика',
    created_at: '2026-09-21T10:00:00Z',
    summary_json: { terms: [
      { term: 'Рекурсия', definition: 'Определение через саму себя.' },
      { term: 'Очередь', definition: 'Структура данных FIFO.' },
    ] },
  },
];

const mistakes = [
  { id: 'mistake-1', topic: 'Стек вызовов', question: 'Что хранит стек вызовов?', is_resolved: false },
];

async function renderMap() {
  render(<MemoryRouter><KnowledgeMap /></MemoryRouter>);
  return screen.findByRole('img', { name: /Карта связей/ });
}

describe('KnowledgeMap zoom', () => {
  beforeAll(() => {
    // jsdom has no SVG geometry; without a screen matrix the map uses client coordinates as the zoom anchor.
    Object.defineProperty(SVGSVGElement.prototype, 'createSVGPoint', {
      configurable: true,
      value: () => ({ x: 0, y: 0, matrixTransform() { return { x: this.x, y: this.y }; } }),
    });
    Object.defineProperty(SVGSVGElement.prototype, 'getScreenCTM', { configurable: true, value: () => null });
  });

  beforeEach(() => {
    api.from.mockImplementation((table: string) => ({
      select: () => ({
        eq: () => Promise.resolve({ data: table === 'materials' ? materials : mistakes, error: null }),
      }),
    }));
  });

  afterEach(cleanup);

  it('zooms with Ctrl + wheel or a trackpad pinch in proportion to deltaY', async () => {
    const map = await renderMap();

    expect(fireEvent.wheel(map, { deltaY: -10, ctrlKey: true })).toBe(false);
    expect(screen.getByText('111%')).toBeInTheDocument();

    expect(fireEvent.wheel(map, { deltaY: 10, ctrlKey: true })).toBe(false);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('leaves a plain wheel scroll to the page', async () => {
    const map = await renderMap();

    expect(fireEvent.wheel(map, { deltaY: 120 })).toBe(true);
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('lets a finger scroll the page vertically over the map', async () => {
    const map = await renderMap();

    expect(map).toHaveClass('touch-pan-y');
    expect(map).not.toHaveClass('touch-none');
  });

  it('keeps the chosen zoom when a node, filter or search changes', async () => {
    const user = userEvent.setup();
    const map = await renderMap();

    await user.click(screen.getByRole('button', { name: 'Приблизить' }));
    expect(screen.getByText('120%')).toBeInTheDocument();
    const viewBox = map.getAttribute('viewBox');

    await user.click(screen.getByRole('button', { name: /Понятие.*: Рекурсия/ }));
    expect(screen.getByRole('heading', { name: 'Рекурсия' })).toBeInTheDocument();
    expect(screen.getByText('120%')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Нужно повторить/ }));
    expect(screen.getByText('120%')).toBeInTheDocument();

    await user.type(screen.getByRole('textbox', { name: 'Найти материал или тему' }), 'стек');
    expect(screen.getByText('120%')).toBeInTheDocument();
    expect(map).toHaveAttribute('viewBox', viewBox);

    await user.click(screen.getByRole('button', { name: 'Показать всю карту' }));
    expect(screen.getByText('100%')).toBeInTheDocument();
  });

  it('«Проверить себя» opens the exams, not the old oral exam (redesign spec 5.20)', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/knowledge-map']}>
        <Routes>
          <Route path="/knowledge-map" element={<KnowledgeMap />} />
          <Route path="/exams" element={<p>Список экзаменов</p>} />
          <Route path="/exam" element={<p>Прежний устный экзамен</p>} />
        </Routes>
      </MemoryRouter>,
    );
    await screen.findByRole('img', { name: /Карта связей/ });
    await user.click(screen.getByRole('button', { name: /Материал.*Алгоритмы/ }));
    await user.click(screen.getByRole('button', { name: /Проверить себя/ }));
    expect(await screen.findByText('Список экзаменов')).toBeInTheDocument();
    expect(screen.queryByText('Прежний устный экзамен')).not.toBeInTheDocument();
  });
});
