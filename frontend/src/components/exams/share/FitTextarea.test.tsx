import { cleanup, render, screen } from '@testing-library/react';
import { createRef } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import FitTextarea from './FitTextarea';

// jsdom lays nothing out: the text's height is given here, as a browser would measure it.
let measured = 0;
Object.defineProperty(HTMLTextAreaElement.prototype, 'scrollHeight', { configurable: true, get: () => measured });

afterEach(() => {
  cleanup();
  measured = 0;
});

describe('FitTextarea', () => {
  it('is as tall as its text, and measures again when the text changes', () => {
    measured = 150;
    const { rerender } = render(<FitTextarea aria-label="Текст для беседы" readOnly rows={4} value="Готовимся к экзамену" />);
    const field = screen.getByLabelText('Текст для беседы') as HTMLTextAreaElement;
    expect(field.style.height).toBe('150px');
    measured = 213;
    rerender(<FitTextarea aria-label="Текст для беседы" readOnly rows={4} value={'Готовимся к экзамену\nhttps://example.test/join/k7m2pq9rst4v'} />);
    expect(field.style.height).toBe('213px');
  });

  it('leaves the height to its rows where nothing is laid out', () => {
    measured = 0;
    render(<FitTextarea aria-label="Текст для беседы" readOnly rows={4} value="Текст" />);
    const field = screen.getByLabelText('Текст для беседы') as HTMLTextAreaElement;
    expect(field.style.height).toBe('');
    expect(field.rows).toBe(4);
  });

  it('hands its field to the ref: «Скопировать» can select the text', () => {
    const ref = createRef<HTMLTextAreaElement>();
    render(<FitTextarea ref={ref} aria-label="Текст для беседы" readOnly value="Текст" />);
    expect(ref.current).toBe(screen.getByLabelText('Текст для беседы'));
    expect(ref.current?.readOnly).toBe(true);
  });
});
