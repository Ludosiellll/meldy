/**
 * «Провести игру» (/live/new): the picker «Мини-игра с движением» (none, every 3/5/10, «Все вопросы» = «Встань на ответ»
 * with its boss and 15/20/30 s; the battle's mini-games with the arena's boss); «Открыть комнату» in a
 * footer that stays in view; the skipped questions folded with plain reasons; «Назвать в чате трёх лучших» only with
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
type Q = { id: string; text: string; skip: 'short' | 'options' | 'picture' | null; wideSkip: 'short' | 'options' | null };
const PLAIN: Q[] = [
  ...['Какая команда отменяет транзакцию?', 'Что гарантирует буква I в ACID?', 'Какая команда относится к DDL?', 'Какой оператор объединяет строки?'].map(
    (text, i) => ({ id: `q${i}`, text, skip: null, wideSkip: null }),
  ),
  { id: 'n', text: 'Сколько байт в килобайте?', skip: 'short', wideSkip: 'short' },
];
// a real exam's test: five options a question, some with a picture; two of four options
const REAL: Q[] = [
  ...Array.from({ length: 6 }, (_, i) => ({ id: `r${i}`, text: `Вопрос с пятью вариантами ${i + 1}`, skip: 'options' as const, wideSkip: null })),
  { id: 'p', text: 'Какая связь показана на схеме?', skip: 'picture', wideSkip: null },
  { id: 'f1', text: 'Четыре варианта 1', skip: null, wideSkip: null },
  { id: 'f2', text: 'Четыре варианта 2', skip: null, wideSkip: null },
  { id: 's', text: 'Семь вариантов', skip: 'options', wideSkip: 'options' },
];
const bank = vi.hoisted(() => ({ questions: null as unknown as Array<{ id: string; text: string; skip: unknown; wideSkip: unknown }> }));
vi.mock('../../components/live/host/source', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../components/live/host/source')>();
  return {
    ...real,
    loadSource: vi.fn(async (containerId: string) => ({ containerId, title: 'Базы данных', subjectIds: ['s1'], questions: bank.questions })),
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
  bank.questions = PLAIN;
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
  it('one picker «Мини-игра с движением», every 5th question first; «Открыть комнату» in the footer that stays in view', async () => {
    const view = await open('/live/new?c=c1');
    expect(screen.getByRole('heading', { level: 1, name: 'Игра по тесту «Базы данных»' })).toBeInTheDocument();
    const mini = screen.getByRole('radiogroup', { name: 'Мини-игра с движением' });
    const radios = within(mini).getAllByRole('radio');
    expect(radios.map((r) => r.textContent)).toEqual(['Нет', 'Каждые 3 вопроса', 'Каждые 5 вопросов', 'Каждые 10 вопросов', 'Все вопросы']);
    expect(within(mini).getByRole('radio', { name: 'Каждые 5 вопросов' })).toHaveAttribute('aria-checked', 'true');
    // the battle, told with its mini-game: four questions in the game, shorter than 5, so the last one is it
    expect(screen.getByRole('heading', { level: 2, name: 'Битва с монстром' })).toBeInTheDocument();
    expect(view.container.querySelector('.lvs-game')?.textContent).toMatch(/На вопросе 4 ученики бегут на верный ответ\./);
    // the battle's times; the boss of the arena
    expect(screen.getByRole('radiogroup', { name: 'Босс' })).toBeInTheDocument();
    const time = screen.getByRole('radiogroup', { name: 'Время на вопрос' });
    expect(within(time).getAllByRole('radio').map((r) => r.textContent?.replace(/\s/g, ' '))).toEqual(['10 с', '20 с', '30 с']);
    expect(within(time).getByRole('radio', { name: /^20\sс$/ })).toHaveAttribute('aria-checked', 'true');
    const button = screen.getByRole('button', { name: 'Открыть комнату' });
    expect(button.closest('.lvs-foot')).not.toBeNull();
    expect(view.container.querySelector('.lvs-foot')?.textContent).toMatch(/Гости увидят верный ответ/);
  });

  it('every 3rd question: the battle with stand_every 3 and the arena\'s boss; the line names the questions', async () => {
    const create = vi.spyOn(server, 'create');
    const view = await open('/live/new?c=c1');
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Мини-игра с движением' })).getByRole('radio', { name: 'Каждые 3 вопроса' }));
    expect(view.container.querySelector('.lvs-game')?.textContent).toMatch(/На вопросе 3 ученики бегут на верный ответ\./);
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Босс' })).getByRole('radio', { name: 'Скелет' }));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Открыть комнату' }));
      await Promise.resolve();
    });
    expect(create.mock.calls[0][1]).toMatchObject({ mode: 'boss', stand_every: 3, boss: 'skeleton', time_s: 20 });
  });

  it('«Все вопросы» is «Встань на ответ»: the boss with its picture, 15/20/30 s with 15 chosen; made with mode and boss', async () => {
    const create = vi.spyOn(server, 'create');
    await open('/live/new?c=c1');
    fireEvent.click(within(screen.getByRole('radiogroup', { name: 'Мини-игра с движением' })).getByRole('radio', { name: 'Все вопросы' }));
    expect(screen.getByRole('heading', { level: 2, name: 'Встань на ответ' })).toBeInTheDocument();
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
    expect(create.mock.calls[0][1]).toMatchObject({ mode: 'stand', boss: 'skeleton', time_s: 15, stand_every: 0 });
  });

  it('«Ещё раз» opens the setup with the game played: a stand game «Все вопросы», a battle its own mini-games', async () => {
    await open('/live/new?c=c1&mode=stand');
    expect(within(screen.getByRole('radiogroup', { name: 'Мини-игра с движением' })).getByRole('radio', { name: 'Все вопросы' })).toHaveAttribute('aria-checked', 'true');
    expect(within(screen.getByRole('radiogroup', { name: 'Время на вопрос' })).getByRole('radio', { name: /^15\sс$/ })).toHaveAttribute('aria-checked', 'true');
    cleanup();
    await open('/live/new?c=c1&mini=10');
    expect(within(screen.getByRole('radiogroup', { name: 'Мини-игра с движением' })).getByRole('radio', { name: 'Каждые 10 вопросов' })).toHaveAttribute('aria-checked', 'true');
    cleanup();
    await open('/live/new?c=c1&mini=none');
    expect(within(screen.getByRole('radiogroup', { name: 'Мини-игра с движением' })).getByRole('radio', { name: 'Нет' })).toHaveAttribute('aria-checked', 'true');
  });

  it('«Нет» after «Все вопросы»: the battle\'s own times again, no boss, no mini-game', async () => {
    const create = vi.spyOn(server, 'create');
    await open('/live/new?c=c1');
    const mini = screen.getByRole('radiogroup', { name: 'Мини-игра с движением' });
    fireEvent.click(within(mini).getByRole('radio', { name: 'Все вопросы' }));
    fireEvent.click(within(mini).getByRole('radio', { name: 'Нет' }));
    expect(screen.queryByRole('radiogroup', { name: 'Босс' })).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: 'Битва с монстром' })).toBeInTheDocument();
    const time = screen.getByRole('radiogroup', { name: 'Время на вопрос' });
    expect(within(time).getByRole('radio', { name: /^20\sс$/ })).toHaveAttribute('aria-checked', 'true');
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Открыть комнату' }));
      await Promise.resolve();
    });
    expect(create.mock.calls[0][1]).toMatchObject({ mode: 'boss', time_s: 20, stand_every: 0 });
    expect(create.mock.calls[0][1]).not.toHaveProperty('boss');
  });

  it('a skipped numeric or text answer says «Ответ вводят сами.»; the list is folded', async () => {
    const view = await open('/live/new?c=c1');
    const folded = view.container.querySelector('details.lvs-skipped')!;
    expect(folded).not.toHaveAttribute('open');
    expect(folded.querySelector('summary')?.textContent).toMatch(/1\s+вопрос не войдёт в игру/);
    expect(folded.textContent).toMatch(/Сколько байт в килобайте\? Ответ вводят сами\./);
    // plain words: no dash chains in the list (the 21.10 rules)
    expect(folded.textContent).not.toMatch(/ — /);
    expect(view.container.textContent).not.toMatch(/пишут словами/);
  });

  it('signed out: straight to the sign-in, without asking for the chats first (live check r2, N5)', async () => {
    auth.user = null;
    await open('/live/new?c=c1');
    expect(screen.getByText('Вход')).toBeInTheDocument();
    expect(fetchTelegramGroups).not.toHaveBeenCalled();
  });

  it('«Назвать в чате трёх лучших» only when a chat is bound to the exam', async () => {
    await open('/live/new?c=c1');
    expect(screen.queryByText('Назвать в чате трёх лучших')).toBeNull();
    cleanup();
    groups.list = [{ chatId: -1, title: '3-ПО' }];
    await open('/live/new?c=c1');
    expect(screen.getByText('Назвать в чате трёх лучших')).toBeInTheDocument();
    const names = screen.getByRole('radiogroup', { name: 'Назвать в чате трёх лучших' });
    fireEvent.click(within(names).getByRole('radio', { name: 'Да' }));
    expect(within(names).getByRole('radio', { name: 'Да' })).toHaveAttribute('aria-checked', 'true');
  });

  it('a real test (five options, pictures): the mini-game goes off by itself and says why; all of it plays', async () => {
    bank.questions = REAL;
    const create = vi.spyOn(server, 'create');
    const view = await open('/live/new?c=c1');
    const mini = screen.getByRole('radiogroup', { name: 'Мини-игра с движением' });
    expect(within(mini).getByRole('radio', { name: 'Нет' })).toHaveAttribute('aria-checked', 'true');
    expect(view.container.querySelector('.lvs-note')?.textContent).toMatch(/Мини-игра выключена: в этом тесте вопросы с 5–6 вариантами или картинками/);
    // only the seven-option question is left out, with its own reason
    const folded = view.container.querySelector('details.lvs-skipped')!;
    expect(folded.querySelector('summary')?.textContent).toMatch(/1\s+вопрос не войдёт в игру/);
    expect(folded.textContent).toMatch(/2–6 вариантами/);
    expect(folded.textContent).toMatch(/Семь вариантов Вариантов меньше двух или больше шести\./);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Открыть комнату' }));
      await Promise.resolve();
    });
    expect(create.mock.calls[0][1]).toMatchObject({ mode: 'boss', stand_every: 0 });
  });

  it('a mini-game picked for such a test: says how many it takes and switches it off on a click', async () => {
    bank.questions = REAL;
    const view = await open('/live/new?c=c1&mini=5');
    const mini = screen.getByRole('radiogroup', { name: 'Мини-игра с движением' });
    expect(within(mini).getByRole('radio', { name: 'Каждые 5 вопросов' })).toHaveAttribute('aria-checked', 'true');
    expect(view.container.querySelector('.lvs-note')?.textContent).toMatch(/С мини-игрой войдут 2\s+вопроса из 9: на полу арены четыре зоны и нет картинок\./);
    fireEvent.click(screen.getByRole('button', { name: 'Играть без мини-игры' }));
    expect(within(mini).getByRole('radio', { name: 'Нет' })).toHaveAttribute('aria-checked', 'true');
    expect(view.container.querySelector('.lvs-note')).toBeNull();
  });

  it('a test of four-option questions keeps the mini-game and says nothing more', async () => {
    const view = await open('/live/new?c=c1');
    expect(within(screen.getByRole('radiogroup', { name: 'Мини-игра с движением' })).getByRole('radio', { name: 'Каждые 5 вопросов' })).toHaveAttribute('aria-checked', 'true');
    expect(view.container.querySelector('.lvs-note')).toBeNull();
  });
});
