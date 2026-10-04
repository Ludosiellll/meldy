import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Pricing from './Pricing';
import { OPEN_PRO_EVENT } from '../lib/plans';
import { formatLimitReset, nextLimitReset } from '../api/limits';

const api = vi.hoisted(() => ({
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  single: vi.fn(),
  update: vi.fn(),
}));

vi.mock('../lib/supabase', () => ({
  supabase: { from: api.from },
}));

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 'student@example.com' } }),
}));

function renderPricing() {
  return render(<MemoryRouter><Pricing /></MemoryRouter>);
}

describe('Pricing payment availability', () => {
  beforeEach(() => {
    api.from.mockReturnValue({ select: api.select, update: api.update });
    api.select.mockReturnValue({ eq: api.eq });
    api.eq.mockReturnValue({ single: api.single });
    api.single.mockResolvedValue({ data: { is_pro: false }, error: null });
  });

  afterEach(cleanup);

  it('does not present a fake checkout or an unverified price as purchasable', async () => {
    renderPricing();

    // The PRO card explains PRO in its window; payment itself is plainly not there.
    expect(await screen.findByRole('button', { name: 'Что даёт PRO' })).toBeEnabled();
    expect(screen.getByText('Оплата пока не подключена — стоимость появится вместе с ней.')).toBeInTheDocument();
    expect(screen.getByText(/Оплата тарифа PRO пока не подключена/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /оформить pro|купить|оплатить/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/490 ₽/)).not.toBeInTheDocument();
    expect(screen.queryByText(/приоритетная генерация|больших учебных материалов|режим диалога/i)).not.toBeInTheDocument();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('states the real daily limits of lib/plans.ts, counted by the server', async () => {
    renderPricing();

    expect(await screen.findByText('100 единиц ИИ в день — например, 5 лекций или 25 проверок ответов')).toBeInTheDocument();
    expect(screen.getByText(`Лимит считает сервер, новый день начинается в ${formatLimitReset(nextLimitReset())}.`)).toBeInTheDocument();
    expect(screen.getByText('1000 единиц ИИ в день — например, 50 лекций или 250 проверок ответов')).toBeInTheDocument();
    expect(screen.getByText('Тот же Meldy, только дневной лимит ИИ в 10 раз больше.')).toBeInTheDocument();
    expect(screen.queryByText(/не применяется/)).not.toBeInTheDocument();
  });

  it('opens the PRO window from «Что даёт PRO»', async () => {
    const reasons: unknown[] = [];
    const listen = (event: Event) => reasons.push((event as CustomEvent<{ reason: string }>).detail.reason);
    window.addEventListener(OPEN_PRO_EVENT, listen);
    try {
      renderPricing();
      fireEvent.click(await screen.findByRole('button', { name: 'Что даёт PRO' }));
      expect(reasons).toEqual(['pricing']);
    } finally {
      window.removeEventListener(OPEN_PRO_EVENT, listen);
    }
  });

  it('shows the current PRO state without offering self-service activation', async () => {
    api.single.mockResolvedValue({ data: { is_pro: true }, error: null });

    renderPricing();

    expect(await screen.findByRole('button', { name: 'У вас есть PRO' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /оформить pro/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Что даёт PRO' })).not.toBeInTheDocument();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('reports a profile lookup failure instead of silently showing the free plan', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.single.mockResolvedValue({ data: null, error: new Error('offline') });

    renderPricing();

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить тариф');
    expect(screen.queryByRole('button', { name: 'Что даёт PRO' })).not.toBeInTheDocument();
  });
});
