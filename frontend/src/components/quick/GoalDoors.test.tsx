import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u-1' }, loading: false }) }));
const guide = vi.hoisted(() => ({ value: null as null | { start: (id: string) => void } }));
vi.mock('../guide/GuideContext', () => ({ useGuide: () => guide.value }));

import GoalDoors from './GoalDoors';
import { GOAL } from './copyQuick';
import { readGoal } from './goal';

/* «Первые шаги» start with the goal (UX audit of 21.10, P2). */

const renderDoors = (lead = true) =>
  render(
    <MemoryRouter>
      <GoalDoors lead={lead} />
    </MemoryRouter>,
  );

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('GoalDoors', () => {
  it('two goals, the exam’s door blue by default; a press remembers the goal', () => {
    renderDoors();
    expect(screen.getByText(GOAL.lede)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: GOAL.exam.action })).toHaveClass('sf-primary');
    const test = screen.getByRole('link', { name: GOAL.test.action });
    expect(test).toHaveAttribute('href', '/tests/quick');
    fireEvent.click(test);
    expect(readGoal('u-1')).toBe('test');
  });

  it('the teacher’s card has a second step, «Провести игру в классе», and the guide’s clip of the game a press away', () => {
    const start = vi.fn();
    guide.value = { start };
    renderDoors();
    const step = document.querySelector('[data-goal="test"] .gl-step') as HTMLElement;
    expect(step).toHaveTextContent(GOAL.game.title);
    expect(step).toHaveTextContent(GOAL.game.text);
    expect(GOAL.game.title).toBe('Провести игру в классе');
    fireEvent.click(screen.getByRole('button', { name: GOAL.game.action }));
    expect(start).toHaveBeenCalledWith('game');
    // The exam's card has no such step; the doors keep their one action each.
    expect(document.querySelector('[data-goal="exam"] .gl-step')).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(3);
    guide.value = null;
  });

  it('while something else holds the blue pill, both doors are white', () => {
    renderDoors(false);
    expect(document.querySelector('.sf-primary')).toBeNull();
  });
});
