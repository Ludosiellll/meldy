/**
 * «Провести игру» (/live/new): «Битва с монстром» or «Встань на ответ» (its boss and 15/20/30 s); «Открыть комнату» in a
 * footer that stays in view; the skipped questions folded with plain reasons; «Показывать имена тройки в чате» only with
 * a chat bound to the exam.
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

let server: ReturnType<typeof createFakeServer>;
beforeEach(() => {
  groups.list = [];
  server = createFakeServer({ bots: 0, latencyMs: 0, demoPin: null });
  setLiveApi(server);
});
afterEach(() => {
  cleanup();
  setLiveApi(null);
  auth.user = { id: 'u1' };
  vi.mocked(fetchTelegramGroups).mockClear();
});

describe('«Провести игру»', () => {
  it('two games to pick from, the battle first; «Открыть комнату» in the footer that stays in view', async () => {
    const view = await open('/live/new?c=c1');
    expect(screen.getByRole('heading', { level: 1, name: 'Игра по тесту «Базы данных»' })).toBeInTheDocument();
    const games = screen.getByRole('radiogroup', { name: 'Какая игра' });
    const radios = within(games).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual([expect.stringMatching(/^Битва с монстром/), expect.stringMatching(/^Встань на ответ/)]);
    expect(radios[0]).toHaveAttribute('aria-checked', 'true');
    // the battle's settings as before: no boss to pick, 10/20/30 s with 20 chosen
    expect(screen.queryByRole('radiogroup', { name: 'Босс' })).toBeNull();
    const time = screen.getByRole('radiogroup', { name: 'Время на вопрос' });
    expect(within(time).getAllByRole('radio').map((r) => r.textContent?.replace(/\s/g, ' '))).toEqual(['10 с', '20 с', '30 с']);
    expect(within(time).getByRole('radio', { name: /^20\sс$/ })).toHaveAttribute('aria-checked', 'true');
    const button = screen.getByRole('button', { name: 'Открыть комнату' });
    expect(button.closest('.lvs-foot')).not.toBeNull();
    expect(view.container.querySelector('.lvs-foot')?.textContent).toMatch(/Гости увидят верный ответ/);
  });

  it('«Встань на ответ»: the boss with its picture, 15/20/30 s with 15 chosen; the game is made with mode and boss', async () => {
    const create = vi.spyOn(server, 'create');
    await open('/live/new?c=c1');
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Какая игра' })).getByRole('radio', { name: /Встань на ответ/ }));
    const boss = screen.getByRole('radiogroup', { name: 'Босс' });
    expect(within(boss).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Будильник', 'Скелет']);
    expect(within(boss).getByRole('radio', { name: 'Будильник' })).toHaveAttribute('aria-checked', 'true');
    expect(boss.querySelectorAll('img')).toHaveLength(2);
    const time = screen.getByRole('radiogroup', { name: 'Время на вопрос' });
    expect(within(time).getAllByRole('radio').map((r) => r.textContent?.replace(/\s/g, ' '))).toEqual(['15 с', '20 с', '30 с']);
    expect(within(time).getByRole('radio', { name: /^15\sс$/ })).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(within(boss).getByRole('radio', { name: 'Скелет' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Открыть комнату' }));
      await Promise.resolve();
    });
    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][1]).toMatchObject({ mode: 'stand', boss: 'skeleton', time_s: 15 });
  });

  it('«Ещё раз» after a stand game opens the setup with «Встань на ответ» picked', async () => {
    await open('/live/new?c=c1&mode=stand');
    expect(within(screen.getByRole('radiogroup', { name: 'Какая игра' })).getByRole('radio', { name: /Встань на ответ/ })).toHaveAttribute('aria-checked', 'true');
    expect(within(screen.getByRole('radiogroup', { name: 'Время на вопрос' })).getByRole('radio', { name: /^15\sс$/ })).toHaveAttribute('aria-checked', 'true');
  });

  it('back to the battle: its own times again, no boss in the settings', async () => {
    const create = vi.spyOn(server, 'create');
    await open('/live/new?c=c1');
    const games = screen.getByRole('radiogroup', { name: 'Какая игра' });
    fireEvent.click(within(games).getByRole('radio', { name: /Встань на ответ/ }));
    fireEvent.click(within(games).getByRole('radio', { name: /Битва с монстром/ }));
    const time = screen.getByRole('radiogroup', { name: 'Время на вопрос' });
    expect(within(time).getByRole('radio', { name: /^20\sс$/ })).toHaveAttribute('aria-checked', 'true');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Открыть комнату' }));
      await Promise.resolve();
    });
    expect(create.mock.calls[0][1]).toMatchObject({ mode: 'boss', time_s: 20 });
    expect(create.mock.calls[0][1]).not.toHaveProperty('boss');
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
