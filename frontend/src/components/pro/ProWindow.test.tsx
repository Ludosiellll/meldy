import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const db = vi.hoisted(() => ({
  user: { id: 'user-1', email: 'student@example.com' } as { id: string; email: string } | null,
  isPro: false,
  profileError: null as unknown,
  interest: null as { user_id: string } | null,
  insertError: null as { code?: string; message: string } | null,
  insert: vi.fn(),
  tables: [] as string[],
}));

vi.mock('../../lib/supabase', () => ({
  supabase: {
    from: (table: string) => {
      db.tables.push(table);
      if (table === 'profiles') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => (db.profileError ? { data: null, error: db.profileError } : { data: { is_pro: db.isPro }, error: null }),
            }),
          }),
        };
      }
      if (table === 'pro_interest') {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: db.interest, error: null }) }) }),
          insert: async (row: unknown) => {
            db.insert(row);
            return { data: null, error: db.insertError };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: db.user }) }));
// The reel has its own tests (ProReel.test.tsx); here it is a stand-in in the same place.
vi.mock('./ProReel', () => ({ default: () => <figure aria-label="Ролик: что будет с PRO" /> }));

import { formatLimitReset, nextLimitReset } from '../../api/limits';
import { OPEN_PRO_EVENT, openProWindow } from '../../lib/plans';
import { ProWindowProvider, useProWindow } from './ProWindow';

function Page() {
  const open = useProWindow();
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => open('pricing')}>
        Что даёт PRO
      </button>
      <button type="button" onClick={() => navigate('/other')}>
        Уйти
      </button>
    </>
  );
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/pricing']}>
      <ProWindowProvider />
      <Routes>
        <Route path="/pricing" element={<Page />} />
        <Route path="/other" element={<p>Другая страница</p>} />
        <Route path="/login" element={<p>Вход</p>} />
      </Routes>
    </MemoryRouter>,
  );
}

const dialog = () => screen.getByRole('dialog', { name: 'PRO' });

async function openFrom(opener: HTMLElement) {
  opener.focus();
  act(() => {
    fireEvent.click(opener);
  });
  return screen.findByRole('dialog', { name: 'PRO' });
}

beforeEach(() => {
  db.user = { id: 'user-1', email: 'student@example.com' };
  db.isPro = false;
  db.profileError = null;
  db.interest = null;
  db.insertError = null;
  db.tables = [];
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
});

afterEach(cleanup);

describe('the PRO window', () => {
  it('opens on the meldy:open-pro event from anywhere, as a labelled modal dialog over the reel', async () => {
    renderApp();
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => openProWindow('meter'));
    const win = await screen.findByRole('dialog', { name: 'PRO' });
    expect(win).toHaveAttribute('aria-modal', 'true');
    expect(win).toHaveAccessibleDescription('Тот же Meldy, только дневной лимит ИИ в 10 раз больше.');
    // The reel first, then the words.
    const reel = within(win).getByRole('figure', { name: 'Ролик: что будет с PRO' });
    const title = within(win).getByRole('heading', { name: 'PRO' });
    expect(reel.compareDocumentPosition(title) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // What PRO changes, in numbers from lib/plans.ts.
    expect(within(win).getByText('До 1000 единиц ИИ в день вместо 100 — это примерно 250 проверок ответов или 50 лекций.')).toBeInTheDocument();
    expect(await within(win).findByText('Сейчас у вас бесплатный тариф: 100 единиц ИИ в день.')).toBeInTheDocument();
    expect(within(win).getByText('Оплата пока не подключена — стоимость появится вместе с ней.')).toBeInTheDocument();
    // No checkout, no price.
    expect(win.textContent).not.toMatch(/₽|оформить|купить|оплатить/i);
  });

  it('takes the focus, keeps Tab inside, closes on Escape and gives the focus back to the opener', async () => {
    renderApp();
    const opener = screen.getByRole('button', { name: 'Что даёт PRO' });
    const win = await openFrom(opener);
    expect(win).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('hidden');

    const close = within(win).getByRole('button', { name: 'Закрыть' });
    const notify = await within(win).findByRole('button', { name: 'Сообщить, когда появится' });
    notify.focus();
    fireEvent.keyDown(win, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(win, { key: 'Tab', shiftKey: true });
    expect(notify).toHaveFocus();
    // Focus that slips out of the window is brought back into it.
    act(() => screen.getByRole('button', { name: 'Уйти', hidden: true }).focus());
    expect(win).toHaveFocus();

    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(opener).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('');
  });

  it('closes from its button and from the dimmed page, and when the student goes to another page', async () => {
    renderApp();
    let win = await openFrom(screen.getByRole('button', { name: 'Что даёт PRO' }));
    act(() => {
      fireEvent.click(within(win).getByRole('button', { name: 'Закрыть' }));
    });
    expect(screen.queryByRole('dialog')).toBeNull();

    win = await openFrom(screen.getByRole('button', { name: 'Что даёт PRO' }));
    act(() => {
      fireEvent.click(document.querySelector('.pw-dim') as HTMLElement);
    });
    expect(screen.queryByRole('dialog')).toBeNull();

    win = await openFrom(screen.getByRole('button', { name: 'Что даёт PRO' }));
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: 'Уйти', hidden: true }));
    });
    expect(screen.getByText('Другая страница')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('notes the wish to be told: one row in pro_interest, then a pressed state that is not sent again', async () => {
    renderApp();
    const win = await openFrom(screen.getByRole('button', { name: 'Что даёт PRO' }));
    const notify = await within(win).findByRole('button', { name: 'Сообщить, когда появится' });
    await act(async () => {
      fireEvent.click(notify);
    });
    expect(db.insert).toHaveBeenCalledTimes(1);
    expect(db.insert).toHaveBeenCalledWith({ user_id: 'user-1', reason: 'pricing' });
    const done = within(win).getByRole('button', { name: 'Сообщим, когда оплата заработает' });
    expect(done).toHaveAttribute('aria-disabled', 'true');
    // The same button: the keyboard focus stays on it.
    expect(done).toBe(notify);
    expect(within(win).getByText('Записали: сообщим, когда оплата заработает.')).toBeInTheDocument();
    await act(async () => {
      fireEvent.click(done);
    });
    expect(db.insert).toHaveBeenCalledTimes(1);
  });

  it('reads a duplicate (23505) as already noted, and an already noted account opens in that state', async () => {
    db.insertError = { code: '23505', message: 'duplicate key value violates unique constraint "pro_interest_pkey"' };
    renderApp();
    let win = await openFrom(screen.getByRole('button', { name: 'Что даёт PRO' }));
    await act(async () => {
      fireEvent.click(await within(win).findByRole('button', { name: 'Сообщить, когда появится' }));
    });
    expect(within(win).getByRole('button', { name: 'Сообщим, когда оплата заработает' })).toHaveAttribute('aria-disabled', 'true');
    expect(within(win).queryByRole('alert')).toBeNull();
    cleanup();

    db.insertError = null;
    db.interest = { user_id: 'user-1' };
    db.insert.mockClear();
    renderApp();
    win = await openFrom(screen.getByRole('button', { name: 'Что даёт PRO' }));
    expect(await within(win).findByRole('button', { name: 'Сообщим, когда оплата заработает' })).toHaveAttribute('aria-disabled', 'true');
    expect(db.insert).not.toHaveBeenCalled();
  });

  it('says so when the note could not be written, and lets the student try again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.insertError = { code: '42501', message: 'permission denied' };
    renderApp();
    const win = await openFrom(screen.getByRole('button', { name: 'Что даёт PRO' }));
    await act(async () => {
      fireEvent.click(await within(win).findByRole('button', { name: 'Сообщить, когда появится' }));
    });
    expect(within(win).getByRole('alert')).toHaveTextContent('Не удалось записать. Проверьте подключение и нажмите ещё раз.');
    const again = within(win).getByRole('button', { name: 'Сообщить, когда появится' });
    expect(again).not.toHaveAttribute('aria-disabled');
    db.insertError = null;
    await act(async () => {
      fireEvent.click(again);
    });
    expect(db.insert).toHaveBeenCalledTimes(2);
    expect(within(win).queryByRole('alert')).toBeNull();
  });

  it('shows «У вас PRO» to a PRO account, with nothing to ask for', async () => {
    db.isPro = true;
    renderApp();
    const win = await openFrom(screen.getByRole('button', { name: 'Что даёт PRO' }));
    expect(await within(win).findByText('У вас PRO')).toBeInTheDocument();
    expect(within(win).queryByRole('button', { name: /Сообщ/ })).toBeNull();
    expect(within(win).queryByText(/Оплата пока не подключена/)).toBeNull();
    expect(db.tables).toEqual(expect.arrayContaining(['profiles', 'pro_interest']));
  });

  it('opened because the day ran out, starts with the limit and when it comes back', async () => {
    renderApp();
    act(() => openProWindow('limit'));
    const win = await screen.findByRole('dialog', { name: 'PRO' });
    const line = `Дневной лимит на сегодня исчерпан. Он обновится в ${formatLimitReset(nextLimitReset())}.`;
    expect(win).toHaveAccessibleDescription(line);
    expect(within(win).getByText(line)).toHaveAttribute('data-reason', 'limit');
    await act(async () => {
      fireEvent.click(await within(win).findByRole('button', { name: 'Сообщить, когда появится' }));
    });
    expect(db.insert).toHaveBeenCalledWith({ user_id: 'user-1', reason: 'limit' });
  });

  it('treats an unknown reason as «pricing», and a second event while open only changes the reason', async () => {
    renderApp();
    act(() => {
      window.dispatchEvent(new CustomEvent(OPEN_PRO_EVENT, { detail: { reason: 'checkout' } }));
    });
    const opened = await screen.findByRole('dialog', { name: 'PRO' });
    expect(opened).toHaveAccessibleDescription('Тот же Meldy, только дневной лимит ИИ в 10 раз больше.');
    act(() => openProWindow('limit'));
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(dialog()).toHaveAccessibleDescription(/Дневной лимит на сегодня исчерпан/);
  });

  it('without an account asks to sign in instead of writing anything', async () => {
    db.user = null;
    renderApp();
    act(() => openProWindow('meter'));
    const win = await screen.findByRole('dialog', { name: 'PRO' });
    expect(within(win).getByText('Войдите, и мы сообщим, когда оплата заработает.')).toBeInTheDocument();
    act(() => {
      fireEvent.click(within(win).getByRole('link', { name: 'Войти' }));
    });
    expect(screen.getByText('Вход')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(db.tables).toEqual([]);
  });
});

describe('useProWindow', () => {
  it('fires the same window event as openProWindow', () => {
    const seen: unknown[] = [];
    const listen = (event: Event) => seen.push((event as CustomEvent).detail);
    window.addEventListener(OPEN_PRO_EVENT, listen);
    try {
      render(
        <MemoryRouter>
          <Page />
        </MemoryRouter>,
      );
      fireEvent.click(screen.getByRole('button', { name: 'Что даёт PRO' }));
      expect(seen).toEqual([{ reason: 'pricing' }]);
    } finally {
      window.removeEventListener(OPEN_PRO_EVENT, listen);
    }
  });
});

describe('the window is quiet when nothing asks for it', () => {
  it('renders nothing and touches no data until opened', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Что даёт PRO' })).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(db.tables).toEqual([]);
  });
});
