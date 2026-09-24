import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import Pricing from './Pricing';

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

    expect(await screen.findByRole('button', { name: 'Оплата пока недоступна' })).toBeDisabled();
    expect(screen.getByText(/подключение оплаты ещё не настроено/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /оформить pro/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/490 ₽/)).not.toBeInTheDocument();
    expect(screen.getByText(/100 единиц ИИ-лимита в день/i)).toBeInTheDocument();
    expect(screen.queryByText(/приоритетная генерация|больших учебных материалов|режим диалога/i)).not.toBeInTheDocument();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('shows the current PRO state without offering self-service activation', async () => {
    api.single.mockResolvedValue({ data: { is_pro: true }, error: null });

    renderPricing();

    expect(await screen.findByRole('button', { name: 'У вас есть PRO' })).toBeDisabled();
    expect(screen.queryByRole('button', { name: /оформить pro/i })).not.toBeInTheDocument();
    expect(api.update).not.toHaveBeenCalled();
  });

  it('reports a profile lookup failure instead of silently showing the free plan', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    api.single.mockResolvedValue({ data: null, error: new Error('offline') });

    renderPricing();

    expect(await screen.findByRole('alert')).toHaveTextContent('Не удалось проверить тариф');
    expect(screen.queryByRole('button', { name: 'Оплата пока недоступна' })).not.toBeInTheDocument();
  });
});
