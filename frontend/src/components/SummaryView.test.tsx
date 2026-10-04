import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import SummaryView, { stripSourceMarkers } from './SummaryView';

const SOURCES = [
  { id: 'S01', text: 'Нейронная сеть состоит из слоёв: входного, скрытых и выходного. Каждый слой передаёт сигнал дальше.' },
  { id: 'S02', text: 'Обучение сети\nПодбор весов: ошибка распространяется назад от выходного слоя к входному.' },
  { id: 'S03', text: 'Функция активации решает, передаст ли нейрон сигнал: сигмоида, ReLU, гиперболический тангенс.' },
];

const CONTENT = [
  '## Архитектура',
  '',
  '- Три типа слоёв: входной, скрытые, выходной [S01, S03].',
  '',
  '## Обучение',
  '',
  'Веса подбираются, ошибка распространяется назад от выходного слоя.',
  '',
  '## Активация',
  '',
  'Нейрон передаёт сигнал дальше, если функция активации это решит [S03].',
].join('\n');

const DATA = {
  content: CONTENT,
  terms: [{ term: 'Сигмоида', definition: 'Гладкая функция активации.', source_ids: ['S03'] }],
  source_ids: ['S01', 'S02', 'S03'],
} as never;

const originalWidth = window.innerWidth;
const originalHeight = window.innerHeight;
const originalRect = Element.prototype.getBoundingClientRect;

function setWindow(width: number, height = 800) {
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
}

/** Sections stand 600 px apart from y=200, shifted by `scrolled`. */
function layOut(scrolled = 0) {
  Element.prototype.getBoundingClientRect = function rect(this: Element) {
    const part = (this as HTMLElement).dataset?.svPart;
    const top = part === undefined ? 0 : 200 + Number(part) * 600 - scrolled;
    return { top, bottom: top + 500, left: 0, right: 600, width: 600, height: 500, x: 0, y: top, toJSON: () => ({}) } as DOMRect;
  };
}

beforeEach(() => {
  vi.spyOn(window, 'requestAnimationFrame').mockImplementation((callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setWindow(originalWidth, originalHeight);
  Element.prototype.getBoundingClientRect = originalRect;
});

describe('stripSourceMarkers (re-exported for older callers)', () => {
  it('drops «[S01, S02]» as well as single marks', () => {
    expect(stripSourceMarkers('Щиты [S01, S02].')).toBe('Щиты.');
  });
});

describe('<SummaryView> on a narrow page', () => {
  beforeEach(() => setWindow(800));

  it('shows sections without raw marks and with their own fragments under them', () => {
    render(<SummaryView data={DATA} sources={SOURCES} />);
    expect(screen.getByRole('heading', { level: 2, name: 'Архитектура' })).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/\[S\d+/);
    expect(document.body.textContent).not.toMatch(/\b01\b/);
    expect(screen.getByText('Под разделами — фрагменты лекции, ближайшие к ним.')).toBeInTheDocument();
    expect(screen.queryByRole('complementary')).toBeNull();

    const architecture = screen.getByRole('heading', { name: 'Архитектура' }).closest('section') as HTMLElement;
    const links = within(architecture).getAllByRole('button', { name: /Фрагмент лекции/ });
    expect(links.map((link) => link.textContent)).toEqual(['фрагмент 1', 'фрагмент 3']);
  });

  it('opens a fragment under its section, says why it is there and closes it', () => {
    render(<SummaryView data={DATA} sources={SOURCES} />);
    const learning = screen.getByRole('heading', { name: 'Обучение' }).closest('section') as HTMLElement;
    // No marks in this section: the fragment nearest by words.
    const link = within(learning).getByRole('button', { name: 'Фрагмент лекции 2' });
    expect(link).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(link);
    expect(link).toHaveAttribute('aria-expanded', 'true');
    expect(within(learning).getByText('Фрагмент 2 лекции — ближайший по словам к разделу «Обучение»')).toBeInTheDocument();
    // The lecture's own heading keeps its line.
    expect(within(learning).getByText('Обучение сети')).toHaveClass('sv-slip-head');
    fireEvent.click(within(learning).getByRole('button', { name: 'Закрыть' }));
    expect(link).toHaveAttribute('aria-expanded', 'false');
  });

  it('names a marked fragment as the one the section refers to', () => {
    render(<SummaryView data={DATA} sources={SOURCES} />);
    const architecture = screen.getByRole('heading', { name: 'Архитектура' }).closest('section') as HTMLElement;
    fireEvent.click(within(architecture).getByRole('button', { name: 'Фрагмент лекции 3' }));
    expect(within(architecture).getByText('Фрагмент 3 лекции — на него ссылается раздел «Архитектура»')).toBeInTheDocument();
  });

  it('shows no fragment links when the lecture has no fragments', () => {
    render(<SummaryView data={DATA} sources={[]} />);
    expect(screen.queryByRole('button', { name: /Фрагмент лекции/ })).toBeNull();
    expect(screen.queryByText(/фрагменты лекции, ближайшие/)).toBeNull();
    expect(document.body.textContent).not.toMatch(/\[S\d+/);
  });
});

describe('<SummaryView> on a wide page', () => {
  beforeEach(() => {
    setWindow(1440);
    layOut(0);
  });

  it('puts the fragment of the section being read on the margin, with the list of sections', () => {
    render(<SummaryView data={DATA} sources={SOURCES} />);
    const margin = screen.getByRole('complementary', { name: 'Поле конспекта' });
    expect(screen.getByText('Справа от разделов — фрагменты лекции, ближайшие к ним.')).toBeInTheDocument();
    const outline = within(margin).getByRole('navigation', { name: 'Разделы конспекта' });
    expect(within(outline).getAllByRole('link').map((link) => link.textContent)).toEqual(['Архитектура', 'Обучение', 'Активация', 'Термины']);
    expect(within(outline).getByRole('link', { name: 'Архитектура' })).toHaveAttribute('aria-current', 'true');
    expect(within(margin).getByText('Фрагмент 1 лекции — на него ссылается раздел «Архитектура»')).toBeInTheDocument();
    // Following the reading there is nothing to close.
    expect(within(margin).queryByRole('button', { name: 'Закрыть' })).toBeNull();
  });

  it('follows the reading down the page', () => {
    render(<SummaryView data={DATA} sources={SOURCES} />);
    layOut(700);
    act(() => {
      document.dispatchEvent(new Event('scroll'));
    });
    const margin = screen.getByRole('complementary', { name: 'Поле конспекта' });
    expect(within(margin).getByRole('link', { name: 'Обучение' })).toHaveAttribute('aria-current', 'true');
    expect(within(margin).getByText('Фрагмент 2 лекции — ближайший по словам к разделу «Обучение»')).toBeInTheDocument();
  });

  it('shows a chosen fragment until the reading moves on', () => {
    render(<SummaryView data={DATA} sources={SOURCES} />);
    const architecture = screen.getByRole('heading', { name: 'Архитектура' }).closest('section') as HTMLElement;
    const third = within(architecture).getByRole('button', { name: 'Фрагмент лекции 3' });
    expect(within(architecture).getByRole('button', { name: 'Фрагмент лекции 1' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(third);
    expect(third).toHaveAttribute('aria-pressed', 'true');
    const margin = screen.getByRole('complementary', { name: 'Поле конспекта' });
    expect(within(margin).getByText('Фрагмент 3 лекции — на него ссылается раздел «Архитектура»')).toBeInTheDocument();

    fireEvent.click(within(margin).getByRole('button', { name: 'Закрыть' }));
    expect(within(margin).getByText('Фрагмент 1 лекции — на него ссылается раздел «Архитектура»')).toBeInTheDocument();

    fireEvent.click(third);
    layOut(700);
    act(() => {
      document.dispatchEvent(new Event('scroll'));
    });
    expect(within(margin).getByText('Фрагмент 2 лекции — ближайший по словам к разделу «Обучение»')).toBeInTheDocument();
  });

  it('opens a term’s fragment on the margin', () => {
    render(<SummaryView data={DATA} sources={SOURCES} />);
    const term = screen.getByText('Сигмоида').closest('div') as HTMLElement;
    fireEvent.click(within(term).getByRole('button', { name: 'Фрагмент лекции 3' }));
    const margin = screen.getByRole('complementary', { name: 'Поле конспекта' });
    expect(within(margin).getByText('Фрагмент 3 лекции — ближайший по словам к термину «Сигмоида»')).toBeInTheDocument();
  });

  it('keeps one column when there is nothing for the margin', () => {
    render(<SummaryView data={{ content: '## Один раздел\n\nКороткий текст.' } as never} sources={[]} />);
    expect(screen.queryByRole('complementary')).toBeNull();
  });
});
