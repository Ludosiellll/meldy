import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type RpcAnswer = { data: unknown; error: { code?: string; message: string } | null };

const db = vi.hoisted(() => ({
  user: { id: 'user-1', email: 'student@example.com' } as { id: string; email: string } | null,
  isPro: false,
  profileError: null as unknown,
  startError: null as { code?: string; message: string } | null,
  stopError: null as { code?: string; message: string } | null,
  /** When set, the next RPC waits for this promise (a slow network). */
  hold: null as Promise<void> | null,
  tables: [] as string[],
  rpcs: [] as string[],
  track: vi.fn(),
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
      throw new Error(`unexpected table ${table}`);
    },
    rpc: async (name: string): Promise<RpcAnswer> => {
      db.rpcs.push(name);
      if (db.hold) await db.hold;
      if (name === 'start_pro_demo') {
        if (db.startError) return { data: null, error: db.startError };
        db.isPro = true;
        return { data: { pro: true, since: '2026-10-05T12:00:00.000000+00:00' }, error: null };
      }
      if (name === 'stop_pro_demo') {
        if (db.stopError) return { data: null, error: db.stopError };
        db.isPro = false;
        return { data: { pro: false }, error: null };
      }
      return { data: null, error: { code: 'PGRST202', message: `Could not find the function public.${name}` } };
    },
  },
}));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => ({ user: db.user }) }));
vi.mock('../../lib/telemetry', () => ({ track: (...args: unknown[]) => db.track(...args) }));
// The reel has its own tests (ProReel.test.tsx); here it is a stand-in in the same place that shows the jump it got.
vi.mock('./ProReel', () => ({
  default: ({ jump = 0 }: { jump?: number }) => <figure aria-label="Ролик: что будет с PRO" data-jump={jump} />,
}));

import { formatLimitReset, nextLimitReset } from '../../api/limits';
import { OPEN_PRO_EVENT, openProWindow } from '../../lib/plans';
import { ProWindowProvider } from './ProWindow';
import { ProDemoClosedError, startProDemo, stopProDemo } from './proPlan';

function Page() {
  const navigate = useNavigate();
  return (
    <>
      <button type="button" onClick={() => openProWindow('pricing')}>
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
    <MemoryRouter initialEntries={['/dashboard']}>
      <ProWindowProvider />
      <Routes>
        <Route path="/dashboard" element={<Page />} />
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

/** The window's events after a plan change: the top line reads the limit and the profile again. */
const heard: string[] = [];
const listen = (event: Event) => heard.push(event.type);

beforeEach(() => {
  db.user = { id: 'user-1', email: 'student@example.com' };
  db.isPro = false;
  db.profileError = null;
  db.startError = null;
  db.stopError = null;
  db.hold = null;
  db.tables = [];
  db.rpcs = [];
  db.track.mockReset();
  heard.length = 0;
  window.addEventListener('ai_usage_updated', listen);
  window.addEventListener('profile_updated', listen);
  document.documentElement.style.overflow = '';
  document.body.style.overflow = '';
});

afterEach(() => {
  cleanup();
  window.removeEventListener('ai_usage_updated', listen);
  window.removeEventListener('profile_updated', listen);
});

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
  });

  it('sells PRO plainly: «Купить PRO» and nothing under it — no price, no card, no notify button', async () => {
    renderApp();
    act(() => openProWindow('pricing'));
    const win = await screen.findByRole('dialog', { name: 'PRO' });
    const buy = await within(win).findByRole('button', { name: /Купить PRO/ });
    expect(buy).toHaveTextContent('Купить PRO');
    // The owner took the demo line out (2026-10-05): nothing about a demo or a payment in the window.
    expect(win.textContent).not.toMatch(/Демо|оплата не подключена/);
    expect(win.textContent).not.toMatch(/₽|руб|оплатить|оформить|карт[аы]|чек|Сообщить|оплата заработает/i);
    expect(win.querySelector('input, select, textarea')).toBeNull();
    expect(db.rpcs).toEqual([]);
  });

  it('takes the focus, keeps Tab inside, closes on Escape and gives the focus back to the opener', async () => {
    renderApp();
    const opener = screen.getByRole('button', { name: 'Что даёт PRO' });
    const win = await openFrom(opener);
    expect(win).toHaveFocus();
    expect(document.documentElement.style.overflow).toBe('hidden');

    const close = within(win).getByRole('button', { name: 'Закрыть' });
    const buy = await within(win).findByRole('button', { name: /Купить PRO/ });
    buy.focus();
    fireEvent.keyDown(win, { key: 'Tab' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(win, { key: 'Tab', shiftKey: true });
    expect(buy).toHaveFocus();
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

  it('«Купить PRO» switches PRO on for free: one call, «Готово — у вас PRO», the new day, the meter told, the reel to PRO', async () => {
    renderApp();
    const win = await openFrom(screen.getByRole('button', { name: 'Что даёт PRO' }));
    const reel = within(win).getByRole('figure', { name: 'Ролик: что будет с PRO' });
    expect(reel).toHaveAttribute('data-jump', '0');
    await act(async () => {
      fireEvent.click(await within(win).findByRole('button', { name: /Купить PRO/ }));
    });
    expect(db.rpcs).toEqual(['start_pro_demo']);
    const done = within(win).getByText('Готово — у вас PRO');
    expect(within(win).getByText('Дневной лимит теперь — 1000 единиц ИИ в день.')).toBeInTheDocument();
    expect(within(win).queryByRole('button', { name: /Купить PRO/ })).toBeNull();
    // The focus goes to the line that replaced the button; screen readers hear the change.
    expect(done.closest('p')).toHaveFocus();
    expect(within(win).getByText('Готово — у вас PRO. Дневной лимит теперь — 1000 единиц ИИ в день.')).toHaveAttribute('aria-live', 'polite');
    // The top line reads the limit (1000) and the profile again; the reel jumps to its PRO beat.
    expect(heard).toEqual(['ai_usage_updated', 'profile_updated']);
    expect(reel).toHaveAttribute('data-jump', '1');
    expect(db.track).toHaveBeenCalledWith('pro_demo_bought', { reason: 'pricing' });
    expect(db.track).not.toHaveBeenCalledWith('pro_interest_sent', expect.anything());
    // The demo can be undone from here.
    expect(within(win).getByRole('button', { name: 'Отключить PRO' })).toBeInTheDocument();
  });

  it('is busy while the call runs and does not call twice', async () => {
    let release: () => void = () => undefined;
    db.hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    renderApp();
    const win = await openFrom(screen.getByRole('button', { name: 'Что даёт PRO' }));
    const buy = await within(win).findByRole('button', { name: /Купить PRO/ });
    act(() => {
      fireEvent.click(buy);
    });
    expect(buy).toHaveAttribute('aria-busy', 'true');
    expect(buy).toHaveTextContent('Включаем PRO…');
    act(() => {
      fireEvent.click(buy);
    });
    expect(db.rpcs).toEqual(['start_pro_demo']);
    await act(async () => {
      release();
      await db.hold;
    });
    expect(await within(win).findByText('Готово — у вас PRO')).toBeInTheDocument();
    expect(db.rpcs).toEqual(['start_pro_demo']);
  });

  it('says so when PRO could not be switched on, and lets the student try again', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.startError = { code: 'PGRST202', message: 'Could not find the function public.start_pro_demo' };
    renderApp();
    const win = await openFrom(screen.getByRole('button', { name: 'Что даёт PRO' }));
    await act(async () => {
      fireEvent.click(await within(win).findByRole('button', { name: /Купить PRO/ }));
    });
    expect(within(win).getByRole('alert')).toHaveTextContent('Не удалось включить PRO. Проверьте подключение и нажмите ещё раз.');
    const again = within(win).getByRole('button', { name: /Купить PRO/ });
    expect(again).not.toHaveAttribute('aria-busy');
    expect(heard).toEqual([]);
    db.startError = null;
    await act(async () => {
      fireEvent.click(again);
    });
    expect(db.rpcs).toEqual(['start_pro_demo', 'start_pro_demo']);
    expect(within(win).queryByRole('alert')).toBeNull();
    expect(within(win).getByText('Готово — у вас PRO')).toBeInTheDocument();
  });

  it('says the free demo is closed when the server switched it off', async () => {
    db.startError = { code: 'P0001', message: 'PRO demo closed' };
    renderApp();
    const win = await openFrom(screen.getByRole('button', { name: 'Что даёт PRO' }));
    await act(async () => {
      fireEvent.click(await within(win).findByRole('button', { name: /Купить PRO/ }));
    });
    expect(within(win).getByRole('alert')).toHaveTextContent('Бесплатное демо PRO закрыто.');
    expect(within(win).queryByRole('button', { name: /Купить PRO/ })).toBeNull();
    expect(win.textContent).not.toMatch(/Демо: оплата/);
    expect(db.track).not.toHaveBeenCalledWith('pro_demo_bought', expect.anything());
  });

  it('with PRO: «У вас PRO» and a quiet «Отключить PRO» that brings the free day back', async () => {
    db.isPro = true;
    renderApp();
    const win = await openFrom(screen.getByRole('button', { name: 'Что даёт PRO' }));
    expect(await within(win).findByText('У вас PRO')).toBeInTheDocument();
    expect(within(win).getByText('Дневной лимит — 1000 единиц ИИ в день.')).toBeInTheDocument();
    expect(within(win).queryByRole('button', { name: /Купить PRO/ })).toBeNull();
    expect(db.tables).toEqual(['profiles']);
    await act(async () => {
      fireEvent.click(within(win).getByRole('button', { name: 'Отключить PRO' }));
    });
    expect(db.rpcs).toEqual(['stop_pro_demo']);
    expect(within(win).getByText('PRO отключён. Сейчас у вас бесплатный тариф: 100 единиц ИИ в день.')).toBeInTheDocument();
    const buy = within(win).getByRole('button', { name: /Купить PRO/ });
    expect(buy).toHaveFocus();
    expect(heard).toEqual(['ai_usage_updated', 'profile_updated']);
    expect(db.track).toHaveBeenCalledWith('pro_demo_cancelled', { reason: 'pricing' });
    // And the demo can be taken again.
    await act(async () => {
      fireEvent.click(buy);
    });
    expect(within(win).getByText('Готово — у вас PRO')).toBeInTheDocument();
  });

  it('says so when PRO could not be switched off', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    db.isPro = true;
    db.stopError = { code: '08006', message: 'connection failure' };
    renderApp();
    const win = await openFrom(screen.getByRole('button', { name: 'Что даёт PRO' }));
    await act(async () => {
      fireEvent.click(await within(win).findByRole('button', { name: 'Отключить PRO' }));
    });
    expect(within(win).getByRole('alert')).toHaveTextContent('Не удалось отключить PRO. Проверьте подключение и нажмите ещё раз.');
    expect(within(win).getByText('У вас PRO')).toBeInTheDocument();
    expect(heard).toEqual([]);
  });

  it('opened because the day ran out, starts with the limit and when it comes back; after the purchase, with PRO', async () => {
    renderApp();
    act(() => openProWindow('limit'));
    const win = await screen.findByRole('dialog', { name: 'PRO' });
    const line = `Дневной лимит на сегодня исчерпан. Он обновится в ${formatLimitReset(nextLimitReset())}.`;
    expect(win).toHaveAccessibleDescription(line);
    expect(within(win).getByText(line)).toHaveAttribute('data-reason', 'limit');
    await act(async () => {
      fireEvent.click(await within(win).findByRole('button', { name: /Купить PRO/ }));
    });
    expect(db.track).toHaveBeenCalledWith('pro_demo_bought', { reason: 'limit' });
    expect(win).toHaveAccessibleDescription('Тот же Meldy, только дневной лимит ИИ в 10 раз больше.');
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

  it('without an account asks to sign in, says PRO comes on after it, and changes nothing', async () => {
    db.user = null;
    renderApp();
    act(() => openProWindow('meter'));
    const win = await screen.findByRole('dialog', { name: 'PRO' });
    expect(within(win).getByText('PRO включается после входа.')).toBeInTheDocument();
    expect(within(win).queryByRole('button', { name: /Купить PRO/ })).toBeNull();
    act(() => {
      fireEvent.click(within(win).getByRole('link', { name: 'Войти' }));
    });
    expect(screen.getByText('Вход')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(db.tables).toEqual([]);
    expect(db.rpcs).toEqual([]);
  });
});

describe('the window is quiet when nothing asks for it', () => {
  it('renders nothing and touches no data until opened', async () => {
    renderApp();
    await waitFor(() => expect(screen.getByRole('button', { name: 'Что даёт PRO' })).toBeInTheDocument());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(db.tables).toEqual([]);
    expect(db.rpcs).toEqual([]);
  });
});

describe('the demo calls (proPlan.ts)', () => {
  it('start_pro_demo: the time PRO came on; the kill switch is its own error; anything else fails', async () => {
    await expect(startProDemo()).resolves.toEqual({ since: '2026-10-05T12:00:00.000000+00:00' });
    db.startError = { code: 'P0001', message: 'PRO demo closed' };
    await expect(startProDemo()).rejects.toBeInstanceOf(ProDemoClosedError);
    db.startError = { code: '42501', message: 'start_pro_demo: no signed-in user' };
    await expect(startProDemo()).rejects.toMatchObject({ code: '42501' });
  });

  it('stop_pro_demo: resolves on {pro: false}, fails on an error', async () => {
    await expect(stopProDemo()).resolves.toBeUndefined();
    db.stopError = { code: '42501', message: 'stop_pro_demo: no signed-in user' };
    await expect(stopProDemo()).rejects.toMatchObject({ code: '42501' });
  });
});
