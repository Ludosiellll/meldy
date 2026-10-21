import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'u-1' }, loading: false }) }));

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

  it('while something else holds the blue pill, both doors are white', () => {
    renderDoors(false);
    expect(document.querySelector('.sf-primary')).toBeNull();
  });
});
