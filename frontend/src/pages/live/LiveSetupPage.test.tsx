/**
 * «Провести игру» (/live/new): the one mode told, not offered; «Открыть комнату» in a footer that stays in view; the
 * skipped questions folded with plain reasons; «Показывать имена тройки в чате» only with a chat bound to the exam.
 */
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setLiveApi } from '../../lib/live/api';
import { createFakeServer } from '../../lib/live/fake';

const groups = vi.hoisted(() => ({ list: [] as Array<{ chatId: number; title: string | null }> }));
vi.mock('../../api/telegramGroups', () => ({
  fetchTelegramGroups: vi.fn(async () => ({ telegramLinked: true, linkActive: true, bot: 'Meldyteach_bot', hours: [], defaultHour: 12, groups: groups.list })),
}));
const auth = vi.hoisted(() => ({ user: { id: 'u1' } as { id: string } | null, loading: false, requestSession: () => {} }));
vi.mock('../../hooks/useAuth', () => ({ useAuth: () => auth }));
vi.mock('../../components/live/host/source', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../components/live/host/source')>();
  return {
    ...real,
    loadSource: vi.fn(async (containerId: string) => ({
      containerId,
      title: 'Базы данных',
      subjectIds: ['s1'],
      questions: [
        ...['Какая команда отменяет транзакцию?', 'Что гарантирует буква I в ACID?', 'Какая команда относится к DDL?', 'Какой оператор объединяет строки?'].map((text, i) => ({ id: `q${i}`, text, skip: null })),
        { id: 'n', text: 'Сколько байт в килобайте?', skip: 'short' as const },
      ],
    })),
  };
});

import { fetchTelegramGroups } from '../../api/telegramGroups';
import LiveSetupPage from './LiveSetupPage';

async function open(path: string) {
  const view = render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/live/new" element={<LiveSetupPage />} />
        <Route path="/live/:id" element={<p>Игра открыта</p>} />
        <Route path="/login" element={<p>Вход</p>} />
      </Routes>
    </MemoryRouter>,
  );
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  return view;
}

beforeEach(() => {
  groups.list = [];
  setLiveApi(createFakeServer({ bots: 0, latencyMs: 0, demoPin: null }));
});
afterEach(() => {
  cleanup();
  setLiveApi(null);
  auth.user = { id: 'u1' };
  vi.mocked(fetchTelegramGroups).mockClear();
});

describe('«Провести игру»', () => {
  it('the mode is told, not a choice; «Открыть комнату» in the footer that stays in view', async () => {
    const view = await open('/live/new?c=c1');
    expect(screen.getByRole('heading', { level: 1, name: 'Игра по тесту «Базы данных»' })).toBeInTheDocument();
    const mode = screen.getByRole('region', { name: 'Битва с монстром' });
    expect(mode.querySelector('button, [role="radio"], input')).toBeNull();
    const button = screen.getByRole('button', { name: 'Открыть комнату' });
    expect(button.closest('.lvs-foot')).not.toBeNull();
    expect(view.container.querySelector('.lvs-foot')?.textContent).toMatch(/Гости увидят верный ответ/);
  });

  it('a skipped numeric or text answer says «ответ вводят сами»; the list is folded', async () => {
    const view = await open('/live/new?c=c1');
    const folded = view.container.querySelector('details.lvs-skipped')!;
    expect(folded).not.toHaveAttribute('open');
    expect(folded.querySelector('summary')?.textContent).toMatch(/Не войдут в игру: 1\s+вопрос/);
    expect(folded.textContent).toMatch(/Сколько байт в килобайте\? — ответ вводят сами/);
    expect(view.container.textContent).not.toMatch(/пишут словами/);
  });

  it('signed out: straight to the sign-in, without asking for the chats first (live check r2, N5)', async () => {
    auth.user = null;
    await open('/live/new?c=c1');
    expect(screen.getByText('Вход')).toBeInTheDocument();
    expect(fetchTelegramGroups).not.toHaveBeenCalled();
  });

  it('«Показывать имена тройки в чате» only when a chat is bound to the exam', async () => {
    await open('/live/new?c=c1');
    expect(screen.queryByText('Показывать имена тройки в чате')).toBeNull();
    cleanup();
    groups.list = [{ chatId: -1, title: '3-ПО' }];
    await open('/live/new?c=c1');
    expect(screen.getByText('Показывать имена тройки в чате')).toBeInTheDocument();
    const names = screen.getByRole('radiogroup', { name: 'Показывать имена тройки в чате' });
    fireEvent.click(within(names).getByRole('radio', { name: 'Да' }));
    expect(within(names).getByRole('radio', { name: 'Да' })).toHaveAttribute('aria-checked', 'true');
  });
});
