import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Tour, { tourKey } from '../studio/Tour';
import { STUDIO } from '../studio/copyStudio';
import { STEP_CLIPS } from './index';

/* The studio's first visit: its tour opens with the clip «Свой тест»; the tour stays the studio's one introduction. */

function stubReducedMotion(reduce: boolean) {
  vi.stubGlobal(
    'matchMedia',
    vi.fn((query: string) => ({
      matches: reduce && query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  );
}

const card = () => screen.getByRole('dialog', { name: STUDIO.tourLabel });

beforeEach(() => {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(360);
  stubReducedMotion(false);
  window.localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('the studio tour’s clip', () => {
  it('plays «Свой тест» in the first step only, above the step’s words; the tour is seen once, as before', async () => {
    const done = vi.fn();
    render(<Tour userId="user-1" onDone={done} />);
    const first = card();
    expect(first.querySelector('.st-tour-clip')).not.toBeNull();
    await waitFor(() => expect(first.querySelector('.sc-cap-t')).toHaveTextContent(STEP_CLIPS.studio.steps[0].caption));
    expect(first.querySelector('.st-tour-clip')!.compareDocumentPosition(within(first).getByRole('heading', { name: STUDIO.tour[0].title }))).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(first.querySelector('.sc')).toHaveAttribute('data-playing', 'true');
    // The clip does not take the focus: the page works under the tour.
    expect(first.contains(document.activeElement)).toBe(false);
    fireEvent.click(within(first).getByRole('button', { name: STUDIO.tourNext }));
    expect(card().querySelector('.st-tour-clip')).toBeNull();
    expect(within(card()).getByRole('heading', { name: STUDIO.tour[1].title })).toBeInTheDocument();
    fireEvent.click(within(card()).getByRole('button', { name: STUDIO.tourSkip }));
    expect(done).toHaveBeenCalled();
    expect(window.localStorage.getItem(tourKey('user-1'))).toBe('1');
  });

  it('with reduced motion the first step’s clip stands on its first still with its line', async () => {
    stubReducedMotion(true);
    render(<Tour userId="user-1" onDone={() => undefined} />);
    await waitFor(() => expect(card().querySelector('.sc-cap-t')).toHaveTextContent(STEP_CLIPS.studio.steps[0].caption));
    expect(card().querySelector('.sc')).toHaveAttribute('data-playing', 'false');
    expect(within(card()).getByRole('button', { name: /Смотреть/ })).toBeInTheDocument();
  });

  it('on a phone too, with the phone’s first words', async () => {
    render(<Tour userId="user-1" phone onDone={() => undefined} />);
    await waitFor(() => expect(card().querySelector('.sc-cap-t')).toHaveTextContent(STEP_CLIPS.studio.steps[0].caption));
    expect(card()).toHaveTextContent(STUDIO.tourPhoneFirst.text);
  });
});
