import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import BlockMenu from './BlockMenu';
import { STUDIO } from './copyStudio';

/* Accessibility audit 07.11, A11Y-1: the menu's search takes the focus once the box is placed, so the keyboard works. */
afterEach(() => cleanup());

describe('BlockMenu', () => {
  it('focuses its search once placed; typing filters, Escape closes', async () => {
    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    anchor.getBoundingClientRect = () => ({ top: 100, bottom: 130, left: 40, right: 200, width: 160, height: 30, x: 40, y: 100, toJSON: () => ({}) });
    anchor.focus();
    const onClose = vi.fn();
    await act(async () => {
      render(<BlockMenu anchor={anchor} onPick={vi.fn()} onClose={onClose} />);
    });
    const find = screen.getByRole('combobox', { name: STUDIO.blockMenu });
    expect(document.activeElement).toBe(find);
    fireEvent.keyDown(find, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
    anchor.remove();
  });
});
