import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import TokenInfoModal from './TokenInfoModal';

/* Accessibility audit 07.11, A11Y-2: the modal limit window keeps Tab inside and gives the focus back to its opener. */
vi.mock('./pro/ProWindow', () => ({ default: () => null }));
afterEach(() => cleanup());

function Page() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Лимит ИИ
      </button>
      <a href="/elsewhere">Meldy</a>
      <TokenInfoModal isOpen={open} onClose={() => setOpen(false)} usedTokens={12} isPro={false} />
    </>
  );
}

describe('the limit window', () => {
  it('keeps Tab inside and returns the focus to the meter on Escape', () => {
    render(<Page />);
    const meter = screen.getByRole('button', { name: 'Лимит ИИ' });
    meter.focus();
    fireEvent.click(meter);
    const dialog = screen.getByRole('dialog', { name: 'Дневной лимит ИИ' });
    expect(document.activeElement).toBe(dialog);
    for (let i = 0; i < 12; i += 1) {
      fireEvent.keyDown(window, { key: 'Tab' });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
    fireEvent.keyDown(window, { key: 'Tab', shiftKey: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(meter);
  });
});
