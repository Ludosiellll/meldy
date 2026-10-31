import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { OverviewContainer } from '../types/container';

/**
 * «Игры» (/games; owner, 31.10: «есть ли обучение о том что эти мини-игры есть, да и в целом может отдельный Блок сверху
 * как "лекции"»): what the game is, «Начать игру» to the user's own tests and exams, the three games, and for a student
 * «Войти в игру по коду».
 */
const overview = vi.hoisted(() => ({
  state: { data: null as unknown, loading: true, offline: false, unavailable: false, error: null as string | null, reload: vi.fn() },
}));
vi.mock('../lib/containers/hooks', () => ({ useContainersOverview: () => overview.state }));

import Games from './Games';
import { GAMES, pickMeta } from '../components/games/copyGames';
import { playableOf } from '../components/games/GamePicker';

function container(id: string, title: string, kind: 'test' | 'exam', role: 'owner' | 'member', keyed: number, noKey: number, created: string): OverviewContainer {
  return {
    id,
    title,
    kind,
    role,
    exam_date: null,
    created_at: created,
    items: keyed + noKey,
    items_updated_at: null,
    subjects: [{ id: `s-${id}`, position: 1, title: 'Вопросы', exam_date: null, oral_exam_id: null, has_oral: false, keyed, no_key: noKey } as OverviewContainer['subjects'][number]],
    answers_today: 0,
    settings: null,
  };
}

const CONTAINERS = [
  container('e-1', 'Экзамен по истории', 'exam', 'owner', 40, 0, '2026-10-10T10:00:00Z'),
  container('t-old', 'Дроби', 'test', 'owner', 15, 3, '2026-10-20T10:00:00Z'),
  container('t-new', 'Солнечная система', 'test', 'owner', 24, 0, '2026-10-29T10:00:00Z'),
  container('t-nokey', 'Глаголы', 'test', 'owner', 0, 12, '2026-10-25T10:00:00Z'),
  container('t-empty', 'Новый тест', 'test', 'owner', 0, 0, '2026-10-30T10:00:00Z'),
  container('m-1', 'Микроэкономика', 'exam', 'member', 120, 0, '2026-10-05T10:00:00Z'),
];

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/games']}>
      <Games />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  overview.state = { data: { v: 1, day: '2026-10-31', containers: CONTAINERS, attached_exam_ids: [] }, loading: false, offline: false, unavailable: false, error: null, reload: vi.fn() };
});
afterEach(cleanup);

describe('the page «Игры»', () => {
  it('says what the game is and lets a student in by the code: the phone’s page /play', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 1, name: 'Игры' })).toBeInTheDocument();
    expect(screen.getByText(GAMES.lede)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Войти в игру по коду' })).toHaveAttribute('href', '/play');
    // The real game on the projector, said in words for those who do not see it.
    expect(screen.getByRole('img', { name: GAMES.hero.alt })).toBeInTheDocument();
    expect(document.title).toMatch(/^Игры/);
    // «?» on this page opens the guide on its chapter.
    expect(document.querySelector('.gm-page')).toHaveAttribute('data-guide-chapter', 'game');
  });

  it('tells the three games by their own names, in plain words', () => {
    renderPage();
    const list = screen.getByRole('heading', { name: GAMES.modesTitle }).closest('section')!;
    const names = within(list).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent);
    expect(names).toEqual(['Битва с монстром', 'Встань на ответ', 'Убеги от Дедлайна']);
  });

  it('«Начать игру»: the user’s own tests and exams, tests first and the newest first; each one to the game’s setup', () => {
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Начать игру' }));
    const sheet = screen.getByRole('dialog', { name: 'Выберите тест или экзамен' });
    const rows = within(sheet).getAllByRole('listitem');
    expect(rows.map((row) => row.querySelector('.ct-row-t')?.textContent)).toEqual([
      'Новый тест',
      'Солнечная система',
      'Глаголы',
      'Дроби',
      'Экзамен по истории',
    ]);
    // A member's exam is not theirs to host (live_create takes the author's only).
    expect(within(sheet).queryByText('Микроэкономика')).toBeNull();
    expect(within(sheet).getByRole('link', { name: /Солнечная система/ })).toHaveAttribute('href', '/live/new?c=t-new');
    expect(within(sheet).getByRole('link', { name: /Дроби/ })).toHaveAttribute('href', '/live/new?c=t-old');
    expect(within(sheet).getByRole('link', { name: /Экзамен по истории/ })).toHaveAttribute('href', '/live/new?c=e-1');
    // Nothing to play yet: shown, not pressed, with what it lacks.
    expect(within(sheet).queryByRole('link', { name: /Глаголы|Новый тест/ })).toBeNull();
    const metas = Array.from(sheet.querySelectorAll('.ct-row-m')).map((meta) => meta.textContent);
    expect(metas).toEqual([
      'Тест · Пока без вопросов',
      'Тест · 24\u00a0вопроса',
      'Тест · 12\u00a0вопросов · нет отмеченных ответов',
      'Тест · 18\u00a0вопросов',
      'Экзамен · 40\u00a0вопросов',
    ]);
    // Escape closes it.
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('with no tests or exams of their own: the quick test, where questions are pasted', () => {
    overview.state = { ...overview.state, data: { v: 1, day: '2026-10-31', containers: [CONTAINERS[5]], attached_exam_ids: [] } };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Начать игру' }));
    const sheet = screen.getByRole('dialog', { name: 'Выберите тест или экзамен' });
    expect(within(sheet).getByText(GAMES.pick.empty)).toBeInTheDocument();
    expect(within(sheet).getByRole('link', { name: 'Быстрая контрольная' })).toHaveAttribute('href', '/tests/quick');
  });

  it('while the list loads, and when it could not: a quiet line, and «Повторить»', () => {
    overview.state = { ...overview.state, data: null, loading: true };
    const view = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Начать игру' }));
    expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent(GAMES.pick.loading);
    view.unmount();
    overview.state = { ...overview.state, data: null, loading: false, error: 'нет сети' };
    renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Начать игру' }));
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Повторить' }));
    expect(overview.state.reload).toHaveBeenCalled();
  });
});

describe('the picker’s order and words', () => {
  it('keeps the author’s own, tests before exams, the newest first', () => {
    expect(playableOf(CONTAINERS).map((row) => [row.container.id, row.kind, row.questions, row.playable])).toEqual([
      ['t-empty', 'test', 0, false],
      ['t-new', 'test', 24, true],
      ['t-nokey', 'test', 12, false],
      ['t-old', 'test', 18, true],
      ['e-1', 'exam', 40, true],
    ]);
    expect(pickMeta('test', 1)).toBe('Тест · 1 вопрос');
    expect(pickMeta('exam', 22)).toBe('Экзамен · 22 вопроса');
  });
});
