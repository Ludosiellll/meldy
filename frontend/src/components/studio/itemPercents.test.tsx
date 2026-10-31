import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ itemPercents: vi.fn() }));
vi.mock('../../api/quizzes', () => ({ itemPercents: api.itemPercents }));

import { ItemPercentsProvider, PercentChip, percentWords, STUDIO_PERCENT } from './itemPercents';

/** Release 49: «Процент верных — прямо на холсте студии» (test_item_percents). */
beforeEach(() => {
  api.itemPercents.mockReset();
});
afterEach(cleanup);

const words = (id: string) => (screen.getByTestId(id).textContent ?? '').replace(/\u00a0/g, ' ');

const canvas = (ids: string[]) => (
  <ItemPercentsProvider containerId="c1">
    {ids.map((id) => (
      <div key={id} data-testid={id}>
        <PercentChip itemId={id} />
      </div>
    ))}
  </ItemPercentsProvider>
);

describe('the canvas’s share of right answers', () => {
  it('a percent from 5 answers, «2 из 3» under that, nothing for a question nobody got', async () => {
    api.itemPercents.mockResolvedValue([
      { item_id: 'a', shown: 25, credit: 16 },
      { item_id: 'b', shown: 3, credit: 2 },
      { item_id: 'c', shown: 4, credit: 2.5 },
    ]);
    render(canvas(['a', 'b', 'c', 'd']));
    await waitFor(() => expect(words('a')).toContain('верно 64 %'));
    expect(api.itemPercents).toHaveBeenCalledWith('c1');
    expect(words('b')).toContain('верно 2 из 3');
    expect(words('c')).toContain('верно 2,5 из 4');
    expect(screen.getByTestId('d').textContent).toBe('');
    expect(screen.getByTestId('a').querySelector('.st-percent')).toHaveAttribute('title', STUDIO_PERCENT.title(25));
    expect(percentWords({ shown: 5, credit: 5 })).toBe('верно 100 %');
  });

  it('a read that fails, or a test nobody wrote, shows nothing', async () => {
    api.itemPercents.mockRejectedValue(new Error('PGRST202'));
    render(canvas(['a']));
    await waitFor(() => expect(api.itemPercents).toHaveBeenCalled());
    expect(screen.getByTestId('a').textContent).toBe('');
    cleanup();
    api.itemPercents.mockReset().mockResolvedValue([]);
    render(canvas(['a']));
    await waitFor(() => expect(api.itemPercents).toHaveBeenCalled());
    expect(screen.getByTestId('a').textContent).toBe('');
  });
});
