import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { FINISH_SHORTCUTS, finishKeysLabel, isFinishKey, useDeskColumn } from './roomDesk';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const key = (init: Partial<{ key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean; composing: boolean }>) => ({
  key: init.key ?? 'Enter',
  ctrlKey: init.ctrlKey ?? false,
  metaKey: init.metaKey ?? false,
  shiftKey: init.shiftKey ?? false,
  altKey: init.altKey ?? false,
  nativeEvent: { isComposing: init.composing ?? false },
});

describe('Ctrl/⌘ + Enter in an answer field is «Готово» (PUB-1, EX-29)', () => {
  it('takes Ctrl+Enter and ⌘+Enter, and leaves a plain Enter its line break', () => {
    expect(isFinishKey(key({ ctrlKey: true }))).toBe(true);
    expect(isFinishKey(key({ metaKey: true }))).toBe(true);
    expect(isFinishKey(key({}))).toBe(false);
    expect(isFinishKey(key({ ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isFinishKey(key({ ctrlKey: true, altKey: true }))).toBe(false);
    expect(isFinishKey(key({ key: 'a', ctrlKey: true }))).toBe(false);
    // A word being composed by an input method is not finished by its Enter.
    expect(isFinishKey(key({ ctrlKey: true, composing: true }))).toBe(false);
  });

  it('names the keys as the computer does', () => {
    expect(finishKeysLabel(false)).toBe('Ctrl + Enter');
    expect(finishKeysLabel(true)).toBe('⌘ + Enter');
    expect(FINISH_SHORTCUTS).toBe('Control+Enter Meta+Enter');
  });
});

describe('useDeskColumn: the desk column’s height for the sticky rule (oral.css)', () => {
  function Desk({ height }: { height: number }) {
    const ref = useDeskColumn();
    return (
      <section
        ref={(node) => {
          if (node) Object.defineProperty(node, 'offsetHeight', { configurable: true, value: height });
          ref(node);
        }}
        className="or-side"
      />
    );
  }

  it('writes the column’s height and follows its changes; stops when the column goes', () => {
    const observers: Array<{ callback: () => void; disconnected: boolean }> = [];
    vi.stubGlobal(
      'ResizeObserver',
      class {
        entry: { callback: () => void; disconnected: boolean };
        constructor(callback: () => void) {
          this.entry = { callback, disconnected: false };
          observers.push(this.entry);
        }
        observe() {}
        disconnect() {
          this.entry.disconnected = true;
        }
      },
    );
    const { container, unmount } = render(<Desk height={812} />);
    const side = container.querySelector<HTMLElement>('.or-side')!;
    expect(side.style.getPropertyValue('--or-side-h')).toBe('812px');
    Object.defineProperty(side, 'offsetHeight', { configurable: true, value: 640 });
    observers[0].callback();
    expect(side.style.getPropertyValue('--or-side-h')).toBe('640px');
    unmount();
    expect(observers.every((entry) => entry.disconnected)).toBe(true);
  });

  it('still writes the height once without ResizeObserver', () => {
    vi.stubGlobal('ResizeObserver', undefined);
    const { container } = render(<Desk height={300} />);
    expect(container.querySelector<HTMLElement>('.or-side')!.style.getPropertyValue('--or-side-h')).toBe('300px');
  });
});
