import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import RubricSlots, { quoteText } from './RubricSlots';
import { DEMO_ANSWER, DEMO_RUBRIC } from '../../lib/oral/testing/fixtures';

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
    // A real ticket's closed row is a bare bar.
    expect(container.querySelector('.or-pt-blank')?.textContent).toBe('');
  });

  it('says in words what a closed row is when asked to (the /try example), never with the point’s own words', () => {
    const { container } = render(
      <RubricSlots
        points={DEMO_RUBRIC.points}
        materials={DEMO_RUBRIC.materials}
        named={new Set(['p1'])}
        asked={null}
        seed="question-1"
        announcement=""
        blankText="откроется, когда вы его назовёте"
      />,
    );
    const blanks = [...container.querySelectorAll<HTMLElement>('.or-pt-blank')];
    expect(blanks).toHaveLength(4);
    expect(blanks.every((blank) => blank.textContent === 'откроется, когда вы его назовёте' && blank.getAttribute('aria-hidden') === 'true')).toBe(true);
    for (const title of titles.slice(1)) expect(container.textContent).not.toContain(title);
    expect(screen.getByRole('listitem', { name: 'Пункт 2, ещё не назван' })).toBeInTheDocument();
  });

  it('opens a named row with a provisional pencil dot and the lecture’s own words, underlined where they matched', () => {
    const { container } = render(slots(['p1'], { announcement: `Пункт 1 назван: ${titles[0]}` }));
    const row = container.querySelector('[data-point="p1"]')!;
    // Named by key words, not judged yet: a pencil dot. No tick-shaped mark before the evaluation — the
    // tick, the cup, the dash and the cross belong to the protocol (Jury_Check item 7).
    expect(row.querySelector('svg[data-mark="dot"]')).not.toBeNull();
    expect(container.querySelector('svg[data-mark="tick"], svg[data-mark="dtick"]')).toBeNull();
    expect(row.querySelector('.sr-only')?.textContent).toBe('Пункт 1 назван по ключевым словам.');
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
    expect(container.querySelector('[data-point="p1"] svg[data-mark="dot"]')).toHaveAttribute('data-drawn', 'still');
    rerender(slots(['p1', 'p2']));
    expect(container.querySelector('[data-point="p2"]')).toHaveAttribute('data-fresh');
    expect(container.querySelector('[data-point="p2"] svg[data-mark="dot"]')).toHaveAttribute('data-drawn', 'live');
    expect(container.querySelector('[data-point="p1"]')).not.toHaveAttribute('data-fresh');
  });

  it('underlines one notion per named row, the one the answer named it by (redesign critique 4)', () => {
    const { container } = render(
      <RubricSlots
        points={DEMO_RUBRIC.points}
        materials={DEMO_RUBRIC.materials}
        named={new Set(['p1', 'p2', 'p3', 'p5'])}
        asked={null}
        seed="question-1"
        announcement=""
        said={DEMO_ANSWER}
      />,
    );
    const underlined = (id: string) => Array.from(container.querySelectorAll(`[data-point="${id}"] .sf-under`)).map((node) => node.textContent);
    expect(underlined('p1')).toEqual(['потерь']);
    expect(underlined('p2')).toEqual(['прямом проходе']);
    expect(underlined('p3')).toEqual(['обратное распространение']);
    expect(underlined('p5')).toEqual(['Adam']);
    // Four rows, four lines: never one under every key word.
    expect(container.querySelectorAll('.sf-under')).toHaveLength(4);
  });

  it('draws no tick, dashed tick, cup, dash or cross anywhere before the evaluation, also on the asked row', () => {
    const { container } = render(slots(['p1', 'p2', 'p3', 'p5'], { asked: 'p4' }));
    expect(container.querySelectorAll('svg[data-mark="dot"]')).toHaveLength(4);
    for (const kind of ['tick', 'dtick', 'cup', 'dash', 'cross']) expect(container.querySelector(`svg[data-mark="${kind}"]`)).toBeNull();
    // Every named row says it in words, for screen readers.
    expect(Array.from(container.querySelectorAll('[data-named] .sr-only')).map((node) => node.textContent)).toEqual([
      'Пункт 1 назван по ключевым словам.',
      'Пункт 2 назван по ключевым словам.',
      'Пункт 3 назван по ключевым словам.',
      'Пункт 5 назван по ключевым словам.',
    ]);
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
