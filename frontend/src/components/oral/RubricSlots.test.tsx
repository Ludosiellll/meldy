import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import RubricSlots, { quoteText } from './RubricSlots';
import { DEMO_RUBRIC } from '../../lib/oral/testing/fixtures';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const titles = DEMO_RUBRIC.points.map((point) => point.title);

function slots(named: string[], options: { asked?: string | null; announcement?: string } = {}) {
  return (
    <RubricSlots
      points={DEMO_RUBRIC.points}
      materials={DEMO_RUBRIC.materials}
      named={new Set(named)}
      asked={options.asked ?? null}
      seed="question-1"
      announcement={options.announcement ?? ''}
    />
  );
}

describe('<RubricSlots>', () => {
  it('keeps every title out of the page until its point is named', () => {
    const { container } = render(slots([]));
    for (const title of titles) expect(container.textContent).not.toContain(title);
    expect(screen.getByRole('listitem', { name: 'Пункт 3, ещё не назван' })).toBeInTheDocument();
    expect(container.querySelectorAll('.or-pt-blank')).toHaveLength(5);
  });

  it('opens a named row with a tick and the lecture’s own words, underlined where they matched', () => {
    const { container } = render(slots(['p1'], { announcement: `Пункт 1 назван: ${titles[0]}` }));
    const row = container.querySelector('[data-point="p1"]')!;
    expect(row.querySelector('svg[data-mark="tick"]')).not.toBeNull();
    expect(row.textContent).toContain('Обучение сети заключается в подборе');
    expect(row.querySelectorAll('[data-mark="under"]').length).toBeGreaterThan(0);
    expect(within(row as HTMLElement).getByText('фрагмент 12')).toBeInTheDocument();
    // Other titles stay hidden; the named one is said once, for screen readers.
    expect(container.textContent).not.toContain(titles[3]);
    const live = screen.getByRole('status');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(live).toHaveTextContent(`Пункт 1 назван: ${titles[0]}`);
  });

  it('marks the asked row with a brace and «вопрос экзаменатора» without its title', () => {
    const { container } = render(slots(['p1'], { asked: 'p4' }));
    const row = container.querySelector('[data-point="p4"]')!;
    expect(row).toHaveAttribute('aria-label', 'Пункт 4 не назван, об этом спросил экзаменатор');
    expect(row.querySelector('svg[data-mark="brace"]')).not.toBeNull();
    expect(row.textContent).toContain('вопрос экзаменатора');
    expect(container.textContent).not.toContain(titles[3]);
  });

  it('draws in only the rows named after it appeared', () => {
    const { container, rerender } = render(slots(['p1']));
    expect(container.querySelector('[data-point="p1"] svg[data-mark="tick"]')).toHaveAttribute('data-drawn', 'still');
    rerender(slots(['p1', 'p2']));
    expect(container.querySelector('[data-point="p2"]')).toHaveAttribute('data-fresh');
    expect(container.querySelector('[data-point="p2"] svg[data-mark="tick"]')).toHaveAttribute('data-drawn', 'live');
    expect(container.querySelector('[data-point="p1"]')).not.toHaveAttribute('data-fresh');
  });

  it('marks only add: a row stays open while it stays in the set', () => {
    const { container, rerender } = render(slots(['p1', 'p2']));
    rerender(slots(['p1', 'p2']));
    expect(container.querySelectorAll('[data-named]')).toHaveLength(2);
  });
});

describe('quoteText', () => {
  it('adds «…» to a quote cut from the middle of a sentence', () => {
    expect(quoteText('большая ускоряет обучение')).toBe('…большая ускоряет обучение');
    expect(quoteText('Если по модулю он больше единицы')).toBe('Если по модулю он больше единицы');
    expect(quoteText('…уже с многоточием')).toBe('…уже с многоточием');
  });
});
