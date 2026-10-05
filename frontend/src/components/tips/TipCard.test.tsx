import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The clip's file (the reel engine and the scenes) is not needed to test the card.
vi.mock('./clipPart', async () => {
  const { lazyPart } = await import('../../lib/lazyPart');
  return { tipClipPart: lazyPart(async () => () => <div data-testid="clip" />) };
});

import TipCard from './TipCard';
import { TIPS } from './tips';

function Page({ onAction = vi.fn(), onDismiss = vi.fn(), shown = true }: { onAction?: () => void; onDismiss?: () => void; shown?: boolean }) {
  const pill = useRef<HTMLAnchorElement>(null);
  const group = useRef<HTMLDivElement>(null);
  return (
    <div>
      <div ref={group} style={{ position: 'relative' }}>
        <a ref={pill} href="/library/m1/talk">
          Поговорить о лекции
        </a>
        {shown ? <TipCard tip={TIPS.talk} anchor={pill} alignTo={group} to="/library/m1/talk" onAction={onAction} onDismiss={onDismiss} /> : null}
        <a href="/review">Повторить карточки</a>
      </div>
      <button type="button">Вне подсказки</button>
    </div>
  );
}

const renderPage = (props: Parameters<typeof Page>[0] = {}) =>
  render(
    <MemoryRouter>
      <Page {...props} />
    </MemoryRouter>,
  );

const card = () => document.querySelector('.tp-card') as HTMLElement;

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('TipCard', () => {
  it('shows the clip, the title, the words and the two actions in the tip’s own words', async () => {
    renderPage();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10);
    });
    const region = screen.getByRole('region', { name: 'Поговорить о лекции' });
    expect(region).toHaveAccessibleDescription(TIPS.talk.text);
    expect(screen.getByTestId('clip')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Попробовать' })).toHaveAttribute('href', '/library/m1/talk');
    expect(screen.getByRole('button', { name: 'Не сейчас' })).toBeInTheDocument();
    expect(TIPS.talk.title).toBe('Поговорить о лекции');
    expect(TIPS.talk.text).toBe('Meldy задаст вопросы по карточкам этой лекции, подскажет и покажет нужный фрагмент. Отвечайте голосом или текстом.');
  });

  it('takes no focus and says itself once through a polite live region', async () => {
    renderPage();
    expect(document.activeElement).toBe(document.body);
    const live = card().querySelector('[aria-live="polite"]') as HTMLElement;
    expect(live.textContent).toBe('');
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(live.textContent).toBe(`Подсказка. Поговорить о лекции. ${TIPS.talk.text}`);
    expect(document.activeElement).toBe(document.body);
  });

  it('rings its anchor while it is shown', () => {
    const view = renderPage();
    const pill = screen.getByRole('link', { name: 'Поговорить о лекции' });
    expect(pill).toHaveAttribute('data-tip-spot');
    view.rerender(
      <MemoryRouter>
        <Page shown={false} />
      </MemoryRouter>,
    );
    expect(pill).not.toHaveAttribute('data-tip-spot');
  });

  it('comes right after its anchor, so Tab goes from the anchor to the tip', () => {
    renderPage();
    const pill = screen.getByRole('link', { name: 'Поговорить о лекции' });
    expect(pill.nextElementSibling).toBe(card());
  });

  it('«Попробовать» and «Не сейчас» call their handlers', () => {
    const onAction = vi.fn();
    const onDismiss = vi.fn();
    renderPage({ onAction, onDismiss });
    fireEvent.click(screen.getByRole('link', { name: 'Попробовать' }));
    expect(onAction).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Не сейчас' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Escape inside is «Не сейчас», and the focus goes back to the anchor', () => {
    const onDismiss = vi.fn();
    renderPage({ onDismiss });
    const later = screen.getByRole('button', { name: 'Не сейчас' });
    later.focus();
    fireEvent.keyDown(later, { key: 'Escape' });
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: 'Поговорить о лекции' })).toHaveFocus();
  });

  it('Escape outside the card leaves it alone', () => {
    const onDismiss = vi.fn();
    renderPage({ onDismiss });
    const outside = screen.getByRole('button', { name: 'Вне подсказки' });
    outside.focus();
    fireEvent.keyDown(outside, { key: 'Escape' });
    expect(onDismiss).not.toHaveBeenCalled();
  });

  it('steps aside when a control it covers gets the keyboard focus', () => {
    renderPage();
    const rect = (left: number, top: number, right: number, bottom: number) =>
      ({ left, top, right, bottom, width: right - left, height: bottom - top, x: left, y: top, toJSON: () => ({}) }) as DOMRect;
    vi.spyOn(card(), 'getBoundingClientRect').mockReturnValue(rect(0, 100, 400, 500));
    const covered = screen.getByRole('link', { name: 'Повторить карточки' });
    vi.spyOn(covered, 'getBoundingClientRect').mockReturnValue(rect(10, 120, 200, 170));
    const clear = screen.getByRole('button', { name: 'Вне подсказки' });
    vi.spyOn(clear, 'getBoundingClientRect').mockReturnValue(rect(10, 600, 200, 650));
    act(() => covered.focus());
    expect(card()).toHaveAttribute('data-aside');
    act(() => clear.focus());
    expect(card()).not.toHaveAttribute('data-aside');
  });
});
