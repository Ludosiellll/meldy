import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import SharedMaterial from './SharedMaterial';

const db = vi.hoisted(() => ({ rpc: vi.fn(), from: vi.fn() }));
vi.mock('../lib/supabase', () => ({ supabase: { rpc: (...args: unknown[]) => db.rpc(...args), from: db.from } }));

function renderShared(id = 'm1') {
  return render(
    <MemoryRouter initialEntries={[`/shared/${id}`]}>
      <Routes>
        <Route path="/shared/:id" element={<SharedMaterial />} />
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('SharedMaterial (finding F5)', () => {
  it('reads the material through shared_material, never the table, and shows its summary', async () => {
    db.rpc.mockResolvedValue({
      data: { id: 'm1', title: 'Денежный рынок', subject: 'Экономика', summary_json: { content: 'Спрос на деньги [S01] растёт с доходом.' } },
      error: null,
    });
    renderShared();
    expect(await screen.findByRole('heading', { level: 1, name: 'Денежный рынок' })).toBeInTheDocument();
    expect(screen.getByText(/Спрос на деньги растёт с доходом/)).toBeInTheDocument();
    expect(db.rpc).toHaveBeenCalledWith('shared_material', { p_id: 'm1' });
    expect(db.from).not.toHaveBeenCalled();
  });

  it('says there is no summary instead of showing the lecture text', async () => {
    db.rpc.mockResolvedValue({ data: { id: 'm1', title: 'Только текст', summary_json: null }, error: null });
    renderShared();
    expect(await screen.findByText('У этого материала пока нет конспекта.')).toBeInTheDocument();
  });

  it('a closed or missing material is «не найден»', async () => {
    db.rpc.mockResolvedValue({ data: null, error: null });
    renderShared('m2');
    expect(await screen.findByRole('heading', { name: 'Материал не найден' })).toBeInTheDocument();
  });
});
