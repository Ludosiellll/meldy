import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Gradebook from './Gradebook';

const rows: Record<string, unknown[]> = {
  academic_subjects: [{ id: 's1', name: 'Физика', color: '#2869dd', target_grade: 4.5 }],
  academic_grades: [
    { id: 'g1', subject_id: 's1', value: 5, weight: 1, date: '2026-10-01' },
    { id: 'g2', subject_id: 's1', value: 4, weight: 1, date: '2026-10-02' },
  ],
};

vi.mock('../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      const builder: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'order', 'delete', 'insert', 'update']) builder[method] = () => builder;
      builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows[table] ?? [], error: null }).then(resolve);
      return builder;
    },
  },
}));
vi.mock('../hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'user-1' } }) }));
vi.mock('../hooks/useEnergyConfirm', () => ({ useEnergyConfirm: () => ({ verifyEnergy: async () => true }) }));

function renderGradebook() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Gradebook />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('Gradebook', () => {
  it('opens a subject from the keyboard and asks before deleting it from the subject view', async () => {
    const user = userEvent.setup();
    renderGradebook();
    const open = await screen.findByRole('button', { name: 'Физика' });
    open.focus();
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('heading', { level: 2, name: 'Физика' })).toBeInTheDocument();

    // The delete button of the subject's own view used to set the state without any dialog to show it.
    await user.click(screen.getByRole('button', { name: 'Удалить предмет' }));
    const dialog = await screen.findByRole('dialog', { name: 'Удалить предмет?' });
    expect(dialog).toHaveTextContent('«Физика»');
    await user.click(screen.getByRole('button', { name: 'Отмена' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Удалить предмет?' })).toBeNull());
  });

  it('asks before deleting a subject from the list as well', async () => {
    const user = userEvent.setup();
    renderGradebook();
    await screen.findByRole('button', { name: 'Физика' });
    await user.click(screen.getAllByRole('button', { name: 'Удалить предмет' })[0]);
    expect(await screen.findByRole('dialog', { name: 'Удалить предмет?' })).toHaveTextContent('«Физика»');
  });
});
