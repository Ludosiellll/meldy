import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/supabase', () => ({
  supabase: { auth: { signInWithPassword: vi.fn(), signInWithOAuth: vi.fn(), signUp: vi.fn(), resend: vi.fn() } },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: null }) }));

import { LoginStory, RegisterStory } from './AuthStory';
import Login from '../../pages/Login';
import Register from '../../pages/Register';

afterEach(cleanup);

describe('the sign-in panel story', () => {
  it('reads as the three steps; the moving scenes are decoration', () => {
    const { container } = render(<LoginStory />);
    const steps = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(steps.map((step) => step.querySelector('.as-step-t')?.textContent)).toEqual(['Загрузите материал', 'Разберите главное', 'Проверьте себя']);
    expect(steps[0]).toHaveTextContent('PDF, DOCX, текст, изображение или запись лекции.');
    expect(container.querySelector('.as-stage')).toHaveAttribute('aria-hidden', 'true');
    // Every scene runs on the shared cycle: one per step.
    expect(container.querySelectorAll('.as-scene')).toHaveLength(3);
  });

  it('reads as the four parts of the plan; the counter and the bar are decoration', () => {
    const { container } = render(<RegisterStory />);
    const items = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Конспект с привязкой к источнику',
      'Карточки для активного повторения',
      'Тест для проверки понимания',
      'История материалов и прогресса',
    ]);
    expect(container.querySelector('.as-plan-head')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('.as-plan-bar')).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('the sign-in pages', () => {
  function renderAt(path: string) {
    return render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route path="/register" element={<Register />} />
          <Route path="/forgot-password" element={<p>Восстановление пароля</p>} />
        </Routes>
      </MemoryRouter>,
    );
  }

  it('puts «Забыли пароль?» on the row of the password label and keeps it working', () => {
    const { container } = renderAt('/login');
    const row = container.querySelector('.au-label-row') as HTMLElement;
    expect(within(row).getByText('Пароль')).toBeInTheDocument();
    fireEvent.click(within(row).getByRole('button', { name: 'Забыли пароль?' }));
    expect(screen.getByText('Восстановление пароля')).toBeInTheDocument();
  });

  it('shows the story beside the sign-in form and the plan beside the sign-up form', () => {
    renderAt('/login');
    expect(screen.getByRole('heading', { name: 'От источника до уверенного ответа.' })).toBeInTheDocument();
    expect(screen.getByText('Загрузите материал')).toBeInTheDocument();
    cleanup();

    const { container } = renderAt('/register');
    expect(screen.getByText('История материалов и прогресса')).toBeInTheDocument();
    // The password and its repeat stand side by side.
    const pair = container.querySelector('.au-pair') as HTMLElement;
    expect(within(pair).getByLabelText('Пароль')).toBeInTheDocument();
    expect(within(pair).getByLabelText('Повтор пароля')).toBeInTheDocument();
  });
});
