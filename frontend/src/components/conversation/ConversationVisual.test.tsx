import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import ConversationVisual from './ConversationVisual';
import DiagramView, { REVEAL, revealStep, rootNodeId } from './DiagramView';
import { buildConversation, sanitizeVisual } from './visuals';
import type { ConversationLine, ConversationSource } from './types';

afterEach(cleanup);

const HEADED: ConversationSource = {
  id: 'S01',
  text: 'Обучение нейронной сети\nОбучение сети заключается в подборе весов и смещений, при которых ошибка на обучающих примерах минимальна.',
};
const WRAPPED: ConversationSource = {
  id: 'S02',
  text: 'Объяснение безработицы через недостаток совокупного спроса впервые предложил\nКейнс в «Общей теории занятости, процента и денег».',
};

function renderLine(line: ConversationLine, sources: ConversationSource[]) {
  return render(
    <ConversationVisual visual={line.visual} origin={line.origin} provenance={line.provenance} sources={sources} />,
  );
}

describe('a verified quote keeps the lecture heading on its own line (jury memo 12)', () => {
  it('the real path: a line without a visual → findSourceFact → the heading line and the sentence below', () => {
    const [line] = buildConversation(
      [{ speaker: 'Софья', text: 'Начнём с того, как учится сеть.', source_ids: ['S01'] }],
      { sources: [HEADED] },
    );
    // The stored visual is what the sanitizer made of the fragment: one line, whitespace collapsed.
    expect(line.origin).toBe('auto');
    expect(line.visual).toEqual(sanitizeVisual({ type: 'fact', title: 'Из источника S01', text: HEADED.text }));
    expect(line.visual).toMatchObject({
      type: 'fact',
      text: 'Обучение нейронной сети Обучение сети заключается в подборе весов и смещений, при которых ошибка на обучающих примерах минимальна.',
    });
    expect(line.provenance).toEqual({ kind: 'quote', ids: ['S01'] });

    renderLine(line, [HEADED]);
    const heading = screen.getByText('Обучение нейронной сети');
    expect(heading).toHaveAttribute('data-quote-heading');
    // Both are blocks (conversation.css): the heading line, then the sentence on a line of its own.
    expect(heading).toHaveClass('cv-quote-head');
    const rest = screen.getByText(/^Обучение сети заключается в подборе весов/);
    expect(rest).toHaveClass('cv-quote-rest');
    expect(rest.textContent).toBe('Обучение сети заключается в подборе весов и смещений, при которых ошибка на обучающих примерах минимальна.»');
    const quote = heading.closest('blockquote') as HTMLElement;
    // Two lines inside one pair of «ёлочки»: nothing is lost or added to the stored text.
    expect(quote.textContent).toBe(
      '«Обучение нейронной сетиОбучение сети заключается в подборе весов и смещений, при которых ошибка на обучающих примерах минимальна.»',
    );
  });

  it('keeps the sanitizer’s truncation in the rest of the quote', () => {
    const long: ConversationSource = { id: 'S03', text: `Градиентный спуск\n${'Шаг обучения выбирают так, чтобы ошибка убывала. '.repeat(10)}` };
    const [line] = buildConversation([{ speaker: 'Макс', text: 'А шаг?', source_ids: ['S03'] }], { sources: [long] });
    renderLine(line, [long]);
    expect(screen.getByText('Градиентный спуск')).toHaveAttribute('data-quote-heading');
    expect(line.visual.type === 'fact' && line.visual.text.endsWith('…')).toBe(true);
    expect(screen.getByText(/^Шаг обучения выбирают/).textContent).toMatch(/…»$/);
  });

  it('does not invent a heading from a PDF hard wrap', () => {
    const [line] = buildConversation([{ speaker: 'Макс', text: 'Кто это предложил?', source_ids: ['S02'] }], { sources: [WRAPPED] });
    const { container } = renderLine(line, [WRAPPED]);
    expect(container.querySelector('[data-quote-heading]')).toBeNull();
    expect(container.querySelector('blockquote')?.textContent).toBe(
      '«Объяснение безработицы через недостаток совокупного спроса впервые предложил Кейнс в «Общей теории занятости, процента и денег».»',
    );
  });

  it('a model quote that starts after the heading is shown as it is', () => {
    const [line] = buildConversation(
      [
        {
          speaker: 'Софья',
          text: 'Вот как это сказано в лекции.',
          visual: { type: 'fact', title: 'Определение', text: 'Обучение сети заключается в подборе весов и смещений' },
        },
      ],
      { sources: [HEADED] },
    );
    expect(line.provenance).toEqual({ kind: 'quote', ids: ['S01'] });
    const { container } = renderLine(line, [HEADED]);
    expect(container.querySelector('[data-quote-heading]')).toBeNull();
    expect(container.querySelector('blockquote')?.textContent).toBe('«Обучение сети заключается в подборе весов и смещений»');
  });
});

describe('a paraphrase never looks like a quote (critique)', () => {
  it('shows the visible word «Пересказ», no quotation marks, no heading split and no fragment note', () => {
    const [line] = buildConversation(
      [
        {
          speaker: 'Софья',
          text: 'Если коротко.',
          source_ids: ['S01'],
          visual: { type: 'fact', title: 'Обучение нейронной сети', text: 'Обучение нейронной сети сводится к подбору чисел, при которых сеть ошибается реже.' },
        },
      ],
      { sources: [HEADED] },
    );
    expect(line.provenance).toEqual({ kind: 'none' });
    const { container } = renderLine(line, [HEADED]);
    const label = screen.getByText('Пересказ');
    expect(label).toBeVisible();
    expect(container.querySelector('blockquote')).toBeNull();
    expect(container.textContent).not.toMatch(/[«»]/);
    expect(container.querySelector('[data-quote-heading]')).toBeNull();
    expect(container.textContent).not.toMatch(/фрагмент/);
  });

  it('only a verified quote gets «ёлочки» and the fragment note', () => {
    const [line] = buildConversation([{ speaker: 'Софья', text: 'Цитата.', source_ids: ['S01'] }], { sources: [HEADED] });
    const { container } = renderLine(line, [HEADED]);
    expect(container.querySelector('blockquote')?.textContent?.startsWith('«')).toBe(true);
    expect(container.textContent).toMatch(/фрагмент 1/);
    expect(screen.queryByText('Пересказ')).not.toBeInTheDocument();
  });
});

describe('pictures on the paper sheet (spec 5.7, step A)', () => {
  const S04: ConversationSource = {
    id: 'S04',
    text: 'При цене 80 рублей выручка составила 48 тысяч, при цене 100 рублей — 50 тысяч, при цене 120 рублей — 42 тысячи.',
  };

  it('draws a chart as horizontal ink bars with the value and a muted label, no blue fills', () => {
    const [line] = buildConversation(
      [
        {
          speaker: 'Макс',
          text: 'Пример с выручкой.',
          source_ids: ['S04'],
          visual: { type: 'chart', title: 'Выручка при разной цене', kind: 'bar', unit: 'тыс. ₽', data: [{ label: '80 ₽', value: 48 }, { label: '100 ₽', value: 50 }, { label: '120 ₽', value: 42 }] },
        },
      ],
      { sources: [S04] },
    );
    const { container } = renderLine(line, [S04]);
    expect(screen.getByRole('heading', { name: 'Выручка при разной цене, тыс. ₽' })).toBeInTheDocument();
    const chart = screen.getByRole('img', { name: /Выручка при разной цене/ });
    const bars = chart.querySelectorAll<HTMLElement>('[data-chart-bar]');
    expect(bars).toHaveLength(3);
    // Lengths follow the values; the longest bar is the largest value.
    expect(parseFloat(bars[1].style.width)).toBe(100);
    expect(parseFloat(bars[0].style.width)).toBe(96);
    expect(parseFloat(bars[2].style.left)).toBe(0);
    expect([...chart.querySelectorAll('[data-chart-value]')].map(value => value.textContent)).toEqual(['48', '50', '42']);
    expect([...chart.querySelectorAll('.cv-bar-label')].map(label => label.textContent)).toEqual(['80 ₽', '100 ₽', '120 ₽']);
    // Blue on paper is only Meldy's pencil: nothing of the chart is filled with the accent.
    expect(container.innerHTML).not.toMatch(/sf-accent|accent-fg/);
    expect(container.querySelector('svg path[style*="fill"]')).toBeNull();
  });

  it('puts the source note in the top right corner of the sheet, in the pencil blue', () => {
    const [line] = buildConversation(
      [
        {
          speaker: 'Макс',
          text: 'Пример с выручкой.',
          source_ids: ['S04'],
          visual: { type: 'chart', title: 'Выручка', kind: 'bar', data: [{ label: '80 ₽', value: 48 }, { label: '100 ₽', value: 50 }] },
        },
      ],
      { sources: [S04] },
    );
    renderLine(line, [S04]);
    const note = screen.getByText(/Числа взяты из лекции/);
    expect(note).toHaveClass('sf-pnote', 'cv-src');
    expect(note).toHaveTextContent('Числа взяты из лекции, фрагмент 4');
    // The note and the title share the head row of the sheet.
    expect(note.parentElement).toHaveClass('cv-head');
    expect(note.parentElement?.querySelector('h3')).toHaveTextContent('Выручка');
  });

  it('opens the quoted fragment in the fragment panel, its heading on its own line; Escape closes it', () => {
    const [line] = buildConversation([{ speaker: 'Софья', text: 'Цитата.', source_ids: ['S01'] }], { sources: [HEADED] });
    const { container } = renderLine(line, [HEADED]);
    const button = screen.getByRole('button', { name: 'фрагмент 1' });
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    const panel = screen.getByRole('dialog', { name: 'Фрагмент 1 лекции' });
    // The panel is not laid over the sheet: it is the app's one panel, outside the picture.
    expect(container.contains(panel)).toBe(false);
    expect(within(panel).getByText('Цитата на листе взята отсюда.')).toBeInTheDocument();
    expect(within(panel).getByText('Обучение нейронной сети')).toHaveAttribute('data-fragment-heading');
    fireEvent.keyDown(panel, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(button).toHaveFocus();
  });

  it('removes the small type label over pictures, except «Пересказ»', () => {
    const lines = buildConversation([
      { speaker: 'Макс', text: 'Термин.', visual: { type: 'term', term: 'Эластичность', definition: 'Насколько меняется спрос при изменении цены.' } },
      { speaker: 'Софья', text: 'Шаги.', visual: { type: 'steps', title: 'Как посчитать', items: ['Спрос', 'Цена'] } },
      { speaker: 'Макс', text: 'Схема.', visual: { type: 'diagram', title: 'Связь', nodes: [{ id: 'a', label: 'Цена' }, { id: 'b', label: 'Спрос' }], edges: [{ from: 'a', to: 'b' }] } },
    ]);
    for (const line of lines) {
      const { container, unmount } = renderLine(line, []);
      expect(container.querySelector('.cv-kind')).toBeNull();
      expect(container.textContent).not.toMatch(/Термин|Шаги|Схема(?! )/);
      unmount();
    }
  });
});

describe('a term and a scene on the sheet', () => {
  it('sets a term large with its definition under it, on the shown picture and its measuring copy alike', () => {
    const [line] = buildConversation([
      { speaker: 'Софья', text: 'Термин.', visual: { type: 'term', term: 'Эластичный спрос', definition: 'Покупки меняются сильнее, чем цена — и выручка падает.' } },
    ]);
    const { container, rerender } = render(<ConversationVisual visual={line.visual} origin={line.origin} provenance={line.provenance} />);
    expect(screen.getByRole('heading', { name: 'Эластичный спрос' })).toHaveClass('cv-title');
    // The dash never starts a line: the space before it does not break.
    expect(container.querySelector('.cv-def')?.textContent).toBe('Покупки меняются сильнее, чем цена\u00a0— и выручка падает.');
    expect(container.firstElementChild).toHaveClass('cv-visual-term');
    expect(container.firstElementChild).toHaveAttribute('data-visual-type', 'term');
    // The invisible copy that gives the sheet its height is styled the same way.
    rerender(<ConversationVisual visual={line.visual} origin={line.origin} provenance={line.provenance} measure />);
    expect(container.firstElementChild).toHaveClass('cv-visual-term');
    expect(container.firstElementChild).not.toHaveAttribute('data-visual-type');
  });

  it('shows a scene later in the conversation as a title card, without the opening kicker or plan', () => {
    const outline = [
      { position: 2, caption: 'Выручка' },
      { position: 3, caption: 'Цена' },
    ];
    const scene = { type: 'scene' as const, title: 'Выручка фирмы', icon: 'chart' as const, caption: 'Что происходит с деньгами, когда растёт цена' };
    const { rerender } = render(<ConversationVisual visual={scene} origin="model" provenance={{ kind: 'none' }} outline={outline} />);
    expect(screen.getByRole('heading', { name: 'Выручка фирмы' })).toHaveClass('cv-scene-title');
    expect(screen.getByText('Что происходит с деньгами, когда растёт цена')).toHaveClass('cv-scene-lede');
    expect(screen.queryByText('О чём подкаст')).not.toBeInTheDocument();
    expect(screen.queryByRole('list')).not.toBeInTheDocument();

    // The same scene on the first line: the kicker and the plan, rows that seek.
    const onSeek = vi.fn();
    rerender(<ConversationVisual visual={scene} origin="model" provenance={{ kind: 'none' }} outline={outline} opening onSeek={onSeek} />);
    expect(screen.getByText('О чём подкаст')).toHaveClass('cv-kicker');
    fireEvent.click(screen.getByRole('button', { name: 'Цена, реплика 4' }));
    expect(onSeek).toHaveBeenCalledWith(3);
  });
});

describe('a diagram of words (spec 5.7, step A)', () => {
  const visual = {
    type: 'diagram' as const,
    title: 'Что говорит модуль эластичности',
    nodes: [
      { id: 'e', label: 'Эластичность спроса' },
      { id: 'el', label: 'Эластичный спрос' },
      { id: 'in', label: 'Неэластичный спрос' },
      { id: 'down', label: 'Подорожание снижает выручку' },
      { id: 'up', label: 'Подорожание повышает выручку' },
    ],
    edges: [
      { from: 'e', to: 'el', label: '|E| > 1' },
      { from: 'e', to: 'in', label: '|E| < 1' },
      { from: 'el', to: 'down' },
      { from: 'in', to: 'up' },
    ],
  };

  /** The sheet of a 1280 px window: the diagram gets 1032 px of width (jsdom has no layout). */
  function withSheetWidth(width: number) {
    const original = Element.prototype.getBoundingClientRect;
    return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
      if (this.classList.contains('cv-dgm')) return { x: 0, y: 0, top: 0, left: 0, right: width, bottom: 0, width, height: 0, toJSON: () => ({}) } as DOMRect;
      return original.call(this);
    });
  }

  it('sets the nodes as words without frames, the root in 600, edges as ink curves with chevrons', () => {
    const spy = withSheetWidth(1032);
    const { container } = render(<DiagramView visual={visual} maxHeight={300} />);
    spy.mockRestore();
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg.querySelectorAll('rect')).toHaveLength(0);
    const nodes = [...svg.querySelectorAll('text.cv-node')];
    expect(nodes.map(node => node.getAttribute('data-node'))).toEqual(['e', 'el', 'in', 'down', 'up']);
    expect(nodes.filter(node => node.hasAttribute('data-root')).map(node => node.getAttribute('data-node'))).toEqual(['e']);
    expect(nodes[0]).toHaveAttribute('font-size', '20');
    // «Подорожание / снижает выручку»: balanced lines, nothing cut.
    expect([...nodes[3].querySelectorAll('tspan')].map(span => span.textContent)).toEqual(['Подорожание', 'снижает выручку']);
    expect(svg.querySelectorAll('path.cv-edge')).toHaveLength(4);
    expect(svg.querySelectorAll('path.cv-arrow')).toHaveLength(4);
    expect([...svg.querySelectorAll('text.cv-elabel')].map(label => label.textContent)).toEqual(['|E| > 1', '|E| < 1']);
    expect(svg.querySelector('text.cv-elabel')).toHaveAttribute('font-size', '17.5');
    expect(svg).toHaveAttribute('aria-labelledby');
    expect(svg.querySelector('desc')?.textContent).toContain('Эластичность спроса → Эластичный спрос (|E| > 1)');
  });

  it('keeps nodes at 16 px and more on a phone sheet: a tall diagram is set at 16 and the sheet grows', () => {
    const spy = withSheetWidth(326);
    const { container } = render(<DiagramView visual={visual} maxHeight={250} />);
    spy.mockRestore();
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toHaveAttribute('data-diagram-kind', 'layered-vertical');
    expect(Number(svg.getAttribute('data-font')) * Number(svg.getAttribute('data-scale'))).toBeGreaterThanOrEqual(16);
    expect(container.querySelector('.cv-dgm')).toHaveAttribute('data-overflow');
    // Nothing is cut with «…» on the phone: three lines per node.
    for (const node of container.querySelectorAll('text.cv-node')) expect(node.textContent).not.toMatch(/…/);
  });

  it('comes in by layers at the start of a line within 600 ms; without reveal nothing is delayed', () => {
    const { container, rerender } = render(<DiagramView visual={visual} maxHeight={300} reveal />);
    const svg = container.querySelector('svg') as SVGSVGElement;
    expect(svg).toHaveAttribute('data-reveal');
    const delays = [...svg.querySelectorAll<SVGElement>('[style]')].map(element => parseFloat(element.style.animationDelay || '0'));
    expect(Math.max(...delays)).toBeGreaterThan(0);
    // The last stroke starts by 350 ms and draws for 250 ms: never longer than 600 ms in all.
    const edgeDelays = [...svg.querySelectorAll<SVGElement>('path.cv-edge')].map(edge => parseFloat(edge.style.animationDelay || '0'));
    expect(Math.max(...edgeDelays) + REVEAL.edgeMs).toBeLessThanOrEqual(REVEAL.totalMs);
    expect(revealStep(6) * 6 + REVEAL.edgeLagMs + REVEAL.edgeMs).toBeLessThanOrEqual(REVEAL.totalMs);
    rerender(<DiagramView visual={visual} maxHeight={300} />);
    expect(container.querySelector('svg')).not.toHaveAttribute('data-reveal');
    expect(container.querySelectorAll('svg [style*="animation-delay"]')).toHaveLength(0);
  });

  it('names a root only when the diagram has one starting point', () => {
    expect(rootNodeId(visual)).toBe('e');
    expect(rootNodeId({ nodes: [{ id: 'a', label: 'А' }, { id: 'b', label: 'Б' }, { id: 'c', label: 'В' }], edges: [{ from: 'a', to: 'c' }, { from: 'b', to: 'c' }] })).toBeNull();
    expect(rootNodeId({ nodes: [{ id: 'a', label: 'А' }, { id: 'b', label: 'Б' }], edges: [{ from: 'a', to: 'b' }, { from: 'b', to: 'a' }] })).toBeNull();
  });
});
